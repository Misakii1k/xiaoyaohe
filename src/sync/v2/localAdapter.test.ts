import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getMed,
  openMedboxDatabase,
  putMed,
  softDeleteMed,
} from '../../db/local';
import { putWorkEntry } from '../../db/work';
import {
  emptyIdentity,
  type Medication,
  type MedicationScheduleRevision,
  type WorkEntry,
} from '../../db/schema';
import { SyncV2Api, type SyncFetch } from './api';
import {
  createLocalSyncV2Client,
  MedboxSyncV2Adapter,
} from './localAdapter';
import type { StoredSyncV2Credentials, SyncV2CredentialStore } from './credentials';
import { base64UrlDecode, decryptEntity, importDataKey } from './crypto';
import { MemorySyncV2StateStore } from './state';
import type { SyncMutation } from './protocol';
import type { SyncMedicationPayload } from './entities';

const ENDPOINT = 'https://sync.example.test';
const HOUSEHOLD = 'd'.repeat(26);
const DEVICE_ID = 'dev_local_adapter';
const TOKEN = `${DEVICE_ID}.${'t'.repeat(43)}`;

class TestCredentialStore implements SyncV2CredentialStore {
  private readonly values = new Map<string, StoredSyncV2Credentials>();

  async load(householdId: string): Promise<StoredSyncV2Credentials | null> {
    const value = this.values.get(householdId);
    return value ? { ...value } : null;
  }

  async save(householdId: string, credentials: StoredSyncV2Credentials): Promise<void> {
    this.values.set(householdId, { ...credentials });
  }

  async clear(householdId: string): Promise<void> {
    this.values.delete(householdId);
  }
}

beforeEach(async () => {
  const database = await openMedboxDatabase();
  const transaction = database.transaction(
    ['meds', 'rules', 'scheduleRevisions', 'logs', 'outbox', 'photos', 'pushStates', 'syncV2Metadata'],
    'readwrite',
  );
  await Promise.all([
    transaction.objectStore('meds').clear(),
    transaction.objectStore('rules').clear(),
    transaction.objectStore('scheduleRevisions').clear(),
    transaction.objectStore('logs').clear(),
    transaction.objectStore('outbox').clear(),
    transaction.objectStore('photos').clear(),
    transaction.objectStore('pushStates').clear(),
    transaction.objectStore('syncV2Metadata').clear(),
  ]);
  await transaction.done;
});

