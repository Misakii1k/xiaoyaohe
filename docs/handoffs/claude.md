# Claude Handoff

Tool: Claude
Branch: `workspace/claude`
Updated: 2026-08-11
Status: idle
Latest commit: `02537de feat(ui): enable dark mode (system + settings toggle)`

## Goal

本轮完成 UI 架构抽重复与深色模式支持（稳健模式），共 3 个独立 commit，运行在 `workspace/claude` 分支，未修改任何业务行为/数据结构/提醒/同步逻辑，全程未打扰 `main`。

## What Landed on `workspace/claude` (2026-08-11)

1. `f773aee refactor(ui): unify field() into shared components.ts helper`
   - 扩展 `components.ts` 的 `field()` Helper（支持 `hint` 选项及 composite 非表单控件 `role="group"` / `aria-labelledby` 绑定）。
   - 删除 `Settings.ts` / `MedEdit.ts` / `ScanSort.ts` / `llmProviderEditor.ts` 本地重复的 `field` / `fieldLite`，统一使用共享实现。
   - 删除无调用方的 `src/ui/primitives/FormField.ts`。

2. `07141aa refactor(ui): route wizards through openBottomSheet`
   - 为 `BottomSheetOptions` 扩展 `dismissOnOverlay` 和 `dismissOnEscape` 控制参数。
   - `MedOnboardWizard.ts` 与 `SortWizard.ts` 删除了自写的 `overlay` 创建、焦点陷阱、Escape / 背景点击处理，全量委托给 `openBottomSheet` 底座。
   - `AiAssistant.ts` 的弹出菜单保留非模态 popover 交互。

3. `02537de feat(ui): enable dark mode (system + settings toggle)`
   - 新建 `src/ui/theme.ts`，支持 `system` / `light` / `dark` 偏好管理、`localStorage` 持久化 (`medbox.theme-preference`)、OS 深色模式动态监听、`meta[name="theme-color"]` 及 `document.documentElement.dataset.theme` 动态同步。
   - `main.ts` 在加载 CSS 后立即调用 `initTheme()`，防止首屏主题闪烁。
   - `tokens.css` 配置 `color-scheme: light dark;` 并补齐 `:root[data-theme='dark']` 与 `@media (prefers-color-scheme: dark)` 暗色变量。
   - `Settings.ts` 新增「外观」设置面板，支持一键切换配色方案。
   - 新增 `tests/theme.test.ts` 单元测试。

## Verification

- `npm run typecheck`：通过（`0 errors`）。
- `npm run test`：73 个测试文件 / 417 个单元/契约测试全部通过。
- `npm run build`：打包输出正常。
- `npx playwright test`：52 个 E2E 自动化测试全数通过。

## Remaining / Handover

- 当前 3 个 commit 保留在 `workspace/claude` 分支，可由集成流程合并至 `main`。
- 本机无 Android SDK，Android 真机/模拟器上的深色模式视觉与向导动画需用户在真机上最终确认。
