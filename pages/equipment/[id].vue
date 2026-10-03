<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import { useToast } from 'primevue/usetoast'
import { useAcceptanceStore } from '../../stores/acceptance'
import type { AcceptanceItem, Certificate, InspectionStatus } from '../../types/domain'

const route = useRoute()
const store = useAcceptanceStore()
const toast = useToast()
const node = computed(() => store.equipment.find((item) => item.id === route.params.id))
const nodeId = computed(() => String(route.params.id))

const visible = ref(false)
const draft = reactive({ itemId: '', result: '合格' as InspectionStatus, measured: '', evidence: '', reviewer: '陆川', authorizationId: null as string | null })
const authOptions = computed(() => [
  { label: '本人签署（验收负责人陆川）', value: null as string | null },
  ...store.usableAuthorizations(String(route.params.id)).map((item) => ({ label: `${item.delegate} 代理签署 · 授权${item.validFrom}至${item.validTo}`, value: item.id }))
])
watch(() => draft.authorizationId, (id) => {
  const auth = store.authorizations.find((item) => item.id === id)
  draft.reviewer = auth ? auth.delegate : '陆川'
})
function openItem(item: AcceptanceItem) {
  draft.itemId = item.id
  draft.result = item.status === '待检查' ? '合格' : item.status
  draft.measured = item.measured
  draft.evidence = item.evidence
  draft.authorizationId = null
  draft.reviewer = '陆川'
  visible.value = true
}
function save() {
  if (!node.value) return
  const result = store.submitConclusion(node.value.id, draft.itemId, { result: draft.result, measured: draft.measured, evidence: draft.evidence }, draft.reviewer, draft.authorizationId)
  toast.add({ severity: result.ok ? (result.pending ? 'warn' : 'success') : 'error', summary: result.message, life: 3000 })
  if (result.ok) visible.value = false
}

const renewVisible = ref(false)
const renew = reactive({ certId: '', expiresAt: '' })
function openRenew(cert: Certificate) { renew.certId = cert.id; renew.expiresAt = cert.expiresAt; renewVisible.value = true }
function saveRenew() {
  if (!node.value) return
  const result = store.renewCertificate(node.value.id, renew.certId, renew.expiresAt)
  toast.add({ severity: result.ok ? 'warn' : 'error', summary: result.message, life: 3500 })
  if (result.ok) renewVisible.value = false
}

const conclusions = computed(() => store.conclusions.filter((item) => item.equipmentId === route.params.id))
const siblings = computed(() => node.value ? store.equipment.filter((value) => value.parentId === node.value!.parentId || value.id === node.value!.id) : [])
const conclusionSeverity = (status: string) => status === '有效' ? 'success' : status === '待裁定' ? 'warn' : 'secondary'
</script>

