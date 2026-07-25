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