describe('medbox sync-v2 local adapter', () => {
  it('queues a local edit, records an accepted revision, then emits a revision-based delete', async () => {
    const requests: SyncMutation[][] = [];
    const fetchMock: SyncFetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v2/households')) {
        return json({
          householdId: HOUSEHOLD,
          householdRevision: 0,
          device: { id: DEVICE_ID, name: 'Primary', token: TOKEN },
        }, 201);
      }
      const body = JSON.parse(String(init?.body)) as { mutations: SyncMutation[] };
      requests.push(body.mutations);
      return json({
        householdRevision: body.mutations.length,
        nextHouseholdRevision: body.mutations.length,
        hasMore: false,
        results: body.mutations.map((mutation) => ({
          mutationId: mutation.mutationId,
          status: 'accepted',
          entityRevision: mutation.baseEntityRevision + 1,
          householdRevision: mutation.baseEntityRevision + 1,
        })),
        changes: body.mutations.map((mutation) => ({
          entityType: mutation.entityType,
          entityId: mutation.entityId,
          operation: mutation.operation,
          schemaVersion: mutation.schemaVersion,
          mutationId: mutation.mutationId,
          entityRevision: mutation.baseEntityRevision + 1,
          householdRevision: mutation.baseEntityRevision + 1,
          ...(mutation.encrypted ? { encrypted: mutation.encrypted } : {}),
        })),
      });
    });
    const credentials = new TestCredentialStore();
    const binding = createLocalSyncV2Client({
      api: new SyncV2Api(ENDPOINT, { fetch: fetchMock }),
      credentialStore: credentials,
      stateStore: new MemorySyncV2StateStore(),
    });
    await binding.createHousehold('Primary');

    await putWorkEntry(workEntry('work-never-sync'));
    const localMedication = medication('med_local', 'Local medicine') as Medication & Record<string, unknown>;
    localMedication.expiryDate = 1_735_603_200_000;
    localMedication.expirySourceTimestamp = localMedication.expiryDate;
    localMedication.mealRel = 'with';
    localMedication.workEntries = [{ id: 'work-injected', income: 99_999 }];
    await putMed(localMedication);
    const queued = await binding.queueLocalChanges();
    expect(queued.queued).toHaveLength(1);
    expect(queued.queued[0].mutation).toMatchObject({
      entityType: 'medication',
      entityId: 'med_local',
      operation: 'upsert',
      baseEntityRevision: 0,
    });
    expect((await binding.client.listQueuedMutations()).map((item) => item.mutation.entityType))
      .toEqual(['medication']);
    const mutation = queued.queued[0].mutation;
    const storedCredentials = await credentials.load(HOUSEHOLD);
    const key = await importDataKey(base64UrlDecode(storedCredentials!.dataKey));
    const plaintext = await decryptEntity<Record<string, unknown>>(key, {
      householdId: HOUSEHOLD,
      entityType: mutation.entityType,
      entityId: mutation.entityId,
      schemaVersion: mutation.schemaVersion,
      mutationId: mutation.mutationId,
      operation: mutation.operation,
    }, mutation.encrypted!);
    expect(plaintext).not.toHaveProperty('expiryDate');
    expect(plaintext).not.toHaveProperty('expirySourceTimestamp');
    expect(plaintext).not.toHaveProperty('mealRel');
    expect(plaintext).not.toHaveProperty('workEntries');

    const run = await binding.sync();
    expect(run.accepted).toHaveLength(1);
    expect(requests).toHaveLength(1);
    const metadata = await metadataFor('medication', 'med_local');
    expect(metadata).toMatchObject({
      serverRevision: 1,
      serverOperation: 'upsert',
    });
    expect(metadata).not.toHaveProperty('pendingMutationId');
    expect(metadata?.canonicalPayloadHash).toMatch(/^sha256:/);

    const unchanged = await binding.queueLocalChanges();
    expect(unchanged.queued).toHaveLength(0);

    await softDeleteMed('med_local');
    const deletion = await binding.queueLocalChanges();
    expect(deletion.queued).toHaveLength(1);
    expect(deletion.queued[0].mutation).toMatchObject({
      entityType: 'medication',
      entityId: 'med_local',
      operation: 'delete',
      baseEntityRevision: 1,
    });
    expect(JSON.stringify(deletion.queued)).not.toContain('work-never-sync');

    await binding.forgetHousehold();
    expect(await credentials.load(HOUSEHOLD)).toBeNull();
    expect(await metadataFor('medication', 'med_local')).toBeUndefined();
  });

  it('applies medication, schedule, and intake changes with metadata in one database', async () => {
    const adapter = new MedboxSyncV2Adapter(HOUSEHOLD);
    const med = medication('med_remote', 'Remote medicine');
    const schedule = scheduleRevision('schedule:remote:1', med.id);
    const intake = {
      id: 'intake_remote',
      occurrenceId: 'occurrence_remote',
      scheduleRevisionId: schedule.id,
      sourceRuleId: schedule.sourceRuleId,
      medId: med.id,
      slot: 'morning' as const,
      dueAt: 1_725_163_200_000,
      status: 'taken' as const,
      ackAt: 1_725_163_260_000,
      inventoryDelta: 1,
      updatedAt: 2,
    };

    await expect(adapter.applyRemoteChange(upsertChange('medication', med, 1, 1))).resolves.toBe('applied');
    await expect(adapter.applyRemoteChange(upsertChange('schedule', schedule, 1, 2))).resolves.toBe('applied');
    await expect(adapter.applyRemoteChange(upsertChange('intake', intake, 1, 3))).resolves.toBe('applied');

    const database = await openMedboxDatabase();
    expect((await database.get('meds', med.id))?.name).toBe('Remote medicine');
    expect(await database.get('scheduleRevisions', schedule.id)).toMatchObject({ id: schedule.id });
    expect(await database.get('logs', intake.id)).toMatchObject({ status: 'taken' });
    expect(await metadataFor('schedule', schedule.id)).toMatchObject({ serverRevision: 1 });
    expect(await metadataFor('intake', intake.id)).toMatchObject({ serverRevision: 1 });

    await expect(adapter.applyRemoteChange(deleteChange('medication', med.id, 2, 4))).resolves.toBe('applied');
    await expect(adapter.applyRemoteChange(deleteChange('schedule', schedule.id, 2, 5))).resolves.toBe('applied');
    await expect(adapter.applyRemoteChange(deleteChange('intake', intake.id, 2, 6))).resolves.toBe('applied');
    expect((await database.get('meds', med.id))?.deleted).toBe(true);
    expect(await database.get('scheduleRevisions', schedule.id)).toBeUndefined();
    expect(await database.get('logs', intake.id)).toBeUndefined();
    expect(await metadataFor('medication', med.id)).toMatchObject({
      serverRevision: 2,
      serverOperation: 'delete',
    });
  });

  it('defers a conflicting remote value and never alters the local edit', async () => {
    const adapter = new MedboxSyncV2Adapter(HOUSEHOLD);
    const original = medication('med_conflict', 'Server revision one');
    await adapter.applyRemoteChange(upsertChange('medication', original, 1, 1));

    const edited = (await getMed(original.id))!;
    edited.name = 'Unsynced local edit';
    await putMed(edited);
    const conflictResult = {
      status: 'complete' as const,
      cursor: 2,
      householdRevision: 2,
      appliedChanges: [],
      deferredChanges: [],
      confirmedChanges: [],
      confirmedMutationIds: [],
      accepted: [],
      conflicts: [{ mutationId: 'mut_conflict', status: 'conflict' as const, currentEntityRevision: 2 }],
      rejected: [],
      pendingCount: 1,
    };
    await expect(adapter.consumeRunResult(conflictResult)).resolves.toEqual({ confirmed: 0 });

    const remote = medication(original.id, 'Server revision two');
    await expect(adapter.applyRemoteChange(upsertChange('medication', remote, 2, 2))).resolves.toBe('deferred');
    expect((await getMed(original.id))?.name).toBe('Unsynced local edit');
    expect(await metadataFor('medication', original.id)).toMatchObject({
      serverRevision: 1,
      serverOperation: 'upsert',
    });
  });
});

