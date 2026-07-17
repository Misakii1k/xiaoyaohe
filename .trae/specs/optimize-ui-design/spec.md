# UI 设计与体验优化 Spec

## Why

medbox 是一款"适老化定制"的吃药提醒 + 工时记录 PWA，视觉上已经采用 iOS 26 Liquid Glass 设计语言。但在快速迭代过程中积累了大量 UI 一致性、无障碍、暗色覆盖、性能与表单交互方面的债务：

- 适老化目标与 `user-scalable=no`（禁用缩放）直接冲突，违反 WCAG 1.4.4
- 暗色模式下大量硬编码颜色（slot 标签、banner、panel-chip、work-*、tool-card-*）完全失效，文字与背景对比度严重不足
- 全屏 `body::before` mesh 渐变叠加 16+ 处 `backdrop-filter` 链，在中端安卓机上明显掉帧
- 对话框无焦点陷阱、Toast 无 `aria-live`、触控目标普遍 36-40px < 44px，键盘与屏幕阅读器用户基本不可用
- 表单只有 toast 反馈，缺字段级错误态、缺 spinner/skeleton、缺 `:disabled/:invalid` 样式
- `field()` / 加载态 / emoji 图标 / 内联 style 在 4 个页面被重复实现

本变更通过系统性、低风险、可逐步落地的改造，让 UI 在一致性、可访问性、暗色覆盖、性能与交互反馈五个维度达到"可发布的适老化 PWA"基线。

## What Changes

### 一致性 / 代码结构
- 抽出统一的 `field()` 工具到 `components.ts`，替换 MedEdit / Settings / WorkLog 三处重复实现
- 统一"返回工具箱"按钮实现（消除 WorkLog 自定义的 arrow-left 版本）
- Settings 页 emoji 图标（💊 ⏰ ✅ 💼 ☁️ 🔔 ✨）全部替换为 `icon()` SVG
- 所有硬编码字号（19px / 14px / 25px / 40px / 36px / 22px / 13px / 12px）改用 `--fs-*` token
- 非标准字重（650 / 850 / 900 / 800）规整为 400 / 500 / 600 / 700，必要时新增 `--fw-*` token
- 修复 `var(--label)` 引用不存在的 token 的 bug（`.tool-picker-title`）
- 抽出 `.flex / .gap-* / .mt-* / .sr-only / .text-danger` 等小工具类，逐步迁移内联 style
- `el()` 工厂显式处理 `aria-*` 与 `data-*`，避免依赖 ARIAMixin 反射

### 无障碍（P0）
- **BREAKING** 移除 `index.html` 中的 `maximum-scale=1.0, user-scalable=no`
- `confirmDialog` / `openProfileDialog` / `openEntryDialog` / `previewSummaryDraft` 增加 `role="dialog"` `aria-modal="true"` `aria-labelledby`、焦点陷阱、autofocus、Escape 关闭、关闭后焦点归还
- Toast 容器加 `role="status" aria-live="polite" aria-atomic="true"`
- 所有可点击元素的 `min-height` 提到 44px：`.chip.sm`（36→44）、`.btn.small`（40→44）、`.work-running-toggle input`（20→44 可视化点击区）、`.key-toggle`、`.work-entry-actions .btn.small`
- 修复对比度：`.banner.warn/ok`、`.panel-chip.tone-*`、`.tool-card-summary.tone-*` 文字色保证 ≥ 4.5:1
- 卡片标题用 `<h2>` 替代 `<h3>`，修复 h1 → h3 的层级跳跃
- `<nav class="tabbar">` 加 `aria-label="主导航"`；激活 tab 加 `aria-current="page"`
- chip 切换时同步 `aria-pressed`

### 暗色模式覆盖（P0）
- 新增 `--tone-ok-fg/bg`、`--tone-warn-fg/bg`、`--tone-info-fg/bg`、`--tone-muted-fg/bg` 语义色 token 体系
- 为 slot 标签新增 `--slot-morning-fg/bg` 等 5 组 token，在 `[data-theme='dark']` 重新赋值
- `.tool-card` / `.meal-slot-row` / `.sub-card` / `.prescription-item` / `.panel-icon` 等硬编码 `rgba(255,255,255,...)` 全部替换为 `--glass-thin` / `--glass-regular`
- `.work-status-pill` / `.work-settle-pill` / `.work-entry-row.running` 等 work-* 系列在暗色块补充覆盖
- `.stat-row .ic-circle-sm` 渐变抽成 `--icon-bg-gradient` token
- `prefers-reduced-transparency` 与暗色模式组合时给暗色底色

