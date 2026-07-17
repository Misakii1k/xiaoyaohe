# Tasks

按优先级与依赖关系组织。P0 优先处理 a11y 与暗色覆盖；P1 处理一致性、性能、视觉；P2 处理表单与剩余暗色；P3 处理代码维护与移动端细节。

## P0 — 无障碍与暗色覆盖基线

- [ ] Task 1: 修复 viewport meta 与触控目标基线
  - [ ] SubTask 1.1: 移除 `index.html` 中 `maximum-scale=1.0, user-scalable=no`
  - [ ] SubTask 1.2: `styles.css` 中 `.chip.sm` / `.btn.small` / `.work-entry-actions .btn.small` / `.key-toggle` 的 `min-height` 提到 44px（可视化高度可保持，但点击区扩展到 44px）
  - [ ] SubTask 1.3: `.work-running-toggle input` 用 `::before` 伪元素画一个 44px 的可视化点击区
- [ ] Task 2: Dialog 无障碍化
  - [ ] SubTask 2.1: 在 `components.ts` 新增 `openDialog(card, { onClose, labelId })` 工具，统一处理 `role="dialog"` `aria-modal="true"` `aria-labelledby`、焦点陷阱、autofocus、Escape 关闭、焦点归还
  - [ ] SubTask 2.2: 重构 `confirmDialog` 走 `openDialog`
  - [ ] SubTask 2.3: 重构 `WorkLog.openProfileDialog` / `openEntryDialog` / `previewSummaryDraft` 走 `openDialog`
- [ ] Task 3: Toast 与 Tabbar 无障碍
  - [ ] SubTask 3.1: `components.ts` 的 `toast` 容器加 `role="status" aria-live="polite" aria-atomic="true"`
  - [ ] SubTask 3.2: `components.ts` 的 `tabbar` 渲染处加 `aria-label="主导航"`；激活 tab 加 `aria-current="page"`
  - [ ] SubTask 3.3: chip 切换时同步 `aria-pressed`（修改 MedEdit / Settings 中的 chip 渲染逻辑）
- [ ] Task 4: 暗色 token 体系建设
  - [ ] SubTask 4.1: 在 `:root` 新增 `--tone-ok-fg/bg`、`--tone-warn-fg/bg`、`--tone-info-fg/bg`、`--tone-muted-fg/bg` token（浅色值）
  - [ ] SubTask 4.2: 在 `:root` 新增 `--slot-morning-fg/bg` 等 5 组 slot token（浅色值）
  - [ ] SubTask 4.3: 新增 `--icon-bg-gradient` token 替换 `.stat-row .ic-circle-sm` 的硬编码渐变
  - [ ] SubTask 4.4: 新增 `--shadow-xl` token（用于 `.tabbar` / `.overlay > .card`）
  - [ ] SubTask 4.5: 在 `[data-theme='dark']` 块为以上 token 全部赋暗色值
- [ ] Task 5: 暗色硬编码颜色迁移
  - [ ] SubTask 5.1: `.slot-morning/noon/evening/bedtime/with_meal` 改用 `--slot-*-fg/bg` token
  - [ ] SubTask 5.2: `.badge` 颜色改用 tone token
  - [ ] SubTask 5.3: `.banner.info/warn/ok` 文字色与背景色改用 tone token，确保对比度 ≥ 4.5:1
  - [ ] SubTask 5.4: `.panel-chip.tone-*` 与 `.tool-card-summary.tone-*` 改用 tone token
  - [ ] SubTask 5.5: `.tool-card` / `.meal-slot-row` / `.sub-card` / `.prescription-item` / `.panel-icon` 的硬编码 `rgba(255,255,255,...)` 改用 `--glass-thin` / `--glass-regular`
- [ ] Task 6: work-* 与 scan-* 暗色补丁
  - [ ] SubTask 6.1: 在 `[data-theme='dark']` 块为 `.work-status-pill` / `.work-settle-pill` / `.work-settle-pill.settled` / `.work-entry-row.running` / `.work-income-metric` 补充覆盖
  - [ ] SubTask 6.2: `.camera-preview` 保持 `#050505`；`.prescription-item` 改用 `--glass-regular`（已在 5.5 处理，此处仅验证）
  - [ ] SubTask 6.3: `prefers-reduced-transparency` 块内为 `[data-theme='dark']` 提供深色底色

