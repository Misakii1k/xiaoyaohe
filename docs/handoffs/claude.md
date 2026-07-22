# Claude Handoff

Tool: Claude
Branch: `workspace/claude`（本次工作直接提交在 `main`，沿用近几轮 UI/功能提交的既有做法；`workspace/claude` 尚未追平 main）
Updated: 2026-07-22
Status: idle
Latest commit: `522e161 feat: choose overwrite version during LAN sync with recommendation`

## Goal

本轮已完成三组已验证、已提交的工作（197/197 测试通过，类型检查干净），目前无活跃任务。

## What Landed on `main` (2026-07-22)

1. `0e012af build: configure Android release signing via local keystore`
   - `android/app/build.gradle`：新增 `signingConfigs.release` + `buildTypes.release.signingConfig`，仅在 `app/keystore.properties` 存在时启用，main 的 debug-only 构建不受影响。
   - `android/.gitignore`：忽略 `*.jks`、`*.keystore`、`keystore.properties`、`app/keystore.properties`。
   - 凭据：`medbox-release.jks` 与 `keystore.properties` 为本地文件（已 gitignore）；密码备份在桌面 `小药盒-release-签名备份.txt`，勿提交、勿分享。丢失将无法以同一身份升级应用。
   - 已产出签名 APK：`C:\Users\87850\Desktop\小药盒-v0.8.0-release.apk`（~3.4 MB，未入库）。

2. `5459188 feat: add in-app notification master toggle`
   - `src/features/notificationPreference.ts`（新）：`isAppNotificationsEnabled` / `setAppNotificationsEnabled`，默认开；变更派发 `medbox:notification-pref-change` 事件。
   - `src/features/reminderScheduler.ts`：监听偏好变更 → tick；禁用时 `reconcileScheduledNotifications([])` 清空原生调度，`runTick` 提前返回。
   - `src/pages/Settings.ts`：系统通知面板顶部新增「应用内用药提醒」总开关；关闭时跳过权限详情并显示 banner；`reminderPanelChip()` 统一 chip 文案（已开启/已暂停/被拒绝/未开启/不支持）。

3. `522e161 feat: choose overwrite version during LAN sync with recommendation`
   - `src/sync/lan/policy.ts`（新）：`LanSyncPolicy`、`LanDeviceSummary`、`summarizeLanSnapshot`、`buildLocalLanSummary`（本地读库存，只传 hint）、`recommendLanPolicy`（按 max(maxClock*1000, dataUpdatedAt) 评分，60s 阈值，库存平局决胜）、`policyLabel`、`isLanAllowRemoteOverwrite`/`setLanAllowRemoteOverwrite`、`formatLanTime`。
   - `src/sync/lan/session.ts`：`buildLocalSummary` 注入到 `LanSyncSessionDependencies`（默认 `buildLocalLanSummary`）；host/join 双方各自构建本地+远程摘要 → `recommendLanPolicy` → `choosePolicy` 提示；`overwrite-local` 需 `allowOverwrite` 同意；`joinPayloadSchema` 含 `allowOverwrite`+`summary`，`resultPayloadSchema` 含 `policy`。
   - `src/sync/lan/store.ts`：`mergeLanSnapshotsWithPolicy`（merge/overwrite-local/overwrite-remote）；`applyMedication` 保留 `current?.inventory`（设备本地不变式）；`mergeLanSnapshots` 委托 `(..., 'merge')`。
   - `src/sync/lan/entities.ts`：药物 payload **不含** `inventory`/`updatedAt`（库存设备本地，测试强制）。
   - `src/sync/lan/settingsPanel.ts`：`inventoryNote`、`allowOverwrite` 复选框、`deviceCard(title, summary, recommended)`、`promptLanSyncPolicy` 底部表单（两张设备卡 + 推荐横幅 + 三按钮）。
   - `src/sync/lan/session.test.ts`：新增 `stubSummary` 辅助 + 两处 `buildLocalSummary` 覆盖，解决 Node 测试环境无 `indexedDB` 问题。

## Tests

- `npm test`：45 文件 / 197 通过。
- `npm run typecheck`：干净。
- `npm test -- src/sync/lan`：37/37 通过。
- 未跑 Playwright 与 Android instrumentation（无设备/本次改动原生层已由单测覆盖逻辑）。

## Remaining Work / Optional

- `workspace/claude` 落后 `main` 9 个提交；按 AGENTS.md 应在下次开工前把 `main` 合回 `workspace/claude`（以及其它长生命分支）。
- `docs/handoffs/CURRENT.md` 仍停留在 2026-07-17 / v0.7.7；如需发布可更新到 v0.8.0 并记录新 APK 校验。
- `session.ts` 399-410 行有双重 `overwrite-local` 检查（功能无害，第二个不可达），可顺手简化。
- 可选：组合 dev + ASR 代理脚本；弹出插图存储。

## Notes

- 强提醒通道约束（来自记忆）：medbox「强提醒」明确不用 WxPusher/微信，走浏览器 Notification + 震动；本轮未触碰该约束。
- `.env`（腾讯 SecretId/SecretKey）已 gitignore，仅本地。
