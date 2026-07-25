# Current Integration State

Updated: 2026-07-25
Integration branch: `main`
Product version: `0.8.2`
Latest integration commit: `0224291 chore: bump version to 0.8.2`

## Baseline

- App-only LAN implementation: `6354dd8`.
- GPT/Codex handoff: `6276d81`.
- TypeScript passes.
- Vitest: 46 files, 204 tests pass.
- Android debug unit tests and APK assembly pass.
- Dependency audit reports 0 vulnerabilities.

## Implemented Product Areas

- Medication inventory page and quick stock actions.
- Local four-corner box-photo crop with manual adjustment.
- Android App-only reminders and encrypted local-network family sync.
- One-phone QR display plus one-phone scan for quick family connection on the same network.
- Atomic sync apply, deletion history, local-edit protection, and plain-language conflict/reminder warnings.
- App-only release pipeline with APK and checksum; PWA, Service Worker, cloud sync, Worker/Wrangler, Pages, and Web ZIP paths are removed.
- Camera actions use the shared primary, tonal, and text-button hierarchy with consistent icons and responsive layout.
- In-app medication reminder master toggle, vibrate on all reminder modes (web + native strong).
- Tablet/assistant free placement, inventory share to family/clipboard, inventory quick capture (photo/voice).
- Android foreground service keep-alive (battery whitelist prompt), 30-minute LAN auto-sync with long-lived pairing identity.
- Full-screen alarm now launches over an awake, unlocked screen: notify-first (Android 14+ fullScreenIntent BAL window) + AlarmRingService foreground-service fallback + setAlarmClock when exact-alarm permission is unavailable.
- Standalone Tencent ASR settings panel (masked secrets, edit-to-unlock, clear confirmation), Web-preview secret persistence via localStorage, error toast when key save fails.
- ASR settings panel edit/save button swap logic corrected (edit→save on edit, save→edit on save/clear).

## Release

- Version: `0.8.2` (`versionCode 18`).
- APK embedded-resource verification: 31 current WebView files.
- Expected local artifact: `小药盒-v0.8.2-release.apk` on desktop.
- SHA-256: see desktop artifact checksum after build.
- Tencent Cloud ASR embedded directly in the app (no separate proxy server required).

## External Follow-Ups

- Run connected Android instrumentation and installation smoke tests when an ADB device is available.
- Validate a full transfer between two physical phones on the same local network, including pause/close behavior and repeated QR scans.

## Branch Consolidation 2026-07-25

All four workspace branches (`workspace/claude`, `workspace/gpt`, `workspace/grok`, `workspace/trae-qoder`) were synced to `main` at version `0.8.2`. The three previously-stale branches (claude/gpt/grok, last synced 2026-07-22 at `8a605bf`) absorbed the 30 missing main commits including Tencent ASR embedding, full-screen alarm fixes, keep-alive foreground service, and the ASR settings panel. Backup tag `backup/pre-consolidation-2026-07-25` marks the pre-merge `main` HEAD for rollback. No workspace branch had unique work to merge back into `main`.

## Integration Rule

Update this file whenever a tool branch is merged into `main`. Tool-specific unfinished context belongs in the corresponding handoff file. Merge `main` back into every long-lived tool branch before starting new work.
