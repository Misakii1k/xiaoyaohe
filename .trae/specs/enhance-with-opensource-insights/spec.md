# 借鉴开源项目功能优化 Spec

## Why

medbox 已完成 `optimize-ui-design` 与 `optimize-core-features`，基础能力齐备。但对比 GitHub 上同类吃药提醒开源项目（如 [MediTrak](https://github.com/AdamGuidarini/MediTrak)、[HomeMedkit-App](https://github.com/pewaru-333/HomeMedkit-App)、[pinkrain_health_journal](https://github.com/rudi-q/pinkrain_health_journal)），仍有两项**安全与疗程管理**层面的功能缺口：

- **药物相互作用检查**：用户同时服用多种药品时，medbox 目前不会提示潜在相互作用（如华法林+阿司匹林增加出血风险），存在用药安全隐患。这是吃药类应用的刚需能力。
- **周期性用药规则**：常见疗程（抗生素吃 5 天停 2 天、激素周期用药）medbox 只能按"每日固定时段"提醒，无法表达"吃 N 天停 M 天"的周期，导致疗程后期用户被打扰或漏服。

本变更聚焦引入这两项已被开源验证、且与 medbox"吃药工具"核心定位强相关的功能，补全安全用药与疗程管理短板。

## What Changes

### 增强：药物相互作用检查

- 新增内置相互作用规则库（轻量 JSON，~30 条常见组合）放在 `src/data/drugInteractions.ts`，覆盖抗凝/抗血小板/NSAID/降糖/降压/精神类等常见药物组合
- MedEdit 保存药品时，调用 `checkInteractions([新药名, ...现有药名])` 检查，若命中规则弹 `confirmDialog` 显示 warning（严重等级 + 描述），用户确认后才保存
- MedList 药品卡片对有相互作用的药品显示 ⚠️ 图标，点击弹详情对话框列出所有命中组合
- Today 页服药确认时若涉及相互作用组合，在确认对话框中追加提示文字
- AI 助手可查询相互作用（复用现有 LLM 能力，传入药品名列表）

### 增强：周期性用药规则

- ReminderRule 新增 `cycle?: { activeDays: number; restDays: number }` 可选字段（吃 N 天停 M 天）
- `reminderScheduler.ts` 生成当日提醒时，根据 `med.createdAt` 与 cycle 计算"今天是 active 日还是 rest 日"，rest 日不生成该规则的提醒
- MedEdit 提醒规则编辑区新增"周期"配置（开关 + activeDays/restDays 两个 number input），默认关闭=每日
- MedList/Today 对处于 rest 日的药品显示"停药期"灰底标签

## Impact

- Affected specs: `optimize-core-features`（药物相互作用复用其 MedList 标签样式；周期用药复用其 ReminderRule 编辑区）
- Affected code:
  - `medbox/src/db/schema.ts` —— ReminderRule 新增 `cycle?`
  - `medbox/src/data/drugInteractions.ts` —— **新增**，内置相互作用规则库
  - `medbox/src/features/reminderScheduler.ts` —— 周期判断逻辑
  - `medbox/src/pages/MedEdit.ts` —— 周期配置 + 相互作用检查
  - `medbox/src/pages/MedList.ts` —— 相互作用 ⚠️ 标签 + rest 日标签
  - `medbox/src/pages/Today.ts` —— 服药时相互作用提示 + rest 日标签
  - `medbox/src/ui/styles.css` —— 相互作用图标与 rest 日标签样式
- 不破坏既有数据模型（cycle 为可选字段，`inflateRule` 兜底）
- 不破坏云同步契约（cycle 随 ReminderRule 快照同步）
- 不引入新依赖

## ADDED Requirements

### Requirement: 药物相互作用检查

系统 SHALL 在药品保存时检查名称/备注是否命中内置相互作用规则；SHALL 在 MedList 与 Today 页对有相互作用的药品显示警示；SHALL 支持 AI 助手查询相互作用。

#### Scenario: 保存含相互作用的药品
- **GIVEN** 用户已有一药品"华法林"，现新增"阿司匹林"
- **WHEN** 保存"阿司匹林"
- **THEN** 系统弹 warning"与华法林存在相互作用（增加出血风险）"，用户确认后才保存

#### Scenario: 查看相互作用详情
- **WHEN** 用户在 MedList 点击某药的 ⚠️ 图标
- **THEN** 弹出对话框列出该药与库中其他药品的所有命中相互作用组合及严重等级

#### Scenario: 服药时提示
- **GIVEN** 今日待服包含"华法林"和"阿司匹林"
- **WHEN** 用户点击服药确认
- **THEN** 确认对话框追加"此药与华法林存在相互作用"提示文字

### Requirement: 周期性用药规则

系统 SHALL 支持为提醒规则配置周期（吃 N 天停 M 天）；SHALL 在 rest 日不生成提醒；SHALL 在 MedList/Today 显示"停药期"标签。

#### Scenario: 抗生素周期用药
- **GIVEN** 用户为某抗生素设置 cycle { activeDays: 5, restDays: 2 }，createdAt 为周一
- **WHEN** 到达周六（第 6 天）
- **THEN** 该药当日不生成提醒，MedList/Today 显示"停药期"标签

#### Scenario: 周期回到 active 日
- **GIVEN** 同上药品，cycle { activeDays: 5, restDays: 2 }
- **WHEN** 到达下周一（第 8 天，新周期第 1 天）
- **THEN** 该药恢复提醒，"停药期"标签消失

## MODIFIED Requirements

### Requirement: ReminderRule 数据模型

ReminderRule SHALL 新增可选字段 `cycle?: { activeDays: number; restDays: number }`；`inflateRule` SHALL 对老数据兼容（缺省时为 undefined，视为每日服药）。

### Requirement: MedEdit 提醒规则编辑

MedEdit 的提醒规则编辑区 SHALL 新增"周期用药"开关与 activeDays/restDays 输入；SHALL 在保存药品时先执行相互作用检查。

### Requirement: MedList 药品卡片

MedList 药品卡片 SHALL 对有相互作用的药品显示 ⚠️ 图标；SHALL 对处于 rest 日的药品显示"停药期"标签。

### Requirement: Today 服药页

Today 页 SHALL 对处于 rest 日的药品显示"停药期"标签并允许跳过；SHALL 在服药确认时检查相互作用并提示。

## REMOVED Requirements

无移除项。
