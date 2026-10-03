import type { AcceptanceDefect, AuditEntry, Authorization, ChainEntry, Conclusion, EquipmentNode } from '../types/domain'

// 保存中断后只承认链接完整、且已随快照落笔的责任链，尾部不完整记录被隔离。
export function validateChain(entries: ChainEntry[], lastChainId: string | null) {
  const valid: ChainEntry[] = []
  for (const entry of entries) {
    const prev = valid[valid.length - 1] ?? null
    if (entry.seq !== (prev?.seq ?? 0) + 1 || entry.prevId !== (prev?.id ?? null)) break
    valid.push(entry)
  }
  let complete = valid
  const snapIndex = lastChainId ? valid.findIndex((entry) => entry.id === lastChainId) : -1
  if (lastChainId && snapIndex >= 0) complete = valid.slice(0, snapIndex + 1)
  return { complete, isolated: entries.length - complete.length }
}

// 旧数据只有姓名没有授权：补录结论，并为非负责人签署补出待确认授权，确认前不能参与签署。
export function buildLegacyMigration(input: {
  equipment: EquipmentNode[]
  defects: AcceptanceDefect[]
  audit: AuditEntry[]
  commissioningDate: string
  today: string
  lead: string
  nextId: (prefix: string) => string
}) {
  const authorizations: Authorization[] = []
  const conclusions: Conclusion[] = []
  for (const node of input.equipment) {
    for (const item of node.items) {
      if (item.status === '待检查') continue
      const record = input.audit.find((entry) => entry.entityId === node.id && entry.action.includes('更新验收项'))
      const reviewer = record?.operator?.trim() || input.lead
      let auth: Authorization | null = null
      if (reviewer !== input.lead) {
        auth = authorizations.find((entry) => entry.delegate === reviewer) ?? null
        if (!auth) {
          auth = { id: input.nextId('AUTH-MIG'), delegator: input.lead, delegate: reviewer, equipmentIds: [], validFrom: record?.createdAt?.slice(0, 10) ?? input.today, validTo: input.commissioningDate || input.today, status: '待确认', source: '迁移', createdAt: new Date().toISOString() }
          authorizations.push(auth)
        }
        if (!auth.equipmentIds.includes(node.id)) auth.equipmentIds.push(node.id)
      }
      conclusions.push({
        id: input.nextId('CON-MIG'),
        equipmentId: node.id,
        itemId: item.id,
        result: item.status,
        measured: item.measured,
        evidence: item.evidence,
        reviewer,
        authorizationId: auth?.id ?? null,
        authWindow: auth ? { validFrom: auth.validFrom, validTo: auth.validTo } : null,
        authEquipmentIds: auth ? [...auth.equipmentIds] : [],
        certDeps: node.certificates.map((cert) => ({ certificateId: cert.id, version: cert.version })),
        defectDeps: input.defects.filter((defect) => defect.itemId === item.id).map((defect) => ({ defectId: defect.id, version: defect.version })),
        status: '有效',
        source: '迁移',
        submittedAt: record?.createdAt ?? new Date().toISOString()
      })
    }
  }
  return { authorizations, conclusions }
}
