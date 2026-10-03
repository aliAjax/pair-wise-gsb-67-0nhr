<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import MultiSelect from 'primevue/multiselect'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import Textarea from 'primevue/textarea'
import { useToast } from 'primevue/usetoast'
import { useAcceptanceStore } from '../stores/acceptance'
import type { ArbitrationCase, ReviewConclusion } from '../types/domain'

const store = useAcceptanceStore()
const toast = useToast()

const equipmentOptions = computed(() => store.equipment.map((e) => ({ label: `${e.name}（${e.code}）`, value: e.id })))
function equipmentName(id: string) { return store.equipment.find((e) => e.id === id)?.name ?? id }
function itemName(id: string) {
  for (const e of store.equipment) { const hit = e.items.find((i) => i.id === id); if (hit) return hit.standard }
  return id
}
function fmt(t: string) { return t.replace('T', ' ').slice(0, 16) }

// ---------- 授权 ----------
const grantVisible = ref(false)
const grant = reactive({ group: '继保专业组', member: '', scope: [] as string[], startTime: '2026-10-03T08:00', endTime: '2026-10-03T20:00', note: '' })
const groups = ['继保专业组', '一次设备专业组', '通信自动化组', '效率测试组']
function submitGrant() {
  if (!grant.member.trim() || grant.scope.length === 0) { toast.add({ severity: 'error', summary: '请填写被授权人并勾选适用设备', life: 2600 }); return }
  const result = store.grantAuthorization({
    group: grant.group, member: grant.member, scopeEquipmentIds: grant.scope,
    startTime: grant.startTime, endTime: grant.endTime, note: grant.note
  })
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 2800 })
  if (result.ok) grantVisible.value = false
}
function authTagSeverity(status: string) {
  return { 生效中: 'success', 待确认: 'warn', 已确认: 'success', 已过期: 'secondary', 已撤销: 'danger' }[status] ?? 'secondary'
}

// ---------- 迁移 ----------
function migrate() {
  const result = store.migrateLegacy()
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3600 })
}
function confirmAuth(id: string) {
  const result = store.confirmMigrationAuth(id)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3000 })
}
function confirmConclusion(id: string) {
  const result = store.confirmLegacyConclusion(id)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3200 })
}
const pendingAuths = computed(() => store.authorizations.filter((a) => a.status === '待确认'))
const pendingLegacy = computed(() => store.conclusions.filter((c) => c.migratedFromLegacy))

// ---------- 待裁定 ----------
const arbTarget = ref<ArbitrationCase | null>(null)
const arbNote = ref('')
const arbVisible = computed({
  get: () => !!arbTarget.value,
  set: (v: boolean) => { if (!v) arbTarget.value = null }
})
function openArb(arb: ArbitrationCase) { arbTarget.value = arb; arbNote.value = '' }
function rule(adoptLate: boolean) {
  if (!arbTarget.value) return
  const result = store.decideArbitration(arbTarget.value.id, adoptLate, arbNote.value)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3000 })
  if (result.ok) arbTarget.value = null
}
function conclusionById(id: string | null): ReviewConclusion | undefined {
  return store.conclusions.find((c) => c.id === id)
}
function conclusionSeverity(state: string) {
  return { 有效: 'success', 待确认: 'warn', 待裁定: 'warn', 裁定胜出: 'success', 裁定落选: 'secondary', 已失效: 'danger' }[state] ?? 'secondary'
}
</script>

