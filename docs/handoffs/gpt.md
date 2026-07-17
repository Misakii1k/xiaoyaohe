# GPT/Codex Handoff

Tool: GPT/Codex
Branch: `workspace/gpt`
Updated: 2026-07-17
Status: idle
Latest implementation commit: `6354dd8 feat: ship app-only LAN family sync`
Integrated into `main`: `4a0a41e merge: integrate app-only LAN family sync`

## Goal

Ship Medbox `0.7.7` as an Android App-only release. Family sync must stay on the local network, connect quickly with one QR scan, use plain-language UI copy, and no longer ship or maintain a PWA/cloud-sync deployment path. Also align the camera action buttons with the app's shared visual hierarchy.

## Completed

- Added encrypted LAN TCP family sync with a native Android transport, one-QR invitation flow, atomic receive/apply behavior, conflict warnings, deletion history, and strict cross-entity reference checks.
- Reworked Settings around local family sync using non-technical explanations and clear host/join/stop actions.
- Removed the PWA, Service Worker, Pages/Web ZIP, Cloudflare Worker/Wrangler, cloud sync v2, old cloud credentials, and obsolete outbox/metadata paths. Existing AI keys remain untouched.
- Preserved local edits and inventory deductions during sync; inventory-only changes cannot override real medication edits.
- Kept reminders App-only and added plain-language warnings when reminder rescheduling fails.
- Updated product version to `0.7.7` and Android `versionCode 14`.
- Replaced the camera action mismatch: deep-purple primary `拍照`, tonal `相册上传`, and text `返回`, with matching Lucide icons, a stable 320px two-column layout, visible keyboard focus, and aligned tablet width.
- Added real-browser camera-button regression coverage and updated the visual IndexedDB fixture to schema version 6.
- Updated the release pipeline to publish an APK and checksum only.

## Files Changed

- LAN sync: `src/sync/lan/`, `src/db/local.ts`, `src/pages/Settings.ts`, `src/ui/styles/pages/settings.css`.
- Android transport: `android/app/src/main/java/com/medbox/app/lansync/` and matching unit tests.
- App-only cleanup: `src/sync/v2/`, `worker/`, deployment scripts/config, reminder transport, startup cleanup, and release utilities.
- Camera UI: `src/pages/ScanSort.ts`, `src/ui/styles/pages/scanner.css`, `tests/scannerUiContracts.test.ts`, `e2e/camera-actions.spec.ts`.
- Version/release/docs: `package*.json`, `android/app/build.gradle`, `docs/plans/`, `AGENTS.md`, and `docs/worktrees/README.md`.

## Verification

- `npm run typecheck`: passed.
- `npm test`: 43 files, 186 tests passed.
- `npx playwright test`: 20 tests passed across 320px, 390px, tablet, and desktop.
- `npm audit --audit-level=low`: 0 vulnerabilities.
- `npm run build:web`: passed; 27 production web files.
- `npx cap sync android`: passed.
- `android\\gradlew.bat testDebugUnitTest assembleDebug`: passed, 167 tasks.
- APK embedded-resource verification: 27 current WebView files, aggregate hash `3cb50e24a956e5cf2dc4c075affb61151fa496276d6c4003a530709ad272a129`.
- Local APK: `release/medbox-0.7.7-android-debug.apk`, SHA-256 `045b77847332562f2b283af1c57d871609057de7b46b348a9eb409dc4ec07f3e`.
- No `medbox-0.7.7-web.zip` exists.
- `git diff --check`: passed before commit.

## Uncommitted Changes

None. Release APK/checksum and browser screenshots are intentionally ignored local artifacts.

## Remaining Work

- Run installation smoke tests and two-phone LAN transfer tests when Android devices are available. `C:\Android\Sdk\platform-tools\adb.exe devices -l` currently reports no devices.

## Decisions And Risks

- Family sync is Android App-only. The browser is a development preview and does not provide native LAN transfer or reminders.
- Both phones must be on the same local network. One phone shows the QR code and the other scans it; there is no cloud account or remote relay.
- Transfers abort if local data changes during receipt instead of silently overwriting it. Simultaneous edits are reported in plain language.
- Connected Android instrumentation, API 35/36 installation, pause/close behavior, repeated QR scans, and a real two-phone transfer remain unverified because no ADB device is attached.
