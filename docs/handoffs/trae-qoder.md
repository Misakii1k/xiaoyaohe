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
