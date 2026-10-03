export type InspectionStatus = '待检查' | '合格' | '不合格' | '待复验'
export type DefectStatus = '待分派' | '整改中' | '待联合复验' | '已关闭' | '带条件通过'
export type Party = '建设单位' | '设备厂家' | '运维单位'

export interface AcceptanceItem {
  id: string
  standard: string
  method: string
  condition: string
  status: InspectionStatus
  measured: string
  evidence: string
  version: number
}

export interface Certificate {
  id: string
  name: string
  issuer: string
  expiresAt: string
  version: number
  verified: boolean
}

export interface EquipmentNode {
  id: string
  parentId: string | null
  name: string
  type: '并网点' | '变压器' | '方阵' | '逆变器' | '汇流箱'
  code: string
  status: '待验收' | '验收中' | '已验收'
  items: AcceptanceItem[]
  certificates: Certificate[]
}

export interface PartyReply {
  party: Party
  owner: string
  content: string
  evidence: string
  repliedAt: string
}

export interface AcceptanceDefect {
  id: string
  equipmentId: string
  itemId: string
  title: string
  severity: '一般' | '重大'
  status: DefectStatus
  owner: string
  dueDate: string
  replies: PartyReply[]
  retests: Array<{ round: number; passed: boolean; result: string; tester: string; testedAt: string }>
  decisionNote: string
  version: number
}

export interface Plant {
  id: string
  name: string
  gridPoint: string
  capacity: string
  commissioningDate: string
  status: '验收中' | '待复核' | '已签署'
  version: number
}

export interface AuditEntry {
  id: string
  entityId: string
  action: string
  operator: string
  detail: string
  createdAt: string
}

// ====== 可追溯责任链 ======

export type AuthorizationStatus = '生效中' | '待确认' | '已确认' | '已过期' | '已撤销'
export type AuthSource = '正式授权' | '历史迁移补录'
export type SignMode = '本人复核' | '代理签署'
export type ConclusionVerdict = '合格' | '不合格' | '待复验'
export type ConclusionState = '有效' | '待确认' | '待裁定' | '裁定胜出' | '裁定落选' | '已失效'
export type BatchState = '已锁定' | '已失效'

/** 并网验收负责人对专业组的临时授权 */
export interface SigningAuthorization {
  id: string
  granter: string
  group: string
  member: string
  scopeEquipmentIds: string[]
  startTime: string
  endTime: string
  status: AuthorizationStatus
  source: AuthSource
  note: string
  createdAt: string
  confirmedAt: string | null
  revokedAt: string | null
}

export interface CertSnapshot {
  id: string
  name: string
  version: number
  verified: boolean
}

export interface DefectSnapshot {
  defectId: string
  version: number
  status: DefectStatus
}

/** 复核结论：责任链的核心载体 */
export interface ReviewConclusion {
  id: string
  equipmentId: string
  itemId: string
  reviewer: string
  reviewerGroup: string
  signMode: SignMode
  authorizationId: string | null
  /** 代理签署时冻结的授权快照，授权事后过期/撤销不影响记录可查 */
  authorizationSnapshot: Pick<SigningAuthorization, 'id' | 'granter' | 'group' | 'member' | 'scopeEquipmentIds' | 'startTime' | 'endTime' | 'source'> | null
  verdict: ConclusionVerdict
  measured: string
  evidence: string
  state: ConclusionState
  invalidReason: string | null
  invalidatedAt: string | null
  certSnapshot: CertSnapshot[]
  defectRefs: DefectSnapshot[]
  arbitrationId: string | null
  batchId: string | null
  migratedFromLegacy: boolean
  seq: number
  submittedAt: string
}

export interface ArbitrationCase {
  id: string
  equipmentId: string
  itemId: string
  firstConclusionId: string
  lateConclusionId: string
  status: '待裁定' | '裁定采纳后到' | '裁定维持先到'
  decidedBy: string | null
  decidedAt: string | null
  note: string
  createdAt: string
}

/** 签署批次：锁版单元 */
export interface SigningBatch {
  id: string
  label: string
  lockedAt: string
  lockedBy: string
  plantVersion: number
  equipmentIds: string[]
  conclusionIds: string[]
  authIds: string[]
  certSnapshot: CertSnapshot[]
  defectSnapshot: DefectSnapshot[]
  state: BatchState
  invalidReason: string | null
  invalidatedAt: string | null
}

export type ChainEvent =
  | { type: '授权创建'; authorization: SigningAuthorization }
  | { type: '授权确认'; authorization: SigningAuthorization }
  | { type: '授权撤销'; authorization: SigningAuthorization }
  | { type: '结论提交'; conclusion: ReviewConclusion; arbitration: ArbitrationCase | null }
  | { type: '仲裁裁定'; arbitration: ArbitrationCase; adoptedConclusionId: string; rejectedConclusionId: string }
  | { type: '证书换版'; equipmentId: string; certificateId: string; certificateName: string; oldVersion: number; newVersion: number }
  | { type: '缺陷重开'; defectId: string; equipmentId: string; newVersion: number; fromStatus: DefectStatus }
  | { type: '签署批次锁定'; batch: SigningBatch }
  | { type: '批次失效'; batchId: string; reason: string }
  | { type: '历史迁移'; authorizationId: string; conclusionIds: string[]; note: string }
  | { type: '迁移结论确认'; conclusionId: string; confirmedBy: string; certSnapshot: CertSnapshot[]; defectRefs: DefectSnapshot[] }

/** 一笔完整责任链的不可变台账记录 */
export interface JournalEntry {
  seq: number
  at: string
  event: ChainEvent
  checksum: string
}
