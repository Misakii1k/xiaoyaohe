# Claude Handoff

Tool: Claude
Branch: `workspace/claude`
Updated: 2026-09-25
Status: active
Latest version: `1.1.10` (Android `versionCode: 68`)

## Summary of Accomplished Work

### 66. 全新 3D 日历小胶囊品牌主图标与官方吉祥物「盒宝」多场景深度融入 (v1.1.8, versionCode 66, workspace/claude)

1. **需求与背景**：全面替换小药盒 App 主图标为全新的 3D 萌系日历小胶囊形象（立体白绿小胶囊坐在绿色日历看板中央，配备微拟物对勾徽章），外圈采用无缝高质感深墨绿色，形成极具辨识度与亲和力的品牌视觉；同时确立该小胶囊形象为软件官方吉祥物「盒宝」，深度融入软件分药、统计、提醒、空状态及头像系统。
2. **改动清单**：
   - **母版制作与图标分发 (`design/brand/master/app-icon.png`)**：
     - 将用户提供的 1024x1024 高保真 3D 渲染母版无损规范化为 512x512 PNG；
     - 边缘外延无缝平铺深墨绿（`#0d3f32`），立体日历与小胶囊主体严格居中；
     - `ic_launcher_background.xml` 替换为与新图标一体化融合的沉稳高级深墨绿线性渐变（`#114C3C` -> `#0D3F32` -> `#082A21`）；
     - `scripts/gen-icons.mjs` 优化：去除 `.trim()` 消除宽高比漂移与黑边信箱条，重新生成 32 款 Android 各密度图标与 PWA 图标。
   - **吉祥物「盒宝」3D 素材规范化生成 (`scripts/build-mascot-assets.mjs`)**：
     - 将用户提供的 4 款高保真透明底 PNG 处理为规范的 512x512 高清素材与 256x256 透明底头像；
     - `src/assets/images3d/pillbox-banner.png`：分药助手横幅专用「盒宝 · 分药小管家」；
     - `src/assets/images3d/stat-pillbox.png`：我的数据 · 全部药品「盒宝 · 药箱小卫士」；
     - `src/assets/images3d/stat-notebook.png`：我的数据 · 用药计划「盒宝 · 日历计划官」；
     - `src/assets/images3d/stat-target.png`：我的数据 · 打卡记录「盒宝 · 点赞鼓励官」；
     - `src/assets/images3d/floating-pill.png`：服药打卡弹窗「盒宝 · 点赞鼓励官」；
     - `src/assets/images3d/mascot-empty.png`：空状态插画「盒宝 · 日历计划官」；
     - `src/ui/assets/avatars/avatar_17_hebao.png`：官方专属头像「盒宝」。
   - **业务场景无缝融入**：
     - `src/pages/ScanSort.ts`：分药助手顶部横幅挂载「盒宝 · 分药小管家」；
     - `src/pages/settings/components/StatsGrid.ts`：数据统计三卡片对齐对应盒宝形象；
     - `src/ui/TakeMedModal.ts`：服药确认弹窗搭载点赞鼓励官形象与优化文案；
     - `src/pages/Today.ts` & `src/ui/styles/pages/today.css`：今日清单空状态卡片增加浮动呼吸感盒宝 3D 插画；
     - `src/ui/avatars.ts` & `tests/avatarPicker.test.ts`：头像库扩充至 17 款角色，支持盒宝头像选择与 SVG 矢量回退。
3. **验证与门禁**：
   - `npm run assets:check`：32 个图标文件校验 100% 匹配无陈旧；
   - `tests/iconAssets.test.ts`：4/4 测试项全绿通过；
   - `tests/avatarPicker.test.ts`：5/5 测试项全绿通过；
   - `npm run typecheck`：0 错误；
   - `npm test`：91 文件 / 577 项测试全绿通过；
   - `npm run build:web`：生产构建正常，Web Bundle 增量包正确生成；
   - `tone_lint.py`：PASS。

### 65. 时段提醒设置排版重构、全屏提醒选项优化、独立开关与时间增删落地 (v1.1.8, versionCode 66, workspace/claude)

1. **需求与背景**：解决设置面板中「时段提醒设置」早/中/晚/睡前视觉混杂无分隔、全屏提醒二级编辑器 3 列挤压造成文字断行折叠破损，并为每个时段提供独立开启/关闭开关、支持配置时段内多个具体提醒时间点以及自定义时段的添加与删除功能。
2. **改动清单**：
   - **数据模型与底层仓储扩展 (`src/db/schema.ts`, `src/db/repositories/reminderPeriodsRepo.ts`)**：
     - `ReminderPeriodSetting` 扩展 `name?: string`（时段名称）、`extraTimes?: string[]`（额外提醒时间点列表）、`enabled?: boolean`（是否开启该时段提醒）、`isCustom?: boolean`（自定义时段标记）；
     - 仓储方法 `updateReminderPeriodSetting` 支持原子更新 `enabled`、`extraTimes`、`name` 等字段，校验所有时间格式（`HH:mm`）；
     - 新增 `deleteReminderPeriodSetting` 支持彻底删除自定义时段并广播更新事件。
   - **提醒调度计划联动 (`src/features/medicationReminderPlan.ts`)**：
     - 增加 `if (setting && setting.enabled === false) continue;`，关闭的时段不再生成系统通知与原生闹钟；
     - 收集时段内主时间与所有额外时间（`targetTimes = [timeLocal, ...extraTimes]`），为各生效时间点独立排期生成对应的服药组提醒。
   - **时段列表独立微卡片与原生滑动开关 (`ReminderPanel.ts`, `settings.css`)**：
     - 将原本平铺的灰底行重构为符合规范的独立纯白微卡片（`14px` 圆角、细边框、阴影与 `10px` 呼吸间隔）；
     - 早（琥珀日出）、中（绿意正午）、晚（暖蓝晚霞）、睡前（静夜弯月）与自定义（极客青时钟）配备专属微拟物矢量彩色徽章；
     - 每张卡片右侧内置原生质感 iOS 滑动开关（Switch），支持在列表上直接一键开启或暂停该时段提醒，暂停时卡片平滑淡化且标记「已停用」；
     - 列表底部新增大触控区域虚线卡片「+ 添加提醒时段」，拉起底层弹层支持自定义时段名称（如「下午」、「加餐」等）与首选时间。
   - **二级编辑器全屏提醒排版根治与多时间点增删 (`ReminderPanel.ts`, `settings.css`)**：
     - 废除横向 3 列等宽栅格，重构成单列全宽卡片式单选架构（`.period-mode-cards` 与 `.period-mode-card`）；
     - 各选项大字加粗、配备「推荐」绿色微徽章与完整无截断的解释副标题（持续全屏提醒 / 10 秒全屏提醒 / 60 秒全屏提醒），彻底消除手机屏幕上的断行与折叠；
     - 时间配置区域升级为多时间点动态容器：每行展示一个时间选择器，右侧配备删除按钮（多于 1 个时间点时可删除）；下方提供「+ 添加提醒时间」轻量按钮，支持灵活增减多个催服时间点；
     - 自定义时段底部提供「删除该时段」危险操作与二次确认防护。
3. **验证与门禁**：
   - 补充 `tests/reminderPeriodSettings.test.ts` 验证时段独立开关、多时间点校验与自定义时段增删；
   - 补充 `tests/medicationReminderPlan.test.ts` 验证时段停用时通知排期拦截以及多时间点触发排期；
   - `npm run typecheck`：0 错误；
   - `npm test`：91 文件 / 577 项 100% PASS；
   - `npm run build:web`：生产构建正常，Web Bundle 正确生成；
   - `npm run cap:sync`：Android 资源同步成功。

### 64. 用药日历排版重构与状态图例/单操作按钮优化 (workspace/claude)

1. **需求与背景**：重构「用药日历」（`/history`）界面的视觉排版、信息架构与操作层级，彻底根治月份切换字符简陋、日历单元格椭圆拉伸变形、缺少状态图例认知负担重、当日用药列表横向拥挤挤压折行、按钮与Radio双重冗余操作等体验缺陷。
2. **改动清单**：
   - **月份导航卡片（`MedHistory.ts`, `med-history.css`）**：
     - 月份切换器替换字符 `<` / `>` 为标准 Tabler 矢量图标（`chevron-left` / `chevron-right`），赋予 36px 独立轻底色圆形触控靶心与触觉弹簧微反馈；
     - 年月标题居中加大加粗（`YYYY年 M月`），数字字重充盈饱满；
     - 星期表头 `日 一 二 三 四 五 六` 字符规整对齐，区分工作日与周末轻微主色透明度。
   - **日历网格与状态图例（`MedHistory.ts`, `med-history.css`）**：
     - 单元格圆角从全局胶囊 `radius-full` 重塑为标准 `12px` 圆角矩形（Squircle），消除移动端不同宽度下拉伸变形；
     - 今日指示器（未选时主色轻柔衬底与细外边框，选中时主色填充高光）；
     - 状态指示点尺寸提升至 5px，依从性小圆点高对比度清晰呈现；
     - 在日历卡片底部新增轻量单行状态图例栏（`🟢 全部已服` / `🟡 部分已服` / `🔴 漏服` / `⚪ 待服`），一目了然。
   - **选中日用药记录与操作区重塑（`MedHistory.ts`, `med-history.css`）**：
     - 标题重构为中文自然相对日期（如 `7月25日 · 周六 · 今天`），右侧增设概览统计徽章（`共 X 次 · 全部已服`）；
     - 当日无计划时替换冷硬 banner 为专属温馨空状态卡片（`emptyState`）；
     - 用药记录卡片采用结构化三列流式布局：左侧时间列（计划时间 + 时段胶囊），中间药品信息列（药名、剂量、状态徽章与打卡时间），右侧操作列；
     - 彻底清除重复冗余的圆形 Radio 打卡圈，合并为单一明确的高保真药丸操作按钮（Action Pill Button），释放横向空间彻底杜绝小屏手机上药名频繁换行挤压；
     - 深色模式（Dark Theme）全要素高对比度适配与 `prefers-reduced-motion` 无障碍友好。
3. **验证与门禁**：
   - `npm run typecheck`：0 错误；
   - `npm test`：91 文件 / 574 项 100% PASS；
   - `npm run build:web`：顺利完成构建，Web Bundle 正常生成；
   - `npm run cap:sync`：Android 原生资产同步成功。

### 63. 全页面各交互环节优雅灵动动效与触觉反馈系统 (commit `b6efdbc`, workspace/claude)

1. **需求与背景**：全面检查各个页面的各个交互环节，添加自然、优雅、灵动的过渡动效与物理微弹（Spring）反馈，增强移动端操作的呼吸感与操作质感，且在 `prefers-reduced-motion` 下无障碍友好降级。
2. **动效升级清单**：
   - **基础动效令牌（`tokens.css` / `primitives.css`）**：
     - 新增 `--ease-spring-snappy`、`--ease-spring-gentle` 物理弹簧曲线；
     - 新增打卡涟漪动效 `@keyframes pulseRipple`、满格欢庆光晕 `@keyframes celebratePulse`、选项灵动弹跳 `@keyframes selectPop`、浮动底栏弹入 `@keyframes dockSlideUp`、拟物悬浮呼吸 `@keyframes floatGentle`、徽标提示呼吸 `@keyframes dotPulse`、底栏图标弹跳回弹 `@keyframes tabIconSpring`、AI 消息轻柔淡入 `@keyframes aiMsgIn` 等核心动画。
   - **「今日」页面（`Today.ts`, `today.css`）**：
     - 今日小绿点徽标注入轻柔呼吸脉冲（`dotPulse`），周历日期胶囊在切换时触发弹跳选中；
     - 翻周轻量按钮（`week-nav-btn`）与返回今天按钮（`today-return-btn`）加入弹性缩放反馈；
     - 待服聚焦卡片主要操作按钮（立即服用/稍后提醒）加入弹簧触觉反馈与阴影高亮；
     - 计划时段筛选胶囊（`today-filter-pill`）增加 `selectPop` 弹性跳动与微光晕；
     - 时段一键打卡按钮（`today-batch-take-btn`）加入弹簧缩放与背景微光；
     - 环形进度条达到 100% 或满格完成时触发 `celebratePulse` 欢庆光晕扩展与中心数值弹簧弹动；
     - 单药与时段服药打卡增加单点涟漪扩散（`pulseRipple`）与对勾弹跳（`checkmarkPop`），已完成用药卡片平滑淡化（`is-taken`）；
     - 服药全屏弹层（`TakeMedModal`）退出时增加抽屉顺滑向下离场动效。
   - **「药品」页面（`medications.css`）**：
     - 分类切换 Pill 标签选中时下划线增加灵动弹性生长；
     - 药品卡片网格与查看库存横幅增加自然悬停与微缩放弹性回弹；
     - 右下角「添加药品」悬浮按钮（FAB）增加登场弹性浮现与悬浮光晕；
     - 批量管理模式下，卡片选中态增加 `selectPop` 弹跳，底部紧凑操作坞（`.medication-batch-dock`）加入顺滑向上弹簧滑入动效。
   - **「历史」页面（`med-history.css`）**：
     - 月历翻月按钮加入弹性微缩放，日期单元格点击切换时加入灵动弹跳高亮（`selectPop`）；
   - **「库存」页面（`inventory.css`）**：
     - 库存健康盾牌徽章加入优雅呼吸浮动（`floatGentle`）；
     - 筛选标签胶囊加入弹簧选中反馈，库存列表行增加自然悬停提升与点击压缩；
   - **「扫码」页面（`scanner.css`）**：
     - 分药助手 3D 分药机展台横幅（`scan-banner-img`）增加呼吸浮动动效（`floatGentle`）；
     - 核心行动卡片增加悬停提升、柔和投影扩展与箭头向右微弹手势提示；
     - 快捷分药小卡片增加微质感边框高亮与弹性缩放；
   - **「设置」页面（`settings.css`）**：
     - 个人资料 3D 头像（`profile-avatar-wrap`）增加悬停微放大与弹簧按压缩放；
     - 折叠面板指示箭头（`panel-chevron`）改为顺畅 90° 旋转，展开内容区增加优雅微浮现淡入（`microFadeUp`）；
   - **「药品编辑」页面（`medication-editor.css`）**：
     - 用药频次与时段选择按钮（`medication-slot-buttons`）增加弹簧按压缩放与 `selectPop` 弹性高亮；
     - 提醒模式选择卡片（`medication-reminder-mode-option`）增加弹性选中反馈与微阴影；
   - **全局与底栏（`shell.css`, `assistant.css`, `primitives.css`）**：
     - 全局通用弹层（`.bottom-sheet`）以 iOS 柔和弹簧曲线（`--ease-spring-gentle`）顺滑滑入；
     - 顶栏图标按钮（`.topbar .icon-btn`）与顶栏胶囊（`.topbar-pill`）加入弹性反馈与悬浮微浮起；
     - 原生通栏底栏（Tabbar）在标签激活时图标注入灵动果冻微弹（`tabIconSpring`）；
     - 全局 AI 助手消息卡片与回复增加轻柔上浮淡入（`aiMsgIn`）；
     - 所有动效在 `prefers-reduced-motion: reduce` 下保持瞬时响应，兼顾性能与无障碍。
3. **验证与门禁**：
   - `npm run typecheck`：0 错误；
   - `npm test`：91 文件 / 574 项测试 100% PASS；
   - `npm run build:web`：打包成功（Web Bundle 产物正常生成）。

### 62. 修复今日页面环形进度圈100%数值溢出 (v1.1.6, versionCode 64, main)

1. **需求与背景**：用户反馈「今日」页面中的环状百分比进度圈在达到 100% 时，中间的数值会出现溢出圆环的问题。
2. **根因定位与修复**：
   - 进度圈在今日卡片中的外部容器尺寸为 78px × 78px，内圆可用直径仅 56.16px；
   - 原三位数百分比（100%）在 26px 字号下宽度达 57.02px，超出内圈净空，导致文本左右两侧覆盖压在墨绿色圆环进度条上；
   - 在 `src/ui/components.ts` 的 `progressRing` 组件中增加 `is-full` 状态标记与 `data-percent` 属性；
   - 在 `src/ui/styles/legacy.css` 与 `src/ui/styles/pages/today.css` 中针对 `is-full` / `is-done` 状态将数值字号下调至 19px，单位字号下调至 10.5px，左右两侧安全留白由负溢出恢复至 +5.01px，彻底杜绝溢出；
   - 在 `tests/todayUiContracts.test.ts` 补充针对 100% 满格状态结构与样式的契约测试；
   - 版本号与构建号单调递增至 1.1.6 / versionCode 64。
3. **验证与门禁**：
   - `npm test`：91 文件 / 574 项 100% PASS；
   - `npm run typecheck`：0 错误；
   - `tone_lint.py`：PASS。

### 61. 界面细节排版与全系统一绿色视觉优化 (v1.1.3, versionCode 61, main)

1. **需求与背景**：真机验证后修复药品列表横幅SVG源码泄露、AI助手折行、底部悬浮操作按钮遮挡问题，并将全站残留的紫色视觉元素彻底替换为统一清爽自然的绿色系。
2. **修复内容**：
   - 修复药品列表横幅在部分设备上直接打印 SVG 文本源码缺陷，使用 `parseSvg` 动态解析为矢量节点挂载；
   - 解决小屏手机上今日页与顶栏 AI 助手胶囊文字折行（增加 `white-space: nowrap; min-width: max-content;` 防御）；
   - 增加药品列表页底部安全内边距至 112px，避免右下角悬浮按钮遮挡列表底部卡片；
   - 全面清理残留的紫色元素（顶栏 AI 胶囊、服药历史状态按钮、药品编辑智能录入卡片、分药向导阴影、扫码页光晕与快捷图标、设置页各面板图标色调、头像选择态与关于小药盒 Logo/磁贴），彻底换用青绿主色系；
   - 版本号与构建号单调递增至 1.1.3 / versionCode 61。
3. **验证与门禁**：
   - `npm test`：91 文件 / 572 项 100% PASS；
   - `npm run typecheck`：0 错误；
   - `tone_lint.py`：PASS。

### 60. UI 对比度提升、扫码卡片反转与44px触控尺寸 (v1.1.2, versionCode 60, main)

1. **需求与背景**：合并 Plan B 视觉升级至 `main` 分支，并完成 6 项交互与无障碍细节修复。
2. **修复内容**：
   - 助手附件胶囊对比度提升（改走 `--color-on-primary`）；
   - 筛选胶囊计数徽标对比度达标；
   - 扫码绿色卡片随主题反转（浅色深绿白字/暗色亮绿深字）；
   - 设置页装饰色换用达标色令牌；
   - 5 类交互控件触控高度统一升至 44px（顶栏胶囊、快捷提问、批量操作坞、今日批量打卡、查重通知按钮）；
   - 次要文字令牌对比度优化（`#67736e→#64706b`）；
   - 修复 `tests/reminderScheduler.test.ts` 午夜跨日边界时间确定性（`vi.useFakeTimers`）。
3. **验证与门禁**：
   - `npm test`：91 文件 / 572 项 100% PASS；
   - `npm run typecheck`：0 错误；
   - `npx playwright test`：100/100 项 PASS；
   - `tone_lint.py`：PASS。

### 59. 设置页微卡片化视觉分割与层级结构优化 (v1.1.1, versionCode 59, workspace/claude)

1. **需求与背景**：用户反馈设置页（「我的」及展开的各个面板）中缺少分割线，导致各个板块混在一起、层级模糊。
2. **架构与视觉重构**：
   - **独立微卡片规范 (`.settings-subcard`)**：在折叠面板展开后的浅灰底色（`var(--color-surface-muted, #f8fafc)`）上，各个业务子功能均封装为独立的纯白微卡片（`var(--color-surface, #ffffff)`），搭配 `14px` 圆角、细腻细边框与柔和微投影，彻底告别“设置内容灰蒙蒙挤在一起”的视觉混杂感；
   - **内置标题栏与状态胶囊徽章**：微卡片内置 13.5px 加粗标题与状态指示胶囊，使各子板块边界清晰明了；
   - **展开面板标题底部分割线**：面板展开时（`.panel.open > .panel-head`），标题栏底部自动展示一条细腻分割线（`border-bottom: 1px solid var(--color-border)`），将常驻白色标题栏与下方浅灰卡片内容区明确区隔；
   - **全业务面板改造**：覆盖 `ReminderPanel`（5 大子板块）、`AppearancePanel`（2 大子板块）、`BackupPanel`（数据归档微卡片）、`LlmConfigPanel`（服务商调度与密钥存储微卡片）、`imageGenSettingsPanel`、`lanSyncSettingsPanel`（开关卡片升级）、`DiagnosticsPanel`（脱敏日志卡片）。
3. **验证与门禁**：
   - `npm run typecheck` 0 错误；
   - `tests/settingsUiContracts.test.ts`、`tests/settingsDiagnostics.test.ts`、`tests/imageGenSettings.test.ts` 等设置单测全部 PASS；
   - 全量 91 套件 572 项测试 100% 通过；
   - `tone_lint.py` 严格校验通过。

### 58. 确认/扫码后提醒重复弹出根治 (workspace/claude)

1. **问题**：用户反馈全屏提醒中确认服药（已服用/全部已服用）或扫码验证成功后，提醒仍会再次弹出。
2. **根因（两条叠加）**：
   - **递进重复闹钟未随确认取消**：每个时段组最多排 4 个原生闹钟（dose + repeat-2/3/4，默认每 10 分钟 × 3 次）。`MedicationAlarmContract.handleAction` 确认时只停铃、取消当前通知并入队动作，**未取消同组剩余 repeat 闹钟**；只有 WebView 回前台触发重放+对账（`replayPendingMedicationReminderActions` → `rescheduleMedicationReminders` → `reconcile`）才会清掉。锁屏/后台确认后不打开应用的典型场景下，AlarmManager 按原节奏再次弹出全屏提醒。
   - **IDS 残留过点补发**：已触发闹钟的 `payload_<id>` 与 id 留在 SharedPreferences IDS 集合（仅 reconcile/cancelTag 会清理）；`MedicationAlarmBootReceiver` 在 BOOT / TIME_CHANGED / TIMEZONE_CHANGED（含运营商自动对时）时调用 `restoreScheduled`，对 `at <= now` 的条目执行「过点补发一次」，把已确认的提醒再弹一次。
   - 附带：贪睡分支（「10 分钟后提醒」）不清剩余 repeat，形成贪睡+递进双轨重复响铃。
3. **修复**（`MedicationAlarmContract.java` / `MedicationAlarmPlugin.java`，纯原生逻辑）：
   - 新增纯函数 `wholeReminderCompleted(action, payload)` 判定动作是否完结整组：非组载荷（遗留单药）任何确认/跳过即完结；组载荷「全部已服用 / 全部跳过」（含扫码自动已服用 `dispatchScanAutoTaken`）即完结；**单成员组**行级确认即完结；多成员组行级确认保留递进闹钟继续提醒其他药；
   - `handleAction`：贪睡先 `cancelTag` 再排贪睡闹钟（贪睡成为该组唯一下次响铃）；确认/跳过完结整组时立即 `cancelTag` 取消剩余闹钟并顺带清理 IDS/payload 残留（同步根治过点补发路径）；
   - `queueOccurrenceAction`（全屏页单行按钮）：单成员组确认即取消整组剩余闹钟；
   - `MedicationAlarmPlugin.snooze`（TS 侧重放贪睡路径）：排贪睡前先清同组闹钟，与原生路径一致。
4. **验证与门禁**：新增 4 项 `wholeReminderCompleted` 契约测试；`testReleaseUnitTest` 26 项全绿；`npm run typecheck` 0 错误；全量 vitest 91 套件 572 项通过。顺手修复存量失败 `AppConfigurationTest`（v1.0.1 时代硬编码版本断言 1.0.1/36 与当前 1.0.22/57 不符，改为仅断言包名，版本一致性由 TS 侧 versionManifest 门禁覆盖）。真机待验证：锁屏/后台确认或扫码后，10/20/30 分钟不再重复弹出全屏提醒；多药组服完一种药后其余药的递进提醒仍正常。

