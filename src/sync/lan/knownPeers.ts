// 已配对设备记忆：首次手动家庭同步成功后记住对方的 host/port 与长期配对密钥，
// 供「每 30 分钟自动同步」主动 join 使用。无 mDNS 设备发现，靠扫码配对一次。
// 存 localStorage，键 medbox.lan-sync.peers.v1 / medbox.lan-sync.local-auto.v1。

import {
  LAN_SYNC_SECRET_BYTES,
  base64UrlDecode,
  base64UrlEncode,
  createLanSyncSessionId,
  randomLanSyncBytes,
} from './crypto';

export interface KnownPeer {
  deviceId: string;
  deviceName: string;
  host: string;
  port: number;
  /** 对方自动 host 使用的长期 sessionId（22 字符） */
  pairingSessionId: string;
  /** 对方自动 host 使用的长期 secret（base64url） */
  pairingSecretB64: string;
  lastSeenAt: number;
}

/** 本机自动同步身份：固定端口 + 长期 secret/sessionId，供对方 remember 后来 join。 */
export interface LocalAutoIdentity {
  sessionId: string;
  secretB64: string;
  port: number;
}

/** 自动同步 host 固定端口（1024–65535）。被占用时 host 会失败。 */
export const LAN_AUTO_HOST_PORT = 38_472;

const PEERS_KEY = 'medbox.lan-sync.peers.v1';
const LOCAL_AUTO_KEY = 'medbox.lan-sync.local-auto.v1';
const MAX_PEERS = 8;

export function listKnownPeers(): KnownPeer[] {
  try {
    const raw = localStorage.getItem(PEERS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(isPeer) : [];
  } catch {
    return [];
  }
}

function isPeer(v: unknown): v is KnownPeer {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return typeof p.deviceId === 'string'
    && typeof p.deviceName === 'string'
    && typeof p.host === 'string'
    && typeof p.port === 'number'
    && typeof p.pairingSessionId === 'string'
    && /^[A-Za-z0-9_-]{22}$/.test(p.pairingSessionId)
    && typeof p.pairingSecretB64 === 'string'
    && p.pairingSecretB64.length >= 22
    && typeof p.lastSeenAt === 'number';
}

/** 记录或刷新一个已配对设备；超过 MAX_PEERS 丢弃最旧的。 */
export function rememberPeer(peer: KnownPeer): void {
  if (!isPeer(peer)) return;
  const peers = listKnownPeers().filter((p) => p.deviceId !== peer.deviceId);
  peers.push(peer);
  while (peers.length > MAX_PEERS) peers.shift();
  try {
    localStorage.setItem(PEERS_KEY, JSON.stringify(peers));
  } catch {
    /* 存不了就算了 */
  }
}

export function forgetPeer(deviceId: string): void {
  const peers = listKnownPeers().filter((p) => p.deviceId !== deviceId);
  try {
    localStorage.setItem(PEERS_KEY, JSON.stringify(peers));
  } catch {
    /* ignore */
  }
}

/** 读取或首次生成本机自动同步身份（固定 port + 长期密钥）。 */
export function getOrCreateLocalAutoIdentity(): LocalAutoIdentity {
  try {
    const raw = localStorage.getItem(LOCAL_AUTO_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalAutoIdentity>;
      if (
        typeof parsed.sessionId === 'string'
        && /^[A-Za-z0-9_-]{22}$/.test(parsed.sessionId)
        && typeof parsed.secretB64 === 'string'
        && typeof parsed.port === 'number'
      ) {
        try {
          const secret = base64UrlDecode(parsed.secretB64);
          if (secret.byteLength === LAN_SYNC_SECRET_BYTES) {
            return {
              sessionId: parsed.sessionId,
              secretB64: parsed.secretB64,
              port: parsed.port === LAN_AUTO_HOST_PORT ? parsed.port : LAN_AUTO_HOST_PORT,
            };
          }
        } catch {
          /* fall through to regenerate */
        }
      }
    }
  } catch {
    /* regenerate */
  }
  const identity: LocalAutoIdentity = {
    sessionId: createLanSyncSessionId(),
    secretB64: base64UrlEncode(randomLanSyncBytes(LAN_SYNC_SECRET_BYTES)),
    port: LAN_AUTO_HOST_PORT,
  };
  try {
    localStorage.setItem(LOCAL_AUTO_KEY, JSON.stringify(identity));
  } catch {
    /* ignore */
  }
  return identity;
}

export function decodePairingSecret(secretB64: string): Uint8Array {
  const secret = base64UrlDecode(secretB64);
  if (secret.byteLength !== LAN_SYNC_SECRET_BYTES) {
    throw new Error('配对密钥无效');
  }
  return secret;
}
