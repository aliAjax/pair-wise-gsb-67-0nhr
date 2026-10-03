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

export type AuthorizationStatus = '生效中' | '已撤销' | '待确认'

export interface Authorization {
  id: string
  delegator: string
  delegate: string
  equipmentIds: string[]
  validFrom: string
  validTo: string
  status: AuthorizationStatus
  source: '登记' | '迁移'
  createdAt: string
}

export type ConclusionStatus = '有效' | '待裁定' | '已失效' | '已驳回' | '已替换'

export interface Conclusion {
  id: string
  equipmentId: string
  itemId: string
  result: InspectionStatus
  measured: string
  evidence: string
  reviewer: string
  authorizationId: string | null
  authWindow: { validFrom: string; validTo: string } | null
  authEquipmentIds: string[]
  certDeps: Array<{ certificateId: string; version: number }>
  defectDeps: Array<{ defectId: string; version: number }>
  status: ConclusionStatus
  source: '复核' | '迁移'
  submittedAt: string
}

export interface SignBatch {
  id: string
  batchNo: string
  signer: string
  conclusionIds: string[]
  status: '有效' | '已失效'
  invalidatedReason: string
  createdAt: string
}

export type ChainKind = '授权' | '结论' | '裁定' | '证书换版' | '缺陷重开' | '签署批次' | '迁移'

export interface ChainEntry {
  id: string
  seq: number
  kind: ChainKind
  entityId: string
  actor: string
  summary: string
  prevId: string | null
  createdAt: string
}