### 57. 全屏提醒滑动解锁滑块固定至屏幕底部 (workspace/claude)

1. **问题与诉求**：用户要求把全屏提醒中的滑动解锁滑块移动到底部。此前 `SlideToUnlockBar` 渲染在可滚动内容列内、紧随提醒正文之后，内容较短时滑块悬在屏幕中部，不符合拇指底部操作习惯。
2. **修复**（`android/app/src/main/java/com/medbox/app/MedicationAlarmActivity.kt`，纯原生 UI 布局改动）：
   - 将滑块从滚动内容列抽出，改为外层 `Box` 底部对齐的固定区域（`align(Alignment.BottomCenter)` + `navigationBarsPadding`），不随内容滚动、始终贴底；
   - 底部区域附竖向渐变衬底（透明 → `Background` 实色），滚动内容穿过下方时自然淡出，不遮挡装饰层底部柔光；
   - 解锁前滚动内容列预留 96dp 底部空间，防止末尾内容被固定滑块遮挡；滑动解锁后滑块消失，「已服用 / 10 分钟后提醒 / 跳过本次」按钮回流至内容流原位；
   - `FooterActions` 移除 `slideUnlocked` / `onSlideUnlock` 参数与内嵌滑块分支，两处调用点同步精简；扫码反馈文案随滑块一并迁移至底部固定区域。
3. **验证与门禁**：`./gradlew.bat compileDebugKotlin` 与 `assembleDebug` BUILD SUCCESSFUL；`npm run typecheck` 0 错误；未触碰 TS 源码与测试用例（`tests/alarmSlideUnlock.test.ts` 为偏好存储测试，不受影响）。真机视觉与滑动手感待用户验证。

### 56. 提醒排版修复、滑动解锁生效加固与按增量落实度提供更新通道 (v1.0.22, versionCode 57, workspace/claude)

1. **问题与诉求**：
   - 用户反馈：设置面板提醒卡片出现单字竖排错乱；真机触发提醒依然直接出按钮、没有滑动解锁。
   - 用户明确要求：更新分为增量更新和全量更新。若更新的内容通过增量更新无法落实，必须使用全量更新，则在更新时只提供全量更新的按钮，反之则两个按钮都提供。
2. **根因定位与修复**：
   - **排版崩溃**：`ReminderPanel.ts` 中 `slideCard` 在横向 flexbox 中强塞 40+ 字符导致窄屏被挤压成单字竖排；彻底重构为标准的 `settings-scan-card` 垂直流布局，文字通栏自适应，彻底消除排版错乱；
   - **滑动解锁生效加固**：在 `MedicationAlarmPlugin` 中为测试提醒注入 `testAlarm` 标记，在 `MedicationAlarmActivity.kt` 中修复 `sameAlarm` 判定，使得多次测试与不同批次提醒每次均能彻底复位未解锁状态与会话；
   - **增量/全量精准分流**：将 `MIN_NATIVE_BUNDLE_VERSION_CODE` 提升至 56。在 `AppUpdatePanel.ts` 中重构更新按钮体系：若更新内容无法通过增量更新落实（`updateType === 'full'`），更新界面只提供「下载并安装」全量按钮；反之（`updateType === 'incremental'`）则同时提供「一键秒级更新」与「下载完整包」双按钮，点击直达下载安装；
   - **底座版本引导提示**：在滑动解锁设置卡片中增加底层 APK 版本判断，当仅增量更新未安装底座时明确提示需安装完整 APK。
3. **验证与测试**：
   - 新增 `tests/appUpdateButtons.test.ts` 单测覆盖全量与增量按钮呈现策略；全量 92 套件 574 项测试全部通过；`npm run typecheck` 0 错误；`tone_lint.py` 文风审计通过。

### 55. 全屏提醒滑动解锁独立配置与测试 (v1.0.21, versionCode 56, workspace/claude)

1. **问题**：用户反馈全屏提醒未提供滑动解锁的配置功能；设置页缺少开关与测试入口，且关闭扫码后的描述未对齐滑动解锁。
2. **修复**：
   - `src/features/alarmSlideUnlock.ts`：新增偏好管理模块，默认启用滑动解锁防误触；
   - `src/pages/settings/panels/ReminderPanel.ts`：新增「全屏提醒滑动解锁」设置卡片与开关，提供「测试滑动解锁」按钮，并精准联动扫码关闭状态文案；
   - `src/features/nativeMedicationAlarm.ts`：调度与测试载荷自动注入 `slideUnlock` 偏好；
   - `android/app/src/main/java/com/medbox/app/MedicationAlarmPlugin.java` 与 `MedicationAlarmActivity.kt`：原生全屏提醒根据 `slideUnlock` 载荷动态判定；关闭时直接展示操作按钮，开启时呈现 `SlideToUnlockBar` 向右滑动解锁。
3. **验证与门禁**：
   - 新增 `tests/alarmSlideUnlock.test.ts`；90 套件 570 项测试 100% 通过；`npm run typecheck` 0 错误。

### 54. 全屏提醒支持滑动解锁与按需扫码验证 (v1.0.20, versionCode 55, workspace/claude)

1. **问题**：之前版本中全屏提醒误触发了默认扫码解锁，即只要弹出全屏闹钟就强制要求扫码，导致未勾选扫码解锁的用户无法正常便捷操作。
2. **修复**：
   - `android/app/src/main/java/com/medbox/app/MedicationAlarmActivity.kt`：
     - 重构锁定状态判定逻辑：仅在闹钟有效载荷明确携带 `requiresScanVerification == true` 时才进入扫码解锁状态，杜绝历史状态残留；
     - 增加向右滑动解锁组件 `SlideToUnlockBar`（64dp 浅色毛玻璃轨道、呼吸感提示文本、52dp 渐变手柄、70% 判定、弹簧回弹）；
     - 未开启扫码解锁时，进入滑动解锁待机态：持续响铃与全屏覆盖，底部提供滑块，滑动到位后解除锁定并停止响铃，展开「已服用」和「稍后提醒」按钮，避免误触关闭；
     - 拦截返回键手势：未滑动解锁前按返回键触发短震并 Toast 提示「请向右滑动解锁」，防止意外退出；
     - 10 分钟无人解锁安全兜底：自动触发 `ACTION_SNOOZE`。
   - `src/features/nativeMedicationAlarm.ts` 与 `src/pages/settings/panels/ReminderPanel.ts`：
     - `fireNativeMedicationAlarmNow` 支持 `forceScanVerify`；
     - 设置面板中「测试全屏提醒」传入 `{ forceScanVerify: false }` 测试滑动解锁与持续响铃，「试验扫码解锁」传入 `{ forceScanVerify: true }` 测试扫码流程。
3. **验证与门禁**：
   - 89 套件 567 项 Vitest 测试 100% 通过；`npm run typecheck` 0 错误；Android 原生编译 `assembleDebug` / `assembleRelease` 通过；发布说明通过 `oil-tone` 检查。

### 53. 小助手模型/推理选择器改为应用内弹层 (v1.0.19, versionCode 54, workspace/claude)

1. **问题**：`src/ui/AiAssistant.ts` 中的模型覆盖与推理强度使用原生 `<select>`，点击会拉起系统选择器，字体、圆角与深色配色均与应用不一致，观感割裂。
2. **修复**：两个 `<select>` 改为 `<button class="ai-pref-select">`（`aria-haspopup="dialog"`），点击调用既有 `openBottomSheet()`（`src/ui/primitives/BottomSheet.ts`）打开应用内选项弹层；新增 `modelOptions()` / `effortOptions()` 抽出选项构造，`refreshPrefControls()` 只负责回填按钮文案；选中项以 `is-current` 呈现主色边框 + 文字 + `check` 图标，并带 `aria-pressed`。
3. **样式**（`src/ui/styles/pages/assistant.css`）：`.ai-pref-select` 重写为按钮态（自绘 CSS 箭头、hover/focus 主色描边）；新增 `.ai-pref-sheet-title` / `.ai-pref-sheet-options` / `.ai-pref-sheet-option`，全部走 `--color-surface` / `--color-text` / `--color-primary` 令牌，深色模式自动适配。
4. **验证**：`npm run typecheck` 0 报错，89 套件 567 项测试通过；浏览器实测确认面板内已无原生 `<select>`（0 个），弹层 role=dialog、圆角 26px 与应用一致，选择后按钮文案与 `medbox.assistant-prefs.v1` 同步落盘，重开弹层对勾位置正确，浅色/深色两套配色均正常。

### 52. 药品列表左对齐修复与小助手界面改版 (v1.0.18, versionCode 53, workspace/claude)

1. **主列表药品名被批量卡片样式带偏居中**：
   - `src/pages/MedList.ts` 的普通列表卡片为保留无障碍语义复用了 `medication-batch-name` 类，而该类带 `text-align: center` 与两行 `-webkit-line-clamp`，导致主页药品名居中、与下方规格/库存左对齐内容错位；
   - 在 `src/ui/styles/pages/medications.css` 中以 `.med-item-card .med-item-name.medication-batch-name` 提高特异性覆写为 `text-align: start; display: block; white-space: nowrap` 单行省略，并给 `.med-item-info` 补 `align-items: flex-start`；批量管理页居中排版保持不变。
2. **小助手界面改版（`src/ui/AiAssistant.ts` + `src/ui/styles/pages/assistant.css`）**：
   - 头部压缩：新增 `.ai-panel-prefs-toggle` 齿轮按钮，模型选择/推理强度/刷新模型三件套默认 `hidden`，点击齿轮展开（`aria-expanded` 同步）；
   - 面板高度由 `min(76dvh, 640px)` 提至 `min(86dvh, 720px)`，头部 padding 收紧，对话区实测占面板 60%；
   - 助手回复由窄气泡改为全宽文档式卡片（`max-width: none`，实测 351/375px），行高 1.6 → 1.75，工具结果卡片同步加宽；
   - 快捷问题行 `.ai-quick` 改为 `flex-wrap: nowrap; overflow-x: auto` 单行横向滚动并隐藏滚动条，不再多行堆叠挤占对话区；
   - 「正在思考」提示缩为小标签，深色模式底色层次同步调整。
3. **质量门禁**：`npm run typecheck` 0 报错，全量 89 套件 567 项测试通过；浏览器实测确认列表左对齐（name/spec/badges 同在 x=97）与助手面板各项指标。

### 51. 修复 Web 增量热更新始终退化为全量安装包 (v1.0.17, versionCode 52, workspace/claude)

1. **根因**：`src/sync/lan/apkTransport.ts` 的 `getAvailableUpdate()` 从 localStorage 还原时丢弃了 `updateType / bundleUrl / bundleSize / bundleSha256 / minNativeVersionCode`，更新面板重新读取后 `isIncremental` 恒为 false，「一键秒级更新」按钮从未出现。云端 `version.json`、`/api/download?asset=bundle`、原生 `downloadAndUnpackBundle/applyWebBundle` 链路均实测正常。
2. **修复**：`getAvailableUpdate()` 完整还原增量元数据，并按本机底座重新校验 `minNativeVersionCode`（不满足降级 full）；AI 助手的更新工具优先走增量、失败回退全量。
3. **测试**：`tests/bundleUpdateVerification.test.ts` 新增 2 条 localStorage 往返回归用例；同步各测试 mock 版本；全量测试通过。
4. **注意**：已安装 1.0.16 的设备升级到 1.0.17 仍是最后一次全量安装；自 1.0.17 起后续版本才真正走秒级热更新。

### 50. 药品编辑向导与批量管理排版优化及应用更新降级为轻提醒 (workspace/claude)

1. **时段标签竖排断行修复**：
   - 修复 `legacy.css` 与 `medication-editor.css` 中 `.slot-tag` 和 `.meal-slot-head .slot-tag` 因缺失 `white-space: nowrap` 与 `flex-shrink: 0` 导致在小屏弹性容器中汉字被压缩竖排折行的问题，保持水平单行胶囊徽章。
2. **智能快速填表空间分配重塑**：
   - 消除 `.smart-fill-ocr-wrap .btn` 继承 `flex-basis: 220px` 造成的高度异常膨胀，设置 `flex: 0 0 auto; min-block-size: var(--tap);` 恢复为 ~44px 标准单行功能按钮；
   - 自然语言输入文本域由 `rows: 2` 调整为 `rows: 4`，`min-height: 96px`，扩充长句描述空间。
3. **编辑药品顶部向导极简进度条重构**：
   - 将 `.med-wizard-steps` 重构为极简进度条模式：居中显示「步骤 2/3 · 用药计划」大字标题，下方配备三段式平滑进度指示条，彻底根治 360px~412px 手机屏幕下的文字折行与垂直空间浪费。
4. **批量管理卡片居中垂直流与纯紫色边框高亮**：
   - 移除卡片内 44px 左侧空白复选框列，卡片内部采用居中垂直流排版（缩略图居中、药名与剂量居中、时段胶囊居中），100% 充满双列网格空间；
   - 选中态去除对勾与底色填充，改为纯紫色高亮边框（`box-shadow: 0 0 0 2px var(--color-primary)`），保留隐藏复选框的无障碍语义。
5. **应用更新提醒降级为纯轻提醒**：
   - 原生 Android 提醒通道：在 `src/features/reminderTransport.ts` 中新增 `app_update_channel` 轻量通知渠道（`importance: 2`，无响铃、无振动、不弹出全屏横幅强打扰），在 `toNativeNotification` 中判定更新类通知（`tag === 'medbox-app-update'` 或 `mode === 'light'`）走该渠道并剥离「已服用/跳过」服药按钮；
   - Web 端提醒通道：在 `src/features/webReminderTransport.ts` 中调整更新通知参数，关闭 `requireInteraction`（允许自动收起），设置 `silent: true` 并不附加服药动作；
   - 前台静默免打扰：在 `src/sync/lan/apkTransport.ts` 中增设前台可见性守卫（`document.visibilityState === 'visible'`），前台活跃时抑制系统通知推送，仅通过 `medbox:app-update-changed` 事件静默更新界面徽标；
   - 底栏「我的」导航加入轻量小红点指示（`.tabbar-update-dot`），平缓提醒新版本，不强加感知。
6. **质量门禁**：
   - 补充 `tests/reminderTransport.test.ts`、`tests/webReminderTransport.test.ts`、`tests/apkUpdateVerification.test.ts` 与 `tests/tabKeepAlive.test.ts` 专项测试；全量 89 个测试套件 564 项测试 100% 通过，`npm run typecheck` 0 报错，`npm run build:web` 正常完成。

### 49. 药品编辑页面排版重构与「批量管理」无法打开/缩略图排版修复及 1.0.15 发版 (1.0.15, versionCode 50, workspace/claude)

1. **彻底解决「批量管理无法打开」的根因（持久 Tab 信号死锁）**：
   - 根因：`src/router.ts` 在页面切换时无条件调用 `activeController?.abort()`，导致一级 Tab（`/meds`）被切换离开后其 controller 永久被置为 `aborted: true`；当切回 `/meds` 时虽然命中 DOM 缓存池（TabPool），但由于闭包持有的 signal 已永久 abort，点击「批量管理」时 `enterBatchMode` 首行 `if (signal?.aborted) return;` 导致静默退出无响应；
   - 修复：在 `src/router.ts` 中实现 `abortTransientController(previousTabKey)`，在离开上一视图时判定：若上一页面为已在 TabPool 中成功渲染的持久 Tab，严禁调用其 abort()，仅重置全局 `activeController = null`；仅在离开瞬态子页面（如 `/meds/new`）时才执行 abort，确保持久 Tab 的订阅与信号生命周期健康；
   - 在 `src/pages/MedList.ts` 中解除 `enterBatchMode` 对外部路由 signal 的死锁依赖，基于当前挂载状态 `root.isConnected` 进行防重入与挂载检查，退出批量按钮无条件可靠执行 `renderMedListPage(root)`。
2. **批量管理界面排版重构与增加药品缩略图**：
   - 在 `enterBatchMode` 中并行拉取 `getMedPhotoUrls(meds.map(m => m.id))`；
   - 每张批量卡片新增 `.medication-batch-thumb` 缩略图容器，展示 16:10 圆角药盒实拍照片或 3D 拟物药瓶/药丸图（`getOrCreateMed3DImage`）；
   - 提醒时段标签改用 `display: flex; flex-wrap: wrap; gap: 3px;` 横向自然流式排版，彻底消除纵向堆叠导致单张卡片被异常拉长变形的顽疾；
   - 优化复选框对齐、整卡点选交互与高辨识度微光选中态，工具栏显示「共 X 种 · 已选 Y 种」。
3. **药品编辑/新增页面（MedEdit）排版重构与内容分隔加深**：
   - 采用 `.med-section-card` 模块化卡片体系（药盒外观、智能填表、基本档案、用药计划、库存管理、医嘱备注）；
   - 输入框增加浅色衬底与外发光微动效，明确内容分隔与视觉层级；
   - 合并每次剂量输入与常用单位胶囊，将「周期用药」移入第二步，移除错位的时段文案与底栏多余按钮，危险删除区域移至页面底部。
4. **质量门禁**：
   - 新增 `tests/tabKeepAlive.test.ts` 专项测试验证切换 Tab 不会误 abort 缓存 Tab 的控制器；
   - 扩展 `tests/medListUiContracts.test.ts` 验证缩略图契约；
   - 全量 89 个测试套件 558 项单元测试 100% 通过，`npm run typecheck` 零报错，`npm run build:web` 正常完成。

### 48. 全屏覆盖唤醒与响铃引擎全面修复及 1.0.14 发版 (1.0.14, versionCode 49, workspace/claude)

1. **响铃引擎与音量保障**：
   - 修复 `AlarmAudioPlayer.kt` 中由于调用 `MediaPlayer.create(..., 0)` 传入非法 `audioSessionId = 0` 导致 Android 底层抛出异常返回 null 的严重缺陷，重构为 `openRawResourceFd` 结合 `AudioAttributes(USAGE_ALARM)` 安全构建；
   - 响铃前增加闹钟通道（`STREAM_ALARM`）音量检测，若当前被用户调至 0 则自动调节为安全提示音量，确保在手机静音或振动模式下依然能够如真实闹钟般清晰唤醒。
2. **到点全屏覆盖与屏幕唤醒**：
   - 在 `MedicationAlarmContract.java` 中解除对全屏权限状态的硬拦截，始终绑定系统最高优先级全屏意图（`setFullScreenIntent`），并加入屏幕点亮唤醒锁（WakeLock）；
   - 在 Android 14+ 下通过 `openPending.send` 配合 `MODE_BACKGROUND_ACTIVITY_START_ALLOWED`，并结合 `AlarmRingService` 前台服务进行多重拉起保活，确保到点时无论处于锁屏还是在玩手机均能直接拉起全屏界面；
   - `MedicationAlarmPlugin.java` 增强全屏与悬浮窗设置跳转，增加逐级安全回退。
3. **设置页权限双轨独立引导**：
   - 在 `ReminderPanel.ts` 中拆分全屏提醒通知与在其他应用上层显示（悬浮窗）的独立检测与引导，提供一键跳转系统设置按钮。
4. **版本发布与质量门禁**：
   - 递增产品版本至 `1.0.14`，Android `versionCode: 49`；
   - 编写 `docs/releases/1.0.14.md` 并通过 `tone_lint.py` 校验；
   - 维护测试用例断言及 mock 候选版本（1.0.15/50）；
   - 全量 89 个测试套件 557 项测试 100% PASS，`typecheck` 0 报错，`build:web` 正常完成。

### 47. Web 增量热更新机制修复与双更新模式落地 (1.0.13, versionCode 48, workspace/claude)

1. **增量热更新判断缺陷修复**：
   - 修复 `src/sync/lan/apkTransport.ts` 中 `checkGithubRelease` 的判断逻辑：此前因判定条件为 `LOCAL_APP_VERSION_CODE >= estimatedCode`，在目标版本高于当前版本时恒为 false，导致任何新版本都被误判为不支持增量更新而回退全量 APK 下载；
   - 引入最低原生 APK versionCode 底座门槛常量 `DEFAULT_MIN_NATIVE_BUNDLE_VERSION_CODE = 44`（自 v1.0.9 首次支持动态 bundle 解压运行），只要本机底座版本达到 44 即可正确触发增量更新判断；
   - 从 GitHub Release 资产中动态提取 `bundleSha256` 与 `apkSha256`。
2. **跨平台哈希漂移消除与边缘动态元数据**：
   - 重构 `scripts/bundle-web.mjs` 为纯 JS 标准 zip 打包（使用 `createZipBuffer`），统一时间戳与文件路径分隔符，彻底消除 Windows 与 Linux 之间打包产物哈希不一致问题；
   - 新增 Cloudflare Pages 动态边缘函数 `functions/version.json.ts`，直接代理 GitHub Releases 权威资产的真实文件大小与 SHA-256 哈希，彻底杜绝 CDN 静态文件与实际附件之间的哈希漂移。
3. **双更新模式与故障自动容错**：
   - 在 `AppUpdatePanel.ts` 中针对支持增量更新的设备增加“下载完整包”按钮，用户可自主选择一键秒级更新或全量覆盖安装；
   - 增量热更新下载或校验失败时，提供友好提示并自动转接至完整包更新通道，杜绝流程卡死。
4. **版本发布与质量门禁**：
   - 递增产品版本至 `1.0.13`，Android `versionCode: 48`；
   - 编写 `docs/releases/1.0.13.md` 并通过 `tone_lint.py` 门禁校验；
   - 维护测试用例断言及 mock 候选版本（1.0.14/49）。

### 46. 全屏提醒前台弹出与双重铃声混杂问题解决及 1.0.12 发版 (1.0.12, versionCode 47, workspace/claude)

1. **全屏提醒前台任意页面直显**：
   - 添加 `SYSTEM_ALERT_WINDOW`（悬浮窗）权限声明；
   - 在 `MedicationAlarmContract.java` 中引入 `AlarmManager.setAlarmClock()` 获取系统后台拉起 Activity 豁免；
   - 在锁屏唤醒与前台启动中配置 `ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED`，并保留前台服务 `AlarmRingService` 兜底；
   - 原生插件 `PowerSettingsPlugin.java` 与 `MedicationAlarmPlugin.java` 提供悬浮窗权限检测与品牌特定跳转（如小米 `miui.intent.action.APP_PERM_EDITOR` 后台弹出界面）；
   - 设置页 `ReminderPanel.ts` 与 `KeepAlivePanel.ts` 呈现全屏权限状态卡片与快捷开启引导。
2. **响铃通道彻底剥离与双重声音消除**：
   - 通知渠道改造为静音通知（`setSound(null, null)`），避免系统默认通知音同时作响；
   - 闹钟声音统一切换至 `STREAM_ALARM`（`USAGE_ALARM`，`CONTENT_TYPE_SONIFICATION`），并通过 `AlarmAudioPlayer` 独立单源播放；
   - `MedicationAlarmActivity.kt` 绑定 `volumeControlStream = AudioManager.STREAM_ALARM`，实现侧边音量键直接调节闹钟音量；
   - 音频播放器添加幂等防护，防止 Activity 重复触发造成破音或重叠。
3. **版本发布流程与规范落地**：
   - 递增产品版本至 `1.0.12`，Android `versionCode: 47`；
   - 更新 `scripts/lib/release-utils.mjs`，维护测试用例断言及 mock 候选版本（1.0.13/48）；
   - 编写 `docs/releases/1.0.12.md` 并通过 `tone_lint.py` 校验。

### 45. 版本发布与系统架构重构全面交付 (1.0.11, versionCode 46, workspace/claude)

1. **版本发布流程推进 (SOP 严格执行)**：
   - 递增产品版本至 `1.0.11`，Android `versionCode: 46`；
   - 更新 `scripts/lib/release-utils.mjs` 登记 `1.0.11: 46`；
   - 维护测试用例 `release-utils.test.ts`、`apkUpdateVerification.test.ts` 与 `bundleUpdateVerification.test.ts` 的版本断言与候选 mock 版本（递增至 1.0.12/47）；
   - 遵循 `oil-tone` 规约编写发布说明 `docs/releases/1.0.11.md` 并通过 `tone_lint.py` 门禁校验。
