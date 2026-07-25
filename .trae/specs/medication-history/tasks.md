# Tasks

按优先级与依赖关系组织。P0 先建立路由骨架与数据加载骨架；P1 实现核心查看能力（汇总卡片 + 日卡片列表 + 筛选）；P2 实现编辑能力（操作 sheet + setOccurrenceAction 集成）；P3 处理入口、性能优化与 a11y 收尾。

**分支策略**：在 `workspace/trae-qoder` 分支上开发，遵循 AGENTS.md。每个 P 阶段结束后跑 `npm run build` + `npm test`，commit 一次。所有任务完成后 merge 到 `main`，再回 merge 到其他 tool 分支。

## P0 — 路由骨架与数据加载

- [ ] Task 1: 新增 `/history` 路由与空页面骨架
  - [ ] SubTask 1.1: 在 `medbox/src/tools/registry.ts` 的 `meds.routes` 数组中，在 `/today` 之后插入 `/history` 路由条目，handler 调用 `runLazyRoute(context.signal, () => import('../pages/MedHistory'), (page) => page.renderMedHistoryPage(root, context.signal))`
  - [ ] SubTask 1.2: 新建 `medbox/src/pages/MedHistory.ts`，导出 `renderMedHistoryPage(root, signal)` 函数，先用 `renderPage({ root, title: '服药历史', activeTab: 'today', content: el('div', { class: 'page history-page' }) })` 渲染空骨架
  - [ ] SubTask 1.3: 新建 `medbox/src/ui/styles/pages/med-history.css`，先放空文件或最小占位样式；若 `styles.css` 用 `@import` 聚合 page css，则追加 `@import './pages/med-history.css';`
  - [ ] SubTask 1.4: 运行 `npm run build` 验证类型检查通过；浏览器访问 `#/history` 确认能渲染空页面
- [ ] Task 2: 数据加载与状态管理
  - [ ] SubTask 2.1: 在 `MedHistory.ts` 顶部定义 `interface HistoryState { rangePreset: '7d' | '30d' | '90d' | 'custom'; customStart?: LocalDate; customEnd?: LocalDate; filterMed: 'all' | string; filterSlot: 'all' | Slot; filterStatus: 'all' | 'taken' | 'skipped' | 'missed'; }`
  - [ ] SubTask 2.2: 实现 `loadHistoryData(state)` 异步函数：并发调用 `listMeds()` / `listScheduleRevisions()` / `listLogsByRange(rangeStart, rangeEnd)`，组装成 `{ medById, revisions, logs, occurrences }` 返回
  - [ ] SubTask 2.3: 实现 `computeRangeBounds(state)` 纯函数：根据 preset 与 today 计算起止 LocalDate；自定义区间若跨度 > 90 天则抛出 `RangeError`
  - [ ] SubTask 2.4: 实现 `groupOccurrencesByDate(occurrences, logs, medById)` 纯函数：返回按 localDate 倒序的 `Array<{ date, items: Array<{ occurrence, log, med, status }> }>`
  - [ ] SubTask 2.5: 为 `computeRangeBounds` 与 `groupOccurrencesByDate` 写单元测试到 `medbox/tests/medHistory.test.ts`

## P1 — 查看能力

- [ ] Task 3: 区间切换 chip 组
  - [ ] SubTask 3.1: 在 `MedHistory.ts` 实现 `renderRangeChips(state, onChange)`，使用 `SegmentedControl` 或自绘 chip 组（7 天 / 30 天 / 90 天 / 自定义），激活 chip 设置 `aria-pressed="true"`
  - [ ] SubTask 3.2: 自定义区间两个 date input（`<input type="date">`），最大可选今天，最小可选今天 - 89 天；change 事件触发 `onChange`
  - [ ] SubTask 3.3: 切换 chip 或自定义日期后调用 `loadHistoryData` 重新渲染；区间切换时显示 `skeletonCard()` 占位（仅当 preset='90d' 或自定义跨度 > 30 天时）