### 移动端 UX
- 对话框 `align-items: flex-start` + 顶部留白 + `overflow:auto`，避免虚拟键盘遮挡
- 数字输入加 `inputmode="decimal"`；密码与药名字段加 `autocomplete="off"`
- `html, body` 加 `overscroll-behavior-y: none`；弹层滚动容器加 `overscroll-behavior: contain`
- `topbar / #app / tabbar` 横屏 padding 补 `env(safe-area-inset-left/right)`
- 扫码区 `#code-reader` 加 `role="region" aria-label="扫码取景框"`，失败时给出"重试"按钮

### 视觉设计
- **BREAKING** `.work-income-hero` 渐变从深绿青蓝改为基于 `--brand` 的暖色系，或定义 `--income-gradient` token
- 定义 `--space-1..--space-8`（4/8/12/16/20/24/32/40）间距 token，逐步替换硬编码 gap/margin
- 新增 `--shadow-xl`，替换 `.tabbar` / `.overlay > .card` 中硬编码的 shadow
- `.tool-card` 改用 `--glass-thin`

### 性能
- `.page > *` 入场动画去掉 `filter: blur(4px)` 关键帧，只保留 `opacity + transform`
- `.nlu-box::before` 极光动画改为"可见时才运行"（IntersectionObserver 控制 `animation-play-state`）
- 给 FAB / tabbar 指示器 / toast / chip-pop 等动画元素加 `will-change`，动画结束移除
- WorkLog 计时器从 `innerHTML` 改为 `textContent`，页面隐藏时暂停
- 长列表项（`.work-entry-row` / `.med-card` / `.slot-card` / `.list-item`）加 `content-visibility: auto; contain-intrinsic-size: 80px`
- 评估 `.list-item` / `.work-entry-row` 是否需要保留 `backdrop-filter`（建议移除以减少 paint）

### 表单与交互
- 新增 `.field.error` 类（红边框 + 错误文案 `<small>`）+ `aria-invalid` + `aria-describedby`
- 补充 `input:disabled { opacity: 0.5 }` 与 `input:invalid { border-color: var(--ios-red) }`
- 在 `components.ts` 新增 `spinner()` 与 `skeletonCard()` 组件
- 抽出 `withBusyState(btn, fn)` 高阶函数，统一异步按钮 disable/enable + 文案 + spinner
- `confirmDialog` 增加 Escape 关闭与遮罩点击的明确语义

### 死代码清理
- 删除 `styles.css:1814-1823` 重复的 `prefers-reduced-motion` 块
- 删除 `styles.css:1713` 处 `.nlu-box` 第一次 background 定义（被 1999 处覆盖）
- 合并 `styles.css:992` 与 `1799` 两处 `.list-item` 定义
- 删除 `--glass-ultra-thin` token 的所有定义（未被使用）

## Impact

- Affected specs: 无既有 spec 文档（本仓库首次引入 spec-driven 工作流）
- Affected code:
  - `medbox/index.html` —— viewport meta
  - `medbox/src/ui/styles.css` —— 主要改造对象（token 新增、暗色覆盖、死代码清理、动画优化）
  - `medbox/src/ui/components.ts` —— `field()` / `spinner()` / `skeletonCard()` / `withBusyState()` / Dialog 焦点陷阱 / Toast aria-live / `el()` aria-* 处理
  - `medbox/src/pages/Today.ts` —— 标题层级、工具类迁移
  - `medbox/src/pages/MedList.ts` —— 工具类迁移
  - `medbox/src/pages/MedEdit.ts` —— `field()` 统一、emoji→SVG（无）、`aria-pressed`、`inputmode`、字段级校验
  - `medbox/src/pages/ScanSort.ts` —— 扫码区 a11y、重试按钮、loading 组件
  - `medbox/src/pages/Settings.ts` —— emoji→SVG、`field()` 统一、`autocomplete`
  - `medbox/src/pages/ToolPicker.ts` —— `var(--label)` 修复、`--glass-thin` 迁移
  - `medbox/src/pages/WorkLog.ts` —— 对话框焦点陷阱、计时器 textContent、`field()` 统一、`work-income-hero` 配色、loading 组件、横屏 safe-area
- 不涉及数据层 (`db/`)、AI 层 (`ai/`)、sync 层 (`sync/`)、worker
- 不破坏既有路由 / 数据模型 / API 契约
- 不引入新依赖

## ADDED Requirements

### Requirement: 语义化 Design Token 体系

系统 SHALL 在 `:root` 中提供完整的语义化 token，覆盖间距、字重、tone 色、slot 色、图标背景渐变、超大阴影，并在 `[data-theme='dark']` 与 `prefers-reduced-transparency` 中提供对应覆盖。

#### Scenario: Tone 色统一
- **WHEN** 开发者需要给 chip / pill / banner / summary 染色
- **THEN** 通过 `var(--tone-ok-fg)` / `var(--tone-ok-bg)` 等 token 引用，不出现硬编码 `#15803d` / `rgba(52,199,89,0.14)` 等

