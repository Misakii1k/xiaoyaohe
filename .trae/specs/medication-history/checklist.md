# Checklist

## P0 路由骨架与数据加载

- [ ] `tools/registry.ts` 中 `meds.routes` 数组在 `/today` 后插入了 `/history` 路由条目
- [ ] `/history` 路由 handler 通过 `runLazyRoute` 懒加载 `../pages/MedHistory`
- [ ] `medbox/src/pages/MedHistory.ts` 已创建并导出 `renderMedHistoryPage(root, signal)`
- [ ] `medbox/src/ui/styles/pages/med-history.css` 已创建（至少为空文件或最小占位）
- [ ] 若 `styles.css` 用 `@import` 聚合 page css，已追加 `@import './pages/med-history.css';`
- [ ] `npm run build` 类型检查通过
- [ ] 浏览器访问 `#/history` 能渲染空骨架页面
- [ ] `HistoryState` interface 已定义，包含 rangePreset / customStart / customEnd / filterMed / filterSlot / filterStatus
- [ ] `loadHistoryData(state)` 并发调用 `listMeds` / `listScheduleRevisions` / `listLogsByRange` 并组装返回
- [ ] `computeRangeBounds(state)` 纯函数实现，自定义区间 > 90 天时抛 `RangeError`
- [ ] `groupOccurrencesByDate(occurrences, logs, medById)` 纯函数实现，按 localDate 倒序
- [ ] `tests/medHistory.test.ts` 覆盖 `computeRangeBounds` 与 `groupOccurrencesByDate`

## P1 查看能力

- [ ] 区间切换 chip 组（7 天 / 30 天 / 90 天 / 自定义）已实现，激活 chip 有 `aria-pressed="true"`
- [ ] 自定义区间两个 date input：最大可选今天，最小可选今天 - 89 天
- [ ] 切换区间后联动刷新；90 天或自定义跨度 > 30 天时显示 `skeletonCard()` 占位
- [ ] 区间汇总卡片显示：按时服药率（百分比 + 进度环）+ 4 个 metric（已服 / 跳过 / 漏服 / 已处理）
- [ ] `computeStreak` 纯函数实现，覆盖"全勤 / 中断 / 今日未完成 / 区间无 due"四种情况
- [ ] 卡片底部"连续服药 N 天"徽章；区间无 due 时显示"区间内没有已到期的服药安排"
- [ ] 日卡片按日期倒序，标题"X 月 X 日 周X" + 当日按时服药率小环
- [ ] 日卡片内按 slot 分组（早 / 中 / 晚 / 睡前），复用 `slotTag`
- [ ] 明细行结构：缩略图 / 药名 / 时间 + 用量 + 餐前·餐中·餐后 / 状态徽章
- [ ] 漏服行（pending + dueAt < now）加 `is-missed` class，用 `--tone-warn-bg` 着色
- [ ] 超过 90 天的行加 `is-readonly` class + `title="超过 90 天的记录不可编辑"`，不绑定 click
- [ ] 筛选条三个 `<select>`：药品 / 时段 / 状态，可叠加
- [ ] 筛选后空日卡片不渲染；筛选无结果显示 `banner('info', '该区间内没有符合条件的记录')`
- [ ] 三个 select 加了 200ms 防抖

## P2 编辑能力

- [ ] 操作 sheet 使用 `BottomSheet` 或 `confirmDialog` 风格，列出三个选项：标记已服 / 标记跳过 / 清除记录
- [ ] sheet 加 `role="dialog" aria-modal="true" aria-labelledby`；Escape 关闭；关闭后焦点归还触发行
- [ ] 选项根据当前 status 智能禁用（taken 禁用"标记已服"；skipped 禁用"标记跳过"；pending 禁用"清除记录"）
- [ ] 用户选择后调用 `setOccurrenceAction(occurrence, action)`，捕获 `MedicationIntakeError` 并 toast 原始消息
- [ ] 成功后 toast 反馈"已记录为已服" / "已记录为跳过" / "已清除记录"
- [ ] 成功后局部刷新：重新 `loadHistoryData` 并重渲染，保留滚动位置与筛选状态
- [ ] 库存不足时（`code='insufficient-inventory'`）允许"跳过"，阻断"已服"
- [ ] 已过期药品（`code='expired'`）阻断"已服"，允许"跳过"与"清除记录"
- [ ] `tests/medHistory.test.ts` 含集成测试：mock `setOccurrenceAction` 验证调用与错误处理

## P3 入口、性能与 a11y

- [ ] `Today.ts` 的 `renderWeekAdherenceCard` 卡片末尾追加"查看完整历史 →"链接（`<a href="#/history">`）
- [ ] `Today.ts` 的 `renderPage` 调用通过 `topRight` 传入历史图标按钮，点击 `navigate('/history')`
- [ ] `MedHistory.ts` 的 `renderPage` 调用通过 `topLeft` 传入返回按钮，点击 `navigate('/today')`
- [ ] `iconRegistry.ts` 已有 `clock` 与 `arrow-left` 图标（或新增）
- [ ] `med-history.css` 为 `.history-day-card` / `.history-med-row` 加 `content-visibility: auto; contain-intrinsic-size: 96px`
- [ ] 90 天视图首次加载先渲染 5 张 `skeletonCard()`，再异步替换
- [ ] 滚动容器加 `overscroll-behavior: contain`
- [ ] 历史页 main 容器加 `aria-label="服药历史"`；区间 chip 组加 `role="group" aria-label="时间区间"`
- [ ] 日卡片标题用 `<h2>`；明细行用 `<article>` + `aria-label`
- [ ] 操作 sheet 选项有 `aria-label`；触控目标 ≥ 44px
- [ ] 暗色模式验证：所有 token 在 `[data-theme='dark']` 下可读，对比度 ≥ 4.5:1
- [ ] 键盘导航：Tab 顺序合理；Enter / Space 触发明细行点击；Escape 关闭 sheet

## 端到端验证

- [ ] `npm run build` 类型检查通过
- [ ] `npm test` 全部通过（含新增 `medHistory.test.ts`）
- [ ] 浏览器手测：从今日页两个入口（图标 + 链接）进入历史页
- [ ] 浏览器手测：切换 7/30/90 天视图；自定义区间超过 90 天被截断
- [ ] 浏览器手测：筛选药品/时段/状态叠加；筛选无结果显示空状态
- [ ] 浏览器手测：点击漏服行补记已服；点击已服行清除；点击过期药的"已服"被阻断并 toast
- [ ] 浏览器手测：超过 90 天的行不可点击 + tooltip 显示
- [ ] 浏览器手测：返回按钮回到 `/today`
- [ ] 暗色模式跑一遍历史页与今日页入口
- [ ] 横屏模式跑一遍（topbar / 内容 / tabbar 不被遮挡）
- [ ] 减少动效（`prefers-reduced-motion`）跑一遍
- [ ] `docs/handoffs/trae-qoder.md` 已更新，记录范围、文件、测试、剩余工作

## 不变量（不能破坏的现有行为）

- [ ] `IntakeLog` 数据模型未变更
- [ ] `MedicationScheduleRevision` / `MedicationOccurrence` 数据模型未变更
- [ ] 云同步契约未变更（`DataSnapshot.logs` 仍同步）
- [ ] 备份导入导出未变更（`backupProviders` 仍包含 logs）
- [ ] 今日页其他功能未受影响（除新增的链接与 topRight 按钮）
- [ ] 药品列表 / 库存 / 扫码 / 设置页未受影响
- [ ] 未引入新 npm 依赖（`package.json` / `package-lock.json` 未变更）
