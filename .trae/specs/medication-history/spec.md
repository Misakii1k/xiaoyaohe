# 服药历史记录 Spec

## Why

medbox 已经完整地记录了每一条服药日志（`IntakeLog`，含 taken / skipped / pending 三态）与基于计划快照（`MedicationScheduleRevision`）确定性生成的应服 occurrences，并能在今日页展示"近 7 天服药情况"条形图与药品卡片上的"近 7 天按时服药 X%"。但用户**无法回看 7 天以前的服药情况**，也**无法在事后补录或纠正历史记录**：

- 今日页的依从性卡片只覆盖最近 7 天，更早的数据"看不见"
- 药品卡片只显示一个汇总百分比，看不到每日明细
- 漏服后无法在事后标记为"已服"或"跳过"——今日页只能操作"今日"
- 没有按药品 / 时段 / 状态筛选历史记录的入口
- 撤销"已服"会自动回滚库存（`setOccurrenceAction` 已实现），但当前只能在当天撤销

实际使用中，长辈常常事后才想起来补记或更正（"昨天晚上的药我吃了忘了点"），缺少历史回看与编辑能力会让"照护闭环"留下缺口。本变更在不新增数据库表、不改动数据模型的前提下，提供专门的"服药历史"页面，支持按日期/药品/时段/状态查看，并允许在合理回看窗口（90 天）内编辑历史记录。

## What Changes

### 新增"服药历史"页面（`/history`）

- 新增页面 `src/pages/MedHistory.ts`，路由 `/history` 注册到 `tools/registry.ts` 的 `meds` 工具下
- 页面顶部：区间切换 chip（7 天 / 30 天 / 90 天 / 自定义）+ 自定义区间两个 date input（上限 90 天）
- 区间汇总卡片：按时服药率 + 已处理率 + 已服 / 跳过 / 漏服计数 + 当前连续服药天数（streak）
- 按日倒序的"日卡片"列表，每个日卡片包含：
  - 日期标题（X 月 X 日 周X）+ 当日按时服药率小环
  - 按 slot 分组（早 / 中 / 晚 / 睡前）的明细行：药名 + 时间 + 用量 + 餐前/餐中/餐后 + 状态徽章
  - 漏服项（pending 且 dueAt 早于 now）用 warning 色突出
- 筛选条：药品下拉（全部 / 某药）+ 时段下拉（全部 / 早 / 中 / 晚 / 睡前）+ 状态下拉（全部 / 已服 / 跳过 / 漏服）

### 历史记录编辑能力

- 任意 occurrence 行点击后弹出操作 sheet：标记已服 / 标记跳过 / 清除记录
- 编辑窗口为最近 90 天；超过 90 天的记录只读（避免远期回填导致库存与同步冲突）
- 复用现有 `setOccurrenceAction(occurrence, action)`，自动处理库存扣减/回滚与同步
- 已过期药品不允许标记"已服"（复用 `MedicationIntakeError` 'expired' 错误码 → toast 提示）
- 库存不足时显示 toast 但允许"跳过"

### 入口

- 今日页（`Today.ts`）"近 7 天服药情况"卡片底部新增"查看完整历史 →"链接，点击跳转 `/history`
- 今日页 topbar 右上角新增历史图标按钮（复用现有 `history` 或 `clock` 图标），点击跳转 `/history`
- 不新增 primary tab（避免 5→6 拥挤）；历史页 topbar 左上角"返回"按钮回到 `/today`

### 性能与无障碍

- 长列表项（`.history-day-card` / `.history-med-row`）加 `content-visibility: auto; contain-intrinsic-size: 96px`
- 区间超过 30 天时，先渲染骨架卡片（`skeletonCard()`），再异步填充
- 筛选条件变化加 200ms 防抖
- 页面遵循既有 a11y 基线：`role="main"`、`aria-label`、`aria-live` toast、44px 触控目标、Escape 关闭操作 sheet
- 状态徽章复用 `createStatusBadge`；slot 标签复用 `slotTag`
- 复用 `--tone-*-fg/bg`、`--fs-*`、`--space-*` token，不引入硬编码颜色

## Impact

- Affected specs:
  - `optimize-core-features`（依从性统计要求扩展——本 spec 在其基础上提供更深的历史回看与编辑能力，不冲突）
  - `optimize-ui-design`（a11y / 暗色 / token 基线——本 spec 的新页面与组件必须遵循其规范）
