# 小药盒 (medbox) 系统级 UI/UX 设计规范

> **版本**：1.1.0  
> **更新时间**：2026-10-10  
> **适用工程**：`medbox/` (Android Capacitor + TypeScript PWA)  
> **定位**：跨多工具（Claude / GPT / Grok / Trae-Qoder / 人类工程师）的**唯一设计真理源（Single Source of Truth）**。任何 UI 修改、新增页面或重构必须严格遵守本规范。

---

## 目录

1. [设计哲学与用户画像 (Philosophy & Personas)](#1-设计哲学与用户画像)
2. [Design Tokens 与视觉基础 (Visual Foundation & Tokens)](#2-design-tokens-与视觉基础)
3. [适老化与无障碍标准 (Accessibility & Senior-Friendly)](#3-适老化与无障碍标准)
4. [组件层级与交互模式 (Component Hierarchy & Patterns)](#4-组件层级与交互模式)
5. [核心业务场景界面规范 (Core Business Screen Specs)](#5-核心业务场景界面规范)
6. [动效、渲染性能与多端适配 (Motion, Performance & Edge-to-Edge)](#6-动效渲染性能与多端适配)
7. [代码落地映射与开发契约 (Code Mapping & Engineering Contracts)](#7-代码落地映射与开发契约)

---

## 1. 设计哲学与用户画像

### 1.1 核心设计定位：双轨并重

小药盒（medbox）兼顾**年轻照护者/科技爱好者**对精致现代、秩序井然美感的追求，与**长辈/视力障碍者**对极端清晰、确定易用的刚需。

```mermaid
graph LR
  A[小药盒设计基准] --> B[现代实色微质感 Solid Tactile]
  A --> C[WCAG 2.2 AAA/AA 适老化]
  
  B --> B1[实色白/暗炭底板 surface-solid]
  B --> B2[1px 细腻物理微边框 border]
  B --> B3[克制浅层微阴影 shadow-sm/md]
  B --> B4[零模糊滤镜 / 极致流畅 60fps]
  
  C --> C1[最小字号 14px 底线]
  C --> C2[触控热区 ≥ 44px]
  C --> C3[高对比色彩矩阵 ≥ 4.5:1]
  C --> C4[200% 弹性无损缩放]
```

### 1.2 核心设计铁律

1. **认知负荷极小化（Zero Cognitive Friction）**
   - 核心任务（如「确认服药」、「查看今天还有什么药没吃」）在 1 步以内直达。
   - 避免深层嵌套路由，常规编辑与向导统一使用半屏/底部抽屉（Bottom Sheet）。
2. **容错与误触防御（Defensive UI & Forgiveness）**
   - 危险操作（删除药品、重置数据）必须二次居中确认，且默认高亮安全选项（取消）。
   - 服药打卡支持误触一键撤销（带「撤销」动作的 Undo Toast，保留 5 秒）。
3. **确定性视觉反馈（Deterministic Feedback）**
   - 每次点击必须伴随即时的触摸反馈（`:active` 物理下沉 `scale(0.97)`、状态徽标即时刷新、带 `aria-live` 的屏幕播报）。
4. **全环境自洽（Environment Resilience）**
   - 强阳光下清晰可读，夜间暗色模式不刺眼。
   - 离线可用，局域网一键同步，无网络依赖焦虑。

---

## 2. Design Tokens 与视觉基础

所有颜色、字阶、间距、圆角与阴影必须通过 CSS 变量（`tokens.css`）引用，**严禁在页面或组件中使用任何硬编码色值或绝对像素**。

### 2.1 色彩体系与语义

#### 品牌主色 (Brand & Accents)
- **Primary / 品牌主色**：
  - 浅色：`--color-primary: #236a55` (清爽青绿，沉稳高对比) | 渐变：`--color-primary-gradient: linear-gradient(135deg, #236a55 0%, #175940 100%)` | 按下态：`--color-primary-pressed: #175940`
  - 深色：`--color-primary: #48a88c` (柔和草青) | 渐变：`linear-gradient(135deg, #48a88c 0%, #368f74 100%)` | 按下态：`--color-primary-pressed: #368f74`
- **Hero / 层次渐变**：
  - 浅色：`--color-hero-gradient: linear-gradient(135deg, #236a55 0%, #34785c 50%, #4a8c72 100%)`
  - 深色：`linear-gradient(135deg, #48a88c 0%, #57b594 50%, #74d6a2 100%)`
- **Soft / 强调浅底**：
  - 浅色：`--color-primary-soft: #e3ede6` | 深色：`--color-primary-soft: #183329`
- **On-Primary / 主色上文本**：
  - 浅色：`--color-on-primary: #ffffff` (对比度 6.43:1)
  - 深色：`--color-on-primary: #0d1a16` (对比度 6.17:1)

#### 状态色彩 (Status Tones)
状态色彩必须严格满足 WCAG 2.2 AA (对比度 ≥ 4.5:1)：

| 状态类型 | 语义含义 | 浅色 Token (`-fg` / `-bg` / `-border`) | 深色 Token (`-fg` / `-bg` / `-border`) |
|---|---|---|---|
| **Tone Ok** | 已服药 / 库存充足以 / 同步成功 | `#17603f` / `#e4f5ec` / `#b9e2cb` | `#74d6a2` / `rgba(52,199,89,0.18)` / `rgba(52,199,89,0.40)` |
| **Tone Warn** | 即将服药 / 库存偏低 / 离线提醒 | `#8a4c0d` / `#fdefdf` / `#ecc794` | `#fbbf24` / `rgba(255,149,0,0.20)` / `rgba(255,149,0,0.40)` |
| **Tone Danger** | 漏服 / 药品过期 / 严重错误 | `#a32f38` / `#fdebec` / `#f0bcc0` | `#f87171` / `rgba(255,59,48,0.18)` / `rgba(255,59,48,0.40)` |
| **Tone Info** | 提示信息 / 建议 / 统计说明 | `#4348a8` / `#eaeafb` / `#c9caf1` | `#9aa8f5` / `rgba(122,108,244,0.20)` / `rgba(122,108,244,0.42)` |
| **Tone Muted** | 次要辅助 / 占位 / 未开启 | `var(--color-text-muted)` / `var(--color-surface-muted)` / `var(--color-border)` | 同左 |

#### 时段色彩 (Time Slot Accents)
时段色与用药状态色彩隔离，专用于一天内不同服药时间槽位：
- 🌅 **Morning (早)**：`--tint-orange-fg` (`#a3671f` / `#eab676`) | 背景：`--tint-orange-bg`
- ☀️ **Noon (午)**：`--tint-blue-fg` (`#35a2a9` / `#7fd0d5`) | 背景：`--tint-blue-bg`
- 🌇 **Evening (晚)**：`--tint-purple-fg` (`#666dd2` / `#a3a8f0`) | 背景：`--tint-purple-bg`
- 🌙 **Bedtime (睡前)**：`--tint-pink-fg` (`#d05a68` / `#f0a3ac`) | 背景：`--tint-pink-bg`

### 2.2 实体表面材质与暗色系统 (Physical Surfaces & Dark Mode)

> **全局下线水凝玻璃与模糊滤镜**：本项目遵循 oil-ui 现代实色微质感规范，彻底下线液态水凝玻璃（Liquid Glass）、SVG 变形透镜及全屏高斯模糊滤镜。所有卡片与容器采用实色底板（`--color-surface-solid`）、1px 物理微边框（`--color-border`）与克制的浅层物理微阴影（`--shadow-sm` / `--shadow-md`）构建，杜绝多层模糊造成的 GPU 重绘风暴与掉帧。

```css
/* 浅色基底 */
:root {
  --color-bg: #f6f8f7;
  --color-bg-mesh: #f6f8f7;
  --color-surface: rgba(255, 255, 255, 0.94);
  --color-surface-solid: #ffffff;
  --color-surface-muted: #edf1ef;
  --color-text: #202e2b;
  --color-text-muted: #64706b;
  --color-border: #e1e8e4;
  --shadow-sm: 0 1px 3px rgba(32, 46, 43, 0.04), 0 4px 12px rgba(32, 46, 43, 0.03);
  --shadow-md: 0 4px 16px rgba(35, 106, 85, 0.07), 0 2px 6px rgba(32, 46, 43, 0.04);
  --shadow-lg: 0 12px 32px rgba(35, 106, 85, 0.10), 0 4px 12px rgba(32, 46, 43, 0.06);
  --scrim: rgb(28 30 38 / 36%);
}

/* 深色模式：系统与应用设置统一在 <html data-theme="dark"> 上触发 */
:root[data-theme='dark'] {
  --color-bg: #17181d;
  --color-bg-mesh: #17181d;
  --color-surface: rgba(30, 34, 32, 0.92);
  --color-surface-solid: #1e2220;
  --color-surface-muted: rgba(40, 46, 44, 0.9);
  --color-text: #edf2ef;
  --color-text-muted: #95a39e;
  --color-border: rgba(70, 84, 79, 0.75);
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.24);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.32);
  --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.40);
  --scrim: rgba(0, 0, 0, 0.56);
}
```

### 2.3 排版字阶 (Typography Scale)

基准字体族：`--font-sans: 'MiSans', 'HarmonyOS Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif`。

| Token | 字号 (px) | 字重 (Weight) | 行高 | 典型应用场景 |
|---|---|---|---|---|
| `--fs-largeTitle` | 32px | 700 / 800 | 1.2 | 大卡片主统计数字、全屏倒计时 |
| `--fs-title1` | 28px | 700 | 1.25 | 一级页面大标题、今日打卡进度 |
| `--fs-title2` | 22px | 600 | 1.3 | 二级顶栏标题、弹窗/抽屉主标题 |
| `--fs-title3` | 18px | 600 | 1.35 | 药品卡片主药名、时段组标题 |
| `--fs-body` | **16px** (基准) | 400 / 500 / 600 | 1.5 | 正文字段、按钮文字、输入框输入文本 |
| `--fs-subheadline`| 14px | 500 | 1.45 | 次要标签、规格剂量说明 |
| `--fs-footnote` | 14px | 400 | 1.4 | 提示文字、错误信息、表单 Helper |
| `--fs-caption` | **14px** (底线) | 500 / 600 | 1.3 | 胶囊徽标、角标文字（**严禁 < 12px**） |

### 2.4 间距、圆角与热区 (Spacing, Radii & Tap Targets)

- **触控热区基准**：`--tap: 44px`（所有可点击元素的点击盒模型严格不得小于 44×44 CSS px）。
- **间距递进 (Spacing Token)**：
  - `--space-1: 4px` (微距、图标与文字内嵌微调)
  - `--space-2: 8px` (紧凑元素间距、输入框内边距)
  - `--space-3: 12px` (标准组件内边距、小卡片内边距)
  - `--space-4: 16px` (页面左右安全边距、标准卡片内边距)
  - `--space-5: 20px` (抽屉/弹窗内边距、卡片间距)
  - `--space-6: 24px` (区块间距)
  - `--space-7: 32px` (大模块留白)
  - `--space-8: 40px` (页面底部留白)
- **圆角层级 (Border Radii)**：
  - `--radius-sm: 10px` (输入框、紧凑小按钮、选项条目)
  - `--radius-md: 16px` (标准卡片、折叠面板、对话框主卡)
  - `--radius-lg: 20px` (主操作大卡片、浮动弹窗主体)
  - `--radius-xl: 26px` (今日主面板、大尺寸悬浮层、底部抽屉顶角)
  - `--radius-full: 999px` (胶囊 Pill、徽标 Badge、圆形图标)

---

## 3. 适老化与无障碍标准

遵循 **WCAG 2.2 Level AA / 核心条目 AAA** 规范。

### 3.1 视口缩放与大字适配 (WCAG 1.4.4)
- **绝对禁止锁死缩放**：`index.html` 的 `viewport` 必须为 `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">`，严禁包含 `user-scalable=no` 或 `maximum-scale=1.0`。
- **200% 缩放自适应**：
  - 所有卡片内部文字容器禁止使用固定 `height` 或 `overflow: hidden` 强制单行省略。
  - 使用 `flex-wrap: wrap` 与 `min-inline-size: 0` 保证在系统字体放大至 200% 时，药品名称、剂量单位和打卡按钮自动向下折行，不破坏布局。

### 3.2 触控目标与无障碍热区 (WCAG 2.5.5)
- 所有独立交互元素（按钮、开关、Tab 选项、列表展开 Chevron、Chip 胶囊）必须满足 `min-block-size: var(--tap)` (44px)。
- 视觉紧凑的次级小图标（如 24px 的删除图标），必须通过伪元素或透明内边距扩展至 44px 的有效命中区域：
  ```css
  .icon-btn-compact {
    inline-size: 24px;
    block-size: 24px;
    padding: 10px; /* 实际触控区 44x44px */
  }
  ```

### 3.3 语义化结构与屏幕阅读器支持 (ARIA & Focus)
1. **模态弹窗与抽屉**：
   - 根容器必须声明 `role="dialog"` 与 `aria-modal="true"`，并用 `aria-labelledby` 关联标题 ID。
   - 打开时自动聚焦于首个输入框或主操作按钮；Tab 键在弹窗内形成**焦点陷阱（Focus Trap）**；按 `Escape` 键关闭并立即将焦点归还触发元素。
2. **异步状态播报 (Toast & Status)**：
   - Toast 容器必须包含 `role="status"`、`aria-live="polite"`、`aria-atomic="true"`。
   - Toast 呈现居中高对比胶囊形态，支持操作动作（如「撤销」按钮），保持 5 秒展示窗口供用户容错。
3. **切换状态同步**：
   - 可切换胶囊（Chip / Segmented Button）必须通过 `aria-pressed="true|false"` 显式声明状态。
4. **导航地标**：
   - 底部主导航必须标记 `<nav class="tabbar" aria-label="主导航">`，当前选中项标记 `aria-current="page"`。

---

## 4. 组件层级与交互模式

```mermaid
flowchart TD
  UserAction[用户操作/交互] --> ActionType{操作性质}
  
  ActionType -->|常规业务流程/多步编辑| BottomSheet[底部抽屉 Bottom Sheet]
  ActionType -->|危险阻断/不可逆销毁| CenterDialog[居中对话框 Center Dialog]
  ActionType -->|时间/日期/选项选择| CustomPicker[软件自有自绘控件 primitives]
  ActionType -->|即时状态/轻量提示/容错| ToastNotice[轻量播报 Toast / aria-live]
  
  BottomSheet --> DragClose[支持下滑手势 & ESC]
  CenterDialog --> SafeDefault[默认高亮取消按钮]
  CustomPicker --> UnifiedTheme[自绘统一外观 & 原生 input 同步]
```

### 4.0 控件自有设计规范与自绘优先原则 (Custom Controls First)

> **核心契约**：现有及今后新增的所有功能，凡需要控件，**一律先用 `src/ui/primitives/` 里的自绘控件，严禁直接使用安卓/浏览器原生弹层控件**：
> - **时间**：`createTimeControl`
> - **日期**：`createDateControl`
> - **日期时间**：`createDateTimeControl`
> - **下拉**：`createSelectControl`（已有 `<select>` 且选项动态变化时用 `enhanceSelect` 就地替换）
> - **数字加减**：`createStepper`
> - **弹层/抽屉**：`openBottomSheet`
> - **按钮**：`createButton` / 标准 `.btn`
> - **分段切换**：`SegmentedControl`
> - **复选框 / 单选 / 开关**：直接使用原生语义 `<input type="checkbox|radio">` 与 `role="switch"`，外观由 `primitives.css` 全局统一规范，严禁使用浏览器私有样式或页面内 `accent-color`。
> - **扩展规范**：现有控件不满足需求时，先扩展 `primitives` 再使用，严禁在页面或业务模块中另起炉灶。

### 4.1 按钮层级系统 (Button Hierarchy)

| 按钮类型 | CSS 类名 | 视觉表现 | 使用场景 |
|---|---|---|---|
| **主按钮 (Primary)** | `.btn` 或 `.ui-button-primary` | 实色主色背景 + 白字 + 柔和投影 | 核心确认、确认服药、保存、创建 |
| **次级按钮 (Tonal)** | `.btn.tonal` 或 `.ui-button-secondary` | 浅绿背景 (`--color-primary-soft`) + 主色字 | 辅助操作、添加药品、查看明细 |
| **描边按钮 (Outlined)** | `.btn.outlined` | 白色实底 + 1px 主色边框 | 备选操作、更换照片、重试 |
| **危险按钮 (Danger)** | `.ui-button-danger` | 红色背景 (`--color-danger`) + 白字 | 删除药品、清空记录、解绑同步 |
| **文本按钮 (Text)** | `.btn.text` 或 `.ui-button-text` | 无边框实底 + 主色文字 | 取消、跳过、返回上一步 |
| **顶栏胶囊 (Topbar Pill)**| `.topbar-pill` | 药丸形态 + 图标 + 文字 (36px高/44px热区) | 顶栏快捷操作（如「+ 添加」、「✦ AI 助手」） |

- **触摸动效**：`.btn:active:not([disabled]) { transform: scale(0.97); }`。
- **异步加载态**：使用 `withBusyState(btn, asyncFn)` 统一包裹，按钮自动进入 `disabled` 状态并渲染 `spinner()`，严禁手写不一致的加载文字。

### 4.2 模态分层机制 (Modal System)

1. **底部抽屉 (Bottom Sheet)**：
   - 覆盖层：`.bottom-sheet-overlay` (`z-index: 240`，柔和黑色蒙层 `--scrim`)。
   - 抽屉容器：`.bottom-sheet` (`max-block-size: min(80dvh, 720px)`，上圆角 `--radius-xl`，实色底板)。
   - 用途：用药录入、药品批量编辑、服药打卡修正、AI 识别结果确认。
2. **居中对话框 (Center Dialog)**：
   - 覆盖层：`z-index: 300`。
   - 约束：卡片宽度 `min(90vw, 420px)`，标题字阶 `--fs-title2`，主文案 `--fs-body`，底部操作按钮采用双列网格（取消在左，确认在右）。
   - 用途：删除确认、重置警告、权限缺失说明。

### 4.3 表单与输入校验 (Forms & Validation)

- **统一字段结构**：所有输入项必须通过 `components.ts` 的 `field(label, input, options)` 工厂函数构造：
  ```html
  <div class="ui-form-field">
    <label for="med-name">药品名称 <span class="required">*</span></label>
    <input id="med-name" type="text" autocomplete="off" />
    <span class="ui-form-field-hint">请输入药品通用名或商品名</span>
  </div>
  ```
- **错误态反馈**：
  - 触发错误时，容器添加 `.ui-form-field.error` 类，输入框自动获得红边框 (`--color-danger`)，并渲染 `<span class="ui-form-field-error" role="alert">错误原因</span>`。
  - 输入框自动添加 `aria-invalid="true"` 与 `aria-describedby` 关联错误节点。

### 4.4 移动端界面排版与交互防御准则 (Mobile Layout Defensive Rules)

1. **标签徽章防折行**：
   - 所有时段标签、状态胶囊必须声明：
     ```css
     white-space: nowrap;
     flex-shrink: 0;
     min-width: max-content;
     ```
   - 杜绝在小屏手机上中文字符被挤压竖排断行（如 `早\n上`、`待\n服`）。
2. **列向容器子按钮尺寸防御**：
   - 列向弹性容器（`flex-direction: column`）中的按钮子项必须显式限定：
     ```css
     flex: 0 0 auto;
     min-block-size: var(--tap);
     ```
   - 防止意外继承行内伸缩基准导致纵向高度异常拉伸变形。
3. **移动端向导步进条**：
   - 移动端多步骤表单避免使用包含全部文字的横向圆圈连线步骤条。
   - 统一采用「单行居中步骤标题 + 极细平滑分段指示条」的极简进度条风格。
4. **双列网格卡片与轻量选中态**：
   - 批量管理等双列密集网格卡片避免划分独立的左侧复选框列，优先使用居中垂直流布局充分利用卡片空间。
   - 卡片选中态统一采用纯紫色/品牌色高亮轮廓：
     ```css
     box-shadow: 0 0 0 2px var(--color-primary);
     ```
   - 严禁使用突兀的大对勾或整卡实心底色填充。

---

## 5. 核心业务场景界面规范

### 5.1 今日服药场景 (Today Dashboard)

```
+-----------------------------------------------------------+
| [小药盒 Logo]  今天 (8月20日 星期四)         [+ 快速录入]  |
+-----------------------------------------------------------+
| +-------------------------------------------------------+ |
| |  [ 环形进度 75% ]  今日已服 3 / 4 次用药计划          | |
| |                    下次服药：晚间 (18:30) 降压药      | |
| +-------------------------------------------------------+ |
|                                                           |
| 🌅 早间服药 (08:00)                         [ 全部已服 ✅ ]|
| +-------------------------------------------------------+ |
| | 💊 氨氯地平片 (5mg)   1片 / 饭后服          [ 已服 08:15 ]|
| | 💊 复合维生素B        2片 / 随餐服          [ 已服 08:15 ]|
| +-------------------------------------------------------+ |
|                                                           |
| 🌇 晚间服药 (18:30)                         [ 待服药 ⏰ ] |
| +-------------------------------------------------------+ |
| | 💊 阿托伐他汀钙片     10mg / 睡前嚼服       [ 马上吃药 🔘]|
| +-------------------------------------------------------+ |
+-----------------------------------------------------------+
```

1. **进度环英雄卡片 (Progress Ring Hero Card)**：
   - 居中或左侧大尺寸 SVG 环形进度条（`stroke-dasharray` 动态计算），底色 `--color-primary-soft`，进度条采用 `--color-hero-gradient`。
   - 醒目大数字展现今日服药率（`--fs-largeTitle`），右侧配大号时钟与下次服药预告。
2. **分时段服药卡片 (Slotted Medication Cards)**：
   - 按早 (`morning`)、午 (`noon`)、晚 (`evening`)、睡前 (`bedtime`) 四组卡片展示。
   - 每组顶部包含时段图标 (`tint-icon`)、时段名称及一键全组打卡主按钮。
   - 单药条目支持右划或点击打卡，打卡成功后药名变为删除线弱化色 (`--color-text-muted`)，打卡按钮变为绿色状态徽章 (`.status-badge-success`)。

### 5.2 药品管理与库存批次 (Medication & Inventory)

1. **药箱列表 (Inventory Grid)**：
   - 卡片展现：药品高清裁剪盒照（圆角 `--radius-md`，长宽比 1:1）、药名、余量（如「剩余 14 粒 (约可服 7 天)」）、保质期。
   - **余量智能预警**：
     - `剩余天数 <= 3 天`：展示红色预警徽标 (`.status-badge-danger: 缺药预警`)。
     - `过期时间 < 30 天`：展示黄色临期徽标 (`.status-badge-warning: 即将过期`)。
2. **四角盒照裁剪 (Box Photo 4-Corner Crop)**：
   - 取景器覆盖半透明蒙层 (`--scrim`)，四角提供 44×44px 的可拖拽水滴锚点。
   - 底部操作栏提供「顺时针旋转 90°」、「自动透视矫正」、「重拍」与「完成裁剪」四项清晰按钮。

### 5.3 AI 小助手与结构化卡片体系 (AI Assistant & Card System)

> **现代实色微质感架构（oil-ui 规范）**：彻底剔除 Liquid Glass 水凝玻璃、高斯模糊与 SVG 滤镜，采用高对比、高响应的现代实色实体层级。

1. **面板形态与布局**：
   - 入口为全站顶栏「✦ AI 助手」胶囊（`.topbar-pill`）。
   - 展开面板为实色悬浮面板：`background: var(--color-surface-solid)`，圆角 20px，1px 物理微边框（`--color-border`），浅层物理微阴影（`--shadow-md`），`max-block-size: 86dvh`。
   - 摘除全屏模糊与高透蒙层，确保长文本极端清晰可读，消除低端机滑动掉帧。
2. **盒宝人格化与消息气泡**：
   - 头部展示盒宝圆形头像（`avatar_17_hebao.png`）+ 在线绿点，标示「盒宝 · 用药小助手」。
   - 每条助手消息左侧带 28px 盒宝头像，气泡采用实色微底（`--color-surface-muted`）+ 物理微边框。
   - 用户气泡采用主色实色底板（`--color-primary`）+ 白字（`--color-on-primary`）。
3. **结构化卡片体系规范**：
   - **用药安排卡 (Schedule Card)**：
     - 采用实色微质感卡片底板，顶部标题栏标示时钟图标与「今日安排」，右上角提供轻量次级「完整日程」跳转按钮。
     - 条目展示药名、剂量以及防折行时段胶囊（`white-space: nowrap; flex-shrink: 0; min-width: max-content;`）。
     - 待服条目右侧内嵌次级微型「已服」打卡按钮（`.ai-action-btn-sm`）。
     - **原位打卡与容错闭环**：点击按钮原地置为禁用与加载态，打卡成功后立即调用通知模块关闭系统对应推送通知，原位切换为绿底已服状态胶囊（`.ai-status-badge.ok`），同时触发全局居中 Toast，并附带「撤销」动作（保留 5 秒）。用户点击撤销即可一键逆转状态并恢复打卡按钮。
   - **服药统计卡 (Stats Card)**：
     - **大数字达成率主角**：卡片核心呈现 32px 大字号达成率（`.ai-stats-hero`，700 字重）。
     - **横向紧凑分布条**：彻底淘汰陈旧的双列灰色平铺方格，采用单行多段色彩进度条（`.ai-stats-bar`），按比例分割展示已服 (ok)、漏服 (danger)、待服 (muted)。
     - 底部配以精炼图例与次数统计（`.ai-stats-legend`），直观呈现全天服药达成全貌。
   - **库存卡 (Inventory Card)**：
     - 采用实色分栏布局，左侧药品名称与剂型，右侧展示剩余数量与防折行状态胶囊徽标。
     - 清晰区分「充足」(正常) 与「需补充/缺药/临期」(高亮警告)，预警信息一眼即达。
   - **搜索参考卡 (Search Card)**：
     - 淘汰繁重深层的 blockquote 引用块，采用轻量来源小胶囊或链接行展示参考来源，轻盈不压迫。
   - **快捷导航卡 (Navigation Card)**：
     - 扁平精致卡片，微图标 + 标题 + 说明文案 + 导航箭头，触控热区严格满足 `min-block-size: var(--tap)` (44px)，点击平滑路由跳转。

### 5.4 局域网家庭同步 (LAN Family Sync)

1. **一扫即连极简流向**：
   - 主设备展示高清动态二维码（高纠错级别，中间内嵌小药盒图标）。
   - 从设备点击「扫一扫连接」，取景框标注扫码引导线与辅助手电筒开关。
2. **连接状态可视化**：
   - 顶栏常驻展示局域网同步状态点（🟢 局域网已连接 / 🟡 同步中 / ⚪ 离线单机模式），点击直达同步管理面板。

---

## 6. 动效、渲染性能与多端适配

### 6.1 渲染性能铁律 (Performance Baseline)

```mermaid
graph TD
  P1[性能基线 60fps] --> R1[禁止动画中使用 filter: blur]
  P1 --> R2[长列表使用 content-visibility: auto]
  P1 --> R3[全面下线高斯模糊与透镜滤镜]
  P1 --> R4[硬件加速 transform + opacity]
```

1. **严禁在动画关键帧（Keyframes）中使用 `filter: blur()`**：
   - 页面入场、抽屉滑出必须仅使用 `transform: translate3d()` 与 `opacity`，防止在中端安卓机上引发 GPU 重绘风暴与严重掉帧。
2. **长列表渲染优化 (Content Visibility)**：
   - 药品列表项与服药历史记录必须声明：
     ```css
     .med-card, .history-row {
       content-visibility: auto;
       contain-intrinsic-size: 0 88px;
     }
     ```
3. **全面下线液态玻璃与重度模糊**：
   - 坚决移除任何大面积 `backdrop-filter` 复合滤镜与 SVG 位移滤镜。
   - 所有卡片与面板均基于实色表面（`--color-surface-solid`）、1px 物理微边框与浅层阴影，彻底消灭移动端掉帧与卡顿。

### 6.2 动效时间与曲线 (Motion Design Tokens)

- **标准转场时间**：
  - 微交互（按钮按下、开关切换、图标旋转）：`180ms` (`cubic-bezier(0.22, 0.8, 0.25, 1)`)
  - 中度交互（抽屉展开、折叠面板伸缩）：`260ms` (`cubic-bezier(0.32, 0.72, 0, 1)`)
  - 页面/模态转场：`320ms` (`cubic-bezier(0.16, 1, 0.3, 1)`)
- **系统减弱动效响应**：
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
  ```

### 6.3 Android 15/16 Edge-to-Edge 与 Safe Area 适配

在 Android 15/16 强制全屏（Edge-to-Edge）特性下，系统状态栏与底部手势导航条高度直接注入 WebView。

- **Safe Area 变量绑定**：
  ```css
  --safe-top: max(env(safe-area-inset-top, 0px), var(--safe-area-inset-top, 0px));
  --safe-bottom: max(env(safe-area-inset-bottom, 0px), var(--safe-area-inset-bottom, 0px));
  --safe-left: max(env(safe-area-inset-left, 0px), var(--safe-area-inset-left, 0px));
  --safe-right: max(env(safe-area-inset-right, 0px), var(--safe-area-inset-right, 0px));
  ```
- **核心容器约束**：
  - 顶栏 `.topbar`：`padding-block-start: var(--safe-top); min-block-size: calc(56px + var(--safe-top));`
  - 底栏 `.tabbar`：`padding-block-end: var(--safe-bottom); min-block-size: calc(60px + var(--safe-bottom));`
  - 弹窗与抽屉 `.bottom-sheet-overlay`：必须将 `padding` 绑定全部四向 `--safe-*` 变量，严防内容被摄像头挖孔或手势小白条遮挡。

### 6.4 响应式断点矩阵 (Responsive Breakpoints)

| 设备类型 | 视口宽度范围 | 布局策略 |
|---|---|---|
| **超窄屏 / 折叠屏外屏** | `320px ~ 359px` | 顶栏按钮自动折叠为图标，进度环缩小至 88px，卡片内边距收缩至 `--space-3` (12px) |
| **标准主流手机** | `360px ~ 430px` | 标准单列流动布局，两列快捷操作，全尺寸 110px 进度环 |
| **大屏手机 / 折叠内屏** | `431px ~ 767px` | 药箱列表切换为双列网格 (`grid-template-columns: 1fr 1fr`) |
| **平板横屏 (Tablet)** | `≥ 768px` | 左侧固定导航栏（代替底部 Tabbar），今日服药与服药历史采用双栏并列视图 |

---

## 7. 代码落地映射与开发契约

### 7.1 文件组织与职责分工

```
medbox/
├── design/
│   └── design.md              <-- 本规范（唯一真理源）
└── src/ui/
    ├── primitives/            <-- 软件自有自绘控件库（自绘优先铁律）
    │   ├── primitives.ts      <-- createTimeControl, createDateControl, createSelectControl, createStepper, openBottomSheet, SegmentedControl 等
    │   └── primitives.css     <-- 自绘控件原子样式与全局 input/checkbox/radio/switch 外观规范
    ├── styles/
    │   ├── tokens.css         <-- CSS 变量（色彩、字阶、间距、暗色覆盖）
    │   ├── primitives.css     <-- 基础原子类（.card, .btn, .chip, .toast）
    │   ├── shell.css          <-- 框架容器（.app-shell, .topbar, .tabbar）
    │   └── pages/             <-- 页面专属细节样式（assistant.css 等）
    ├── components.ts          <-- DOM 工厂 (el, field, icon, toast, dialog)
    ├── assistantContent.ts    <-- AI 助手 Markdown 与结构化卡片渲染（油性微质感卡片体系）
    └── icons/                 <-- 本地锁版本的 Lucide SVG 图标库
```

### 7.2 核心 DOM 工厂与自绘控件调用契约

所有页面开发必须优先使用 `src/ui/components.ts` 与 `src/ui/primitives/` 暴露的标准工厂函数：

```typescript
// 1. 构造标准带无障碍语义的元素
const card = el('div', { class: 'card', 'aria-label': '降压药卡片' }, [
  el('h2', { text: '氨氯地平片 (5mg)' }),
  el('p', { class: 'muted', text: '每日 1 次，每次 1 片' }),
]);

// 2. 构造标准表单项（自动集成 Label、Hint、Error 和 ARIA 关联）
const nameField = field('药品通用名', el('input', { id: 'med-name', placeholder: '如：阿莫西林' }), {
  hint: '可参考药盒正面大字',
  required: true,
});

// 3. 构造异步操作按钮（自动处理 loading 与禁用状态）
const saveBtn = el('button', { class: 'btn', text: '保存药品' });
saveBtn.onclick = () => withBusyState(saveBtn, async () => {
  await saveMedicationData();
  toast('药品保存成功！');
});

// 4. 唤起全无障碍自绘底部抽屉
openBottomSheet({
  title: '添加新药品',
  content: formContainer,
  onClose: () => console.log('抽屉已关闭'),
});

// 5. 使用自绘时间控件（严禁使用原生浏览器弹层）
const timeCtrl = createTimeControl({
  value: '08:00',
  onChange: (val) => console.log('选择时间:', val),
});
```

### 7.3 多工具协作维护规范

1. **修改流程**：
   - 若需调整全局视觉或新增组件规范，**必须先更新 `medbox/design/design.md`**，经团队评审或确认后，再同步修改 `tokens.css` / `components.ts` / `primitives/`。
2. **禁止逆向篡改**：
   - 严禁在页面 CSS 中通过 `!important` 覆盖全局 Token；所有特殊定制必须通过局部 `--component-*` 作用域变量或扩展新 Token 完成。
3. **交付验收门禁**：
   - 每次 UI 改动提交前，必须运行并通过：
     ```powershell
     npm run typecheck
     npm run test
     npm run build:web
     ```
   - 在 Playwright 四视口测试（320px、390px、平板横屏、桌面）下无溢出与布局撕裂。
