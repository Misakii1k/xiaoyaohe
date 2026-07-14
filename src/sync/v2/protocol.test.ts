import { describe, expect, it } from 'vitest';
import {
  SYNC_V2_LIMITS,
  validateEncryptedPayload,
  validateSyncResponse,
  validateSyncMutation,
  validateSyncRequest,
  type SyncMutation,
} from './protocol';

const encrypted = {
  algorithm: 'AES-GCM-256' as const,
  iv: 'AAAAAAAAAAAAAAAA',
  ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA',
};

function validMutation(overrides: Partial<SyncMutation> = {}): SyncMutation {
  return {
    mutationId: 'mutation_01',
    entityType: 'medication',
    entityId: 'med_01',
    operation: 'upsert',
    schemaVersion: 2,
    baseEntityRevision: 0,
    encrypted,
    ...overrides,
  };
}

describe('sync v2 protocol validation', () => {
  it('accepts the three encrypted health entity kinds', () => {
    for (const entityType of ['medication', 'schedule', 'intake'] as const) {
      expect(validateSyncMutation(validMutation({ entityType })).ok).toBe(true);
    }
  });

  it('rejects work data at both the request and mutation boundaries', () => {
    const workMutation = { ...validMutation(), entityType: 'work' };
    const mutationResult = validateSyncMutation(workMutation);
    expect(mutationResult.ok).toBe(false);
    if (!mutationResult.ok) expect(mutationResult.issues[0]?.code).toBe('unsupported_entity_type');

    const requestResult = validateSyncRequest({ sinceHouseholdRevision: 0, mutations: [], workEntries: [] });
    expect(requestResult.ok).toBe(false);
    if (!requestResult.ok) expect(requestResult.issues.some((entry) => entry.code === 'unknown_field')).toBe(true);
  });

  it('requires ciphertext for upserts and forbids it for deletes', () => {
    expect(validateSyncMutation({ ...validMutation(), encrypted: undefined }).ok).toBe(false);
    expect(
      validateSyncMutation({ ...validMutation(), operation: 'delete', encrypted }).ok,
    ).toBe(false);
    expect(
      validateSyncMutation({ ...validMutation(), operation: 'delete', encrypted: undefined }).ok,
    ).toBe(true);
  });

  it('enforces IV and ciphertext byte limits before decoding', () => {
    expect(validateEncryptedPayload({ ...encrypted, iv: 'AA' }).ok).toBe(false);
    const oversized = 'A'.repeat(Math.ceil(((SYNC_V2_LIMITS.ciphertextBytes + 1) * 8) / 6));
    expect(validateEncryptedPayload({ ...encrypted, ciphertext: oversized }).ok).toBe(false);
  });

  it('rejects duplicate IDs and oversized batches', () => {
    expect(
      validateSyncRequest({ sinceHouseholdRevision: 0, mutations: [validMutation(), validMutation()] }).ok,
    ).toBe(false);
    expect(
      validateSyncRequest({
        sinceHouseholdRevision: 0,
        mutations: Array.from({ length: SYNC_V2_LIMITS.mutationsPerRequest + 1 }, (_, index) =>
          validMutation({ mutationId: `mutation_${index}` }),
        ),
      }).ok,
    ).toBe(false);
  });

  it('validates untrusted sync responses before client decryption', () => {
    const response = {
      householdRevision: 1,
      nextHouseholdRevision: 1,
      hasMore: false,
      results: [{ mutationId: 'mutation_01', status: 'accepted', entityRevision: 1, householdRevision: 1 }],
      changes: [
        {
          entityType: 'medication',
          entityId: 'med_01',
          operation: 'upsert',
          schemaVersion: 2,
          mutationId: 'mutation_01',
          entityRevision: 1,
          householdRevision: 1,
          encrypted,
        },
      ],
    };
    expect(validateSyncResponse(response).ok).toBe(true);
    expect(validateSyncResponse({ ...response, changes: [{ ...response.changes[0], entityType: 'work' }] }).ok).toBe(false);
    expect(validateSyncResponse({ ...response, nextHouseholdRevision: 2 }).ok).toBe(false);
  });
});
