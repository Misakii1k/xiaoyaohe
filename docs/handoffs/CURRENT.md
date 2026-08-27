# Current Integration State

Updated: 2026-08-28
Integration branch: `main`
Product version: `0.9.10`（workspace/claude 分支已发布，待合并 main）
Latest integration commit: `merge: integrate workspace consolidation and LAN APK transport features`

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