<template>
  <section class="page">
    <div v-if="store.lastRecovery" class="recovery-banner"><i class="pi pi-info-circle"></i><span>{{ store.lastRecovery }}（旧数据与授权记录保留可查）</span></div>

    <div class="section-head"><div><h2>责任链与授权台账</h2><p>复核结论记录复核人、授权时段与适用设备；代理签署只在该范围内参与完整性判断。</p></div></div>

    <div class="chain-grid">
      <div class="ledger-card">
        <div class="card-head"><h3>旧数据迁移</h3><Tag :value="store.conclusions.some((c) => c.migratedFromLegacy) ? '已迁移' : '未迁移'" :severity="store.conclusions.some((c) => c.migratedFromLegacy) ? 'info' : 'warn'" /></div>
        <p class="muted">旧系统只留下签署人姓名。迁移会为专业组补出<b>待确认授权</b>，旧签署转为「待确认」结论，<b>不能直接参与签署</b>。</p>
        <Button label="迁移旧签署记录" size="small" outlined :disabled="store.conclusions.some((c) => c.migratedFromLegacy)" @click="migrate" />
        <ul v-if="pendingLegacy.length" class="pending-list">
          <li v-for="c in pendingLegacy" :key="c.id">
            <div><strong>{{ c.reviewer }}</strong><span>{{ equipmentName(c.equipmentId) }} · {{ itemName(c.itemId) }}</span><small>补录授权：{{ c.authorizationId }}</small></div>
            <Tag :value="c.state" :severity="conclusionSeverity(c.state)" />
            <Button v-if="c.state === '待确认'" label="确认结论" size="small" @click="confirmConclusion(c.id)" />
          </li>
        </ul>
        <div v-if="pendingAuths.length" class="auth-confirm">
          <p v-for="a in pendingAuths" :key="a.id">
            <Tag value="待确认" severity="warn" />
            <span>{{ a.group }} · {{ a.member }} 授权时段 {{ fmt(a.startTime) }}~{{ fmt(a.endTime) }}，{{ a.scopeEquipmentIds.length }} 台设备</span>
            <Button label="核实授权" size="small" text @click="confirmAuth(a.id)" />
          </p>
        </div>
      </div>

      <div class="ledger-card">
        <div class="card-head"><h3>临时授权</h3><Button label="授权专业组代签" size="small" @click="grantVisible = true" /></div>
        <DataTable :value="store.authorizations" size="small" dataKey="id">
          <Column field="member" header="被授权人" style="min-width:90px" />
          <Column field="group" header="专业组" />
          <Column header="适用设备"><template #body="{ data }">{{ data.scopeEquipmentIds.map(equipmentName).join('、') }}</template></Column>
          <Column header="授权时段"><template #body="{ data }">{{ fmt(data.startTime) }}<br />~ {{ fmt(data.endTime) }}</template></Column>
          <Column header="来源/状态"><template #body="{ data }"><Tag :value="store.authLiveState(data)" :severity="authTagSeverity(store.authLiveState(data))" /><small class="src">{{ data.source }}</small></template></Column>
        </DataTable>
      </div>
    </div>

    <div class="ledger-card" style="margin-top:14px">
      <div class="card-head"><h3>并发提交待裁定</h3><Tag :value="`${store.arbitrations.filter((a) => a.status === '待裁定').length} 起待裁定`" severity="warn" /></div>
      <p class="muted">两名复核人同时提交同一验收项：先到结果保留，后到内容进入待裁定，由验收负责人裁定采纳哪一笔。</p>
      <DataTable :value="store.arbitrations" size="small" dataKey="id">
        <Column header="验收项"><template #body="{ data }">{{ equipmentName(data.equipmentId) }} · {{ itemName(data.itemId) }}</template></Column>
        <Column header="先到（保留）"><template #body="{ data }"><b>{{ conclusionById(data.firstConclusionId)?.reviewer }}</b> · {{ conclusionById(data.firstConclusionId)?.verdict }}<br /><small>{{ fmt(conclusionById(data.firstConclusionId)?.submittedAt ?? '') }}</small></template></Column>
        <Column header="后到（待裁定）"><template #body="{ data }">{{ conclusionById(data.lateConclusionId)?.reviewer }} · {{ conclusionById(data.lateConclusionId)?.verdict }}<br /><small>{{ fmt(conclusionById(data.lateConclusionId)?.submittedAt ?? '') }}</small></template></Column>
        <Column header="状态"><template #body="{ data }"><Tag :value="data.status" :severity="data.status === '待裁定' ? 'warn' : 'info'" /></template></Column>
        <Column header=""><template #body="{ data }"><Button v-if="data.status === '待裁定'" label="裁定" size="small" @click="openArb(data)" /></template></Column>
      </DataTable>
    </div>

    <div class="ledger-card" style="margin-top:14px">
      <div class="card-head"><h3>复核结论责任链</h3><span class="muted">证书换版 / 缺陷重开后，依赖它们的结论与签署批次立即失效</span></div>
      <DataTable :value="store.conclusions" size="small" dataKey="id" :paginator="store.conclusions.length > 8" :rows="8">
        <Column field="id" header="链编号" style="width:80px" />
        <Column header="设备 / 验收项"><template #body="{ data }">{{ equipmentName(data.equipmentId) }}<br /><small>{{ itemName(data.itemId) }}</small></template></Column>
        <Column header="复核人"><template #body="{ data }"><b>{{ data.reviewer }}</b><br /><small>{{ data.reviewerGroup }}</small></template></Column>
        <Column header="签署方式"><template #body="{ data }"><Tag :value="data.signMode" :severity="data.signMode === '代理签署' ? 'warn' : 'secondary'" /><div v-if="data.authorizationSnapshot" class="auth-snap"><small>授权人 {{ data.authorizationSnapshot.granter }}</small><small>{{ fmt(data.authorizationSnapshot.startTime) }}~{{ fmt(data.authorizationSnapshot.endTime) }}</small><small>设备 {{ data.authorizationSnapshot.scopeEquipmentIds.map(equipmentName).join('、') }}</small></div></template></Column>
        <Column field="verdict" header="结论" />
        <Column header="依赖快照"><template #body="{ data }"><small>证书 {{ data.certSnapshot.map((c: any) => `${c.name.slice(0, 6)}V${c.version}`).join('、') || '无' }}</small><small>缺陷 {{ data.defectRefs.map((d: any) => `${d.defectId.slice(-2)}V${d.version}`).join('、') || '无' }}</small></template></Column>
        <Column header="批次"><template #body="{ data }">{{ data.batchId ?? '—' }}</template></Column>
        <Column header="状态"><template #body="{ data }"><Tag :value="data.state" :severity="conclusionSeverity(data.state)" /><small v-if="data.invalidReason" class="reason">{{ data.invalidReason }}</small></template></Column>
        <Column field="submittedAt" header="提交时间"><template #body="{ data }">{{ fmt(data.submittedAt) }}</template></Column>
      </DataTable>
    </div>

    <Dialog v-model:visible="grantVisible" header="临时授权专业组代签" modal :style="{ width: '600px' }">
      <div class="edit-grid">
        <label>专业组<Select v-model="grant.group" :options="groups" /></label>
        <label>被授权人<InputText v-model="grant.member" placeholder="专业组成员姓名" /></label>
        <label>开始时间<InputText v-model="grant.startTime" type="datetime-local" /></label>
        <label>结束时间<InputText v-model="grant.endTime" type="datetime-local" /></label>
        <label class="full">适用设备（代理签署只在这些设备内有效）<MultiSelect v-model="grant.scope" :options="equipmentOptions" optionLabel="label" optionValue="value" display="chip" filter /></label>
        <label class="full">授权说明<Textarea v-model="grant.note" rows="2" placeholder="如：负责人外出，授权继保组代签并网点保护定值复核" /></label>
      </div>
      <template #footer><Button label="取消" severity="secondary" text @click="grantVisible = false" /><Button label="授予" @click="submitGrant" /></template>
    </Dialog>

    <Dialog v-model:visible="arbVisible" header="并发提交裁定" modal :style="{ width: '560px' }">
      <div v-if="arbTarget" class="arb-box">
        <div class="arb-side"><span>先到 · 保留中</span><b>{{ conclusionById(arbTarget.firstConclusionId)?.reviewer }}</b><p>{{ conclusionById(arbTarget.firstConclusionId)?.verdict }}｜{{ conclusionById(arbTarget.firstConclusionId)?.measured }}</p></div>
        <div class="arb-side late"><span>后到 · 待裁定</span><b>{{ conclusionById(arbTarget.lateConclusionId)?.reviewer }}</b><p>{{ conclusionById(arbTarget.lateConclusionId)?.verdict }}｜{{ conclusionById(arbTarget.lateConclusionId)?.measured }}</p></div>
      </div>
      <div class="edit-grid" style="margin-top:12px"><label class="full">裁定意见<Textarea v-model="arbNote" rows="2" placeholder="说明采纳依据" /></label></div>
      <template #footer>
        <Button label="维持先到" severity="secondary" outlined @click="rule(false)" />
        <Button label="采纳后到" @click="rule(true)" />
      </template>
    </Dialog>
  </section>
</template>
