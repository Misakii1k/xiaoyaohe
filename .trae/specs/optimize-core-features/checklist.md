# Checklist

## P0 数据模型与基础能力

- [x] `schema.ts` 中 Medication 新增了 `expiryDate?: number` 字段
- [x] `schema.ts` 中 MedicationInventory 新增了 `dailyConsumption?: number` 字段
- [x] `schema.ts` 中 WorkProfile 新增了 `taskTemplates?: string[]` 字段
- [x] `schema.ts` 中 WorkEntry 新增了 `tags?: string[]` 字段
- [x] `inflateMed` 对新字段保持兼容（缺省时为 undefined，不报错）
- [x] `npm run build` 类型检查通过
- [x] `db/local.ts` 新增了 `listLogsByRange(start, end)` 方法
- [x] `db/local.ts` 新增了 `batchUpdateRules(updates)` 方法
- [x] `db/work.ts` 新增了 `listWorkEntriesByProfile(profileId)` 方法
- [x] `db/work.ts` 新增了 `batchMarkSettled(entryIds)` 方法
- [x] `db/work.ts` 新增了 `listWorkIncomeByProfile(...)` 聚合方法

## P1 吃药工具功能增强

- [x] MedList 页顶部有搜索框，输入"阿莫"能实时过滤出匹配药品
- [x] MedList 页搜索框下方有时段筛选 chip（全部/早/中/晚/睡前）
- [x] 搜索词与时段筛选可叠加生效
- [x] Today 页底部有"本周依从性"卡片，显示 7 日服药率与趋势
- [x] MedList 卡片显示该药"近 7 天完成率"
- [x] `inventory.ts` 有 `estimateDailyConsumption` 与 `estimateDaysLeft` 方法
- [x] MedList 卡片显示"约还够 X 天"（当可推算时）
- [x] MedEdit 库存区显示"约还够 X 天"并保存时回写 `dailyConsumption`
- [x] MedList 有"批量管理"按钮，进入批量模式后每张卡片有复选框
- [x] 批量模式底部操作栏支持全部启用/全部禁用/按时段批量开关
- [x] 批量操作调用 `batchUpdateRules` 持久化并刷新列表
- [x] MedEdit 有"过期日期"字段（date input，可选）
- [x] MedList 对近效期（≤30 天）药品显示 warn 标签"X 天后过期"
- [x] MedList 对已过期药品显示 danger 标签"已过期"
- [x] Today 页对已过期药品的 med-line 加红边框警示

## P2 工时记录功能增强

- [x] WorkLog hero 卡片有区间切换 chip（今日/本周/本月/自定义）
- [x] 切换区间后收入、工时、出勤天数联动更新
- [x] 自定义区间用两个 date input 实现
- [x] 有"按工作档案分组"对比视图（每 profile 一行：总收入/总工时/班次数）
- [x] 工作档案编辑对话框有"任务模板"管理区（可增删，最多 10 条）
- [x] 开始班次时任务输入框为 datalist，options 来自 profile.taskTemplates
- [x] 班次保存时任务名自动追加到模板（去重，超 10 条移除最早）
- [x] 班次编辑/补录对话框有"标签"多选 chip（加班/节假日/外勤/补班）
- [x] 保存时写入 WorkEntry.tags
- [x] 列表卡片显示标签 chip
- [x] 列表项对已结算/待结算用不同背景色块区分
- [x] 列表有多选模式，底部操作栏"标记已结算/标记待结算"
- [x] 多选结算调用 `batchMarkSettled` 持久化
- [x] 有"导出报表"按钮，弹出区间选择（周/月）
- [x] `exportWorkReport` 生成 CSV（每日工时/收入 + 合计行）+ 文本摘要
- [x] 文本摘要可复制到剪贴板

## P3 通用体验增强

- [x] ToolPicker 工具卡片网格上方有"快捷入口"区域
- [x] 快捷卡片 1：今日待服 N 项（点击跳转 /today）
- [x] 快捷卡片 2：一键开始上次班次（读 localStorage 最近 WorkEntry，点击直接开班）
- [x] 快捷卡片 3：正在进行的班次（若有 running，显示时长 + 点击跳转 /work）
- [x] `components.ts` 有 `syncStatusIcon(state)` 组件
- [x] 各页面 topbar 显示同步状态图标
- [x] 同步状态图标订阅 `onSync` 实时更新
- [x] 点击同步图标跳转 /settings
- [x] 同步失败时图标变红色
- [x] `registry.ts` 有 `previewBackupImport(raw)` 方法
- [x] Settings 导入流程：选文件 → 预扫描 → 确认对话框 → 写入
- [x] 确认对话框显示每个 provider 的 added/updated/skipped 统计
- [x] 对异常字段给警告但允许继续
