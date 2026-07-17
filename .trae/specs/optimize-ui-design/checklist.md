# Checklist

## P0 无障碍与暗色覆盖

- [ ] `index.html` 中 `maximum-scale=1.0, user-scalable=no` 已移除，保留 `viewport-fit=cover`
- [ ] `.chip.sm` / `.btn.small` / `.work-entry-actions .btn.small` / `.key-toggle` 的可点击区 ≥ 44px
- [ ] `.work-running-toggle input` 有 44px 的可视化点击区（伪元素或包裹元素）
- [ ] `confirmDialog` / `openProfileDialog` / `openEntryDialog` / `previewSummaryDraft` 都有 `role="dialog"` `aria-modal="true"` `aria-labelledby`
- [ ] 对话框打开时焦点移入，Tab 在对话框内循环，Escape 关闭，关闭后焦点归还触发元素
- [ ] Toast 容器有 `role="status" aria-live="polite" aria-atomic="true"`
- [ ] `<nav class="tabbar">` 有 `aria-label="主导航"`；激活 tab 有 `aria-current="page"`
- [ ] MedEdit / Settings 中所有 chip 切换时同步 `aria-pressed`
- [ ] `:root` 新增了 `--tone-*-fg/bg`、`--slot-*-fg/bg`、`--icon-bg-gradient`、`--shadow-xl` token
- [ ] `[data-theme='dark']` 块为以上所有 token 提供了暗色值
- [ ] `.slot-morning/noon/evening/bedtime/with_meal` 在暗色下文字与背景对比度 ≥ 4.5:1
- [ ] `.banner.info/warn/ok` 文字色在暗色下对比度 ≥ 4.5:1
- [ ] `.panel-chip.tone-*` 与 `.tool-card-summary.tone-*` 在暗色下对比度 ≥ 4.5:1
- [ ] `.tool-card` / `.meal-slot-row` / `.sub-card` / `.prescription-item` / `.panel-icon` 暗色下无刺眼白块
- [ ] `.work-status-pill` / `.work-settle-pill` / `.work-settle-pill.settled` / `.work-entry-row.running` 在暗色下可读
- [ ] `prefers-reduced-transparency` + `[data-theme='dark']` 同时启用时背景为深色

## P1 一致性、性能与视觉

- [ ] `components.ts` 新增了 `field(labelText, inputEl, opts?)` 工具
- [ ] MedEdit / Settings / WorkLog 三处本地 `field` / `fieldWrap` 已替换为统一实现
- [ ] Settings 页所有 emoji 图标（💊 ⏰ ✅ 💼 ☁️ 🔔 ✨）已替换为 `icon()` SVG
- [x] 所有硬编码字号（19/14/25/40/36/22/13/12px）改用 `--fs-*` token
- [x] 所有非标准字重（650/850/900/800）规整为 400/500/600/700
- [x] `.tool-picker-title` 的 `var(--label)` 已改为 `var(--label-primary)`
- [x] `--space-1..--space-8` 间距 token 已定义
- [x] `.page > *` 入场动画不再使用 `filter: blur()`
- [x] `.nlu-box::before` 极光动画在不可见时暂停（IntersectionObserver）
- [ ] FAB / `.tabbar::after` / `.toast` / `.chip.on` 有 `will-change` 声明
- [ ] WorkLog 计时器使用 `textContent` 而非 `innerHTML`
- [ ] WorkLog 计时器在页面隐藏时暂停，可见时恢复
- [ ] 长列表项有 `content-visibility: auto; contain-intrinsic-size: 80px`
- [ ] `.work-income-hero` 配色基于 `--brand`，与全站暖色系统协调
- [ ] `--income-gradient` token 已定义并在暗色块中覆盖

## P2 表单交互与剩余视觉

- [x] `.field.error` 类已实现（红边框 + 错误文案 `<small>`）
- [x] `input:disabled` 与 `input:invalid` 有显式样式
- [ ] MedEdit / WorkLog 校验失败时输入框有 `aria-invalid="true"` 与 `aria-describedby`
- [ ] `components.ts` 新增了 `spinner()` 组件
- [ ] `components.ts` 新增了 `skeletonCard()` 组件
- [ ] `components.ts` 新增了 `withBusyState(btn, fn)` 高阶函数
- [ ] MedEdit / ScanSort / Settings / WorkLog 中 5+ 处异步按钮已改用 `withBusyState`
- [ ] 对话框在虚拟键盘弹起时不被遮挡（`flex-start` + `overflow:auto`）
- [ ] MedEdit 数字输入有 `inputmode="decimal"`；药名/规格有 `autocomplete="off"`
- [ ] Settings API 密钥字段有 `autocomplete="off"`
- [x] `html, body` 有 `overscroll-behavior-y: none`；弹层滚动容器有 `overscroll-behavior: contain`
- [x] 横屏下 `topbar / #app / tabbar` padding 包含 `env(safe-area-inset-left/right)`
- [ ] ScanSort 的 `#code-reader` 有 `role="region" aria-label="扫码取景框"`；失败时有"重试"按钮

## P3 代码维护与剩余 a11y

- [ ] `styles.css:1814-1823` 重复的 `prefers-reduced-motion` 块已删除
- [ ] `styles.css:1713` 处 `.nlu-box` 第一次 background 定义已删除
- [ ] `styles.css:992` 与 `1799` 两处 `.list-item` 定义已合并
- [ ] `--glass-ultra-thin` token 的所有定义（`:root:27`、`1651`、`1686`）已删除
- [x] `styles.css` 新增了 `.flex / .gap-* / .mt-* / .sr-only / .text-danger` 工具类
- [ ] `el()` 工厂显式处理 `aria-*` 与 `data-*`（用 `setAttribute`）
- [ ] 高频内联 style（`margin-top:8/12/16px`、`display:flex`）已迁移到工具类
- [ ] 卡片标题改为 `<h2>`（不再出现 h1 → h3 的层级跳跃）
- [ ] `.banner.warn/ok` 与 `.panel-chip.tone-*` 对比度经 DevTools 验证 ≥ 4.5:1
