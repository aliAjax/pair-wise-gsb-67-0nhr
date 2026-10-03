<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import Textarea from 'primevue/textarea'
import { useToast } from 'primevue/usetoast'
import { useAcceptanceStore } from '../../stores/acceptance'
import type { AcceptanceItem, SigningAuthorization } from '../../types/domain'

const route = useRoute()
const store = useAcceptanceStore()
const toast = useToast()
const groups = ['继保专业组', '一次设备专业组', '通信自动化组', '效率测试组']
const node = computed(() => store.equipment.find((item) => item.id === route.params.id))
const visible = ref(false)
const editable = reactive({
  itemId: '',
  reviewer: '',
  reviewerGroup: groups[0],
  signMode: '本人复核' as '本人复核' | '代理签署',
  authorizationId: null as string | null,
  verdict: '合格' as '合格' | '不合格' | '待复验',
  measured: '',
  evidence: ''
})

const siblings = computed(() => {
  if (!node.value) return []
  return store.equipment.filter((value) => value.parentId === node.value!.parentId || value.id === node.value!.id)
})

const authOptions = computed(() => store.authorizations.map((auth) => ({
  label: `${auth.member}（${auth.group}）${auth.startTime.replace('T', ' ').slice(0, 16)}~${auth.endTime.replace('T', ' ').slice(0, 16)}`,
  value: auth.id
})))

function gateText(auth: SigningAuthorization | undefined | null) {
  if (editable.signMode !== '代理签署') return ''
  if (!editable.authorizationId) return '请选择授权'
  if (!auth) return '授权记录不存在'
  const gate = store.authGate(auth.id, node.value?.id ?? '', new Date().toISOString())
  return gate.ok ? `✓ ${gate.reason || '授权有效'}` : `✗ ${gate.reason}`
}
const selectedAuth = computed(() => store.authorizations.find((a) => a.id === editable.authorizationId))
const gateMessage = computed(() => gateText(selectedAuth.value))

function conclusionsOf(itemId: string) {
  return store.conclusions.filter((c) => c.equipmentId === node.value?.id && c.itemId === itemId)
}
function stateSeverity(state: string) {
  return { 有效: 'success', 待确认: 'warn', 待裁定: 'warn', 裁定胜出: 'success', 裁定落选: 'secondary', 已失效: 'danger' }[state] ?? 'secondary'
}

function openItem(item: AcceptanceItem) {
  Object.assign(editable, {
    itemId: item.id, reviewer: '', reviewerGroup: groups[0], signMode: '本人复核',
    authorizationId: null, verdict: item.status === '待检查' ? '合格' : item.status,
    measured: item.measured, evidence: item.evidence
  })
  visible.value = true
}
function save() {
  if (!node.value) return
  const result = store.submitConclusion({
    equipmentId: node.value.id,
    itemId: editable.itemId,
    reviewer: editable.reviewer,
    reviewerGroup: editable.reviewerGroup,
    verdict: editable.verdict,
    measured: editable.measured,
    evidence: editable.evidence,
    authorizationId: editable.signMode === '代理签署' ? editable.authorizationId : null
  })
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3200 })
  if (result.ok) visible.value = false
}
function reissue(certificateId: string) {
  const result = store.reissueCertificate(node.value!.id, certificateId)
  toast.add({ severity: result.ok ? 'warn' : 'error', summary: result.message, life: 3800 })
}
</script>

<template>
  <section v-if="node" class="page">
    <div class="section-head"><div><span>{{ node.id }} · {{ node.code }}</span><h2>{{ node.name }}</h2><p>{{ node.type }} · 当前状态 {{ node.status }}</p></div><Tag :value="node.status" :severity="node.status === '已验收' ? 'success' : 'warn'" /></div>
    <div class="equipment-path"><span v-for="item in siblings" :key="item.id" :class="{ active: item.id === node.id }" @click="navigateTo(`/equipment/${item.id}`)">{{ item.name }}</span></div>
    <DataTable :value="node.items" dataKey="id" size="small">
      <Column field="id" header="编号" style="width:90px" />
      <Column field="standard" header="验收标准" />
      <Column field="measured" header="实测结果" />
      <Column header="责任链结论">
        <template #body="{ data }">
          <div v-if="conclusionsOf(data.id).length" class="chain-tags">
            <Tag v-for="c in conclusionsOf(data.id)" :key="c.id" :value="`${c.reviewer}·${c.state}`" :severity="stateSeverity(c.state)" />
          </div>
          <span v-else class="muted">尚无复核结论</span>
        </template>
      </Column>
      <Column header="状态"><template #body="{ data }"><Tag :value="data.status" :severity="data.status === '合格' ? 'success' : data.status === '不合格' ? 'danger' : 'warn'" /></template></Column>
      <Column header=""><template #body="{ data }"><Button label="提交复核" text @click="openItem(data)" /></template></Column>
    </DataTable>
    <div class="certificate-panel">
      <h3>证书与测试附件</h3>
      <div v-for="certificate in node.certificates" :key="certificate.id" class="certificate-item">
        <Tag :value="certificate.verified ? '已核验' : '待核验'" :severity="certificate.verified ? 'success' : 'danger'" />
        <strong>{{ certificate.name }}</strong><span>{{ certificate.issuer }}</span><span>有效期至 {{ certificate.expiresAt }}</span>
        <small>V{{ certificate.version }}</small>
        <Button label="证书换版" size="small" severity="warning" outlined @click="reissue(certificate.id)" />
      </div>
      <p v-if="!node.certificates.length">当前设备节点暂无证书附件。</p>
      <p class="muted">换版后证书置为待核验，依赖旧版的复核结论与已锁定签署批次立即失效，需重新复核后才能签署。</p>
    </div>
    <Dialog v-model:visible="visible" header="提交复核结论（形成责任链）" modal :style="{ width: '640px' }">
      <div class="edit-grid">
        <label>复核人<InputText v-model="editable.reviewer" placeholder="姓名" /></label>
        <label>所属专业组<Select v-model="editable.reviewerGroup" :options="groups" /></label>
        <label>签署方式<Select v-model="editable.signMode" :options="['本人复核', '代理签署']" /></label>
        <label v-if="editable.signMode === '代理签署'">授权依据
          <Select v-model="editable.authorizationId" :options="authOptions" optionLabel="label" optionValue="value" placeholder="选择负责人授权" />
        </label>
        <label v-if="editable.signMode === '代理签署'" class="gate-line" :class="{ bad: gateMessage.startsWith('✗'), ok: gateMessage.startsWith('✓') }">{{ gateMessage || '代理签署仅在授权时段与适用设备内有效' }}</label>
        <label>结论<Select v-model="editable.verdict" :options="['合格', '不合格', '待复验']" /></label>
        <label>实测结果<InputText v-model="editable.measured" /></label>
        <label class="full">测试证据<InputText v-model="editable.evidence" /></label>
      </div>
      <p class="muted">两名复核人同时提交同一验收项时，先到结果保留并参与完整性判断，后到内容自动进入待裁定。</p>
      <template #footer><Button label="取消" severity="secondary" text @click="visible = false" /><Button label="提交复核结论" @click="save" /></template>
    </Dialog>
  </section>
  <section v-else class="page">未找到设备节点</section>
</template>