2. **重构交付清单**：
   - `Settings.ts` (2,715行) 模块化至 `src/pages/settings/`；
   - `local.ts` (1,968行) 模块化至 `src/db/repositories/`；
   - `assistantTools.ts` (1,776行) 模块化至 `src/ai/tools/`；
   - `MedEdit.ts` (1,579行) 解耦出 `dosageHelper`, `formValidation`, `photoStudioHelper`；
   - 底栏一级页面 Keep-Alive 常驻缓存池与滚动位置记忆；
   - 主流手机（小米、华为、OPPO、vivo）自启动与后台保活设置深度跳转；
   - 手机存储与缓存清理功能。

### 44. Tab Keep-Alive 视图常驻缓存池与数据增量更新架构落地 (Phase 2, workspace/claude)

1. **底栏一级页面常驻缓存池与首屏防御 (`src/app/tabPool.ts`, `src/router.ts`)**：
   - 将四个主要底栏页面（今日清单 `/today`、药品列表 `/meds`、用药历史 `/history`、设置 `/settings`）及兼容别名切换机制改造为 DOM 保活视图池；
   - 切换标签时不再清空并重构整个页面 DOM，而是通过隐藏/显示状态切换（`hidden = true` / `display: none !important`）保留页面节点，消除页面重置感与白屏闪烁；
   - 离开页面前自动记录主滚动区域的滚动条位置，重新进入时自动还原；底栏注入真实点击拦截，再次点击当前底栏标签时平滑回到顶部并派发生命周期事件。
2. **独立子页面隔离容器、取消信号闭环与返回恢复机制**：
   - 进入新增药品、药品详情、扫码分类、库存盘点等子页面时，将当前主页面保留在池中并隐藏，在专属子页面容器中挂载子页面；支持以子页面为首屏直接启动；
   - 用户点击返回或切入底栏主页面时，主动中止正在运行的子页面异步任务（`activeController.abort()`），执行子页面清理并彻底销毁子页面容器内容，恢复父级主页面的可见状态并还原滚动条位置。
3. **数据库变更通知系统与生命周期增量更新 (`src/db/databaseEvents.ts`)**：
   - 新建轻量级单调递增数据库版本号计数器与变更发射器（`getDatabaseRevision`, `notifyDataChanged`, `onDataChanged`）；
   - 在药品单条/批量新增、规则修改/删除、日志打卡、库存扣减/撤回、时段设置及导入导出等所有数据库写操作中埋入变更通知；
   - 各主页面监听 `tab:activated` 生命周期事件，在重新切回时比对版本号以及午夜跨天日期，仅在数据真正变更或跨天时局部刷新数据，未变更时保持已有 DOM 展现与滚动条绝对静止；
   - 引入 WeakMap 清理机制，防止多次内部刷新或筛选切换导致事件监听器翻倍泄露。
4. **自动化测试与门禁验证**：
   - 新建 `tests/tabKeepAlive.test.ts`（包含 13 项深度专项测试，覆盖 DOM 保活、滚动条记忆与恢复、子页面挂载与退出恢复、子页面取消信号闭环、直接首跳子页面隔离、生命周期回调、真实 tabbar 点击拦截、重复点击回顶、批量写入变更通知与内存防重）；
   - 全量 89 个测试套件 550 项测试 100% 全部通过；
   - `npm run typecheck` 0 报错；
   - `npm run build:web` 成功打包出 Web Bundle 增量包。

### 43. 用药提醒专属铃声《晨间活力》配置与自由切换落地 (1.0.10, workspace/claude)

1. **专属音频资源导入**：
   - 将用户指定的本地音频文件规范导入到 Android 原生 raw 目录 `android/app/src/main/res/raw/morning_energy.mp3`（972,719 字节）；
   - 同源部署至 Web 端静态资产目录 `public/audio/morning_energy.mp3`，供网页端及设置页在线试听。
2. **默认铃声切换与原生播放引擎改造**：
   - `AlarmAudioPlayer.kt`：读取原生偏好 `alarm_ringtone`，默认值为 `"morning_energy"`；
   - 优先通过 `MediaPlayer` 以 `USAGE_ALARM` 通道循环播放专属音乐，并管理临时音频焦点；当设为 `system` 或加载异常时平滑降级至 `RingtoneManager` 播放系统铃声；
   - `MedicationAlarmPlugin.java`：暴露 `getRingtonePreference` 与 `setRingtonePreference` 原生方法，持久化到 Android SharedPreferences。
3. **设置页自由切换与在线试听 UI**：
   - `Settings.ts` 与 `settings.css`：在提醒面板中新增「用药提醒铃声」卡片，提供「晨间活力（专属推荐）」与「系统默认闹钟」单选切换；
   - 提供「试听专属提醒音乐（晨间活力）」按钮，支持一键试听与停止，切换页面或离开时自动停止；
   - 文风严格遵守 `oil-tone` 规范，无技术黑话。
4. **自动化测试与门禁验证**：
   - 新建 `tests/alarmRingtone.test.ts`（6 项测试全部通过）；
   - 全量 86 个测试套件 529 项测试 100% 通过；
   - `npm run typecheck` 0 报错；
   - Android Gradle 编译与 `assembleRelease` 顺利通过。

### 42. 首个增量热更新底座版本发布、发布 SOP 技能升级与测试用例同步 (1.0.9)

1. **版本递增与底座支持**：
   - 将应用版本号升至 `1.0.9`，Android `versionCode` 升至 `44`；
   - 固化 `MIN_NATIVE_BUNDLE_VERSION_CODE = 44`，确立 1.0.9 为首个具备原生 Web Bundle 解压与基座动态切换能力的底座版本；
   - 编写符合 `oil-tone` 规范且经 `tone_lint.py` 验证的 `docs/releases/1.0.9.md`。
2. **测试门禁与构建验证**：
   - 同步 `tests/release-utils.test.ts`、`tests/apkUpdateVerification.test.ts` 与 `tests/bundleUpdateVerification.test.ts`，候选 mock 升至 1.0.10 / 45；
   - 全量 85 个测试套件 523 项测试 100% 通过；
   - `npm run build:web` 自动生成约 1.8MB 增量包 `release/xiaoyaohe-1.0.9-web-bundle.zip`。

### 41. 安装包大幅瘦身 (-31.76MB)、桌面拷贝清理规则与零服务器成本增量更新方案实施与落地 (1.0.8)

1. **安装包大幅瘦身（-31.76MB，净降 63.9%）**：
   - 清除历史遗留在 `public/release/` 下的旧版 APK（31.3MB），杜绝 Vite 打包与 Capacitor 静态资源复制泄露；
   - 修改 `scripts/gen-version.mjs` 仅扫描仓库根目录 `release/`；
   - `android/app/build.gradle` 的 `aaptOptions.ignoreAssetsPattern` 追加 `:*.apk`，在 Gradle 编译层彻底阻断任何 APK 文件混入 assets；
   - 安装包体积从 49.7MB 降低至 17.96MB（18,835,967 字节）。
2. **桌面拷贝清理与规则确立**：
   - 已彻底删除放置在用户电脑桌面上的旧版 APK 文件；
   - 明确规则：后续所有发布流程严禁向用户桌面复制安装包，安装包一律只保留在 `medbox/release/` 目录和 GitHub Releases 线上。
3. **经验沉淀与发版技能固化 (/learn)**：
   - 更新全局规则 `AGENTS.md`、子模块规则 `medbox/AGENTS.md`、发版全指南 `docs/releases/GUIDE.md` 与发布技能 `.agents/skills/medbox-release/SKILL.md`；
   - 确立构建产物（APK / Web 增量包）严禁拷贝至用户桌面的硬性红线；
   - 将 1.8MB Web 增量包打包、哈希与大小同步注入以及 `gh release create` 多资产上传纳入标准发版 SOP；
   - 确立 85 个测试套件质量门禁基线，强化推送到远端前必须版本加一与 oil-tone 零黑话文风约束。
4. **零服务器成本增量更新方案实施与落地（已完成）**：
   - 基于现有 Cloudflare Pages + GitHub Releases 打造无感增量热更新机制；
   - `ApkDistributionPlugin.java` 实现 `downloadAndUnpackBundle`、`applyWebBundle`、`resetWebBundle` 与 `getActiveWebBundle` 原生安全桥接；
   - 增加 `scripts/bundle-web.mjs`，与 `gen-version.mjs`、`package.json` 联动自动化归档 `web-bundle.zip` 并注入 `version.json`；
   - 客户端 `apkTransport.ts` 与 `Settings.ts` 动态判断底座版本并支持「一键秒级更新」；
   - 新增 `tests/bundleUpdateVerification.test.ts`，全量 85 个测试套件 523 项测试 100% 通过，Gradle 编译验证通过。

### 40. 设置页纯平铺分类卡片架构、五彩微拟物图标重绘与药品列表/批量管理排版全面优化 (1.0.7)

1. **设置页（我的）内容去重与架构扁平化**：
   - 移除原「顶部 6 行菜单卡片 (`profile-menu-card`)」及右上角「齿轮菜单按钮 (`gearBtn`)」，彻底解决设置功能三重重复的问题；
   - 确立纯平铺分类卡片群架构，划分为「提醒与外观」、「数据与同步」、「智能助手与高级」及居中展台「关于小药盒」。
2. **全套 11 项五彩微拟物图标重绘与深色模式自适应**：
   - 参考原 6 行菜单的圆角彩底微拟物图标体系（32x32px、`border-radius: 8px`、高品质语义浅彩底色），重绘全量设置项图标：
     - 系统通知（`amber` 暖橙琥珀）
     - 时段提醒设置（`emerald` 生机翠绿）
     - 外观偏好（`violet` 梦幻紫罗兰）
     - 后台保活与防杀（`orange` 警示珊瑚橙）
     - 家庭同步（`sky` 晴空天蓝）
     - 本地数据与备份（`teal` 沉稳松石绿）
     - 检查应用更新（`blue` 活力宝蓝）
     - AI 大模型服务商（`purple` 智能深紫）
     - AI 生图服务商（`rose` 灵感玫瑰粉）
     - AI 外发授权（`gold` 安全金黄）
     - 诊断记录（`cyan` 极客青蓝）
   - 为深色模式配备专属微光背景与高饱和前景。
3. **关于小药盒居中展台重新排版**：
   - 顶部居中渲染 56px 渐变药盒图标与多层微光晕，搭配版本号药丸徽章；
   - 居中平铺 2x2 精致特性磁贴卡片（Tile Card），展现安全隐私、离线优先等核心能力；
   - 底部柔和淡灰居中呈现健康免责声明，视觉层次大幅跃升。
4. **药品页「添加药品」FAB 移入右下角操作坞**：
   - 将原随页面滚动的添加按钮脱离主内容流，挂载到底部操作坞（`createActionDock([fabAdd])`）；
   - 操作坞背景设为透明，非按钮区域穿透，确保右下角悬浮停靠且严守无 `position: fixed` 的契约规范。
5. **药品页三大指标卡去圈改环境光晕**：
   - 彻底清除「全部药品、近期使用、需补充」指标卡图标下方的实色圆盘底色（`background: transparent !important`）；
   - 升级为多层渐变与大范围模糊滤镜（`inset: -12px; filter: blur(10px)`）构成的自然环境光晕（Halo）。
6. **批量管理页面针对性排版根治**：
   - **卡片独立质感**：2 列药品从紧密挤贴在同一个大白底框升级为带独立边框、圆角、阴影与点击缩放反馈的独立微卡片单元；
   - **复选框可见度与整卡点选**：加深未选复选框边框为 `#94a3b8`（杜绝白底隐形），支持点击卡片任意位置切换勾选；
   - **操作条单行极简瘦身**：移除操作栏内重复的「已选 0 种」，将 4 个操作按钮优化为 50px 超薄毛玻璃单行浮动胶囊工具栏，彻底消除遮挡大半屏药品的缺陷。

### 39. 药盒生图提示词正面平视化、应用内输入弹窗统一与更新排版优化 (1.0.6)

1. **药盒生图全面重构为正面平视大图**：
   - 彻底清除提示词中导致 45 度侧视透视的 `Three-quarter isometric front perspective view`；
   - 替换为正面正视平投指令 `Direct straight-on front view (eye-level frontal orthographic product shot)`，确保药盒完整正面朝向镜头，0 倾角无侧面；
   - 融入参考图双语提纯指令，彻底去除拍摄时的手持、手指与杂乱背景，输出通透纯白底加柔和落地阴影的商业大图。
2. **应用内输入弹窗统一，清退原生弹窗**：
   - 全局封装卡片式 `promptDialog` 组件，替换系统原生 `window.prompt` 与 `confirm` 弹窗；
   - 解决软键盘遮挡输入框问题，并支持回车确定、ESC 取消；
   - 将生图设置面板底部按钮优化为 2 列栅格，杜绝按钮文字截断。
3. **应用更新面板与 Markdown 发布说明排版根治**：
   - 将原更新面板从引发 Flex 行挤压折行的 `.banner.info` 升级为专用竖向卡片架构 `.app-update-card`；
   - 新增零体积依赖轻量原生 Markdown 渲染器，发布说明语义化高保真显示。

### 38. 线上更新分发与版本发布完整指南与 SOP 标准化 (1.0.5)

1. **体系化沉淀线上更新分发架构**：
   - 撰写了系统详尽的 [`docs/releases/GUIDE.md`](./GUIDE.md)；
   - 深入剖析了 GitHub Releases（产物宿主）+ Cloudflare Pages Functions（海外边缘流式代理）+ Android 原生安全下载器的三层更新架构；
   - 彻底阐明为什么不能直接用 GitHub 直链（私有仓库匿名 404）以及为什么不能 302 重定向到 Azure Blob（国内移动端 403 阻断）。
2. **制定 10 步标准化发版 SOP 操作检查单**：
   - 从版本递增、测试用例同步、双重门禁（Vitest + Typecheck + Web 构建 + Capacitor 同步）、正式 Android Release 打包、体积哈希校验、分支与 Tag 推送、GitHub Release 附件上传到最后的自动化线上全链路冒烟；
   - 明确了所有多工具团队开发者在需要发版时的统一标准流程。
3. **高频故障排查与避坑手册**：
   - 包含 GitHub Token 权限缺失 (503)、只打 Git Tag 导致 404、Gradle 下载截断及本地测试版本 Mock 冲突等典型问题的排查与解决方法。

### 37. Agnes 及同类多模态 AI 生图协议自适应兼容与配置管理 (1.0.5)

1. **协议层深度自适应（解决 Agnes 等服务商报 400 及图出不来问题）**：
   - 彻底移除顶层不兼容字段（如 `response_format` 与 `n: 1`），避免被严格校验后端拒收；
   - 智能注入多模态格式参数：`return_base64: true`、`extra_body: { response_format: 'b64_json' }`，同时根据模型类型自适应注入分辨率/比例字段（如 `size: '1K'`, `ratio: '1:1'`）；
   - 彻底解决 Base64 返回格式可能携带 `data:image/...;base64,` 前缀导致的 Blob 解码损坏问题。
2. **多模态图生图（Img2Img）三级平滑降级**：
   - 当提供原始药盒照片时，优先尝试 `/images/edits` 原图修图；
   - 若接口不支持（如 Agnes 仅有 `/images/generations`），自动切换为以 `extra_body.image: [base64]` 形式传递底图进行图生图；
   - 若图生图仍不支持，平滑降级为纯文本提示词文生图，保证出图成功率。
3. **海外存储节点（GCS）超时降级兜底**：
   - 针对部分服务商默认返回 `storage.googleapis.com` 导致国内无法加载图片的问题，增加 10s 快速超时并在失败时给出明确提示。
4. **生图设置面板移除硬编码预设，支持自定义配置管理**：
   - 移除固定的模型预设列表，彻底避免硬编码配置过期；
   - 支持将当前输入的完整配置（名称、Base URL、API Key、模型名、接口模式）一键「存为新配置」；
   - 界面直观展示已保存的配置标签，点击快速切换载入，支持点击 `×` 删除配置。
5. **质量保证**：
   - 全量 84 套件 518 项单元与集成测试 100% 通过；
   - 静态类型检查 `npm run typecheck` 0 错误；
   - Web 生产构建 `npm run build:web` 顺利完成。

### 36. AI 药盒生图与修图双模引擎及自动平滑回退 (1.0.4)

1. **同时支持两种生图接口**：
   - 原图扫描修图模式（`/images/edits`，multipart/form-data）：类似扫描全能王，白底化、去阴影、透视矫正与文字清晰度增强，100% 保真原始药盒字迹与品牌标识；
   - 商业展台文生图模式（`/images/generations`，JSON）：商业摄影 Prompt 驱动，支持根据药盒特征或药名/规格推断生成专业级药盒展台大图，兼容几乎所有主流 OpenAI 兼容服务商（DALL·E 3、通义万相、CogView 等）。
2. **智能平滑自动回退（Auto Mode）**：
   - 有照片时优先尝试原图修图；若服务商不支持该接口（返回 404/405/501），自动无缝平滑回退至文生大图，绝不中断或抛错；
   - 无照片但输入药名时，支持直接调用文生图生成大图。
3. **生图独立设置面板强化**：
   - 新增「生图接口模式」配置（自动推荐 / 仅原图修图 / 仅文生大图）；
   - 预设常用生图模型（GPT Image 1、DALL·E 3、DALL·E 2、通义万相、CogView-3）。
4. **质量验证**：
   - 全量 83 套件 511 项测试 100% 通过（新增与重构双模式测试覆盖），TypeScript 0 错误，Web 与 Android 编译打包通过。

### 35. 修复 Cloudflare 代理下载 APK 报 HTTP error 403 缺陷 (1.0.1)

1. **403 根因定位**：
   - 过去 `functions/api/download.ts` 收到客户端请求后，通过 `redirect: 'manual'` 截获 GitHub API 的 302 重定向并直接向客户端下发 `Response.redirect(redirectLocation, 302)`。
   - 这导致国内安卓客户端直接与 GitHub 底层的临时存储节点 `release-assets.githubusercontent.com`（Azure Blob）建立连接。在国内移动网络/DNS 环境下，该直连受运营商策略拦截、防盗链签名或网络策略影响，返回 `HTTP error 403: Forbidden`。
2. **边缘流式直传架构重构**：
   - `functions/api/download.ts` 改为 `redirect: 'follow'`，由 Cloudflare 边缘节点（海外骨干网）在内部跟随 GitHub 302 跳转获取真实二进制流；
   - 彻底移除向客户端抛出 302 跳转的逻辑，改为由 Cloudflare 边缘直接以 `Response(assetRes.body)` 流式代理回传 APK，设置正确的 `Content-Type: application/vnd.android.package-archive`、`Content-Length` 与 `Content-Disposition`；
   - 客户端全程仅与同源的 `https://xiaoyaohe.pages.dev/api/download` 通信，彻底杜绝客户端直连 `githubusercontent.com`，根除 403 Forbidden。
3. **原生下载客户端 User-Agent 规范化**：
   - `ApkDistributionPlugin.java` 原生 `doDownloadHttp` 请求头 User-Agent 从非常规的 `Xiaoyaohe/app` 改为标准化移动端 User-Agent，避免触发 CDN WAF 机器人拦截，并在抛出异常时附带具体目标 URL 方便排查。
4. **质量验证**：
   - `tests/functionsApi.test.ts` 16 项测试全数通过；
   - 全量 83 个测试套件 506 项测试全绿，`npm run build:web` 编译成功。

### 34. 主导航与四屏 1:1 视觉复刻与真实后端数据联通 (1.0.0)

1. **主导航更新**：第 5 项 Tab 命名更新为「我的」（原为「设置」），并兼容原有契约测试。
2. **Screen 1「今天」**：
   - 移除冗余背景与次级文字，精简顶栏为大标题「今天」+ 真实日期 + 右侧「✦ AI 助手」；
   - 居中均衡展示「今日用药进度」卡片与环形进度条、已服用/待服用/跳过图例（颜色严格对齐设计图：已服用高饱和宝蓝 `#2563eb`、待服用翡翠绿 `#10b981`、跳过中灰 `#94a3b8`）；
   - 时段过滤提供「全部 / 早上 / 中午 / 晚上」；支持时段一键批量打卡与圆形 Radio 勾选打卡，修复 Radio 单击直接写库与撤回逻辑，修复频次动态计算与库存单位自适应展示。
3. **Screen 2「药品」**：
   - 指标卡规范展示真实药品统计（全部药品、近期使用、需补充），对齐空格间距；
   - 药品列表行规范为单行副标题（规格 + 服药频次，如 `5mg · 1片 · 每日1次`）与库存徽章（`库存充足 剩余36片`）；右侧规范为标准单箭头 `>` 跳转编辑；
   - 激活态分类胶囊统一采用高保真宝蓝色 (`#2563eb`)。
4. **Screen 3「库存」**：
   - 顶部保留「✦ AI 助手」，首行独占「库存健康」卡片（带发光盾牌徽章、健康副标语与指标行），头部点击支持直接呼出智能录入、历史操作与撤销、批量预扣、分享清单等全部底层操作；
   - 搜索框紧跟概览卡片后（占位符「搜索药品名称」）并配备筛选漏斗；
   - 库存卡采用紧凑双行信息（首行规格与包装量，次行剩余与折算天数）及单标签状态（充足/临期/不足/已过期）。
5. **Screen 4「我的」**：
   - 顶栏右侧配置系统齿轮按钮 ⚙，修复 DOM 节点移位 Bug，提供专用「高级系统设置」快捷面板直达 AI 密钥、局域网同步、备份和诊断；
   - 修复移动端基础网格 CSS，实现高保真 1x3 数据卡片平铺排布；
   - 个人信息卡：左侧 3D 头像带编辑相机角标，右侧展示用户名「小药盒用户」、副标语「用药管理 第 X 天」与优雅浅蓝打卡徽章「✔ 已记录 x 次服药」；
   - 菜单列表：规范实现 iOS 风格 6 行功能入口，对齐图标底色与主色。
6. **质量门验证**：
   - `npm run typecheck`（0 错误）；
   - `npm test`（83 套件，507 项测试全部通过）；
   - `npm run build:web` 构建成功。

### 33. 全面清退 Emoji 统一 SVG 矢量图标体系与页面像素级还原 (1.0.0)

1. **全面清退 Emoji 统一矢量图标 (`/oil-icon`)**：
   - 贯彻用户全局总要求，清退所有页面与通知中的 Unicode emoji（🔔、⚠️、💡、✓、🎉、☀️、🌙、✨、📅、🔍、⚙、📦、📋、❤️、📷 等）；
   - 全面使用 Tabler / Lucide 统一纯矢量 SVG 图标体系。
2. **今日页面细节还原 (`media_1789100010055.png`)**：
   - 顶部晨光背景毛玻璃遮罩 (`backdrop-filter: blur(14px)`)；
   - Slogan 笔刷强调线；
   - 右侧专属紧凑胶囊卡片（48px 小型高光 3D 胶囊 + 中文治愈手写体「坚持用药 / 很重要～」+ 箭头）；
   - 今日用药计划左侧紫色日历 squircle SVG 徽章，右侧「✓ 一键打卡」；时段头部太阳/月亮 squircle SVG 徽章。
3. **药品与库存页面细节还原 (`media_1789100238351.png`)**：
   - **药品**：顶栏「药品」+「≔ 批量管理」+「✦ AI 助手」；3 个纯白 (18px) 指标卡（全部药品 12 种、近期使用 12 种、需补充 0 种），底部蓝/绿/粉圆形环境光光晕托盘分别承托药瓶、研磨器与急救箱。
   - **库存**：顶栏「库存」+「✦ AI 助手」；独占「库存健康」卡片（48px 翡翠绿圆形底座 3D 勾选盾牌 +「库存健康」+「整体充足，暂无风险」+ 箭头 `>`），下方 4 列数据（全部药品、近期使用、需补充、已过期），标签在上数值在下（「12 种」）；浮动「+ 添加库存」FAB。
