# GPT/Codex Handoff

Tool: GPT/Codex
Branch: `workspace/gpt`
Updated: 2026-07-19
Status: complete, awaiting integration
Latest implementation commit: `e4d05b6 feat: refocus app as Xiaoyaohe`
Integrated into `main`: no

## Goal

Refocus the product as the medication-only Android app “小药盒”: remove the work-hours module, promote inventory into the fourth primary navigation slot, purge retired work data, preserve all medication behavior, and archive the removed work source for a future standalone app.

## Completed

- Renamed all current product-facing Web and Android surfaces to “小药盒”.
- Changed the package/release name to `xiaoyaohe`, version to `0.8.0`, and Android `versionCode` to `16` while preserving `com.medbox.app` and medication storage identifiers.
- Replaced the Work bottom tab with Inventory at `/meds/inventory`; Inventory is now a top-level page with no back button.
- Removed the Work route, module, page, IndexedDB layer, income calculations, schemas, backup provider, AI tools, styles, fixtures, illustrations, and dedicated tests.
- Kept legacy backup files readable: old work fields are accepted as ignored input and are never imported or counted.
- Added startup cleanup for `medbox-work`, `medbox.lastWorkEntry`, and stored AI consent records in the retired `work` category.
- Updated the assistant prompt, quick actions, navigation cards, settings copy, release filenames, and design prompt metadata for medication-only behavior.
- Created a non-runnable source archive outside the Git repository at `C:\Users\87850\Desktop\日常工具箱手机端网页端\工时模块归档` with original source, tests, prompts, source commit, and migration notes.

## Verification

- `npm test`: 43 files, 171 tests passed.
- `npm run cap:sync`: TypeScript, Vite production build, and Capacitor Android sync passed.
- `npx playwright test`: 28 tests passed across 320px, 390px, tablet landscape, and desktop.
- `android\gradlew.bat testDebugUnitTest assembleDebug`: passed, 167 tasks.
- Production build contains no Work route, Work UI strings, or retired Work assistant tools; only the intentional storage cleanup identifiers remain.
- `git diff --check`: passed.
- APK: `release/xiaoyaohe-0.8.0-android-debug.apk`.
- APK SHA-256: `3207db8afb3e2973ef3da594c23a59e3633123433fc281b4e0e640f4d684b164`.
- APK embedded WebView verification: 31 files, aggregate hash `1ca3bfbc04e304bf8db7fd63dc45bb3b4dc4d2ca44db756a83c3e4f0a0da7ac1`.

## Remaining Work

- Integrate `workspace/gpt` into `main` only after the existing uncommitted changes in the main worktree are preserved or committed.
- Optionally install `0.8.0` over `0.7.8` on a physical Android device to confirm the launcher name and retired `medbox-work` deletion in a real WebView profile.

## Notes

- The source archive is intentionally outside this Git repository and is not included in commit `e4d05b6`.
- Release APK/checksum files remain ignored local artifacts.
- The application ID, medication IndexedDB, notification keys, sync identifiers, and existing medication data remain compatible with upgrades.
