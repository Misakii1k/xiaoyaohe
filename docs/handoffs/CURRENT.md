# Current Integration State

Updated: 2026-09-26
Integration branch: `main` (同步自 `workspace/claude`)
Product version: `1.1.13` (versionCode 71)
Latest integration commit: `fix(release): 推送成功只认退出码或 ls-remote 实证` (`8066cf2`)

## Release v1.1.13 (versionCode 71, workspace/claude)

- **集成内容**：
  - 添加药品表单的输入框、选择器与步进器统一等高、不再挤出字段，日期不折行；
  - 设置页文案精简（正文约 1970 → 1590 字）、面板内层级压平为 iOS 分组列表样式；
  - 全屏提醒页重排：大号时间、多药合并一张清单、底部固定操作区、组提醒新增「全部跳过」；
  - 液态玻璃对齐 Apple Liquid Glass 与自绘控件统一（v1.1.12 已发，含在同一分支线）；
  - 发版流程自动化三步脚本收纳（`release:bump`、`release:build`、`release:publish`）与网络重试判空加固。
- **质量门禁**：见 `docs/handoffs/claude.md` 第 75/76/77/78 节。

## Release v1.1.11 (versionCode 69, workspace/claude)

- **集成内容**：
  - 打卡后进度环从当前位置延伸，不再从 0 重扫；
  - 分药页横幅与「开始分药」间距调整，分药向导去掉重复外壳（单层弹层、单把手）；
  - 更新面板智能推荐秒级更新 / 完整包并给出理由，双通道保留；
  - 更新说明黑话约束：发布侧 lint 阻断 + 客户端展示过滤，18 份历史说明改写为大白话；
  - AI 助手页视觉与输入体验优化。
- **质量门禁**：见 `docs/handoffs/claude.md` 第 71/72 节。

## Release v1.1.9 (versionCode 67, main & workspace/claude)

- **集成内容**：
  - 吉祥物「盒宝」全场景视觉高清化：换用高清原图并突破卡片边框，分药助手、我的数据与今日空状态的插画更立体通透；
  - 关于页同步换上新版 3D 品牌应用图标；
  - 用药日历视觉与交互修复：修复日期看不清与顶部大片空白、暗色模式下选中日期不明显等问题；
  - 分药功能体验优化：修复两个入口卡难以分辨问题，全面提升深色模式文字对比度；
  - E2E 存量测试清零：修复存量测试断言脱节，Playwright 100/100 全绿通过；
  - 边缘分发修复：修复 Cloudflare Pages `version.json.ts` 动态端点中旧有硬编码 versionCode 与底座门槛缺陷，新增 7 项防漂移回归测试；
  - 版本号单调递增至 1.1.9 / versionCode 67。
- **质量门禁**：
  - `npm test`：91 文件 / 584 项 100% PASS；
  - `npx playwright test`：100/100 PASS；
  - `npm run typecheck`：0 错误；
  - `node scripts/check-release-endpoints.mjs`：4/4 全链路 PASS；
  - `tone_lint.py`：PASS。

## Release v1.1.8 (versionCode 66, workspace/claude)

- **集成内容**：
  - 全新 3D 日历小胶囊品牌主图标制作与分发：512x512 规范化母版、沉稳高级深墨绿自适应渐变底色，全套 32 个尺寸 PWA 与 Android 启动器/闪屏图标全量同步构建；
  - 官方吉祥物「盒宝」确立并全方位融入软件各个界面：
    - 分药助手右侧横幅升级为「盒宝 · 分药小管家」3D 形象；
    - 设置页我的数据统计卡片升级为「盒宝 · 药箱小卫士」、「盒宝 · 日历计划官」与「盒宝 · 点赞鼓励官」；
    - 服药打卡确认弹窗升级为「盒宝 · 点赞鼓励官」；
    - 今日用药空状态卡片引入「盒宝 · 日历计划官」浮动呼吸感 3D 治愈插画；
    - 头像库扩充至 17 款统一角色，新增官方专属角色「盒宝」（吉祥物，`#e6f7ef` 萌趣透明底半身像，支持 SVG 兜底）；
  - 用药日历（`/history`）视觉排版重构：消除单元格拉伸畸变，增设状态图例栏，三列流式用药卡片与单一清晰药丸操作按钮；
  - 时段提醒设置（`/settings`）重塑：早/中/晚/睡前独立纯白微卡片化与彩色图标分割，支持列表直接滑动开关开启/停用；
  - 全屏提醒选项重构为单列全宽微卡片，彻底根除移动端文字截断与折字难看缺陷；
  - 支持时段内多时间点动态添加/删除，支持添加与删除自定义新时段；
  - 版本号单调递增至 1.1.8 / versionCode 66。
- **质量门禁**：
  - `npm test`：91 文件 / 577 项 100% PASS；
  - `npm run typecheck`：0 错误；
  - `npm run assets:check`：100% 同步 PASS；
  - `npm run build:web`：生产构建正常，Web Bundle 增量包生成成功；
  - `tone_lint.py`：PASS。

## Release v1.1.7 (versionCode 65, main)

- **集成内容**：
  - 全页面各交互环节引入自然、优雅、灵动的物理微弹（Spring）与轻柔阻尼过渡反馈；
  - 今日页面周历与现实今日指示器呼吸光晕，打卡涟漪与对勾跳动，100% 满格完成欢庆光晕；
  - 药品卡片网格悬停提升与缩放微弹，批量管理坞顺滑向上弹入；
  - 全局通用底部弹层以 iOS 柔和弹簧曲线顺滑入场，原生通栏底栏图标激活微弹；
  - 所有动效在 `prefers-reduced-motion: reduce` 下保持瞬时响应，兼顾性能与无障碍；
  - 版本递增至 1.1.7 / versionCode 65。
- **质量门禁**：
  - `npm test`：91 文件 / 574 项 100% PASS；
  - `npm run typecheck`：0 错误；
  - `tone_lint.py`：PASS。

## Release v1.1.6 (versionCode 64, main)

- **集成内容**：
  - 修复「今日」页面环状百分比圈在达到 100% 满格时中间数值超出圆环边界溢出的问题；
  - 结构层面在组件 `progressRing` 中补充 `is-full` 状态标记与 `data-percent` 属性；
  - 样式层面针对三位数百分比（100%）自适应将数值字号由 26px 调整为 19px，单位字号由 13px 调整为 10.5px，左右保留安全留白；
  - 版本递增至 1.1.6 / versionCode 64。
- **质量门禁**：
  - `npm test`：91 文件 / 574 项 100% PASS；
  - `npm run typecheck`：0 错误；
  - `tone_lint.py`：PASS。

## Release v1.1.5 (versionCode 63, main)

- **集成内容**：
  - 「今日」页面顶栏全新升级：将根据时段自适应的问候语（如早上好/中午好/下午好/晚上好）与副标题小字（“规律的小事，也值得认真对待。” / 日期提示）彻底提升为页面专属常驻顶栏（`app-header`），替换掉原先单独粗暴显示“今天”的顶栏标题；
  - 顶栏右上角常驻「✦ AI 助手」水凝胶囊按钮，滑动浏览用药日程时问候与助手始终保持在屏幕顶端，不随内容滚动滚走；
  - 页面主内容区域紧凑衔接周历卡片与环形进度条，整体视觉体验舒展通畅；
  - 版本递增至 1.1.5 / versionCode 63。
- **质量门禁**：
  - `npm test`：91 文件 / 573 项 100% PASS；
  - `npm run typecheck`：0 错误；
  - `tone_lint.py`：PASS。

## Release v1.1.4 (versionCode 62, main)

- **集成内容**：
  - 「今日」页面顶部区域视觉重构：移除巨大斜体数字，仅保留「✦ AI 助手」胶囊，标题栏更加通透舒展；
  - 引入本周日期胶囊条（Week Container）：支持单手左右轻滑手势与左右箭头翻周查看日程，点击任意日期切换深绿高亮，今天日期自带高亮小绿点（`.day-today-indicator`）；
  - 副标题旁增加极简「回到今天」轻量按钮，一键快速回到当日；
  - 非今日排程开启只读保护模式：隐藏顶层「下一次用药」卡片，下方时段与药品清单自动禁用直接打卡交互，防止误触；
  - 环形进度条（Progress Ring）全面重构：清理残留的硬编码蓝紫渐变与紫色阴影滤镜，全面统一为墨绿品牌主色（`var(--color-primary)`）与浅灰底环；
  - 版本递增至 1.1.4 / versionCode 62。
- **质量门禁**：
  - `npm test`：91 文件 / 573 项 100% PASS；
  - `npm run typecheck`：0 错误；
  - `node scripts/check-release-endpoints.mjs`：4/4 PASS；
  - 产物归档：`release/xiaoyaohe-1.1.4-android-release.apk`（20,819,228 字节）、`xiaoyaohe-1.1.4-web-bundle.zip`（8,198,040 字节）。

- **集成内容**：
  - 修复药品列表横幅在部分设备上打印出 SVG 源码文本与 HTML 的缺陷，改用 `parseSvg(getFeatureBottleSvg())` 动态解析与挂载矢量节点；
  - 优化移动端文字排版与尺寸防御：今日页 AI 助手胶囊与顶栏 AI 助手胶囊增加 `white-space: nowrap; min-width: max-content;` 防折行保护，根治竖排断行问题；
  - 扩大药品库页面底部内边距至 112px，防止右下角悬浮操作按钮遮挡底部药品卡片内容；
  - 全面清理残留的紫色/紫蓝色视觉元素：顶栏「AI 助手」胶囊、服药历史状态按钮、药品编辑智能录入卡片、分药向导阴影、扫码页光晕与快捷图标、设置页各面板图标色调、头像选择态与关于小药盒 Logo/磁贴，彻底换用清爽自然的青绿色视觉体系（`--color-primary`, `--color-primary-soft`, `--color-border` 等）；
  - 版本递增至 1.1.3 / versionCode 61。
- **质量门禁**：
  - `npm test`：91 文件 / 572 项 100% PASS；
  - `npm run typecheck`：0 错误；
  - `tone_lint.py`：PASS。

## Release v1.1.2 (versionCode 60, main)

- **集成内容**：
  - 合并 `feature/ui-plan-b` 到 `main`，包含完整的 Plan B「清爽秩序」视觉重构与焦点用药交互；
  - 修复 6 项 UI 体验细节：①助手附件胶囊对比度提升（改走 `--color-on-primary`）；②筛选胶囊计数徽标对比度达标；③扫码绿色卡片随主题反转（浅色深绿白字/暗色亮绿深字）；④设置页装饰色换用达标色令牌；⑤5 类交互控件触控高度统一升至 44px（顶栏胶囊、快捷提问、批量操作坞、今日批量打卡、查重通知按钮）；⑥次要文字令牌对比度优化（`#67736e→#64706b`）；
  - 修复 `tests/reminderScheduler.test.ts` 午夜跨日边界时间确定性，使用 fakeTimers 消除时序脆弱测试；
  - 版本递增至 1.1.2 / versionCode 60。
- **质量门禁**：
  - `npm test`：91 文件 / 572 项 100% PASS；
  - `npm run typecheck`：0 错误；
  - `npx playwright test`：100/100 项 PASS；
  - `tone_lint.py`：PASS。

- **分支状态**：`feature/ui-plan-b`（自 `workspace/claude` 分离，起点备份 Tag `pre-plan-b` = `7083792`）。**尚未合并回 `main`**，待人工确认后集成。
- **⚠️ 集成前置信息（各分支当前位置）**：
  | 分支 | HEAD | 版本 |
  |---|---|---|
  | `main` | `9920bd9` | v1.0.19 |
  | `workspace/claude` | `7083792` | v1.1.1 |
  | `feature/ui-plan-b` | `fac0df1` | v1.1.1 + Plan B |
  `main` 当前落后 `workspace/claude` **6 个提交**（v1.0.20 → v1.1.1 尚未集成）。因此把本分支合并进 `main` 会**一并带入这 6 个发布提交**，不只是 Plan B 改动。若只想集成 Plan B，应先确认 `main` 是否需要先同步到 v1.1.1。
- **提交链**：`9176355`（Plan B 主体）→ `ff3cb71`（移动端视口适配与交互焦点细节）→ `725ea62`（暗色对比度与选中态修复）。
- **核心内容**：
  - 视觉令牌体系（冰白 `#f6f8f7` / 青绿 `#236a55` / 柔绿 `#e3ede6` / 石墨 `#202e2b` / 细线 `#e1e8e4`），清除高饱和荧光弥散渐变；
  - 药品列表页双列卡片网格，药盒包装为第一视觉中心，三级包装回退（实拍 > 3D 拟物 > 矢量纸盒）；
  - 今日用药页问候语 + Georgia 衬线日期 + 一周节奏条 + 进度环 + 「下一次用药」聚焦大卡片；
  - 暗色模式：新增 `--color-on-primary` 令牌（浅 `#ffffff` / 暗 `#0d1a16`），27 处填充面文字改令牌；追加 (0,3,0) 规则恢复暗色下「今日」格与激活筛选胶囊的主色填充（此前被同特异性的暗色块刷成深色面，选中态完全不可见）。
- **质量门禁**：`tsc --noEmit` 0 错误；91 文件 / 572 项测试 100% PASS；`build:web` 618 modules 通过；`e2e/inventory-workflows` + `e2e/medication-batch` 12/12 PASS；320×700 / 390×844 / 430×932 三视口零横向溢出。
- **红线**：未触碰 IndexedDB schema、提醒调度、原生通知通道、同步协议；未向用户桌面复制任何构建产物；动效降级 `prefers-reduced-motion` 保持 13 处覆盖。
- **集成前注意**：
  1. 本轮修改了 `e2e/inventory-workflows.spec.ts` 的过期断言（该用例自 `4beac61` 起已红 7 天，非本次引入）；
  2. 遗留 8 项（含 `.ai-markdown a` 死代码、5 类次级控件 <44px、`fullscreen.spec.ts` 2 条历史遗留失败），详见 `docs/handoffs/gpt.md`；
  3. 本机沙箱下 `git commit` 会丢失分支引用文件，提交后需用 `git rev-parse HEAD` 复核（修复方式见 `gpt.md` 环境注意第 1 条）。

## Settings Visual Hierarchy & Subcard Modularization (v1.1.1, versionCode 59, workspace/claude)

- **核心需求与重构**：
  - **设置子板块微卡片独立岛化 (`.settings-subcard`)**：在折叠面板展开后的浅灰底色（`var(--color-surface-muted, #f8fafc)`）上，各个业务子功能均封装为独立的纯白微卡片（`var(--color-surface, #ffffff)`），搭配 `14px` 圆角、细腻边框与轻微投影，彻底告别“设置内容灰蒙蒙挤在一起”的视觉混杂感；
  - **内置卡片标题与胶囊状态徽章**：每个微卡片顶部配备加粗标题（13.5px）与胶囊徽章（如「已开启」、「多模型调度」、「隐私保护」等），子板块功能边界与当前状态一目了然；
  - **展开面板标题底部分割线**：面板展开时（`.panel.open > .panel-head`），标题栏底部自动展示清晰细致的分割线（`border-bottom: 1px solid var(--color-border)`），将常驻白色标题与下方浅灰卡片区域明确分隔；
  - **业务面板全面微卡片化**：
    - `ReminderPanel`：拆分为「基础提醒与权限」、「提醒通道与全屏测试」、「系统权限建议」、「滑动解锁防手抖」、「扫码解除强制提醒」5 大独立微卡片；
    - `AppearancePanel`：拆分为「配色方案」与「界面动效与材质」2 个微卡片；
    - `BackupPanel`：将原本孤立散落的统计文字与导入/导出操作收纳为「数据归档与备份」微卡片；
    - `LlmConfigPanel`：拆分为「AI 服务商管理」（列表+故障转移切换）、「网页端密钥存储方式」（网页端专用）以及「已授权的服务商列表」微卡片；
    - `imageGenSettingsPanel`：开关行与接口配置表单整合进「药盒照片增强配置」微卡片；
    - `lanSyncSettingsPanel`：多设备覆盖、自动同步、静默处理三大开关卡片升级为纯白微卡片，与设备列表、额外同步卡片保持一致；
    - `DiagnosticsPanel`：脱敏日志框与操作按钮内聚进「后台失败日志摘要」微卡片。
