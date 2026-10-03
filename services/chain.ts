import type {
  ArbitrationCase,
  AuthorizationStatus,
  Certificate,
  ConclusionState,
  ConclusionVerdict,
  DefectSnapshot,
  EquipmentNode,
  JournalEntry,
  ReviewConclusion,
  SigningAuthorization,
  SigningBatch,
  AcceptanceDefect
} from '../types/domain'

export interface ChainState {
  authorizations: SigningAuthorization[]
  conclusions: ReviewConclusion[]
  arbitrations: ArbitrationCase[]
  batches: SigningBatch[]
  journal: JournalEntry[]
  seq: number
}

export interface SubmitConclusionInput {
  equipmentId: string
  itemId: string
  reviewer: string
  reviewerGroup: string
  verdict: ConclusionVerdict
  measured: string
  evidence: string
  at: string
  /** 代理签署时携带的授权 id；本人复核为空 */
  authorizationId: string | null
  migratedFromLegacy?: boolean
  pendingConfirmation?: boolean
}

export interface SubmitOutcome {
  conclusion: ReviewConclusion
  arbitration: ArbitrationCase | null
  /** 完整性判断是否接纳本结论（待确认/待裁定/失效均不参与） */
  accepted: boolean
  reason: string
}

// ---------- 纯函数规则 ----------

export function authorizationStatusAt(auth: SigningAuthorization, at: string): AuthorizationStatus {
  if (auth.status === '已撤销') return '已撤销'
  if (auth.status === '待确认') return '待确认'
  if (at < auth.startTime || at > auth.endTime) return '已过期'
  return auth.status === '已确认' ? '生效中' : auth.status
}

/** 代理签署只在「授权已确认 + 在授权时段内 + 设备在适用范围内」时参与完整性判断 */
export function authorizationCovers(auth: SigningAuthorization, equipmentId: string, at: string): { ok: boolean; reason: string } {
  const status = authorizationStatusAt(auth, at)
  if (auth.source === '历史迁移补录' && auth.status === '待确认') return { ok: false, reason: '迁移补录授权待确认，不能参与签署' }
  if (status === '待确认') return { ok: false, reason: '授权尚未确认生效' }
  if (status === '已过期') return { ok: false, reason: `授权时段已于 ${auth.endTime} 结束` }
  if (status === '已撤销') return { ok: false, reason: '授权已被撤销' }
  if (!auth.scopeEquipmentIds.includes(equipmentId)) return { ok: false, reason: '该设备不在授权适用范围内' }
  return { ok: true, reason: '' }
}

export function activeFirstConclusion(conclusions: ReviewConclusion[], equipmentId: string, itemId: string): ReviewConclusion | null {
  return conclusions.find((c) => c.equipmentId === equipmentId && c.itemId === itemId && c.state === '有效') ?? null
}

export function certSnapshotsFor(equipment: EquipmentNode | undefined): ReviewConclusion['certSnapshot'] {
  return (equipment?.certificates ?? []).map((c) => ({ id: c.id, name: c.name, version: c.version, verified: c.verified }))
}

export function defectSnapshotsFor(defects: AcceptanceDefect[], equipmentId: string): DefectSnapshot[] {
  return defects
    .filter((d) => d.equipmentId === equipmentId)
    .map((d) => ({ defectId: d.id, version: d.version, status: d.status }))
}

/** 结论是否参与完整性判断：只有「有效」参与；待确认/待裁定/落选/失效均不参与 */
export function conclusionCountsForIntegrity(c: ReviewConclusion): boolean {
  return c.state === '有效'
}

// ---------- 校验和（保存中断时识别完整链） ----------