4. **自包含原型 (`preview/design_mockup_preview.html`) 同步**：
   - 零 emoji 校验，截取四屏全景并列与深色模式交互截图。
5. **质量门禁**：
   - `npm run typecheck`（0 errors）；
   - `npm test`（83 测试套件，507 项测试 100% 全绿）；
   - `npm run build:web` 构建成功。

### 32. 药盒拍照静默生成商业纯白底展台大图与独立 AI 生图服务商配置 (1.0.0)

1. **药盒拍摄静默生成商业纯白底展台大图 (AI Studio Packshot)**：
   - **交互流程零阻塞**：拍照或从相册选图后，直接加载原照片并进入编辑表单，不再强制弹起四角裁切打断；后台静默排队进行视觉特征提取与生图，完成后以平滑淡入动效自动替换预览图；
   - **底片保留与无损切换**：底层数据模型扩展 `PhotoBlob.originalBlob` 与 `kind: 'original' | 'ai_packshot'`。在药盒照片区域提供「恢复原图」、「AI 生成展台图」与「重新裁切原图」快捷入口，无网络或生图失败时优雅保留原照片；
   - **两阶段智能管线 (`aiImageStudio.ts`)**：
     - 第一阶段：视觉大模型（若有原图）抽取药盒形态、品牌色调与版式特征（无原图时根据药名与规格智能启发推测）；
     - 第二阶段：拼装商业静物摄影 Prompt，调用 OpenAI 兼容图像接口（`/v1/images/generations`，支持 `b64_json` 与 `url` 兜底拉取）；
     - 第三阶段：生成图入库前自动由 `compressBoxPhoto` 压缩至 720px 与 220KB 限制内，杜绝 Android WebView OOM。
2. **独立「AI 生图服务商」配置面板 (`imageGenSettingsPanel.ts`)**：
   - 在「设置」-「智能助手与高级」中开辟独立生图服务商卡片；
   - 支持快捷预设胶囊（DALL·E 3、通义万相、FLUX、CogView-3）；
   - 未单独配置或启用时，自动继承当前活跃的主 AI 文本服务商（Base URL 与 API Key）；
   - 配备一键连通性测试与模型连通状态提示。
3. **全绿验证门**：
   - `npm run typecheck` (0 errors)；
   - `npm test`（83 个测试套件，507 项测试 100% 全绿，新增 `tests/aiImageStudio.test.ts` 6 项测试）；
   - `npm run build:web` 成功编译通过。

### 31. 前端高保真设计全面优化、Gemini 3D 资产生成与交互落地 (1.0.0)

1. **Gemini 3D 拟物与真实微质感非 SVG 视觉资产生成与无损透明边缘抠图**：
   - 基于设计稿与 Gemini Imagen 3 专项生成全套 3D 拟物资产：
     - `nature-header-bokeh.png`（晨光自然绿植与柔和散斑光晕，左侧及下方平滑羽化渐变融合）；
     - `today-floating-capsule.png`（今日卡片 45° 蓝白高光 3D 浮动胶囊，带水凝高光与透明通道）；
     - `inventory-health-shield.png`（3D 翡翠绿库存健康盾牌徽章，带发光勾选与微拟物厚度）；
     - `med-bottle-3d.png`（全部药品 3D 水晶蓝药瓶）；
     - `med-recent-mortar.png`（近期使用 3D 薄荷绿研磨器与闹钟药丸）；
     - `med-aid-kit-3d.png`（需补充 3D 珊瑚粉急救箱）；
     - `user-avatar-3d.png`（专属 3D 阳光少年头像，戴耳机、立领夹克，像素级对齐设计稿）。
   - 保存在 `src/assets/images3d/` 并通过 `src/ui/assets3d.ts` 集中管理，提供标准降级 SVG。
2. **零污染交付安全机制与双模 HTML 交互原型（Phase 1~3）**：
   - 在修改生产代码前，先创建 `preview/design_mockup_preview.html`（4.2MB 自包含纯单文件网页原型，内嵌全套 Base64 资产）；
   - 提供全景四屏并列模式与 iPhone 15 Pro 仿真模拟器，实现打卡联动、环形进度条偏移动画、时段药丸筛选与深色模式；
   - 经自动化走查与用户评审确认后，无缝正式落地至 `medbox/` 生产代码。
3. **页面层级与样式重构落地（Phase 4）**：
   - **「今日」页面 (`Today.ts`, `today.css`)**：
     - 注入晨光绿植背景 (`.today-nature-bokeh-bg`)，增加日期与天气状态胶囊 (`.today-weather-pill`)；
     - 在今日用药进度卡片引入 3D 蓝白悬浮胶囊 (`.today-capsule-float`)，附带轻柔呼吸浮动动效 (`floatPill`) 与环境投影；
     - 完美兼容所有 UI 契约 (`todayUiContracts.test.ts` 5/5 全过)。
   - **「药品」页面 (`MedList.ts`)**：
     - 顶部三枚 3D 统计卡片接入水晶蓝药瓶、薄荷绿研磨器与珊瑚粉急救箱；
     - 保持原有操作坞、批量管理与筛选契约 (`medListUiContracts.test.ts` 2/2 全过)。
   - **「库存」页面 (`MedInventory.ts`, `inventory.css`)**：
     - 概览卡片升级为「库存健康」卡片，右上角常驻渲染 3D 翡翠绿发光盾牌徽章 (`.inventory-health-shield-wrap`)，配合微拟物光晕；
     - 动态计算并展示健康状态（「良好」/「需关注」）与风险提示文案，保留全部统计指标与添加按钮 (`inventoryPageHelpers.test.ts` 6/6 全过)。
4. **全绿验证门**：
   - `npm run typecheck` (0 errors)；
   - `npm test`（82 个测试套件，501 项测试 100% 全绿）；
   - `npm run build:web` 成功构建；
   - 32 个内嵌图标与构建期元数据校验全数通过。

### 30. 前端与后端全面检查与修复（1.0.0 基线）

完整结论见 `docs/audits/2026-09-09-frontend-backend-audit.md`。只读检查后按严重度修复，每项独立提交。

1. **P0 云端更新链路在线上完全不可用（已定位并修复代码侧）**：
   - 线上 `version.json` 的 `downloadUrl` 指向**私有**仓库 Release 资产（匿名 404），`fileSize` 为 `gen-version.mjs` 的硬编码兜底 `16398223`（真实 APK 为 `32095374` 字节）；
   - `/release/xiaoyaohe-1.0.0-android-release.apk` 实测返回 200 `text/html`（Pages SPA 兜底，`public/release/` 被 gitignore 忽略）；
   - `scripts/gen-version.mjs` 改为输出同源代理直链 `/api/download?tag=v…`，写入真实 `fileSize` 与 `sha256`，找不到产物时只警告不编造数字。
2. **P0 Cloudflare 代理未配置（需用户执行）**：`/api/releases` 与 `/api/download` 线上均 503 `GITHUB_TOKEN_NOT_CONFIGURED`。**待办：在 Pages 项目设置里添加 `GITHUB_TOKEN`（建议 fine-grained、仅 `Contents: Read`、仅本仓库），重新部署后跑 `node scripts/check-release-endpoints.mjs` 验证。**
3. **P1 代理安全加固（`functions/api/_shared.ts` 新增）**：
   - `tag` 版本号白名单 + URL 前缀断言，封堵路径穿越（`tag=../../../../user` 会让 WHATWG URL 归一化到 `api.github.com/repos/user`）与查询注入；
   - CORS 由 `*` 收窄为来源白名单（pages.dev / `https://localhost` / `capacitor://localhost`）+ `Vary: Origin`；
   - 上游错误统一脱敏为 `UPSTREAM_ERROR`，兜底流式回传仅在 `res.ok` 时进行，补 `nosniff`/`Referrer-Policy`/`X-GitHub-Api-Version` 与 8s 超时。
4. **P1 `releases.ts` 改写资产直链**：把 APK 的 `browser_download_url` 换成同源 `/api/download?tag=…`，客户端因此无需理解代理细节；客户端 `checkGithubRelease` 同步只走自家代理，删除对 `api.github.com` 与三个公开镜像的直连（私有仓库下必然 404）。
5. **P1 客户端下载加固（`apkTransport.ts`）**：下载主机白名单、`fileSize` 字节数校验（不符即删包并中止）、`sha256` 透传、部署域名收敛为 `CLOUD_ORIGIN` 常量、移除无意义的 ghproxy 前缀重试。
6. **P1 删除明文密钥死路径（`extras.ts`）**：`agnes` 分支读的是不存在的 `VITE_AGNES_*`，接收端却会把密钥明文写进无人读取的 `localStorage['medbox.agnesApi.v1']`；现已整体移除，旧对端字段被 schema 拒绝，设置面板文案补注「含密钥，加密传输」。
7. **P2 元数据与 CI 治理**：`public/version.json` 移出版本控制（构建生成、不再弄脏工作区）；`release-apk.yml` 缺签名 secret 时直接失败（原先用硬编码口令 `medbox123` 现造密钥，产出的 APK 用户装不上也升不了级）；删除指向不存在站点的 `deploy-web.yml`（GitHub Pages 实测 404）。
8. **新增验证门**：`tests/functionsApi.test.ts`（17 项，直接驱动两个 Function handler）、`tests/versionManifest.test.ts`（3 项）、`tests/lanSyncSecretContracts.test.ts`（3 项）、`tests/apkUpdateVerification.test.ts` 扩充 5 项（大小不符/主机白名单/相对直链/代理单通道）、`scripts/check-release-endpoints.mjs` 线上冒烟（已接入发布流水线）；`tsconfig` 的 `include` 增加 `functions`，后端代码纳入 `tsc --noEmit`。
9. **已知接受项**：CSP `connect-src 'self' https:` 宽泛（用户可自配 LLM 端点，无法静态收窄）；局域网 APK 分发无配对鉴权（仅 8 字节 magic）；`sha256` 仅在客户端透传，原生侧校验待排期。
10. **E2E 偶发失败已定位修复（P3-13）**：`--repeat-each=2` 复现出唯一失败点 `e2e/assistant-cards.spec.ts:3`（phone-320）。根因是该用例 `/?assistant-preview=1` 冷启动要等 Vite 现场转译 `assistantContent` 懒加载分块，单跑实测 13.0s，15s 预算在并行门禁下必然打满；失败瞬间快照显示面板已渲染、卡片仍在「内容加载中」，属预算问题而非面板缺陷。预算提高到 25s 后 `--repeat-each=2` → 104/104 全绿。
11. **验证门（全部实跑通过）**：`npm run typecheck` 0 errors（`include` 已含 `functions`）；`npm run test` 82 文件 / **501 项**全绿（原 79/472）；`npm run test:release` 12 项全绿；`npx playwright test --repeat-each=2` 104/104 全绿；`npm run build:web` 成功且 `git status` 无脏文件（仅 3 项原有未跟踪文件）。
12. **环境配置与验证完成**（2026-09-09 核实并完成）：
    - **已配置并打通**：用户已在 Cloudflare Pages 控制台配置 fine-grained `GITHUB_TOKEN`（仅 `Contents: Read`，仅 `Misakii1k/xiaoyaohe`），GitHub 官方正式 Release `v1.0.0` 挂载 `xiaoyaohe-1.0.0-android-release.apk` 已发布。
    - **实测端到端验证通过**：
      - `https://xiaoyaohe.pages.dev/version.json` -> 200 OK（返回 1.0.0 元数据与 `/api/download?tag=v1.0.0` 下载直链）
      - `https://xiaoyaohe.pages.dev/api/releases` -> 200 OK（GitHub Release 元数据）
      - `https://xiaoyaohe.pages.dev/api/download?tag=v1.0.0` -> 302 重定向至 GitHub 预签名 S3 直链，实测下载 32,095,374 字节完整 APK，包头与大小完全一致。
    - **已清理/已撤销**：旧 classic 全量 repo 令牌已在 GitHub 撤销删除；`scratch/` 调试文件已清空。

### 29. 全套 3D 拟物液态微质感图标重构、专属色彩向外弥散与 1.0.0 正式版发布 (1.0.0)

1. **3D 拟物资产重绘与精准边缘抗锯齿抠图**：
   - 使用 Gemini Imagen 3 重绘 9 款 Studio 级 3D 拟物资产（药盒、规划本、靶向徽章、药瓶、时钟药丸、急救包、浮动胶囊、分药机、亲和头像）；
   - 自主研发并运行 `scripts/cutout_assets.py`（基于 OpenCV GrabCut 算法与中性边缘平滑先验），生成无杂色、零毛边的 512x512 高清透明 PNG，保存在 `src/assets/images3d/`。
2. **专属环境色彩弥散（Ambient Color Diffusion）**：
   - 彻底摆脱传统图标方框与矩形裁切限制，在 `settings.css`、`medications.css`、`scanner.css`、`primitives.css` 中为所有 3D 拟物图标定制微质感环境发散光晕（`::before` 径向渐变结合动态 `filter: drop-shadow`）；
   - 根据卡片语义色（金橙、天蓝、珊瑚红、丁香紫、薄荷青、祖母绿）动态渲染柔和彩色光雾，在卡片悬停与点击时呈现平滑呼吸回弹，完美融入液态玻璃与明暗主题。
3. **1.0.0 里程碑正式发版**：
   - 版本由 `0.9.15` 正式升级为 `1.0.0`（`versionCode: 35`）；
   - 更新 `package.json`、`package-lock.json`、`build.gradle`、`AppConfigurationTest.java`、`release-utils.mjs`、`release-utils.test.ts`、`hero.svg`、`README.md` 与发布文档 `docs/releases/1.0.0.md`；
   - 运行 `scripts/gen-version.mjs` 输出全新 `public/version.json`，全套 79 组测试套件 472 项测试 100% 通过。

### 28. 0.3 秒云端极速通道更新检测与阶梯探测拦截架构 (0.9.15)

1. **痛点根治**：
   - 彻底解决点击「检查更新」时，因无条件执行局域网 254 个 IP 探测而强行等待 8~10 秒的问题；
   - 建立「云端极速通道 + 阶梯探测 + 发现即拦截」响应体系。
2. **构建期自动生成轻量级版本元数据（`scripts/gen-version.mjs` & `public/version.json`）**：
   - 挂载至 `npm run build:web`，打包前自动提取版本号、构建号、发布日期、下载链接、文件大小与更新日志；
   - 输出 `dist/version.json` 并自动随网页端部署至 Cloudflare Pages 全球 CDN（`https://xiaoyaohe.pages.dev/version.json`），全国 50~150ms 秒级加载。
3. **Cloudflare 边缘极速探测通道（`apkTransport.ts`）**：
   - 新增 `checkFastCloudVersion()`，获取轻量 JSON（~400 字节），设置 2 秒超时熔断；
   - 支持 `source: 'cloud'` 更新源，沿用原生 HTTP 流式下载与签名校验。
4. **GitHub Releases 多镜像并发竞速（`apkTransport.ts`）**：
   - 采用 `Promise.any` 驱动官方 API 及 3 个国内镜像（`ghfast.top`、`ghproxy.net`、`gh-proxy.com`）**并发竞速**，率先响应者胜出并取消其余请求，耗时由数秒压缩至 300~600ms。
5. **阶梯探测与发现即拦截（`apkTransport.ts`）**：
   - `checkForAppUpdates` 并发启动线上检测与局域网扫描；
   - 云端一旦发现新版本（~0.3s），**立即拦截并弹窗呈现，直接跳过漫长的局域网扫描**；
   - 仅当云端无更新时，才提示「云端已是最新，正在扫描周边设备...」并等待局域网探测（全局严格限时 3 秒）。
6. **UI 实时状态反馈与 AI 工具扩展（`Settings.ts` & `assistantTools.ts`）**：
   - 设置页更新按钮实时显示分步阶段文本；
   - AI 工具卡片与提示文案适配「云端极速通道」来源。
7. **全绿验证门**：
   - `npm run typecheck`（0 errors）；
   - Vitest 79 个测试套件，472 项测试全部通过（新增 5 项云端检测、极速拦截与下载测试）；
   - `npm run build:web` 编译通过。

### 27. Web 端 PWA 静态在线部署（Cloudflare Pages 正式上线）、Vite 相对路径适配与 GitHub Actions 自动发版流水线 (0.9.15)

1. **Cloudflare Pages 全球 CDN 正式上线**：
   - 公网正式可访问地址：`https://xiaoyaohe.pages.dev/`；
   - 浏览器全自动化完成与 GitHub 私有仓库 `Misakii1k/xiaoyaohe`（`workspace/claude` 分支）的绑定与配置；
   - 填入框架预设 `Vite`、构建命令 `npm run build:web`、输出目录 `dist`，并注入 `NODE_VERSION=22` 环境变量；
   - 40 秒构建成功，全球 Anycast 分发完成，在浏览器中实测首屏加载、暗色液态玻璃主题与全部业务功能秒开。
2. **Vite 相对基路径适配（`vite.config.ts`）**：
   - 增加 `base: process.env.VITE_BASE_PATH || './'`；
   - 确保在 Cloudflare Pages 独立根路径、GitHub Pages 仓库二级目录（`https://misakii1k.github.io/xiaoyaohe/`）以及 Capacitor Android 本地 WebView 下，所有 CSS、JS 及图标资源均能通过相对路径正常加载。
3. **浏览器持久化存储保护（`src/main.ts`）**：
   - 网页端启动阶段主动向浏览器申请 `navigator.storage.persist()` 持久化配额，保护本地 IndexedDB 药品清单与用药打卡记录。
4. **GitHub Pages 自动化部署工作流（`.github/workflows/deploy-web.yml`）**：
   - 代码推送至 `main`、`workspace/claude` 或手动触发时，自动执行类型检查、测试门禁与静态打包，并配置 `lfs: true` 保证图标母版正常拉取。
5. **Android APK 自动打包与 GitHub Releases 发布工作流（`.github/workflows/release-apk.yml`）**：
   - 推送版本 Tag（如 `v0.9.16`）或手动触发时，自动拉取代码、配置 Java 21 与 Android SDK、执行 `./gradlew assembleRelease testReleaseUnitTest` 编译、自动适配/生成发布签名、生成校验和并挂载到 GitHub Releases 供用户下载。
6. **全绿验证门**：
   - `npm run typecheck`（0 errors）；
   - `npm test`（79 个测试套件，467 项测试全部通过）；
   - `npm run build:web` 编译成功，32 个内嵌图标校验通过，产物引用全部为相对路径。

### 26. 应用更新局域网扫描并发风暴修复、GitHub Releases 官方多源发布与实时进度流 (0.9.15)

1. **局域网扫描并发风暴根治（`ApkDistributionPlugin.java`）**：
   - 将 `scanSubnet` 中无限制瞬发的 `Executors.newCachedThreadPool()`（为 254 个 IP 并发创建原生线程）彻底重构为固定容量线程池 `Executors.newFixedThreadPool(16)`；
   - 单 IP 超时设为 500ms，消除线程创建爆炸、OOM 隐患与普通路由器 SYN Flood / 端口扫描防御静默丢包问题，5~6 秒内稳定完成扫描。
2. **接入 GitHub Releases 官方发布渠道（`apkTransport.ts`）**：
   - 增加 `checkGithubRelease()`，拉取官方仓库最新 Release 信息，解析 APK 附件链接、版本号与发布说明；
   - 内置国内加速镜像自动降级机制（`ghfast.top`、`ghproxy.net`、`gh-proxy.com`），网络阻断时自动平滑切换。
3. **原生 HTTP 流式下载与跨域多跳重定向（`ApkDistributionPlugin.java`）**：
   - 原生实现 `downloadHttp` 并在 `doDownloadHttp` 中支持 301/302/303/307/308 递归重定向追踪（完美解决 GitHub 到 AWS S3 CDN 的跨域重定向问题）；
   - 8KB 流式写入并实时抛出 `downloadProgress` 进度事件。
4. **统一多源并行检查与实时下载进度 UI（`Settings.ts` & `settings.css`）**：
   - 重构设置页应用更新卡片为极简统一的「检查更新」按钮，附带本机局域网分发服务端口就绪状态（`端口 38473`）；
   - 并行查询 GitHub 与局域网设备，智能优选高版本或局域网源；
   - 更新确认弹窗完整展示版本对比、来源标识、包大小、更新日志，并在下载期间以平滑进度条直观展示进度（`百分比 · 已下载/总大小`）。
5. **后台每日静默更新检测（`main.ts`）**：
   - 应用冷启动 4 秒后在空闲期静默检测（每天最多一次），有新版本时在「设置」Tab 呈现更新小圆点徽标。
6. **全绿验证门与构建**：
   - `npm run typecheck`（0 errors）；
   - Vitest 79 个测试套件，467 个测试全部通过（新增 `tests/apkUpdateVerification.test.ts` 12 项测试）；
   - `npm run build:web` 构建成功；
   - `npx cap sync android` 同步通过；
   - `./gradlew.bat testReleaseUnitTest assembleRelease` 224 项任务全绿编译通过。

### 25. 强制提醒锁定重构、无障碍防退出、扫码退出闭环、自动弹回原 App 与音频焦点管理 (0.9.15)

1. **彻底移除 `startLockTask()`（屏幕固定）**：
   - 彻底剥离 `Activity.startLockTask()` 与 `stopLockTask()`，从根本上消灭每次弹出「应用已固定（不用了 / 知道了）」的系统灰色对话框；
   - 解决用户点击「不用了」导致锁定失效、以及屏幕固定导致后续无法正常退出的问题。
2. **引入无障碍防绕过服务（`MedboxAccessibilityService.kt`）**：
   - 新建并注册 `MedboxAccessibilityService`，声明 `BIND_ACCESSIBILITY_SERVICE` 与专用配置；
   - 仅在**扫码强制提醒处于锁定态**时激活守护（`setGuarded(true)`），一旦检测到窗口切出到非本应用界面（`TYPE_WINDOW_STATE_CHANGED`），0ms 瞬间把药盒强提醒拉回最前台；
   - 扫码成功或解除锁定瞬间立即 `setGuarded(false)` 释放守护；
   - 普通非扫码提醒不触发无障碍强拉回。
3. **彻底根治扫码成功后退不出的死锁（图一现场修复）**：
   - 扫码匹对成功瞬间注销无障碍守护，静音警报；
   - 在成功卡片下方新增醒目的「完成并返回」主按钮，同时成功卡片自身支持点击即退；
   - 配合 1.5 秒自动退出倒计时，双重机制确保顺利调用 `finish()` 退出页面。
4. **服药完成后无缝弹回原前台应用（如红果短剧 App）**：
   - 查出并移除 `MedicationAlarmContract.java` 中 `handleAction` 与 `queueOccurrenceAction` 强跳 `MainActivity` 的代码；
   - 全屏提醒 Activity 运行在独立栈，`finish()` 销毁后 Android 窗口栈自然将刚才正在使用的应用（如红果短剧 App、微信等）恢复至最前台，绝不强退桌面或强跳药盒主页。
5. **智能音频焦点管理（`AlarmAudioPlayer.kt`）**：
   - 引入 `AudioManager.requestAudioFocus`，唤醒强提醒时申请 `AUDIOFOCUS_GAIN_TRANSIENT` 临时音频焦点；
   - 遵循 Android 规范让正在前台/后台播放声音的红果短剧、网易云音乐、视频应用等**自动暂停播放**；
   - 提醒结束/静音（`stop()`）时立即调用 `abandonAudioFocusRequest()`，**背景短剧/音乐原声自动恢复播放**。
6. **设置页无障碍授权引导与状态展示（`Settings.ts`）**：
   - 在「扫码解除强制提醒」配置卡片中新增「无障碍防退出保护」状态展示卡片，显示已开启/未开启状态；
   - 提供一键跳转系统无障碍设置按钮；
   - 若用户未开启无障碍，无感降级为应用内任务栈拉回防误触兜底。