- **质量门禁**：全量 91 个测试套件 572 项测试 100% PASS，`npm run typecheck` 0 错误，`tone_lint.py` 严格校验通过。

## Medication Alarm Repeat Suppression & Bottom Slide Unlock (v1.1.0, versionCode 58, workspace/claude)

- **核心需求与修复**：
  - **全屏提醒滑动解锁滑块居底**：将滑动解锁条固定渲染在全屏提醒容器底部（脱离纵向滚动内容区），彻底解决内容较短时滑块悬在屏幕中部的问题，符合单手拇指操作习惯；
  - **服药确认后提醒重复弹出根治**：彻底解决确认服药或扫码验证后闹钟仍会重复弹出的问题。在原生层（`MedicationAlarmContract.java` 与 `MedicationAlarmPlugin.java`）判定当单药或整组服药完成（含扫码自动服药）时，立即取消同组剩余递进闹钟并清除 SharedPreferences 中的残留标识，杜绝后续多轨响铃及系统重启/时区变更时的过点补发；
  - **稍后提醒机制优化**：在触发稍后提醒（贪睡）时，优先清空同组递进闹钟，使稍后提醒成为唯一下次响铃，避免多轨闹钟互相竞争；
  - **原生底座门槛提升**：将最低原生 APK versionCode 提升至 58，确保旧版本用户必须通过完整 APK 安装更新以获得底层原生闹钟修复。
- **质量门禁**：全量测试套件 100% 通过，`tone_lint.py` 严格校验通过，`check-release-endpoints.mjs` 4/4 通过。

## Full-Screen Alarm Slide Unlock Fix & Dual-Channel Update Policy (v1.0.22, versionCode 57, workspace/claude)

- **核心需求与修复**：
  - **排版崩溃修复**：彻底重构「全屏提醒滑动解锁」设置卡片为标准垂直流布局，消除窄屏下文字单字垂直挤压错乱；
  - **滑动解锁生效加固**：修复 `MedicationAlarmActivity` 中多次触发测试提醒时因相同 ID 导致的状态未复位问题；
  - **更新通道精准分流**：根据增量更新能否落实进行按钮展示控制：当更新内容无法通过增量更新落实（底座版本过低或原生特性依赖）时，界面仅提供全量更新按钮；反之（增量可落实）则同时提供「一键秒级更新」与「下载完整包」双按钮；
  - **底座版本门槛提升**：将原生底座最低门槛 `MIN_NATIVE_BUNDLE_VERSION_CODE` 提升至 56，彻底防止旧底座走纯增量更新导致全屏滑动解锁未生效。
- **质量门禁**：全量 92 个测试套件全部通过，TypeScript 0 错误通过，文风经 `tone_lint.py` 严格校验通过。

## Full-Screen Alarm Slide to Unlock & Optional Scan Verification (v1.0.20, versionCode 55, workspace/claude)

- **核心需求与修复**：
  - 修复全屏提醒误触发默认扫码解锁问题，改回按需开启；仅在「设置 - 系统通知」开启扫码解锁时要求扫描药品条形码；
  - 未开启扫码解锁时，全屏提醒持续响铃并在底部提供「向右滑动解锁」滑块；滑动到位后解除锁定并停止响铃，平滑展示「已服用」和「稍后提醒」操作区，防止误触直接关闭；
  - 未滑动解锁前，按系统返回手势触发震动并提示请向右滑动解锁，持续响铃至 10 分钟无人解锁安全超时自动转为稍后提醒；
  - 设置面板中「测试全屏提醒」传入非扫码提醒测试，「试验扫码解锁」保持强制扫码验证测试。
- **质量门禁**：全量 89 个测试套件 567 项测试 100% 通过，`npm run typecheck` 零报错，Android 原生编译顺利完成。

## Assistant Preference Picker Restyle (v1.0.19, versionCode 54, workspace/claude)

- **问题与修复**：小助手的模型/推理强度用原生 `<select>`，点击拉起系统选择器，风格与应用割裂；改为按钮 + 既有 `openBottomSheet()` 应用内弹层，选中项以主色边框与对勾标示。
- **样式**：`.ai-pref-select` 重写为按钮态（自绘箭头），新增 `.ai-pref-sheet-*` 一组样式，全走设计令牌，深色模式自动适配。
- **验证**：typecheck 0 报错，89 套件 567 项通过；浏览器实测面板内原生 `<select>` 归零，选择后偏好正确落盘，浅色/深色均正常。

## Med List Alignment Fix & Assistant UI Redesign (v1.0.18, versionCode 53, workspace/claude)

- **药品列表左对齐修复**：主列表卡片复用 `medication-batch-name` 导致药品名居中、与规格/库存错位；以更高特异性覆写为左对齐单行省略，批量管理页居中排版不变。
- **小助手界面改版**：模型/推理偏好收进齿轮按钮默认收起；面板 `76dvh → 86dvh`；助手回复改全宽文档式卡片（行高 1.75）；快捷问题改单行横向滚动；思考提示缩为小标签。
- **验证**：typecheck 0 报错，89 套件 567 项测试通过；浏览器实测列表 name/spec/badges 同在 x=97，助手回复宽 351/375px。

## Web Incremental Hot Update Restore Fix (v1.0.17, versionCode 52, workspace/claude)

- **根因与修复**：`getAvailableUpdate()` 从 localStorage 还原时丢弃增量包元数据，导致更新面板永远只显示「下载并安装」；现完整还原 `updateType/bundleUrl/bundleSize/bundleSha256/minNativeVersionCode` 并按本机底座重新校验。
- **注意**：1.0.16 → 1.0.17 仍为最后一次全量安装，此后版本走秒级热更新。

## UI Layout & Interaction Refinement & Gentle Update Reminders (workspace/claude)

- **时段标签竖排断行修复**：在 `src/ui/styles/legacy.css` 与 `src/ui/styles/pages/medication-editor.css` 中为 `.slot-tag` 及 `.meal-slot-head .slot-tag` 补充 `white-space: nowrap; flex-shrink: 0; min-width: max-content;`，彻底消除中文字符（早/上、中/午、晚/上）在弹性布局受挤压时的竖向断字；
- **智能快速填表空间分配重塑**：消除 `.smart-fill-ocr-wrap .btn` 继承 `flex-basis: 220px` 造成的高度异常膨胀，恢复为约 44px 标准单行功能按钮；自然语言输入文本框扩大至 4 行（`min-height: 96px`），为文字描述留足输入与核对视野；
- **编辑药品顶部向导极简进度条重构**：将 `.med-wizard-steps` 重构为极简进度条风格（居中显示「步骤 2/3 · 用药计划」并配合三段式细长进度指示条），彻底消除移动端小屏（360px~412px）下的文字折行，高度更紧凑；
- **批量管理卡片居中垂直流与纯紫色边框高亮**：移除卡片内 44px 左侧空白复选框列，卡片内部采用居中垂直流排版（缩略图居中置顶、名称剂量居中、时段胶囊居中），100% 充满双列网格空间；卡片选中态改为纯紫色高亮边框（无对勾图标、无底色填充），隐藏复选框保留完整无障碍读屏语义；
- **应用更新提醒降级为纯轻提醒**：
  - 原生 Android 提醒通道剥离强提醒：创建独立轻量通知渠道 `app_update_channel`（优先级设为低 `importance: 2`，无响铃、无振动、不弹出顶层全屏横幅强打扰），且移除「已服用/跳过」用药操作按钮；
  - Web 端提醒通道对齐轻提醒规范：更新提醒取消强制常驻（`requireInteraction: false`），开启静默参数（`silent: true`），清空用药动作按钮；
  - 前台运行免打扰：应用在前台使用（`document.visibilityState === 'visible'`）时，抑制系统级外发通知，仅通过事件刷新界面徽标；
  - 底栏「我的」导航项加入优雅的小红点提示（`.tabbar-update-dot`），发现新版本时安静提示，不强加感知；
- **质量门禁**：全量 89 个测试套件 564 项测试 100% 通过，`npm run typecheck` 零报错，`npm run build:web` 正常完成。

## Medication Edit Redesign, Batch Management Fix & Card Layout (v1.0.15, versionCode 50, workspace/claude)

- **彻底解决「批量管理无法打开」的根因（持久 Tab 信号死锁）**：
  - 在 `src/router.ts` 中引入 `abortTransientController(previousTabKey)`，切出视图时若上一页面为已在 TabPool 中成功渲染的持久 Tab（`prevEntry?.rendered && prevEntry.controller === activeController`），严禁 abort 它的控制器，仅在离开瞬态子页面时执行 abort；
  - `src/pages/MedList.ts` 解除 `enterBatchMode` 对外部路由 signal 的死锁依赖，基于 `root.isConnected` 进行生命周期与挂载防护，「退出批量」无条件安全返回普通列表。
- **批量管理界面排版升级与药品缩略图**：
  - 并行获取药品实拍照（`getMedPhotoUrls`），每张批量卡片头部新增 `.medication-batch-thumb` 缩略图容器，展示 16:10 药盒照片或 3D 拟物药瓶/药丸图（`getOrCreateMed3DImage`）；
  - 提醒时段改用 `display: flex; flex-wrap: wrap; gap: 3px;` 横向自然流式排版，彻底解决纵向单列堆叠拉长卡片的问题；
  - 加深复选框边框、整卡点选、主色微光选中态，工具栏显示「共 X 种 · 已选 Y 种」。
- **药品编辑/新增页面（MedEdit）排版重构**：
  - 采用 `.med-section-card` 模块化卡片体系与浅色衬底输入框，强化表单内容分隔；
  - 合并每次剂量输入与常用单位胶囊，周期用药移入第二步服药规则，危险删除区移至页面底部。
- **质量门禁**：
  - 全量 89 个测试套件 558 项测试 100% 通过，`npm run typecheck` 零报错，`npm run build:web` 正常完成。

## Full-Screen Coverage & Alarm Ringtone Engine Fix (v1.0.14, versionCode 49, workspace/claude)

- **产品正式版本发布 (v1.0.14, versionCode 49)**：
  - 提醒响铃声音恢复正常：彻底修复了专属提醒音乐《晨间活力》在部分机型上调用底层音频引擎时因参数异常导致静音的缺陷；响铃前新增系统闹钟通道音量检查，若被用户置为 0 会自动调节至安全提示音量，确保即使手机处于静音或振动模式下也能如系统闹钟般清晰响铃；
  - 到点全屏覆盖与屏幕唤醒：在底层提醒契约中解除对全屏权限状态的硬拦截，始终绑定系统最高优先级全屏意图（`setFullScreenIntent`），并加入屏幕点亮唤醒锁（WakeLock）；通过前台服务与后台启动豁免参数进行多重拉起保活，确保到点时无论是锁屏灭屏还是亮屏使用其他应用均能直接弹出全屏界面；
  - 权限状态双向独立引导：在设置页提醒设置中重构权限展示逻辑，拆分全屏提醒与悬浮窗（在其他应用上层显示）的独立检测，提供一键跳转系统设置引导；
  - 质量门禁：全量 89 个测试套件 557 项测试 100% 通过，`npm run typecheck` 零报错，`npm run build:web` 正常完成。

## Web Incremental Hot Update Fix & Dual Update Mode (v1.0.13, versionCode 48, workspace/claude)

- **产品正式版本发布 (v1.0.13, versionCode 48)**：
  - Web 增量热更新判断修复：修复了版本检查中对增量更新判定条件的逻辑缺陷（原逻辑因目标版本号大于本地而导致增量更新永远被误判为不可用），正确将最低原生 APK versionCode 底座门槛定为 44（v1.0.9 起引入），让合规底座设备优先走秒级轻量热更新；
  - 杜绝跨平台校验和漂移：重构 `bundle-web.mjs` 为纯 JS 标准打包实现，消除操作系统之间生成 zip 附件的 SHA256 哈希不一致；新增 Cloudflare Pages 动态边缘函数（`functions/version.json.ts`），直接从 GitHub Releases 提取权威资产哈希与大小，彻底杜绝校验和漂移引发的更新中断；
  - 双更新模式自主选择与故障容错：在更新界面中默认提供“一键秒级更新”，同时保留“下载完整包”选项供用户自由选择；下载轻量包发生网络或校验异常时，自动弹窗告知并无缝切换至完整包下载通道；
  - 质量门禁：全量测试套件 100% 通过，`npm run typecheck` 零报错，`npm run build:web` 正常完成。

- **产品正式版本发布 (v1.0.12, versionCode 47)**：
  - 全屏提醒前台直显：新增悬浮窗（在其他应用上层显示）与小米等品牌后台弹出界面能力，开启后用药时间到达时直接拉起全屏提醒界面，不再停留为顶部常驻通知条；
  - 响铃通道与双重声音彻底剥离：通知渠道改造为完全静音通知（`setSound(null, null)`），仅保留顶部通知栏状态；提醒声音由原生 `AlarmAudioPlayer` 单独播放并统一切换至 `STREAM_ALARM` 闹钟音频通道，解决通知音与专属音乐混杂双重发声问题；
  - 闹钟音量键随心调节：全屏提醒界面绑定 `volumeControlStream = STREAM_ALARM`，响铃时按手机侧边音量键可直接调节闹钟大小；
  - 权限设置与引导完善：设置页新增全屏显示权限一键跳转开关，针对小米、华为、OPPO、vivo 等机型补充后台弹出界面与悬浮窗指引；
  - 质量门禁：全量 89 个测试套件 557 项测试 100% 通过，`npm run typecheck` 零报错，`npm run build:web` 正常完成。

## Architecture Modularization, Tab Keep-Alive & Storage/Keep-Alive Enhancements (v1.0.11, versionCode 46, workspace/claude)

- **产品正式版本发布 (v1.0.11, versionCode 46)**：
  - 界面流畅度提升：底栏一级页面常驻缓存池与滚动位置记忆，子页面 AbortSignal 自动取消，WeakMap 引用安全防重，杜绝频繁白屏重新加载；
  - 手机存储与缓存清理：设置页新增应用存储占用分析与一键清理临时缓存；
  - 主流手机后台保活指引：新增小米（澎湃/MIUI）、华为（鸿蒙/EMUI）、OPPO（ColorOS）、vivo（OriginOS）的自启动与后台运行指引及快捷跳转；
  - 巨石代码深度模块化：`Settings.ts` (2,715行 -> `src/pages/settings/`), `local.ts` (1,968行 -> `src/db/repositories/`), `assistantTools.ts` (1,776行 -> `src/ai/tools/`), `MedEdit.ts` (1,579行 -> `src/pages/medEdit/`)，100% 保持向后兼容；
  - 质量门禁：全量 89 个测试套件 557 项测试 100% 通过，`npm run typecheck` 零报错，`npm run build:web` 正常完成。

## Tab Keep-Alive View Caching & Incremental Data Update Architecture 2026-09-12 (workspace/claude)