export function checksumOf(payload: unknown): string {
  const text = JSON.stringify(payload)
  let hash = 5381
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  }
  return `chk-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function emptyChainState(): ChainState {
  return { authorizations: [], conclusions: [], arbitrations: [], batches: [], journal: [], seq: 0 }
}

// ---------- 状态归约（从台账重放，用于保存中断后恢复） ----------

export function replay(journal: JournalEntry[]): ChainState {
  const state = emptyChainState()
  for (const entry of journal) {
    state.journal.push(structuredClone(entry))
    applyEntry(state, entry)
  }
  return state
}

function applyEntry(state: ChainState, entry: JournalEntry) {
  const e = entry.event
  state.seq = Math.max(state.seq, entry.seq)
  switch (e.type) {
    case '授权创建':
      state.authorizations.push(structuredClone(e.authorization))
      break
    case '授权确认':
    case '授权撤销':
      replace(state.authorizations, (a) => a.id === e.authorization.id, structuredClone(e.authorization))
      break
    case '结论提交': {
      state.conclusions.push(structuredClone(e.conclusion))
      if (e.arbitration) state.arbitrations.push(structuredClone(e.arbitration))
      break
    }
    case '仲裁裁定': {
      replace(state.arbitrations, (a) => a.id === e.arbitration.id, structuredClone(e.arbitration))
      const adopted = state.conclusions.find((c) => c.id === e.adoptedConclusionId)
      const rejected = state.conclusions.find((c) => c.id === e.rejectedConclusionId)
      if (adopted) { adopted.state = '裁定胜出'; adopted.invalidReason = null; adopted.invalidatedAt = null; adopted.arbitrationId = e.arbitration.id }
      if (rejected) { rejected.state = '裁定落选'; rejected.invalidReason = '同验收项并发提交，裁定未采纳'; rejected.invalidatedAt = e.arbitration.decidedAt; rejected.arbitrationId = e.arbitration.id }
      break
    }
    case '证书换版':
    case '缺陷重开': {
      const reason = e.type === '证书换版'
        ? `依赖证书《${e.certificateName}》已换版 V${e.oldVersion}→V${e.newVersion}`
        : `关联缺陷 ${e.defectId} 已重开（V${e.newVersion}）`
      for (const c of state.conclusions) {
        if (c.state === '已失效' || c.equipmentId !== (e.type === '证书换版' ? e.equipmentId : e.equipmentId)) continue
        const depends = e.type === '证书换版'
          ? c.certSnapshot.some((s) => s.id === e.certificateId && s.version !== e.newVersion)
          : c.defectRefs.some((s) => s.defectId === e.defectId && s.version !== e.newVersion)
        if (depends) { c.state = '已失效'; c.invalidReason = reason; c.invalidatedAt = entry.at }
      }
      const invalidIds = new Set(state.conclusions.filter((c) => c.state === '已失效' && c.invalidatedAt === entry.at).map((c) => c.id))
      for (const b of state.batches) {
        if (b.state !== '已锁定') continue
        const hitByConclusion = b.conclusionIds.some((id) => invalidIds.has(id))
        const hitByCert = e.type === '证书换版' && b.certSnapshot.some((s) => s.id === e.certificateId && s.version !== e.newVersion)
        const hitByDefect = e.type === '缺陷重开' && b.defectSnapshot.some((s) => s.defectId === e.defectId && s.version !== e.newVersion)
        if (hitByConclusion || hitByCert || hitByDefect) { b.state = '已失效'; b.invalidReason = reason; b.invalidatedAt = entry.at }
      }
      break
    }
    case '签署批次锁定':
      state.batches.push(structuredClone(e.batch))
      for (const c of state.conclusions) {
        if (e.batch.conclusionIds.includes(c.id)) c.batchId = e.batch.id
      }
      break
    case '批次失效': {
      const b = state.batches.find((x) => x.id === e.batchId)
      if (b) { b.state = '已失效'; b.invalidReason = e.reason; b.invalidatedAt = entry.at }
      break
    }
    case '历史迁移':
      break
    case '迁移结论确认': {
      const c = state.conclusions.find((x) => x.id === e.conclusionId)
      if (c) {
        c.state = '有效'
        c.invalidReason = null
        c.invalidatedAt = null
        c.certSnapshot = structuredClone(e.certSnapshot)
        c.defectRefs = structuredClone(e.defectRefs)
      }
      break
    }
  }
}

function replace<T>(list: T[], predicate: (item: T) => boolean, value: T) {
  const idx = list.findIndex(predicate)
  if (idx >= 0) list[idx] = value
}

// ---------- 责任链引擎 ----------

export class ResponsibilityChain {
  state: ChainState

  constructor(state?: ChainState) {
    this.state = state ?? emptyChainState()
  }

  nextSeq(): number {
    return this.state.seq + 1
  }

  private append(event: JournalEntry['event'], at: string): JournalEntry {
    const seq = this.nextSeq()
    const entry: JournalEntry = { seq, at, event, checksum: '' }
    entry.checksum = checksumOf({ seq, at, event })
    this.state.journal.push(entry)
    this.state.seq = seq
    applyEntry(this.state, entry)
    return entry
  }

  createAuthorization(input: Omit<SigningAuthorization, 'id' | 'status' | 'createdAt' | 'confirmedAt' | 'revokedAt'> & { id?: string; status?: AuthorizationStatus; createdAt?: string }): SigningAuthorization {
    const auth: SigningAuthorization = {
      id: input.id ?? `AUTH-${this.nextSeq()}`,
      granter: input.granter,
      group: input.group,
      member: input.member,
      scopeEquipmentIds: [...input.scopeEquipmentIds],
      startTime: input.startTime,
      endTime: input.endTime,
      status: input.status ?? '生效中',
      source: input.source,
      note: input.note,
      createdAt: input.createdAt ?? new Date().toISOString(),
      confirmedAt: input.status === '已确认' ? new Date().toISOString() : null,
      revokedAt: null
    }
    this.append({ type: '授权创建', authorization: auth }, auth.createdAt)
    return auth
  }

  confirmAuthorization(id: string, by: string, at: string): SigningAuthorization | null {
    const auth = this.state.authorizations.find((a) => a.id === id)
    if (!auth || auth.status !== '待确认') return null
    const updated: SigningAuthorization = { ...auth, status: '已确认', confirmedAt: at, note: `${auth.note}（确认人：${by}）` }
    this.append({ type: '授权确认', authorization: updated }, at)
    return updated
  }

  revokeAuthorization(id: string, at: string): SigningAuthorization | null {
    const auth = this.state.authorizations.find((a) => a.id === id)
    if (!auth || auth.status === '已撤销') return null
    const updated: SigningAuthorization = { ...auth, status: '已撤销', revokedAt: at }
    this.append({ type: '授权撤销', authorization: updated }, at)
    return updated
  }

  submitConclusion(input: SubmitConclusionInput, equipment: EquipmentNode | undefined, defects: AcceptanceDefect[]): SubmitOutcome {
    const seq = this.nextSeq()
    const at = input.at
    let auth: SigningAuthorization | null = null
    let authSnapshot: ReviewConclusion['authorizationSnapshot'] = null
    let signMode: ReviewConclusion['signMode'] = '本人复核'
    let gate: { ok: boolean; reason: string } = { ok: true, reason: '' }

    if (input.authorizationId) {
      auth = this.state.authorizations.find((a) => a.id === input.authorizationId) ?? null
      if (!auth) {
        gate = { ok: false, reason: '授权记录不存在' }
      } else {
        gate = authorizationCovers(auth, input.equipmentId, at)
        signMode = '代理签署'
        authSnapshot = {
          id: auth.id, granter: auth.granter, group: auth.group, member: auth.member,
          scopeEquipmentIds: [...auth.scopeEquipmentIds], startTime: auth.startTime,
          endTime: auth.endTime, source: auth.source
        }
      }
    }

    // 并发：两名复核人同时提交同一验收项，先到结果保留，后到进入待裁定
    const incumbent = activeFirstConclusion(this.state.conclusions, input.equipmentId, input.itemId)
    let state: ConclusionState = '有效'
    let reason = ''
    let arbitration: ArbitrationCase | null = null

    if (input.pendingConfirmation) {
      state = '待确认'
      reason = '历史数据迁移补录，授权待确认，暂不参与签署'
    } else if (!gate.ok) {
      state = '已失效'
      reason = gate.reason
    } else if (incumbent) {
      state = '待裁定'
      reason = `与先到结论 ${incumbent.id}（${incumbent.reviewer}）并发，等待裁定`
      arbitration = {
        id: `ARB-${seq}`,
        equipmentId: input.equipmentId,
        itemId: input.itemId,
        firstConclusionId: incumbent.id,
        lateConclusionId: '',
        status: '待裁定',
        decidedBy: null,
        decidedAt: null,
        note: `先到：${incumbent.reviewer} @ ${incumbent.submittedAt}；后到：${input.reviewer} @ ${at}`,
        createdAt: at
      }
    }

    const conclusion: ReviewConclusion = {
      id: `CC-${seq}`,
      equipmentId: input.equipmentId,
      itemId: input.itemId,
      reviewer: input.reviewer,
      reviewerGroup: input.reviewerGroup,
      signMode,
      authorizationId: auth?.id ?? null,
      authorizationSnapshot: authSnapshot,
      verdict: input.verdict,
      measured: input.measured,
      evidence: input.evidence,
      state,
      invalidReason: reason || null,
      invalidatedAt: state === '已失效' ? at : null,
      certSnapshot: certSnapshotsFor(equipment),
      defectRefs: defectSnapshotsFor(defects, input.equipmentId),
      arbitrationId: null,
      batchId: null,
      migratedFromLegacy: !!input.migratedFromLegacy,
      seq,
      submittedAt: at
    }
    if (arbitration) arbitration.lateConclusionId = conclusion.id

    this.append({ type: '结论提交', conclusion, arbitration }, at)
    return {
      conclusion,
      arbitration,
      accepted: state === '有效',
      reason: state === '有效' ? '结论已纳入完整性判断' : reason
    }
  }

  /** 裁定待裁定案件：采纳后到则后到转为有效、先到落选；否则维持先到 */
  decideArbitration(arbitrationId: string, adoptLate: boolean, decidedBy: string, note: string, at: string): boolean {
    const arb = this.state.arbitrations.find((a) => a.id === arbitrationId)
    if (!arb || arb.status !== '待裁定') return false
    const updated: ArbitrationCase = {
      ...arb,
      status: adoptLate ? '裁定采纳后到' : '裁定维持先到',
      decidedBy,
      decidedAt: at,
      note: `${arb.note}；裁定：${note}（${adoptLate ? '采纳后到' : '维持先到'}）`
    }
    const adoptedId = adoptLate ? arb.lateConclusionId : arb.firstConclusionId
    const rejectedId = adoptLate ? arb.firstConclusionId : arb.lateConclusionId
    this.append({ type: '仲裁裁定', arbitration: updated, adoptedConclusionId: adoptedId, rejectedConclusionId: rejectedId }, at)
    return true
  }

  /** 授权确认后，负责人确认旧结论真实：转为有效并重新冻结当前依赖快照 */
  confirmMigratedConclusion(conclusionId: string, confirmedBy: string, at: string, equipment: EquipmentNode | undefined, defects: AcceptanceDefect[]): { ok: boolean; reason: string } {
    const c = this.state.conclusions.find((x) => x.id === conclusionId)
    if (!c || c.state !== '待确认') return { ok: false, reason: '结论不存在或无需确认' }
    const auth = c.authorizationId ? this.state.authorizations.find((a) => a.id === c.authorizationId) : null
    if (!auth || auth.status !== '已确认') return { ok: false, reason: '请先确认补录授权' }
    const gate = authorizationCovers(auth, c.equipmentId, c.submittedAt)
    if (!gate.ok) return { ok: false, reason: gate.reason }
    const certSnapshot = certSnapshotsFor(equipment)
    const defectRefs = defectSnapshotsFor(defects, c.equipmentId)
    this.append({ type: '迁移结论确认', conclusionId, confirmedBy, certSnapshot, defectRefs }, at)
    return { ok: true, reason: '迁移结论已确认并纳入完整性判断' }
  }

  certificateReissued(equipmentId: string, cert: Certificate, newVersion: number, at: string) {
    const oldVersion = cert.version
    cert.version = newVersion
    cert.verified = false
    this.append({ type: '证书换版', equipmentId, certificateId: cert.id, certificateName: cert.name, oldVersion, newVersion }, at)
  }

  defectReopened(defect: AcceptanceDefect, at: string) {
    const fromStatus = defect.status
    defect.status = '整改中'
    defect.version += 1
    this.append({ type: '缺陷重开', defectId: defect.id, equipmentId: defect.equipmentId, newVersion: defect.version, fromStatus }, at)
  }

  lockBatch(input: { label: string; lockedBy: string; at: string; plantVersion: number; equipmentIds: string[] }): { batch: SigningBatch | null; reason: string } {
    // 只纳入有效且覆盖所选设备的结论；每个验收项取唯一有效结论
    const usable = this.state.conclusions.filter((c) => c.state === '有效' && input.equipmentIds.includes(c.equipmentId))
    const coveredItemKeys = new Set(usable.map((c) => `${c.equipmentId}/${c.itemId}`))
    if (usable.length === 0 || coveredItemKeys.size === 0) return { batch: null, reason: '没有可纳入锁定的有效结论' }

    const seq = this.nextSeq()
    const certSnapshot = new Map<string, ReviewConclusion['certSnapshot'][number]>()
    const defectSnapshot = new Map<string, DefectSnapshot>()
    for (const c of usable) {
      c.certSnapshot.forEach((s) => certSnapshot.set(s.id, s))
      c.defectRefs.forEach((s) => defectSnapshot.set(s.defectId, s))
    }
    const authIds = [...new Set(usable.map((c) => c.authorizationId).filter((x): x is string => !!x))]
    const batch: SigningBatch = {
      id: `SB-${seq}`,
      label: input.label,
      lockedAt: input.at,
      lockedBy: input.lockedBy,
      plantVersion: input.plantVersion,
      equipmentIds: [...input.equipmentIds],
      conclusionIds: usable.map((c) => c.id),
      authIds,
      certSnapshot: [...certSnapshot.values()],
      defectSnapshot: [...defectSnapshot.values()],
      state: '已锁定',
      invalidReason: null,
      invalidatedAt: null
    }
    this.append({ type: '签署批次锁定', batch }, input.at)
    return { batch, reason: '' }
  }
}
