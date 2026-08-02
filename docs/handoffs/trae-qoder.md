# Trae/Qoder Handoff

Tool: Trae/Qoder (QoderWork)
Branch: `workspace/trae-qoder`
Updated: 2026-07-23
Status: done — awaiting user device verification
Latest commits: `6b3810e` (ASR save error toast + lock sync), `c2b7ef3` (full-screen alarm fix), merge of `main` (25 commits incl. ASR embed, 0.8.1 bump)

## Goal (completed this session)

Fix three user-reported issues on the installed 0.8.0 APK:

1. Full-screen reminders only showed as heads-up notifications when the screen was on and unlocked.
2. In-app version text still read 0.8.0.
3. Tencent Cloud ASR keys could not be configured/saved from the settings UI.

## What was done

- Merged `main` (25 commits) into `workspace/trae-qoder`. This brings in the embedded Tencent ASR settings UI (`src/pages/Settings.ts` + `src/ai/asrConfig.ts` + `src/ai/secretStore.ts` SecureStorage persistence), the 0.8.1 version bump, keep-alive service, boot receiver, and earlier alarm hardening.
- `MedicationAlarmContract.showNotification()`: restructured to notify-first (Android 14+ grants a BAL window after posting a fullScreenIntent notification), then `startActivity` within that window; previously the activity launch was only attempted when the full-screen permission was *denied*, so unlocked devices always got heads-up.
- New `AlarmRingService`: foreground-service fallback that launches `MedicationAlarmActivity` when the direct startActivity is blocked (BAL / OEM restrictions). Registered in `AndroidManifest.xml` with `foregroundServiceType="dataSync"`.
- `MedicationAlarmContract.schedule()`: when exact-alarm permission is unavailable, use `setAlarmClock` (always exact + grants launch window) instead of inexact `setAndAllowWhileIdle`.
- `Settings.ts`: both `setAsrConfig` call sites wrapped in try-catch with error toast (previously a SecureStorage failure was a silent unhandled rejection).
- `package-lock.json` version synced to 0.8.1 (release script validates lock == package version).

## Files changed

- `android/app/src/main/java/com/medbox/app/MedicationAlarmContract.java`
- `android/app/src/main/java/com/medbox/app/AlarmRingService.java` (new)
- `android/app/src/main/AndroidManifest.xml`
- `src/pages/Settings.ts`
- `package-lock.json`

## Tests

- `tsc --noEmit`: clean
- Vitest: 46 files / 203 tests passed (matches CURRENT.md baseline)
- `gradlew assembleDebug`: BUILD SUCCESSFUL (debug APK at `android/app/build/outputs/apk/debug/app-debug.apk`)

## Remaining work

- User to install the debug APK and verify on-device: (a) full-screen alarm appears over an unlocked screen, (b) ASR keys persist across app restart, (c) version shows 0.8.1.
- No `keystore.properties` in this worktree — release-signed APK build pending if user needs a release artifact.
- After verification: merge `workspace/trae-qoder` into `main`, then merge `main` back into other tool branches per repo protocol.

## Notes

- `android/app/capacitor.build.gradle` and `android/capacitor.settings.gradle` show CRLF-only diffs (not committed; content identical).
- The main worktree's `Settings.ts` working copy appears to contain an uncommitted refactor (`renderAsrPanel` as a standalone panel). That work was preserved untouched; this branch uses the committed inline-panel version from `main`.

---

# Update: 2026-07-25 — Medication History Feature (P0–P3)

Spec: `medbox/.trae/specs/medication-history/spec.md`
Branch: `workspace/trae-qoder`
Status: done — code complete, typecheck + 247 tests pass; awaiting user device verification

## Goal

Add a medication history page (`/history`) that lets users review any 7/30/90-day window (or custom range up to 90 days) of past intake records, and correct/补记 records within the 90-day edit window.

## What was done (4 commits)

