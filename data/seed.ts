import type { AcceptanceDefect, AuditEntry, Authorization, ChainEntry, Conclusion, EquipmentNode, Plant, SignBatch } from '../types/domain'

export const seedPlant: Plant = {
  id: 'PV-2609-NW', name: '西北沙岭一期 120MW光伏电站', gridPoint: '沙岭110kV升压站', capacity: '120 MWp', commissioningDate: '2026-10-08', status: '验收中', version: 7
}

export const seedEquipment: EquipmentNode[] = [
  {
    id: 'EQ-GRID', parentId: null, name: '110kV并网点', type: '并网点', code: 'GRID-110', status: '验收中',
    items: [
      { id: 'IT-G1', standard: '保护定值与调度单一致', method: '逐项比对定值单与装置报文', condition: '并网点开关合位，通信正常', status: '合格', measured: '18/18项一致', evidence: '定值核对记录.pdf', version: 2 },
      { id: 'IT-G2', standard: '故障录波可正确触发', method: '模拟保护启动', condition: '录波装置已对时', status: '待复验', measured: '触发成功，时标偏差28ms', evidence: '录波触发截图.png', version: 2 }
    ],
    certificates: [{ id: 'C-G1', name: '继电保护装置检验报告', issuer: '省电科院', expiresAt: '2027-09-20', version: 1, verified: true }]
  },
  {
    id: 'EQ-TR1', parentId: 'EQ-GRID', name: '1号主变压器', type: '变压器', code: 'TR-01', status: '验收中',
    items: [
      { id: 'IT-T1', standard: '绝缘电阻不低于出厂值70%', method: '2500V绝缘电阻表测量', condition: '绕组温度25±5℃，湿度低于80%', status: '合格', measured: '高压对地 12.8GΩ', evidence: '绝缘测试原始记录.xlsx', version: 1 },
      { id: 'IT-T2', standard: '有载调压档位与监控一致', method: '远方/就地逐档操作', condition: '变压器空载', status: '不合格', measured: '第7档监控显示第8档', evidence: '档位差异照片.jpg', version: 2 }
    ],
    certificates: [{ id: 'C-T1', name: '主变出厂试验报告', issuer: '特变电工', expiresAt: '2031-04-10', version: 1, verified: true }]
  },
  {
    id: 'EQ-AR1', parentId: 'EQ-TR1', name: '1号方阵', type: '方阵', code: 'ARRAY-01', status: '待验收',
    items: [{ id: 'IT-A1', standard: '接地连续性符合设计', method: '微欧计抽测30处', condition: '汇流箱断电', status: '待检查', measured: '', evidence: '', version: 1 }], certificates: []
  },
  {
    id: 'EQ-INV11', parentId: 'EQ-AR1', name: '1-1号逆变器', type: '逆变器', code: 'INV-1-1', status: '验收中',
    items: [
      { id: 'IT-I1', standard: '通信点表与SCADA一致', method: '逐点置数核对', condition: '调度数据网连通', status: '合格', measured: '126/126点一致', evidence: '点表核对记录.xlsx', version: 3 },
      { id: 'IT-I2', standard: '额定功率下转换效率不低于98.5%', method: '功率分析仪连续测量30分钟', condition: '辐照度≥700W/m²，功率稳定', status: '待复验', measured: '98.3%', evidence: '效率测试曲线.csv', version: 2 }
    ],
    certificates: [{ id: 'C-I1', name: '逆变器低电压穿越证书', issuer: '中国电科院', expiresAt: '2028-06-30', version: 2, verified: true }]
  },
  {
    id: 'EQ-CB111', parentId: 'EQ-INV11', name: '1-1-1汇流箱', type: '汇流箱', code: 'CB-1-1-1', status: '待验收',
    items: [{ id: 'IT-C1', standard: '组串极性及开路电压正常', method: '逐路测量并核对设计', condition: '辐照度300-800W/m²', status: '待检查', measured: '', evidence: '', version: 1 }], certificates: []
  }
]

export const seedDefects: AcceptanceDefect[] = [
  {
    id: 'AD-260929-01', equipmentId: 'EQ-TR1', itemId: 'IT-T2', title: '有载调压第7档监控档位不一致', severity: '重大', status: '整改中', owner: '设备厂家', dueDate: '2026-09-30', version: 4, decisionNote: '',
    replies: [{ party: '设备厂家', owner: '王新', content: '档位变送器输出线性偏差，已更换并重新校准。', evidence: '更换记录与校准报告.pdf', repliedAt: '2026-09-29T14:20:00' }], retests: []
  },
  {
    id: 'AD-260929-02', equipmentId: 'EQ-INV11', itemId: 'IT-I2', title: '逆变器效率低于合同保证值', severity: '一般', status: '待联合复验', owner: '设备厂家', dueDate: '2026-10-02', version: 3, decisionNote: '',
    replies: [{ party: '设备厂家', owner: '赵晶', content: '已更新控制固件，在相同测试条件下复测效率98.62%。', evidence: '固件版本记录与复测曲线.zip', repliedAt: '2026-09-29T16:05:00' }, { party: '运维单位', owner: '罗宇', content: '复测条件满足，建议联合见证。', evidence: '测试条件确认单.pdf', repliedAt: '2026-09-29T16:30:00' }],
    retests: [{ round: 1, passed: false, result: '效率98.27%，未达到98.5%', tester: '联合验收组', testedAt: '2026-09-28T17:10:00' }]
  }
]