- Affected code:
  - `medbox/src/pages/MedHistory.ts` —— **新增**，历史页面主体
  - `medbox/src/tools/registry.ts` —— `meds` 工具 `routes` 数组新增 `/history` 路由
  - `medbox/src/pages/Today.ts` —— 周依从性卡片底部新增"查看完整历史"链接；topbar 右上角新增历史图标按钮
  - `medbox/src/ui/styles/pages/med-history.css` —— **新增**，历史页样式（复用 today.css 的 adherence 图样式 token）
  - `medbox/src/ui/styles.css` —— 引入 `med-history.css`（如该文件负责 @import 聚合）
  - `medbox/src/ui/icons/iconRegistry.ts` —— 若缺 `history` 图标则新增（优先复用已有的 `clock` 或 `calendar`）
- Affected data layer: 无新增表、无 schema 变更，仅复用：
  - `listLogsByRange(start, end)`（已存在）
  - `listScheduleRevisions()`（已存在）
  - `listMeds()`（已存在）
  - `setOccurrenceAction(occurrence, action, opts)`（已存在，含库存联动）
  - `generateOccurrences(revisions, startDate, endDate)`（已存在）
  - `calculateAdherence(occurrences, logs, now)`（已存在）
- 不破坏云同步契约（`IntakeLog` 已在 `DataSnapshot.logs` 中同步）
- 不破坏备份导入导出（`backupProviders` 已包含 logs）
- 不引入新依赖
- 分支：在 `workspace/trae-qoder` 上开发，测试通过后合并到 `main`，再回 merge 到其他 tool 分支（遵循 AGENTS.md）

## ADDED Requirements

### Requirement: 服药历史页面路由

系统 SHALL 在 `/history` 路径提供专门的服药历史页面，作为 `meds` 工具下的子路由，通过 `runLazyRoute` 懒加载 `MedHistory.ts` 模块。

#### Scenario: 直接访问历史页

- **WHEN** 用户在浏览器地址栏输入 `#/history`
- **THEN** 渲染服药历史页面，默认显示最近 30 天的服药记录

#### Scenario: 从今日页跳转

- **WHEN** 用户在今日页点击"查看完整历史"链接
- **THEN** 路由跳转到 `/history`

### Requirement: 区间切换与自定义

系统 SHALL 提供 7 天 / 30 天 / 90 天 / 自定义四个区间 chip；SHALL 限制自定义区间最大跨度为 90 天；SHALL 在切换区间后联动刷新汇总卡片与日卡片列表。

#### Scenario: 切换到 7 天视图

- **WHEN** 用户点击"7 天" chip
- **THEN** 页面显示最近 7 天的汇总与日卡片，且 7 天 chip 处于激活态（`aria-pressed="true"`）

#### Scenario: 自定义区间超过 90 天

- **GIVEN** 用户在自定义区间选择了 2026-01-01 至 2026-06-01
- **WHEN** 用户确认区间
- **THEN** 页面显示警告 toast"自定义区间最多 90 天"，并自动截断为最近 90 天

### Requirement: 区间汇总卡片

系统 SHALL 在页面顶部显示一张区间汇总卡片，包含：按时服药率（百分比 + 进度环）、已处理率、已服 / 跳过 / 漏服计数、当前连续服药天数（streak）。

#### Scenario: 查看最近 30 天汇总

- **GIVEN** 最近 30 天共有 100 条应服、85 条已服、5 条跳过、10 条漏服
- **THEN** 汇总卡片显示"按时服药 85%"，进度环填充至 85%，下方文案"已服 85 · 跳过 5 · 漏服 10 · 已处理 90%"

#### Scenario: 区间内无应服安排

- **GIVEN** 某区间内所有日期均为停药期
- **THEN** 汇总卡片显示"区间内没有已到期的服药安排"，不显示百分比

### Requirement: 按日倒序的日卡片列表

系统 SHALL 按日期倒序渲染日卡片；每个日卡片 SHALL 显示日期标题、当日按时服药率小环、按 slot 分组的明细行。

#### Scenario: 渲染日卡片

- **GIVEN** 2026-07-20 有早 / 晚两个时段各 1 项，均已服
- **THEN** 渲染一张日卡片，标题"7 月 20 日 周一"，右侧小环显示 100%，下方两组 slot 行，每行显示药名 / 时间 / 用量 / 状态徽章

#### Scenario: 漏服项突出显示

- **GIVEN** 2026-07-19 晚上某药 dueAt 已过且 status 为 pending
- **THEN** 该行用 warning 色边框或背景突出，状态徽章显示"漏服"

### Requirement: 筛选条件

系统 SHALL 提供药品 / 时段 / 状态三个筛选下拉；SHALL 支持筛选条件叠加；SHALL 在筛选后只显示符合条件的明细行（日卡片仍按日分组，但空日卡片不渲染）。

