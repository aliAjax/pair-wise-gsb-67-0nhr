<script setup lang="ts">
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import MultiSelect from 'primevue/multiselect'
import Tag from 'primevue/tag'
import { useToast } from 'primevue/usetoast'
import { useAcceptanceStore } from '../stores/acceptance'

const store = useAcceptanceStore()
const toast = useToast()
const keyword = ref('')
const rows = computed(() => store.audit.filter((item) => !keyword.value || `${item.entityId} ${item.action} ${item.operator} ${item.detail}`.includes(keyword.value)))

const lockVisible = ref(false)
const batch = ref({ label: '', scope: [] as string[] })
const equipmentOptions = computed(() => store.equipment.map((e) => ({ label: `${e.name}（${e.code}）`, value: e.id })))
function equipmentName(id: string) { return store.equipment.find((e) => e.id === id)?.name ?? id }

function openLock() {
  batch.value = { label: `并网签署批次 ${new Date().toISOString().slice(0, 10)}`, scope: store.equipment.map((e) => e.id) }
  lockVisible.value = true
}
function confirmLock() {
  if (!batch.value.scope.length) { toast.add({ severity: 'error', summary: '请选择签署设备范围', life: 2600 }); return }
  const result = store.lockBatch(batch.value.label, batch.value.scope)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.ok ? '批次已锁定' : '完整性校验未通过', detail: result.message, life: 4200 })
  if (result.ok) lockVisible.value = false
}
const exportPackage = () => {
  const payload = { plant: store.plant, equipment: store.equipment, defects: store.defects, audit: store.audit, preflight: store.preflight, batches: store.batches, conclusions: store.conclusions, authorizations: store.authorizations }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = '光伏并网验收交付包.json'; anchor.click(); URL.revokeObjectURL(url)
}
function fmt(t: string) { return t.replace('T', ' ').slice(0, 16) }
</script>

<template>
  <section class="page">
    <div class="preflight-panel">
      <div><span>并网前完整性校验（仅统计有效责任链结论）</span><strong>{{ store.preflight.allowed ? '全部条件满足' : `${store.preflight.blocking.length}项阻断` }}</strong><p v-for="item in store.preflight.blocking" :key="item">{{ item }}</p></div>
      <div><Button label="导出交付包" outlined @click="exportPackage" /><Button label="签署批次并锁定版本" @click="openLock" /></div>
    </div>

    <div class="ledger-card" style="margin-bottom:16px">
      <div class="card-head"><h2>签署批次</h2><span class="muted">批次只纳入有效结论；证书换版或缺陷重开后批次立即失效、解锁重签</span></div>
      <DataTable :value="store.batches" size="small" dataKey="id">
        <Column field="id" header="批次号" style="width:90px" />
        <Column field="label" header="名称" />
        <Column field="lockedBy" header="锁定人" />
        <Column header="范围设备"><template #body="{ data }">{{ data.equipmentIds.map(equipmentName).join('、') }}</template></Column>
        <Column header="纳入结论/授权"><template #body="{ data }">{{ data.conclusionIds.length }} 条结论 · {{ data.authIds.length }} 张代理授权</template></Column>
        <Column field="plantVersion" header="版本"><template #body="{ data }">V{{ data.plantVersion }}</template></Column>
        <Column field="lockedAt" header="锁定时间"><template #body="{ data }">{{ fmt(data.lockedAt) }}</template></Column>
        <Column header="状态"><template #body="{ data }"><Tag :value="data.state" :severity="data.state === '已锁定' ? 'success' : 'danger'" /><small v-if="data.invalidReason" class="reason">{{ data.invalidReason }} · {{ data.invalidatedAt ? fmt(data.invalidatedAt) : '' }}</small></template></Column>
      </DataTable>
      <p v-if="!store.batches.length" class="muted">尚未锁定任何签署批次。</p>
    </div>

    <div class="section-head"><div><h2>验收审计</h2><p>当前交付版本 V{{ store.plant.version }} · {{ store.plant.status }} · 责任链台账 {{ store.conclusions.length }} 条结论</p></div><InputText v-model="keyword" placeholder="搜索实体、动作或操作人" /></div>
    <DataTable :value="rows" dataKey="id" size="small">
      <Column field="createdAt" header="时间"><template #body="{ data }">{{ data.createdAt.replace('T', ' ').slice(0, 16) }}</template></Column>
      <Column field="entityId" header="实体" />
      <Column field="action" header="动作"><template #body="{ data }"><Tag :value="data.action" /></template></Column>
      <Column field="operator" header="操作人" />
      <Column field="detail" header="说明" />
    </DataTable>

    <Dialog v-model:visible="lockVisible" header="签署批次并锁定版本" modal :style="{ width: '560px' }">
      <div class="edit-grid">
        <label class="full">批次名称<InputText v-model="batch.label" /></label>
        <label class="full">签署设备范围（仅这些设备的有效结论纳入锁定）<MultiSelect v-model="batch.scope" :options="equipmentOptions" optionLabel="label" optionValue="value" display="chip" filter /></label>
      </div>
      <p class="muted">完整性阻断项未清零时无法锁定；批次锁定后若证书换版或缺陷重开，批次立即失效。</p>
      <template #footer><Button label="取消" severity="secondary" text @click="lockVisible = false" /><Button label="确认锁定" @click="confirmLock" /></template>
    </Dialog>
  </section>
</template>
