# Current Integration State

Updated: 2026-07-17
Integration branch: `main`
Product version: `0.7.6`

## Baseline

- Product implementation commit before worktree organization: `78cb275`.
- TypeScript and Worker type checks pass.
- Vitest: 46 files, 188 tests pass.
- Playwright: 16 tests across four viewports pass.
- Android debug APK builds successfully.

## Implemented Product Areas

- Medication inventory page and quick stock actions.
- Local four-corner box-photo crop with manual adjustment.
- Image-generation runtime removed.
- Encrypted family sync v2 UI and Worker configuration enabled with exact Origin allowlisting.

## External Follow-Ups

- Renew Wrangler authentication and add the exact production Pages Origin before Worker/Pages deployment.
- Run connected Android tests and installation smoke testing when an ADB device is available.

## Integration Rule

Update this file whenever a tool branch is merged into `main`. Tool-specific unfinished context belongs in the corresponding handoff file.
