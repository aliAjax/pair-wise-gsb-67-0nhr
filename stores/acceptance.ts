import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { seedAudit, seedDefects, seedEquipment, seedLegacySignatures, seedPlant } from '../data/seed'
import {
  ResponsibilityChain,
  authorizationCovers,
  authorizationStatusAt,
  checksumOf,
  replay
} from '../services/chain'
import type {
  AcceptanceDefect,
  AcceptanceItem,
  ArbitrationCase,
  AuditEntry,
  ConclusionVerdict,
  EquipmentNode,
  JournalEntry,
  PartyReply,
  Plant,
  ReviewConclusion,
  SigningAuthorization,
  SigningBatch
} from '../types/domain'

const STORAGE_KEY = 'gsb67:grid-acceptance-v2'
const CURRENT_USER = '陆川'
let idSeed = 30

interface PersistShape {
  plant: Plant
  equipment: EquipmentNode[]
  defects: AcceptanceDefect[]
  audit: AuditEntry[]
  journal: JournalEntry[]
  legacyMigrated: boolean
}

export const useAcceptanceStore = defineStore('acceptance', () => {
  const plant = ref<Plant>(structuredClone(seedPlant))
  const equipment = ref<EquipmentNode[]>(structuredClone(seedEquipment))
  const defects = ref<AcceptanceDefect[]>(structuredClone(seedDefects))
  const audit = ref<AuditEntry[]>(structuredClone(seedAudit))
  const journal = ref<JournalEntry[]>([])
  const legacyMigrated = ref(false)
  const lastRecovery = ref<string | null>(null)
  const selectedEquipmentId = ref(equipment.value[0].id)
  const keyword = ref('')
  const hydrated = ref(false)
  // 链状态保存在普通类中；每次变更递增 tick，驱动相关 computed 重算
  const chainTick = ref(0)

  const chain = new ResponsibilityChain()

  function rebuildChain() {
    const replayed = replay(journal.value)
    chain.state = replayed
    chainTick.value++
  }

  const authorizations = computed<SigningAuthorization[]>(() => { void chainTick.value; return chain.state.authorizations })
  const conclusions = computed<ReviewConclusion[]>(() => { void chainTick.value; return chain.state.conclusions })
  const arbitrations = computed<ArbitrationCase[]>(() => { void chainTick.value; return chain.state.arbitrations })
  const batches = computed<SigningBatch[]>(() => { void chainTick.value; return chain.state.batches })

  const selectedEquipment = computed(() => equipment.value.find((item) => item.id === selectedEquipmentId.value))
  const stats = computed(() => {
    const items = equipment.value.flatMap((item) => item.items)
    return {
      total: items.length,
      passed: items.filter((item) => item.status === '合格').length,
      failed: items.filter((item) => item.status === '不合格' || item.status === '待复验').length,
      openDefects: defects.value.filter((item) => !['已关闭', '带条件通过'].includes(item.status)).length
    }
  })

  /** 责任链完整性：验收项必须持有一条「有效」结论；待确认/待裁定/失效结论不算数 */
  const chainCoverage = computed(() => {
    void chainTick.value
    const rows: { equipmentId: string; itemId: string; conclusion: ReviewConclusion | null }[] = []
    for (const node of equipment.value) {
      for (const item of node.items) {
        const conclusion = chain.state.conclusions.find(
          (c) => c.equipmentId === node.id && c.itemId === item.id && c.state === '有效'
        ) ?? null
        rows.push({ equipmentId: node.id, itemId: item.id, conclusion })
      }
    }
    return rows
  })

  const preflight = computed(() => {
    void chainTick.value
    const blocking: string[] = []
    const items = equipment.value.flatMap((item) => item.items)
    if (items.some((item) => item.status === '待检查')) blocking.push('仍有验收项未检查')
    if (items.some((item) => item.status === '不合格' || item.status === '待复验')) blocking.push('存在不合格或待复验项')
    if (defects.value.some((item) => !['已关闭', '带条件通过'].includes(item.status))) blocking.push('存在未闭环缺陷')
    if (equipment.value.flatMap((item) => item.certificates).some((item) => !item.verified)) blocking.push('存在未核验证书')
    const expired = equipment.value.flatMap((item) => item.certificates).some((item) => item.expiresAt < plant.value.commissioningDate)
    if (expired) blocking.push('证书在并网日期前失效')

    const missing = chainCoverage.value.filter((row) => !row.conclusion)
    if (missing.length) {
      blocking.push(`有 ${missing.length} 个验收项缺少有效责任链结论（待确认/待裁定/失效不计入）`)
    }
    const pendingConfirm = chain.state.conclusions.filter((c) => c.state === '待确认').length
    if (pendingConfirm) blocking.push(`${pendingConfirm} 条迁移结论的补录授权待确认，不能参与签署`)
    const pendingArb = chain.state.arbitrations.filter((a) => a.status === '待裁定').length
    if (pendingArb) blocking.push(`${pendingArb} 起并发提交待裁定`)
    const invalidBatches = chain.state.batches.filter((b) => b.state === '已失效').length
    if (invalidBatches) blocking.push(`${invalidBatches} 个签署批次已因证书换版/缺陷重开失效`)

    return { allowed: blocking.length === 0, blocking }
  })

  function log(entityId: string, action: string, operator: string, detail: string) {
    audit.value.unshift({ id: `AUD-${Date.now()}-${idSeed++}`, entityId, action, operator, detail, createdAt: new Date().toISOString() })
  }

  /** 原子持久化：整包写入；写入失败/中断不会产生半笔台账（下次 hydrate 按校验和截断到最后完整链） */
  function persist() {
    if (!import.meta.client) return
    const payload: PersistShape = {
      plant: plant.value,
      equipment: equipment.value,
      defects: defects.value,
      audit: audit.value,
      journal: chain.state.journal,
      legacyMigrated: legacyMigrated.value
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    chainTick.value++
  }

  /** 校验台账：逐条重算校验和，返回最后一笔完整责任链的位置 */
  function verifyJournal(entries: JournalEntry[]): number {
    let goodUntil = -1
    entries.forEach((entry, i) => {
      if (entry.seq !== i + 1) return
      const expected = checksumOf({ seq: entry.seq, at: entry.at, event: entry.event })
      if (entry.checksum !== expected) return
      goodUntil = i
    })
    return goodUntil
  }

  function hydrate() {
    if (!import.meta.client || hydrated.value) return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const stored = JSON.parse(raw) as Partial<PersistShape>
        if (stored.plant) plant.value = stored.plant
        if (stored.equipment) equipment.value = stored.equipment
        if (stored.defects) defects.value = stored.defects
        if (stored.audit) audit.value = stored.audit
        const entries = Array.isArray(stored.journal) ? stored.journal : []
        const goodUntil = verifyJournal(entries)
        if (goodUntil + 1 < entries.length) {
          lastRecovery.value = `检测到保存中断：台账共 ${entries.length} 笔，最后完整责任链为第 ${goodUntil + 1} 笔，后续 ${entries.length - goodUntil - 1} 笔已丢弃并从该处继续`
          log('PV-2609-NW', '保存中断恢复', '系统', lastRecovery.value)
        }
        journal.value = entries.slice(0, goodUntil + 1)
        rebuildChain()
        legacyMigrated.value = !!stored.legacyMigrated
      }
    } catch {
      // Storage corrupt: seed data is kept.
      lastRecovery.value = '本地数据无法解析，已回到内置演示数据'
    }
    hydrated.value = true
  }

  // ---------- 旧数据迁移：补出待确认授权，不直接参与签署 ----------

  function migrateLegacy() {
    if (legacyMigrated.value) return { ok: false, message: '旧数据已迁移，请勿重复执行' }
    const now = new Date().toISOString()
    // 旧记录只有姓名：为该专业组补录一张待确认授权（时段与适用范围由负责人事后确认）
    const groups = new Map(seedLegacySignatures.map((s) => [`${s.group}|${s.name}`, s]))
    const authByKey = new Map<string, SigningAuthorization>()
    for (const sig of groups.values()) {
      const auth = chain.createAuthorization({
        granter: CURRENT_USER,
        group: sig.group,
        member: sig.name,
        scopeEquipmentIds: [...new Set(seedLegacySignatures.filter((s) => s.name === sig.name).map((s) => s.equipmentId))],
        startTime: '2026-09-26T00:00:00',
        endTime: '2026-09-27T23:59:59',
        status: '待确认',
        source: '历史迁移补录',
        note: `旧系统仅留存签署人「${sig.name}」，授权时段与适用设备待负责人确认`,
        createdAt: now
      })
      authByKey.set(`${sig.group}|${sig.name}`, auth)
    }
    const conclusionIds: string[] = []
    for (const sig of seedLegacySignatures) {
      const auth = authByKey.get(`${sig.group}|${sig.name}`)!
      const node = equipment.value.find((n) => n.id === sig.equipmentId)
      const outcome = chain.submitConclusion({
        equipmentId: sig.equipmentId,
        itemId: sig.itemId,
        reviewer: sig.name,
        reviewerGroup: sig.group,
        verdict: sig.verdict as ConclusionVerdict,
        measured: '（旧系统迁移，无实测记录）',
        evidence: '（旧系统迁移，无证据附件）',
        at: sig.signedAt,
        authorizationId: auth.id,
        migratedFromLegacy: true,
        pendingConfirmation: true
      }, node, defects.value)
      conclusionIds.push(outcome.conclusion.id)
    }
    chain.state.journal.push({
      seq: chain.nextSeq(),
      at: now,
      event: { type: '历史迁移', authorizationId: [...authByKey.values()].map((a) => a.id).join(','), conclusionIds, note: `${seedLegacySignatures.length} 条旧签署迁移为待确认责任链` },
      checksum: ''
    })
    const migrationEntry = chain.state.journal[chain.state.journal.length - 1]
    migrationEntry.checksum = checksumOf({ seq: migrationEntry.seq, at: migrationEntry.at, event: migrationEntry.event })
    chain.state.seq = migrationEntry.seq

    legacyMigrated.value = true
    log('PV-2609-NW', '旧数据迁移', CURRENT_USER, `补录 ${authByKey.size} 张待确认授权，${conclusionIds.length} 条旧签署转为待确认结论，不参与签署`)
    persist()
    return { ok: true, message: `已迁移 ${conclusionIds.length} 条旧签署：授权待确认，暂不参与签署` }
  }

  function confirmMigrationAuth(authId: string) {
    const at = new Date().toISOString()
    const updated = chain.confirmAuthorization(authId, CURRENT_USER, at)
    if (!updated) return { ok: false, message: '授权不存在或不可确认' }
    // 授权确认后，迁移结论仍需复核人重新确认才转为有效：这里由负责人逐条确认
    log(authId, '确认补录授权', CURRENT_USER, `授权时段 ${updated.startTime} ~ ${updated.endTime}，适用设备 ${updated.scopeEquipmentIds.length} 台`)
    persist()
    return { ok: true, message: '授权已确认，可对相关迁移结论执行复核确认' }
  }

  /** 授权确认后，负责人确认旧结论真实，结论转为有效并重新冻结快照 */
  function confirmLegacyConclusion(conclusionId: string) {
    const at = new Date().toISOString()
    const c = chain.state.conclusions.find((x) => x.id === conclusionId)
    if (!c) return { ok: false, message: '结论不存在' }
    const eq = equipment.value.find((n) => n.id === c.equipmentId)
    const result = chain.confirmMigratedConclusion(conclusionId, CURRENT_USER, at, eq, defects.value)
    if (!result.ok) return { ok: false, message: result.reason }
    log(conclusionId, '确认迁移结论', CURRENT_USER, `授权 ${c.authorizationId} 已核实，结论纳入完整性判断`)
    persist()
    return { ok: true, message: result.reason }
  }

  // ---------- 授权管理 ----------

  function grantAuthorization(input: { group: string; member: string; scopeEquipmentIds: string[]; startTime: string; endTime: string; note: string }) {
    const at = new Date().toISOString()
    const auth = chain.createAuthorization({
      granter: CURRENT_USER,
      group: input.group,
      member: input.member,
      scopeEquipmentIds: input.scopeEquipmentIds,
      startTime: input.startTime,
      endTime: input.endTime,
      status: '生效中',
      source: '正式授权',
      note: input.note,
      createdAt: at
    })
    log(auth.id, '临时授权专业组代签', CURRENT_USER, `${input.group}${input.member}｜${input.startTime.slice(0, 16)}~${input.endTime.slice(0, 16)}｜设备${input.scopeEquipmentIds.length}台`)
    persist()
    return { ok: true, message: `授权 ${auth.id} 已生效` }
  }

  function revokeAuthorization(id: string) {
    const updated = chain.revokeAuthorization(id, new Date().toISOString())
    if (!updated) return { ok: false, message: '授权无法撤销' }
    log(id, '撤销授权', CURRENT_USER, '代理签署立即停止参与新结论')
    persist()
    return { ok: true, message: '授权已撤销（历史签署记录仍可查）' }
  }

  function authLiveState(auth: SigningAuthorization) {
    return authorizationStatusAt(auth, new Date().toISOString())
  }

  function authGate(authId: string | null, equipmentId: string, at: string) {
    if (!authId) return { ok: true as const, reason: '本人复核', auth: null }
    const auth = chain.state.authorizations.find((a) => a.id === authId)
    if (!auth) return { ok: false as const, reason: '授权记录不存在', auth: null }
    const gate = authorizationCovers(auth, equipmentId, at)
    return { ...gate, auth }
  }

  // ---------- 复核结论提交（含并发裁定） ----------

  function submitConclusion(input: {
    equipmentId: string
    itemId: string
    reviewer: string
    reviewerGroup: string
    verdict: ConclusionVerdict
    measured: string
    evidence: string
    authorizationId: string | null
  }) {
    const at = new Date().toISOString()
    if (!input.reviewer.trim()) return { ok: false, message: '复核人姓名不能为空' }
    const gate = authGate(input.authorizationId, input.equipmentId, at)
    if (!gate.ok) return { ok: false, message: gate.reason }
    const node = equipment.value.find((n) => n.id === input.equipmentId)
    const outcome = chain.submitConclusion({ ...input, at }, node, defects.value)
    // 同步验收项实测字段，保持设备树视图一致
    const item = node?.items.find((i) => i.id === input.itemId)
    if (item && outcome.accepted) {
      item.measured = input.measured
      item.evidence = input.evidence
      item.status = input.verdict
      item.version += 1
    }
    if (outcome.arbitration) {
      log(outcome.arbitration.id, '并发提交进入待裁定', input.reviewer, outcome.reason)
    } else {
      log(outcome.conclusion.id, outcome.accepted ? '提交复核结论' : '结论未纳入完整性', input.reviewer, outcome.reason)
    }
    persist()
    return { ok: true, message: outcome.reason, conclusionId: outcome.conclusion.id, arbitration: outcome.arbitration }
  }

  function decideArbitration(arbitrationId: string, adoptLate: boolean, note: string) {
    const at = new Date().toISOString()
    if (!note.trim()) return { ok: false, message: '裁定意见不能为空' }
    const ok = chain.decideArbitration(arbitrationId, adoptLate, CURRENT_USER, note, at)
    if (!ok) return { ok: false, message: '案件不存在或已裁定' }
    const arb = chain.state.arbitrations.find((a) => a.id === arbitrationId)!
    const adoptedId = adoptLate ? arb.lateConclusionId : arb.firstConclusionId
    const adopted = chain.state.conclusions.find((c) => c.id === adoptedId)
    if (adopted) {
      const node = equipment.value.find((n) => n.id === adopted.equipmentId)
      const item = node?.items.find((i) => i.id === adopted.itemId)
      if (item) { item.measured = adopted.measured; item.evidence = adopted.evidence; item.status = adopted.verdict; item.version += 1 }
    }
    log(arbitrationId, '完成并发裁定', CURRENT_USER, `${adoptLate ? '采纳后到' : '维持先到'}：${note}`)
    persist()
    return { ok: true, message: '裁定完成' }
  }

  // ---------- 证书换版 / 缺陷重开：级联失效 ----------

  function reissueCertificate(equipmentId: string, certificateId: string) {
    const node = equipment.value.find((n) => n.id === equipmentId)
    const cert = node?.certificates.find((c) => c.id === certificateId)
    if (!cert) return { ok: false, message: '证书不存在' }
    chain.certificateReissued(equipmentId, cert, cert.version + 1, new Date().toISOString())
    log(certificateId, '证书换版', CURRENT_USER, `升级至V${cert.version}并置为待核验，依赖结论与签署批次立即失效`)
    persist()
    return { ok: true, message: `证书已换版至 V${cert.version}：依赖它的有效结论与锁定批次立即失效，需重新复核` }
  }

  function reopenDefect(defectId: string) {
    const defect = defects.value.find((d) => d.id === defectId)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (defect.status === '整改中') return { ok: false, message: '缺陷已在整改中' }
    chain.defectReopened(defect, new Date().toISOString())
    log(defectId, '缺陷重开', CURRENT_USER, `重开至整改中，V${defect.version}：关联结论与签署批次立即失效`)
    persist()
    return { ok: true, message: `缺陷已重开（V${defect.version}）：依赖结论与签署批次立即失效` }
  }

  // ---------- 签署批次 ----------

  function lockBatch(label: string, equipmentIds: string[]) {
    if (!preflight.value.allowed) return { ok: false, message: preflight.value.blocking.join('；') }
    const at = new Date().toISOString()
    plant.value.version += 1
    const { batch, reason } = chain.lockBatch({ label, lockedBy: CURRENT_USER, at, plantVersion: plant.value.version, equipmentIds })
    if (!batch) {
      plant.value.version -= 1
      return { ok: false, message: reason }
    }
    plant.value.status = '已签署'
    equipment.value.forEach((node) => { if (equipmentIds.includes(node.id)) node.status = '已验收' })
    log(batch.id, '签署批次锁定', CURRENT_USER, `${label}：纳入${batch.conclusionIds.length}条有效结论，代理授权${batch.authIds.length}张`)
    persist()
    return { ok: true, message: `批次 ${batch.id} 已锁定 ${batch.conclusionIds.length} 条结论` }
  }

  // ---------- 既有缺陷协作流程（保留） ----------

  function updateItem(equipmentId: string, itemId: string, patch: Partial<AcceptanceItem>) {
    const item = equipment.value.find((node) => node.id === equipmentId)?.items.find((value) => value.id === itemId)
    if (!item) return
    Object.assign(item, patch, { version: item.version + 1 })
    log(equipmentId, '更新验收项', '当前用户', `${item.id}状态更新为${item.status}`)
    persist()
  }

  function assignDefect(id: string, owner: string) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return
    defect.owner = owner
    defect.status = '整改中'
    defect.version += 1
    log(id, '分派缺陷', '验收负责人', `责任方调整为${owner}`)
    persist()
  }

  function addReply(id: string, reply: PartyReply) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect || !reply.content || !reply.evidence) return { ok: false, message: '回复内容和证据均不能为空' }
    defect.replies.unshift(reply)
    defect.status = '待联合复验'
    defect.version += 1
    log(id, `${reply.party}提交处理说明`, reply.owner, reply.content)
    persist()
    return { ok: true, message: '已提交处理说明并进入联合复验' }
  }

  function addRetest(id: string, result: string, passed: boolean) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return
    defect.retests.unshift({ round: defect.retests.length + 1, passed, result, tester: '联合验收组', testedAt: new Date().toISOString() })
    defect.status = passed ? '已关闭' : '整改中'
    defect.version += 1
    log(id, '执行联合复验', '联合验收组', result)
    persist()
  }

  function decideDefect(id: string, status: '已关闭' | '带条件通过' | '整改中', note: string) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (status === '已关闭' && !defect.retests.some((item) => item.passed)) return { ok: false, message: '没有合格复验记录，不能关闭' }
    if (status === '带条件通过' && !note.trim()) return { ok: false, message: '带条件通过必须说明限制条件' }
    defect.status = status
    defect.decisionNote = note
    defect.version += 1
    log(id, `验收决定：${status}`, '验收负责人', note || '完成整改闭环')
    persist()
    return { ok: true, message: `缺陷已更新为${status}` }
  }

  function reset() {
    plant.value = structuredClone(seedPlant)
    equipment.value = structuredClone(seedEquipment)
    defects.value = structuredClone(seedDefects)
    audit.value = structuredClone(seedAudit)
    journal.value = []
    legacyMigrated.value = false
    lastRecovery.value = null
    rebuildChain()
    persist()
  }

  return {
    plant, equipment, defects, audit, hydrated, keyword, selectedEquipmentId, lastRecovery,
    selectedEquipment, stats, preflight, chainCoverage,
    authorizations, conclusions, arbitrations, batches,
    hydrate, reset, log,
    migrateLegacy, confirmMigrationAuth, confirmLegacyConclusion,
    grantAuthorization, revokeAuthorization, authLiveState, authGate,
    submitConclusion, decideArbitration,
    reissueCertificate, reopenDefect,
    lockBatch,
    updateItem, assignDefect, addReply, addRetest, decideDefect
  }
})
