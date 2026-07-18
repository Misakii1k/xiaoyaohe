# GPT/Codex Handoff

Tool: GPT/Codex
Branch: `workspace/gpt`
Updated: 2026-07-18
Status: ready-to-merge; Tencent proxy deployment remains optional when using the device fallback
Latest implementation commit: `005d5ac feat: make assistant streaming and speech search resilient`

## Goal

Ship stronger per-medication reminders, move Tencent speech recognition behind a safe server proxy, replace the full-screen hold-to-talk overlay, and add no-key Exa MCP search to the assistant.

## Completed

- Added `strong`, `fullscreen-short`, and `fullscreen-persistent` per-medication reminder modes with legacy migration, backup validation, LAN sync, editor UI, and native schedule payloads.
- Added Android high-importance channels, full-screen permission handling, lock-screen alarm activity, 10/60-second alert behavior, Taken/Snooze/Skip actions, and queued native action replay.
- Removed client-side Tencent credential and signing paths. The app now uses `VITE_ASR_PROXY_URL`, stores only sanitized ASR health details, disables Capacitor production logging, and deletes retired ASR credentials.
- Added an Android system speech-recognition fallback for native builds without a Tencent proxy; configured Tencent proxy remains the preferred path.
- Added a deployable Node Tencent ASR proxy with TC3 signing, WAV/time/size/rate limits, CORS allow-listing, timeout handling, and sanitized responses.
- Replaced the assistant's fixed full-screen voice overlay with a themed 140-150px in-panel recorder that preserves the conversation and supports slide-up cancel.
- Added the official MCP SDK Streamable HTTP client for the public no-key Exa endpoint, bounded `web_search_exa`, per-origin consent, retry/timeout/rate-limit handling, untrusted-content instructions, and Markdown source cards.
- Added an MCP HTTP JSON-RPC fallback for WebViews that cannot consume the streaming transport, explicit search-command execution when a model omits tool calls, and direct source excerpts in the rendered card.
- Added OpenAI-compatible SSE streaming for assistant text with non-streaming compatibility fallback and partial-result preservation.
- Bumped the app to `0.7.8` / Android `versionCode 15` and generated the verified debug APK.

## Verification

- `npm test`: 46 files, 185 tests passed.
- `npm run build`: TypeScript and production Vite build passed.
- `gradlew testDebugUnitTest assembleDebug`: passed.
- Exa public MCP integration: initialization, `tools/list`, and a real no-key `web_search_exa` call passed.
- Playwright with local Chrome at 320x720 and 1280x900: recorder remained inside the panel, did not overlap the composer, had no horizontal overflow, and emitted no console errors.
- Android 16/API 36 physical device: `0.7.8` installed over `0.7.7` without clearing data; all 13 medications and 19 reminder rules remained.
- Physical hold-to-talk acceptance: pointer-down displayed the themed compact recorder inside the assistant, `RECORD_AUDIO` was actively running, pointer-up stopped recording, and the unavailable-proxy message appeared without Android's text-selection toolbar.
- Native speech fallback acceptance: the custom `NativeSpeech` Capacitor bridge compiled, installed, and started on the API 36 device; silence correctly returned the no-speech state without a crash.
- Physical notification acceptance: both high-importance channels used alarm audio and vibration, the test notification exposed Taken/Snooze/Skip actions, and exact reminder alarms were scheduled.
- Physical Logcat acceptance: no app crash and no `SecretId`, `SecretKey`, `Authorization`, or Base64 audio content was emitted.
- APK verification: 32 embedded WebView files; artifact `release/medbox-0.7.8-android-debug.apk`.
- APK SHA-256: `647e36f29b57e66697e30d93c85690e28c03f41eaaa39e8b63bf14fc86edee1a`.

## External Follow-Ups

- For Tencent-quality recognition, deploy `server/tencent-asr-proxy.mjs` behind HTTPS with a newly created valid Tencent `SecretId`/`SecretKey`, then build with `VITE_ASR_PROXY_URL=https://host/api/speech/tencent`. The supplied credential note did not contain a usable SecretKey and the previously tested SecretId returned `AuthFailure.SecretIdNotFound`; native builds now remain usable through the device speech fallback.
- The Exa public no-key endpoint is best effort and may rate-limit or change policy; the app already reports retryable failures without promising permanent free availability.

## Notes

- Release artifacts, screenshots, logs, caches, and secrets remain ignored and untracked.
- The full release script timed out while waiting for unavailable-device instrumentation; its individual Web, unit, Android build, APK validation, and artifact publication steps were run successfully.
