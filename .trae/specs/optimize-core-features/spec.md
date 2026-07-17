# 核心功能优化 Spec

## Why

medbox 是一款"本地优先"的吃药提醒 + 工时记录 PWA，当前已实现 M1~M3 的基础能力（药品管理、提醒调度、扫码识别、工时计时、云同步、AI 助手）。但在实际使用中暴露出若干**功能缺口**，影响日常可用性：

- **吃药工具**：药品列表无搜索/筛选；今日页无历史回顾；库存预警只看绝对阈值，无法预测"还够吃几天"；提醒规则只能逐条编辑，无批量操作。
- **工时记录**：统计维度单一（仅今日/本月）；补录时需反复输入相同任务名；缺少加班/节假日等特殊标记；结算状态在列表中不直观。
- **通用体验**：首页无快捷入口；离线/同步状态提示弱；备份导入缺少数据校验。

本变更聚焦**功能层面**的可落地增强，不涉及 UI 视觉重做（已由 `optimize-ui-design` 覆盖），目标是把"能用"提升到"好用"。

## What Changes

### 吃药工具

- **药品搜索与筛选**：MedList 页顶部新增搜索框（按药名/规格模糊匹配）+ 时段筛选 chip（早/中/晚/睡前/全部）
- **服药历史与依从性统计**：Today 页底部新增"本周依从性"卡片（7 日服药率 + 趋势条）；MedList 卡片显示"近 7 天完成率"
- **库存可用天数预测**：MedicationInventory 新增 `dailyConsumption`（按规则推算日均用量）；MedList 卡片与 MedEdit 显示"约还够 X 天"
- **提醒批量管理**：MedList 页新增"批量管理提醒"入口，支持一键启用/禁用某药的全部提醒、按时段批量开关
- **药品过期管理**：Medication 新增 `expiryDate` 可选字段；MedList 对近效期（≤30 天）药品显示警示标签；Today 页对已过期药品加红边框提示

### 工时记录

- **多维度统计视图**：WorkLog 页统计区新增"本周/自定义区间"切换；新增按工作档案分组的收入对比
- **班次任务模板**：WorkProfile 新增 `taskTemplates: string[]`；开始班次时任务输入框改为带历史模板的下拉
- **班次标签与备注增强**：WorkEntry 新增 `tags: string[]`（加班/节假日/外勤/补班）；列表卡片显示标签 chip
- **结算状态可视化**：WorkLog 列表对"已结算/待结算"用更明显的色块区分；支持批量标记结算
- **周报/月报导出**：新增"导出区间报表"功能（CSV + 简易文本摘要），除现有 CSV 导出外补充按周/月聚合

### 通用体验

- **首页快捷入口**：ToolPicker 页顶部新增 2~3 个快捷卡片（如"一键开始上次班次""今日待服"），基于最近行为动态生成
- **同步状态增强**：在 topbar 或设置页入口处显示同步状态小图标（idle/syncing/ok/error/offline），点击跳转设置
- **备份导入校验**：导入前预扫描数据结构，显示"将新增 X 条、更新 Y 条、跳过 Z 条"，对异常字段给警告但允许继续

## Impact

- Affected specs: `optimize-ui-design`（视觉与无障碍基线，本 spec 不冲突，但部分新组件如搜索框/标签 chip 应遵循其 token 与 a11y 规范）
- Affected code:
  - `medbox/src/db/schema.ts` —— Medication 新增 `expiryDate`；MedicationInventory 新增 `dailyConsumption`；WorkProfile 新增 `taskTemplates`；WorkEntry 新增 `tags`
  - `medbox/src/db/local.ts` —— 新增按区间查询 logs 的方法、批量更新 rules 的方法
  - `medbox/src/db/work.ts` —— 新增按区间/按 profile 聚合统计方法、批量结算方法
  - `medbox/src/pages/MedList.ts` —— 搜索框、筛选、批量管理、过期/库存提示
  - `medbox/src/pages/Today.ts` —— 本周依从性卡片、过期警示
  - `medbox/src/pages/MedEdit.ts` —— 过期日期字段、库存日均用量展示
  - `medbox/src/pages/WorkLog.ts` —— 统计切换、任务模板、标签、批量结算、报表导出
  - `medbox/src/pages/ToolPicker.ts` —— 快捷入口卡片
  - `medbox/src/pages/Settings.ts` —— 同步状态指示、备份导入预扫描
  - `medbox/src/features/inventory.ts` —— 日均用量推算、可用天数计算
  - `medbox/src/features/reminderScheduler.ts` —— 批量启用/禁用规则的工具方法
  - `medbox/src/tools/registry.ts` —— 备份导入预扫描、报表导出
  - `medbox/src/sync/syncClient.ts` —— 状态变化监听增强
- 不破坏既有数据模型（新字段均为可选，`inflateMed` 等迁移函数兜底）
- 不破坏云同步契约（新字段通过 `DataSnapshot` 自动随快照同步）
- 不引入新依赖

## ADDED Requirements

### Requirement: 药品搜索与筛选

系统 SHALL 在药品列表页提供按药名/规格模糊搜索的输入框，并提供按时段筛选的 chip 组（早/中/晚/睡前/全部）。

#### Scenario: 用户搜索药品
- **WHEN** 用户在搜索框输入"阿莫"
- **THEN** 列表实时过滤出药名或规格包含"阿莫"的药品

#### Scenario: 用户按时段筛选
- **WHEN** 用户点击"早上" chip
- **THEN** 列表只显示 slots 包含 morning 的药品

### Requirement: 服药依从性统计