## P1 — 一致性、性能与视觉

- [ ] Task 7: 统一 `field()` 工具与 emoji→SVG
  - [ ] SubTask 7.1: 在 `components.ts` 新增 `field(labelText, inputEl, opts?)` 工具，返回带 `.field` 类的包裹元素，支持可选 `errorId` 与错误文案位
  - [ ] SubTask 7.2: 替换 `MedEdit.ts:488-493` 的本地 `field` 实现
  - [ ] SubTask 7.3: 替换 `Settings.ts:770-775` 的本地 `field` 实现
  - [ ] SubTask 7.4: 替换 `WorkLog.ts:644-648` 的 `fieldWrap` 实现
  - [ ] SubTask 7.5: Settings 页所有 emoji 图标（💊 ⏰ ✅ 💼 ☁️ 🔔 ✨）替换为 `icon()` 调用，使用 `components.ts` 已有 SVG
- [x] Task 8: 字号 / 字重 / 间距 token 化
  - [x] SubTask 8.1: 硬编码字号（`.tool-card-title` 19px、`.tool-card-meta` 14px、`.tool-picker-kicker` 14px、`.tool-picker-title` 28px、`.work-summary-value` 25px、`.work-income-main` 40px、`.work-running-project` 22px、`.work-running-time` 36px、`.panel-chip` 13px、`.work-settle-pill` 12px）改用 `--fs-*` token
  - [x] SubTask 8.2: 非标准字重（650 / 850 / 900 / 800）规整为 400 / 500 / 600 / 700
  - [x] SubTask 8.3: 新增 `--space-1..--space-8` 间距 token（4/8/12/16/20/24/32/40），并在 `:root` 与暗色块（如需）定义
  - [x] SubTask 8.4: 修复 `.tool-picker-title` 的 `var(--label)` → `var(--label-primary)`
- [x] Task 9: 性能优化
  - [x] SubTask 9.1: `.page > *` 的 `glass-fade-up` 关键帧去掉 `filter: blur(4px)`，只保留 opacity + transform
  - [x] SubTask 9.2: `.nlu-box::before` 极光动画改为 IntersectionObserver 控制可见时 `animation-play-state: running`，不可见时 `paused`（在 `MedEdit.ts` 渲染时挂载 observer）
  - [x] SubTask 9.3: 给 FAB / `.tabbar::after` / `.toast` / `.chip.on` 等动画元素加 `will-change: transform, opacity`，动画结束移除（CSS 中静态声明即可，避免频繁切换）
  - [ ] SubTask 9.4: WorkLog 计时器 `innerHTML` 改为 `textContent`；监听 `document.visibilitychange`，隐藏时暂停 `setInterval`，可见时恢复并立即更新一次
  - [x] SubTask 9.5: 长列表项（`.work-entry-row` / `.med-card` / `.slot-card` / `.list-item`）加 `content-visibility: auto; contain-intrinsic-size: 80px`
- [ ] Task 10: Work Income Hero 配色与品牌对齐
  - [ ] SubTask 10.1: 新增 `--income-gradient` token（基于 `--brand` 的暖色渐变）
  - [ ] SubTask 10.2: `.work-income-hero` 改用 `--income-gradient`，文字保持白色但调高对比度
  - [ ] SubTask 10.3: 在 `[data-theme='dark']` 块为 `--income-gradient` 提供暗色版本

## P2 — 表单交互与剩余视觉

- [x] Task 11: 表单字段状态与校验反馈
  - [x] SubTask 11.1: `styles.css` 新增 `.field.error` 类（红边框 + 下方 `<small class="error-text">`）
  - [x] SubTask 11.2: 补充 `input:disabled { opacity: 0.5; cursor: not-allowed }` 与 `input:invalid { border-color: var(--ios-red) }`
  - [ ] SubTask 11.3: MedEdit 校验失败时给输入框加 `aria-invalid="true"` 与 `aria-describedby` 指向错误文案
  - [ ] SubTask 11.4: WorkLog `validateEntry` 失败时同上