<template>
  <section v-if="node" class="page">
    <div class="section-head"><div><span>{{ node.id }} · {{ node.code }}</span><h2>{{ node.name }}</h2><p>{{ node.type }} · 当前状态 {{ node.status }}</p></div><Tag :value="node.status" :severity="node.status === '已验收' ? 'success' : 'warn'" /></div>
    <div class="equipment-path"><span v-for="item in siblings" :key="item.id" :class="{ active: item.id === nodeId }" @click="navigateTo(`/equipment/${item.id}`)">{{ item.name }}</span></div>
    <DataTable :value="node.items" dataKey="id" size="small">
      <Column field="id" header="编号" style="width:100px" />
      <Column field="standard" header="验收标准" />
      <Column field="method" header="测试方法" />
      <Column field="condition" header="测试条件" />
      <Column field="measured" header="实测结果" />
      <Column field="evidence" header="测试证据" />
      <Column header="状态"><template #body="{ data }"><Tag :value="data.status" :severity="data.status === '合格' ? 'success' : data.status === '不合格' ? 'danger' : 'warn'" /></template></Column>
      <Column header="复核人"><template #body="{ data }">{{ store.effectiveConclusion(data.id)?.reviewer ?? '—' }}</template></Column>
      <Column header=""><template #body="{ data }"><Button label="提交结论" text @click="openItem(data)" /></template></Column>
    </DataTable>
    <div class="certificate-panel">
      <h3>证书与测试附件</h3>
      <div v-for="certificate in node.certificates" :key="certificate.id" class="certificate-item">
        <Tag :value="certificate.verified ? '已核验' : '待核验'" :severity="certificate.verified ? 'success' : 'danger'" />
        <strong>{{ certificate.name }}</strong><span>{{ certificate.issuer }}</span><span>有效期至 {{ certificate.expiresAt }}</span><small>V{{ certificate.version }}</small>
        <span class="cert-actions"><Button v-if="!certificate.verified" label="核验" text @click="store.verifyCertificate(nodeId, certificate.id)" /><Button label="换版" text severity="warn" @click="openRenew(certificate)" /></span>
      </div>
      <p v-if="!node.certificates.length">当前设备节点暂无证书附件。</p>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>结论责任链</h3><span>结论记录复核人、授权时段与适用设备；证书换版或缺陷重开后依赖结论立即失效</span></div>
      <DataTable :value="conclusions" dataKey="id" size="small">
        <Column field="itemId" header="验收项" style="width:90px" />
        <Column field="result" header="结论" style="width:90px" />
        <Column field="reviewer" header="复核人" />
        <Column header="代理授权"><template #body="{ data }">{{ data.authorizationId ? `${data.authorizationId} · ${data.authWindow.validFrom}至${data.authWindow.validTo} · 适用${data.authEquipmentIds.join('、')}` : '本人签署' }}</template></Column>
        <Column header="依赖"><template #body="{ data }">{{ [...data.certDeps.map((dep: any) => `${dep.certificateId}·V${dep.version}`), ...data.defectDeps.map((dep: any) => `${dep.defectId}·V${dep.version}`)].join('；') || '—' }}</template></Column>
        <Column header="状态"><template #body="{ data }"><Tag :value="data.status" :severity="conclusionSeverity(data.status)" /></template></Column>
        <Column header="提交时间"><template #body="{ data }">{{ data.submittedAt.replace('T', ' ').slice(0, 16) }}</template></Column>
      </DataTable>
      <p v-if="!conclusions.length" class="empty-note">当前设备节点暂无结论记录。</p>
    </div>
    <Dialog v-model:visible="visible" header="提交复核结论" modal :style="{ width: '620px' }">
      <div class="edit-grid">
        <label>签署方式<Select v-model="draft.authorizationId" :options="authOptions" optionLabel="label" optionValue="value" /></label>
        <label>复核人<InputText v-model="draft.reviewer" :disabled="!!draft.authorizationId" /></label>
        <label>结论<Select v-model="draft.result" :options="['合格', '不合格', '待复验']" /></label>
        <label>实测结果<InputText v-model="draft.measured" /></label>
        <label>测试证据<InputText v-model="draft.evidence" /></label>
      </div>
      <p class="dialog-note">同一验收项已存在有效结论时，本次提交将进入待裁定，由验收负责人裁定。</p>
      <template #footer><Button label="取消" severity="secondary" text @click="visible = false" /><Button label="提交结论" @click="save" /></template>
    </Dialog>
    <Dialog v-model:visible="renewVisible" header="证书换版" modal :style="{ width: '420px' }">
      <div class="edit-grid"><label>新有效期截止<input v-model="renew.expiresAt" type="date" class="date-input" /></label></div>
      <p class="dialog-note">换版后证书版本递增并转为待核验，依赖旧版证书的结论与签署批次立即失效。</p>
      <template #footer><Button label="取消" severity="secondary" text @click="renewVisible = false" /><Button label="确认换版" severity="warn" @click="saveRenew" /></template>
    </Dialog>
  </section>
  <section v-else class="page">未找到设备节点</section>
</template>
