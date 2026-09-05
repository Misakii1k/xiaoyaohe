// 启动 APP 后自动每半小时在局域网轮询做数据同步。
// 依赖保活（KeepAliveService）让 WebView 与本定时器在后台存活。
//
// 模型：
// - 首次手动扫码配对成功后，双方交换 localAutoIdentity（固定 port + 长期 secret/sessionId）。
// - 开启自动同步后：本机在固定端口常驻 host；同时每 30 分钟对 knownPeers 主动 join。
// - 同一时刻原生 LanSync 只允许一个会话，所以 join 前会短暂停 host，join 完再恢复。
// - choosePolicy 自动用 recommendLanPolicy，不弹窗；连接失败静默跳过。
// - 「静默模式」开关 lanAutoSyncSilent（默认开）：关闭后，自动同步遇到推荐策略为整库覆盖时
//   会跳过本次同步，而不是用 recommended 强行覆盖（让用户走手动同步来确认）。
import { encodeLanSyncInvitation } from './invitation';
import { joinLanSyncHost, startLanSyncHost, getLanSyncDeviceName } from './session';
import { isLanAllowRemoteOverwrite } from './policy';
import {
  decodePairingSecret,
  getOrCreateLocalAutoIdentity,
  listKnownPeers,
  rememberPeer,
  type KnownPeer,
} from './knownPeers';
import { isLanSyncAvailable } from './nativeTransport';
import { notifyIfUpdateAvailable, startServingInstalledApk } from './apkTransport';
import { reportSilentFailure } from '../../app/diagnostics';

const AUTO_KEY = 'medbox.lan-sync.auto.v1';
const AUTO_SILENT_KEY = 'medbox.lan-sync.auto-silent.v1';
const POLL_INTERVAL_MS = 30 * 60 * 1000;
const PEER_CONNECT_TIMEOUT_MS = 12_000;
const HOST_RESTART_DELAY_MS = 2_000;
const HOST_RESTART_DELAY_MAX_MS = 30_000;
/** 当 allowRemoteOverwrite=false 且 host 想做 overwrite-local 时，session.ts 抛出的文案片段。 */
const OVERWRITE_REFUSED_MARKER = '未开启「允许被覆盖」';

let pollTimer: number | null = null;
let hostLoopActive = false;
let hostClose: (() => Promise<void>) | null = null;
let joinRunning = false;

export function isAutoSyncEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) === '1';
  } catch {
    return false;
  }
}

export function setAutoSyncEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (enabled) startAutoSync();
  else stopAutoSync();
}

/**
 * 静默模式开关（默认开）。
 * - 开：自动同步使用 recommendLanPolicy 的推荐策略，无需用户确认（覆盖、合并都直接做）。
 * - 关：自动同步遇到推荐策略为整库覆盖（overwrite-local / overwrite-remote）时跳过本次同步，
 *   留给用户走手动同步来确认。merge 仍允许执行。
 */
export function isLanAutoSyncSilent(): boolean {
  try {
    const raw = localStorage.getItem(AUTO_SILENT_KEY);
    if (raw === null) return true; // 默认静默
    return raw === '1';
  } catch {
    return true;
  }
}