#### Scenario: 筛选某药的漏服记录

- **WHEN** 用户选择药品 = "阿莫西林"，状态 = "漏服"
- **THEN** 列表只显示该药在该区间内 dueAt 已过且 status 为 pending 的明细行

#### Scenario: 筛选无结果

- **WHEN** 筛选后无任何明细行
- **THEN** 列表区域显示空状态卡片"该区间内没有符合条件的记录"

### Requirement: 历史记录编辑

系统 SHALL 允许用户对最近 90 天内的任意 occurrence 执行标记已服 / 标记跳过 / 清除记录操作；SHALL 通过复用 `setOccurrenceAction` 持久化；SHALL 在操作后刷新所在日卡片与汇总卡片。

#### Scenario: 补记昨天的药

- **GIVEN** 昨天 2026-07-24 晚上某药为 pending（漏服）
- **WHEN** 用户点击该行，选择"标记已服"
- **THEN** 调用 `setOccurrenceAction(occurrence, 'taken')`，库存按 `doseQuantity` 扣减，行状态徽章更新为"已服"，汇总卡片按时服药率 +1

#### Scenario: 撤销已服记录

- **GIVEN** 昨天 2026-07-24 晚上某药为 taken
- **WHEN** 用户点击该行，选择"清除记录"
- **THEN** 调用 `setOccurrenceAction(occurrence, undefined)`，库存按 `inventoryDelta` 回滚（若有），行状态徽章更新为"漏服"或"待服"

#### Scenario: 超过 90 天的记录只读

- **GIVEN** 某条记录的 dueAt 距今超过 90 天
- **THEN** 该行不可点击，鼠标悬停显示 tooltip"超过 90 天的记录不可编辑"

#### Scenario: 已过期药品不能补记已服

- **GIVEN** 用户尝试对一药品过期日早于 occurrence.localDate 的记录标记"已服"
- **WHEN** `setOccurrenceAction` 抛出 `MedicationIntakeError`（code='expired'）
- **THEN** toast 显示原始错误消息，行状态保持不变

### Requirement: 连续服药天数（streak）

系统 SHALL 计算并显示"当前连续服药天数"：从今日向前回溯，每日按时服药率达 100% 计入连续，遇到首日未达 100% 或无应服安排则停止。

#### Scenario: 连续 5 天全部按时

- **GIVEN** 最近 5 天每日所有 occurrence 均为 taken，第 6 天有 1 条 missed
- **THEN** 汇总卡片显示"连续服药 5 天"

#### Scenario: 今日尚未完成

- **GIVEN** 今日仍有 pending 项
- **THEN** streak 从昨天起算，今日不中断也不计入

### Requirement: 入口与导航

系统 SHALL 在今日页周依从性卡片底部新增"查看完整历史 →"链接；SHALL 在今日页 topbar 右上角新增历史图标按钮；SHALL 在历史页 topbar 左上角新增"返回"按钮回到 `/today`。

#### Scenario: 从今日页图标进入

- **WHEN** 用户点击今日页 topbar 右上角的历史图标
- **THEN** 路由跳转到 `/history`

#### Scenario: 从历史页返回

- **WHEN** 用户点击历史页 topbar 左上角"返回"按钮
- **THEN** 路由跳转回 `/today`

### Requirement: 性能基线

系统 SHALL 对区间超过 30 天的查询先渲染骨架卡片再异步填充；SHALL 对长列表项应用 `content-visibility: auto; contain-intrinsic-size: 96px`；SHALL 对筛选输入加 200ms 防抖。

#### Scenario: 加载 90 天数据

- **WHEN** 用户切换到 90 天视图
- **THEN** 页面立即显示骨架卡片，待 `listLogsByRange` + `generateOccurrences` 完成后替换为真实数据

## MODIFIED Requirements

### Requirement: Today 页周依从性卡片

`Today.ts` 的 `renderWeekAdherenceCard` SHALL 在卡片底部追加一个"查看完整历史 →"链接，点击调用 `navigate('/history')`。

### Requirement: Today 页 topbar

`Today.ts` 的 `renderPage` 调用 SHALL 通过 `topRight` 参数传入一个历史图标按钮（复用 `icon('clock')` 或新增 `icon('history')`），点击调用 `navigate('/history')`。

### Requirement: meds 工具路由表

`tools/registry.ts` 中 `meds` 工具的 `routes` 数组 SHALL 在 `/today` 路由后插入 `/history` 路由，handler 通过 `runLazyRoute` 懒加载 `../pages/MedHistory`。

## REMOVED Requirements

无移除项。
