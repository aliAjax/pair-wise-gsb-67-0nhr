import { ResponsibilityChain, replay, checksumOf, authorizationCovers } from '../services/chain'
import { seedDefects, seedEquipment } from '../data/seed'
import type { JournalEntry } from '../types/domain'

declare const process: { exit(code: number): void } | undefined

let pass = 0
let fail = 0
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`) }
  else { fail++; console.error(`  ✗ ${msg}`) }
}

const equipment = structuredClone(seedEquipment)
const defects = structuredClone(seedDefects)
const eq = equipment
const grid = eq.find((e) => e.id === 'EQ-GRID')!
const item = grid.items[0]

console.log('1) 代理签署：授权时段+适用设备门控')
{
  const c = new ResponsibilityChain()
  const auth = c.createAuthorization({
    granter: '陆川', group: '继保专业组', member: '周慎',
    scopeEquipmentIds: ['EQ-GRID'], startTime: '2026-10-01T08:00', endTime: '2026-10-05T20:00',
    status: '生效中', source: '正式授权', note: 'test'
  })
  const ok = c.submitConclusion({
    equipmentId: 'EQ-GRID', itemId: item.id, reviewer: '周慎', reviewerGroup: '继保专业组',
    verdict: '合格', measured: '18/18', evidence: 'a.pdf', at: '2026-10-03T10:00', authorizationId: auth.id
  }, grid, defects)
  assert(ok.accepted && ok.conclusion.signMode === '代理签署', '授权范围内的代理签署有效')
  assert(ok.conclusion.authorizationSnapshot?.endTime === '2026-10-05T20:00', '结论冻结授权时段快照')

  // 范围外设备
  const out = c.submitConclusion({
    equipmentId: 'EQ-TR1', itemId: 'IT-T1', reviewer: '周慎', reviewerGroup: '继保专业组',
    verdict: '合格', measured: 'x', evidence: 'y', at: '2026-10-03T10:00', authorizationId: auth.id
  }, eq.find((e) => e.id === 'EQ-TR1'), defects)
  assert(!out.accepted && out.conclusion.state === '已失效' && /适用范围/.test(out.reason), '适用范围外设备代理签署不参与完整性')

  // 授权过期
  const expired = c.submitConclusion({
    equipmentId: 'EQ-GRID', itemId: 'IT-G2', reviewer: '周慎', reviewerGroup: '继保专业组',
    verdict: '合格', measured: 'x', evidence: 'y', at: '2026-10-06T10:00', authorizationId: auth.id
  }, grid, defects)
  assert(!expired.accepted && /授权时段/.test(expired.reason), '授权过期后代签被拒绝（授权过期仍锁版风险消除）')

  // 事后撤销不影响已存记录的可查性
  c.revokeAuthorization(auth.id, '2026-10-03T12:00')
  const stored = c.state.conclusions[0]
  assert(stored.state === '有效' && stored.authorizationSnapshot?.id === auth.id, '授权事后撤销，既有结论保留且快照可查')
}

console.log('2) 并发提交：先到保留，后到待裁定')
{
  const c = new ResponsibilityChain()
  const a = c.submitConclusion({ equipmentId: 'EQ-INV11', itemId: 'IT-I1', reviewer: '甲', reviewerGroup: '效率测试组', verdict: '合格', measured: '126/126', evidence: 'a', at: '2026-10-03T09:00:00', authorizationId: null }, eq.find((e) => e.id === 'EQ-INV11'), defects)
  const b = c.submitConclusion({ equipmentId: 'EQ-INV11', itemId: 'IT-I1', reviewer: '乙', reviewerGroup: '效率测试组', verdict: '不合格', measured: '125/126', evidence: 'b', at: '2026-10-03T09:00:01', authorizationId: null }, eq.find((e) => e.id === 'EQ-INV11'), defects)
  assert(a.accepted && a.conclusion.state === '有效', '先到结论有效')
  assert(!b.accepted && b.conclusion.state === '待裁定' && !!b.arbitration, '后到结论进入待裁定')
  c.decideArbitration(b.arbitration!.id, true, '陆川', '乙的点表证据更完整', '2026-10-03T10:00')
  const late = c.state.conclusions.find((x) => x.id === b.conclusion.id)!
  const first = c.state.conclusions.find((x) => x.id === a.conclusion.id)!
  assert(late.state === '裁定胜出' && first.state === '裁定落选', '裁定采纳后到：后到胜出、先到落选')
}

console.log('3) 证书换版：依赖结论与批次立即失效')
{
  const c = new ResponsibilityChain()
  c.submitConclusion({ equipmentId: 'EQ-GRID', itemId: 'IT-G1', reviewer: '甲', reviewerGroup: 'g', verdict: '合格', measured: 'm', evidence: 'e', at: '2026-10-03T09:00', authorizationId: null }, grid, defects)
  const lock = c.lockBatch({ label: 'B1', lockedBy: '陆川', at: '2026-10-03T11:00', plantVersion: 8, equipmentIds: ['EQ-GRID'] })
  assert(!!lock.batch && lock.batch!.state === '已锁定', '批次锁定')
  const cert = grid.certificates[0]
  const before = cert.version
  c.certificateReissued('EQ-GRID', cert, before + 1, '2026-10-04T09:00')
  assert(c.state.conclusions[0].state === '已失效', '证书换版后依赖结论立即失效')
  assert(c.state.batches[0].state === '已失效' && /换版/.test(c.state.batches[0].invalidReason!), '证书换版后签署批次立即失效')
  // 不依赖该证书的设备结论不受影响
  c.submitConclusion({ equipmentId: 'EQ-AR1', itemId: 'IT-A1', reviewer: '乙', reviewerGroup: 'g', verdict: '合格', measured: 'm', evidence: 'e', at: '2026-10-03T09:30', authorizationId: null }, eq.find((e) => e.id === 'EQ-AR1'), defects)
  assert(c.state.conclusions[1].state === '有效', '无该证书依赖的设备结论不受波及')
}

console.log('4) 缺陷重开：级联失效')
{
  const c = new ResponsibilityChain()
  c.submitConclusion({ equipmentId: 'EQ-TR1', itemId: 'IT-T2', reviewer: '甲', reviewerGroup: 'g', verdict: '合格', measured: '修复', evidence: 'e', at: '2026-10-03T09:00', authorizationId: null }, eq.find((e) => e.id === 'EQ-TR1'), defects)
  c.lockBatch({ label: 'B2', lockedBy: '陆川', at: '2026-10-03T11:00', plantVersion: 9, equipmentIds: ['EQ-TR1'] })
  const defect = defects.find((d) => d.id === 'AD-260929-01')!
  defect.status = '已关闭'
  c.defectReopened(defect, '2026-10-05T09:00')
  assert(c.state.conclusions[0].state === '已失效', '缺陷重开后关联结论立即失效')
  assert(c.state.batches[0].state === '已失效', '缺陷重开后批次立即失效')
}

console.log('5) 保存中断：从最后一笔完整责任链继续')
{
  const c = new ResponsibilityChain()
  c.createAuthorization({ granter: '陆川', group: 'g', member: '周慎', scopeEquipmentIds: ['EQ-GRID'], startTime: '2026-10-01T08:00', endTime: '2026-10-05T20:00', status: '生效中', source: '正式授权', note: 'n' })
  c.submitConclusion({ equipmentId: 'EQ-GRID', itemId: 'IT-G1', reviewer: '周慎', reviewerGroup: 'g', verdict: '合格', measured: 'm', evidence: 'e', at: '2026-10-03T09:00', authorizationId: c.state.authorizations[0].id }, grid, defects)
  const goodJournal: JournalEntry[] = structuredClone(c.state.journal)
  // 模拟写入中断：追加两条，第一条损坏，第二条结构残缺
  const corrupt: JournalEntry[] = [
    ...structuredClone(goodJournal),
    { seq: 3, at: '2026-10-03T12:00', event: { type: '批次失效' as never, batchId: 'SB-x', reason: '断' }, checksum: 'chk-bad' },
    { seq: 4, at: '2026-10-03T12:05', event: { type: '授权撤销' as never }, checksum: '' } as unknown as JournalEntry
  ]
  // 按 store.hydrate 的校验逻辑截断
  let goodUntil = -1
  corrupt.forEach((entry, i) => {
    if (entry.checksum === checksumOf({ seq: entry.seq, at: entry.at, event: entry.event })) goodUntil = i
  })
  const recovered = replay(corrupt.slice(0, goodUntil + 1))
  assert(recovered.journal.length === goodJournal.length, `中断台账截断到最后完整链（${goodJournal.length}笔）`)
  assert(recovered.conclusions.length === 1 && recovered.conclusions[0].state === '有效', '恢复后最后完整链结论可继续使用')

  // 序号断裂同样视为中断，不会把缺笔之后的记录当成完整链
  const gap: JournalEntry[] = [
    ...structuredClone(goodJournal),
    { seq: 5, at: '2026-10-03T13:00', event: corrupt[2].event, checksum: checksumOf({ seq: 5, at: '2026-10-03T13:00', event: corrupt[2].event }) }
  ]
  let gapUntil = -1
  gap.forEach((entry, i) => {
    if (entry.seq === i + 1 && entry.checksum === checksumOf({ seq: entry.seq, at: entry.at, event: entry.event })) gapUntil = i
  })
  assert(gapUntil === goodJournal.length - 1, '序号断裂时同样截断到最后连续完整链')
}

console.log('6) 旧数据迁移：补出待确认授权，不直接参与签署')
{
  const c = new ResponsibilityChain()
  const auth = c.createAuthorization({ granter: '陆川', group: '继保专业组', member: '周慎', scopeEquipmentIds: ['EQ-GRID', 'EQ-INV11'], startTime: '2026-09-26T00:00', endTime: '2026-09-27T23:59', status: '待确认', source: '历史迁移补录', note: '旧系统仅留姓名' })
  const outcome = c.submitConclusion({ equipmentId: 'EQ-GRID', itemId: 'IT-G1', reviewer: '周慎', reviewerGroup: '继保专业组', verdict: '合格', measured: '迁移', evidence: '迁移', at: '2026-09-26T10:15', authorizationId: auth.id, migratedFromLegacy: true, pendingConfirmation: true }, grid, defects)
  assert(!outcome.accepted && outcome.conclusion.state === '待确认', '迁移结论待确认，不参与签署')
  assert(authorizationCovers(auth, 'EQ-GRID', '2026-09-26T10:15').ok === false, '待确认授权不能通过签署门控')
  // 确认授权与结论后才纳入
  c.confirmAuthorization(auth.id, '陆川', '2026-10-03T08:00')
  const r = c.confirmMigratedConclusion(outcome.conclusion.id, '陆川', '2026-10-03T08:05', grid, defects)
  assert(r.ok && c.state.conclusions[0].state === '有效', '授权+结论双确认后才纳入完整性判断')
  // 重放后确认状态保持
  const again = replay(c.state.journal)
  assert(again.conclusions[0].state === '有效' && again.authorizations[0].status === '已确认', '重放后迁移确认状态不丢失')
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
if (fail) process?.exit(1)
