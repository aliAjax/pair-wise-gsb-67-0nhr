<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
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

const grantVisible = ref(false)
const grant = reactive({ delegate: '', equipmentIds: [] as string[], validFrom: '', validTo: '' })
const equipmentOptions = computed(() => store.equipment.map((item) => ({ label: `${item.name}（${item.id}）`, value: item.id })))
function submitGrant() {
  const result = store.grantAuthorization(grant.delegate, grant.equipmentIds, grant.validFrom, grant.validTo)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3000 })
  if (result.ok) { grantVisible.value = false; grant.delegate = ''; grant.equipmentIds = []; grant.validFrom = ''; grant.validTo = '' }
}
function confirmAuth(id: string) {
  const result = store.confirmAuthorization(id)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3000 })
}
function revokeAuth(id: string) {
  const result = store.revokeAuthorization(id)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3000 })
}
const authSeverity = (status: string) => status === '生效中' ? 'success' : status === '待确认' ? 'warn' : status === '已过期' ? 'danger' : 'secondary'

const pendingRows = computed(() => store.pendingConclusions.map((item) => ({ ...item, current: store.effectiveConclusion(item.itemId) })))
function adjudicate(id: string, accept: boolean) {
  const result = store.adjudicateConclusion(id, accept)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3000 })
}
const chainSeverity = (kind: string) => kind === '签署批次' ? 'success' : kind === '缺陷重开' || kind === '证书换版' ? 'danger' : kind === '裁定' ? 'warn' : 'info'

const chainRows = computed(() => [...store.chain].reverse())
</script>

<template>
  <section class="page">
    <div class="section-head">
      <div><h2>授权与责任链</h2><p>设备、验收项、证书、缺陷与签署批次按责任链追溯；代理签署仅在授权时段与适用设备内计入完整性。</p></div>
      <Button label="登记代签授权" @click="grantVisible = true" />
    </div>

    <div class="panel">
      <div class="panel-head"><h3>代签授权</h3><span>过期、撤销与待确认的授权不参与签署，但保留可查</span></div>
      <DataTable :value="store.authorizations" dataKey="id" size="small">
        <Column field="id" header="授权编号" />
        <Column field="delegator" header="授权人" />
        <Column field="delegate" header="代签人" />
        <Column header="适用设备"><template #body="{ data }">{{ data.equipmentIds.join('、') }}</template></Column>
        <Column header="授权时段"><template #body="{ data }">{{ data.validFrom }} 至 {{ data.validTo }}</template></Column>
        <Column header="状态"><template #body="{ data }"><Tag :value="store.authDisplayStatus(data)" :severity="authSeverity(store.authDisplayStatus(data))" /></template></Column>
        <Column field="source" header="来源" />
        <Column header="操作">
          <template #body="{ data }">
            <Button v-if="data.status === '待确认'" label="确认" text @click="confirmAuth(data.id)" />
            <Button v-if="data.status === '生效中'" label="撤销" text severity="danger" @click="revokeAuth(data.id)" />
          </template>
        </Column>
      </DataTable>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>待裁定结论</h3><span>同一验收项两人同时提交时，先到结果保留，后到内容在此待裁定</span></div>
      <DataTable v-if="pendingRows.length" :value="pendingRows" dataKey="id" size="small">
        <Column field="itemId" header="验收项" />
        <Column header="先到结论（保留中）"><template #body="{ data }">{{ data.current ? `${data.current.reviewer} · ${data.current.result} · ${data.current.measured || '无实测'}` : '—' }}</template></Column>
        <Column header="后到提交（待裁定）"><template #body="{ data }">{{ data.reviewer }} · {{ data.result }} · {{ data.measured || '无实测' }}</template></Column>
        <Column header="提交时间"><template #body="{ data }">{{ data.submittedAt.replace('T', ' ').slice(0, 16) }}</template></Column>
        <Column header="操作">
          <template #body="{ data }">
            <Button label="采用后到" text @click="adjudicate(data.id, true)" />
            <Button label="驳回" text severity="danger" @click="adjudicate(data.id, false)" />
          </template>
        </Column>
      </DataTable>
      <p v-else class="empty-note">当前没有待裁定的结论。</p>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>签署批次</h3><span>证书换版或缺陷重开后，依赖的批次立即失效</span></div>
      <DataTable :value="store.signBatches" dataKey="id" size="small">
        <Column field="batchNo" header="批次" />
        <Column field="signer" header="签署人" />
        <Column header="锁定结论"><template #body="{ data }">{{ data.conclusionIds.length }}条</template></Column>
        <Column header="状态"><template #body="{ data }"><Tag :value="data.status" :severity="data.status === '有效' ? 'success' : 'danger'" /></template></Column>
        <Column header="失效原因"><template #body="{ data }">{{ data.invalidatedReason || '—' }}</template></Column>
        <Column header="签署时间"><template #body="{ data }">{{ data.createdAt.replace('T', ' ').slice(0, 16) }}</template></Column>
      </DataTable>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>责任链</h3><span>保存中断后从最后一笔完整记录继续，历史记录不删除</span></div>
      <DataTable :value="chainRows" dataKey="id" size="small" paginator :rows="10">
        <Column field="seq" header="序号" style="width:70px" />
        <Column header="类型"><template #body="{ data }"><Tag :value="data.kind" :severity="chainSeverity(data.kind)" /></template></Column>
        <Column field="entityId" header="实体" />
        <Column field="actor" header="操作人" />
        <Column field="summary" header="摘要" />
        <Column header="时间"><template #body="{ data }">{{ data.createdAt.replace('T', ' ').slice(0, 16) }}</template></Column>
      </DataTable>
    </div>

    <Dialog v-model:visible="grantVisible" header="登记代签授权" modal :style="{ width: '560px' }">
      <div class="edit-grid">
        <label>代签人<InputText v-model="grant.delegate" placeholder="专业组代签人姓名" /></label>
        <label>适用设备<MultiSelect v-model="grant.equipmentIds" :options="equipmentOptions" optionLabel="label" optionValue="value" placeholder="选择授权覆盖的设备" /></label>
        <label>授权起始<input v-model="grant.validFrom" type="date" class="date-input" /></label>
        <label>授权截止<input v-model="grant.validTo" type="date" class="date-input" /></label>
      </div>
      <template #footer><Button label="取消" text severity="secondary" @click="grantVisible = false" /><Button label="登记并生效" @click="submitGrant" /></template>
    </Dialog>
  </section>
</template>
