import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { seedAudit, seedAuthorizations, seedChain, seedConclusions, seedDefects, seedEquipment, seedPlant, seedSignBatches } from '../data/seed'
import { buildLegacyMigration, validateChain } from '../services/chain'
import type { AcceptanceDefect, AuditEntry, Authorization, ChainEntry, ChainKind, Conclusion, EquipmentNode, InspectionStatus, PartyReply, Plant, SignBatch } from '../types/domain'

const STORAGE_KEY = 'gsb67:grid-acceptance'
const CHAIN_KEY = 'gsb67:grid-acceptance-chain'
const LEAD = '陆川'
let idSeed = 30

const todayStr = () => new Date().toLocaleDateString('sv')

export const useAcceptanceStore = defineStore('acceptance', () => {
  const plant = ref<Plant>(structuredClone(seedPlant))
  const equipment = ref<EquipmentNode[]>(structuredClone(seedEquipment))
  const defects = ref<AcceptanceDefect[]>(structuredClone(seedDefects))
  const audit = ref<AuditEntry[]>(structuredClone(seedAudit))
  const authorizations = ref<Authorization[]>(structuredClone(seedAuthorizations))
  const conclusions = ref<Conclusion[]>(structuredClone(seedConclusions))
  const signBatches = ref<SignBatch[]>(structuredClone(seedSignBatches))
  const chain = ref<ChainEntry[]>(structuredClone(seedChain))
  const selectedEquipmentId = ref(equipment.value[0].id)
  const keyword = ref('')
  const hydrated = ref(false)

  const selectedEquipment = computed(() => equipment.value.find((item) => item.id === selectedEquipmentId.value))
  const pendingConclusions = computed(() => conclusions.value.filter((item) => item.status === '待裁定'))
  const pendingAuthorizations = computed(() => authorizations.value.filter((item) => item.status === '待确认'))
  const activeBatch = computed(() => signBatches.value.find((item) => item.status === '有效') ?? null)
  const stats = computed(() => {
    const items = equipment.value.flatMap((item) => item.items)
    return {
      total: items.length,
      passed: items.filter((item) => item.status === '合格').length,
      failed: items.filter((item) => item.status === '不合格' || item.status === '待复验').length,
      openDefects: defects.value.filter((item) => !['已关闭', '带条件通过'].includes(item.status)).length
    }
  })
  const preflight = computed(() => {
    const blocking: string[] = []
    const items = equipment.value.flatMap((item) => item.items)
    if (items.some((item) => item.status === '待检查')) blocking.push('仍有验收项未检查')
    if (items.some((item) => item.status === '不合格' || item.status === '待复验')) blocking.push('存在不合格或待复验项')
    if (defects.value.some((item) => !['已关闭', '带条件通过'].includes(item.status))) blocking.push('存在未闭环缺陷')
    if (equipment.value.flatMap((item) => item.certificates).some((item) => !item.verified)) blocking.push('存在未核验证书')
    const expired = equipment.value.flatMap((item) => item.certificates).some((item) => item.expiresAt < plant.value.commissioningDate)
    if (expired) blocking.push('证书在并网日期前失效')
    const effective = conclusions.value.filter((item) => item.status === '有效')
    const missing = items.filter((item) => !effective.some((conclusion) => conclusion.itemId === item.id))
    if (missing.length) blocking.push(`${missing.length}个验收项缺少有效结论`)
    if (conclusions.value.some((item) => item.status === '待裁定')) blocking.push('存在待裁定的复核结论')
    const today = todayStr()
    effective.forEach((conclusion) => {
      if (!conclusion.authorizationId) return
      const auth = authorizations.value.find((item) => item.id === conclusion.authorizationId)
      if (!auth) { blocking.push(`结论${conclusion.itemId}引用的授权不存在`); return }
      if (auth.status === '待确认') blocking.push(`授权${auth.id}（${auth.delegate}）待确认，确认前不能参与签署`)
      else if (auth.status !== '生效中') blocking.push(`授权${auth.id}（${auth.delegate}）已撤销，代理结论不计入完整性`)
      else if (today < auth.validFrom || today > auth.validTo) blocking.push(`授权${auth.id}（${auth.delegate}）已过授权时段，代理结论不计入完整性`)
      else if (!auth.equipmentIds.includes(conclusion.equipmentId)) blocking.push(`授权${auth.id}不覆盖设备${conclusion.equipmentId}`)
    })
    return { allowed: blocking.length === 0, blocking: [...new Set(blocking)] }
  })

  function hydrate() {
    if (!import.meta.client || hydrated.value) return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const stored = JSON.parse(raw)
        if (!stored.conclusions || !stored.authorizations) {
          migrateLegacy(stored)
        } else {
          plant.value = stored.plant
          equipment.value = stored.equipment
          defects.value = stored.defects
          audit.value = stored.audit
          authorizations.value = stored.authorizations
          conclusions.value = stored.conclusions
          signBatches.value = stored.signBatches ?? []
          const storedChain: ChainEntry[] = JSON.parse(localStorage.getItem(CHAIN_KEY) ?? '[]')
          chain.value = reconcileChain(storedChain, stored.lastChainId ?? null)
          if (chain.value.length !== storedChain.length) persist()
        }
      }
    } catch {
      // Seed data is kept when browser storage is corrupt.
    }
    hydrated.value = true
  }

  function persist() {
    if (!import.meta.client) return
    const lastChainId = chain.value.length ? chain.value[chain.value.length - 1].id : null
    localStorage.setItem(CHAIN_KEY, JSON.stringify(chain.value))
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ plant: plant.value, equipment: equipment.value, defects: defects.value, audit: audit.value, authorizations: authorizations.value, conclusions: conclusions.value, signBatches: signBatches.value, lastChainId }))
  }

  // 保存中断后只承认链接完整、且已随快照落笔的责任链，尾部不完整记录被隔离。
  function reconcileChain(entries: ChainEntry[], lastChainId: string | null) {
    const { complete, isolated } = validateChain(entries, lastChainId)
    if (isolated > 0) {
      log(plant.value.id, '恢复责任链', '系统', `检测到保存中断，已从最后一笔完整责任链继续（隔离${isolated}笔不完整记录）`)
    }
    return complete
  }

  // 旧数据只有姓名没有授权：补录结论，并为非负责人签署补出待确认授权，确认前不能参与签署。
  function migrateLegacy(stored: { plant: Plant; equipment: EquipmentNode[]; defects: AcceptanceDefect[]; audit: AuditEntry[] }) {
    plant.value = stored.plant
    equipment.value = stored.equipment
    defects.value = stored.defects
    audit.value = stored.audit
    signBatches.value = []
    chain.value = []
    const migrated = buildLegacyMigration({ equipment: equipment.value, defects: defects.value, audit: audit.value, commissioningDate: stored.plant.commissioningDate, today: todayStr(), lead: LEAD, nextId: (prefix) => `${prefix}-${idSeed++}` })
    authorizations.value = migrated.authorizations
    conclusions.value = migrated.conclusions
    appendChain('迁移', plant.value.id, '系统', `旧数据迁移：补录${conclusions.value.length}条结论、${authorizations.value.length}条待确认授权`)
    log(plant.value.id, '旧数据迁移', '系统', `补录${conclusions.value.length}条结论，补出${authorizations.value.length}条待确认授权，确认前不能参与签署`)
    persist()
  }

  function effectiveConclusion(itemId: string) {
    return conclusions.value.find((item) => item.itemId === itemId && item.status === '有效')
  }

  function authDisplayStatus(auth: Authorization) {
    if (auth.status === '生效中' && todayStr() > auth.validTo) return '已过期'
    return auth.status
  }

  function usableAuthorizations(equipmentId: string) {
    const today = todayStr()
    return authorizations.value.filter((item) => item.status === '生效中' && item.equipmentIds.includes(equipmentId) && item.validFrom <= today && today <= item.validTo)
  }

  function submitConclusion(equipmentId: string, itemId: string, draft: { result: InspectionStatus; measured: string; evidence: string }, reviewer: string, authorizationId: string | null) {
    const node = equipment.value.find((item) => item.id === equipmentId)
    const item = node?.items.find((value) => value.id === itemId)
    if (!node || !item) return { ok: false, pending: false, message: '验收项不存在' }
    if (!reviewer.trim()) return { ok: false, pending: false, message: '复核人不能为空' }
    let auth: Authorization | null = null
    if (authorizationId) {
      auth = authorizations.value.find((item) => item.id === authorizationId) ?? null
      if (!auth) return { ok: false, pending: false, message: '授权记录不存在' }
      if (auth.status === '待确认') return { ok: false, pending: false, message: '迁移补出的授权尚未确认，不能参与签署' }
      if (auth.status !== '生效中') return { ok: false, pending: false, message: '授权已撤销，不能参与签署' }
      const today = todayStr()
      if (today < auth.validFrom || today > auth.validTo) return { ok: false, pending: false, message: '超出授权时段，代理签署无效' }
      if (!auth.equipmentIds.includes(equipmentId)) return { ok: false, pending: false, message: '授权不覆盖该设备，代理签署无效' }
    }
    const conclusion: Conclusion = {
      id: `CON-${Date.now()}-${idSeed++}`,
      equipmentId,
      itemId,
      result: draft.result,
      measured: draft.measured,
      evidence: draft.evidence,
      reviewer: reviewer.trim(),
      authorizationId: auth?.id ?? null,
      authWindow: auth ? { validFrom: auth.validFrom, validTo: auth.validTo } : null,
      authEquipmentIds: auth ? [...auth.equipmentIds] : [],
      certDeps: node.certificates.map((cert) => ({ certificateId: cert.id, version: cert.version })),
      defectDeps: defects.value.filter((defect) => defect.itemId === itemId).map((defect) => ({ defectId: defect.id, version: defect.version })),
      status: '有效',
      source: '复核',
      submittedAt: new Date().toISOString()
    }
    const current = conclusions.value.find((item) => item.itemId === itemId && item.status === '有效')
    if (current) {
      conclusion.status = '待裁定'
      conclusions.value.unshift(conclusion)
      appendChain('结论', conclusion.id, conclusion.reviewer, `${itemId}已有${current.reviewer}的先到结论，本次提交进入待裁定`)
      log(equipmentId, '结论待裁定', conclusion.reviewer, `${itemId}后到结论进入待裁定`)
      persist()
      return { ok: true, pending: true, message: '已存在先到结论，本次提交进入待裁定' }
    }
    conclusions.value.unshift(conclusion)
    applyConclusion(conclusion)
    appendChain('结论', conclusion.id, conclusion.reviewer, `${itemId}结论：${conclusion.result}${auth ? `（${auth.delegate}代理签署，授权${auth.id}）` : '（本人签署）'}`)
    log(equipmentId, '提交复核结论', conclusion.reviewer, `${itemId}结论：${conclusion.result}`)
    persist()
    return { ok: true, pending: false, message: '结论已生效并接入责任链' }
  }

  function adjudicateConclusion(id: string, accept: boolean) {
    const pending = conclusions.value.find((item) => item.id === id && item.status === '待裁定')
    if (!pending) return { ok: false, message: '待裁定结论不存在' }
    const current = conclusions.value.find((item) => item.itemId === pending.itemId && item.status === '有效')
    if (accept) {
      if (current) current.status = '已替换'
      pending.status = '有效'
      applyConclusion(pending)
      if (current) invalidateBatchesFor([current.id], `结论${pending.itemId}经裁定替换`)
      appendChain('裁定', pending.id, LEAD, `采用${pending.reviewer}的后到结论${current ? `，替换${current.reviewer}的先到结论` : ''}`)
      log(pending.equipmentId, '裁定结论', LEAD, `${pending.itemId}采用后到结论`)
    } else {
      pending.status = '已驳回'
      appendChain('裁定', pending.id, LEAD, `驳回${pending.reviewer}的后到结论，保留${current?.reviewer ?? '无'}的先到结果`)
      log(pending.equipmentId, '裁定结论', LEAD, `${pending.itemId}驳回后到结论`)
    }
    persist()
    return { ok: true, message: accept ? '已采用后到结论并替换先到结果' : '已驳回，保留先到结果' }
  }

  function applyConclusion(conclusion: Conclusion) {
    const item = equipment.value.find((node) => node.id === conclusion.equipmentId)?.items.find((value) => value.id === conclusion.itemId)
    if (!item) return
    item.status = conclusion.result
    item.measured = conclusion.measured
    item.evidence = conclusion.evidence
    item.version += 1
  }

  function grantAuthorization(delegate: string, equipmentIds: string[], validFrom: string, validTo: string) {
    if (!delegate.trim()) return { ok: false, message: '代签人不能为空' }
    if (!equipmentIds.length) return { ok: false, message: '至少选择一台适用设备' }
    if (!validFrom || !validTo || validFrom > validTo) return { ok: false, message: '授权时段无效' }
    const auth: Authorization = { id: `AUTH-${Date.now()}-${idSeed++}`, delegator: LEAD, delegate: delegate.trim(), equipmentIds: [...equipmentIds], validFrom, validTo, status: '生效中', source: '登记', createdAt: new Date().toISOString() }
    authorizations.value.unshift(auth)
    appendChain('授权', auth.id, LEAD, `授权${auth.delegate}代签，适用${equipmentIds.join('、')}，时段${validFrom}至${validTo}`)
    log(auth.id, '登记授权', LEAD, `${auth.delegate}在${equipmentIds.length}台设备范围内代签`)
    persist()
    return { ok: true, message: '授权已登记并生效' }
  }

  function confirmAuthorization(id: string) {
    const auth = authorizations.value.find((item) => item.id === id)
    if (!auth || auth.status !== '待确认') return { ok: false, message: '仅待确认授权可确认' }
    auth.status = '生效中'
    appendChain('授权', auth.id, LEAD, `确认迁移授权，${auth.delegate}的代签授权生效`)
    log(id, '确认授权', LEAD, `${auth.delegate}的迁移授权已确认`)
    persist()
    return { ok: true, message: '授权已确认生效' }
  }

  function revokeAuthorization(id: string) {
    const auth = authorizations.value.find((item) => item.id === id)
    if (!auth || auth.status !== '生效中') return { ok: false, message: '仅生效中的授权可撤销' }
    auth.status = '已撤销'
    appendChain('授权', auth.id, LEAD, `撤销${auth.delegate}的代签授权`)
    log(id, '撤销授权', LEAD, `${auth.delegate}的授权已撤销，其代理结论不再计入完整性`)
    persist()
    return { ok: true, message: '授权已撤销' }
  }

  function renewCertificate(equipmentId: string, certificateId: string, expiresAt: string) {
    const cert = equipment.value.find((node) => node.id === equipmentId)?.certificates.find((item) => item.id === certificateId)
    if (!cert) return { ok: false, message: '证书不存在' }
    cert.version += 1
    if (expiresAt) cert.expiresAt = expiresAt
    cert.verified = false
    const affected = conclusions.value.filter((item) => item.status === '有效' && item.certDeps.some((dep) => dep.certificateId === certificateId && dep.version < cert.version))
    affected.forEach((item) => { item.status = '已失效' })
    const batches = invalidateBatchesFor(affected.map((item) => item.id), `证书${cert.name}换版至V${cert.version}`)
    appendChain('证书换版', cert.id, LEAD, `${cert.name}换版至V${cert.version}，${affected.length}条结论失效`)
    log(equipmentId, '证书换版', LEAD, `${cert.name}换版至V${cert.version}，需重新核验`)
    persist()
    return { ok: true, message: `证书已换版至V${cert.version}，${affected.length}条结论、${batches}个签署批次失效` }
  }

  function verifyCertificate(equipmentId: string, certificateId: string) {
    const cert = equipment.value.find((node) => node.id === equipmentId)?.certificates.find((item) => item.id === certificateId)
    if (!cert) return
    cert.verified = true
    log(equipmentId, '核验证书', LEAD, `${cert.name}V${cert.version}已核验`)
    persist()
  }

  function reopenDefect(id: string) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (!['已关闭', '带条件通过'].includes(defect.status)) return { ok: false, message: '仅已关闭或带条件通过的缺陷可重开' }
    defect.status = '整改中'
    defect.version += 1
    const affected = conclusions.value.filter((item) => item.status === '有效' && item.defectDeps.some((dep) => dep.defectId === id && dep.version < defect.version))
    affected.forEach((item) => { item.status = '已失效' })
    const batches = invalidateBatchesFor(affected.map((item) => item.id), `缺陷${id}重开`)
    appendChain('缺陷重开', id, LEAD, `缺陷重开，${affected.length}条结论、${batches}个签署批次失效`)
    log(id, '重开缺陷', LEAD, `缺陷重开，${affected.length}条结论失效`)
    persist()
    return { ok: true, message: `缺陷已重开，${affected.length}条结论、${batches}个签署批次失效` }
  }

  function invalidateBatchesFor(conclusionIds: string[], reason: string) {
    if (!conclusionIds.length) return 0
    let count = 0
    signBatches.value.forEach((batch) => {
      if (batch.status === '有效' && batch.conclusionIds.some((id) => conclusionIds.includes(id))) {
        batch.status = '已失效'
        batch.invalidatedReason = reason
        count += 1
      }
    })
    if (count && plant.value.status === '已签署' && !signBatches.value.some((batch) => batch.status === '有效')) {
      plant.value.status = '验收中'
      log(plant.value.id, '签署批次失效', '系统', `交付版本回退为验收中：${reason}`)
    }
    return count
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

  function signOff() {
    if (!preflight.value.allowed) return { ok: false, message: preflight.value.blocking.join('；') }
    const effective = conclusions.value.filter((item) => item.status === '有效')
    const batch: SignBatch = {
      id: `SB-${Date.now()}-${idSeed++}`,
      batchNo: `V${plant.value.version + 1}`,
      signer: `验收负责人${LEAD}`,
      conclusionIds: effective.map((item) => item.id),
      status: '有效',
      invalidatedReason: '',
      createdAt: new Date().toISOString()
    }
    signBatches.value.unshift(batch)
    plant.value.status = '已签署'
    plant.value.version += 1
    equipment.value.forEach((node) => { node.status = '已验收' })
    appendChain('签署批次', batch.id, LEAD, `签署批次${batch.batchNo}，锁定${batch.conclusionIds.length}条结论`)
    log(plant.value.id, '签署交付版本', `验收负责人${LEAD}`, `锁定${batch.batchNo}并生成交付包`)
    persist()
    return { ok: true, message: `签署完成，批次${batch.batchNo}已锁定` }
  }

  function reset() {
    plant.value = structuredClone(seedPlant)
    equipment.value = structuredClone(seedEquipment)
    defects.value = structuredClone(seedDefects)
    audit.value = structuredClone(seedAudit)
    authorizations.value = structuredClone(seedAuthorizations)
    conclusions.value = structuredClone(seedConclusions)
    signBatches.value = structuredClone(seedSignBatches)
    chain.value = structuredClone(seedChain)
    persist()
  }

  function appendChain(kind: ChainKind, entityId: string, actor: string, summary: string) {
    const prev = chain.value[chain.value.length - 1] ?? null
    const seq = (prev?.seq ?? 0) + 1
    chain.value.push({ id: `CH-${String(seq).padStart(4, '0')}`, seq, kind, entityId, actor, summary, prevId: prev?.id ?? null, createdAt: new Date().toISOString() })
  }

  function log(entityId: string, action: string, operator: string, detail: string) {
    audit.value.unshift({ id: `AUD-${Date.now()}-${idSeed++}`, entityId, action, operator, detail, createdAt: new Date().toISOString() })
  }

  return { plant, equipment, defects, audit, authorizations, conclusions, signBatches, chain, selectedEquipmentId, keyword, hydrated, selectedEquipment, pendingConclusions, pendingAuthorizations, activeBatch, stats, preflight, hydrate, effectiveConclusion, authDisplayStatus, usableAuthorizations, submitConclusion, adjudicateConclusion, grantAuthorization, confirmAuthorization, revokeAuthorization, renewCertificate, verifyCertificate, reopenDefect, assignDefect, addReply, addRetest, decideDefect, signOff, reset }
})