function medication(id: string, name: string): SyncMedicationPayload {
  return {
    id,
    name,
    dosageText: '5mg',
    amountPerDose: '1 tablet',
    doseQuantity: 1,
    doseUnit: 'tablet',
    doseSourceText: '1 tablet',
    doseReviewRequired: false,
    slots: ['morning'],
    mealRels: [],
    mealRelsBySlot: {},
    daysOfWeek: [],
    identity: emptyIdentity(),
    updatedAt: 1,
    createdAt: 1,
  };
}

function scheduleRevision(id: string, medId: string): MedicationScheduleRevision {
  return {
    id,
    medId,
    sourceRuleId: 'rule_remote',
    effectiveDate: '2024-09-01',
    createdAt: 1,
    enabled: true,
    slot: 'morning',
    timeLocal: '08:00',
    daysOfWeek: [],
    mealRels: [],
    doseQuantity: 1,
    doseUnit: 'tablet',
    reviewFlags: [],
  };
}

function workEntry(id: string): WorkEntry {
  return {
    id,
    projectName: 'Private salary project',
    taskName: 'Never upload this',
    startAt: 1_725_163_200_000,
    endAt: 1_725_166_800_000,
    breakMinutes: 0,
    status: 'stopped',
    updatedAt: 1,
  };
}

function upsertChange<T extends 'medication' | 'schedule' | 'intake'>(
  entityType: T,
  payload: T extends 'medication'
    ? SyncMedicationPayload
    : T extends 'schedule'
      ? MedicationScheduleRevision
      : Record<string, unknown>,
  entityRevision: number,
  householdRevision: number,
) {
  return {
    record: {
      entityType,
      entityId: String(payload.id),
      operation: 'upsert' as const,
      schemaVersion: 2 as const,
      mutationId: `remote_${entityType}_${householdRevision}`,
      entityRevision,
      householdRevision,
    },
    payload,
  } as Parameters<MedboxSyncV2Adapter['applyRemoteChange']>[0];
}

function deleteChange(
  entityType: 'medication' | 'schedule' | 'intake',
  entityId: string,
  entityRevision: number,
  householdRevision: number,
) {
  return {
    record: {
      entityType,
      entityId,
      operation: 'delete' as const,
      schemaVersion: 2 as const,
      mutationId: `remote_delete_${householdRevision}`,
      entityRevision,
      householdRevision,
    },
  } as Parameters<MedboxSyncV2Adapter['applyRemoteChange']>[0];
}

async function metadataFor(entityType: string, entityId: string) {
  const database = await openMedboxDatabase();
  const metadata = await database.getAllFromIndex('syncV2Metadata', 'byHousehold', HOUSEHOLD);
  return metadata.find((item) => item.entityType === entityType && item.entityId === entityId);
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
