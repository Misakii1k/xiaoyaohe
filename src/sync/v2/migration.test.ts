import { describe, expect, it, vi } from 'vitest';
import { SyncV2Api, SyncV2ProtocolError, type SyncFetch } from './api';
import { SyncV2Client } from './client';
import type { StoredSyncV2Credentials, SyncV2CredentialStore } from './credentials';
import { LegacyV1MigrationHelper, LegacyV1Reader } from './migration';
import { MemorySyncV2StateStore } from './state';
import type { EncryptedEntityRecord, MutationResult, SyncMutation } from './protocol';

const ENDPOINT = 'https://sync.example.test';
const HOUSEHOLD = 'd'.repeat(26);
const DEVICE_ID = 'dev_migration';
const TOKEN = `${DEVICE_ID}.${'m'.repeat(43)}`;

class TestCredentialStore implements SyncV2CredentialStore {
  private readonly values = new Map<string, StoredSyncV2Credentials>();
  async load(householdId: string) { return this.values.get(householdId) ?? null; }
  async save(householdId: string, credentials: StoredSyncV2Credentials) { this.values.set(householdId, credentials); }
  async clear(householdId: string) { this.values.delete(householdId); }
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function legacySnapshot() {
  return {
    meds: [{
      id: 'med_legacy',
      name: 'Legacy medicine',
      dosageText: '5mg',
      amountPerDose: '1 tablet',
      doseQuantity: 1,
      doseUnit: 'tablet',
      doseSourceText: '1 tablet',
      slots: ['morning'],
      mealRels: [],
      mealRelsBySlot: {},
      daysOfWeek: [],
      identity: { gtins: [], rawCodes: [], ocrNames: [], photoHashes: [] },
      expiryDate: new Date(2030, 0, 2).getTime(),
      updatedAt: 100,
      createdAt: 100,
    }],
    rules: [{
      id: 'rule_legacy',
      medId: 'med_legacy',
      slot: 'morning',
      timeLocal: '08:00',
      enabled: true,
      escalate: { repeatEveryMin: 10, maxRepeats: 3, notifyCaregiverAfterMin: 30 },
      updatedAt: 100,
    }],
    logs: [
      {
        id: 'intake_taken', medId: 'med_legacy', slot: 'morning', dueAt: 200,
        status: 'taken', ackAt: 210, updatedAt: 210,
      },
      {
        id: 'intake_pending', medId: 'med_legacy', slot: 'morning', dueAt: 300,
        status: 'pending', updatedAt: 300,
      },
    ],
    updatedAt: 300,
  };
}

describe('LegacyV1MigrationHelper', () => {
  it('authenticates a read-only v1 pull and enables retirement only after count and digest verification', async () => {
    let revision = 0;
    const records = new Map<string, EncryptedEntityRecord>();
    const legacyRequests: { method?: string; headers: Headers }[] = [];
    const v2RequestBodies: string[] = [];
    const fetchMock: SyncFetch = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v2/households') {
        return response({
          householdId: HOUSEHOLD,
          householdRevision: 0,
          device: { id: DEVICE_ID, name: 'Migration phone', token: TOKEN },
        }, 201);
      }
      if (url.pathname === '/api/sync') {
        legacyRequests.push({ method: init?.method, headers: new Headers(init?.headers) });
        return response(legacySnapshot());
      }
      if (url.pathname === `/api/v2/households/${HOUSEHOLD}/sync`) {
        v2RequestBodies.push(String(init?.body));
        const request = JSON.parse(String(init?.body)) as {
          sinceHouseholdRevision: number;
          mutations: SyncMutation[];
        };
        const results: MutationResult[] = [];
        for (const mutation of request.mutations) {
          revision += 1;
          const record: EncryptedEntityRecord = {
            entityType: mutation.entityType,
            entityId: mutation.entityId,
            operation: mutation.operation,
            schemaVersion: mutation.schemaVersion,
            mutationId: mutation.mutationId,
            entityRevision: 1,
            householdRevision: revision,
            ...(mutation.encrypted ? { encrypted: mutation.encrypted } : {}),
          };
          records.set(`${mutation.entityType}:${mutation.entityId}`, record);
          results.push({
            mutationId: mutation.mutationId,
            status: 'accepted',
            entityRevision: 1,
            householdRevision: revision,
          });
        }
        const changes = [...records.values()]
          .filter((record) => record.householdRevision > request.sinceHouseholdRevision)
          .sort((left, right) => left.householdRevision - right.householdRevision);
        return response({
          householdRevision: revision,
          nextHouseholdRevision: revision,
          hasMore: false,
          results,
          changes,
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const api = new SyncV2Api(ENDPOINT, { fetch: fetchMock });
    const client = new SyncV2Client({
      api,
      credentialStore: new TestCredentialStore(),
      stateStore: new MemorySyncV2StateStore(),
    });
    await client.createHousehold('Migration phone');
    let consumedRuns = 0;
    const helper = new LegacyV1MigrationHelper(
      client,
      new LegacyV1Reader({ fetch: fetchMock }),
      async (run) => {
        consumedRuns += 1;
        expect(run.confirmedChanges.length).toBeGreaterThan(0);
      },
    );
    const report = await helper.migrate({
      endpoint: ENDPOINT,
      household: 'legacy01',
      secret: 'authenticated-v1-secret',
    });

    expect(report).toMatchObject({
      canDisableV1: true,
      v1DeletionPerformed: false,
      sourceCounts: { medications: 1, schedules: 1, intakes: 1, omittedPendingIntakes: 1 },
      expectedEntityCount: 3,
      verifiedEntityCount: 3,
      pendingMutationIds: [],
      conflictMutationIds: [],
      rejectedMutationIds: [],
      offline: false,
    });
    expect(report.verifiedDigest).toBe(report.expectedDigest);
    expect(legacyRequests).toHaveLength(1);
    expect(legacyRequests[0].method).toBe('GET');
    expect(legacyRequests[0].headers.get('x-household')).toBe('legacy01');
    expect(legacyRequests[0].headers.get('x-secret')).toBe('authenticated-v1-secret');
    expect(legacyRequests[0].headers.get('cache-control')).toBe('no-store');
    expect(v2RequestBodies.join('')).not.toContain('Legacy medicine');
    expect([...records.values()].map((record) => record.entityType).sort()).toEqual(['intake', 'medication', 'schedule']);
    expect(consumedRuns).toBeGreaterThan(0);
  });

  it('refuses unauthenticated reads and rejects non-snapshot fields such as work entries', async () => {
    const fetchMock: SyncFetch = vi.fn(async () => response({
      ...legacySnapshot(),
      workEntries: [{ id: 'work_01', amount: 1000 }],
    }));
    const reader = new LegacyV1Reader({ fetch: fetchMock });
    await expect(reader.read({ endpoint: ENDPOINT, household: 'legacy01', secret: '' }))
      .rejects.toThrow(/authentication secret/i);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(reader.read({ endpoint: ENDPOINT, household: 'legacy01', secret: 'secret' }))
      .rejects.toBeInstanceOf(SyncV2ProtocolError);
  });

  it('does not authorize v1 retirement when the v2 server reports a conflict', async () => {
    const fetchMock: SyncFetch = vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v2/households') {
        return response({
          householdId: HOUSEHOLD,
          householdRevision: 0,
          device: { id: DEVICE_ID, name: 'Migration phone', token: TOKEN },
        }, 201);
      }
      if (path === '/api/sync') return response(legacySnapshot());
      const request = JSON.parse(String(init?.body)) as { mutations: SyncMutation[] };
      return response({
        householdRevision: 0,
        nextHouseholdRevision: 0,
        hasMore: false,
        results: request.mutations.map((mutation) => ({
          mutationId: mutation.mutationId,
          status: 'conflict',
          currentEntityRevision: 1,
        })),
        changes: [],
      });
    });
    const client = new SyncV2Client({
      api: new SyncV2Api(ENDPOINT, { fetch: fetchMock }),
      credentialStore: new TestCredentialStore(),
      stateStore: new MemorySyncV2StateStore(),
    });
    await client.createHousehold('Migration phone');
    const report = await new LegacyV1MigrationHelper(client, new LegacyV1Reader({ fetch: fetchMock })).migrate({
      endpoint: ENDPOINT,
      household: 'legacy01',
      secret: 'secret',
    });
    expect(report.canDisableV1).toBe(false);
    expect(report.conflictMutationIds).toHaveLength(3);
    expect(report.v1DeletionPerformed).toBe(false);
  });
});
