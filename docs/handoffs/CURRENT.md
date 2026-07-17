# Current Integration State

Updated: 2026-07-17
Integration branch: `main`
Product version: `0.7.7`
Latest integration commit: `4a0a41e merge: integrate app-only LAN family sync`

## Baseline

- App-only LAN implementation: `6354dd8`.
- GPT/Codex handoff: `6276d81`.
- TypeScript passes.
- Vitest: 43 files, 186 tests pass.
- Playwright: 20 tests across 320px, 390px, tablet, and desktop pass.
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

## Release

- Version: `0.7.7` (`versionCode 14`).
- APK embedded-resource verification: 27 current WebView files.
- Expected local artifact: `release/medbox-0.7.7-android-debug.apk`.
- SHA-256: `a3329e4fcd124ff34d347041575be3486fabda54466fd4880eee939fbc3e0112`.
- Release APK/checksum files remain ignored local deliverables and are not stored in Git history.

## External Follow-Ups

- Run connected Android instrumentation and installation smoke tests when an ADB device is available.
- Validate a full transfer between two physical phones on the same local network, including pause/close behavior and repeated QR scans.

## Integration Rule

Update this file whenever a tool branch is merged into `main`. Tool-specific unfinished context belongs in the corresponding handoff file. Merge `main` back into every long-lived tool branch before starting new work.
