# Claude Handoff

Tool: Claude
Branch: `workspace/claude`
Updated: 2026-08-27
Status: active
Latest version: `0.9.8` (Android `versionCode: 27`)

## Summary of Accomplished Work

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