- [ ] Task 4: 区间汇总卡片
  - [ ] SubTask 4.1: 实现 `renderSummaryCard(occurrences, logs, today, now)`，调用 `calculateAdherence(occurrences, logs, now)` 获取汇总数据
  - [ ] SubTask 4.2: 卡片左侧：`progressRing(taken, due)` + "按时服药 X%"文案；右侧：4 个 metric（已服 / 跳过 / 漏服 / 已处理 X%），复用 `Today.ts` 的 `summaryMetric` 视觉风格
  - [ ] SubTask 4.3: 实现 `computeStreak(occurrencesByDate, today, now)` 纯函数：从 today 起向前回溯，每日所有 due 的 occurrence 均 taken 则计入；today 尚有 pending 不中断但不计入
  - [ ] SubTask 4.4: 卡片底部显示"连续服药 N 天"小徽章（`createStatusBadge('连续 N 天', 'success')`）；区间无 due 时显示"区间内没有已到期的服药安排"
  - [ ] SubTask 4.5: 为 `computeStreak` 写单元测试（覆盖"全勤""中断""今日未完成""区间无 due"四种情况）
- [ ] Task 5: 日卡片列表
  - [ ] SubTask 5.1: 实现 `renderDayCard(dayGroup, state, onRowClick)`，顶部为日期标题（"X 月 X 日 周X"）+ 当日 `progressRing` 小环
  - [ ] SubTask 5.2: 日卡片内按 slot 分组（早 / 中 / 晚 / 睡前，复用 `slotTag`），每组下渲染明细行
  - [ ] SubTask 5.3: 明细行结构：药盒缩略图（如有）/ 药名 / 时间 + 用量 + 餐前·餐中·餐后 / 状态徽章（`createStatusBadge`：已服→success、已跳过→warning、漏服→danger、待服→info）
  - [ ] SubTask 5.4: 漏服行（status=pending 且 dueAt < now）加 `is-missed` class，CSS 用 `--tone-warn-bg` 着色
  - [ ] SubTask 5.5: 超过 90 天的行加 `is-readonly` class，`title="超过 90 天的记录不可编辑"`，不绑定 click
- [ ] Task 6: 筛选条
  - [ ] SubTask 6.1: 实现 `renderFilterBar(state, meds, onChange)`，三个 `<select>`：药品（全部 + 所有非 deleted 药品 name）/ 时段（全部 + 4 个 slot）/ 状态（全部 / 已服 / 跳过 / 漏服）
  - [ ] SubTask 6.2: 筛选逻辑在 `groupOccurrencesByDate` 后应用：按 `filterMed` / `filterSlot` / `filterStatus` 过滤 items；过滤后空日卡片不渲染
  - [ ] SubTask 6.3: 筛选无结果时显示 `banner('info', '该区间内没有符合条件的记录')`
  - [ ] SubTask 6.4: 给三个 select 加 200ms 防抖（`setTimeout` + 清除上次 timer）

## P2 — 编辑能力

- [ ] Task 7: 操作 sheet
  - [ ] SubTask 7.1: 实现 `openHistoryActionSheet(occurrence, currentLog, onSelect)`，使用 `BottomSheet` 或 `confirmDialog` 风格，列出三个选项：标记已服 / 标记跳过 / 清除记录
  - [ ] SubTask 7.2: sheet 加 `role="dialog" aria-modal="true" aria-labelledby`；Escape 关闭；关闭后焦点归还触发行
  - [ ] SubTask 7.3: 选项根据当前 status 智能禁用：若已 taken，禁用"标记已服"；若已 skipped，禁用"标记跳过"；若 status=pending（无 log），禁用"清除记录"
- [ ] Task 8: setOccurrenceAction 集成
  - [ ] SubTask 8.1: 用户选择后调用 `setOccurrenceAction(occurrence, action)`，捕获 `MedicationIntakeError` 并 toast 原始消息
  - [ ] SubTask 8.2: 成功后 toast 反馈（"已记录为已服" / "已记录为跳过" / "已清除记录"）
  - [ ] SubTask 8.3: 成功后局部刷新：重新调用 `loadHistoryData` 并重渲染当前页（保留滚动位置与筛选状态）
  - [ ] SubTask 8.4: 库存不足时（`code='insufficient-inventory'`）允许"跳过"操作继续，但"已服"操作被阻断并 toast
  - [ ] SubTask 8.5: 已过期药品（`code='expired'`）阻断"已服"操作并 toast；"跳过"与"清除记录"仍允许