| Phase | Commit | Summary |
|---|---|---|
| P0 | `9e63b3f` | Route skeleton + data loading (`loadHistoryData`, `computeRangeBounds`, `groupOccurrencesByDate`) + 16 unit tests |
| P1 | `85174da` | Range chips (7d/30d/90d/custom) + custom date inputs + summary card (adherence ring + streak + 4 metrics) + filter bar (med/slot/status, 200ms debounce) + day cards with slot grouping + skeleton loading + dark mode |
| P2 | `2f17a32` | Action sheet (`openHistoryActionSheet`) with smart disable + `performHistoryAction` (calls `setOccurrenceAction`, toasts success/error, refreshes) + `MedicationIntakeError` handling (expired/insufficient-inventory/dose-review-required) + scroll preservation + 20 new tests |
| P3 | (this commit) | Entry points on Today page (topRight clock button + "查看完整历史 →" link) + `overscroll-behavior: contain` + handoff doc |

## Files changed

- `src/tools/registry.ts` — `/history` route registered (P0)
- `src/pages/MedHistory.ts` — new page, all P0/P1/P2 logic (~950 LOC)
- `src/ui/styles/pages/med-history.css` — new page styles (~470 LOC, includes dark mode)
- `src/pages/Today.ts` — `topRight` history button + `today-adherence-link` at bottom of week adherence card + `navigate` import
- `src/ui/styles/pages/today.css` — `.today-adherence-link` styles
- `tests/medHistory.test.ts` — 43 unit tests (computeRangeBounds, groupOccurrencesByDate, computeStreak, getActionSheetOptions, historyActionToIntake, historyActionSuccessMessage, performHistoryAction)
- `docs/handoffs/trae-qoder.md` — this update

## Architecture decisions

- **Data reuse**: No schema changes. `IntakeLog` + `MedicationScheduleRevision` + `MedicationOccurrence` are reused; occurrences are deterministically generated from schedule revisions via existing `generateOccurrences`.
- **Edit window**: `HISTORY_EDIT_WINDOW_DAYS = 90`. Rows older than 90 days render as `is-readonly` and don't bind click handlers.
- **Streak semantics**: today fully-taken counts only if yesterday also continued the streak; today pending/missed doesn't break the streak but doesn't count either. Matches the spec's "连续服药 N 天" intuition.
- **Smart disable in action sheet**: `taken` → disable "标记已服"; `skipped` → disable "标记跳过"; no log (pending/missed) → disable "清除记录".
- **Error handling**: `MedicationIntakeError` (expired/insufficient-inventory/dose-review-required/medication-not-found) → toast message and skip refresh; other unknown errors propagate.
- **Scroll preservation**: `rerender(preserveScroll=true)` captures `window.scrollY` before DOM replacement and restores it after, so editing a record mid-list doesn't jump the viewport.
- **Performance**: `content-visibility: auto` on day cards; skeleton loading for 90d and custom >30d ranges; 200ms filter debounce; lazy image decoding.
- **A11y**: `aria-label` on history page, `role="group"` on range/filter groups, `<h2>` day titles, `<article role="button">` rows with descriptive `aria-label`, Enter/Space keyboard activation, sheet uses `openDialog` (built-in focus trap + Escape + focus restore), all sheet options ≥ 44px touch targets.

## Tests

- `tsc --noEmit`: clean
- Vitest: 47 files / 247 tests passed (was 227; +20 from P2; +20 from P0/P1 totals 43 in `medHistory.test.ts`)
- New test coverage:
  - `computeRangeBounds`: 7d/30d/90d presets, custom range, swap correction, 90-day limit throws, missing fields fallback, HISTORY_EDIT_WINDOW_DAYS constant
  - `groupOccurrencesByDate`: ordering, status derivation (taken/skipped/missed/pending), med deleted, legacy log matching
  - `computeStreak`: full-streak, today pending, today missed, yesterday missed breaks, today no-due, empty range
  - `getActionSheetOptions`: smart disable for taken/skipped/no-log, option order, tone/label pairing
  - `historyActionToIntake`: taken/skipped/clear mapping
  - `historyActionSuccessMessage`: 3 success messages
  - `performHistoryAction`: success path for all 3 actions, low-stock二次 toast, expired/insufficient-inventory/dose-review-required error paths, unknown error propagation, refresh skipped on error