系统 SHALL 在今日页展示"本周 7 日依从性"卡片，显示每日服药率与趋势；SHALL 在药品列表卡片上显示该药近 7 天的完成率。

#### Scenario: 查看本周依从性
- **WHEN** 用户进入今日页
- **THEN** 底部显示一张卡片，展示最近 7 天每天的服药率（已服/应服），并用颜色区分达标/未达标

### Requirement: 库存可用天数预测

系统 SHALL 根据药品的提醒规则推算日均用量，并显示"约还够 X 天"。

#### Scenario: 显示可用天数
- **GIVEN** 某药品剩余 21 片，每天早晚报各 1 片
- **THEN** 药品卡片与编辑页显示"约还够 10 天"

### Requirement: 提醒批量管理

系统 SHALL 支持在药品列表页进入"批量管理提醒"模式，可一键启用/禁用某药的全部提醒，或按时段批量开关。

#### Scenario: 批量禁用某药提醒
- **WHEN** 用户在批量管理中点击某药"全部禁用"
- **THEN** 该药所有 ReminderRule 的 enabled 置为 false，并持久化

### Requirement: 药品过期管理

系统 SHALL 支持为药品设置可选的过期日期；SHALL 对近效期（≤30 天）药品显示警示标签；SHALL 对已过期药品在今日页加红边框提示。

#### Scenario: 近效期提示
- **GIVEN** 某药品过期日期为距今 20 天后
- **THEN** 药品列表卡片显示"20 天后过期"的 warn 标签

### Requirement: 工时多维度统计

系统 SHALL 在工时页支持"今日/本周/本月/自定义区间"统计切换；SHALL 支持按工作档案分组的收入对比视图。

#### Scenario: 查看本周统计
- **WHEN** 用户切换到"本周"
- **THEN** 收入卡片显示本周预计收入、工时、出勤天数

### Requirement: 班次任务模板

系统 SHALL 在工作档案中维护任务模板列表；SHALL 在开始班次时提供模板下拉选择。

#### Scenario: 使用任务模板
- **GIVEN** 工作档案"奶茶店"有模板 ["晚班", "外勤", "补班"]
- **WHEN** 用户开始班次时点击任务输入框
- **THEN** 下拉显示这三个模板，选择后自动填入

### Requirement: 班次标签

系统 SHALL 支持为班次打标签（加班/节假日/外勤/补班）；SHALL 在列表卡片显示标签 chip。

#### Scenario: 标记加班
- **WHEN** 用户在补录班次时勾选"加班"标签
- **THEN** 班次保存 tags: ["加班"]，列表卡片显示"加班"chip

### Requirement: 结算状态可视化与批量结算

系统 SHALL 在工时列表用明显的色块区分已结算/待结算；SHALL 支持多选班次后批量标记结算。

#### Scenario: 批量结算
- **WHEN** 用户多选 5 条待结算班次，点击"标记已结算"
- **THEN** 这 5 条班次的 settlementStatus 置为 settled，settledAt 设为当前时间

### Requirement: 区间报表导出

系统 SHALL 支持导出指定区间的工时报表（CSV + 文本摘要），按周或月聚合。

#### Scenario: 导出月报
- **WHEN** 用户选择"2026 年 6 月"并点击"导出报表"
- **THEN** 下载一个 CSV，包含每日工时、收入，末尾有合计行；同时生成一段文本摘要可复制

### Requirement: 首页快捷入口

系统 SHALL 在工具箱首页根据最近行为动态生成 2~3 个快捷卡片（如"一键开始上次班次""今日待服 N 项"）。

#### Scenario: 一键开始上次班次
- **GIVEN** 用户上次上班是"奶茶店·晚班"
- **WHEN** 用户点击首页"一键开始上次班次"卡片
- **THEN** 直接以"奶茶店·晚班"配置开始一个新班次

### Requirement: 同步状态指示

系统 SHALL 在 topbar 或设置入口处显示同步状态小图标（idle/syncing/ok/error/offline），点击跳转设置页。

#### Scenario: 同步出错时提示
- **WHEN** 同步失败
- **THEN** 状态图标变红色，点击跳转到设置页同步面板

### Requirement: 备份导入预扫描

系统 SHALL 在导入备份前预扫描数据，显示"将新增 X 条、更新 Y 条、跳过 Z 条"，对异常字段给警告但允许继续。

#### Scenario: 导入前确认
- **WHEN** 用户选择备份文件后
- **THEN** 弹出确认对话框显示统计，用户确认后才真正写入

## MODIFIED Requirements

### Requirement: Medication 数据模型

Medication SHALL 新增可选字段 `expiryDate?: number`（UTC 毫秒时间戳）；`inflateMed` SHALL 对老数据保持兼容（字段缺省时为 undefined）。

### Requirement: MedicationInventory 数据模型

MedicationInventory SHALL 新增可选字段 `dailyConsumption?: number`（日均用量，由提醒规则推算）；SHALL 在 `deductInventory` 时不主动写入该字段（由 MedEdit/批量推算逻辑维护）。

### Requirement: WorkProfile 数据模型

WorkProfile SHALL 新增可选字段 `taskTemplates?: string[]`（任务模板，最多 10 条）。

### Requirement: WorkEntry 数据模型

WorkEntry SHALL 新增可选字段 `tags?: string[]`（班次标签）。

### Requirement: ToolPicker 首页

ToolPicker SHALL 在工具卡片网格上方新增"快捷入口"区域，根据 `localStorage` 记录的最近行为动态生成。

### Requirement: WorkLog 统计区

WorkLog 的 hero 卡片 SHALL 新增区间切换（今日/本周/本月/自定义），切换后整个统计区联动更新。

## REMOVED Requirements

无移除项。