- [ ] Task 9: 集成测试
  - [ ] SubTask 9.1: 在 `medbox/tests/medHistory.test.ts` 添加 mock 测试：构造 occurrence + log，模拟用户点击行 → 选择"标记已服" → 验证调用 `setOccurrenceAction(occurrence, 'taken')`
  - [ ] SubTask 9.2: 模拟 expired 错误：mock `setOccurrenceAction` 抛 `MedicationIntakeError('expired')`，验证 toast 调用与状态不变

## P3 — 入口、性能与 a11y

- [ ] Task 10: 入口与导航
  - [ ] SubTask 10.1: 在 `Today.ts` 的 `renderWeekAdherenceCard` 卡片末尾追加"查看完整历史 →"链接（`<a href="#/history">`），加 `class="today-adherence-link"`
  - [ ] SubTask 10.2: 在 `Today.ts` 的 `renderPage` 调用中通过 `topRight` 传入历史图标按钮（`icon('clock')` 包在 `<button>` 里），`onclick` 调用 `navigate('/history')`
  - [ ] SubTask 10.3: 在 `MedHistory.ts` 的 `renderPage` 调用中通过 `topLeft` 传入返回按钮（`icon('arrow-left')` 包在 `<button>` 里），`onclick` 调用 `navigate('/today')`
  - [ ] SubTask 10.4: 检查 `medbox/src/ui/icons/iconRegistry.ts` 是否有 `clock` / `arrow-left` 图标；若缺则按 Tabler Icons 风格新增
- [ ] Task 11: 性能优化
  - [ ] SubTask 11.1: 在 `med-history.css` 为 `.history-day-card` / `.history-med-row` 加 `content-visibility: auto; contain-intrinsic-size: 96px`
  - [ ] SubTask 11.2: 90 天视图首次加载时先渲染 5 张 `skeletonCard()`，再异步替换为真实数据
  - [ ] SubTask 11.3: 滚动容器加 `overscroll-behavior: contain`
- [ ] Task 12: a11y 收尾
  - [ ] SubTask 12.1: 历史页 main 容器加 `aria-label="服药历史"`；区间 chip 组加 `role="group" aria-label="时间区间"`
  - [ ] SubTask 12.2: 日卡片标题用 `<h2>`；明细行用 `<article>` 加 `aria-label`（"X 月 X 日 早上 8:00 阿莫西林 已服"）
  - [ ] SubTask 12.3: 操作 sheet 选项加 `aria-label`；触控目标 ≥ 44px
  - [ ] SubTask 12.4: 暗色模式验证：所有 token 在 `[data-theme='dark']` 下可读，对比度 ≥ 4.5:1
  - [ ] SubTask 12.5: 键盘导航：Tab 顺序合理；Enter / Space 触发明细行点击；Escape 关闭 sheet
- [ ] Task 13: 端到端验证
  - [ ] SubTask 13.1: `npm run build` 类型检查通过
  - [ ] SubTask 13.2: `npm test` 全部通过（含新增 `medHistory.test.ts`）
  - [ ] SubTask 13.3: 浏览器手测：从今日页两个入口（图标 + 链接）进入历史页；切换 7/30/90 天；筛选药品/时段/状态；点击漏服行补记已服；点击已服行清除；返回今日页
  - [ ] SubTask 13.4: 暗色模式 + 横屏 + 减少动效各跑一遍
  - [ ] SubTask 13.5: 更新 `docs/handoffs/trae-qoder.md` 记录本次变更范围、文件、测试与剩余工作

# Task Dependencies

- Task 1（路由骨架）是所有 P1/P2/P3 任务的前置
- Task 2（数据加载）是 Task 3/4/5/6 的前置
- Task 2.4（groupOccurrencesByDate）是 Task 5（日卡片列表）的前置
- Task 4.3（computeStreak）是 Task 4.4（streak 徽章）的前置
- Task 5（日卡片列表）是 Task 7（操作 sheet 触发）的前置
- Task 7（操作 sheet）是 Task 8（setOccurrenceAction 集成）的前置
- Task 8 完成后才能跑 Task 9（集成测试）
- Task 10.2（今日页 topRight）依赖 Task 10.4（图标存在）
- P3 内部任务可并行（除 Task 13 依赖前面所有任务）