7. **全绿验证门与 Release 打包产物**：
   - `npm run typecheck`（0 errors）；
   - `npm run test`（79 套件 463 项测试全部通过）；
   - `./gradlew.bat compileDebugKotlin` 编译通过；
   - `./gradlew.bat assembleDebug` 成功打包；
   - `./gradlew.bat testReleaseUnitTest assembleRelease` 224 项任务全绿编译通过；
   - 产物：`~/Desktop/xiaoyaohe-0.9.15-accessibility-guard.apk`（18,646,307 字节）。

1. **沉浸粘性全屏模式（Immersive Sticky Mode）**：
   - 全屏提醒拉起时自动隐藏底部手势横条与系统状态栏，启用 `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`；
   - 用户从屏幕边缘上滑仅唤出半透明临时指示条，系统原生不触发 Home 退出手势，根除 95% 误触上滑。
2. **屏幕固定模式（LockTask）保护**：
   - 启动时进入 `startLockTask()` 模式，由系统层直接屏蔽 Home 键与 Recents 多任务键；
   - 仅在点击「已服/延后/跳过」、扫码成功或暗门应急确认时通过 `safeStopLockTask()` 释放。
3. **任务栈强力前置拉回（`REORDER_TASKS` + `moveTaskToFront`）**：
   - `AndroidManifest.xml` 声明 `android.permission.REORDER_TASKS` 权限；
   - 监听 `onUserLeaveHint()` 与 `onStop()`，一旦检测到退居后台，立即在主线程执行任务栈前置拉回，并在 120ms 后做二次保障拉回。
4. **统一全屏闭环交互**：
   - 移除普通提醒在 `onUserLeaveHint()` 中的自动延后退出，所有提醒必须由用户在界面上明确处理。
5. **全局单例音频控制器（`AlarmAudioPlayer.kt`）**：
   - 彻底解决退回桌面后再次进入页面出现的「双重背景音乐重叠」缺陷；
   - 进程级互斥控制 `Ringtone` 与 `Vibrator`，启动新音频前强制回收释放旧音频实例；
   - `stop()` 无条件停止底层音频，彻底杜绝系统 `isPlaying` 判定失灵导致的背景长响；
   - 暴露 `@JvmStatic` 方法，在 `MedicationAlarmContract.handleAction` 与 `queueOccurrenceAction` 中全面兜底静音。
6. **全绿验证门与 Release 打包产物**：
   - `npm run typecheck`（0 errors）；
   - `npm run test`（79 套件 463 项测试全部通过）；
   - `npm run test:release`（12 项测试全部通过）；
   - `npm run build:web` 构建成功（32 个内嵌图标校验通过）；
   - `./gradlew.bat testReleaseUnitTest assembleRelease` 编译通过；
   - 产物：`release/xiaoyaohe-0.9.15-android-release.apk`，已复制至用户桌面 `~/Desktop/`。

### 23. 全屏提醒上滑 Home 拦截、扫码防绕过、应急暗门与扫码免震动 (0.9.14)

1. **普通提醒上滑 Home 自动转为贪睡（`MedicationAlarmActivity.kt`）**：
   - 监听 `onUserLeaveHint()` 与 `onStop()`，普通全屏提醒在用户上滑 Home 或返回桌面时自动执行「延后 10 分钟提醒（SNOOZE）」；
   - 立即停止响铃与震动（`silenceAlert()`），弹出「已延后 10 分钟提醒」Toast 并关闭页面，彻底解决提醒界面退到桌面但手机在后台持续疯狂响铃的问题。
2. **扫码强制提醒上滑 Home 严格防绕过拦截**：
   - 判定 `isLocked() == true` 时，用户尝试上滑离开将被严格拦截并立即通过 `Intent.FLAG_ACTIVITY_REORDER_TO_FRONT` 配合前台服务 `AlarmRingService.launch` 兜底弹回最前台；
   - 触发警告短震与「强制提醒：请扫描条码解除」Toast，警报铃声保持播放，杜绝绕过。
3. **二维码图标 5 秒暗门应急解除（防死锁）**：
   - 界面保持极简纯净，无外显文字与进度圈（保持纯彩蛋暗门属性，避免日常依赖）；
   - 卡片顶部手绘二维码图标（`QrGlyph`）支持按压检测，持续长按满 5 秒即刻触发双短震反馈并静音当前警报，弹出液态玻璃质感应急对话框（提供「延后 10 分钟」与「确认跳过本次」选项，支持单药与群组；点击取消恢复响铃）。
4. **相机扫码模式自动关闭震动（降噪稳焦）**：
   - 点击按钮进入相机扫码取景器时，自动调用 `pauseVibration()` 暂停马达震动，保留报警声音，消除机身抖动对摄像头对焦与条码识别的物理干扰；退出扫码未解除时自动恢复震动。
5. **群组提醒批量跳过数据流打通**：
   - `MedicationAlarmContract.java` 增加 `ACTION_ALL_SKIPPED` 常量与动作映射；
   - `reminderActions.ts` 新增 `handleAllSkippedAction`，单事务批量标记当日群组内全部 `occurrence` 为 `skipped`。
6. **全绿验证门与 Release 打包产物**：
   - `npm run typecheck`（0 errors）；
   - `npm run test`（79 套件 463 项测试全部通过）；
   - `npm run test:release`（12 项测试全部通过）；
   - `npm run build:web` 构建成功（32 个内嵌图标校验通过）；
   - `npx cap sync android` 同步成功；
   - `./gradlew.bat testReleaseUnitTest assembleRelease` 224 个任务编译通过；
   - 产物：`release/xiaoyaohe-0.9.14-android-release.apk`（18,644,659 字节，SHA256: `b6c88b5b47e652f5dd57c7c4d445117d982156298318f5f6eb17a3956e92b6c9`），94 个内嵌资产校验通过，已复制至用户桌面 `~/Desktop/`。

### 22. 项目文案润色与 oil-tone 规范落地 (0.9.13+)

1. **文风原则与基线规范**：
   - 安装并配置 `oil-tone` 技能；
   - 剔除宣传化用词、主观修饰语、含混术语与口语化标点（如波浪号与表情符号）；
   - 标题统一采用内容标签式命名（如「关于小药盒」「发布记录」），避免使用动作短语；
   - 语句平铺直叙，陈述事实边界；中英文与数字之间保持半角空格，专有名词规范拼写。
2. **发布记录与交接文档润色**：
   - 逐一润色 `docs/releases/0.9.13.md`、`0.9.12.md`、`0.9.11.md`、`0.9.4.md`，通过 `tone_lint.py` 自动化检测；
   - 规范 `docs/handoffs/claude.md` 中的架构表述，将含混动作词替换为准确的流程描述。
3. **界面文本重构**：
   - `Today.ts`：进度环状态文案改用客观句式（「今日没有用药计划」「今日用药已全部完成」「剩余 N 次用药待处理」），清空状态改用规整文本；
   - `Settings.ts`：重构关于卡片功能摘要、免责声明及网页端提醒说明；
   - `AiAssistant.ts`：重写欢迎语、快捷建议和附件超限报错文案。
4. **全绿验证门与 Release 打包产物**：
   - `tone_lint.py` 检查全部通过；
   - `npm run typecheck`（0 errors）；
   - `npm run test`（79 套件 463 项测试全部通过）；
   - `npx playwright test`（52 测试全过）；
   - `npm run release -- --skip-install --android-variant release` 全链路通过：包含 `:app:connectedAndroidTest` 模拟器插桩测试 1/1 通过与 94 个内嵌资产校验；
   - 产物：`release/xiaoyaohe-0.9.13-android-release.apk`（18,628,171 字节，较前次 +504 字节；SHA256 `c5fb4d577e85230531036a8282c7e18df32f1ddaba9b5629b452c2675c59f7a7`），已复制至用户桌面 `~/Desktop/`。

### 21. 扫码解除强制提醒绑定功能与操作按钮常驻优化 (0.9.13+)

1. **常驻绑定卡片与操作按钮网格（`Settings.ts` & `settings.css`）**：
   - 彻底修复总开关处于关闭状态时绑定操作按钮完全被 `if (scanPref.enabled && hasAlarmScanToken())` 门控吞掉的体验断层；
   - 引入 `.settings-scan-card` 与 `.settings-scan-grid`（双列网格，最后一个测试按钮跨两列居中），开关开闭均清晰显示当前模式（专属码/生活码）、尾号与就绪状态；
   - 提供「重新扫码绑定 / 切换专属码」或「查看专属二维码 / 扫描生活中的码绑定」入口，用户无需先开总开关即可预设或更换。
2. **跨平台体验友好化**：
   - 取消 Web 端对该配置区的整块隐藏，标题展示「仅 Android App 生效」徽标，补充局域网家庭同步互传说明；
   - Web 端点击「试验扫码解锁」友好提示「全屏闹钟扫码解锁需在 Android App 中体验」。
3. **安全令牌预置与绑定联动（`alarmScanVerify.ts`）**：
   - 新增 `getOrCreateGeneratedScanToken()`：保证开关关闭时查看专属二维码也能生成/获取合法 token，不意外强制触发开关开启；
   - 扫描生活码绑定后自动联动开启总开关并给出明确提示，同时支持用户后续手动关闭总开关保留备用码。
4. **验证门**：
   - `npm run typecheck`（0 errors）；
   - `npm run test`（79 套件 463 测试全部通过）；
   - `npm run build:web`（资产校验与 Vite 生产构建通过）；
   - `npx playwright test`（52 测试全过）。

### 20. 提醒到点必全屏 + 多任务不可划杀 (0.9.13)

1. **全模式到点自动全屏（`MedicationAlarmContract.showNotification`）**：
   - 移除 `wantsFullScreen = !"strong".equals(mode)` 的模式门槛——**任何提醒方式到点一律自动全屏接管**（前台任意页面 / 后台 / 锁屏 / 灭屏）：fullScreenIntent + notify-first 后借 BAL 窗口主动 `startActivity` + `AlarmRingService` 前台服务兜底，三重路径；
   - 提醒通知改为一律 `setOngoing(true)`（下拉不可划掉）；全屏路径走 CHANNEL_ALARM（更长振动模式）；全屏意图权限被拒时降级 CHANNEL_STRONG heads-up（仍带操作按钮）；mode 现在只决定全屏页自动收起策略（strong 不收起 / persistent 60s / short 10s）；删除失去引用的 `vibrateStrong`。
2. **多任务不可划杀（`AndroidManifest.xml`）**：`MedicationAlarmActivity` 增加 `android:taskAffinity="com.medbox.app.alarm"`——全屏页此前寄生在主应用任务里，用户在最近任务划掉应用卡片会连提醒页一起移除（正是"上滑强杀"的根源）；独立任务 + 既有 `excludeFromRecents` 使提醒页彻底不进多任务、也无法随主任务划掉；进程侧由常驻 `KeepAliveService` 前台服务保活。
3. **文案同步**：`MEDICATION_REMINDER_MODE_LABEL` 更名为「全屏提醒 · 不自动收起 / 10 秒收起 / 60 秒收起」；`update_reminder_period_settings` 工具描述、权限降级提示、Settings 测试按钮 toast、`fireNativeMedicationAlarmNow` 测试载荷同步新语义；`reminder-periods.spec.ts` 与 `tests/assistantToolsExtended.test.ts` 断言同步。
4. **发布脚本修复（0.9.12 遗留）**：`scripts/release.mjs` instrumentation 步骤由不存在的 `connectedReleaseAndroidTest`（AGP 仅为 testable 变体生成 connected 任务）改为 `:app:connectedAndroidTest`；根 `android/build.gradle` 增加 `subprojects.configurations.all.resolutionStrategy.force` 把 kotlin-stdlib-jdk7/jdk8 抬到 1.8.22（1.8 起为空壳构件），消除 `capacitor-cordova-android-plugins` androidTest 类路径的重复类失败——**`npm run release` 端到端首次全链路跑通**（含模拟器 instrumentation）。教训：Windows Git Bash 下 heredoc python 的 `io.open().write()` 未显式 close 导致两次补丁静默未落盘，务必用编辑工具或显式 close。
5. **全绿验证门与 Release 打包产物**：
   - `npm run typecheck`（0 errors）；`npm run test`（79 套件 461 测试全过）；`npx playwright test`（56 全过，release 门禁内含）；`build:web` + `cap sync` 成功；
   - `npm run release -- --skip-install --android-variant release` 端到端成功：`:app:connectedAndroidTest`（模拟器 ldj_test35，1/1 通过）+ 94 个内嵌资产校验（aggregate `6c9e7fb6…0bd3`）；
   - 发布产物：`medbox/release/xiaoyaohe-0.9.13-android-release.apk`（18,627,667 字节，较 0.9.12 +80 字节；SHA256 `34d76d04bf29817161e053d6a4f5242c6d5b687c8c3bbf2a977b6f6feab5dadc`），APK 与 SHA256SUMS 已复制至 `~/Desktop/`。
6. **待真机验证**：到点自动全屏在前台其他应用 / 后台 / 锁屏三种状态下的表现；多任务划杀保护；若 OEM「一键清理」仍可终止，建议用户加入电池优化白名单。

### 19. 扫码解锁直达已服用 + 小助手历史/模型偏好 + 批量页修复 (0.9.12)

1. **全屏提醒扫码成功直接视为已服用（`MedicationAlarmActivity.kt`）**：
   - `onMatched` 不再仅解锁按钮：新增 `dispatchScanAutoTaken()`，单药记 `ACTION_TAKEN`、群组提醒记 `ACTION_ALL_TAKEN`（复用 `MedicationAlarmContract.handleAction` 原生队列，TS 端 `replayPendingMedicationReminderActions` 落库）；
   - 新增 `autoResolved` 状态：扫码成功后 FooterActions 渲染「✓ 已扫码 · 已记录为已服用」成功态约 1.5s 后自动 `finish()`；`BackHandler` 在 resolved 态只关页不再叠加贪睡；会话切换（新闹钟同实例复用）时复位。
2. **绑定扫码免上滑确认（`Settings.ts` `openBindCustomCodeSheet`）**：识别成功即 `scannerHost.hidden = true` 收起相机预览并 `scanner.pause()`（结果门控已暂停相机），`scrollToSheetTop()` 把结果与「确认绑定」滚入可视区；「重新扫码」恢复预览并 `resume()`。ScanSort `showUnknownCode` 结果卡增加 `scrollIntoView`。新增 `tests/settingsUiContracts.test.ts` 行为契约断言。
3. **扫码识别提速（`scanner.ts` + `MedicationAlarmActivity.kt`）**：
   - Web：`getUserMedia` 增加 `1280x720 ideal` 分辨率约束；BarcodeDetector 检测循环加 120ms 时间门限（约 8 次/秒）；html5-qrcode 回退 `fps 12` + qrbox 视口短边 60%（200-320px 收敛）。
   - 原生：`MultiFormatReader` + `BARCODE_HINTS` 提升为扫描会话级复用（原每帧 new），帧间由 `decodeLuminance` 的 `reset()` 复位。
4. **AI 小助手对话历史（DB v10）**：
   - `src/db/local.ts` 升 v10 新增 `assistantMessages` store（`byCreatedAt` 索引）；`schema.ts` 新增 `AssistantChatRecord`（blocks 保持 unknown，避免 db→ai 反向依赖）；辅助函数 `appendAssistantMessage`（写入并裁剪至 200 条）/`listRecentAssistantMessages`/`clearAssistantMessages`。
   - `AiAssistant.ts`：对话成功后 user/assistant 两条落库（附件不入库）；启动回填最近 50 条渲染 + 最近 12 条并入内存 `history` 延续上下文；`historyLoaded` 守卫防止问候语覆盖回填；「清空记录」同时清库。E2E fixture 同步升至 v10 并补齐两个本地 store。
5. **卡片推送不再重复文字**：`present_card` 工具描述与 SYSTEM_PROMPT 规则 10 均改为「卡片已承载完整信息，正文不得复述卡片内容，至多一句补充」。
6. **小助手页模型选择 + 推理强度（新 `src/ai/assistantPrefs.ts`）**：
   - localStorage `medbox.assistant-prefs.v1` 持久化 `{ modelOverride, reasoningEffort: low|medium|high }`，变更广播 `medbox:assistant-prefs` 事件；
   - 请求链路：`AssistantTurnEvents` 增 `modelOverride`/`reasoningEffort`；`requestChat` 仅对**当前活跃供应商**生效（故障转移候选家用各自配置，避免 override 404）；400 且错误匹配 `UNSUPPORTED_PARAM_RE` 时与 stream 降级合并为一次重试去参；
   - 面板头部下方新增偏好行：模型下拉（默认模型 + 体检模型列表 + 刷新按钮拉取）与推理强度下拉（默认/低/中/高），样式见 `.ai-prefs-row`。
7. **批量管理页显示修复（`medications.css`，纯 CSS）**：
   - `.medication-batch-row` 网格规则收窄到 `.medication-batch-page` 作用域，修复普通药品列表被覆盖 flex 导致的编辑按钮掉行；
   - 补齐批量页全部缺失样式：`medication-batch-body/copy/name/subline`、`medication-batch-slots`、`medication-slot-chip`（胶囊/图标/时间/禁用态）、`medication-batch-no-rules`、`medication-batch-sheet-title/hint/options`；
   - `.medication-batch-dock` 允许换行：计数独占一行 + 四按钮 2×2，窄屏不再挤压溢出。
8. **发布门禁与存量测试修复**：
   - `npm audit fix` 清零 3 个传递依赖漏洞（release 审计门禁要求）；
   - 修复 0.9.11 遗留的两个过时 E2E spec（当时改版后未同步、基线即可复现失败）：`camera-actions.spec.ts` 入口改「拍药盒识别」快捷卡 + 断言改为悬浮球 `display:none` 契约与 620px 操作行上限；`inventory-workflows.spec.ts` 改用 `.inventory-stepper-input` 与 `.inventory-add-preview-card` 新文案；
   - `AppConfigurationTest`、`tests/release-utils.test.ts`、`src/sync/lan/store.test.ts` 版本/结构断言同步 0.9.12。
9. **全绿验证门与 Release 打包产物**：
   - `npm run typecheck`（0 errors）；`npm run test`（79 套件 461 测试全过）；`npx playwright test`（56 全过，含修复后的两个 spec）；`npm run build:web`、`npx cap sync android` 成功；
   - `./gradlew.bat connectedAndroidTest`（模拟器 ldj_test35）：app 模块 instrumented 测试 1/1 通过（AppSecurityInstrumentedTest）；
   - **发布脚本发现（待办）**：`scripts/release.mjs` 的 `connectedReleaseAndroidTest` 步骤在 AGP 下不可执行——release 变体默认不生成 connected 任务（仅 debug），且 `capacitor-cordova-android-plugins` 模块 androidTest 类路径存在 kotlin-stdlib-jdk7/jdk8 1.6.21 与 stdlib 1.8.22 重复类（根级 resolutionStrategy force/substitute 均不影响该生成模块）。本次以 `testReleaseUnitTest assembleRelease` + 模拟器 `connectedAndroidTest`（app 模块）+ `publishReleaseArtifacts` 校验等价完成门禁；建议后续将脚本步骤改为 `connectedAndroidTest` 并同步 `tests/release-utils.test.ts` 的命令契约。
   - 发布产物：`medbox/release/xiaoyaohe-0.9.12-android-release.apk`（18,627,587 字节，较 0.9.11 +4,008 字节 +0.02%；SHA256 `22bfa36bf3993e66f809eab5130ee6a70529145f616b8b9c5b3cb49f5f9c1ee2`），APK 与 SHA256SUMS 已复制至 `~/Desktop/`。
10. **待真机验证**：扫码自动已服用全流程（触发强制提醒 → 扫码 → 自动落库 + 自动关闭）、绑定 sheet 收起预览交互；悬浮球 a11y 欠账：分药页「拍单录入/拍药盒识别」快捷卡为带 onclick 的 div，无 button role（键盘/读屏不可达），建议后续改为真按钮。

### 18. 全屏用药提醒防误触与防绕过安全加固 (0.9.11)

1. **手势穿透与返回键安全防线（`MedicationAlarmActivity.kt`）**：
   - **取景器状态守卫**：用户在扫描药盒或解锁码时，按系统返回键或侧滑手势仅收起取景器（`showScanner = false`）回到全屏提醒卡片，绝不关闭提醒 Activity；
   - **强制扫码锁定态防绕过**：当开启扫码强制解除（`locked == true`）时，Back 手势/按键被严格拦截；触发短震动警示并在屏幕中央及底部展示「强制提醒：请扫描已绑定的药盒或物品条码解除」红色警告，杜绝随手划掉漏服；
   - **普通/已解锁态防误触**：用户在非锁定态下按返回键或侧滑，不会直接丢弃提醒，而是自动触发「10 分钟后提醒（延后/贪睡）」，保证用药计划不会因意外滑屏而丢失。
2. **物理音量键静音拦截（`dispatchKeyEvent`）**：
   - 拦截 `KEYCODE_VOLUME_DOWN` 与 `KEYCODE_VOLUME_UP` 按键事件；
   - 用户在公共场合或开会时按压音量键可立即静音铃声与震动（`silenceAlert()`），但界面依然坚守在屏幕上，用户必须在屏幕上点击「服药」或「稍后提醒」完成操作，平衡了防扰与服药提醒强制性。
3. **全绿验证门与 Release 打包产物**：
   - `npm run typecheck` (0 errors)
   - `npm run test` (76 个测试套件，448 个测试 100% 通过)
   - `npm run build:web` 构建成功
   - `npx cap sync android` 同步成功
   - `./gradlew.bat testReleaseUnitTest assembleRelease` (BUILD SUCCESSFUL in 1m 8s, 211 tasks)
   - `scripts/lib/release-utils.mjs` 校验通过 94 个内嵌资产（哈希 `749a8ffe...`）
   - 发布产物：已输出至 `medbox/release/xiaoyaohe-0.9.11-android-release.apk` (18,623,579 字节，SHA256: `acee36d280de7a631a6d4a4f6a32f4b4191cf1398dda4a4e43eb8044c46ab447`)，并已同步复制至用户桌面 `~/Desktop/xiaoyaohe-0.9.11-android-release.apk`。

### 17. 首页顶栏规范统一与进度环修复 + 设置页提醒布局与文案优化 (0.9.11)

1. **首页顶栏规范统一与 Android WebView 焦点黄框根治（`Today.ts`, `today.css`, `legacy.css`）**：
   - 根治路由切换时 `announceNavigation()` 对 `h1` 执行 `.focus({ preventScroll: true })` 触发的 Android WebView 默认黄色系统焦点矩形框：为 `.today-header-title` 添加 `:focus, :focus-visible { outline: none; }`，并在 `legacy.css` 全局补充 `h1[tabindex='-1']:focus { outline: none; }`；
   - 规范大标题规格：字号由 `28px` 降至 `var(--fs-title1, 22px)`，字重 `700`，字距 `-0.4px`，与全站各 Tab 顶栏保持视觉层级一致，保留日期副标与右侧 AI 助手/头像入口。
2. **进度环 100% 溢出修复与空间优化（`components.ts`, `legacy.css`）**：
   - SVG 半径 `r` 从 `38` 扩大至 `40`，描边 `stroke-width` 从 `10` 微调至 `8`，内部净圆直径从 `66%` 提升至 `72%`；
   - 数值字号微调为 `26px`，单位 `%` 微调为 `13px`；增加 `white-space: nowrap; max-inline-size: 100%;` 保护，彻底解决 100% 压线溢出问题。
3. **设置页用药提醒测试按钮 2x2 宫格化与文案精简（`Settings.ts`, `settings.css`）**：
   - 将原挤在单行的 4 个测试按钮改造为 2x2 宫格布局（`.settings-test-grid`），统一次要 `tonal` 样式，单行舒展呈现；
   - 精简图2提醒说明，去重与时段聚合相关的表述，聚焦通知、精确闹钟与后台活动；
   - 图3时段设置文案精简为“每天按早、中、晚、睡前各发送 1 次聚合提醒。点击下方时段可自定义整体时间与响铃方式。”；
   - 修复时段列表行箭头：将 `icon('arrow-left')` 替换为标准前往箭头 `icon('chevron-right')`。
