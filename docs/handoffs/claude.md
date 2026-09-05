# Claude Handoff

Tool: Claude
Branch: `workspace/claude`
Updated: 2026-09-05
Status: active
Latest version: `0.9.11` (Android `versionCode: 30`)

## Summary of Accomplished Work

### 16. 全屏闹钟生活二维码/条形码解锁识别引擎重构与就地试验闭环 (0.9.11)

针对用户反馈的「选择生活中的二维码后，在全屏闹钟解锁试验情况下无法正常识别解锁」问题，深入底层排查 Android CameraX + ZXing 条码识别管线与解锁闭环，完成彻底重构：

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
   - **交互与就地验证闭环**：
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

- **前后端打卡动作桥接闭环修复**：
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