## Remaining work

- Browser/device smoke test (Task 13.3 / 13.4): enter from both Today entry points; switch 7/30/90/custom; filter by med/slot/status; click漏服 row → mark taken; click已服 row → clear; verify dark mode + landscape + reduced motion.
- After verification: merge `workspace/trae-qoder` into `main`, then merge `main` back into other tool branches per repo protocol.

## Notes

- `clock` and `arrow-left` icons already existed in `iconRegistry.ts` — no new icons needed.
- Action sheet is built on `openDialog` (existing primitive) rather than a new BottomSheet component, to match `confirmDialog` patterns and inherit focus trap / Escape / inert-app behavior for free.
- `performHistoryAction` uses dependency injection for `setOccurrenceAction` / `toast` / `onRefresh` so unit tests don't need to mock modules.

---

# Update: 2026-08-01 — Task 9 Safe Cleanup Audit

## Audit decisions

- Retained `src/sync/retiredCloudStorage.ts`: app startup still invokes it, and the cloud-to-LAN migration began in `0.8.2`; no documented release-count, elapsed-time, or adoption threshold proves that all users have crossed the cleanup window.
- Retained `src/sync/retiredWorkStorage.ts`: app startup still invokes it, the work module was removed in `0.8.3`, and the archive explicitly states that upgraded Xiaoyaohe installations delete the old `medbox-work` database. The migration window is not formally closed.
- Retained `src/app/routeCompatibility.ts`: `/tools` was the former shell entry and remains a valid bookmarked or persisted hash. `src/main.ts` now registers redirects from this single compatibility map instead of duplicating the route literal.
- Retained `archive/工时模块归档/`: commit `e9bf8fa` intentionally created it as source material for a future standalone worktime app. Vite/Vitest exclude `archive/**`, so it has no production or test-runtime coupling.

## NULL directory finding

- `NULL/` is not repository data. It contains 555 files totaling 315,991,832 bytes; every relative path exists under `C:\Windows`, and 553 files have the same current size. This proves it is a snapshot/copy of Windows system content rather than generated Medbox output.
- The root directory was created at 2026-07-30 21:02:26. Its copied subdirectories were created continuously from 21:02:28 through 21:03:40, which proves a recursive copy ran during that interval; it does not identify the executable or command line.
- A second audit searched Claude project JSONL/transcripts/history, TRAE persisted data and caches, PowerShell PSReadLine and event logs, repository scripts, packaged TRAE shell integrations, and files written from 20:30 through 21:30. No retained record contains the responsible command or tool call.
- TRAE created PowerShell process snapshots at 20:51:34 (PID 20816) and 21:10:08 (PID 27684), bracketing the copy. These snapshots contain only environment setup and no command history. The nearby `web-app-development` plugin installation completed at 20:51:36 and contains no Windows-copy command, so temporal proximity is not attribution.
- No repository or installed TRAE script contains a redirect to `NULL` or a command copying `C:\Windows` to it. Matches for `NULL` in generated application JavaScript are data comparisons, not shell redirections. Current files have different NTFS file IDs from their `C:\Windows` counterparts, confirming copies rather than links.
- Because the exact producer and ownership remain unproven, Task 9 leaves `NULL/` untouched and adds no speculative workaround. No unknown user or system-derived files were removed, and SubTask 9.3 remains unresolved rather than being closed from content provenance alone.

---

# Update: 2026-08-01 — Task 12 Version And Release