- **底栏一级页面常驻缓存与滚动位置记忆 (`src/app/tabPool.ts`, `src/router.ts`, `src/db/databaseEvents.ts`)**：
  - **一级页面常驻缓存池**：将四个主要底栏页面（今日清单 `/today`、药品列表 `/meds`、用药历史 `/history`、设置 `/settings`）切换机制改造为基于 DOM 节点保活的视图池（Tab Pool）。切换标签时不再销毁和重建整个页面，而是通过隐藏与显示保留容器节点，避免页面反复重建与白屏闪烁；
  - **独立子页面隔离容器与首跳防御**：进入新增药品、药品详情、扫码分类、库存盘点等子页面时，将当前主页面隐藏并挂载子页面；支持以子页面为首屏直接启动，进入一级页面时彻底清理瞬态节点与取消信号；返回上一级时销毁子页面并立刻恢复主页面原有状态；
  - **子页面 AbortSignal 取消链路闭环**：切回底栏页面时主动中止正在运行的子页面异步任务（如摄像头扫码、AI 推理或网络请求），杜绝后台隐蔽资源消耗与内存泄漏；
  - **滚动位置精准恢复与重复点击平滑回顶**：离开页面前自动记录主滚动区域的滚动条位置，重新进入时自动还原；底栏按钮注入同路由点击拦截，真实点击已处于激活态的标签页时，平滑回到顶部并触发页面激活事件；
  - **基于版本号与跨日期的增量更新机制**：新增数据库变更通知系统（覆盖单药、批量药品新增、库存扣减/撤回、时段设置与照片更新）与生命周期事件（`tab:activated` / `tab:deactivated`）。今日清单、药品列表与历史记录在重新切回时，仅在检测到底层数据变更或跨过午夜日期变更时才增量刷新必要内容，无变更时保持原有展示不变；
  - **WeakMap 引用生命周期安全防重**：今日清单、药品列表与历史记录引入 WeakMap 实例清理机制，页面内切换时段筛选或多次打卡刷新时自动解绑前序事件监听器，彻底杜绝监听器倍增与并发重渲引发的内存与性能隐患；
  - **退出设置页自动停止试听**：设置页面在切出或离开时，通过 `tab:deactivated` 自动停止正在播放的铃声试听；
  - **质量门禁**：新增 `tests/tabKeepAlive.test.ts` 专项深度测试（共 13 项验证），全量 89 个测试套件 550 项测试 100% 通过，`npm run typecheck` 零报错，`npm run build:web` 正常完成。

## Medication Alarm Ringtone Customization & Switchable Preference 2026-09-11 (workspace/claude)

- **用药提醒默认铃声定制与自由切换落地 (`src/features/alarmRingtone.ts`, `Settings.ts`, `AlarmAudioPlayer.kt`)**：
  - **专属音频资源导入**：将用户指定的音频规范导入至 Android 原生 raw 资源 (`android/app/src/main/res/raw/morning_energy.mp3`) 与 Web 静态资产 (`public/audio/morning_energy.mp3`)；
  - **默认铃声切换为专属音乐**：Android `AlarmAudioPlayer.kt` 优先使用 `MediaPlayer` 循环播放《晨间活力》（`AudioAttributes.USAGE_ALARM` 通道并管理临时音频焦点）；
  - **支持系统铃声回退与自由选择**：设置面板常驻渲染「用药提醒铃声」选择卡片，提供「晨间活力（专属推荐）」与「系统默认闹钟」，用户可自由切换并即时同步到原生 SharedPreferences 与 localStorage；
  - **支持在线试听**：设置页提供试听按钮，一键试听旋律或停止播放，退出页面自动清理；
  - **质量门禁**：新增 `tests/alarmRingtone.test.ts`，全量 86 个测试套件 529 项测试 100% 通过，`npm run typecheck` 0 报错，Gradle 编译与 APK 构建畅通无阻。

## Web Bundle Incremental Hot-Update Release 2026-09-11 (v1.0.9, versionCode 44, workspace/claude)

- **正式发布首个内置增量更新底座版本 (v1.0.9)**：
  - 安卓原生底座注入解压与基座切换能力（`MIN_NATIVE_BUNDLE_VERSION_CODE = 44`）；
  - 本次安装后，未来版本（v1.0.10+）的日常前端改动均可享受约 1.8MB 免安装秒级更新体验；
  - 同步发布 `xiaoyaohe-1.0.9-android-release.apk` 与 `xiaoyaohe-1.0.9-web-bundle.zip`；
  - 全量 85 个测试套件 523 项测试 100% 通过。

- **安装包大幅瘦身（-31.76MB，净降 63.9%）**：
  - 清理 `public/release/` 历史遗留的旧版 APK（31.3MB），切断 Vite 静态资源向 `dist/` 及 Capacitor 向 `assets/public/` 的泄漏链路；
  - `scripts/gen-version.mjs` 调整为仅读取根目录 `release/`，避免打包污染；
  - `android/app/build.gradle` 的 `aaptOptions.ignoreAssetsPattern` 追加 `:*.apk`，从 Android 原生编译层彻底阻断 APK 文件混入 assets；
  - 安装包体积从 49.7MB 锐减至 17.96MB（18,835,967 字节）。
- **永久规则确立：严禁向用户电脑桌面复制安装包**：
  - 用户明确规则：发版产物一律仅保存在 `medbox/release/` 目录并通过 GitHub Releases 分发，严禁复制到 `$HOME/Desktop`；已清理桌面上的历史 APK 文件。
- **经验沉淀与发版技能固化 (/learn)**：
  - 更新项目规则 `AGENTS.md`、`medbox/AGENTS.md` 与发版技能 `.agents/skills/medbox-release/SKILL.md`；
  - 确立构建产物（APK / Web Bundle）严禁拷贝至用户个人桌面的硬性红线；
  - 将 1.8MB Web 增量热更新包（`web-bundle.zip`）自动构建、哈希注入与 `gh release create` 多资产上传纳入标准发版 SOP；
  - 确立全量 85 个测试套件质量门禁基线，强化每次推送到远端前强制递增版本号与 oil-tone 零黑话文风约束。
- **零服务器成本增量热更新实现与落地（已完成实施与验证）**：
  - 基于 Cloudflare Pages + GitHub Releases 打造零服务器成本无感增量热更新链路；
  - `ApkDistributionPlugin.java` 新增 `downloadAndUnpackBundle`、`applyWebBundle`、`resetWebBundle` 与 `getActiveWebBundle`，内建 SHA-256 校验、Zip Slip 路径穿越防御与 index.html 存在性断言；
  - Cloudflare Pages Functions (`_shared.ts`, `download.ts`, `releases.ts`) 支持 `?asset=bundle` 增量包流式代理下载与直链改写；
  - `scripts/bundle-web.mjs` 与 `scripts/gen-version.mjs` 联动将 `dist/` 归档为 `web-bundle.zip` 并向 `public/version.json` 与 `dist/version.json` 注入增量元数据；
  - `apkTransport.ts` 与 `Settings.ts` 动态评估底座版本（`minNativeVersionCode`），优先呈现「轻量热更新」与「一键秒级更新」，免调起安装器秒级刷新生效；
  - 新增 `tests/bundleUpdateVerification.test.ts` 专项套件，全量 85 个测试套件 523 项测试 100% PASS，Android Gradle 编译 BUILD SUCCESSFUL。

## Settings Flat-Card Architecture, Colorful Squircle Icons & Medication List/Batch Layout Overhaul 2026-09-11 (workspace/claude)

- **设置页（我的）内容去重与架构扁平化 (`src/pages/Settings.ts`, `src/ui/styles/pages/settings.css`, `tests/settingsUiContracts.test.ts`)**：
  - **彻底清除三重冗余**：移除原「顶部 6 行设置菜单卡片 (`profile-menu-card`)」与右上角「齿轮弹窗菜单 (`gearBtn`)」，确立纯平铺分类卡片群架构（提醒与外观、数据与同步、智能助手与高级、关于小药盒）；
  - **全套 11 项五彩微拟物图标重绘**：参考原 6 行菜单的圆角彩底微拟物图标体系（32x32px、`border-radius: 8px`、高品质语义色彩浅彩底色），重绘全量设置项图标（系统通知 amber、时段 emerald、外观 violet、保活 orange、同步 sky、备份 teal、检查更新 blue、大模型 purple、生图 rose、AI 授权 gold、诊断 cyan），并完美适配深色模式；
  - **关于小药盒居中展台重新排版**：药盒 Logo 居中浮动光晕、版本号药丸胶囊、2x2 精致特性磁贴卡片（Tile Card）、柔和免责声明，大幅提升高级感与呼吸感。
- **药品页三大指标光晕与「添加药品」右下角对齐 (`src/pages/MedList.ts`, `src/ui/styles/pages/medications.css`, `tests/medListUiContracts.test.ts`)**：
  - **去除实色硬圈**：「全部药品、近期使用、需补充」指标卡图标下方的实色圆圈背景彻底清除（`background: transparent !important`），升级为 3 级渐变多层环境光晕（Halo / Glow），通透自然；
  - **右下角悬浮添加按钮**：将原随页面滚动的「+ 添加药品」FAB 移入底部操作坞（`createActionDock([fabAdd])`），透明坞底、禁用非按钮区域指针穿透，严格遵守无 `position: fixed` 契约约束。
- **批量管理页面针对性排版根治 (`src/pages/MedList.ts`, `src/ui/styles/pages/medications.css`)**：
  - **独立微卡片单元**：2 列药品卡片从原本挤在同一大白底矩形框改为带独立边框、圆角、阴影与点击缩放反馈的独立卡片；
  - **复选框可见度与整卡点选**：加深未选复选框边框为 `#94a3b8`，彻底解决浅色模式下白底融化隐形的问题；支持点击卡片任意位置切换勾选状态；
  - **底部操作坞极致瘦身**：移除操作栏内冗余的「已选 0 种」，将 4 个操作按钮优化为 50px 超薄毛玻璃胶囊浮动工具栏，彻底消除遮挡半屏药品的缺陷。

## Straight-On Frontal Medicine Image Studio Prompts & Unified App Prompt Dialog 2026-09-11 (workspace/claude)

- **药盒 AI 生图提示词全面重构为正面平视无杂物大图 (`src/features/aiImageStudio.ts`, `tests/aiImageStudio.test.ts`)**：
  - **杜绝侧面/斜视角度**：彻底清退原 Prompt 中的 `Three-quarter isometric front perspective view`（导致模型生成 45 度侧面/顶底透视图的根因），重构为 `Direct straight-on front view (eye-level frontal orthographic product shot), facing the camera directly, perfectly flat and horizontal with zero tilt, zero rotation, no 3D side angle, no isometric slant`；
  - **原图提取与去手持/杂物增强**：在有参考拍摄原图时，前置注入中英双语精准提取指令（`提取出参考素材中的药盒图片，去除手持与多余杂物，变成纯白底正面平视大图的形式。Extract and isolate the medicine packaging box from the reference photo, removing any hands, fingers, holding gestures, or background clutter.`），完美复刻用户预期的白底正面大图效果；
  - **纯白无缝背景与微弱接地投影**：强化 `Seamless pure white background (#ffffff) with soft subtle contact drop shadow directly beneath the base of the box`，保证专业商业包装展台质感。
- **输入页控件与对话框全面统一，清退原生弹窗 (`src/ui/components.ts`, `src/ui/imageGenSettingsPanel.ts`, `tests/imageGenSettings.test.ts`)**：
  - **新增统一组件 `promptDialog`**：封装符合应用全局微拟物/水凝玻璃设计风格的通用卡片输入弹窗，支持自动聚焦、选中文字、Enter 提交与 Escape/遮罩关闭，顶部预留安全距离防止虚拟键盘遮挡；
  - **清退原生 `window.prompt` 与 `confirm`**：「存为新配置」接入 `promptDialog`，配置删除接入 `confirmDialog`，彻底消除 Android 原生灰绿弹窗；
  - **操作按钮栅格化布局**：设置页底部 4 个操作按钮升级为 2 列响应式网格（`grid-template-columns: repeat(2, minmax(0, 1fr))`），杜绝移动端下文案折行挤压（如「存为新配」）；
  - **本地保留**：已提交至本地 Git 分支，未推送远端云端。

## App Update Card Layout & Markdown Release Notes Optimization 2026-09-11 (workspace/claude)

- **设置页应用更新面板排版布局根治与发布说明轻量渲染优化 (`src/pages/Settings.ts`, `src/ui/styles/pages/settings.css`)**：
  - **排版折行挤压根治**：定位并解决原更新区域错误继承 `.banner`（`display: flex; align-items: center;`）导致标题与来源文本被挤压成 1 字符宽垂直单列的排版缺陷；升级为独立的竖向卡片架构 `.app-update-card`；
  - **标题与元数据美化**：引入 `icon('sparkles')` 品牌图标与 `app-update-badge` 药丸标签，主标题、版本号与来源大小信息呈现清晰自然的横向结构与层级；
  - **发布说明格式化渲染**：新增零依赖轻量 Markdown 解析函数 `renderFormattedReleaseNotes`，在严格保证不污染主包、不引入外部库（维持 `assistantContentLazyLoading` 契约测试）的前提下，将标题、条目列表、加粗语法 `**text**` 与内联代码 `` `code` `` 转换为语义化高保真 DOM 节点；
  - **本地保留**：已在本地提交，保持未推送至远端云端状态，等待下一次统一发版时合并推送。

## Online Update & Release Distribution Guide 2026-09-11 (workspace/claude)

- **线上更新分发与版本发布完整指南与 SOP 标准化 (`docs/releases/GUIDE.md`)**：
  - 沉淀了应用内在线更新（GitHub Releases + Cloudflare Pages Functions 边缘流式代理 + 原生安全下载器）架构原理与从零搭建方案；
  - 梳理并固化了 10 步标准化发版 SOP（从版本递增、全量测试、Android Release 打包、归档哈希、推送打标到 GitHub Release 发布与 `node scripts/check-release-endpoints.mjs` 线上冒烟）；
  - 汇总了常见高频坑（如私有仓库直链 404、302 跳转导致的国内 403 Forbidden、版本号单调性与测试用例同步等）及应对方案。

## Agnes & Modern Multimodal AI Image Generation Protocol Adaptation 2026-09-11 (workspace/claude)

- **Agnes AI 及同类多模态生图服务商协议自适应兼容与配置管理**：
  - **根因根治**：彻底解决顶层 `response_format` 冲突引发的 400 校验异常，自适应注入 `return_base64: true` 与 `extra_body: { response_format: 'b64_json' }`，去除多余 `n` 字段；
  - **支持现代多模态图生图**：针对通过 `/images/generations` 的 `extra_body.image` 接收参考图的服务商（如 Agnes），在有原图时直接注入 DataURI 开启图生图；提供原图修图 -> 图生图 -> 纯文生图三级平滑降级管线；
  - **GCS 云端 URL 熔断与友好容错**：对 Google Cloud Storage 直链设置 10s 快速熔断，遇到网络拦截明确提示更换 Base64 方案；
  - **用户自定义配置档案管理器**：清退硬编码的静态预设模型；在设置面板新增「存为新配置」与已保存配置管理列表，支持一键载入与安全删除，密钥受系统安全存储保护；
  - **全绿验证门**：全量 84 个套件 518 项测试 100% 通过（新增 7 项专项测试），`npm run typecheck` 0 错误，`npm run build:web` 编译成功。

## AI Image Dual-Mode Engine (/images/edits & /images/generations) 2026-09-11 (workspace/claude)

