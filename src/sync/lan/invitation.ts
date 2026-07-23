import {
  LAN_SYNC_SECRET_BYTES,
  base64UrlDecode,
  base64UrlEncode,
  createLanSyncSessionId,
  randomLanSyncBytes,
} from './crypto';

export const LAN_SYNC_INVITATION_LIFETIME_MS = 2 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5_000;

export interface LanSyncInvitation {
  host: string;
  port: number;
  sessionId: string;
  expiresAt: number;
  secret: Uint8Array;
}

export interface CreatedLanSyncInvitation extends LanSyncInvitation {
  uri: string;
}

export function createLanSyncInvitation(
  host: string,
  port: number,
  now = Date.now(),
  overrides?: { sessionId?: string; secret?: Uint8Array; lifetimeMs?: number },
): CreatedLanSyncInvitation {
  return encodeLanSyncInvitation({
    host,
    port,
    sessionId: overrides?.sessionId ?? createLanSyncSessionId(),
    expiresAt: now + (overrides?.lifetimeMs ?? LAN_SYNC_INVITATION_LIFETIME_MS),
    secret: overrides?.secret ?? randomLanSyncBytes(LAN_SYNC_SECRET_BYTES),
  }, now);
}

export function encodeLanSyncInvitation(
  invitation: LanSyncInvitation,
  now = Date.now(),
): CreatedLanSyncInvitation {
  const normalized = validateLanSyncInvitation(invitation, now, false);
  const url = new URL('medbox-lan://join');
  url.searchParams.set('v', '1');
  url.searchParams.set('host', normalized.host);
  url.searchParams.set('port', String(normalized.port));
  url.searchParams.set('session', normalized.sessionId);
  url.searchParams.set('expires', String(normalized.expiresAt));
  url.hash = new URLSearchParams({ secret: base64UrlEncode(normalized.secret) }).toString();
  return { ...normalized, uri: url.toString() };
}

export function parseLanSyncInvitation(raw: string, now = Date.now()): LanSyncInvitation {
  if (raw.length > 1024) throw new Error('这不是本应用的连接码。');
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('这不是本应用的连接码。');
  }
  if (
    url.protocol !== 'medbox-lan:' ||
    url.hostname !== 'join' ||
    url.username ||
    url.password ||
    url.pathname !== '' ||
    url.searchParams.get('v') !== '1'
  ) {
    throw new Error('这不是本应用的连接码。');
  }
  const allowedQuery = new Set(['v', 'host', 'port', 'session', 'expires']);
  for (const key of url.searchParams.keys()) {
    if (!allowedQuery.has(key)) throw new Error('这不是本应用的连接码。');
  }
  const fragment = new URLSearchParams(url.hash.slice(1));
  if ([...fragment.keys()].some((key) => key !== 'secret')) {
    throw new Error('这不是本应用的连接码。');
  }
  return validateLanSyncInvitation({
    host: url.searchParams.get('host') ?? '',
    port: Number(url.searchParams.get('port')),
    sessionId: url.searchParams.get('session') ?? '',
    expiresAt: Number(url.searchParams.get('expires')),
    secret: base64UrlDecode(fragment.get('secret') ?? ''),
  }, now, true);
}

export function isPrivateLanIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const numbers = parts.map(Number);
  if (numbers.some((part) => part < 0 || part > 255)) return false;
  const [a, b] = numbers;
  return a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254);
}

function validateLanSyncInvitation(
  invitation: LanSyncInvitation,
  now: number,
  rejectExpired: boolean,
): LanSyncInvitation {
  if (!isPrivateLanIpv4(invitation.host)) throw new Error('连接码里的网络地址不可用。');
  if (!Number.isInteger(invitation.port) || invitation.port < 1024 || invitation.port > 65_535) {
    throw new Error('连接码里的网络地址不可用。');
  }
  if (!/^[A-Za-z0-9_-]{22}$/.test(invitation.sessionId)) {
    throw new Error('连接码内容不完整。');
  }
  if (invitation.secret.byteLength !== LAN_SYNC_SECRET_BYTES) {
    throw new Error('连接码内容不完整。');
  }
  if (!Number.isSafeInteger(invitation.expiresAt)) throw new Error('连接码内容不完整。');
  if (rejectExpired && invitation.expiresAt < now - MAX_CLOCK_SKEW_MS) {
    throw new Error('这个连接码已经过期，请重新生成。');
  }
  if (invitation.expiresAt > now + LAN_SYNC_INVITATION_LIFETIME_MS + MAX_CLOCK_SKEW_MS) {
    throw new Error('这个连接码的时间不正确。');
  }
  return {
    host: invitation.host,
    port: invitation.port,
    sessionId: invitation.sessionId,
    expiresAt: invitation.expiresAt,
    secret: new Uint8Array(invitation.secret),
  };
}
