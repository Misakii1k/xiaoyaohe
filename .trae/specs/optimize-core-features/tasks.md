# Tasks

按优先级与依赖关系组织。P0 先扩展数据模型与基础能力（其他任务的前置）；P1 处理吃药工具功能增强；P2 处理工时记录功能增强；P3 处理通用体验增强。

## P0 — 数据模型与基础能力扩展

- [x] Task 1: 扩展数据模型与迁移
  - [x] SubTask 1.1: `schema.ts` 中 Medication 新增 `expiryDate?: number`
  - [x] SubTask 1.2: `schema.ts` 中 MedicationInventory 新增 `dailyConsumption?: number`
  - [x] SubTask 1.3: `schema.ts` 中 WorkProfile 新增 `taskTemplates?: string[]`
  - [x] SubTask 1.4: `schema.ts` 中 WorkEntry 新增 `tags?: string[]`
  - [x] SubTask 1.5: `inflateMed` 确保对新字段兼容（缺省时为 undefined，不报错）
  - [x] SubTask 1.6: 运行 `npm run build` 验证类型检查通过
- [x] Task 2: 数据访问层增强
  - [x] SubTask 2.1: `db/local.ts` 新增 `listLogsByRange(start, end)` 方法（按 dueAt 区间查询）
  - [x] SubTask 2.2: `db/local.ts` 新增 `batchUpdateRules(updates: { id: string; enabled?: boolean }[])` 方法
  - [x] SubTask 2.3: `db/work.ts` 新增 `listWorkEntriesByProfile(profileId)` 方法
  - [x] SubTask 2.4: `db/work.ts` 新增 `batchMarkSettled(entryIds: string[])` 方法
  - [x] SubTask 2.5: `db/work.ts` 新增 `listWorkIncomeByProfile(entries, profiles, settlements, start, end)` 聚合方法

## P1 — 吃药工具功能增强

- [x] Task 3: 药品搜索与筛选
  - [x] SubTask 3.1: `MedList.ts` 顶部新增搜索框（input + 防抖），按 name/dosageText 模糊匹配
  - [x] SubTask 3.2: `MedList.ts` 搜索框下方新增时段筛选 chip 组（全部/早/中/晚/睡前）
  - [x] SubTask 3.3: `MedList.ts` 过滤逻辑：搜索词与时段筛选可叠加
  - [x] SubTask 3.4: `styles.css` 为搜索框与筛选条补充样式（复用现有 token）
- [x] Task 4: 服药依从性统计
  - [x] SubTask 4.1: `Today.ts` 底部新增"本周依从性"卡片，调用 `listLogsByRange` 取最近 7 天 logs
  - [x] SubTask 4.2: 卡片内绘制 7 日服药率（每日：已服/应服百分比 + 颜色条）
  - [x] SubTask 4.3: `MedList.ts` 药品卡片新增"近 7 天完成率"小标签（调用 `listLogsByRange` + 按 medId 过滤）
- [x] Task 5: 库存可用天数预测
  - [x] SubTask 5.1: `features/inventory.ts` 新增 `estimateDailyConsumption(med, rules)` 方法（按 enabled 规则与 daysOfWeek 推算日均用量）
  - [x] SubTask 5.2: `features/inventory.ts` 新增 `estimateDaysLeft(med, rules)` 方法（remaining / dailyConsumption，向下取整）
  - [x] SubTask 5.3: `MedList.ts` 卡片显示"约还够 X 天"（当 dailyConsumption > 0 且 remaining > 0 时）
  - [x] SubTask 5.4: `MedEdit.ts` 库存区显示"约还够 X 天" + 编辑保存时回写 `dailyConsumption`
- [x] Task 6: 提醒批量管理
  - [x] SubTask 6.1: `MedList.ts` 新增"批量管理"按钮，进入批量模式（每张卡片显示复选框 + 全选/取消）
  - [x] SubTask 6.2: 批量模式底部操作栏：全部启用 / 全部禁用 / 按时段批量开关
  - [x] SubTask 6.3: 调用 `batchUpdateRules` 持久化，刷新列表
- [x] Task 7: 药品过期管理
  - [x] SubTask 7.1: `MedEdit.ts` 新增"过期日期"字段（date input，可选）
  - [x] SubTask 7.2: `MedList.ts` 对近效期（≤30 天）药品显示 warn 标签"X 天后过期"
  - [x] SubTask 7.3: `MedList.ts` 对已过期药品显示 danger 标签"已过期"
  - [x] SubTask 7.4: `Today.ts` 对已过期药品的 med-line 加红边框警示