Branch: `workspace/trae-qoder`
Status: ready for user review; intentionally uncommitted
Latest commit: `9f976fd`（本轮按要求未创建提交）

## Scope completed

- 按现有 0.x 修订版策略，将产品从 `0.9.3` 升至 `0.9.4`，Android `versionCode` 从 22 递增到 23。
- 统一 `package.json`、`package-lock.json`、Android `versionName`、`versionCode`、Android 配置测试和发布版本映射。
- 新增 `docs/releases/<version>.md` 大白话发布说明机制；发布配置在构建前强制检查当前版本说明文件存在。
- `0.9.4` 说明覆盖照片比例、APK 安全、网页能力、按需加载、诊断、深色模式和异形屏适配，并明确真机剩余项。
- 调整 release 编排：本机已有对应 Playwright Chromium 时不再重复联网安装，未安装时仍保留安装门禁。

## Files changed for Task 12

- `package.json`
- `package-lock.json`
- `android/app/build.gradle`
- `android/app/src/test/java/com/medbox/app/AppConfigurationTest.java`
- `scripts/release.mjs`
- `scripts/lib/release-utils.mjs`
- `tests/release-utils.test.ts`
- `docs/releases/README.md`
- `docs/releases/0.9.4.md`
- `docs/handoffs/trae-qoder.md`

## Verification

- `npm audit --audit-level=low`：0 个漏洞。
- `npm run typecheck`：通过。
- `npm test`：66 个测试文件、355 项通过。
- `npm run test:release`：12 项通过，包含 0.9.4/versionCode 23 和缺少当前版本说明时阻止发布。
- `npx playwright test`：四视口共 28 项通过。
- `npm run build:web` 与 `npx cap sync android`：通过。
- `gradlew testDebugUnitTest assembleDebug`：通过。
- `gradlew testReleaseUnitTest assembleRelease`：通过，签名后的 release APK 成功生成。
- APK 元数据：`com.medbox.app`、`versionName 0.9.4`、`versionCode 23`。
- APK 内 Web 资源：49 个文件与当前 `dist` 一致，聚合哈希 `0f36edb560ccca2fe2ee22dbbb8972f6ed397f403932db0d02fe6d5f257792d1`。
- APK 签名：APK Signature Scheme v2 验证通过，1 个签名者；证书 SHA-256 `a6b6d925609abff7c65f1688a34b91bd3fdb603921f43a8e9ede880edba75321`。
- APK SHA-256：`5060fc1846334ab12374b1cce92d673e3e5a75443bf85bb47656b519ae2c7cb9`，与清单逐字匹配。
- `git diff --check`：通过；未执行 commit、merge 或 push。
- 最终复核首次并行全量 Vitest 时，真实 Vite 构建耗时 15.99 秒超过原 15 秒测试上限；将构建断言超时调整为 30 秒后，66 个文件、355 项复跑全部通过。

## Local artifacts

- `release/xiaoyaohe-0.9.4-android-release.apk`
- `release/xiaoyaohe-0.9.4-SHA256SUMS.txt`
- 以上产物及本地签名配置均被忽略，不进入版本控制。

## Remaining external work and risks

- `npm run release -- --skip-install --android-variant debug` 已执行全部前置门禁并成功组包，但最后的 `connectedDebugAndroidTest` 因当前没有连接 Android 设备而失败；没有把它伪报为通过，也没有把失败的 debug 流水线产物作为最终发布物。
- 需要在真实 Android 手机上安装 `0.9.4` release APK，检查升级覆盖、系统提醒、旋转、刘海/手势区和局域网两机 APK 更新流程。
- 工作树还包含 Task 1–11 的大量未提交改动；Task 12 保留这些改动且没有回滚或覆盖。交付审阅时应以完整工作树为单位检查。
- 根规格 checklist 与 tasks 已完成最终逐项核对并同步勾选 Task 12；真机相关条目继续明确保留为 N/A 外部阻塞。