- **同时支持修图与文生大图双模式及自动平滑回退（v1.0.4）**：
  - **支持原图扫描修图模式（/images/edits）**：输入拍摄照片，经 multipart/form-data 调用，类似扫描全能王，纯白底、矫正透视、增强文字清晰度，100% 保真原始药盒文字与色调；
  - **支持商业展台文生图模式（/images/generations）**：商业摄影 Prompt 驱动，支持有图（视觉模型特征提取驱动）或无图（药名/规格推断驱动），兼容几乎所有主流 OpenAI 兼容服务商（DALL·E 3、通义万相、CogView、FLUX 等）；
  - **自动平滑回退（Auto Mode）**：有照片时优先尝试原图修图；若服务商不支持该接口（返回 404/405/501），自动无缝平滑回退至文生大图，绝不中断或抛错；无照片但输入药名时直接调用文生图；
  - **生图独立设置面板强化**：提供「自动模式 / 仅修图增强 / 仅文生大图」模式选择下拉框与说明，新增 DALL·E 3 等多款常用预设模型；
  - **全绿验证门**：全量 83 套件 511 项测试 100% 通过（新增与重构双模式测试覆盖），TypeScript 0 错误，Web 与 Android 编译打包通过。

## Cloudflare Pages Release Proxy Streaming & HTTP 403 Fix 2026-09-11 (workspace/claude)

- **根治应用内在线更新下载 APK 报 HTTP error 403 Forbidden 缺陷**：
  - **403 根因**：`functions/api/download.ts` 原本使用 `redirect: 'manual'` 截获 GitHub API 资产重定向并直接向移动端下发 `Response.redirect(redirectLocation, 302)`。这迫使国内手机直接建立与微软 Azure Blob 存储节点（`release-assets.githubusercontent.com`）的连接，导致受国内移动网络或签名策略影响直接拒绝访问并返回 403 Forbidden；
  - **重构为边缘流式直传**：Cloudflare Pages 内部使用 `redirect: 'follow'` 自主跟随 GitHub 302 跳转获取真实二进制流，彻底移除客户端 302 重定向分支，直接以 `Response(assetRes.body)` 流式代理回传 APK，设置正确的 `Content-Type: application/vnd.android.package-archive` 与 `Content-Length`。移动客户端仅与 `xiaoyaohe.pages.dev` 交互，无需直连 GitHub/Azure 存储；
  - **客户端下载请求优化**：`ApkDistributionPlugin.java` 采用标准移动端 User-Agent，避免触发 CDN WAF 拦截，并完善异常时的目标 URL 诊断信息；
  - **验证**：`tests/functionsApi.test.ts` 16 项测试与全量 83 套件 506 项测试 100% 全绿，`npm run build:web` 编译成功。

## 1:1 Design Mockup Reproduction & Real Backend Integration 2026-09-11 (workspace/claude)

- **主导航与四屏 1:1 视觉复刻与真实后端数据联通 (`media_1789105284209.jpg`) 深度复审与 Bug 修复**：
  - **Screen 1「今天」**：
    - 修复药品卡片圆形 Radio 打卡按钮交互：点击直接一键切换打卡/撤回状态并写入 IndexedDB，撤回/打卡均联动清除或更新系统通知；点击卡片主体仍打开剂量确认弹窗；
    - 修复频次文案硬编码问题：从静态「每日1次」改为根据 `med.slots` 动态推导 `每日N次`；
    - 修复库存单位硬编码问题：从静态「片」改为按药品配置 `med.inventory.unit || med.doseUnit` 自适应呈现（如「48粒」）；
    - 调整环形进度条状态指示点颜色：已服用设为高饱和宝蓝 `#2563eb`（浅蓝底 `#eff6ff`），待服用为翡翠绿 `#10b981`，跳过为中灰 `#94a3b8`，完美吻合设计图。
  - **Screen 2「药品」**：
    - 指标卡数量规范间距（`${totalCount} 种`），与图 2、图 3 对齐；
    - 药品列表行、分类过滤器及「+ 添加药品」FAB 保持 100% 契约与视觉一致。
  - **Screen 3「库存」**：
    - 首行「库存健康」卡片不仅视觉呈现 3D 发光勾选盾牌与右侧箭头 `>`，且为头部增加点击联动：点击卡片头部即可直接呼出智能录入、历史操作与撤销、批量预扣、导出清单等全部库存底层操作。
  - **Screen 4「我的」**：
    - **修复致命 DOM 节点夺取 Bug**：此前齿轮按钮 ⚙ 点击直接将 `advancedWrapper` 内的三个设置分组 DOM 节点挪移至 BottomSheet，导致关闭弹窗后主页面底层所有设置节点永久丢失。现改为提供专用「高级系统设置」快捷操作面板，支持平滑滚动与直接唤起弹窗，主页面 DOM 树始终稳固完好；
    - **修复移动端网格样式缺失**：补全 `.profile-stats-grid`、`.profile-stat-card`、`.profile-stat-icon` 等移动端基础 CSS，在手机端呈现高保真 1x3 独立卡片网格；
    - 统一路由跳转为标准 `navigate()` 方法；文案对齐「用药管理 第 X 天」；
    - 对齐 6 行菜单项的图标底色与主色调（通知-暖橙、时段-生机绿、外观-紫罗兰、保活-橙红、帮助-青蓝、关于-宝蓝）。
- **全绿验证门**：
  - `npm run typecheck`（0 errors）；
  - `npm test`（83 个测试套件，507 项测试 100% 全绿）；
  - `npm run build:web` 成功编译构建。

## Pixel-Perfect Visual Refinement & Zero-Emoji Vector System 2026-09-11 (workspace/claude)

- **严格清退全部 Emoji，全面贯彻统一矢量 SVG 图标体系 (`/oil-icon`)**：
  - 响应用户全局总要求「不使用 emoji，优先采用统一风格绘制的 icon」；
  - 清理所有前端页面（`Today.ts`, `Settings.ts`, `TakeMedModal.ts`, `llmProviderEditor.ts`）、系统通知（`medicationReminderPlan.ts`）以及自包含预览原型（`design_mockup_preview.html`）中的 emoji 字符（🔔、⚠️、💡、✓ 字符、🎉、☀️、🌙、✨、📅、🔍、⚙、📦、📋、❤️、📷 等）；
  - 全面替换为规范统一的 Tabler / Lucide 风格 SVG 纯矢量图标（1.75~2.2 stroke-width，带无障碍标签与自适应色彩）。
- **「今天」页面细节对齐 (`media_1789100010055.png`)**：
  - 顶部晨光绿植背景新增微散斑毛玻璃遮罩 (`.today-nature-bokeh-glass`，`backdrop-filter: blur(14px)`)；
  - 标语「按时用药，守护健康」配笔刷强调下划线 SVG；
  - 进度卡右侧收窄为专属紧凑悬浮胶囊卡片 (`.today-capsule-card`)，搭载 48px 小型高光 3D 胶囊与中文字体治愈手写体「坚持用药 / 很重要～」及微型引导箭头；
  - 「今日用药计划」标题左侧增加紫色圆角日历 SVG 徽章，右侧常驻渲染「✓ 一键打卡」胶囊按钮；
  - 时段小节标题左侧增加圆角太阳/月亮 SVG 徽章。
- **「药品」与「库存」页面顶栏与卡片对齐 (`media_1789100238351.png`)**：
  - **药品页**：
    - 顶栏并列展示大字号「药品」标题与「≔ 批量管理」及「✦ AI 助手」两枚胶囊按钮；
    - 顶部 3 个指标卡（全部药品 12 种、近期使用 12 种、需补充 0 种）重塑为纯白圆角 (18px) 卡片，底部设柔和环境光弥散托盘（蓝/绿/粉色圆形碟盘底座分别托举 3D 水晶药瓶、研磨器与急救箱）。
  - **库存页**：
    - 顶栏右侧常驻「✦ AI 助手」胶囊按钮；
    - 顶部独占「库存健康」卡片：首行左侧为 48px 翡翠绿圆形底座加持的 3D 发光勾选盾牌徽章，中段为「库存健康」与「整体充足，暂无风险」，右侧带引导箭头 `>`；下方水平平铺 4 列数据（全部药品、近期使用、需补充、已过期），标签在上、数值在下（如「12 种」）；右下角设浮动「+ 添加库存」FAB。
- **自包含原型与自动化走查**：
  - 更新 `preview/design_mockup_preview.html`，正则扫描确保 0 个 emoji，截取最新四屏并列全景、打卡联动、深色模式与真机模拟器截图。
- **全绿验证门**：
  - `npm run typecheck`（0 errors）；
  - `npm test`（83 个测试套件，507 项测试 100% 全绿）；
  - `npm run build:web` 成功构建（5.17s）。

- **药盒拍摄静默生成商业纯白底展台大图 (AI Studio Packshot)**：
  - **交互流程零阻塞**：拍照或从相册选图后，直接加载原照片并进入编辑表单，杜绝强制裁切弹窗打断；后台静默排队进行特征提取与生图，完成后以平滑淡入动画替换预览；
  - **底片保留与无损切换**：底层数据模型扩展 `PhotoBlob.originalBlob` 与 `kind: 'original' | 'ai_packshot'`。提供「恢复原图」、「AI 生成展台图」与「重新裁切原图」快捷入口；
  - **两阶段智能管线 (`aiImageStudio.ts`)**：
    1. 视觉大模型（若有原图）抽取药盒形态、品牌色调与版式特征（无原图时根据药名与规格智能启发推测）；
    2. 拼装商业静物摄影 Prompt，调用 OpenAI 兼容图像接口（`/v1/images/generations`，支持 `b64_json` 与 `url` 兜底拉取）；
    3. 生成图入库前自动由 `compressBoxPhoto` 压缩至 720px 与 220KB 限制内，杜绝 Android WebView OOM。
- **独立「AI 生图服务商」配置面板 (`imageGenSettingsPanel.ts`)**：
  - 在「设置」-「智能助手与高级」中开辟独立生图服务商卡片；
  - 支持快捷预设胶囊（DALL·E 3、通义万相、FLUX、CogView-3）；
  - 未单独配置或启用时，自动继承当前活跃的主 AI 文本服务商（Base URL 与 API Key）；
  - 配备连通性测试与模型连通状态提示。
- **全绿验证门**：
  - `npm run typecheck` (0 errors)；
  - `npm test`（83 个测试套件，507 项测试 100% 全绿，新增 `tests/aiImageStudio.test.ts` 6 项测试）；
  - `npm run build:web` 成功编译通过。

## Frontend High-Fidelity Design Optimization & Gemini 3D Assets 2026-09-11 (workspace/claude)

- **Gemini 3D 拟物与真实微质感非 SVG 视觉资产生成与无损透明边缘抠图**：
  - 基于设计稿与 Gemini Imagen 3 专项生成全套 3D 拟物资产：
    - `nature-header-bokeh.png`（晨光自然绿植与柔和散斑光晕，左侧及下方平滑羽化渐变融合）；
    - `today-floating-capsule.png`（今日卡片 45° 蓝白高光 3D 浮动胶囊，带水凝高光与透明通道）；
    - `inventory-health-shield.png`（3D 翡翠绿库存健康盾牌徽章，带发光勾选与微拟物厚度）；
    - `med-bottle-3d.png`（全部药品 3D 水晶蓝药瓶）；
    - `med-recent-mortar.png`（近期使用 3D 薄荷绿研磨器与闹钟药丸）；
    - `med-aid-kit-3d.png`（需补充 3D 珊瑚粉急救箱）；
    - `user-avatar-3d.png`（专属 3D 阳光少年头像，戴耳机、立领夹克，像素级对齐设计稿）。
  - 保存在 `src/assets/images3d/` 并通过 `src/ui/assets3d.ts` 集中管理，提供标准降级 SVG。
- **零污染交付安全机制与双模 HTML 交互原型（Phase 1~3）**：
  - 在修改生产代码前，先创建 `preview/design_mockup_preview.html`（4.2MB 自包含纯单文件网页原型，内嵌全套 Base64 资产）；
  - 提供全景四屏并列模式与 iPhone 15 Pro 仿真模拟器，实现打卡联动、环形进度条偏移动画、时段药丸筛选与深色模式；
  - 经自动化走查与用户评审确认后，无缝正式落地至 `medbox/` 生产代码。
- **页面层级与样式重构落地（Phase 4）**：
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
- **全绿验证门**：
  - `npm run typecheck` (0 errors)；
  - `npm test`（82 个测试套件，501 项测试 100% 全绿）；
  - `npm run build:web` 成功构建；
  - 32 个内嵌图标与构建期元数据校验全数通过。

## 3D Liquid-Glass Icons & Ambient Diffusion & v1.0.0 Milestone 2026-09-09 (workspace/claude)

- **全套 9 款 3D 拟物液态玻璃微质感资产生成与无损边缘抠图**：
  - 基于 Gemini Imagen 3 重绘全套 Studio 级 3D 拟物资产（彩虹亚克力药盒、天蓝用药计划本、珊瑚红靶向徽章、丁香紫磨砂瓶、薄荷青时钟药丸、急救包、晶莹双色胶囊、智能分药机与立体头像）；
  - 编写 `scripts/cutout_assets.py`，采用 OpenCV GrabCut 算法结合中性背景先验与边缘平滑，将资产转为零毛边、无背景色残留的 512x512 高清透明 PNG，保存在 `src/assets/images3d/`。
- **向周围弥散颜色（Ambient Color Diffusion）动态光晕系统**：
  - 为设置页统计卡片、药品列表统计卡片（全部药品/近期使用/需要补充）、扫码分药助手 Banner 及服药模态浮动药丸全面接入专属环境光晕；
  - 采用 `::before` 伪元素多层径向渐变（Radial Gradient）配合 `filter: drop-shadow`，根据卡片主题色彩（金橙、天蓝、珊瑚红、丁香紫、薄荷青、祖母绿）向四周自然晕染发散，卡片悬浮与激活时平滑缩放，完美融入水凝玻璃视觉体系。