- [ ] Task 12: Loading 组件与 `withBusyState`
  - [ ] SubTask 12.1: 在 `components.ts` 新增 `spinner(size?: number)` 返回一个带旋转动画的 SVG/CSS spinner
  - [ ] SubTask 12.2: 在 `components.ts` 新增 `skeletonCard()` 返回一个骨架占位卡片
  - [ ] SubTask 12.3: 在 `components.ts` 新增 `withBusyState(btn, fn)` 高阶函数，统一处理 disable/enable + 文案保存/恢复 + spinner 插入
  - [ ] SubTask 12.4: 重构 MedEdit / ScanSort / Settings / WorkLog 中 5+ 处手动 disable + innerHTML 模式，改用 `withBusyState`
- [x] Task 13: 移动端 UX 细节
  - [x] SubTask 13.1: Dialog `align-items: flex-start` + 顶部留白 + `overflow:auto`，避免虚拟键盘遮挡（在 `openDialog` 中实现）
  - [ ] SubTask 13.2: MedEdit 数字输入加 `inputmode="decimal"`；药名/规格加 `autocomplete="off"`
  - [ ] SubTask 13.3: Settings API 密钥字段加 `autocomplete="off"`
  - [x] SubTask 13.4: `html, body` 加 `overscroll-behavior-y: none`；`.work-edit-dialog` 与 `.overlay` 加 `overscroll-behavior: contain`
  - [x] SubTask 13.5: `topbar / #app / tabbar` 横屏 padding 补 `env(safe-area-inset-left/right)`（通过媒体查询 `@media (orientation: landscape)` 或直接加在 padding 中）
  - [ ] SubTask 13.6: ScanSort 的 `#code-reader` 加 `role="region" aria-label="扫码取景框"`；失败时给"重试"按钮（替换纯文字 banner）

## P3 — 代码维护与剩余 a11y

- [ ] Task 14: 死代码清理与重复定义合并
  - [ ] SubTask 14.1: 删除 `styles.css:1814-1823` 重复的 `prefers-reduced-motion` 块
  - [ ] SubTask 14.2: 删除 `styles.css:1713` 处 `.nlu-box` 第一次 background 定义
  - [ ] SubTask 14.3: 合并 `styles.css:992` 与 `1799` 两处 `.list-item` 定义
  - [ ] SubTask 14.4: 删除 `--glass-ultra-thin` token 的所有定义（`:root:27`、降级块 `1651`、暗色块 `1686`）
- [x] Task 15: 工具类与 `el()` 工厂增强
  - [x] SubTask 15.1: `styles.css` 新增 `.flex / .gap-2 / .gap-3 / .mt-2 / .mt-3 / .mt-4 / .sr-only / .text-danger` 等工具类
  - [x] SubTask 15.2: `components.ts` 的 `el()` 工厂显式处理 `aria-*` 与 `data-*`（用 `setAttribute`），其余走 `Object.assign`
  - [ ] SubTask 15.3: 逐步迁移 Today / MedEdit / ScanSort / Settings / WorkLog 中的高频内联 style 到工具类（先迁移 `margin-top:8/12/16px` 与 `display:flex` 等最常用的）
- [ ] Task 16: 标题层级与对比度修复
  - [ ] SubTask 16.1: 卡片标题 `<h3>` 改为 `<h2>`（Today / Settings / WorkLog 等）
  - [ ] SubTask 16.2: 验证 `.banner.warn/ok` 与 `.panel-chip.tone-*` 的对比度 ≥ 4.5:1（用浏览器 DevTools 检查；如不足则调整 token 值）

# Task Dependencies

- Task 4（暗色 token 体系）是 Task 5 与 Task 6 的前置
- Task 7.1（`field()` 工具）是 Task 11.1（`.field.error`）的参考，但不强依赖
- Task 12.1（`spinner()`）是 Task 12.3（`withBusyState`）的前置
- Task 2.1（`openDialog`）是 Task 13.1（虚拟键盘适配）的载体
- Task 8.3（间距 token）与 Task 15.1（工具类）建议一起做
- 其余任务可并行
