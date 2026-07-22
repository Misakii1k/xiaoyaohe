# Claude Handoff

Tool: Claude
Branch: `workspace/claude`（本次工作直接提交在 `main`，沿用近几轮 UI/功能提交的既有做法；`workspace/claude` 尚未追平 main）
Updated: 2026-07-22
Status: idle
Latest commit: `1ba6eb8 feat: keep-alive foreground service and half-hourly LAN auto-sync`

## Goal

本轮完成平板使用相关能力 + 提醒振动 + APP 保活 + 局域网半小时自动同步。均已提交；保活/自动同步需装 release APK 在真机验证。目前无活跃编码任务。

## What Landed on `main` (2026-07-22 晚)

6. `8d53710 feat: free-place launcher + inventory share + dedup interaction prompt`
   - 平板/桌面 ≥768px：小助手悬浮钮不吸附边缘，`minBottomClearance` 降到 8px。
   - 库存页顶栏「分享」：需购买清单 / 全部库存；`navigator.share` 或剪贴板。
   - 相互作用提醒去重：`filterNewInteractions` / `acknowledgeInteractions`。

7. `95fbbf6 feat: vibrate on all reminder modes (web + native strong)`
   - web：`reminderVibration.ts` + scheduler 通知成功后 `navigator.vibrate`。
   - 原生 strong：`MedicationAlarmContract.vibrateStrong` 显式 Vibrator。

8. `630a457 feat: add inventory by photo or voice on inventory page`
   - 库存页「智能录入」：拍照/相册 → `identifyInventoryByBlob`；语音 → `parseInventorySpeech`。
   - 匹配已有药更新；未登记 → `setPendingInventoryPrefill` → `/meds/new`。

9. `1ba6eb8 feat: keep-alive foreground service and half-hourly LAN auto-sync`
   - **保活**：`KeepAliveService`（dataSync 前台服务）、开机重启、Settings「后台运行」电池白名单（`PowerSettingsPlugin`）；`LanSyncPlugin.handleOnPause` 不再 terminate。
   - **自动同步**：`knownPeers` + `localAutoIdentity`（固定端口 38472 + 长期 secret/sessionId）；手动同步交换 `autoIdentity`；开关「每 30 分钟自动同步」→ 常驻 host + 定时 join；`main.ts` 启动 `startAutoSync()`。
   - 限制：无 mDNS；IP 漂移需重新扫码；OEM 仍可能杀后台；单会话 join 时会短暂停 host。

## Earlier Work (同日)

- 去掉药品页顶栏库存按钮、小助手批量一次确认、Android release 签名、通知总开关、LAN 覆盖策略 UX 等（见 git log）。

## Tests

- `npm test`：46 文件 / 202 通过。
- `npm run typecheck`：干净。
- 未跑完整 `npm run release` / Playwright / instrumentation；release APK 需在真机验保活通知与自动同步。

## How to use (用户侧)

1. **设置 → 后台运行** →「允许后台运行」加入电池白名单。
2. 两台设备同 Wi‑Fi，**家庭同步**手动扫码成功一次（建立配对）。
3. 两边打开 **「每 30 分钟自动同步」**。
4. 通知栏应见「小药盒正在后台运行」。

## Remaining / Optional

- `workspace/claude` 落后 `main`；按 AGENTS.md 下次开工前合回。
- `docs/handoffs/CURRENT.md` 仍 v0.7.7；发版可升到 v0.8.x 并记 APK 校验。
- 真机验证：保活通知、强提醒振动、自动同步（可临时把 `POLL_INTERVAL_MS` 调小调试）。
- 可选：IP 变更后的轻量重发现；组合 dev+ASR 脚本。

## Notes

- 强提醒不用 WxPusher/微信，走 Notification + 震动。
- release keystore / `.env` 仅本地，勿提交。