export const seedAudit: AuditEntry[] = [
  { id: 'A-1', entityId: 'PV-2609-NW', action: '创建验收计划', operator: '陆川', detail: '建立5类设备树与18项验收要求', createdAt: '2026-09-25T08:30:00' },
  { id: 'A-2', entityId: 'AD-260929-01', action: '分派缺陷', operator: '陆川', detail: '重大缺陷分派设备厂家，限期24小时', createdAt: '2026-09-29T09:10:00' },
  { id: 'A-3', entityId: 'AD-260929-02', action: '提交复验', operator: '罗宇', detail: '第1轮复测效率未达标', createdAt: '2026-09-28T17:10:00' }
]

export const seedAuthorizations: Authorization[] = [
  { id: 'AUTH-260926-01', delegator: '陆川', delegate: '周岚', equipmentIds: ['EQ-TR1', 'EQ-AR1'], validFrom: '2026-09-26', validTo: '2026-10-01', status: '生效中', source: '登记', createdAt: '2026-09-26T09:00:00' },
  { id: 'AUTH-260928-01', delegator: '陆川', delegate: '李工', equipmentIds: ['EQ-GRID'], validFrom: '2026-09-28', validTo: '2026-10-05', status: '生效中', source: '登记', createdAt: '2026-09-28T08:30:00' },
  { id: 'AUTH-261001-01', delegator: '陆川', delegate: '罗宇', equipmentIds: ['EQ-INV11', 'EQ-CB111'], validFrom: '2026-10-01', validTo: '2026-10-10', status: '生效中', source: '登记', createdAt: '2026-10-01T09:00:00' }
]

export const seedConclusions: Conclusion[] = [
  { id: 'CON-260928-01', equipmentId: 'EQ-GRID', itemId: 'IT-G1', result: '合格', measured: '18/18项一致', evidence: '定值核对记录.pdf', reviewer: '陆川', authorizationId: null, authWindow: null, authEquipmentIds: [], certDeps: [{ certificateId: 'C-G1', version: 1 }], defectDeps: [], status: '有效', source: '复核', submittedAt: '2026-09-28T10:20:00' },
  { id: 'CON-260928-02', equipmentId: 'EQ-TR1', itemId: 'IT-T1', result: '合格', measured: '高压对地 12.8GΩ', evidence: '绝缘测试原始记录.xlsx', reviewer: '周岚', authorizationId: 'AUTH-260926-01', authWindow: { validFrom: '2026-09-26', validTo: '2026-10-01' }, authEquipmentIds: ['EQ-TR1', 'EQ-AR1'], certDeps: [{ certificateId: 'C-T1', version: 1 }], defectDeps: [], status: '有效', source: '复核', submittedAt: '2026-09-28T11:05:00' },
  { id: 'CON-260928-03', equipmentId: 'EQ-TR1', itemId: 'IT-T2', result: '不合格', measured: '第7档监控显示第8档', evidence: '档位差异照片.jpg', reviewer: '陆川', authorizationId: null, authWindow: null, authEquipmentIds: [], certDeps: [{ certificateId: 'C-T1', version: 1 }], defectDeps: [{ defectId: 'AD-260929-01', version: 4 }], status: '有效', source: '复核', submittedAt: '2026-09-28T14:40:00' },
  { id: 'CON-260928-04', equipmentId: 'EQ-INV11', itemId: 'IT-I1', result: '合格', measured: '126/126点一致', evidence: '点表核对记录.xlsx', reviewer: '陆川', authorizationId: null, authWindow: null, authEquipmentIds: [], certDeps: [{ certificateId: 'C-I1', version: 2 }], defectDeps: [], status: '有效', source: '复核', submittedAt: '2026-09-28T16:10:00' },
  { id: 'CON-260928-05', equipmentId: 'EQ-INV11', itemId: 'IT-I2', result: '不合格', measured: '98.3%', evidence: '效率测试曲线.csv', reviewer: '陆川', authorizationId: null, authWindow: null, authEquipmentIds: [], certDeps: [{ certificateId: 'C-I1', version: 2 }], defectDeps: [{ defectId: 'AD-260929-02', version: 2 }], status: '已失效', source: '复核', submittedAt: '2026-09-28T16:30:00' },
  { id: 'CON-261002-01', equipmentId: 'EQ-GRID', itemId: 'IT-G2', result: '待复验', measured: '触发成功，时标偏差28ms', evidence: '录波触发截图.png', reviewer: '李工', authorizationId: 'AUTH-260928-01', authWindow: { validFrom: '2026-09-28', validTo: '2026-10-05' }, authEquipmentIds: ['EQ-GRID'], certDeps: [{ certificateId: 'C-G1', version: 1 }], defectDeps: [], status: '有效', source: '复核', submittedAt: '2026-10-02T09:40:00' },
  { id: 'CON-261002-02', equipmentId: 'EQ-INV11', itemId: 'IT-I2', result: '待复验', measured: '98.3%', evidence: '效率测试曲线.csv', reviewer: '罗宇', authorizationId: 'AUTH-261001-01', authWindow: { validFrom: '2026-10-01', validTo: '2026-10-10' }, authEquipmentIds: ['EQ-INV11', 'EQ-CB111'], certDeps: [{ certificateId: 'C-I1', version: 2 }], defectDeps: [{ defectId: 'AD-260929-02', version: 3 }], status: '有效', source: '复核', submittedAt: '2026-10-02T10:30:00' }
]

