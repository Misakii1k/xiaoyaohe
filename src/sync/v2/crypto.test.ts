import { describe, expect, it } from 'vitest';
import {
  createPairingCode,
  decodeRecoveryCode,
  decryptEntity,
  encodeRecoveryCode,
  encryptEntity,
  generateDataKey,
  parsePairingCode,
  type EntityAadMetadata,
} from './crypto';

const metadata: EntityAadMetadata = {
  householdId: 'a'.repeat(26),
  entityType: 'medication',
  entityId: 'med_01',
  schemaVersion: 2,
  mutationId: 'mutation_01',
  operation: 'upsert',
};

describe('sync v2 client cryptography', () => {
  it('round-trips encrypted JSON and binds all metadata as AAD', async () => {
    const key = await generateDataKey();
    const payload = await encryptEntity(key, metadata, { name: 'Example medicine', dose: 1.5 });
    await expect(decryptEntity(key, metadata, payload)).resolves.toEqual({ name: 'Example medicine', dose: 1.5 });
    await expect(
      decryptEntity(key, { ...metadata, mutationId: 'mutation_02' }, payload),
    ).rejects.toThrow();
    await expect(
      decryptEntity(key, { ...metadata, entityType: 'schedule' }, payload),
    ).rejects.toThrow();
  });

  it('encodes a checksummed 256-bit recovery code', () => {
    const raw = Uint8Array.from({ length: 32 }, (_, index) => index);
    const code = encodeRecoveryCode(raw);
    expect(decodeRecoveryCode(code)).toEqual(raw);
    const replacement = code.endsWith('0') ? '1' : '0';
    expect(() => decodeRecoveryCode(code.slice(0, -1) + replacement)).toThrow(/checksum|trailing|canonical/i);
  });

  it('keeps the data key and one-time secret in the pairing URI fragment', async () => {
    const recoveryCode = encodeRecoveryCode(new Uint8Array(32));
    const code = await createPairingCode({
      endpoint: 'https://sync.example.test',
      householdId: 'a'.repeat(26),
      pairingCode: 'p'.repeat(32),
      recoveryCode,
    });
    const url = new URL(code);
    expect(url.search).not.toContain(recoveryCode);
    expect(url.search).not.toContain('p'.repeat(32));
    expect(url.hash).toContain(encodeURIComponent(recoveryCode));

    const parsed = await parsePairingCode(code);
    expect(parsed.recoveryCode).toBe(recoveryCode);
    expect(parsed.pairingCode).toBe('p'.repeat(32));
    expect(parsed.pairingUrl).toBe(`https://sync.example.test/api/v2/households/${'a'.repeat(26)}/pair`);
    expect(parsed.pairingUrl).not.toContain(recoveryCode);
    expect(parsed.pairingUrl).not.toContain('p'.repeat(32));
  });

  it('rejects non-HTTPS pairing endpoints', async () => {
    await expect(
      createPairingCode({
        endpoint: 'http://sync.example.test',
        householdId: 'a'.repeat(26),
        pairingCode: 'p'.repeat(32),
        recoveryCode: encodeRecoveryCode(new Uint8Array(32)),
      }),
    ).rejects.toThrow(/HTTPS/);
  });
});
