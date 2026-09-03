# Claude Handoff

Tool: Claude
Branch: `workspace/claude`
Updated: 2026-09-01
Status: active
Latest version: `0.9.10` (Android `versionCode: 29`)

## Summary of Accomplished Work

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
