# Current Integration State

Updated: 2026-09-02
Integration branch: `main`
Product version: `0.9.11`（新增 Gemini 3D 全家福头像库、去代码化文案优化，versionCode 30 发布打包完成）
Latest integration commit: `merge: integrate workspace consolidation and LAN APK transport features`

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