## P2 — 工时记录功能增强

- [x] Task 8: 多维度统计视图
  - [x] SubTask 8.1: `WorkLog.ts` hero 卡片新增区间切换 chip（今日/本周/本月/自定义）
  - [x] SubTask 8.2: 切换区间后联动更新收入、工时、出勤天数
  - [x] SubTask 8.3: 自定义区间用两个 date input 实现
  - [x] SubTask 8.4: 新增"按工作档案分组"对比视图（每个 profile 一行：总收入/总工时/班次数）
- [x] Task 9: 班次任务模板
  - [x] SubTask 9.1: 工作档案编辑对话框新增"任务模板"管理区（可增删字符串条目，最多 10 条）
  - [x] SubTask 9.2: `WorkLog.ts` 开始班次时任务输入框改为带 datalist 的 input，options 来自所选 profile 的 taskTemplates
  - [x] SubTask 9.3: 班次保存时若任务名不在模板中，自动追加到 profile.taskTemplates（去重，超过 10 条移除最早的）
- [x] Task 10: 班次标签
  - [x] SubTask 10.1: 班次编辑/补录对话框新增"标签"多选 chip 组（加班/节假日/外勤/补班）
  - [x] SubTask 10.2: 保存时写入 WorkEntry.tags
  - [x] SubTask 10.3: 列表卡片显示标签 chip（复用现有 .panel-chip.tone-* 样式）
- [x] Task 11: 结算状态可视化与批量结算
  - [x] SubTask 11.1: `WorkLog.ts` 列表项对已结算/待结算用不同背景色块区分（已结算加 .settled 类，待结算加 .pending 类）
  - [x] SubTask 11.2: 列表新增多选模式（长按或编辑按钮进入），底部操作栏"标记已结算/标记待结算"
  - [x] SubTask 11.3: 调用 `batchMarkSettled` 持久化
- [x] Task 12: 区间报表导出
  - [x] SubTask 12.1: `WorkLog.ts` 新增"导出报表"按钮，弹出区间选择对话框（周/月）
  - [x] SubTask 12.2: `tools/registry.ts` 新增 `exportWorkReport(entries, profiles, settlements, start, end, mode)` 方法，生成 CSV + 文本摘要
  - [x] SubTask 12.3: CSV 包含每日工时、收入，末尾合计行；文本摘要可复制到剪贴板

## P3 — 通用体验增强

- [x] Task 13: 首页快捷入口
  - [x] SubTask 13.1: `ToolPicker.ts` 工具卡片网格上方新增"快捷入口"区域
  - [x] SubTask 13.2: 快捷卡片 1：今日待服 N 项（点击跳转 /today）
  - [x] SubTask 13.3: 快捷卡片 2：一键开始上次班次（读 localStorage 最近一次 WorkEntry 的 profileId + taskName，点击直接开班）
  - [x] SubTask 13.4: 快捷卡片 3：正在进行的班次（若有 running entry，显示时长 + 点击跳转 /work）
- [x] Task 14: 同步状态指示
  - [x] SubTask 14.1: `components.ts` 新增 `syncStatusIcon(state: SyncState)` 组件，返回带图标的按钮
  - [x] SubTask 14.2: `renderPage` 支持 topLeft/topRight 之外新增 `statusSlot` 渲染同步图标
  - [x] SubTask 14.3: 各页面挂载同步图标，订阅 `onSync` 更新状态
  - [x] SubTask 14.4: 点击图标跳转 /settings
- [x] Task 15: 备份导入预扫描
  - [x] SubTask 15.1: `tools/registry.ts` 新增 `previewBackupImport(raw)` 方法，返回每个 provider 的 added/updated/skipped 统计 + warnings
  - [x] SubTask 15.2: `Settings.ts` 导入流程改为：选文件 → 预扫描 → 弹确认对话框显示统计 → 确认后真正写入
  - [x] SubTask 15.3: 对异常字段（类型不匹配、必填缺失）给警告但允许继续

# Task Dependencies

- Task 1（数据模型扩展）是所有其他任务的前置
- Task 2（数据访问层）是 Task 4/6/8/11/12 的前置
- Task 5.1（estimateDailyConsumption）是 Task 5.3/5.4 的前置
- Task 9.1（taskTemplates 字段管理）是 Task 9.2 的前置
- Task 12.2（exportWorkReport）是 Task 12.1 的前置
- Task 14.1（syncStatusIcon）是 Task 14.2 的前置
- Task 15.1（previewBackupImport）是 Task 15.2 的前置
- P1 / P2 / P3 内部任务可并行