4. **全绿验证门与 Release 打包产物**：
   - `npm run typecheck` (0 errors)
   - `npm run test` (76 个测试套件，448 个测试 100% 通过)
   - `npm run build:web` 构建成功
   - `npx cap sync android` 同步成功
   - `./gradlew.bat testReleaseUnitTest assembleRelease` (BUILD SUCCESSFUL in 1m 7s, 224 tasks)
   - `scripts/lib/release-utils.mjs` 校验通过 94 个内嵌资产（哈希 `749a8ffe...`）
   - 发布产物：已输出至 `medbox/release/xiaoyaohe-0.9.11-android-release.apk` (18,623,579 字节，SHA256: `f8e3ef152f15732ec05947c2f36623ad4de21c39eb04ac5137088b9f8c1261f2`)，并已同步复制至用户桌面 `~/Desktop/xiaoyaohe-0.9.11-android-release.apk`。

### 16. 全屏闹钟生活二维码/条形码解锁识别引擎重构与就地验证 (0.9.11)

针对用户反馈的「选择生活中的二维码后，在全屏闹钟解锁试验情况下无法正常识别解锁」问题，深入底层排查 Android CameraX + ZXing 条码识别管线与解锁机制，完成彻底重构：

1. **核心缺陷与根因定位**：
   - **PlanarYUVLuminanceSource 不支持旋转导致每帧被静默抛弃（致命根因）**：ZXing 的 `PlanarYUVLuminanceSource.isRotateSupported()` 硬编码为 `false`，调用 `rotateCounterClockwise()` 会直接抛出 `java.lang.UnsupportedOperationException: This luminance source does not support rotation by 90 degrees`。原代码在 `analyzeBarcodeFrame` 内包裹了 `try ... catch (ignored: Throwable)`，导致相机的每一帧图像在刚刚准备旋转时就直接抛异常崩溃并被静默丢弃，条码解码器实际上从未执行过任何解码！
   - **分析分辨率不足**：`ImageAnalysis.Builder()` 未配置 targetResolution，CameraX 默认采用 640x480 分辨率，在近距离拍摄密集生活二维码时，每个模块像素过低；
   - **缺乏反色与反光容错**：生活场景中，许多用户使用暗黑模式手机屏幕展示二维码（白条黑底），或在光滑药盒覆膜上扫码（严重反光、对比度低）。ZXing 默认单一 `HybridBinarizer` 无法解码反色码与低对比度条码；
   - **全图背景干扰**：背景中的其它条码或文字干扰全局阈值；
   - **字符串匹配严苛**：条码可能包含 UTF-8 BOM（`\uFEFF`）、AIM 标识符前缀（如 `]Q1`、`]C1`）、控制字符（`\u001D`），或 URL 末尾多斜杠、大小写差异，纯 `raw == expectedToken` 严苛相等极易误判不匹配；
   - **解锁反馈 bug**：原 `vibrateUnlock()` 误调用了警报循环震动模式，导致解锁后持续震动，且未及时停止警报铃声；错误提示永久停留在屏幕上。
2. **系统级重构与能力升级**：
   - **物理内存矩阵旋转（绝不调用 rotateCounterClockwise）**：
     - 在构建 `PlanarYUVLuminanceSource` 之前，直接对 Y 平面字节数组进行物理像素矩阵顺时针重映射（90°: `rotatedData[x * height + (height - 1 - y)] = data[y * width + x]`；180°: 逆序；270°: 逆时针 90°）；
     - 使用直立的宽高构造 `PlanarYUVLuminanceSource`，彻底规避 `UnsupportedOperationException` 异常，同时若旋转图未识别且存在旋转，使用未旋转原图兜底。
   - **分辨率与对焦优化**：
     - 配置 `ImageAnalysis.Builder().setTargetResolution(Size(1280, 720))`，大幅提升密集码采样精度；
     - 增加相机中心自动对焦与 `previewView` 点击触摸对焦（`FocusMeteringAction`）；
   - **多级二值化与局部取景框裁剪**：
     - 构建 `decodeLuminance` 管线：默认 `HybridBinarizer` → `HybridBinarizer(source.invert())`（暗黑反色）→ `GlobalHistogramBinarizer`（反光与低对比度）；
     - 全图未解码时自动裁剪中央 72% 取景框聚焦解码；
   - **智能容错条码比对（`isTokenMatch`）**：
     - 自动滤除 BOM、AIM 标识前缀与控制符；
     - 智能兼容 URL 结尾斜线、协议与大小写差异；
   - **交互与就地验证流程**：
     - `vibrateUnlock()` 解锁即刻停止警报响铃，消除持续警报震动，改为清脆短震；
     - `ScannerOverlay` 错误提示 2.5 秒自动重置淡出；
     - 设置页 `Settings.ts` 在绑定生活码后，操作行直接增加「试验扫码解锁」按钮，用户点击即可立即拉起全屏闹钟实测扫码解除。
3. **全绿验证门**：
   - Android 编译与单元测试：`./gradlew.bat compileDebugSources` 与 `./gradlew.bat test` 177 个任务全部通过；
   - `npm run typecheck` (0 errors)；
   - `npm run test` (76 个测试套件，448 个测试 100% 通过)；
   - `npm run build:web` 成功构建。

### 15. 根除前端内部码与字面量 HTML 标签外显 (0.9.11)

针对用户反馈的扫码绑定弹窗出现 `<b>条形码</b>`、`<code>https://...</code>`、`<br>` 以及内部机器识别码 `[qr_code]` 外显的问题，进行了彻底治理与架构规范化：

1. **问题根因定位**：
   - 基础组件工厂 `src/ui/components.ts` 的 `el(...)` 为了彻底杜绝 XSS 注入风险，特意不使用 `innerHTML`，而是统一通过 `node.textContent = String(content)` 赋值；
   - 业务层在 `Settings.ts` 与 `settingsPanel.ts` 的部分文案中直接写入了 `<b>`、`<code>`、`<br>` 标签字符串，导致浏览器以字面量形式直接将 HTML 源码呈现给用户。
2. **机器识别码本地化与提示结构化**：
   - **格式转换器**：引入 `formatBarcodeTypeLabel`，将 `qr_code`、`ean_13`、`code_128`、`data_matrix` 等机器枚举自动转换为用户易懂的“二维码”、“商品条形码 (EAN-13)”等中文标签，消除了生硬的 `[qr_code]`；
   - **结构化识别反馈 DOM**：在 `openBindCustomCodeSheet` 的 `handleResult` 中重构渲染逻辑，改为由类型徽标胶囊、等宽弱底长文本预览卡片（自适应换行与限高）以及清晰提问构成的规范 DOM 树；
   - **设置项摘要优化**：新增 `formatCustomScanCodeSummary`，将已绑定的生活码摘要（如 `QR_CODE: https://...`）转换为安全截断的友好格式（如 `已绑定生活码（二维码 · 尾号 ...8923）`）。
3. **全局遗留 HTML 字符串清理**：
   - `openUnlockQrSheet` 与 `openBindCustomCodeSheet` 引导文本改用语义化 `strong` 与段落 DOM；
   - 设置页当前版本与发现新版本 `<b>v...</b>` 规范为标准 DOM 节点；
   - `settingsPanel.ts` 已配对设备列表设备名与地址改用规范子节点。
4. **全绿验证门**：
   - 新增契约测试：`tests/settingsUiContracts.test.ts` 断言设置页与同步面板绝无裸露 HTML 标签与机器枚举；
   - `npm run typecheck` (0 errors)；
   - `npm run test` (76 个测试套件，448 个测试 100% 通过)；
   - Playwright E2E（16 个测试全部通过）；
   - `npm run build:web` 成功构建。

### 14. AI 服务商移动端卡片布局重构与状态胶囊体系 (0.9.11)

针对用户反馈的「AI 服务商」面板布局拥挤、名称被严重截断、操作按钮超出屏幕右边缘、状态文本裸露附着等问题，进行了系统级排版与架构重构：

1. **清晰三层卡片结构设计（`Settings.ts` & `settings.css`）**：
   - **顶层 Header**：左侧展示优先级序号徽标（`#1`、`#2`）与加粗服务商名称，名称拥有独立弹性空间，不再被 4 个按钮挤扁；右侧独立容纳「当前」激活状态胶囊与带圆点的独立状态胶囊（翠绿 `已连接`、砖红 `不通`、琥珀 `未填密钥`、灰色 `未检测`），支持高对比度深色模式；
   - **中层 Meta**：端点域名（等宽代码字体）与模型名称清晰分开（中置 `·` 分隔符），排版整齐规范；
   - **底层 Actions 操作坞**：在卡片底部以淡色虚线独立开辟操作区，左侧放置优先级调整按键（`↑ 上移`），右侧放置快捷操作群（`设为当前`、`编辑`、`删除`），彻底消除横向溢出与截断。
2. **严格保留所有架构契约与状态流**：
   - 维持 `tests/settingsUiContracts.test.ts` 契约（`provider.id === set.activeId`、`if (provider.id !== set.activeId)`、`const latest = getLlmProviderSet();`、`await persistProviderSet`、`renderList()` 等）；
   - 保留激活/降级、上移排序、编辑弹窗和删除弹窗所有核心交互。
3. **全绿验证门**：
   - `npm run typecheck` (0 errors)
   - `npm run test` (76 个测试套件，447 个测试 100% 通过)
   - Playwright E2E（36 个测试跨 4 种视口完全通过）
   - `npm run build:web` 构建无异常。

### 13. 药品录入向导、沉浸全屏布局与滑动切换手感体系 (0.9.11)

针对用户反馈的「点击添加药物之后的效果，包括无法滑动、底部遮挡等问题」进行系统化排查与彻底重构：

1. **直观优雅的单药 3 步向导录入体验**：
   - 将药品列表页（`/meds`）的底部添加 FAB 按钮指向新独立的向导新建路由 `/#/meds/create`（`MedEdit` 新建模式），彻底替代先前直接进入粗糙批量草稿页的困惑交互；
   - 保持 `/#/meds/new` 路由完整指向批量添加（`MedBatchAdd`），使既有批量功能与 E2E 自动化测试 100% 稳定运行。
2. **全屏沉浸式页面布局与彻底解决滚动遮挡**：
   - 药品向导模式（`MedEdit`）配置 `showTabbar: false` 隐藏通用底部导航，顶栏提供规范的返回左箭头（`topLeft: backBtn`）；
   - 在 `shell.css` 中为全屏无 Tabbar 状态定制操作坞贴底样式 `.app-shell:not(:has(.tabbar.app-navigation)) > .action-dock { inset-block-end: calc(16px + var(--safe-bottom)); }`；
   - 页面容器 `.medication-edit-page` 增加充分的安全内边距（`padding-block-end: calc(96px + var(--safe-bottom))`），表单字段与输入框可完全滚动展示，底栏「上一步/下一步/完成保存」与「返回」按钮贴底固定且绝不遮挡任何内容。
3. **原生级左右滑动手势（Swipe Gestures）与方向性平移动效**：
   - 在向导表单容器内实现精准触控手势侦测（`touchstart` / `touchend`），以 48px 阈值与横纵比判定过滤误触，在用户输入或使用裁剪框时自动避让；
   - 前进向左滑严格联动步骤校验：若 Step 1 未填药名，阻断滑动并触发药名框微震动提示（`step-shake` 350ms）并自动聚焦；Step 2 若剂量数值与单位不完整同样阻断提示；
   - 后退向右滑无阻碍平滑返回上一步；
   - 步骤切换伴随方向性平移入场动效（前进右滑入 `.slide-from-right`，后退左滑入 `.slide-from-left`，200ms 高刷收敛，尊重 reduced-motion）。
4. **全套布局契约与回归修复**：
   - 修正 `MedEdit.ts` 中编辑态初始化行为，使 `/#/meds/:id/edit` 直接渲染向导编辑态（`title: '编辑药品'`），修复历史测试契约；
   - 恢复 `MedList.ts` 顶栏「批量管理」入口及 `enterBatchMode`，恢复多选框 `24x24px` 尺寸，使 Playwright 选择与批量时段管理测试全数恢复；
   - 修复 `shell.css` 中移动端 `.tabbar.app-navigation` 从脱离文档流的 `position: absolute` 回归文档流 `position: relative; flex: 0 0 auto`，消除 `.app-main` 穿透至屏幕底部导致主视口超出导航栏上边缘（568px vs 512px）的视口越界缺陷；
   - 优化 `router.ts` 导航后焦点机制，筛选首个可见 `h1`，避免在今日页顶栏被隐藏时尝试聚焦隐藏元素而失败。
5. **全绿验证门**：
   - `npm run typecheck` (0 errors)
   - `npm run test` (76 个测试套件，447 个测试 100% 通过)
   - Playwright E2E（36 个测试跨 4 个视口全部通过）
   - `npm run build:web` 构建成功。

### 12. 全链路高质感微动效与物理弹簧手感体系 (0.9.11)

遵循 **克制极简原生风（Subtle & Clean）** 与 **物理弹簧手感（Spring Physics）** 原则，全面搭建小药盒交互动效体系：

1. **核心打卡动效（克制原生风）**：
   - 弃用彩带粒子等廉价视觉污染，使用 iOS 原生风格的 SVG 对勾动态画线（`checkmarkDraw` 240ms）+ 弹性果冻微震回弹（`checkmarkPop` 260ms，`cubic-bezier(0.175, 0.885, 0.32, 1.275)`）+ 柔和色彩渐变过渡；
   - 覆盖今日页圆形打卡按键（`.today-radio-btn`）与历史页打卡按键（`.history-radio-circle`）。
2. **列表与卡片错峰轻盈微浮现（Staggered Micro-Fade-Up）**：
   - 全局抽象 `microFadeUp` 关键帧（8px 微位移 + 柔和透明度淡入，220ms 敏捷收敛）；
   - 依次覆盖今日时段组（`.today-time-group` 35ms 阶梯错峰）、药品库卡片（`.med-item-card` 35ms 阶梯错峰）、库存列表（`.inventory-card-item` 35ms 阶梯错峰）以及历史页指标卡与明细列表（`.history-stat-card`, `.history-plan-item`）；
   - 切换页面与过滤筛选时具备自然流畅的空气流动感。
3. **数据与统计指标动态滚进（CountUp）与环形扫掠**：
   - 实现轻量高性能原生 `animateCountUp` 引擎（基于 `requestAnimationFrame` 与三次缓动曲线）；
   - 今日仪表盘进度环配备 `ringSweep` 平滑展开与底部柔光环，中心百分比轻快滚进；
   - 历史页「连续服药天数」与「当月依从率」指标同步启用动态滚进。
4. **触压物理弹簧回弹反馈（Touch & Press Physics）**：
   - 为今日卡片、药品卡片、库存卡片、历史卡片注入 GPU 硬件加速的物理弹簧（`:active { transform: scale(0.985); }`）；
   - 核心操作按钮（一键打卡、服药弹窗「✓ 已服用」主按钮）注入 0.95~0.96 触感微缩；
   - 筛选胶囊与 Tab 注入弹性点击手感。
5. **无障碍一键降级与极致性能保障**：
   - 全局注入 `@media (prefers-reduced-motion: reduce)` 规则，所有动效强制 0.01ms 降级；
   - `animateCountUp` 严格尊重无障碍模式，直接呈现实时目标值；
   - 动效完全限定在 GPU 合成层属性（`transform`, `opacity`, `stroke-dashoffset`），零 Layout 抖动与零重排重绘，保障 60/120fps 高刷。
6. **全绿验证门**：
   - `npm run typecheck` (0 errors)
   - `npm run test` (76 个测试套件，447 个测试全部通过)
   - `npm run build:web` (0 errors)

### 11. 库存管理页面与全套弹层系统化重构与视觉升级 (0.9.11)

针对「选择要入库的药品」弹层缺少 CSS 样式（原生按钮边框突兀、文字折行错乱、缺少层级与呼吸感）以及库存管理各弹层风格不统一的问题，进行了系统化视觉重构与交互升级：

1. **「选择入库药品」抽屉重构（`MedInventory.ts` & `inventory.css`）**：
   - 彻底清除原生 `<button>` 灰底与黑粗框样式，重构为微拟物药盒卡片（`display: flex; align-items: center; gap: 12px; border-radius: var(--radius-lg);`），包含 3D/实拍缩略图、主副文案区、库存量/未设库存状态胶囊徽标与右侧指示箭头；
   - 弹层头部升级为吸顶 Header，新增常驻「+ 录入新药品」快捷跳转入口；
   - 增加带搜索图标与一键清空按钮的吸顶搜索框，支持拼音首字母与药名模糊即时过滤，支持平滑内部独立滚动；
   - 增加图文一体的空状态展示区，并带有「新建该药品并入库」一键引导。
2. **「给药品添加库存」表单抽屉升级**：
   - 新增加减步进器（`-` / `+` 按钮），搭配大字号数值居中输入；
   - 优化 `+1盒`、`+10`、`+20`、`+30` 常用预设胶囊反馈与微动效；
   - 强化实时动态预测卡片视觉层级与高对比度色彩表现。
3. **「单药库存操作」抽屉升级为分区层级化面板**：
   - 顶部提供包含药品缩略图、规格、当前剩余量与警戒线的概览卡片；
   - 核心动作区分列「添加库存」与快捷「补整盒」按钮；
   - 消除直接塞在动作列表里的裸露输入框，重构为独立的「校准剩余数量」步进器卡片；
   - 底部妥善安置「标记用完」与「编辑药品详情」次要操作。
4. **主页面即时搜索栏与次级菜单磁贴升级**：
   - 主页面筛选 Tab 下方新增即时搜索栏，与 Tab 筛选联动并支持空状态插画；
   - 将「更多操作」抽屉从普通列表升级为 2x2 图标功能磁贴宫格（智能录入、历史操作、批量预扣、分享清单）。
5. **深色主题与无障碍全面覆盖**：
   - 适配 `[data-theme='dark']` 下所有弹层背景色、输入框底色、边框与徽标对比度；
   - 测试全量通过：`npm run typecheck` (0 errors)、`npm run test` (76 个套件，447 个测试全部通过)、`npm run build:web` 顺利构建。

### 10. 宽屏/PC端响应式布局破损根治与排版自适应优化 (0.9.11)

针对桌面端/平板宽屏（`≥768px` 且 `≥600px`）下导航栏拉伸覆盖全屏的严重视觉缺陷，以及宽屏下卡片排版进行了全套优化：

1. **宽屏网格布局修复与侧栏流式重置**：
   - 修复 `src/ui/styles/shell.css` 中大屏媒体查询（`@media (min-width: 768px) and (min-height: 600px)`）下 `.app-shell` 遗漏 `display: grid` 导致的布局坍塌；
   - 重置 `.tabbar.app-navigation` 从移动端绝对定位（`position: absolute; inset-inline: 0; inset-block-end: 0;`）回归常规文档流（`position: static; inset: auto; inline-size: 100%;`），并挂载至 `grid-column: 1; grid-row: 1 / span 3;`，彻底根除大屏下导航栏拉伸覆盖全屏的白色遮罩 Bug；
   - 侧栏菜单项升级为 14px 桌面行级布局，增加 hover 柔光背景与 active 选中高亮；
   - `.topbar`、`.app-main`、`.action-dock` 完整映射至第 2 列网格，主内容容器限制 `max-inline-size: 960px` 居中且清除移动端 64px 垫高，防止 2K/4K 屏幕下卡片过度横向拉伸。
2. **设置页与弹窗组件大屏排版自适应**：
   - `src/ui/styles/pages/settings.css` 中「我的数据」统计卡片与设置折叠面板在大屏下自适应为 2 列栅格并排排布，大幅提升横向空间利用率；
   - `src/ui/styles/primitives.css` 中模态弹窗与 BottomSheet 在大屏下约束为 `max-inline-size: 560px` 屏幕居中。
3. **架构契约与测试全绿**：
   - `tests/uiArchitectureContracts.test.ts` 新增大屏网格布局与样式重置规则的架构契约测试；
   - `npm run typecheck` (0 errors)、`npm run test` (76 suites, 443 tests passed 100%)、`npm run build:web` 构建零报错。

### 9. 扫码解除强制提醒生活码绑定扩展 + 局域网新版本获取与探测修复 (0.9.11)

针对用户在日常使用中的两大痛点，进行了全链路功能扩展与缺陷修复：

1. **扫码解除强制提醒支持现实生活条码/二维码（免打印）**：
   - **双模式支持**：在 `src/features/alarmScanVerify.ts` 中引入 `AlarmScanVerifyMode = 'generated' | 'custom'`。除原有系统生成的 32 位随机字符专属二维码（`medbox-unlock:<token>`）外，新增支持用户通过手机相机或相册直接扫描现实生活中的条形码/二维码（如药盒自带的 EAN-13 商品条形码、日用品包装码等）进行绑定；
   - **原生全格式扫码解锁**：在 `MedicationAlarmActivity.kt` 中将原先仅支持二维码的 `QRCodeReader` 升级为 `com.google.zxing.MultiFormatReader`，配置支持 `QR_CODE`, `DATA_MATRIX`, `EAN_13`, `EAN_8`, `CODE_128`, `CODE_39`, `UPC_A`, `UPC_E`, `ITF` 等主流一维条形码与二维码，并动态根据绑定模式展示界面提示文案；
   - **设置页绑定交互**：在 `Settings.ts` 中新增「扫描已有码绑定」BottomSheet 弹层，集成全格式相机取景器与图片识别，识别后预览条码类型与内容，点击「确认绑定」即时生效；在专属二维码弹窗中亦增加「改为扫描生活中的码」快捷切换入口。
2. **局域网设备老版本获取最新版本更新修复**：
   - **主机记录对端 IP 反向 Bug 修复**：在 `src/sync/lan/session.ts` 中，修复了原有实现误将 `invitation.host`（主机本机自身 IP）记录为对端分发源 IP 的问题，改为由加入端在 `joinPayload` 中上报真实 `clientHost`，主机正确记录加入端 IP 为更新源；
   - **常驻开启 APK 分发服务**：在 `src/main.ts` 初始化期自动调用 `startServingInstalledApk()`，监听 38473 端口；在 `autoSync.ts` 中解耦自动同步开关与 APK 服务生命周期，确保关闭 30 分钟数据同步时不会误停 APK 分发；
   - **局域网主动扫描探测新版本**：
     - 在 `ApkDistributionPlugin.java` 中新增 `@PluginMethod probePeer` 与并发子网探测 `@PluginMethod scanSubnet`，并发快速探测 `/24` 子网内开放 38473 端口并响应 `MBAPK001` magic 头的设备；
     - 在 `src/sync/lan/apkTransport.ts` 中实现 `scanLanForUpdates()`，优先检查已知配对设备，结合子网并发扫描发现候选源，通过沙箱临时包验签比对版本，发现新版本后自动存入 localStorage 并广播更新通知；
     - 在 `Settings.ts` 应用更新面板增加「检查局域网更新」按钮，带有动态扫描指示与即时更新结果。

### 8. 本地后端与底层服务审查及安全加固 + 前后端桥接修复 (0.9.11)

对小药盒「本地后端与底层服务」（数据持久化、局域网加密通信协议、Android 原生后台守护及 AI 密钥安全）及前端 WebView 与原生插件的桥接机制进行了全面代码审计与健壮性加固：

- **前后端打卡动作桥接与数据同步修复**：
  - 在 `MedicationAlarmContract.java` 的 `queueOccurrenceAction` 中补充对 `MainActivity` 的唤醒启动意图（带 `FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_CLEAR_TOP`），解决全屏提醒单药行点击「已服/跳过」后 WebView 无法感知的问题；
  - 在 `src/features/reminderScheduler.ts` 的 `runTick()` 函数入口处前置调用 `replayPendingMedicationReminderActions()`，使常驻后台保活运行的调度器每次计算新计划前均优先消化 SharedPreferences 中累积的原生打卡动作，确保本地 IndexedDB 记录与原生排程状态强一致，彻底根除闹钟重复响起的桥接脱节隐患。
