import { describe, expect, it } from 'vitest';
import {
  createLanSyncSessionId,
  decryptLanSyncMessage,
  deriveLanSyncSessionKey,
  encryptLanSyncMessage,
  randomLanSyncBytes,
} from './crypto';

describe('LAN sync session encryption', () => {
  it('round-trips a message with bound session metadata', async () => {
    const secret = randomLanSyncBytes(32);
    const sessionId = createLanSyncSessionId();
    const key = await deriveLanSyncSessionKey(secret, sessionId);
    const metadata = { sessionId, sender: 'joiner' as const, sequence: 1, messageType: 'join' as const };
    const encrypted = await encryptLanSyncMessage(key, metadata, { deviceName: '家人手机' });

    await expect(decryptLanSyncMessage(key, encrypted, metadata))
      .resolves.toEqual({ deviceName: '家人手机' });
  });

  it('rejects tampering, the wrong secret, direction changes, and replayed sequence metadata', async () => {
    const secret = randomLanSyncBytes(32);
    const sessionId = createLanSyncSessionId();
    const key = await deriveLanSyncSessionKey(secret, sessionId);
    const metadata = { sessionId, sender: 'host' as const, sequence: 1, messageType: 'result' as const };
    const encrypted = await encryptLanSyncMessage(key, metadata, { ok: true });
    const parsed = JSON.parse(encrypted) as { ciphertext: string };
    parsed.ciphertext = `${parsed.ciphertext.slice(0, -1)}${parsed.ciphertext.endsWith('A') ? 'B' : 'A'}`;

    await expect(decryptLanSyncMessage(key, JSON.stringify(parsed), metadata)).rejects.toThrow('不匹配');
    const otherKey = await deriveLanSyncSessionKey(randomLanSyncBytes(32), sessionId);
    await expect(decryptLanSyncMessage(otherKey, encrypted, metadata)).rejects.toThrow('不匹配');
    await expect(decryptLanSyncMessage(key, encrypted, { ...metadata, sender: 'joiner' }))
      .rejects.toThrow('已经失效');
    await expect(decryptLanSyncMessage(key, encrypted, { ...metadata, sequence: 2 }))
      .rejects.toThrow('已经失效');
  });
});
