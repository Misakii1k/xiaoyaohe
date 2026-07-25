// 启动 APP 后自动每半小时在局域网轮询做数据同步。
// 依赖保活（KeepAliveService）让 WebView 与本定时器在后台存活。
//
// 模型：
// - 首次手动扫码配对成功后，双方交换 localAutoIdentity（固定 port + 长期 secret/sessionId）。
// - 开启自动同步后：本机在固定端口常驻 host；同时每 30 分钟对 knownPeers 主动 join。
// - 同一时刻原生 LanSync 只允许一个会话，所以 join 前会短暂停 host，join 完再恢复。
// - choosePolicy 自动用 recommendLanPolicy，不弹窗；连接失败静默跳过。
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

const AUTO_KEY = 'medbox.lan-sync.auto.v1';
const POLL_INTERVAL_MS = 30 * 60 * 1000;
const PEER_CONNECT_TIMEOUT_MS = 12_000;
const HOST_RESTART_DELAY_MS = 2_000;

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

async function runAutoJoin(): Promise<void> {
  if (joinRunning) return;
  if (!isAutoSyncEnabled() || !isLanSyncAvailable()) return;
  const peers = listKnownPeers();
  if (peers.length === 0) return;
  joinRunning = true;
  // 原生同一时刻只能有一个会话：join 前停 host，结束后再开
  const wasHosting = hostLoopActive;
  hostLoopActive = false;
  const close = hostClose;
  hostClose = null;
  if (close) await close().catch(() => undefined);
  try {
    for (const peer of peers) {
      await tryJoinPeer(peer).catch(() => { /* 静默，下次再试 */ });
    }
  } finally {
    joinRunning = false;
    if (wasHosting && isAutoSyncEnabled()) void ensurePersistentHost();
  }
}

async function tryJoinPeer(peer: KnownPeer): Promise<void> {
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
  try {
    await joinLanSyncHost(invitation.uri, {
      signal: controller.signal,
      deviceName: getLanSyncDeviceName(),
      allowRemoteOverwrite: isLanAllowRemoteOverwrite(),
      choosePolicy: async (input) => input.recommended,
    });
    rememberPeer({ ...peer, lastSeenAt: Date.now() });
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
      await session.completion.catch(() => undefined);
      hostClose = null;
    } catch {
      /* 端口占用/无 Wi-Fi：稍后重试 */
    }
    if (!hostLoopActive || !isAutoSyncEnabled()) break;
    await sleep(HOST_RESTART_DELAY_MS);
  }
  hostLoopActive = false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { window.setTimeout(resolve, ms); });
}
