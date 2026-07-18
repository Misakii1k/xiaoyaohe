# GPT/Codex Handoff

Tool: GPT/Codex
Branch: `workspace/gpt`
Updated: 2026-07-18
Status: ready-to-merge; external ASR deployment and connected-device acceptance remain
Latest implementation commit: `38873ef feat: strengthen reminders and assistant services`

## Goal

Ship stronger per-medication reminders, move Tencent speech recognition behind a safe server proxy, replace the full-screen hold-to-talk overlay, and add no-key Exa MCP search to the assistant.

## Completed

- Added `strong`, `fullscreen-short`, and `fullscreen-persistent` per-medication reminder modes with legacy migration, backup validation, LAN sync, editor UI, and native schedule payloads.
- Added Android high-importance channels, full-screen permission handling, lock-screen alarm activity, 10/60-second alert behavior, Taken/Snooze/Skip actions, and queued native action replay.
- Removed client-side Tencent credential and signing paths. The app now uses `VITE_ASR_PROXY_URL`, stores only sanitized ASR health details, disables Capacitor production logging, and deletes retired ASR credentials.
- Added a deployable Node Tencent ASR proxy with TC3 signing, WAV/time/size/rate limits, CORS allow-listing, timeout handling, and sanitized responses.
- Replaced the assistant's fixed full-screen voice overlay with a themed 140-150px in-panel recorder that preserves the conversation and supports slide-up cancel.
- Added the official MCP SDK Streamable HTTP client for the public no-key Exa endpoint, bounded `web_search_exa`, per-origin consent, retry/timeout/rate-limit handling, untrusted-content instructions, and Markdown source cards.
- Bumped the app to `0.7.8` / Android `versionCode 15` and generated the verified debug APK.

## Verification

- `npm test`: 45 files, 182 tests passed.
- `npm run build`: TypeScript and production Vite build passed.
- `gradlew testDebugUnitTest assembleDebug`: passed.
- Exa public MCP integration: initialization, `tools/list`, and a real no-key `web_search_exa` call passed.
- Playwright with local Chrome at 320x720 and 1280x900: recorder remained inside the panel, did not overlap the composer, had no horizontal overflow, and emitted no console errors.
- APK verification: 32 embedded WebView files; artifact `release/medbox-0.7.8-android-debug.apk`.
- APK SHA-256: `6e1a9152e67a0833f2b6cb14326e89db5d2581a315ab5242af0ecbd5bfc8c3ef`.

## External Follow-Ups

- Deploy `server/tencent-asr-proxy.mjs` behind HTTPS with a newly created valid Tencent `SecretId`/`SecretKey`, then build with `VITE_ASR_PROXY_URL=https://host/api/speech/tencent`. The supplied credential note did not contain a usable SecretKey and the previously tested SecretId returned `AuthFailure.SecretIdNotFound`.
- Run installation and lock-screen acceptance on the API 36 phone. `adb devices -l` was empty during final verification, so connected instrumentation and physical reminder/ASR interaction could not run.
- The Exa public no-key endpoint is best effort and may rate-limit or change policy; the app already reports retryable failures without promising permanent free availability.

## Notes

- Release artifacts, screenshots, logs, caches, and secrets remain ignored and untracked.
- The full release script timed out while waiting for unavailable-device instrumentation; its individual Web, unit, Android build, APK validation, and artifact publication steps were run successfully.
