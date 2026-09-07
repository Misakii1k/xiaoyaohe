# Current Integration State

Updated: 2026-09-07
Integration branch: `main`
Product version: `0.9.14`
Latest integration commit: `merge: integrate workspace consolidation and LAN APK transport features`

## Fullscreen Reminder Home Guard, Scan Anti-Bypass & Camera Vibration Mute 2026-09-07 (workspace/claude)

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
  - 产物：`release/xiaoyaohe-0.9.14-android-release.apk`（18,644,659 字节，SHA256: `b6c88b5b47e652f5dd57c7c4d445117d982156298318f5f6eb17a3956e92b6c9`），94 个内嵌资产校验通过，已复制至用户桌面 `C:\Users\87850\Desktop\`。

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
  - 发布产物：已输出至 `medbox/release/xiaoyaohe-0.9.11-android-release.apk` (18,623,579 字节，SHA256: `acee36d280de7a631a6d4a4f6a32f4b4191cf1398dda4a4e43eb8044c46ab447`)，并已同步复制至用户桌面 `C:\Users\87850\Desktop\xiaoyaohe-0.9.11-android-release.apk`。

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
  - 发布产物：已输出至 `medbox/release/xiaoyaohe-0.9.11-android-release.apk` (18,623,579 字节，SHA256: `f8e3ef152f15732ec05947c2f36623ad4de21c39eb04ac5137088b9f8c1261f2`)，并已同步复制至用户桌面 `C:\Users\87850\Desktop\xiaoyaohe-0.9.11-android-release.apk`。

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
  - 发布产物：已输出至 `medbox/release/xiaoyaohe-0.9.11-android-release.apk` (18,623,587 字节) 并复制至用户桌面 `C:\Users\87850\Desktop\xiaoyaohe-0.9.11-android-release.apk`。

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