export const seedSignBatches: SignBatch[] = [
  { id: 'SB-V6', batchNo: 'V6', signer: '验收负责人陆川', conclusionIds: ['CON-260928-01', 'CON-260928-02', 'CON-260928-03', 'CON-260928-04', 'CON-260928-05'], status: '已失效', invalidatedReason: '缺陷AD-260929-02复验未通过重开，依赖结论失效', createdAt: '2026-09-28T16:55:00' }
]

export const seedChain: ChainEntry[] = [
  { id: 'CH-0001', seq: 1, kind: '授权', entityId: 'AUTH-260926-01', actor: '陆川', summary: '授权周岚代签，适用EQ-TR1、EQ-AR1，时段2026-09-26至2026-10-01', prevId: null, createdAt: '2026-09-26T09:00:00' },
  { id: 'CH-0002', seq: 2, kind: '授权', entityId: 'AUTH-260928-01', actor: '陆川', summary: '授权李工代签，适用EQ-GRID，时段2026-09-28至2026-10-05', prevId: 'CH-0001', createdAt: '2026-09-28T08:30:00' },
  { id: 'CH-0003', seq: 3, kind: '结论', entityId: 'CON-260928-01', actor: '陆川', summary: 'IT-G1结论：合格（本人签署）', prevId: 'CH-0002', createdAt: '2026-09-28T10:20:00' },
  { id: 'CH-0004', seq: 4, kind: '结论', entityId: 'CON-260928-02', actor: '周岚', summary: 'IT-T1结论：合格（代理签署，授权AUTH-260926-01）', prevId: 'CH-0003', createdAt: '2026-09-28T11:05:00' },
  { id: 'CH-0005', seq: 5, kind: '结论', entityId: 'CON-260928-03', actor: '陆川', summary: 'IT-T2结论：不合格（本人签署）', prevId: 'CH-0004', createdAt: '2026-09-28T14:40:00' },
  { id: 'CH-0006', seq: 6, kind: '结论', entityId: 'CON-260928-04', actor: '陆川', summary: 'IT-I1结论：合格（本人签署）', prevId: 'CH-0005', createdAt: '2026-09-28T16:10:00' },
  { id: 'CH-0007', seq: 7, kind: '结论', entityId: 'CON-260928-05', actor: '陆川', summary: 'IT-I2结论：不合格（本人签署）', prevId: 'CH-0006', createdAt: '2026-09-28T16:30:00' },
  { id: 'CH-0008', seq: 8, kind: '签署批次', entityId: 'SB-V6', actor: '陆川', summary: '签署批次V6，锁定5条结论', prevId: 'CH-0007', createdAt: '2026-09-28T16:55:00' },
  { id: 'CH-0009', seq: 9, kind: '缺陷重开', entityId: 'AD-260929-02', actor: '联合验收组', summary: '第1轮复验未通过，缺陷重开；结论CON-260928-05与批次V6失效', prevId: 'CH-0008', createdAt: '2026-09-28T17:10:00' },
  { id: 'CH-0010', seq: 10, kind: '授权', entityId: 'AUTH-261001-01', actor: '陆川', summary: '授权罗宇代签，适用EQ-INV11、EQ-CB111，时段2026-10-01至2026-10-10', prevId: 'CH-0009', createdAt: '2026-10-01T09:00:00' },
  { id: 'CH-0011', seq: 11, kind: '结论', entityId: 'CON-261002-01', actor: '李工', summary: 'IT-G2结论：待复验（代理签署，授权AUTH-260928-01）', prevId: 'CH-0010', createdAt: '2026-10-02T09:40:00' },
  { id: 'CH-0012', seq: 12, kind: '结论', entityId: 'CON-261002-02', actor: '罗宇', summary: 'IT-I2结论：待复验（代理签署，授权AUTH-261001-01）', prevId: 'CH-0011', createdAt: '2026-10-02T10:30:00' }
]
