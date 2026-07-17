# Checklist

## Task 1 数据模型扩展

- [x] `schema.ts` 中 ReminderRule 新增了 `cycle?: { activeDays: number; restDays: number }` 字段
- [x] `inflateRule` 对 cycle 字段兼容（缺省时为 undefined，视为每日服药）
- [x] `npm run build` 类型检查通过

## Task 2 药物相互作用规则库

- [x] 新建了 `src/data/drugInteractions.ts`
- [x] 导出了 `DrugInteraction` 接口（drugs/severity/description）
- [x] 导出了 `DRUG_INTERACTIONS` 常量（约 30 条常见组合）
- [x] 导出了 `checkInteractions(medNames)` 方法
- [x] `npm run build` 类型检查通过

## Task 3 相互作用检查与周期用药

- [x] `MedEdit.ts` 保存药品时调用 `checkInteractions` 检查
- [x] 命中相互作用时弹 `confirmDialog` warning（含严重等级 + 描述），确认后才保存
- [x] `MedEdit.ts` 提醒规则编辑区新增"周期用药"配置（开关 + activeDays/restDays 输入）
- [x] 保存时写入 rule.cycle
- [x] `reminderScheduler.ts` 生成当日提醒时按 cycle 判断 active/rest 日
- [x] rest 日跳过该规则的提醒
- [x] `MedList.ts` 对有相互作用的药品显示 ⚠️ 图标
- [x] 点击 ⚠️ 图标弹详情对话框列出所有命中组合及严重等级
- [x] `MedList.ts` 对 rest 日药品显示"停药期"灰底标签
- [x] `Today.ts` 服药确认时若涉及相互作用组合追加提示文字
- [x] `Today.ts` 对 rest 日药品显示"停药期"标签并允许跳过
- [x] `styles.css` 新增 .interaction-icon / .rest-day-tag 样式
- [x] `npm run build` 类型检查通过
