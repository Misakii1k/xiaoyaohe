# Tasks

按依赖关系组织。Task 1（数据模型）与 Task 2（相互作用规则库）是前置；Task 3 在两者完成后进行。

## Task 1: 数据模型扩展

- [x] Task 1: 扩展 ReminderRule 数据模型
  - [x] SubTask 1.1: `schema.ts` 中 ReminderRule 新增 `cycle?: { activeDays: number; restDays: number }`
  - [x] SubTask 1.2: `inflateRule` 对 cycle 字段兼容（缺省时为 undefined，视为每日服药）
  - [x] SubTask 1.3: 运行 `npm run build` 验证类型检查通过

## Task 2: 药物相互作用规则库

- [x] Task 2: 创建药物相互作用规则库
  - [x] SubTask 2.1: 新建 `src/data/drugInteractions.ts`，导出 `DrugInteraction` 接口（drugs: string[], severity: 'mild'|'moderate'|'severe', description: string）与 `DRUG_INTERACTIONS: DrugInteraction[]`（约 30 条常见组合，覆盖抗凝/抗血小板/NSAID/降糖/降压/精神类等）
  - [x] SubTask 2.2: 导出 `checkInteractions(medNames: string[]): DrugInteraction[]` 方法（按药名模糊匹配，返回命中的相互作用列表）
  - [x] SubTask 2.3: 运行 `npm run build` 验证类型检查通过

## Task 3: 相互作用检查与周期用药实现

- [x] Task 3: 相互作用检查与周期用药
  - [x] SubTask 3.1: `MedEdit.ts` 保存药品时调用 `checkInteractions([新药名, ...现有药名])`，若有命中弹 `confirmDialog` 显示 warning（严重等级 + 描述），用户确认后才保存
  - [x] SubTask 3.2: `MedEdit.ts` 提醒规则编辑区新增"周期用药"配置（开关 + activeDays/restDays 两个 number input），默认关闭=每日；保存时写入 rule.cycle
  - [x] SubTask 3.3: `reminderScheduler.ts` 生成当日提醒时，若 rule.cycle 存在，根据 `med.createdAt` 计算今日是 active 日还是 rest 日（用天数差对 cycle 取模），rest 日跳过该规则
  - [x] SubTask 3.4: `MedList.ts` 药品卡片对有相互作用的药品显示 ⚠️ 图标，点击弹详情对话框列出所有命中组合
  - [x] SubTask 3.5: `MedList.ts` 对处于 rest 日的药品显示"停药期"灰底标签
  - [x] SubTask 3.6: `Today.ts` 服药确认时若涉及相互作用组合，在确认对话框中追加提示文字
  - [x] SubTask 3.7: `Today.ts` 对处于 rest 日的药品显示"停药期"标签并允许跳过
  - [x] SubTask 3.8: `styles.css` 新增 .interaction-icon / .rest-day-tag 样式
  - [x] SubTask 3.9: 运行 `npm run build` 验证类型检查通过

# Task Dependencies

- Task 1（ReminderRule.cycle）是 Task 3.2/3.3 的前置
- Task 2（相互作用规则库）是 Task 3.1/3.4/3.6 的前置
- Task 1 与 Task 2 无依赖，可并行
- Task 3 依赖 Task 1 与 Task 2 完成