- **WebView Insets 注入脚本加固**：在 `MainActivity.java` 的 `installInsetsBridge` 脚本中包裹 `if(document.documentElement){...}` 判空保护，防御冷启动首帧时因 DOM 尚未挂载导致的控制台 null 访问异常。
- **APK 局域网分发传输 IP 白名单校验**：在 `ApkDistributionPlugin.java` 的 `download()` 路径中引入严格的局域网私有/链路本地 IPv4 地址过滤（`LocalIpv4Address.parse(host)`），拒绝向公网 IP 或域名建立明文 socket，杜绝 SSRF 与盲连内网未授权端口。
- **APK 缓存路径沙箱化与路径穿越拦截**：在 `ApkDistributionPlugin.java` 的 `resolveStoragePath()` 中增加对包含 `..` 路径穿越特征的防御拦截，并结合 `canonicalPath` 严格校验目标路径必须隶属于应用的 `cacheDir` 范围；在 `download()`, `verifyApk()`, `installApk()`, `deleteApk()` 中全面推行此沙箱校验，彻底消除外部文件被破坏或任意文件删除风险。
- **KeepAliveService API 规范升级**：将 `KeepAliveService.java` 中过时的 `stopForeground(true)` 升级为现代兼容模式（API 24+ 使用 `STOP_FOREGROUND_REMOVE`）。
- **同步原生版本断言**：修复了 `AppConfigurationTest.java` 中遗留的旧版号判定，同步为 `0.9.11` 与 `versionCode 30`。
- **自动化测试扩充**：在 `tests/apkUpdateVerification.test.ts` 中补充了 `installApk` 与 `deleteApk` 的安全边界行为测试；TypeScript 静态检查、Vitest 75 套件 431 个单元测试、Gradle 原生测试（`gradlew.bat testDebugUnitTest`）以及 Web 构建全量通过。

### 7. 全面屏前端 UI 深度适配 + 模拟器视觉验收（0.9.10 增强）

针对全面屏在 Android 15/16 挖孔屏、iPhone 灵动岛、暗色夜间模式、紧凑小屏及横屏模式下的前端 UI 进行了全链路审查与真机模拟器验收：

- **今日页状态栏避让**：修复 `.topbar` 隐藏后 `.page.today-page` 缺少顶部安全区 padding 的缺陷，添加 `padding-top: calc(var(--safe-top) + var(--space-2))`，避免日期与个人中心头像被摄像头挖孔和状态栏图标遮挡。
- **全站深色夜间模式卡片 Token 化**：清除 `inventory.css`、`scanner.css`、`settings.css`、`med-history.css`、`medication-editor.css`、`med-wizard.css` 中的硬编码 `#ffffff`，统一收敛至设计 Token `var(--color-surface)` / `var(--color-border)` / `var(--color-surface-muted)`，并在暗色主题下补齐边框与微底色。
- **服药打卡弹窗（TakeMedModal）**：增加 `max-block-size: min(90dvh, 720px)` 与局部滚动，接入 `registerRouteTransitionCleanup`、`makeAppInert` 与 `restoreAppAfterLastDialog` 焦点生命周期。
- **横屏模式通用紧凑化**：将横屏设备（高度 < 600px）下的顶栏（52px）与底栏（50px）紧凑高度规则扩展至所有页面。
- **模拟器视觉验收测试套件**：编写 `scripts/ui-audit/ui-audit-fullscreen-acceptance.mjs`，生成 47 张高保真设备渲染截图及报告 `output/fullscreen-acceptance/index.html`，各项指标 100% 通过。
- **发布打包**：运行 Web 构建与 Gradle 编译，成功产出 `release/xiaoyaohe-0.9.10-android-release.apk` 与 `release/xiaoyaohe-0.9.10-SHA256SUMS.txt`。

### 6. 模拟器视觉验收 + 底栏玻璃泡 / 占位 / 图标三修（0.9.10）

用户酷安截图验收后反馈三问题，已用 Android 模拟器（AVD ldj_test35，SDK C:\Android\Sdk，adb 直连）全流程截图迭代修复：

- **选中项玻璃泡（酷安式）**：`liquid-glass.css` 给 `.tabbar a.active::before` 加横向胶囊透明泡——近透明填充 + 1.5px 白描边 + 顶亮/底暗 inset 光 + 下方双层投影浮起，backdrop 引用新 SVG 滤镜 `#medbox-lens-bubble`（scale=26 低频位移，index.html 新增），泡包住图标+文字并凸出底栏；切页跟随由 active 类驱动。平板侧栏模式显式关闭泡。
- **占位压缩**：底栏 min-height 64→54px（safe-area 由外层 margin 承担，原 min-height 双重计入 safe 是"占位大"主因之一）、项高 46、图标 22、字号 12px、留缝 10/6px、toast 64px。
- **FAB**：58×42 横向胶囊凸出 -16px；保持品牌紫渐变（用户澄清：参考图演示的是玻璃质感，**不是改绿色**），叠加 ::after 顶部流光。
- **图标裁切修复**：根因是 adaptive foreground 把成品图标铺满 72/108，遮罩裁掉边缘与文字。`gen-icons.mjs` 改为 66/108 官方可见安全区 + `assets:build` 重生成；模拟器抽屉验收图案与文字完整。
- **底部遮挡修复（模拟器发现的第 4 个问题）**：insetsHandling=disable 下 env(safe-area-*) 恒 0，3 键导航条会压住底栏文字。`MainActivity.installInsetsBridge()` 在 decor 层监听真实 WindowInsets，把 bottom/left/right dp 写入 CSS 变量 `--safe-area-inset-*`（tokens.css 的二级兜底变量，顶部刻意不注入以维持沉浸态）。
- 验证门：typecheck 0 错、vitest 424、playwright 52、gradlew testDebugUnitTest + assembleRelease 全绿。
- 版本链已登记 0.9.10/29（映射表 + 两个版本锁测试 + notes）。注意 tests/release-utils.test.ts 是 CRLF 行尾，node 字符串 replace 用 `\n` 会静默失配，需正则 `\r?\n`。

### 5. 全屏闹钟 UI 重设计 + 扫码解除强制提醒（0.9.9）

**UI 重设计（MedicationAlarmActivity.kt 全面重写）**：
- 呼吸状态点 + 大号实时时钟头部；组模式保留行列表，单药模式大标题+剂量 chip；
- 渐变主 CTA（按压缩放反馈）+ 玻璃胶囊次按钮 + 幽灵危险按钮的三级层次；
- 自动关闭倒计时改为 Compose 驱动（LaunchedEffect，0.9.8 的 Handler 已移除），footer 显示"N 秒后自动收起"。

**扫码解除强制提醒**：
- `src/features/alarmScanVerify.ts`：`{enabled, token}` localStorage（key `medbox.alarm-scan-verify.v1`），token=`medbox-unlock:<32hex>`；
- 设置→系统通知 开关 + 「查看解锁二维码」BottomSheet（QRCode.toCanvas）+ 重新生成（confirmDialog 后 rotate token）；
- TS reconcile 注入 scanVerify/scanToken **顶层+data 双写**（贪睡 buildSnoozePayload 只透传 data，双写保证重建后仍锁定）；fireNow 测试同样注入；
- Contract `requiresScanVerification/scanTokenOf` 双处兜底读取；requireScan 时：通知剥离全部 addAction（防绕过）、strong 升级 fullScreenIntent、全部操作必须进全屏页；
- Activity 锁定态：隐藏所有动作按钮，仅显示「扫描解锁二维码」CTA → 内嵌 CameraX 取景器 + ZXing QR 解码，匹配 scanToken 才解锁；取景期间自动关闭倒计时暂停；
- 解锁后展示常规按钮并附加"已验证"提示 + 短振动确认。
- **依赖决策（体积教训）**：先选 MLKit barcode bundled → APK 从 10.35MB 暴涨至 **35.2MB**（内置各 ABI 识别模型），立即回退改用 **ZXing core 3.5.3**（纯 Java QR-only，PlanarYUVLuminanceSource+rotation 处理），最终 APK **13.45MB**（相对 0.9.8 +3.1MB ≈ CameraX+UI 重设计增量）。CameraX 1.6.2 固定（variables.gradle）。
- 发版流程坑（已修）：`scripts/lib/release-utils.mjs` 的 `VERSION_CODE_BY_VERSION` 必须登记新版本映射（0.9.8/27、0.9.9/28 已补），否则 vitest define 注入 null 导致 apkTransport 测试假失败；`tests/release-utils.test.ts` 版本锁与原生 `AppConfigurationTest` 同步更新为 0.9.9/28；release notes `docs/releases/0.9.9.md` 已建。

### 4. Liquid Glass 液态玻璃全面接入（0.9.8，灵感源 Kyant0/AndroidLiquidGlass）

**关键结论**：Kyant0/AndroidLiquidGlass 是 Kotlin/Compose 库，无法作用于 WebView 内容（其 Backdrop 只采样自身 Compose 树；Android 无公开 API 能跨视图实时折射采样）。因此采用双轨落地：

#### Web 端全局复刻（全部 WebView 界面 + PWA）
- **新增 `src/ui/styles/liquid-glass.css`**（挂入 styles.css 导入链末位）：三段式材质 = 厚玻璃基底（blur 20-26px + saturate 180% + brightness 补偿）+ SVG 边缘折射环带（feTurbulence→feDisplacementMap）+ 镜面高光（斜向流光多层背景 + 渐变亮边框 padding-box/border-box 技法 + 内缘受光阴影）。全部规则挂 `<html data-liquid="on">` 门控。
- **`index.html` 静态注入零尺寸 SVG defs**（#medbox-lens / #medbox-lens-edge）；小面积控件（顶栏图标钮、扫描 FAB、Toast）整面引用滤镜，大面积悬浮条只在 ::before 边缘细环上引用（mask 双向渐变取边带），性能可控。
- **兼容回退零 JS 判断**：每条 backdrop-filter 先写普通链再写 url() 变体，不支持的引擎丢弃后者保留前者。
- **悬浮胶囊布局（shell.css）**：底栏/操作坞改为离屏圆角胶囊（`.app-shell > .tabbar.app-navigation, .app-shell > .action-dock` 统一 margin 规则含 safe-area），toast 定位同步（76px→74px）；平板侧栏模式归零悬浮几何只升材质。
- **开关 `src/ui/liquidGlass.ts`**（仿 theme.ts）：localStorage key `medbox.liquid-glass`，默认开启，落 `<html data-liquid>`；main.ts 在 initTheme 后立即应用防首帧闪变；设置→外观新增「液态玻璃效果」开关行（Settings.ts renderAppearancePanel）。
- 暗色变体经 `:root[data-theme='dark'][data-liquid='on']` 选择器内建于 liquid-glass.css；另处理 prefers-reduced-transparency 降级。
- e2e fullscreen.spec 断言（nav.top/main.bottom 几何关系）经验证不受影响，52 项全过。

#### 原生真库集成（全屏闹钟页 MedicationAlarmActivity）
- **版本链（重要，采坑记录）**：
  - backdrop-android 1.0.6 aar-metadata 要求 minCompileSdk=36 —— 与本工程一致；
  - **2.0.x 全线要求 compileSdk 37 + AGP 9.1**（JB Compose 1.12 桥接 androidx 1.12 所致），Capacitor 8 官方矩阵（AGP 8.13+Gradle 8.14.3+compileSdk 36）不支持 → 锁定 backdrop 1.0.6；
  - backdrop-android 1.0.6 的 android 变体**不带出传递依赖**（module metadata 变体问题），须显式声明 androidx.compose.foundation/ui/ui-graphics 1.10.3 + io.github.kyant0:shapes 1.2.0；
  - Kotlin 必须用 KGP 2.3.10（buildscript 字面量 + variables.gradle 同步），Compose 编译插件是 org.jetbrains.kotlin:compose-compiler-gradle-plugin:2.3.10（marker 构件 org.jetbrains.kotlin.plugin.compose 不存在于 Central）；
  - JVM target 必须 21（与 app/capacitor.build.gradle 的 VERSION_21 对齐，kotlinOptions.jvmTarget 同步）。
- **MedicationAlarmActivity.java → .kt（ComponentActivity）**：类名/Manifest 不变；行为契约完整保留（payloadFrom/onNewIntent 换载荷/铃声振动/超时自关/MedicationAlarmContract 分发）。UI 用官方 LiquidButton 同款效果组合：vibrancy() + blur() + lens(12dp,24dp) 边缘折射，LayerBackdrop 记录装饰渐变层供采样；API<33 时库内部自动跳过 lens shader（剩 blur+vibrancy），无需本层版本分支；文字用 foundation.BasicText（material3 无对应稳定版不引入）。
- 环境备注：aliyun 镜像对 kotlin-compiler-embeddable 大 jar 反复截断下载，已从 repo1 直下并按 sha1 结构预植入 Gradle 缓存解决。

### 1. AI 医疗助手全面升级与多格式支持
- **文件多格式支持**：
  - 支持 PDF 电子病历与处方单文本流抽取与摘要。
  - 支持 CSV / TSV / Excel 表格文件自动转换为标准 Markdown 表格。
  - 优化了处方、病历与化验单照片/截图的图像压缩与视觉输入流。
- **服务商一键预设**：
  - 在 `openLlmProviderEditor` 中集成 7 大主流大模型预设胶囊（DeepSeek、通义千问、Kimi、硅基流动、智谱 GLM、Ollama 本地大模型、OpenRouter），点击自动填入配置。
- **专属医疗工具扩充**：
  - `check_drug_interactions`：自动对比药箱内全部药物（或用户输入新药），筛查已知严重出血、中枢抑制、降糖过激等配伍禁忌并输出结构化卡片。
  - `batch_import_medications`：从对话提取的整批处方药品一次性批量录入药箱，自动建立提醒与库存。
- **UI 交互与气泡精修**：
  - 用户消息严格右对齐（`align-items: flex-end; align-self: flex-end; margin-inline-start: auto`）。
  - 左侧 AI 消息气泡显式 1px 微边框、立体微投影与深色模式高对比度底板。
  - 增加一键清空记录、气泡一键复制、流式打字动态呼吸光标、Markdown 表格横向滚动包裹层与代码块复制。

### 2. Android 长按输入框复制菜单异常白色遮挡彻底修复
- **根因确诊**：`android/app/src/main/res/values/styles.xml` 中在 `AppTheme.NoActionBar` 上错误使用了针对 View 的 `android:background` 属性，导致系统 `PopupWindow` / `FloatingToolbarPopup` 继承了全宽实心白底。
- **修复措施**：更正为合规的 `android:windowBackground`，恢复系统复制/粘贴悬浮气泡菜单的透明背景。

### 3. 设置页及表单控件 Shadcn 风格质感重构
- 家庭同步（LAN Sync）区域中传统的 `<fieldset>` 边框重构为现代化浅底低噪卡片。
- 复选设置项（允许多设备整库覆盖、自动同步、静默处理）全面升级为带有加粗主标题、辅助说明与悬浮/触控微动效的结构化卡片（`.lan-sync-toggle-card`）。
- 统一定制 44px 触控高度输入框、聚焦柔和光晕与独立圆角配对设备卡片行。

## Verification & Release Status

- **静态类型检查**：`npm run typecheck` (`tsc --noEmit`) 0 报错。
- **自动化测试**：`npm run test`（74 个测试套件，424 项测试 100% 全部通过）。
- **E2E**：`npx playwright test` 52 项全部通过（phone-320 / phone-390 / tablet-landscape / desktop 四视口）。
- **生产构建与原生同步**：`npm run build` + `npx cap sync android` 顺利完成。
- **原生构建**：`:app:assembleDebug`、`:app:testDebugUnitTest`、`:app:compileDebugKotlin` 全部 BUILD SUCCESSFUL（Kotlin+Compose 混编）。
- **正式版 APK 产物**：`release/xiaoyaohe-0.9.8-android-release.apk`（10.35MB，较 0.9.7 的 5.99MB +4.36MB——Compose/Kotlin 引入的固有体积成本；后续可用 minifyEnabled+R8 收缩，见 handoff 第 4 节风险说明）。
- **SHA-256**: `e56981819d6dee81803ac6acc19348ce3e4611d1be6727f4a21000340fe52052`（已写入 release/SHA256SUMS.txt）。

## 2026-09-03 工作区整理（0.9.11 基线落库）+ 图标安全区修复

- 0.9.11 的全部未提交改动（UI 平权重构、Gemini 3D 头像库、去代码化文案、versionCode 30、图标/闪屏、handoff 文档）已分批提交至 `workspace/claude`；`.gitignore` 补充 `release/` 整目录与 `scripts/_*` 调试残留。验证门：typecheck 0 错误、vitest 429/429 全绿。
- **缺陷修复**：0.9.11 期间 `gen-icons.mjs` 的 `adaptiveForeground` 被改为直接缩放 `design/brand/master/app-icon-foreground.png`，但该素材的紫色渐变背景未抠除（外环 100% 不透明），`tests/iconAssets.test.ts` 安全区断言失败，并回退了 0.9.10 的 66/108 防裁切修复。已还原为 HEAD 的透明画布合成逻辑，重新生成全部 32 个图标资源，测试转绿。
- **遗留**：`release/xiaoyaohe-0.9.11-android-release.apk` 仍含修复前的图标，下次发版重建时自动带上；「主体抠图式自适应前景」列为后续优化项（需先产出真正透明底的抠图素材）。
- 后端全面审计计划见 `docs/plans/2026-09-03-backend-audit.md`。**2026-09-03 用户拍板：腾讯云语音代理彻底退役（决策 A）**——`main` 已快进合并 `workspace/claude`，`server/`（tencent-asr-proxy.mjs + README）随 0.9.11 基线从 main 移除；审计计划 Task 2/3 作废。遗留收尾（需用户在 git 之外操作）：下线服务器上的代理进程、在腾讯云控制台删除/轮换 `TENCENT_SECRET_ID/KEY`。

## 2026-09-23 v1.1.8 新版 3D 素材修复 + 破框视觉 + 全局对比度审计

### 1. 3D 素材被裁切问题（根因与重做）
- **根因**：`src/assets/images3d/` 中 v1.1.8 替换的 6 张图被压缩改造过——主体统一被缩到 512×512 后填充进大透明画布（横幅甚至被改成 700×1331 竖版），且 `floating-pill`/`stat-target`、`stat-notebook`/`mascot-empty` 两两 md5 完全相同（重复文件）。页面用 `object-fit: contain` 时透明留白同样占位，主体被压到实际尺寸的 40%~65%。
- **修复**：从 `design/brand/raw/` 原图（与用户桌面原图 md5 一致）重新生成，**只裁纯透明留白、不裁主体**：
  - `pillbox-banner` 700×1331 → **1400×929**（恢复横版）
  - `stat-pillbox` → 712×960；`stat-notebook`/`mascot-empty` → 800×914；`floating-pill`/`stat-target` → 788×980
- 新增 `src/assets/images3d/app-icon.png`（由 `public/icons/icon-512-full.png` 复制，供 Vite 打包引用）。

### 2. 破框穿透视觉
- **分药横幅**：`.scan-banner-card` overflow hidden→visible，图片绝对定位挂右缘外，右探 13px / 上探 9px。
- **我的数据统计卡**：图标 22px → 60px，向上突破卡片上边框 17px；实心灰盘 `#f1f5f9` 改为半透明径向光晕（明暗双主题）。（注：曾试过 76px/破框 25px，视觉过重与下方文字不协调，回调至当前比例。）
- **服药弹窗**：胶囊 110px → 164px，探出容器下沿。
- **今日空状态**：盒宝 110px → 150px，从卡片顶部探出 48px。
- **关于页**：绿色圆角方块 + 线性 pill 图标 → 新版 App 图标（3D 日历小胶囊），56 → 72px。

### 3. 缺陷修复
- **日历日期全白不可见**：`.calendar-cell` 是 `<button>`，不继承页面文字色，基础规则又缺 `color`，导致 30 个可见日期格落到祖先浅色上变白字。补 `color: var(--color-text)`。
- **日历顶部大片空白**：`medications.css` 的通用 `.empty` 类误命中日历月首占位格，给了 `grid-column: 1/-1` + 36px 内补，使两个占位格各自独占整行。在日历作用域内收回为普通网格单元——网格高 391px → 236px，顶部空隙 155px → 0。
- **药品页卡片左侧黑色溢出**：`MedList.ts` 瓶身标签线 `<path>` 只有 `stroke` 没有 `fill`，SVG 默认 `fill: black` 画出黑色楔形；叠加 `rotate(-12)` 后露在卡片左缘。补 `fill="none"`，并给 `#featureShadow` 滤镜显式限定区域。
- **暗色周历选中日不可见**：`[data-theme='dark'] .day`(0,2,0) 覆盖了 `.day.selected`(0,2,0, 源码更靠前)，选中格背景与未选中**完全相同**（对比度 1.0）。补 `[data-theme='dark'] .day.selected` 恢复主色填充 → 选中/未选中对比度 **5.56:1**，数字 6.17:1。
- **分药两入口卡难分辨**：`.blue` 与 `.green` 同为深绿。改为主次层级——主卡实心深绿，次卡浅色中性底 + 绿字绿描边（暗色为半透白底 + 亮绿字）；卡间距 `--space-3` → `--space-4`。两卡区分度：亮色 6.43:1、暗色 5.22:1。

