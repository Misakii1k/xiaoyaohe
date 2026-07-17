import { describe, expect, it, vi } from 'vitest';
import {
  LAN_SYNC_INVITATION_LIFETIME_MS,
  createLanSyncInvitation,
  encodeLanSyncInvitation,
  isPrivateLanIpv4,
  parseLanSyncInvitation,
} from './invitation';

describe('LAN sync invitations', () => {
  it('round-trips a short-lived invitation without exposing data in the query', () => {
    vi.stubGlobal('crypto', globalThis.crypto);
    const now = 1_725_000_000_000;
    const created = createLanSyncInvitation('192.168.1.20', 49_152, now);
    const parsed = parseLanSyncInvitation(created.uri, now + 1_000);

    expect(parsed).toEqual({
      host: '192.168.1.20',
      port: 49_152,
      sessionId: created.sessionId,
      expiresAt: now + LAN_SYNC_INVITATION_LIFETIME_MS,
      secret: created.secret,
    });
    expect(new URL(created.uri).searchParams.has('secret')).toBe(false);
    expect(new URL(created.uri).hash).toContain('secret=');
  });

  it('rejects expired, public, loopback, and long-lived invitations', () => {
    const now = 1_725_000_000_000;
    const created = createLanSyncInvitation('10.0.0.5', 50_000, now);
    expect(() => parseLanSyncInvitation(created.uri, now + LAN_SYNC_INVITATION_LIFETIME_MS + 6_000))
      .toThrow('已经过期');

    const base = { ...created, host: '8.8.8.8' };
    expect(() => encodeLanSyncInvitation(base, now)).toThrow('网络地址不可用');
    expect(() => encodeLanSyncInvitation({ ...base, host: '127.0.0.1' }, now)).toThrow('网络地址不可用');
    expect(() => encodeLanSyncInvitation({ ...created, expiresAt: now + 10 * 60_000 }, now))
      .toThrow('时间不正确');
  });

  it('only accepts private or link-local IPv4 addresses', () => {
    expect(isPrivateLanIpv4('10.1.2.3')).toBe(true);
    expect(isPrivateLanIpv4('172.31.255.1')).toBe(true);
    expect(isPrivateLanIpv4('192.168.0.2')).toBe(true);
    expect(isPrivateLanIpv4('169.254.8.9')).toBe(true);
    expect(isPrivateLanIpv4('172.32.0.1')).toBe(false);
    expect(isPrivateLanIpv4('256.1.1.1')).toBe(false);
    expect(isPrivateLanIpv4('example.test')).toBe(false);
  });
});