#### Scenario: Slot 色暗色覆盖
- **WHEN** 用户切换到暗色模式
- **THEN** 所有 slot 标签（早/午/晚/睡前/餐中）保持可读对比度（≥ 4.5:1），不再出现黑底黑字

### Requirement: 工具类与组件工厂扩展

系统 SHALL 在 `components.ts` 中提供 `field()`、`spinner()`、`skeletonCard()`、`withBusyState()`、`openDialog()` 五个新工具，并由 `el()` 工厂统一处理 `aria-*` / `data-*` 属性。系统 SHALL 在 `styles.css` 中提供 `.flex` / `.gap-*` / `.mt-*` / `.sr-only` / `.text-danger` 等工具类。

#### Scenario: 字段包裹统一
- **WHEN** 任意页面需要"标签 + 输入框 + 错误文案"组合
- **THEN** 调用 `field(label, input)` 返回结构化 DOM，避免重复实现

#### Scenario: 异步按钮 loading
- **WHEN** 用户点击触发异步操作的按钮
- **THEN** 按钮显示 spinner + 禁用，操作完成后自动恢复，无需各页面手写

### Requirement: 对话框无障碍

所有模态对话框 SHALL 满足：`role="dialog"` `aria-modal="true"` `aria-labelledby`、打开时焦点移入、Tab 键在对话框内循环、Escape 关闭、关闭后焦点归还触发元素。

#### Scenario: 键盘用户取消
- **WHEN** 用户按 Escape 键
- **THEN** 对话框关闭并返回 `false`，焦点回到触发按钮

### Requirement: Toast 屏幕阅读器播报

Toast 容器 SHALL 标注 `role="status" aria-live="polite" aria-atomic="true"`，确保异步反馈被辅助技术播报。

### Requirement: 触控目标达标

所有可点击元素的可视化点击区 SHALL 不小于 44×44 CSS px。

#### Scenario: 小 chip 满足触控
- **WHEN** 渲染 `.chip.sm`
- **THEN** 实际可点击区高度 ≥ 44px（可视化高度可保持 36px，但通过 padding/伪元素扩展点击区）

### Requirement: 暗色模式完全覆盖

所有可见元素 SHALL 在 `[data-theme='dark']` 下保持可读性与视觉一致性，不存在硬编码白色背景、不存在对比度 < 4.5:1 的文字。

### Requirement: 入场动画性能

`.page > *` 入场动画 SHALL 仅使用 `opacity` 与 `transform`，不使用 `filter: blur()`。

### Requirement: 极光动画按需运行

`.nlu-box::before` 的极光动画 SHALL 仅在 NLU 区可见时运行，不可见时暂停以节省 GPU。

### Requirement: 加载态组件化

异步操作（识别、AI 处理、检测、保存）SHALL 使用统一的 `spinner()` 或 `skeletonCard()` 组件展示进度，不依赖纯文字"处理中…"。

## MODIFIED Requirements

### Requirement: Viewport Meta

`index.html` 的 viewport meta SHALL 包含 `viewport-fit=cover`，SHALL NOT 包含 `maximum-scale` 或 `user-scalable=no`，以允许低视力用户缩放页面。

### Requirement: 表单字段状态

`styles.css` 中的输入框 SHALL 显式定义 `:focus` / `:disabled` / `:invalid` 三种状态样式，并通过 `.field.error` 类配合 `aria-invalid` 与 `aria-describedby` 提供字段级错误反馈。

### Requirement: WorkLog 计时器更新

WorkLog 运行中卡片的计时器 SHALL 使用 `textContent` 更新数字，SHALL 在页面隐藏时（`visibilitychange` 不可见）暂停更新。

### Requirement: Work Income Hero 配色

`.work-income-hero` SHALL 使用基于品牌色（`--brand`）的渐变或专门的 `--income-gradient` token，与全站 Liquid Glass 暖色系统协调，不再使用脱离品牌的深绿青蓝渐变。

## REMOVED Requirements

### Requirement: 重复的 prefers-reduced-motion 块

**Reason**: `styles.css:1673-1681` 与 `1814-1823` 完全重复，造成维护负担
**Migration**: 删除后一处（1814-1823），保留前一处

### Requirement: `.nlu-box` 第一次 background 定义

**Reason**: `styles.css:1713` 的渐变被 `1999-2005` 完全覆盖，是死代码
**Migration**: 删除 1713 处的 background 声明

### Requirement: `--glass-ultra-thin` token

**Reason**: `styles.css:27`、`1651`、`1686` 三处定义均未被任何规则引用
**Migration**: 删除所有 `--glass-ultra-thin` 的定义