export function setLanAutoSyncSilent(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_SILENT_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** 启动自动轮询 + 常驻 host。开关关闭时 no-op。 */
export function startAutoSync(): void {
  if (!isAutoSyncEnabled()) return;
  if (!isLanSyncAvailable()) return;
  if (pollTimer == null) {
    pollTimer = window.setInterval(() => { void runAutoJoin(); }, POLL_INTERVAL_MS);
    void runAutoJoin();
  }
  void ensurePersistentHost();
}

export function stopAutoSync(): void {
  if (pollTimer != null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
  hostLoopActive = false;
  const close = hostClose;
  hostClose = null;
  if (close) void close().catch(() => undefined);
}

/**
 * 暂停常驻 host，供手动同步（显示连接码 / 扫一扫）使用。
 * 原生 LanSync 同一时刻只允许一个会话；若不暂停，手动同步会被
 * reject 为 SESSION_ACTIVE，错误文案会被误报为「Wi-Fi 不允许互联」。
 *
 * 返回一个 resume 函数：手动同步结束后调用，恢复常驻 host。
 */
export async function pausePersistentHost(): Promise<() => void> {
  const wasHosting = hostLoopActive;
  hostLoopActive = false;
  const close = hostClose;
  hostClose = null;
  if (close) await close().catch(() => undefined);
  return () => {
    if (wasHosting && isAutoSyncEnabled() && !hostLoopActive) {
      void ensurePersistentHost();
    }
  };
}

export type PeerSyncOutcome = 'joined' | 'failed' | 'skipped';

export interface ManualJoinSummary {
  joined: number;
  failed: number;
  skipped: number;
}

/**
 * 立即触发一次对所有已配对 peer 的同步（手动一键同步入口）。
 * - 不要求 autoSync 开关打开；只要 LAN 可用且有 knownPeers 就执行。
 * - 复用 runAutoJoin 的互斥机制；若已在执行中则返回全 0。
 * - 返回 { joined, failed, skipped } 摘要，调用方可据此 toast。
 */
export async function triggerManualJoinAll(): Promise<ManualJoinSummary> {
  return performJoinRound(false);
}

async function runAutoJoin(): Promise<void> {
  await performJoinRound(true);
}

async function performJoinRound(requireAutoEnabled: boolean): Promise<ManualJoinSummary> {
  if (joinRunning) return { joined: 0, failed: 0, skipped: 0 };
  if (requireAutoEnabled && !isAutoSyncEnabled()) return { joined: 0, failed: 0, skipped: 0 };
  if (!isLanSyncAvailable()) return { joined: 0, failed: 0, skipped: 0 };
  const peers = listKnownPeers();
  if (peers.length === 0) return { joined: 0, failed: 0, skipped: 0 };
  joinRunning = true;
  // 原生同一时刻只能有一个会话：join 前停 host，结束后再开
  const wasHosting = hostLoopActive;
  hostLoopActive = false;
  const close = hostClose;
  hostClose = null;
  if (close) await close().catch(() => undefined);
  let joined = 0;
  let failed = 0;
  let skipped = 0;
  try {
    for (const peer of peers) {
      const outcome = await tryJoinPeer(peer).catch<PeerSyncOutcome>((error) => {
        reportSilentFailure('lan.auto-join', error);
        return 'failed';
      });
      if (outcome === 'joined') joined += 1;
      else if (outcome === 'skipped') skipped += 1;
      else failed += 1;
    }
    // 一轮同步结束后检查是否有可用更新（24h 内不重复通知）
    if (joined > 0) void notifyIfUpdateAvailable().catch(() => undefined);
  } finally {
    joinRunning = false;
    if (wasHosting && isAutoSyncEnabled()) void ensurePersistentHost();
  }
  return { joined, failed, skipped };
}

async function tryJoinPeer(peer: KnownPeer): Promise<PeerSyncOutcome> {
  const secret = decodePairingSecret(peer.pairingSecretB64);
  const invitation = encodeLanSyncInvitation({
    host: peer.host,
    port: peer.port,
    sessionId: peer.pairingSessionId,
    expiresAt: Date.now() + 120_000,
    secret,
  });
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), PEER_CONNECT_TIMEOUT_MS);
  // 静默模式关闭时：本机不再允许被 host 整库覆盖（allowRemoteOverwrite=false）。
  // host 若推荐 overwrite-local（host 数据覆盖本机），会在 session.ts 里被拒。
  // 我们识别该错误并记为 'skipped'，让用户走手动同步来确认。
  const allowOverwrite = isLanAllowRemoteOverwrite() && isLanAutoSyncSilent();
  try {
    await joinLanSyncHost(invitation.uri, {
      signal: controller.signal,
      deviceName: getLanSyncDeviceName(),
      allowRemoteOverwrite: allowOverwrite,
      choosePolicy: async (input) => input.recommended,
    });
    rememberPeer({ ...peer, lastSeenAt: Date.now() });
    return 'joined';
  } catch (error) {
    if (!isLanAutoSyncSilent()) {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes(OVERWRITE_REFUSED_MARKER)) return 'skipped';
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

/**
 * 常驻 host：用本机 localAutoIdentity 在固定端口监听。
 * 单次 session 结束后（对方 join 完成或超时）稍等再开下一轮。
 */
async function ensurePersistentHost(): Promise<void> {
  if (hostLoopActive) return;
  if (!isAutoSyncEnabled() || !isLanSyncAvailable()) return;
  hostLoopActive = true;
  let retryDelayMs = HOST_RESTART_DELAY_MS;
  while (hostLoopActive && isAutoSyncEnabled()) {
    try {
      const identity = getOrCreateLocalAutoIdentity();
      const secret = decodePairingSecret(identity.secretB64);
      const session = await startLanSyncHost({
        deviceName: getLanSyncDeviceName(),
        allowRemoteOverwrite: isLanAllowRemoteOverwrite(),
        choosePolicy: async (input) => input.recommended,
        port: identity.port,
        invitationOverride: {
          sessionId: identity.sessionId,
          secret,
          lifetimeMs: 120_000,
        },
      });
      hostClose = session.close;
      // host 启动成功后，同时开启 APK 分发，让其他设备能拉取本机已安装的新版本
      void startServingInstalledApk().catch(() => undefined);
      await session.completion.catch(() => undefined);
      hostClose = null;
      retryDelayMs = HOST_RESTART_DELAY_MS;
    } catch (error) {
      reportSilentFailure('lan.persistent-host', error);
      console.warn('LAN 常驻 host 启动失败，稍后重试：', error);
    }
    if (!hostLoopActive || !isAutoSyncEnabled()) break;
    await sleep(retryDelayMs);
    retryDelayMs = Math.min(retryDelayMs * 2, HOST_RESTART_DELAY_MAX_MS);
  }
  hostLoopActive = false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { window.setTimeout(resolve, ms); });
}
