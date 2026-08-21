# Claude Handoff

Tool: Claude
Branch: `workspace/claude`
Updated: 2026-08-21
Status: active
Latest version: `0.9.7` (Android `versionCode: 26`)

## Summary of Accomplished Work

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
- **生产构建与原生同步**：`npm run build` + `npx cap sync android` + `.\gradlew.bat assembleRelease` 顺利完成。
- **正式版 APK 产物**：`xiaoyaohe-0.9.7-android-release.apk` 已生成并同步至桌面（SHA-256: `8e59d053fd6f630c3c568591f3c02a0641f6b71c956d5e9117cb3947eacf9353`）。