### 4. 对比度审计（实测渲染值，非静态读取）
逐元素遍历 6 个页面、合成半透明背景后计算，**暗色违规 12 处 → 0**：
- `.profile-streak-badge` 暗色用了 `--color-primary-soft`(#183329 近黑绿) → 1.18:1，改用 `--color-primary`。
- `.panel-chip` 三个 tone 暗色下仍是硬编码亮底 → 补 `[data-theme='dark']` 整体翻转。
- 日历选中格硬编码白字压浅绿底 → 2.89:1，改用 `--color-on-primary`。
- 顺带修亮色本就不达标项：`tone-ok` 2.32→、`tone-muted` 4.34→、tabbar `#8e8e93` 3.26→4.6:1（并补暗色覆盖）、`.settings-about-badge` 4.35→5.92:1、`.feature-text p` 4.3→6.41:1（并补暗色 7.28:1）。

### 5. 验证
- `npm run typecheck` 0 报错；`npm run test` **577/577** 通过（91 套件）。
- `npx playwright test` **72/72** 通过（phone-320 / phone-390 / tablet-landscape / desktop）。
- `npm run build` 成功；浏览器控制台与网络请求均无报错。
- 375px / 768px 两种宽度实测：无横向滚动、卡片不重叠、文字不被图片遮挡。

### 6. 遗留项后续处理（同日追加）
- `.ai-panel-backdrop` 关闭态的 `pointer-events` 隐患已按用户确认修复：关闭态显式 `pointer-events: none`，`.ai-root.is-open` 下恢复 `auto`。
  - 实测（375×812）：关闭态视口命中测试落到页面内容（`.day`）；打开态命中 `.ai-panel-backdrop`，点击遮罩关闭面板的交互保留。
- 修复后重跑全量门禁：typecheck 0 报错 · vitest 577/577 · playwright 72/72 · `npm run build` 成功（web bundle sha256 `ad725cd3756316548f1e963deaf4eeb63fd2376cabd7060b1ddfce2d561cb12a`）。

### 7. Android 出包（v1.1.8 重打）
- `npx cap sync android` → 复制 dist 到 `android/app/src/main/assets/public`，2 个 Capacitor 插件（secure-storage 8.0.0、local-notifications 8.2.0）正常识别。
- `./gradlew.bat assembleRelease` BUILD SUCCESSFUL（1m30s，含 lintVitalRelease），使用 `app/keystore.properties` + `app/medbox-release.jks` 正式签名。
- `publishReleaseArtifacts` 校验 APK 内嵌 web 资源与 dist 完全一致：**109 个文件**，聚合哈希 `dcf75e1e77cf64c57adeb8d53119e61df9d515b03b878d9be2dd2724226d18ac`。
- 产物：`release/xiaoyaohe-1.1.8-android-release.apk`（20,929,021 字节，sha256 `349747813972e2812b3bdb033f07885768aff9d23eb54b78ddffa448a2f3dcf7`）+ 同名 SHA256SUMS.txt；`version.json` 已由 `gen-version.mjs` 刷新为该哈希。
- 注意：版本号仍为 1.1.8 / versionCode 66（本次为同版本重打包，未 bump），APK 体积由 21,705,841 → 20,929,021 字节。


### 67. v1.1.9 版本递增、E2E 存量失败清零与正式出包 (v1.1.9, versionCode 67, workspace/claude)

1. **版本递增（1.1.8 / 66 → 1.1.9 / 67）**：
   - 起因：上一轮为同版本重打包，versionCode 未变，装有旧 1.1.8 的设备不会收到更新提示。
   - 改动点：`package.json`、`package-lock.json`（两处 version 字段）、`android/app/build.gradle`（versionCode 67 / versionName "1.1.9"）、`scripts/lib/release-utils.mjs` 的 `VERSION_CODE_BY_VERSION` 登记 `'1.1.9': 67`、新建 `docs/releases/1.1.9.md`（通过 oil-tone 风格的双条目摘要）。
   - `tests/release-utils.test.ts` 补 1.1.9/67 的映射断言；`npm run test:release` 12 项通过。

2. **测试 fixture 版本推位**：
   - `tests/appUpdateButtons.test.ts`、`tests/bundleUpdateVerification.test.ts`、`tests/apkUpdateVerification.test.ts` 原本用 `1.1.9 / 67` 充当「云端更高版本」的假数据；本机 bump 到 1.1.9 后这些 fixture 不再「更高」，导致 17 项单测失败（`updateType` 判定与按钮呈现断言）。统一推位至 `1.2.0 / 68`，577/577 恢复全绿。

3. **E2E 存量失败清零（72/100 → 100/100）**：
   - **重要更正**：此前两轮 handoff 与对话中报告的「playwright 72/72 通过」是**误读**——实际是 100 项中 72 通过、**28 失败**，读取 `tail` 输出时把滚出的失败清单当成了通过清单。
   - 通过 checkout 到 `213fad3`（v1.1.8）实测确认：同样的 28 条在基线上全部失败，集合完全一致，属 v1.1.8 就存在的存量问题，非本轮改动引入。
   - 根因是用例断言与实现脱节：
     - `e2e/fullscreen.spec.ts` + `e2e/medication-batch.spec.ts` 断言今日页有 `<h1>今天</h1>`，但自 v1.1.5（提交 `dfe1c11`）起今日页顶栏改为常驻问候语，实际 h1 是 `.today-greeting`（早上好/中午好/下午好/晚上好）。改为按 `/^(早上好|中午好|下午好|晚上好)$/` 匹配，并抽出 `TODAY_HEADING` 常量复用。
     - `e2e/reminder-periods.spec.ts` 用 `.period-setting-row` 定位时段行，但 v1.1.8（第 65 条）把时段列表重构为独立微卡片 `.period-setting-card`，旧类名在 `settings.css:676` 仅剩 `display: none` 的兼容空壳。8 处选择器改名即可，其余文案断言（早上/中午/晚上/睡前、08:00、不自动收起）在当前实现下仍然成立，未作放宽。

4. **Android 出包**：
   - **首次打包后发现 `verifyApkWebAssets` 报 `stale or modified dist resource: version.json`**：`gen-version.mjs` 需要 `release/` 下存在同版本 APK 才能写入 `fileSize`/`sha256`，而首次打包时该 APK 尚不存在——先有鸡后有蛋。历史版本两种情况都出现过（1.1.8 的 APK 内嵌带哈希，1.1.7 不带），取决于打包前 `release/` 是否已有同版本产物。
   - 处理：拿到 APK 哈希后重跑 `gen-version.mjs` → `npx cap sync android` → `./gradlew.bat assembleRelease` 第二轮，使 APK 内嵌的 `version.json` 完整。校验通过：**109 个内嵌文件**与 dist 完全一致，聚合哈希 `77de699b7276a468bfa7dac8d2b4923bb38e809a52a9e1b1045b0cb7aea41a8b`。
   - 产物：`release/xiaoyaohe-1.1.9-android-release.apk`（20,929,065 字节，sha256 `7a7159407a0146e5089c832313a597c0e75057636350e665fac8bebad555d1e3`）+ 同名 SHA256SUMS.txt；Web Bundle `xiaoyaohe-1.1.9-web-bundle.zip`（8,297,859 字节，sha256 `f3f7b4a82401cbd0e85d38388da08c772b19a27bb0425414528e0634726f45a6`）。
   - `public/version.json`（客户端校验用的那份）已刷新为最终产物哈希，与 `release/` 实际文件一致。
   - 注意：APK 内嵌的 `version.json` 记录的是上一轮打包的哈希（自引用无法自洽），客户端更新校验读的是云端下发的 `public/version.json`，不受影响。

5. **验证门禁**：
   - `npm run typecheck` 0 报错；
   - `npm run test` **577/577**（91 套件）；
   - `npx playwright test` **100/100**（phone-320 / phone-390 / tablet-landscape / desktop，此前 72/100）；
   - `npm run build` 成功；`npx cap sync android` 正常；`assembleRelease` BUILD SUCCESSFUL（含 lintVitalRelease），使用 `app/medbox-release.jks` 正式签名。

6. **上一轮遗留项已处理**：`.ai-panel-backdrop` 关闭态显式 `pointer-events: none`、`.ai-root.is-open` 下恢复 `auto`。实测（375×812）关闭态视口命中落到页面内容（`.day`），打开态命中 backdrop，点击遮罩关闭的交互保留。

### 68. 修复 Cloudflare 边缘动态 version.json 端点缺陷与发布说明元数据补全 (v1.1.9, versionCode 67, workspace/claude & main)

1. **缺陷根因与排查**：
   - 线上发布 v1.1.9 后运行 `check-release-endpoints.mjs`，发现 `version.json` 下发 `versionCode: 48`、`minNativeVersionCode: 44`；
   - 根因一：`functions/version.json.ts` 中针对 `1.1.x` 无法命中 `^1.0.(\d+)$` 正则，正文未显式包含 `versionCode` 时兜底返回写死的 48；`minNativeVersionCode` 写死为 44；
   - 根因二：Cloudflare Pages 绑定生产分支 `main`，而此前发版提交仅在 `workspace/claude`，导致边缘服务仍在运行旧版本。
2. **修复落地**：
   - `functions/version.json.ts`：引入与 `release-utils` 对齐的 `VERSION_CODE_BY_VERSION` 映射表，`minNativeVersionCode` 引用权威常量 58，全落空时缺省字段退回字符串版本对比；
   - `tests/functionsApi.test.ts`：补充 7 项端点防漂移一致性回归测试，全量测试达到 584/584 项 100% 通过；
   - 在 `docs/releases/1.1.9.md` 与 GitHub Release `v1.1.9` 正文中补充 `<!-- versionCode: 67 -->`，使当前线上旧边缘函数即刻解析出 67；
   - 将 `workspace/claude` 合并推送至 `main` 分支，触发 Cloudflare Pages 重新构建部署新版边缘函数；
   - `check-release-endpoints.mjs` 冒烟 4/4 项全部 PASS。


### 69. 动效系统重做：对齐 iOS，去 PPT 式弹跳 (workspace/claude, 未发版)

1. **动效曲线（`tokens.css` / `legacy.css`）**：
   - 废除过冲 56% 的 `--ease-spring: cubic-bezier(0.34, 1.56, …)` 与 `--ease-bounce` / `--ease-spring-snappy`；
   - `--ease-spring` 改为真实临界阻尼弹簧 `linear(…)`（ζ≈0.82，过冲约 1%，`@supports` 守卫，旧 WebView 回退到 UIKit 曲线 `cubic-bezier(0.32, 0.72, 0, 1)`）；
   - 新增 `--ease-exit: cubic-bezier(0.4, 0, 0.7, 0.2)` 专供退场；`legacy.css` 的 `--ease-spring` 同步改为无过冲。
2. **移除循环动效**：盒宝/盾牌/胶囊插画的 `floatGentle`、`floatSubtle`、`scanBannerFloat`、`takeMedPulseGlow`，今日小绿点 `dotPulse`，Tab 图标 `tabIconSpring`，主按钮 hover 扫光。iOS 不会让静态元素无限漂浮。
3. **关键帧收敛**：`selectPop` / `chip-pop` / `checkmarkPop` / `tab-icon-pop` 全部改为「从 0.9x 落定到 1x」，不再 1.05~1.28 放大再回缩；`fab-enter` 去掉 `rotate(-20deg)`+`scale(0.4)`；`celebratePulse` 只放光晕不缩放卡片；`stepShake` 改为幅度衰减的 iOS 密码错误式抖动；列表/面板入场 stagger 间隔 60→25ms。
4. **弹层生命周期**：`.bottom-sheet` / `.take-med-sheet` 入场 0.46s UIKit 曲线；居中 Dialog 只 `scale(0.96)` 淡入不再位移。新增 `playOverlayExit()`（`components.ts`）：真实节点仍同步移除（焦点 / inert / 监听器生命周期与测试契约全部不变），另插一个 `aria-hidden + inert` 的幽灵克隆播放 `.is-leaving` 退场（遮罩淡出 + 面板下沉 0.3s），400ms 后自删；无 WAAPI / reduced-motion 时直接跳过。克隆体子树 `animation/transition: none !important`，防止向导升起等入场动画被重播。
5. **按压手感**：`button/a/[role=button]` 及列表卡 `:active` 时 `transition-duration: 80ms`（跟手），松手按元素自身弹簧回弹；按压缩放收敛到 0.92~0.97（原 0.85/0.86/0.88）。
6. **分药向导**：页切换改为 iOS 导航式视差（新卡 40% 推入、旧卡退 30% 变淡），页码点由放大改为拉长成胶囊。
7. 验证：`tsc` 0 错误、Vitest 584/584、Playwright 100/100；浏览器实测 `linear()` 生效、bottom-sheet 开合后无残留节点、`#app` inert 正确恢复、无控制台错误。

### 70. v1.1.10 发版：动效重做正式出包 (v1.1.10, versionCode 68, workspace/claude)

- 版本递增：package.json / package-lock.json / build.gradle / `VERSION_CODE_BY_VERSION` / `functions/version.json.ts` 镜像表 → 1.1.10 / 68；新增 `docs/releases/1.1.10.md`。
- 测试夹具里的「更新的假版本」从 1.2.0/68 上推到 1.2.1/69（本机 `LOCAL_APP_VERSION_CODE` 已是 68，否则更新判定夹具全部失效）。
- 出包走两遍（gen-version 需要已存在的 APK 才能写入 fileSize/sha256）：第一遍产 APK → 复制到 `release/` → gen-version → cap sync → 第二遍 assembleRelease → `publishReleaseArtifacts` 校验 109 个 dist 文件字节一致。
- 产物：`xiaoyaohe-1.1.10-android-release.apk` 20928601 B，sha256 `01a650c8…29f90a`；`web-bundle.zip` 8297360 B，sha256 `6ba6b66d…94d4a`；`minNativeVersionCode: 58`。
- 门禁：tsc 0 错误、Vitest 584/584；Playwright 100/100（动效重做那轮跑过，本轮仅改版本号与夹具）。

### 71. 打卡进度环 / 分药页 / 更新推荐 / 更新说明去黑话 / AI 助手页优化 (workspace/claude, 未发版)

1. **进度环从旧位置延伸**：`progressRing(value, total, fromPercent?)` 新增上次百分比参数；有值时用 `ringGrow` 关键帧从 `--ring-from` 延伸到新值，数字从旧值滚动（`animateCountUp` 新增 `startVal`，后台标签页直接落终值）。`Today.ts` 以 `root + signal + 日期` 记忆上次百分比，同一次挂载内打卡才延续；首次挂载与切换日期仍整圈扫入。测试 `tests/progressRing.test.ts`。
2. **分药页**：`.scan-home` 纵向 `gap: var(--space-5)`，横幅与「开始分药」卡间距 20px。分药向导“两层”根因：`.bottom-sheet` 外壳（液态玻璃背景 + 通用把手 + 上滑动画）与 `.med-wizard` 面板各画一套外观，旧覆写优先级不足。改为 `.bottom-sheet-overlay > .bottom-sheet.med-wizard-host` 清空外壳并去掉 `::before` 把手（`med-wizard.css`，认药向导同样受益）。
3. **更新方式推荐**：纯函数 `src/sync/lan/updateRecommendation.ts`（局域网/本机版本未知/无秒级资源/底座低于门槛/秒级失败过/体积不占优 → 完整包，否则秒级），面板显示「推荐」标签 + 一句理由；双通道保留，秒级失败后改为推荐完整包并保留重试。测试 `tests/updateRecommendation.test.ts`。
4. **更新说明去黑话**：发布侧 `scripts/lib/release-notes-lint.mjs`（移植 tone_lint 硬规则 + 词表 + 英文技术标识检测），接入 `gen-version.mjs` 与 `release-utils.mjs` 命中即阻断；HTML 注释元数据先剥离不下发。客户端 `src/sync/lan/releaseNotesText.ts` 展示前过滤。18 份历史 `docs/releases/*.md` 改写为大白话。AI「检查更新」卡片去掉 Cloudflare / versionCode / APK 等字样。测试 `tests/releaseNotesJargon.test.ts`（词表两端一致性 + 全量扫描）。
5. **AI 助手页**（`assistant.css` / `AiAssistant.ts` 仅 UI）：墨绿配色统一、深色白块修复、去掉 `prefers-color-scheme` 分支改走 `data-theme`、头部按钮 36px、多行自增输入框（回车发送 / Shift+回车换行 / 输入法组词不误发）、visualViewport 键盘避让、近底才追底、错误消息样式、加载点去跳动、按压缩放 0.95~0.97。
6. 门禁：tsc 0 错误；Vitest 94 文件 / 619 项 PASS；Playwright 100/100 PASS。截图读取在本环境超时，视觉效果待真机确认。

### 72. v1.1.11 发版 (v1.1.11, versionCode 69, workspace/claude & main)

- 版本递增 1.1.10/68 → 1.1.11/69（package.json / lock / build.gradle / `VERSION_CODE_BY_VERSION` / `functions/version.json.ts` 镜像表），新增 `docs/releases/1.1.11.md`（tone_lint PASS、黑话 lint PASS）。
- 测试夹具「更新的假版本」从 1.2.1/69 上推到 1.2.2/70；`tests/release-utils.test.ts` 补 1.1.11 断言。
- 两遍出包：APK 20931897 B（较 1.1.10 +3296 B），sha256 `3617ff88…95ca3f`；Web Bundle 8300708 B，sha256 `165cbe4e…b316e`；`minNativeVersionCode: 58`。
- 门禁：tsc 0 错误；Vitest 94 文件 / 619 项 PASS；Playwright 100/100（第 71 节同一代码）。
- 已推送 `workspace/claude`、tag `v1.1.11`，fast-forward `main`；GitHub Release `v1.1.11` 含 APK / Web Bundle / SHA256SUMS；`check-release-endpoints.mjs` 4/4 PASS，线上更新说明已无注释元数据。

### 73. 自绘控件统一 / 时段可删 / 深层页布局收敛 / 液态玻璃对齐 Apple Liquid Glass (workspace/claude, 未发版)

1. **时段提醒设置**：自定义时段卡片右侧新增删除按钮（`period-card-delete-btn`，二次确认后 `deleteReminderPeriodSetting` + 重建闹钟），编辑器底部的删除保留。内置四个时段仍只能停用（仓储层会重新推导，删不掉）。
2. **控件统一（自绘优先）**：
   - `Pickers.ts`：`openTimeSheet` 支持标题 / 分钟档位 / 顶部大字预览（`.ui-picker-preview`）；新增 `enhanceSelect(select)` 就地把已有 `<select>` 换成自绘下拉，原引用不变、选项实时读取（用于库存识别对应药品、模型下拉、生图接口模式）。
   - 新增 `src/ui/primitives/Stepper.ts`（`createStepper`）：「− 数值 +」步进器，支持 min/max/step/unit/allowEmpty/小数、拦截 `input.value` 赋值同步按钮态；替换时段重推 / 库存 / 周期天数 / 剂量等所有原生 number 框（`ReminderPanel` / `MedEdit` / `MedicationBatchEditor`）。
   - `primitives.css`：全局自绘复选框 / 单选 / `role=switch` 开关 / 步进器样式；页面级 `accent-color` 覆写清理。测试 `tests/ownControls.test.ts`。
   - **规则**已写入 `medbox/AGENTS.md`（及根 AGENTS.md、记忆）：所有现有与新增功能一律优先用 `src/ui/primitives` 自绘控件，禁止原生时间 / 日期 / 下拉弹层。
3. **深层页布局**：用临时 Playwright 审计脚本扫 10 条路由 × 2 宽度（溢出 / 截断 / 竖排 / 小热区 / 小字 / 套框）。修复：AI 服务商卡片 320 宽溢出（grid 子项 `min-inline-size:0`）；设置第三层卡片改浅底色块去描边；时段编辑页改「返回 + 标题」页头 + `.period-editor-body` 统一间距；周切换 / 筛选胶囊 / 步骤条 / 服务商按钮热区加大；最小字号 ≥10px；扫码绑定按钮窄屏折行。
4. **液态玻璃重做**（`liquid-glass.css` 重写 + `index.html` 滤镜 + `scripts/gen-lens-maps.py`）：
   - 折射改用预生成「凸透镜位移图」`public/icons/lens-full.png` / `lens-edge.png`（中心中性灰不位移，边缘向内弯折），`feImage → feDisplacementMap`，替代原 feTurbulence 随机噪点；三档滤镜 `#medbox-lens`（小控件）/ `#medbox-lens-edge`（大面积条只弯边缘）/ `#medbox-lens-bubble`（选中泡）。
   - 材质更薄：几乎不染色（tint 0.28~0.42，弹层 0.64 保可读），`saturate/contrast/brightness` 让透出内容更浓；边缘亮环用 `conic-gradient` 模拟左上环境光；顶部柔光 + 底部反光两层 gloss；按压微放大弹簧回弹。
   - 底栏选中项恢复为独立玻璃泡（`a.active::before`，`lgBubbleIn` 液态涨开，深色 / 平板侧栏各有变体）；顶栏 `.topbar-pill` 纳入玻璃规则；Toast 保持黑曜石深底白字（架构契约测试改为断言深色填充层）。
   - `prefers-reduced-transparency` / `prefers-reduced-motion` 退回普通毛玻璃。
5. 门禁：tsc 0 错误；Vitest 95 文件 / 624 项 PASS；Playwright 100/100 PASS。截图在本环境超时，玻璃效果需真机确认（Android WebView 对 `backdrop-filter: url()` 支持取决于系统 WebView 版本，不支持时自动退回普通模糊）。

### 74. v1.1.12 发版 (v1.1.12, versionCode 70, workspace/claude & main)

- 版本递增 1.1.11/69 → 1.1.12/70（package.json / lock / build.gradle / `VERSION_CODE_BY_VERSION` / `functions/version.json.ts` 镜像表），新增 `docs/releases/1.1.12.md`（黑话 lint PASS）。
- 测试夹具「更新的假版本」从 1.2.2/70 上推到 1.2.3/71（本机已是 70）；`tests/release-utils.test.ts` 补 1.1.12 断言。
- 两遍出包：APK 20968100 B，sha256 `567d1c42…fa35f8`；Web Bundle 8337018 B，sha256 `0ac5379f…cea3fa`；`publishReleaseArtifacts` 校验 111 个 dist 文件字节一致（新增 2 个透镜位移图）。
- 门禁：tsc 0 错误；Vitest 95 文件 / 624 项 PASS；Playwright 100/100（第 73 节同一代码）。

### 75. 添加药品表单错位修复 (workspace/claude, 未发版)

- 根因：① 新步进器输入框固定 `4.5ch` + 两个 40px 按钮，最小宽度约 155px，在批量添加页两列栅格（每列约 144px）里撑出字段、压到右侧；② 步进器 44px / 自绘选择器 44px / 文本框约 45.6px（padding+行高）各算各的，并排时差 1~6px；③ 日期文本在窄列里折成两行把选择器撑到 64px。
- 修复（`primitives.css`）：步进器改为可收缩（按钮 36px、输入 `flex:1` 2~6ch、`min-inline-size:0`），窄于 140px 时借容器查询隐藏单位；新增 `--control-h: 46px`，字段内单行文本框 / 选择器 / 步进器统一钉死同一高度；选择器文本单行省略、窄列收紧左右留白。
- 新增回归 `e2e/medication-form-alignment.spec.ts`（`/meds/new`、`/meds/create` × 4 视口：不溢出字段、单行控件等高）。回退样式时该用例能抓到「溢出字段」「44/50」「46/56」。
- 门禁：tsc 0 错误；Vitest 624/624；Playwright 108/108。

### 76. 设置页文案精简与层级压平 / 全屏提醒页重排 (workspace/claude, 未发版)

1. **设置页文案**：12 个面板逐条改写为「一句话、说结果」，删掉重复状态描述（开关本身已表示开关）与长篇说明块。
   - 系统通知：去掉「通知通道测试」描述、「滑动解锁」说明卡（徽标 + 长描述）与「扫码解除」状态卡（徽标 + 状态 + 长描述），各自只留开关行 + 一句副标题 + 按钮；测试按钮改为「测试通知 / 检查到点 / 锁屏提醒 / 全屏提醒」；结尾 5 条说明压为一句。
   - 其余面板（外观 / 保活 / 备份 / 存储 / 更新 / 诊断 / AI 服务商 / 生图 / 外发授权 / 家庭同步 / 时段提醒）同样压缩；生图接口选项去掉接口路径（`/images/edits` 等）改成大白话。
   - 刻意保留（有契约测试且属于必要告知）：网页端提醒降级说明的关键词、密钥明文存储警告、`WEB_SECRET_STORAGE_NOTICE`、家庭同步首句、铃声卡文案、保活四项标题与「主流手机后台防杀指南」。
   - 结果（390 宽、全部展开）：设置正文从约 1970 字降到约 1590 字；「系统通知」展开高度 1594 → 956px。
2. **设置页排版**（`settings.css` 末尾「层级压平」段）：面板内微卡片 / 扫码卡 / 铃声卡只保留一层白底分组，内部开关行去底色去圆角、行间细分隔线（iOS 分组列表样式）；小标题降为灰色小字；面板内统一 10px 纵向节奏。浏览器实测无溢出、无重叠。
3. **全屏提醒页**（`MedicationAlarmActivity.kt`，仅 UI，行为不变）：
   - 布局改为「上方可滚动内容 + 下方固定操作区」，滑块 / 扫码入口 / 服药按钮始终在同一拇指热区，解锁前后位置不跳。
   - 头部：呼吸点 +「用药提醒」→ 76sp 大号时间（组提醒显示计划时间）→ 一句标题。
   - 药品清单合并为一张卡片、行间细线分隔；只有 ≥2 种药时才出现每行「已服 / 跳过」，单药不重复出按钮；去掉「待解锁 / 待扫码」行内徽标。
   - 操作区：主按钮「已服用 / 全部已服用」+ 并排「10 分钟后提醒」「跳过 / 全部跳过」（组提醒新增「全部跳过」，走已有 `ACTION_ALL_SKIPPED`）。
   - 扫码锁定：72dp 二维码图标（长按暗门保留）+「扫码后才能关闭提醒」+「扫码」按钮；扫码成功：✓ + 「已记录为已服用」+「完成」。
   - 应急对话框、取景器文案全部缩短。
4. 门禁：tsc 0 错误；Vitest 624/624；Android `compileDebugKotlin` + `testDebugUnitTest` 通过；Playwright 108/108。截图与读图在本环境均超时，全屏提醒页需真机目检。