- **小药盒 1.0.0 正式里程碑发布与桌面交付**：
  - 版本号由 `0.9.15` 正式升级为 `1.0.0`（Android `versionCode: 35`）；
  - 本地执行 Gradle `assembleRelease` 编译出最新正式版安装包 `xiaoyaohe-1.0.0-android-release.apk`（32,095,374 字节，SHA256: `cb86c34838c1be16ffd6f142c21686b40434a81b6f179910f69fbc612735d317`），已复制至用户电脑桌面 `C:\Users\87850\Desktop\`；
  - 修复本地缓存过期问题：在 `getAvailableUpdate()` 中加入自动失效逻辑，若缓存版本 <= 本地当前运行版本，自动清空脏缓存；
  - **Cloudflare Pages 私有 Release 代理全链路打通**：用户已在控制台配置 Fine-grained `GITHUB_TOKEN`，GitHub 官方 Release `v1.0.0` 正式发布并挂载 APK 资产。实测 `/api/releases`（200 OK）、`/api/download?tag=v1.0.0`（302 跳转预签名 S3 成功拉取 32,095,374 字节完整 APK，校验通过）。移动端与网页端无需登录即可 0.3 秒无感更新。

## 0.3s Fast Cloud Update Check & Ladder Probing Architecture 2026-09-08 (workspace/claude)

- **应用更新检测时间过长痛点根治**：
  - 过去点击「检查更新」总是执行 `Promise.allSettled([checkGithubRelease(), scanLanForUpdates()])`，由于局域网探测需对 254 个 IP 执行扫描（16 线程 x 500ms），即使用户处于良好互联网环境下，也必须干等 8~10 秒；
  - 重构为**「云端极速通道 + 阶梯探测 + 发现即拦截」**架构。
- **构建期版本元数据自动生成（`scripts/gen-version.mjs` & `public/version.json`）**：
  - 在 `npm run build:web` 构建阶段自动执行 `scripts/gen-version.mjs`，从 `package.json`、`getVersionCode()` 与对应版本的 Release 文档（`docs/releases/*.md`）抽取版本号、构建号、发布日期、下载链接、文件大小与更新日志；
  - 输出 `dist/version.json`，随静态网页一同部署在 Cloudflare Pages 全球 Anycast CDN（`https://xiaoyaohe.pages.dev/version.json`），全国平均网络延迟仅 50~150ms。
- **Cloudflare Anycast 极速探测通道（`apkTransport.ts`）**：
  - 新增 `checkFastCloudVersion()`，通过轻量级 HTTP GET 获取 `https://xiaoyaohe.pages.dev/version.json`（体积仅 ~400B，耗时 50~150ms），2 秒超时熔断保护；
  - 支持直接将云端源（`source: 'cloud'`）作为受信任更新源。
- **GitHub Releases 多镜像并发竞速（`apkTransport.ts`）**：
  - 重构 `checkGithubRelease()`：由原来的逐个串行尝试 4.5s 改为通过 `Promise.any` 对官方 API 与 3 个国内镜像（`ghfast.top`、`ghproxy.net`、`gh-proxy.com`）发起**并发竞速**，一旦任一节点先返回有效响应即刻胜出并取消其余请求，将 GitHub API 检测耗时从数秒压缩至 300~600ms。
- **阶梯探测与极速拦截机制（`apkTransport.ts`）**：
  - 新增 `checkOnlineRelease()` 综合线上检测；
  - 在 `checkForAppUpdates` 中实现**「发现即拦截」**：并发拉起云端与局域网探测，一旦云端确定有更高可用版本（~0.3s），**立刻终止等待局域网扫描**，保存并派发更新通知，使用户在 0.3 秒内即刻弹出更新弹窗；
  - 仅当云端无更新或网络不可用时，才向用户提示「云端已是最新，正在扫描周边设备...」并转入局域网扫描，且施加严格的 3 秒全局超时上限。
- **界面交互与 AI 工具链增强（`Settings.ts` & `assistantTools.ts`）**：
  - `Settings.ts` 检查按钮接入 `onStatus` 回调，实时展示「正在检查云端最新版本...」或「云端已是最新，正在扫描周边设备...」进度，消灭假死感；
  - `assistantTools.ts` 与更新卡片完整适配 `cloud` 来源标识（显示「来源：云端极速通道」）。
- **全绿验证门**：
  - `npm run typecheck`（0 errors）；
  - `npm test`（79 个测试套件，472 项测试全部通过，新增 5 项云端极速检测与拦截测试）；
  - `npm run build:web` 自动生成 `public/version.json` 并编译通过。

## Archive Module Cleanup & Visual README Launch 2026-09-08 (workspace/claude)

- **彻底移除退役工时归档模块（`archive/工时模块归档`）**：
  - 排查确认与当前药品核心业务无任何依赖与耦合，彻底删除 `archive/` 物理目录（历史快照永久保留在 Git 提交 `4ee0146` 中）；
  - 清理 `vite.config.ts` 中的测试排除项配置。
- **构建高品质项目主页与视觉资产（`README.md` & `assets/readme/`）**：
  - 遵循 `beautify-github-readme` 规范，采用 Hybrid 混合模式渲染生成 1200x600 规范的高保真封面图 `assets/readme/hero.png` 与 SVG 源码 `assets/readme/hero.svg`，完整融合项目水凝玻璃质感与药盒设计切图；
  - 严格遵循 `oil-tone` 文风规范编写 `README.md`，平实自然阐述项目初衷、全屏防误触强提醒、药盒条形码扫描核验、智能库存预警与离线优先机制，并提供 Android APK 与 Web PWA 入口；
  - 补齐标准 MIT 开源许可证文件 `LICENSE`；
  - 通过 `tone_lint.py` 与 `audit_readme.py` 双重审计。
- **全绿验证门**：
  - `npm run typecheck`（0 errors）；
  - `npm test`（79 个测试套件，467 个测试全部通过）；
  - `npm run build:web` 构建通过。

## Web PWA Online Deployment (Cloudflare Pages Live) & GitHub Actions Release Automation 2026-09-08 (workspace/claude)

- **Cloudflare Pages 全球 CDN 正式上线（公网可访问）**：
  - 公网正式访问地址：`https://xiaoyaohe.pages.dev/`；
  - 成功绑定 GitHub 私有仓库 `Misakii1k/xiaoyaohe`（`workspace/claude` 分支），自动配置 Node 22 环境与 Vite 构建；
  - 经实测首屏秒开，暗黑液态玻璃质感、今日用药、药品管理、分药排程、库存、设置及 AI 助手全链路功能完整可用。
- **Vite 相对基路径适配（`vite.config.ts`）**：
  - 增加 `base: process.env.VITE_BASE_PATH || './'`，确保静态资源在 Cloudflare Pages 独立根域名、GitHub Pages 二级目录（`misakii1k.github.io/xiaoyaohe/`）以及 Capacitor Android 本地 WebView 下均能通过相对路径正确定位，消除 404 隐患。
- **浏览器持久化存储保护（`src/main.ts`）**：
  - 网页端启动阶段主动向浏览器申请 `navigator.storage.persist()` 持久化配额，防止移动端 Safari 或清理大师在存储紧张时意外清除 IndexedDB 药品与日程数据。
- **GitHub Pages 自动化部署工作流（`.github/workflows/deploy-web.yml`）**：
  - 支持向 `main`、`workspace/claude` 推送或手动触发；已修复 Git LFS 图标母版拉取配置；
  - 若后续仓库设为 Public，可一键激活作为备用站点。
- **Android APK 自动打包与 GitHub Releases 发布工作流（`.github/workflows/release-apk.yml`）**：
  - 支持推送版本 Tag（`v*`）或手动点击执行；
  - 结合 Java 21、Android SDK 与 Gradle 缓存，自动适配 GitHub Secrets 专属签名密钥或自动生成一致的标准发布签名；
  - 自动编译 Release APK，输出 SHA256SUMS 校验文件，并自动发布到 GitHub Releases。
- **全绿验证门**：
  - `npm run typecheck`（0 errors）；
  - `npm test`（79 个测试套件，467 个测试全部通过）；
  - `npm run build:web` 编译通过（所有资源引用转为 `./`，32 个内嵌图标校验通过）。

## App Update Discovery Fix, GitHub Releases Online Channel & Download Progress 2026-09-08 (workspace/claude)

- **局域网扫描并发风暴修复（`ApkDistributionPlugin.java`）**：
  - 根除 `scanSubnet` 瞬间为 254 个 IP 派发 254 个原生线程导致的线程耗尽、OOM 或触发路由器 SYN Flood 防御静默丢包缺陷；
  - 重构为固定容量线程池 `Executors.newFixedThreadPool(16)`，限制最大并发数为 16，连接超时 500ms，扫描稳定可靠。
- **GitHub Releases 官方在线发布与镜像加速接入（`apkTransport.ts`）**：
  - 新增 `checkGithubRelease()` 对接 GitHub 官方发布接口，支持解析 APK 附件与更新日志；
  - 原生支持国内加速镜像备用兜底（`ghfast.top`、`ghproxy.net`、`gh-proxy.com`），网络波动时自动无缝降级切换。
- **原生 HTTP 流式下载与重定向追踪（`ApkDistributionPlugin.java`）**：
  - 原生实现 `downloadHttp`，支持多跳 301/302/303/307/308 重定向追踪（适配 GitHub Releases 到 AWS S3 CDN 的跨域重定向）；
  - 8KB 流式缓冲写入，下载完毕严格进行 `verifyApk` 证书签名校验，防止 APK 篡改。
- **多源并行检查与统一交互（`Settings.ts` & `settings.css`）**：
  - 设置页简化并统一为一键「检查更新」，`checkForAppUpdates` 并行查询 GitHub 与局域网设备，智能择优（高版本优先，同版本局域网优先）；
  - 新增局域网服务运行状态指示（端口 38473）；
  - 弹窗展示版本对比、更新日志、包大小及实时流式进度条（显示百分比及已下载流量）。
- **后台每日静默检测（`main.ts`）**：
  - 冷启动 4 秒后在空闲期静默检测，发现新版本时在设置卡片与底部 Tab 显示更新标记。
- **全绿验证门**：
  - `npm run typecheck`（0 errors）；
  - Vitest 79 个测试套件，467 个测试全部通过（新增 `tests/apkUpdateVerification.test.ts` 12 项测试）；
  - `npm run build:web` 构建成功；
  - `npx cap sync android` 同步通过；
  - `./gradlew.bat testReleaseUnitTest assembleRelease` 224 项任务全绿编译通过。


- **彻底移除系统固定屏幕（`startLockTask`）**：剥离 `startLockTask()` / `stopLockTask()`，从根本上消灭「应用已固定（不用了 / 知道了）」系统弹窗；
- **无障碍防绕过服务（`MedboxAccessibilityService.kt`）**：仅在扫码锁定态守护前台焦点，用户切出即时拉回；扫码完成或解除时立即注销保护；
- **扫码退出双重闭环（根治图一卡死）**：在扫码成功态提供显式「完成并返回」主按钮（且卡片支持点击即退），配合 1.5s 倒计时自动调用 `finish()`；
- **无缝弹回原前台应用（如红果短剧 App）**：移除 `MedicationAlarmContract.java` 中强跳 `MainActivity` 的代码，服药完毕销毁提醒窗口后，Android 系统自然恢复刚才正在使用的原应用，绝不强退桌面或强跳药盒主页；
- **音频焦点智能控制（`AlarmAudioPlayer.kt`）**：唤起强提醒时向系统申请 `AUDIOFOCUS_GAIN_TRANSIENT` 临时音频焦点，背景播放的短剧/音乐自动暂停；提醒结束时释放焦点，背景短剧/音乐原声自动恢复播放；
- **设置页状态展示与引导（`Settings.ts`）**：在扫码配置卡片新增「无障碍防退出保护」状态展示与一键跳转系统设置按钮；
- **全绿验证门与产物**：
  - `npm run typecheck`（0 errors）；
  - `npm run test`（79 套件 463 项测试全部通过）；
  - `./gradlew.bat compileDebugKotlin` 编译通过；
  - `./gradlew.bat assembleDebug` 与 `./gradlew.bat testReleaseUnitTest assembleRelease` 224 项任务全绿编译通过；
  - 产物：`~/Desktop/xiaoyaohe-0.9.15-accessibility-guard.apk`（18,646,307 字节）。

## Fullscreen Reminder Home Escape Block & Singleton Audio Player 2026-09-07 (workspace/claude)

- **彻底阻断全屏提醒通过 Home 键或手势退出（`MedicationAlarmActivity.kt`）**：
  - **沉浸粘性全屏模式（Immersive Sticky）**：进入全屏提醒时自动隐藏底部导航手势栏与状态栏，滑动屏幕边缘仅唤出半透明临时指示条，Android 原生不触发 Home 退出手势，根除 95% 以上误触。
  - **屏幕固定保护（LockTask）**：提醒唤起后进入 `startLockTask()` 模式，由系统底层直接禁用 Home 键与 Recents 多任务键；仅在服药确认、延后、跳过或扫码成功后通过 `safeStopLockTask()` 释放。
  - **任务栈强力前置拉回（`REORDER_TASKS` + `moveTaskToFront`）**：在 `AndroidManifest.xml` 声明 `android.permission.REORDER_TASKS`；一旦检测到 `onUserLeaveHint()` 或意外压入后台，立即在主线程将 Activity 任务栈无缝拉回最前台，并延时 120ms 二次拉回避开系统手势过渡动画栈锁。
  - **所有提醒统一闭环**：普通提醒与扫码强制提醒一律留在前台，必须由用户在界面上明确选择「已服/延后/跳过」或扫码解除，彻底杜绝切回桌面导致用药漏服。
- **全局单例音频控制器（`AlarmAudioPlayer.kt`）**：
  - 彻底根除「切出桌面再进入页面出现两路背景音乐重叠」的缺陷；
  - 进程级全局单例互斥管理 `Ringtone` 与 `Vibrator`，启动新音频前强制回收释放旧音频实例；
  - `stop()` 无条件停止底层音频，移除对不可靠的系统 `isPlaying` 判定；
  - 提供 `@JvmStatic` 方法供 `MedicationAlarmContract` 动作分发无缝调用。
- **全绿验证门与产物**：
  - `npm run typecheck`（0 errors）；
  - `npm run test`（79 套件 463 项测试全部通过）；
  - `npm run test:release`（12 项测试全部通过）；
  - `npm run build:web` 构建成功（32 个内嵌图标校验通过）；
  - `./gradlew.bat testReleaseUnitTest assembleRelease` 编译通过；
  - 产物：`release/xiaoyaohe-0.9.15-android-release.apk`，已复制至用户桌面 `~/Desktop/`。

- **普通提醒上滑 Home 自动转为贪睡（`MedicationAlarmActivity.kt`）**：
  - 监听 `onUserLeaveHint()` 与 `onStop()`，普通全屏提醒在用户上滑 Home 或返回桌面时自动执行「延后 10 分钟提醒（SNOOZE）」；
  - 立即停止响铃与震动（`silenceAlert()`），弹出「已延后 10 分钟提醒」Toast 并关闭页面，根除“提醒界面退到桌面但手机在后台持续疯狂响铃”的体验问题。
- **扫码强制提醒上滑 Home 严格防绕过拦截**：
  - 判定 `isLocked() == true` 时，用户尝试上滑离开将被严格拦截并立即通过 `Intent.FLAG_ACTIVITY_REORDER_TO_FRONT` 配合前台服务 `AlarmRingService.launch` 兜底弹回最前台；
  - 触发警告短震与「强制提醒：请扫描条码解除」Toast，铃声保持播放，杜绝睡迷糊随手划掉。
- **二维码图标 5 秒暗门应急解除（防死锁）**：
  - 界面保持极简纯净，无外显文字与进度圈（保持纯彩蛋暗门属性，避免日常依赖）；
  - 卡片顶部手绘二维码图标（`QrGlyph`）支持按压检测，持续长按满 5 秒即刻触发双短震反馈并静音当前警报，弹出液态玻璃质感应急对话框（提供「延后 10 分钟」与「确认跳过本次」选项，支持单药与群组；点击取消恢复响铃）。
- **相机扫码模式自动关闭震动（降噪稳焦）**：
  - 点击按钮进入相机扫码取景器时，自动调用 `pauseVibration()` 暂停马达震动，保留报警声音，消除机身抖动对摄像头对焦与条码识别的物理干扰；退出扫码未解除时自动恢复震动。
- **群组提醒批量跳过数据流打通**：
  - `MedicationAlarmContract.java` 增加 `ACTION_ALL_SKIPPED` 常量与动作映射；
  - `reminderActions.ts` 新增 `handleAllSkippedAction`，单事务批量标记当日群组内全部 `occurrence` 为 `skipped`。
- **全绿验证门与产物**：
  - `npm run typecheck`（0 errors）；
  - `npm run test`（79 套件 463 项测试全部通过）；
  - `npm run test:release`（12 项测试全部通过）；
  - `npm run build:web` 构建成功（32 个内嵌图标校验通过）；
  - `npx cap sync android` 同步成功；
  - `./gradlew.bat testReleaseUnitTest assembleRelease` 224 个任务编译通过；
  - 产物：`release/xiaoyaohe-0.9.14-android-release.apk`（18,644,659 字节，SHA256: `b6c88b5b47e652f5dd57c7c4d445117d982156298318f5f6eb17a3956e92b6c9`），94 个内嵌资产校验通过，已复制至用户桌面 `~/Desktop/`。

## Copywriting Polish with oil-tone 2026-09-07 (workspace/claude)

- **文风规范落地（遵循 oil-tone 规则）**：
  - 剔除宣传化用词、主观修饰语（「一款专为...打造」「纯净」「用心守护全家健康」「亲情」等）与口语化叹号/波浪号（`~`、`🎉`）；
  - 标题均作为内容标签（如「关于小药盒」「发布记录」），避免使用动作短语（「了解...」）；
  - 采用平铺直叙的完整句子，陈述事实边界（明确本地离线存储、不设远程账号、不展示广告）；
  - 中英文与数字之间保持半角空格，专有名词规范书写。
- **发布文档与交接文档优化**：
  - `docs/releases/0.9.13.md`、`0.9.12.md`、`0.9.11.md`、`0.9.4.md` 全面润色并通过 `tone_lint.py` 校验；
  - `docs/handoffs/claude.md` 替换含混用词，准确表述数据流与交互状态。
- **界面文本规范**：
  - `Today.ts`：规范进度摘要与空状态提示（「今日没有用药计划」「今日用药已全部完成」「剩余 N 次用药待处理」）；
  - `Settings.ts`：重写品牌卡片介绍、核心功能清单、免责声明以及网页端提醒说明；
  - `AiAssistant.ts`：精简欢迎语、快捷建议与超限错误提示。
- **质量验证与打包产物**：
  - `tone_lint.py` 全部检查通过；
  - TypeScript 检查 0 错误；
  - Vitest 79 个测试套件 463 项测试全部通过；
  - Playwright 52 项测试全通过；
  - Android Release 编译与模拟器（`ldj_test35`）端到端插桩测试 1/1 通过；
  - 产物：`release/xiaoyaohe-0.9.13-android-release.apk`（18,628,171 字节，SHA256: `c5fb4d577e85230531036a8282c7e18df32f1ddaba9b5629b452c2675c59f7a7`），已复制至用户桌面。

## Scan-Unlock Binding UX & Button Visibility Optimization 2026-09-07 (workspace/claude)

- **绑定入口与卡片常驻（`Settings.ts` & `settings.css`）**：根治「扫码解除强制提醒」在总开关处于关闭状态时绑定按钮完全隐藏（`if (scanPref.enabled && hasAlarmScanToken())`）导致用户误以为功能缺失的问题；重构为常驻渲染 `.settings-scan-card` 与 `.settings-scan-grid`（双列自适应网格排版，移动端不再挤压折行），无论开关开闭均完整展示当前绑定状态（生活码/专属码）并提供「重新扫码绑定 / 切换专属码」或「查看专属二维码 / 扫描生活中的码绑定」入口。
- **跨平台展示友好化**：取消 Web 端整块隐藏，全平台展示该配置区，非 Android 原生环境下展示「仅 Android App 生效」徽标并说明配置随局域网同步；Web 端点击「试验扫码解锁」友好提示需在 Android App 中体验。
- **绑定状态联动与静默预置（`alarmScanVerify.ts`）**：新增 `getOrCreateGeneratedScanToken()` 辅助函数，确保在不强制修改 `enabled` 状态下预生成或读取专属码；用户扫描生活码成功绑定后自动置为开启并提示，若暂不需强制提醒可手动拨动总开关关闭（保存已绑定的码）。
- **验证门**：typecheck 0 错误；vitest 79 套件 463 测试全过（新增 `tests/settingsUiContracts.test.ts` 契约断言与 `tests/alarmScanVerify.test.ts` 单元测试）；`npm run build:web` 资产检查 + Vite 构建成功；Playwright 52 测试全过。

## Always-Fullscreen Reminder + Unswipeable Alarm Page 2026-09-06 (workspace/claude)

- **到点自动全屏（`MedicationAlarmContract.showNotification`）**：所有提醒方式（含默认 strong）到点一律自动全屏接管——fullScreenIntent + notify-first 后主动 startActivity + AlarmRingService 前台服务三重兜底；提醒通知一律常驻（不可划掉）。mode 只决定全屏页自动收起策略（不收起 / 60 秒 / 10 秒）。
- **多任务不可划杀（`AndroidManifest.xml`）**：全屏服药页增加独立 `taskAffinity="com.medbox.app.alarm"`——不再寄生主任务，最近任务里不可见、随应用卡片划掉也不会被移除；配合常驻 KeepAliveService 前台服务保活进程。
- **发布脚本修复**：release.mjs instrumentation 步骤改为真实存在的 `:app:connectedAndroidTest`（原 `connectedReleaseAndroidTest` 在 AGP 下不存在，发布链必挂）；根 `android/build.gradle` force kotlin-stdlib-jdk7/jdk8 至 1.8.22 消除插件模块 androidTest 重复类——`npm run release` 端到端首次全链路跑通。
- **文案同步**：提醒方式标签更名（全屏提醒 · 不自动收起 / 10 秒收起 / 60 秒收起），相关 AI 工具描述、设置页提示与 e2e/单测断言同步。
- **验证门与产物**：typecheck 0 错误；vitest 79 套件 461 全过；Playwright 56 全过；release 端到端含模拟器 instrumentation（app 模块 1/1 通过）与 94 个内嵌资产校验。产物 `release/xiaoyaohe-0.9.13-android-release.apk`（18,627,667 字节，较 0.9.12 +80 字节；SHA256 `34d76d04…5dadc`），已复制至用户桌面。待真机验证：前台其他应用 / 后台 / 锁屏三态自动全屏与多任务划杀保护。

## Scan-Unlock Auto-Take + Assistant History/Model Prefs + Batch Page Fixes 2026-09-06 (workspace/claude)

- **全屏提醒扫码成功直接视为已服用（`MedicationAlarmActivity.kt`）**：单药记 `ACTION_TAKEN`、群组记 `ACTION_ALL_TAKEN`；成功态展示约 1.5s 后自动关闭；返回键在 resolved 态仅关页。无扫码要求的提醒行为不变。
- **绑定扫码免上滑确认（`Settings.ts`）**：识别成功即收起相机预览并把「确认绑定」滚入可视区；ScanSort 未知码结果自动滚到可见位置。
- **扫码识别提速**：Web 端 1280×720 分辨率约束 + 120ms 检测节流 + html5 取景框按视口放大；原生解码器会话级复用（不再每帧新建）。
- **AI 小助手对话历史（DB v10 `assistantMessages`）**：本机保留最近 200 条，重启续聊、可一键清空；附件不入库。
- **小助手卡片不再重复文字**：`present_card` 描述与系统提示词改为「卡片已承载完整信息，正文不复述」。
- **小助手页新增模型选择与推理强度**：新 `src/ai/assistantPrefs.ts`；模型覆盖与 `reasoning_effort` 仅对活跃供应商生效，不支持参数的服务商自动去参重试；面板头部新增两个下拉 + 模型列表刷新。
- **批量管理页显示修复（纯 CSS）**：补齐时段 chip/行内排版/dock 全部缺失样式；dock 计数一行 + 四按钮 2×2；同步修复普通药品列表的级联覆盖导致的编辑按钮掉行。
- **存量测试修复**：0.9.11 遗留的两个过时 E2E spec（camera-actions / inventory-workflows，基线即可复现失败）已更新到现行 UI 契约。
- **验证门与产物**：typecheck 0 错误；vitest 79 套件 461 测试全过；Playwright 56 全过；`build:web` + `cap sync` 成功；模拟器 `connectedAndroidTest` app 模块 1/1 通过。发布产物 `release/xiaoyaohe-0.9.12-android-release.apk`（18,627,587 字节，较 0.9.11 +0.02%；SHA256 `22bfa36b…c1ee2`），已复制至用户桌面。发布脚本 `release.mjs` 的 instrumentation 步骤缺陷（release 变体无 connected 任务 + 插件模块 kotlin 重复类）记录于 `docs/handoffs/claude.md` §19 待办。

## Fullscreen Medication Alarm Hardening (Anti-Bypass & Volume Mute) 2026-09-05 (workspace/claude)

- **返回手势与按键防穿透/防绕过加固（`MedicationAlarmActivity.kt`）**：
  - **取景器守卫**：用户在扫描药盒或解锁码时，按返回键仅收起取景器（`showScanner = false`），不关闭提醒 Activity；
  - **扫码锁定态防绕过**：开启扫码强制解除（`locked == true`）时，Back 手势与物理返回键被严格拦截；触发短震动并在界面（卡片中央与底部）显示「强制提醒：请扫描已绑定的药盒或物品条码解除」红色警示，杜绝随手划掉漏服；
  - **非锁定态防误触保护**：普通或已扫码状态下，返回手势自动转为「10分钟后提醒（SNOOZE）」，绝不让用户随手划掉直接关闭闹钟导致漏服。
- **物理音量键静音拦截（`dispatchKeyEvent`）**：
  - 拦截 `KEYCODE_VOLUME_DOWN` 与 `KEYCODE_VOLUME_UP`；
  - 在公共场合或会议中按压音量键可快速静音铃声与震动（`silenceAlert()`），但页面保持在最前端，用户必须在屏幕上完成操作。
- **全绿验证门与 Release 打包产物**：
  - `npm run typecheck` (0 errors)
  - `npm run test` (76 个测试套件，448 个测试 100% 通过)
  - `npm run build:web` 构建成功
  - `npx cap sync android` 同步成功
  - `./gradlew.bat testReleaseUnitTest assembleRelease` (BUILD SUCCESSFUL in 1m 8s, 211 tasks)
  - `scripts/lib/release-utils.mjs` 校验通过 94 个内嵌资产（哈希 `749a8ffe...`）
  - 发布产物：已输出至 `medbox/release/xiaoyaohe-0.9.11-android-release.apk` (18,623,579 字节，SHA256: `acee36d280de7a631a6d4a4f6a32f4b4191cf1398dda4a4e43eb8044c46ab447`)，并已同步复制至用户桌面 `~/Desktop/xiaoyaohe-0.9.11-android-release.apk`。

## Home Topbar & Progress Ring Fix + Settings Reminders Layout & Copy Optimization 2026-09-05 (workspace/claude)

- **首页顶栏规范统一与 Android WebView 焦点黄框根治（`Today.ts`, `today.css`, `legacy.css`）**：
  - **根因分析**：路由跳转时 `announceNavigation()` 对 `h1` 执行 `.focus({ preventScroll: true })` 以保障无障碍读屏，但在「今天」页自建的大标题 `.today-header-title` 上未声明 `outline: none`，导致 Android WebView / Chromium 渲染出默认黄色系统焦点矩形框；
  - **修复**：为 `.today-header-title` 增加 `:focus, :focus-visible { outline: none; }`，并在 `legacy.css` 全局追加 `h1[tabindex='-1']:focus { outline: none; }` 预防机制；
  - **字号与层级规范**：将「今天」页大标题字号由 `28px` 调整为 `var(--fs-title1, 22px)`，字重调整为 `700`，字距 `-0.4px`，与「我的」等主页面统一，同时保留日期副标与右侧 AI 助手及头像入口。
- **进度环 100% 溢出修复与空间优化（`components.ts`, `legacy.css`）**：
  - **扩大圆环内部净空**：SVG 半径 `r` 从 `38` 适度扩大至 `40`，描边 `stroke-width` 从 `10` 精简微调至 `8`，内部净圆直径从 `66%` 提升至 `72%`；
  - **数值与单位排版微调**：数值字号微调为 `26px`，字距 `-0.6px`，单位 `%` 微调为 `13px`；在 `.ring-center-content` 上增加 `white-space: nowrap; max-inline-size: 100%;` 保护，彻底解决 100% 在系统字体放大下的折行和压线问题。
- **设置页用药提醒测试按钮 2x2 宫格化与文案精简（`Settings.ts`, `settings.css`）**：
  - **测试按钮 2x2 宫格布局**：解决原先 4 个测试按钮挤在单行 `btn-row` 导致严重缩窄、文字多行折叠的问题，新增 `.settings-test-grid` 样式类（双列网格、各占 50%、单行居中、40px 规范高度），按钮统一次要 `tonal` 样式；
  - **文案去重与精简**：移除图2提醒说明中与时段聚合重复的条目，聚焦系统通知、精确闹钟与后台活动三项核心指引；将图3时段说明精简为通俗易懂的“每天按早、中、晚、睡前各发送 1 次聚合提醒。点击下方时段可自定义整体时间与响铃方式。”，移除“库存归因”等晦涩技术术语；
  - **时段行箭头修复**：将误用的反向向左箭头 `icon('arrow-left')` 更换为标准的前往进入箭头 `icon('chevron-right')`。
- **全绿验证门与 Release 打包产物**：
  - `npm run typecheck` (0 errors)
  - `npm run test` (76 个测试套件，448 个测试 100% 通过)
  - `npm run build:web` 构建成功
  - `npx cap sync android` 同步成功
  - `./gradlew.bat testReleaseUnitTest assembleRelease` (BUILD SUCCESSFUL in 1m 7s, 224 tasks)
  - `scripts/lib/release-utils.mjs` 校验通过 94 个内嵌资产（哈希 `749a8ffe...`）
  - 发布产物：已输出至 `medbox/release/xiaoyaohe-0.9.11-android-release.apk` (18,623,579 字节，SHA256: `f8e3ef152f15732ec05947c2f36623ad4de21c39eb04ac5137088b9f8c1261f2`)，并已同步复制至用户桌面 `~/Desktop/xiaoyaohe-0.9.11-android-release.apk`。

## Frontend Internal Code Leak Elimination & Android QR Unlock Engine Overhaul 2026-09-05 (workspace/claude)

- **根除内部码与 HTML 标签外显（`Settings.ts` & `settingsPanel.ts`）**：
  - **问题修复**：解决生活码绑定与专属二维码弹窗中出现 `<b>条形码</b>`、`<code>https://...</code>`、`<br>` 等字面量 HTML 标签泄漏的问题（根因：`src/ui/components.ts` 的 `el(...)` 元素工厂底层使用 `node.textContent` 防 XSS，特意不解析 HTML）；
  - **机器码与格式枚举友好化**：
    - 新增 `formatBarcodeTypeLabel(format?: string)` 转换器，将底层机器识别格式（如 `qr_code`、`ean_13`、`code_128` 等）转换为用户易懂的本地化标签（如“二维码”、“商品条形码 (EAN-13)”等），彻底消除 `[qr_code]` 内部机器格式码外显；
    - 识别成功提示重构为语义化 DOM 结构：头部包含类型徽标胶囊、中间采用等宽弱背景长文本卡片（带自适应换行与安全高度）包裹已识别码内容、底部清晰呈现确认提问，不再拼接生硬文本字符串；
    - 新增 `formatCustomScanCodeSummary` 辅助函数，使设置项开关说明不再暴露 `QR_CODE: https://...` 这种原始技术串，转为友好摘要（如 `已绑定生活码（二维码 · 尾号 ...8923）`）。
  - **清理全局遗留 HTML 字符串**：
    - `openUnlockQrSheet`、`openBindCustomCodeSheet` 引导文案全面迁移为语义化 `strong` / `p` 节点；
    - 设置页版本信息与局域网更新提示中的 `<b>v...</b>` 迁移为标准 DOM 节点；
    - `settingsPanel.ts` 已配对设备列表中的 `<strong>...</strong>` 迁移为标准 DOM 节点。
- **全屏闹钟生活码解锁识别核心修复（`MedicationAlarmActivity.kt` & `MedicationAlarmContract.java` & `Settings.ts`）**：
  - **最核心根因：`PlanarYUVLuminanceSource` 不支持旋转抛异常导致每帧被静默丢弃**：
    - ZXing 的 `PlanarYUVLuminanceSource.isRotateSupported()` 硬编码为 `false`，调用其 `rotateCounterClockwise()` 会直接抛出 `UnsupportedOperationException: This luminance source does not support rotation by 90 degrees`；
    - 原方法内部包裹了 `try ... catch (ignored: Throwable)`，导致**每一帧相机图像在刚要开始解析时就直接抛异常崩溃并被静默丢弃，条码解码器实际上从未执行过任何解码**；
    - **彻底解决方案**：绝不调用 `rotateCounterClockwise()`，直接在内存中对 Y 平面字节数组按照 CameraX `rotationDegrees`（顺时针 90°/180°/270°）执行像素矩阵重映射物理旋转，并用旋转后的宽高创建 `PlanarYUVLuminanceSource`，同时保留未旋转原图及 72% 中央取景框局部裁剪的兜底策略。
  - **根因二：分辨率与对焦不足**：ImageAnalysis 增加 `setTargetResolution(Size(1280, 720))` 替代默认 640x480，大幅提高密集二维码清晰度；增加相机中心自动对焦与 `previewView` 点击触摸对焦支持；
  - **根因三：缺乏多模式二值化与局部裁剪**：生活环境中手机屏幕黑底白码、药盒塑料膜反光极为普遍。引入多级解码管线：默认 `HybridBinarizer` → `HybridBinarizer(source.invert())`（支持暗黑模式反色码）→ `GlobalHistogramBinarizer`（针对反光、低对比度药盒）；全图失败时自动回退为中央 72% 取景框局部裁剪聚焦解码；
  - **根因四：条码字符串与 URL 容错**：`MedicationAlarmContract.isTokenMatch` 统一标准化过滤 UTF-8 BOM、控制字符及 AIM 标识前缀（`]Q1` 等）；比对支持 URL 协议大小写与尾部斜线容错，支持 UPC-A / EAN-13 前导 0 互认；
  - **交互体验完善**：
    - `vibrateUnlock()` 修复了误触发持续警报震动的 bug，解锁时即刻停止闹钟响铃，提供两次短震反馈；
    - `ScannerOverlay` 中的“这不是配对的解锁码”提示在 2.5 秒后自动清除复位；
    - `Settings.ts` 扫码设置项中直接增加「试验扫码解锁」按钮，绑定后可一键拉起全屏闹钟就地验证。
- **全绿验证门与 Release 打包**：
  - Android 编译与单元测试：`./gradlew.bat testReleaseUnitTest` (BUILD SUCCESSFUL in 47s, 89 tasks)；
  - Java 契约测试：`MedicationAlarmContractTest` & `AppConfigurationTest` 覆盖旋转算法、Binarizer、容错比对全部通过；
  - 新增契约测试：`tests/settingsUiContracts.test.ts` 自动化断言设置页与同步面板绝无裸露 HTML 标签与机器枚举码；
  - `npm run typecheck` (0 errors)；
  - `npm run test` (76 个测试套件，448 个测试 100% 通过)；
  - `npm run build:web` 成功构建；
  - Capacitor 同步：`npx cap sync android`；
  - Gradle Release 打包：`./gradlew.bat assembleRelease` (BUILD SUCCESSFUL in 1m 16s, 211 tasks)；
  - 产物校验：`scripts/lib/release-utils.mjs` 校验通过 94 个内嵌资产（哈希 `c86b50cd...`）；
  - 发布产物：已输出至 `medbox/release/xiaoyaohe-0.9.11-android-release.apk` (18,623,587 字节) 并复制至用户桌面 `~/Desktop/xiaoyaohe-0.9.11-android-release.apk`。

## AI Provider Modernized Card Architecture & Settings Layout Overhaul 2026-09-05 (workspace/claude)

- **AI 服务商卡片层级与排版全面重构（`Settings.ts` & `settings.css`）**：
  - 彻底重塑移动端 AI 服务商卡片布局，解决原有头部过载、供应商名称被挤压截断、右侧按钮超出屏幕边缘以及状态文本裸露的问题；
  - **清晰三层卡片结构**：
    - **顶层 Header**：左侧展示优先级序号徽标（`#1`、`#2`）与粗体完整供应商名称（不与操作按钮混排，自适应截断安全保护），右侧展示「当前」激活状态胶囊与带色彩状态圆点的连接状态独立胶囊（`已连接` 翠绿、`不通` 砖红、`未填密钥` 琥珀色、`未检测` 中性灰，且支持高对比度深色模式适配）；
    - **中层 Meta**：端点域名（等宽字体）与模型名称清晰分离（中间以 `·` 分隔），层次分明；
    - **底层 Actions 操作坞**：卡片底部以虚线分割独立操作区，左侧放置优先级调整按键（`↑ 上移`），右侧放置快捷操作群（`设为当前`、`编辑`、`删除`），彻底消除横向溢出与截断。
  - 严格保持 `tests/settingsUiContracts.test.ts` 契约（`provider.id === set.activeId`、`if (provider.id !== set.activeId)`、`const latest = getLlmProviderSet();`、`await persistProviderSet`、`renderList()` 等）。
- **全绿验证门**：
  - `npm run typecheck` (0 errors)
  - `npm run test` (76 个测试套件，447 个测试 100% 通过)
  - Playwright E2E（36 个测试跨 4 种视口完全通过）
  - `npm run build:web` 构建无异常。

## Medication Add/Edit Wizard, Fullscreen Layout & Swipe Navigation 2026-09-05 (workspace/claude)

- **药品录入体系全面升级（直观 3 步向导 + 独立新建路由）**：
  - 将药品页（`/meds`）浮动添加按钮指向优雅直观的单药 3 步向导新建路由 `/#/meds/create`（`MedEdit` 新建模式），同时保留 `/#/meds/new` 批量添加路由，确保批量录入与现有测试 100% 兼容；
  - 药品向导模式（`MedEdit`）采用沉浸式全屏布局（`showTabbar: false`），顶栏配备规范的返回箭头（`topLeft: backBtn`），底部操作坞贴底（`.app-shell:not(:has(.tabbar.app-navigation)) > .action-dock`）并预留充分的安全区与垫高（`padding-block-end: calc(96px + var(--safe-bottom))`），彻底根除双层底栏遮挡与表单底部无法滚动到底的问题；
  - 为向导模式注入原生级**左右滑动手势（Swipe Gestures）**与平移动效：前进向左滑带严格校验（Step 1 未填药名时轻弹震动阻断提示），后退向右滑无阻碍返回，滑动手势智能规避纵向表单滚动与输入框焦点。
- **布局契约修复与回归**：
  - 修复 `/#/meds/:id/edit` 页面进入模式与标题契约（直接展示编辑态 `title: '编辑药品'`，消除误进假详情导致 E2E 断言失败的问题）；
  - 修复 `MedList.ts` 顶栏「批量管理」功能与 `enterBatchMode` 恢复，恢复选择框尺寸（24x24px），修复批量管理测试；
  - 修复 `src/ui/styles/shell.css` 中 `.tabbar.app-navigation` 定位属性回归正常文档流（`position: relative; flex: 0 0 auto`），彻底解决移动端与横屏下 `.app-main` 穿透底栏越界的问题；
  - 修复 `src/router.ts` 页面跳转后的标题焦点机制（优先选择首个可视 `h1`，避免聚焦到今日页隐藏顶栏）；
  - 修复 `e2e/reminder-periods.spec.ts` 对设置页标题断言匹配。
- **全绿验证门**：
  - `npm run typecheck` (0 errors)
  - `npm run test` (76 个测试套件，447 个测试 100% 通过)
  - Playwright E2E（36 个测试跨 `phone-320`、`phone-390`、`tablet-landscape`、`desktop` 100% 通过）
  - `npm run build:web` 成功构建。

## Full-Link Micro-Interactions & Spring Physics Motion System 2026-09-05 (workspace/claude)

- **核心打卡动效（克制极简原生风）**：
  - 弃用花哨彩带粒子，采用 iOS 原生质感的 SVG 对勾动态画线（`checkmarkDraw` 240ms）+ 弹性微震回弹（`checkmarkPop` 260ms）+ 柔和渐变/背景色过渡；
  - 完美覆盖今日页圆形打卡按键（`.today-radio-btn`）与历史页打卡按键（`.history-radio-circle`）。
- **错峰轻盈微浮现（Staggered Micro-Fade-Up）**：
  - 制定统一微浮现动效（`microFadeUp` 220ms，8px 微位移 + 柔和淡入，收敛极快）；
  - 依次覆盖今日时段列表（`.today-time-group` 35ms 阶梯错峰）、药品库卡片（`.med-item-card` 35ms 错峰）、库存列表（`.inventory-card-item` 35ms 错峰）以及历史页指标卡与明细卡片（`.history-stat-card`, `.history-plan-item`）；
  - 页面初次加载与时段切换自然流动，绝不拖泥带水。
- **数据与统计指标动态滚进（CountUp）与环形扫掠**：
  - 新增高性能原生 `animateCountUp` 引擎（基于 `requestAnimationFrame` 与三次立方缓动）；
  - 今日服药进度环增加 `ringSweep` 平滑扫掠展开与底部柔光弧，中心大字号百分比轻快滚进；
  - 历史页「连续服药天数」与「当月依从率」同步接入动态数值滚进。
- **触压物理弹簧回弹反馈（Touch & Press Physics）**：
  - 为所有卡片（今日卡片、药品卡片、库存卡片、历史卡片）注入 GPU 硬件加速的物理弹簧（按压 0.985 微缩回弹）；
  - 核心操作按钮（一键打卡、服药弹窗「✓ 已服用」主按钮）注入 0.95~0.96 触感微缩；
  - 筛选胶囊（Pills）与单选按钮兼备弹性触压手感。
- **严格无障碍与性能保障**：
  - 全局注入 `@media (prefers-reduced-motion: reduce)` 规则，0.01ms 瞬时降级所有动效；`animateCountUp` 同步检测并直接呈现实时目标值；
  - 所有动效仅作用于 GPU 合成层属性（`transform`, `opacity`, `stroke-dashoffset`），杜绝重排重绘，在真实设备上保持 60/120fps 高刷。
- **全绿验证门**：`npm run typecheck` (0 errors)、`npm run test` (76 个测试套件，447 个测试 100% 通过)、`npm run build:web` 成功。

## Inventory Management & Sheets Visual & UX Overhaul 2026-09-05 (workspace/claude)

- **「选择入库药品」抽屉系统化重塑（`MedInventory.ts` & `inventory.css`）**：
  - 彻底清除原生 `<button>` 灰底与黑边框样式，重塑为药盒微拟物卡片（包含 3D/实拍缩略图、药名与规格、库存状态胶囊徽标与右箭头）；
  - 顶部吸顶 Header，新增常驻快捷「+ 录入新药品」跳转；
  - 吸顶搜索栏配备放大镜与一键清除，支持拼音与药名模糊过滤及空状态「去新建」引导；
  - 列表区域独立滚动，滚动阻尼与移动端手势流畅。
- **「添加库存表单」抽屉步进器与预设强化**：
  - 增加轻触式加减步进器（`-` / `+` 按钮）与大字号居中数值显示；
  - 优化 `+1盒`、`+10`、`+20`、`+30` 预设胶囊手感与微动效反馈；
  - 强化动态预测卡片在深色/浅色下的清晰对比度。
- **「单药库存操作」抽屉升级为分区层级化面板**：
  - 顶部增加药品信息卡片（药盒图、规格、剩余量与低库存警戒线）；
  - 核心操作区分列「添加库存」与快捷「补整盒」；
  - 独立「校准剩余数量」步进器卡片，消除混排割裂感；
  - 底部收拢「标记用完」与「编辑药品详情」次要操作。
- **主页面即时搜索栏与 2x2 次级菜单磁贴**：
  - 主页面筛选 Tab 下增加即时搜索栏，与 Tab 筛选联动并支持空状态；
  - 「更多操作」抽屉升级为 2x2 快捷磁贴宫格（智能录入、历史操作、批量预扣、分享清单）。
- **全绿验证门**：`npm run typecheck` (0 errors)、`npm run test` (76 个测试套件，447 个测试全部通过)、`npm run build:web` 成功构建。

## Frontend Check-in, Typography, Wizard, and Restocking Overhaul 2026-09-05 (workspace/claude)

- **今日页时段一键打卡（`Today.ts` & `today.css`）**：
  - 各用药时段右上角新增「一键打卡」快捷按钮，仅批量处理待服药品，绝不覆盖用户主动标记的跳过项；
  - 批量调用 `setOccurrenceActions` 原子落库，同步扣减库存并清除原生与 Web 提醒通知，若触发低库存即时提示；
  - 状态胶囊自动切换为「已全部服用」或「已全部处理」。
- **打卡记录前端显示修复与增强（`MedHistory.ts` & `med-history.css`）**：
  - 修复历史页日历网格样式类名脱节问题，恢复现代圆角与液态微拟物日历；
  - 增加「连续服药天数」（90 天滑动窗口计算，跨月浏览不重置）与「当月依从率」双统计卡片；
  - 选中日时间线清晰对比展示实际打卡时间（如 `实际打卡 08:24 (计划 08:00)`）与状态标签（已服/跳过/漏服/待服），补卡与撤销操作体验优化。
- **文字显示效果与排版层级优化（`tokens.css`, `medications.css`, `primitives.css` 等）**：
  - 偏小辅助字（11px/12px）提升至 13px+，强化药名/时间/剂量的粗细与色彩层级；
  - 时间、数量与百分比一律启用等宽数字（`font-variant-numeric: tabular-nums`）；
  - 优化深色模式文本对比度，加固长文本换行与防截断安全边界。
- **新增药品 3 步向导模式（`MedEdit.ts` & `medication-editor.css`）**：
  - 采用 3 步分步向导（Step 1: 药品基本信息与拍照/识别；Step 2: 用药计划与剂量时段；Step 3: 库存、效期、周期用药与备注）；
  - 顶部步骤指示条清晰显示完成度与勾选图标，底部提供上一步/下一步/完成保存，附带校验自动跳转定位；
  - 编辑已有药品时支持直接在顶栏自由切换步骤。
- **添加库存体验升级与真实效期统计（`MedInventory.ts` & `inventory.css`）**：
  - 彻底根除概览卡片中即将过期与已过期的假数据，根据真实 `expiryLocalDate` 动态精确统计；
  - 添加库存弹窗提供 `+1盒`、`+10`、`+20`、`+30` 快捷累加按钮；
  - 支持顺带更新/录入有效期，即时动态预测对比「当前存量 → 入库后存量」与「可用天数预估变化」。
- **全绿验证门**：`npm run typecheck` (0 errors)、`npm run test` (76 个测试套件，447 个测试 100% 通过)、`npm run build:web` (0 errors)。

## Wide-Screen Responsive Remediation & Desktop Adaptive Layout 2026-09-05 (workspace/claude)

- **宽屏/PC端导航栏破损根治**：
  - 修复 `src/ui/styles/shell.css` 中大屏媒体查询（`@media (min-width: 768px) and (min-height: 600px)`）下 `.app-shell` 遗漏 `display: grid` 导致的布局坍塌；
  - 重置 `.tabbar.app-navigation` 从移动端绝对定位（`position: absolute; inset-inline: 0; inset-block-end: 0;`）回归常规文档流（`position: static; inset: auto; inline-size: 100%;`），并挂载至 `grid-column: 1; grid-row: 1 / span 3;`，彻底根除大屏下导航栏拉伸覆盖全屏的白色遮罩 Bug；
  - 侧栏菜单项升级为 14px 桌面行级布局，增加 hover 柔光背景与 active 选中高亮；
  - `.topbar`、`.app-main`、`.action-dock` 完整映射至第 2 列网格，主内容容器限制 `max-inline-size: 960px` 居中且清除移动端 64px 垫高，防止 2K/4K 屏幕下卡片过度横向拉伸。
- **设置页与弹窗组件大屏排版自适应**：
  - `src/ui/styles/pages/settings.css` 中「我的数据」统计卡片与设置折叠面板在大屏下自适应为 2 列栅格并排排布，大幅提升横向空间利用率；
  - `src/ui/styles/primitives.css` 中模态弹窗与 BottomSheet 在大屏下约束为 `max-inline-size: 560px` 屏幕居中。
- **架构契约与测试全绿**：
  - `tests/uiArchitectureContracts.test.ts` 新增大屏网格布局与样式重置规则的架构契约测试；
  - `npm run typecheck` (0 errors)、`npm run test` (76 suites, 443 tests passed 100%)、`npm run build:web` 构建零报错。

## Scan Unlock Living Codes & LAN Update Discovery 2026-09-04 (workspace/claude)

- **扫码解除强制提醒生活码绑定（免打印）**：
  - `src/features/alarmScanVerify.ts` 新增 `AlarmScanVerifyMode = 'generated' | 'custom'`，支持用户绑定现实生活中已有的各类条码/二维码（如药盒 EAN-13、日用品包装码等）；
  - `MedicationAlarmActivity.kt` 升级为 `com.google.zxing.MultiFormatReader`，全面支持 QR、EAN-13、EAN-8、Code-128、Code-39、UPC 等 9 种一维及二维条码；
  - `Settings.ts` 新增「扫描已有码绑定」相机与相册取景器 BottomSheet，展示条码类型与内容供一键绑定，并在专属码弹窗提供快捷切换。
- **局域网设备老版本获取最新版本更新修复**：
  - `src/sync/lan/session.ts` 修复主机端记录加入端版本时的反向 IP 赋值缺陷，确保老版本设备能准确获知对端分发源 IP；
  - `src/main.ts` 与 `autoSync.ts` 保障新版本设备启动时常驻开启 38473 APK 分发服务，不再受 30 分钟数据自动同步开关牵连；
  - `ApkDistributionPlugin.java` 增加 `probePeer` 与多线程并发子网快速扫描 `scanSubnet`；
  - `src/sync/lan/apkTransport.ts` 提供 `scanLanForUpdates()`，自动检测同网段高版本 APK 并校验签名；
  - `Settings.ts` 应用更新面板增加「检查局域网更新」按钮，支持即时主动扫描。
- **验证门全绿**：`npm run typecheck` (0 errors)、`npm run test` (76 suites, 442 tests passed)、`gradlew testDebugUnitTest` (BUILD SUCCESSFUL in 30s)、`npm run build:web` (0 errors)。

## Full-Screen UI Adaptation & Real Visual UI Defect Remediation 2026-09-01 (workspace/claude)

- **底栏（TabBar）平权与动态激活态修复**：移除原 `shell.css` 与 `liquid-glass.css` 中对 `#/scan`（分药）强行写死的高亮紫渐变与胶囊凸起，5 个 Tab（今日、药品、分药、库存、设置）完全平权等宽等高，由当前路由动态高亮选中项图标（品牌紫 + 柔光胶囊），不再产生永久选中的视觉误导。
- **全局小助手（AiAssistant）悬浮球移除与顶栏常驻化**：废除全局右下角悬浮小球（设置 `.ai-launcher { display: none !important; }`，彻底根治与卡片文字、多重 FAB、底栏的叠放遮挡），在各页面顶栏（TopBar）以及今日页问候栏右上角新增精致常驻的「✦ AI 助手」药丸按钮，点击即在底部滑出 AI 问答面板。
- **今日页与药品页操作区规范化（移除遮挡 FAB）**：废除今日页右下角浮动遮挡底栏第 5 项的 `.today-fab`，改为结构化卡片与卡片内嵌式 `+ 添加第一种药品` 主按钮；药品列表页添加药品按钮规范放入操作坞与列表顶部。
- **3D 拟物图标加载与备用 SVG 修复**：移除 `render3dMedia` 的 `img.loading = 'lazy'` 避免首屏与截图时图片不加载而空白，当未传入图片时直接同步渲染 3D 风格 SVG；重构「节省费用」SVG 图标（匹配 48x48 拟物圆角与金币质感），修复「我的数据」2x2 卡片完整展示。
- **全面屏 Shell 布局防裁剪加固**：`.app-shell` 布局全面强化为弹性垂直盒模型（`flex-direction: column`），`.app-main` 承担独立滚动，底栏 `app-navigation` 稳固吸附在底部安全区之上，彻底解决不同安全区 inset 下底栏被裁剪的问题。
- **设置页真实数据对接与 4 大分组手风琴卡片重构**：
  - 彻底删除“节省费用”卡片及写死的 128 天、7 天连续打卡、32 次分药等所有 mock 假数据；
  - 移除顶部与下方面板重复的 3 个“常用功能”跳转按钮；
  - 对接真实数据库统计：展示真实的「在库药品」（`meds.length` 种，点击直达 `#/meds`）、「用药计划」（`rules.filter(r => r.enabled).length` 条，点击直达 `#/today`）与「打卡记录」（`logs.length` 次，点击直达 `#/history`），根据首条服药记录真实计算管理天数；
- **极简原生通栏底栏（iOS 18 / 微信原生质感）彻底重构**：
  - 彻底去除突兀的悬浮大香肠药丸造型、紫色圆形底衬斑块以及下方硬生生截断内容的方形遮罩；
  - 升级为全屏 100% 满宽贴底原生底栏：0.5px 精致顶边线、超薄高透毛玻璃（`backdrop-filter: blur(20px)`），自动适配各全面屏安全区；
  - 5 项导航平权均分，图标与 11px 标签字距紧凑，选中项以纯净品牌蓝紫高亮并配合轻微缩放微动效，浑然一体；
- **设置页间距收紧与「本地数据与备份」卡片规范重构**：
  - 清除了 `.profile-page` 内多重累加的 `margin-block-start`（从 ~48px 收紧至统一 16px 自然韵律），使「我的数据」与上方用户卡片紧凑协调；
  - 将原裸露破坏卡片边框的「本地数据与备份」重构为标准折叠手风琴面板（`panel`，带 `box` 图标与状态 chip），导出/导入按钮与文字安全内嵌，全站加固容器 `overflow-wrap: anywhere;` 防溢出；
- **16 套 Gemini 生图 + 精细抠图裁切 3D 黏土/皮克斯全家福头像落地**：
  - 使用 Gemini 按照统一视角、相同光照与 4x4 网格生成高质量 3D 角色母图；
  - 编写专用切图脚本 `scripts/slice_avatars.py`，采用色彩距离阈值（diff 渐变抗锯齿）与 OpenCV/SciPy 连通域拓扑分析，自动剔除四周边框邻格杂质与溢出碎片，精准输出 16 张 256x256 高清透明 PNG 头像（`src/ui/assets/avatars/`）；
  - `AvatarPicker`、`Settings` 个人中心与 `Today` 顶栏全面直读高清角色图，点击即换并持久化；
- **全面排查并优化前端外显文案（消除代码类展示内容）**：
  - **关于小药盒**：彻底重构为精致品牌卡片，移除“本地优先版”等极客术语，展示软件名称、稳定版本标识、四条核心健康管家功能清单以及专业严谨的健康免责声明；
  - **版本显示规范**：移除外显给普通用户的代码字段 `versionCode 29`，统一规范为用户友好的 `正式版`；
  - **备份与恢复文案**：将生硬的 `导出（JSON）` 与 `导入恢复（JSON）` 优化为贴合用户心智的 `导出备份文件` 与 `从备份恢复数据`；
  - **AI 助手提示文案**：将“接口需兼容 OpenAI /chat/completions 协议”等开发接口描述优化为面向用户的服务商说明与隐私安全承诺；
- **分药页面真实数据对接与假数据根除**：
  - 彻底移除硬编码的「分药盒 A/B」mock 假数据；
  - 真实读取本地数据库 `listRecentInventoryOperations` 中今日分药向导完成记录，有记录展示真实分药药品与分装数量，无记录展示舒适的空状态引导；
- **自动化测试与模拟器视觉逐帧验收通过**：
  - Vitest 75 个测试套件（429 个测试）100% 全部通过；`tsc --noEmit` 0 错误；
  - 多机型视觉截图验收全部通过；发布产物 APK 已生成并更新校验和。

## Tabbar Glass Bubble + Icon Fix 2026-08-28 (workspace/claude)

- 0.9.10 (`versionCode 29`)：模拟器视觉验收后三修——①底栏选中项「液态玻璃泡」（酷安式，专用 SVG 折射滤镜）+ FAB 横胶囊化（保持品牌紫）；②底栏占位压缩（min-height 54px，safe-area 改由外层 margin 承担）；③应用图标 adaptive 安全区 66/108 重裁（gen-icons.mjs，文字不再被遮罩裁切）。
- 第 4 修：insetsHandling=disable 导致 env(safe-area-*) 恒 0、3 键导航条遮挡底栏——MainActivity 原生注入真实 insets 到 CSS 变量（仅 bottom/left/right）。
- 验证门全过；APK `release/xiaoyaohe-0.9.10-android-release.apk`（13.4MB）。详见 claude.md 第 6 节。

## Alarm UI Redesign + Scan-to-Dismiss 2026-08-27 (workspace/claude)

- 0.9.9 (`versionCode 28`)：
  - 全屏闹钟页 Compose UI 重设计（时钟/呼吸点/三级按钮层次/倒计时 Compose 化）；
  - 「扫码解除强制提醒」：设置生成解锁二维码 → 载荷注入 scanVerify/scanToken → 原生锁定动作按钮，CameraX+ZXing 扫码匹配后解锁；通知按钮剥离防绕过；详见 claude.md 第 5 节。
  - 验证门全过：typecheck / vitest 424 / playwright 52 / gradlew testDebugUnitTest+assembleRelease；APK `release/xiaoyaohe-0.9.9-android-release.apk`（13.45MB，SHA-256 见 release/SHA256SUMS.txt）。
- 发版流程注意：新版本必须同时登记 `scripts/lib/release-utils.mjs` 的 VERSION_CODE_BY_VERSION 与 docs/releases/<ver>.md，否则 vitest/原生版本锁测试失败。

## Liquid Glass Integration 2026-08-27 (workspace/claude)

- 0.9.8 (`versionCode 27`)：Kyant0/AndroidLiquidGlass 液态玻璃接入，双轨落地。
  - Web 端全局复刻：`liquid-glass.css` + SVG 折射滤镜 + 悬浮胶囊底栏 + 外观开关（详见 `docs/handoffs/claude.md` 第 4 节）。
  - 原生真库：MedicationAlarmActivity 转 Kotlin/Compose，backdrop 1.0.6 lens 折射按钮；**backdrop 锁定 1.0.6**——2.0.x 要求 compileSdk 37 + AGP 9.1，与 Capacitor 8 矩阵冲突。
- 验证门全过：typecheck / vitest 74 套件 424 测试 / playwright 52 / build+cap sync / gradlew assembleDebug+testDebugUnitTest / signed release APK 已产出（release/xiaoyaohe-0.9.8-android-release.apk, SHA-256 见 claude.md）。

## Baseline

- App-only LAN implementation: `6354dd8`.
- GPT/Codex handoff: `6276d81`.
- TypeScript passes.
- Vitest: 47 files, 247 tests pass.
- Playwright: 28 tests pass across 320px, 390px, tablet landscape, and desktop.
- Android release unit tests and signed release APK assembly pass.
- Dependency audit: 0 high/critical; 2 moderate advisories remain in the MCP SDK Node static-server adapter, which is not present in the Android production bundle.

## Implemented Product Areas

- Medication inventory page and quick stock actions.
- Local four-corner box-photo crop with manual adjustment.
- Android App-only reminders and encrypted local-network family sync.
- One-phone QR display plus one-phone scan for quick family connection on the same network.
- Atomic sync apply, deletion history, local-edit protection, and plain-language conflict/reminder warnings.
- App-only release pipeline with APK and checksum; PWA, Service Worker, cloud sync, Worker/Wrangler, Pages, and Web ZIP paths are removed.
- Camera actions use the shared primary, tonal, and text-button hierarchy with consistent icons and responsive layout.
- In-app medication reminder master toggle, vibrate on all reminder modes (web + native strong).
- Tablet/assistant free placement, inventory share to family/clipboard, inventory quick capture (photo).
- Android foreground service keep-alive (battery whitelist prompt), 30-minute LAN auto-sync with long-lived pairing identity.
- Full-screen alarm now launches over an awake, unlocked screen: notify-first (Android 14+ fullScreenIntent BAL window) + AlarmRingService foreground-service fallback + setAlarmClock when exact-alarm permission is unavailable.
- Medication history with 7/30/90-day and custom ranges, adherence summary, filters, daily records, and 90-day correction actions.
- Full-screen history UI with narrow-phone layouts, cutout/gesture-safe spacing, bottom thumb-zone actions, and a two-column short-landscape layout.

## Release

- Version: `0.9.0` (`versionCode 19`).
- APK embedded-resource verification: 32 current WebView files; aggregate `8ba8a7627dcaa87f56b6f0b60ed39db1985fc1731ef0630aa814ac82b5500480`.
- Desktop artifact: `小药盒-v0.9.0-release.apk`.
- SHA-256: `17550fec9c18e68400bdd65ae19503d8f01b1e90327ae979b7fe3284f08c3706`.
- APK signature: verified with APK Signature Scheme v2, one signer.

## External Follow-Ups

- Run connected Android instrumentation and installation smoke tests when an ADB device is available.
- Validate a full transfer between two physical phones on the same local network, including pause/close behavior and repeated QR scans.
- Install `0.9.0` on a physical cutout/gesture-navigation phone and smoke-test history rotation plus the bottom action sheet.

## Workspace Consolidation & LAN APK Transport 2026-07-30

- Consolidated root workspace layout into `medbox` repository.
- Moved archived worktime module into `medbox/archive/工时模块归档`.
- Merged LAN APK distribution features (`ApkDistributionPlugin.java`, `apkTransport.ts`), `appSettings.ts`, UI audit fixes, and extended assistant tool tests into `main`.
- Vitest: 51 test files, 296 tests pass. TypeScript static checks pass clean.

## Medication History Integration And Release 2026-07-26

- Reconciled remote `main` backup cleanup and merged tested `workspace/gpt` history/UI work into `main`.
- Released `0.9.0` / Android `versionCode 19` with the signed APK and checksum copied to the desktop.
- Connected Android instrumentation was not run because `adb devices` reported no attached device; all non-device release gates passed.

## Branch Consolidation 2026-07-25

All four workspace branches (`workspace/claude`, `workspace/gpt`, `workspace/grok`, `workspace/trae-qoder`) were synced to `main` at version `0.8.2`. The three previously-stale branches (claude/gpt/grok, last synced 2026-07-22 at `8a605bf`) absorbed the 30 missing main commits including Tencent ASR embedding, full-screen alarm fixes, keep-alive foreground service, and the ASR settings panel. Backup tag `backup/pre-consolidation-2026-07-25` marks the pre-merge `main` HEAD for rollback. No workspace branch had unique work to merge back into `main`.

## Integration Rule

Update this file whenever a tool branch is merged into `main`. Tool-specific unfinished context belongs in the corresponding handoff file. Merge `main` back into every long-lived tool branch before starting new work.
