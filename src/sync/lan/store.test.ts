import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  openMedboxDatabase,
  softDeleteMed,
  undoInventoryOperation,
  upgradeMedboxDatabase,
  type MedboxDB,
} from '../../db/local';
import {
  defaultEscalate,
  emptyIdentity,
  type IntakeLog,
  type Medication,
  type MedicationScheduleRevision,
  type ReminderRule,
} from '../../db/schema';
import {
  hashLanPayload,
  parseLanSyncSnapshot,
  selectLanIntakePayload,
  selectLanMedicationPayload,
  selectLanReminderRulePayload,
  selectLanSchedulePayload,
  type LanEntityPayloadMap,
  type LanEntityType,
  type LanSyncEntry,
  type LanSyncSnapshot,
} from './entities';
import {
  applyLanMergedSnapshot,
  createLanSnapshot,
  mergeLanSnapshots,
} from './store';

const SESSION_A = '-12345678901234567890_';
const SESSION_B = '_12345678901234567890-';
const ALL_STORES = [
  'meds',
  'rules',
  'scheduleRevisions',
  'logs',
  'photos',
  'pushStates',
  'syncLanMetadata',
  'inventoryLogs',
] as const;

beforeEach(async () => {
  const database = await openMedboxDatabase();
  const transaction = database.transaction(ALL_STORES, 'readwrite');
  await Promise.all(ALL_STORES.map((storeName) => transaction.objectStore(storeName).clear()));
  await transaction.done;
});

describe('LAN sync snapshot store', () => {
  it('upgrades a v5 database without deleting medication data', async () => {
    const databaseName = `medbox-v5-upgrade-${crypto.randomUUID()}`;
    const legacy = await openDB(databaseName, 5, {
      upgrade(database) {
        database.createObjectStore('meds', { keyPath: 'id' });
        database.createObjectStore('outbox', { keyPath: 'id' });
        database.createObjectStore('syncV2Metadata', { keyPath: 'key' });
      },
    });
    await legacy.put('meds', { id: 'med_kept', name: 'Keep me' });
    legacy.close();

    const upgraded = await openDB<MedboxDB>(databaseName, 6, {
      upgrade: upgradeMedboxDatabase,
    });
    const upgradedStoreNames = Array.from(upgraded.objectStoreNames);
    expect(upgradedStoreNames).not.toContain('outbox');
    expect(upgradedStoreNames).not.toContain('syncV2Metadata');
    expect(upgradedStoreNames).toContain('syncLanMetadata');
    expect(await upgraded.get('meds', 'med_kept')).toMatchObject({ id: 'med_kept', name: 'Keep me' });
    upgraded.close();
    indexedDB.deleteDatabase(databaseName);
  });

  it('keeps retired cloud stores out of the v6 database', async () => {
    const database = await openMedboxDatabase();
    const storeNames = Array.from(database.objectStoreNames).sort();
    expect(storeNames).toEqual([...ALL_STORES].sort());
    expect(storeNames).not.toContain('outbox');
    expect(storeNames).not.toContain('syncV2Metadata');
  });

  it('creates a four-entity snapshot, excludes local-only stores, and advances clocks only for changes', async () => {
    const database = await openMedboxDatabase();
    const med = medication('med_snapshot', 'Snapshot medicine', 10);
    med.inventory = { remaining: 42, unit: 'tablet' };
    med.identity.photoHashes = ['private-photo-hash'];
    (med as Medication & Record<string, unknown>).workSecretMarker = 'WORK_PRIVATE_MARKER';
    const rule = reminderRule('rule_snapshot', med.id, 10);
    const schedule = scheduleRevision('schedule:snapshot:1', med.id, rule.id, 10);
    const intake = intakeLog('intake_snapshot', med.id, rule.id, schedule.id, 10);
    const transaction = database.transaction(
      ['meds', 'rules', 'scheduleRevisions', 'logs', 'photos', 'pushStates'],
      'readwrite',
    );
    await Promise.all([
      transaction.objectStore('meds').put(med),
      transaction.objectStore('rules').put(rule),
      transaction.objectStore('scheduleRevisions').put(schedule),
      transaction.objectStore('logs').put(intake),
      transaction.objectStore('photos').put({
        id: 'photo_private',
        medId: med.id,
        blob: new Blob(['private-photo-bytes']),
        at: 1,
      }),
      transaction.objectStore('pushStates').put({ id: 'push_private', count: 9, lastSentAt: 1 }),
    ]);
    await transaction.done;

    const first = await createLanSnapshot('device_snapshot', SESSION_A);
    expect(first.entries.map((entry) => entry.entityType).sort()).toEqual([
      'intake',
      'medication',
      'reminderRule',
      'schedule',
    ]);
    const medEntry = first.entries.find((entry) => entry.entityType === 'medication');
    expect(medEntry?.tombstone).toBe(false);
    if (!medEntry || medEntry.entityType !== 'medication' || medEntry.tombstone) {
      throw new Error('Expected medication upsert.');
    }
    expect(medEntry.payload).not.toHaveProperty('inventory');
    expect(medEntry.payload).not.toHaveProperty('updatedAt');
    expect(medEntry.payload.identity).not.toHaveProperty('photoHashes');
    const wire = JSON.stringify(first);
    expect(wire).not.toContain('private-photo');
    expect(wire).not.toContain('push_private');
    expect(wire).not.toContain('WORK_PRIVATE_MARKER');

    const second = await createLanSnapshot('device_snapshot', SESSION_B);
    expect(second.entries).toEqual(first.entries);

    const inventoryOnly = (await database.get('meds', med.id))!;
    inventoryOnly.inventory!.remaining = 41;
    inventoryOnly.updatedAt += 1;
    await database.put('meds', inventoryOnly);
    const localOnlyChange = await createLanSnapshot('device_snapshot', SESSION_A);
    const localOnlyMed = localOnlyChange.entries.find((entry) => entry.entityType === 'medication')!;
    expect(localOnlyMed).toEqual(first.entries.find((entry) => entry.entityType === 'medication'));

    const changed = (await database.get('meds', med.id))!;
    changed.name = 'Changed locally';
    changed.updatedAt += 1;
    await database.put('meds', changed);
    const third = await createLanSnapshot('device_snapshot', SESSION_A);
    const firstMed = first.entries.find((entry) => entry.entityType === 'medication')!;
    const thirdMed = third.entries.find((entry) => entry.entityType === 'medication')!;
    expect(thirdMed.clock).toBeGreaterThan(firstMed.clock);
    for (const unchanged of third.entries.filter((entry) => entry.entityId !== med.id)) {
      expect(unchanged.clock).toBe(first.entries.find((entry) =>
        entry.entityType === unchanged.entityType && entry.entityId === unchanged.entityId)?.clock);
    }

    const metadata = await database.getAll('syncLanMetadata');
    expect(metadata.some((record) => record.kind === 'counter')).toBe(true);
    expect(metadata.filter((record) => record.kind === 'entity')).toHaveLength(4);
  });

  it('merges a union deterministically and reports concurrent medication review IDs', async () => {
    const localMedication = selectLanMedicationPayload(medication('med_shared', 'Local name', 1));
    const remoteMedication = { ...localMedication, name: 'Remote name' };
    const local = await snapshot([
      await upsert('medication', localMedication, 5, 'device_a'),
      await upsert('reminderRule', selectLanReminderRulePayload(
        reminderRule('rule_local', localMedication.id, 1),
      ), 6, 'device_a'),
    ]);
    const remote = await snapshot([
      await upsert('medication', remoteMedication, 5, 'device_b'),
      await tombstone('intake', 'intake_remote_only', 6, 'device_b'),
    ]);

    const leftToRight = await mergeLanSnapshots(local, remote);
    const rightToLeft = await mergeLanSnapshots(remote, local);
    expect(leftToRight.conflicts).toEqual([]);
    expect(leftToRight.snapshot).toEqual(rightToLeft.snapshot);
    expect(leftToRight.snapshot?.entries.map((entry) => entry.entityId).sort()).toEqual([
      'intake_remote_only',
      'med_shared',
      'rule_local',
    ]);
    const winner = leftToRight.snapshot?.entries.find((entry) => entry.entityId === 'med_shared');
    expect(winner?.deviceId).toBe('device_b');
    expect(leftToRight.inventoryConflicts).toEqual(['med_shared']);

    const idempotent = await mergeLanSnapshots(leftToRight.snapshot!, leftToRight.snapshot!);
    expect(idempotent.snapshot).toEqual(leftToRight.snapshot);
  });

  it('keeps a newer tombstone so stale data cannot resurrect medication or intake', async () => {
    const medPayload = selectLanMedicationPayload(medication('med_deleted', 'Old value', 1));
    const stale = await snapshot([
      await upsert('medication', medPayload, 4, 'device_old'),
      await upsert('intake', selectLanIntakePayload(
        intakeLog('intake_deleted', medPayload.id, undefined, undefined, 1),
      ), 4, 'device_old'),
    ]);
    const deleted = await snapshot([
      await tombstone('medication', medPayload.id, 5, 'device_delete'),
      await tombstone('intake', 'intake_deleted', 5, 'device_delete'),
    ]);
    const merged = await mergeLanSnapshots(stale, deleted);
    expect(merged.snapshot?.entries.every((entry) => entry.tombstone)).toBe(true);

    const database = await openMedboxDatabase();
    const local = medication(medPayload.id, 'Still present locally', 1);
    local.inventory = { remaining: 8, unit: 'tablet' };
    await database.put('meds', local);
    await database.put('logs', intakeLog('intake_deleted', medPayload.id, undefined, undefined, 1));
    const expectedLocal = await createLanSnapshot('device_local', SESSION_A);
    await applyLanMergedSnapshot(merged.snapshot!, expectedLocal);
    expect((await database.get('meds', medPayload.id))?.deleted).toBe(true);
    expect((await database.get('meds', medPayload.id))?.inventory?.remaining).toBe(8);
    expect(await database.get('logs', 'intake_deleted')).toBeUndefined();

    const afterApply = await createLanSnapshot('device_local', SESSION_A);
    const repeated = await applyLanMergedSnapshot(merged.snapshot!, afterApply);
    expect(repeated.applied).toBe(0);
    expect(repeated.unchanged).toBe(2);
  });

  it('preserves each phone inventory and photo hashes while applying medication and rules', async () => {
    const database = await openMedboxDatabase();
    const local = medication('med_inventory', 'Local medicine', 1);
    local.inventory = { remaining: 17, unit: 'tablet', lowThreshold: 2 };
    local.identity.photoHashes = ['local-photo-hash'];
    await database.put('meds', local);

    const remoteMedication = selectLanMedicationPayload(medication(local.id, 'Family medicine', 2));
    const remoteRule = selectLanReminderRulePayload(reminderRule('rule_family', local.id, 2));
    const incoming = await snapshot([
      await upsert('medication', remoteMedication, 3, 'device_family'),
      await upsert('reminderRule', remoteRule, 4, 'device_family'),
    ]);
    const expectedLocal = await createLanSnapshot('device_local', SESSION_A);
    const applied = await applyLanMergedSnapshot(incoming, expectedLocal);

    expect(applied).toMatchObject({
      applied: 2,
      medications: 1,
      reminderRules: 1,
      reminderRescheduleRequired: true,
    });
    expect(await database.get('meds', local.id)).toMatchObject({
      name: 'Family medicine',
      inventory: { remaining: 17, unit: 'tablet', lowThreshold: 2 },
      identity: { photoHashes: ['local-photo-hash'] },
    });
    expect(await database.get('rules', remoteRule.id)).toMatchObject({ medId: local.id });

    const afterApply = await createLanSnapshot('device_local', SESSION_A);
    const repeated = await applyLanMergedSnapshot(incoming, afterApply);
    expect(repeated).toMatchObject({ applied: 0, unchanged: 2, reminderRescheduleRequired: false });
  });

  it('preserves pre-deduction state and inventory while applying a remote medication', async () => {
    const database = await openMedboxDatabase();
    const local = medication('med_prededuct', 'Local medicine', 1);
    local.inventory = { remaining: 5, unit: 'tablet' };
    local.lastPreDeductedAt = 1_768_521_660_000;
    local.preDeduction = {
      localDate: '2026-07-17',
      occurrenceIds: ['occ_prededuct_1'],
      totalDose: 2,
      doseUnit: 'tablet',
      updatedAt: 1_768_521_660_000,
    };
    await database.put('meds', local);

    const remoteMedication = selectLanMedicationPayload(medication(local.id, 'Family medicine', 2));
    const incoming = await snapshot([
      await upsert('medication', remoteMedication, 3, 'device_family'),
    ]);
    const expectedLocal = await createLanSnapshot('device_local', SESSION_A);
    await applyLanMergedSnapshot(incoming, expectedLocal);

    expect(await database.get('meds', local.id)).toMatchObject({
      name: 'Family medicine',
      inventory: { remaining: 5, unit: 'tablet' },
      lastPreDeductedAt: 1_768_521_660_000,
      preDeduction: {
        localDate: '2026-07-17',
        occurrenceIds: ['occ_prededuct_1'],
        totalDose: 2,
        doseUnit: 'tablet',
        updatedAt: 1_768_521_660_000,
      },
    });
  });

  it('aborts atomically when local data changes after its snapshot was created', async () => {
    const database = await openMedboxDatabase();
    const original = medication('med_concurrent', 'Before transfer', 1);
    await database.put('meds', original);
    const expectedLocal = await createLanSnapshot('device_local', SESSION_A);
    const remotePayload = selectLanMedicationPayload({
      ...original,
      name: 'Remote edit',
      updatedAt: 2,
    });
    const remote = await snapshot([
      await upsert('medication', remotePayload, 20, 'device_remote'),
    ]);
    const merged = await mergeLanSnapshots(expectedLocal, remote);

    await database.put('meds', { ...original, name: 'Local edit during transfer', updatedAt: 3 });
    await expect(applyLanMergedSnapshot(merged.snapshot!, expectedLocal))
      .rejects.toThrow(/changed during transfer/);
    expect(await database.get('meds', original.id)).toMatchObject({
      name: 'Local edit during transfer',
      updatedAt: 3,
    });
  });

  it('does not import inventory deltas and detaches an unverifiable legacy local effect', async () => {
    const database = await openMedboxDatabase();
    const med = medication('med_local_inventory', 'Local inventory', 1);
    med.inventory = { remaining: 9, unit: 'tablet' };
    const localIntake = {
      ...intakeLog('intake_local_delta', med.id, undefined, undefined, 1),
      inventoryDelta: 1,
    };
    await database.put('meds', med);
    await database.put('logs', localIntake);
    const expectedLocal = await createLanSnapshot('device_local', SESSION_A);
    const expectedEntry = expectedLocal.entries.find((entry) => entry.entityId === localIntake.id);
    expect(expectedEntry?.tombstone).toBe(false);
    if (expectedEntry && !expectedEntry.tombstone) {
      expect(expectedEntry.payload).not.toHaveProperty('inventoryDelta');
    }

    const remotePayload = selectLanIntakePayload({ ...localIntake, updatedAt: 2, inventoryDelta: 50 });
    const remote = await snapshot([
      await upsert('intake', remotePayload, 20, 'device_remote'),
    ]);
    const merged = await mergeLanSnapshots(expectedLocal, remote);
    await applyLanMergedSnapshot(merged.snapshot!, expectedLocal);
    const stored = await database.get('logs', localIntake.id);
    expect(stored).toMatchObject({ status: 'taken' });
    expect(stored).not.toHaveProperty('inventoryDelta');
    expect(stored).not.toHaveProperty('inventoryOperationLogId');
    expect((await database.get('meds', med.id))?.inventory?.remaining).toBe(9);
  });

  it('applies LAN intake state but conservatively does not restore unlinked legacy deltas', async () => {
    const database = await openMedboxDatabase();
    const skippedMed = medication('med_restore_skipped', 'Restore skipped', 1);
    skippedMed.inventory = { remaining: 9, unit: 'tablet' };
    const deletedMed = medication('med_restore_deleted', 'Restore deleted', 1);
    deletedMed.inventory = { remaining: 8, unit: 'tablet' };
    const skippedIntake = {
      ...intakeLog('intake_restore_skipped', skippedMed.id, undefined, undefined, 1),
      inventoryDelta: 1,
    };
    const deletedIntake = {
      ...intakeLog('intake_restore_deleted', deletedMed.id, undefined, undefined, 1),
      inventoryDelta: 2,
    };
    await database.put('meds', skippedMed);
    await database.put('meds', deletedMed);
    await database.put('logs', skippedIntake);
    await database.put('logs', deletedIntake);
    const expectedLocal = await createLanSnapshot('device_local', SESSION_A);
    const skippedPayload = selectLanIntakePayload({
      ...skippedIntake,
      status: 'skipped',
      updatedAt: 2,
    });
    const remote = await snapshot([
      await upsert('intake', skippedPayload, 20, 'device_remote'),
      await tombstone('intake', deletedIntake.id, 21, 'device_remote'),
    ]);
    const merged = await mergeLanSnapshots(expectedLocal, remote);

    await applyLanMergedSnapshot(merged.snapshot!, expectedLocal);

    expect((await database.get('meds', skippedMed.id))?.inventory?.remaining).toBe(9);
    expect((await database.get('meds', deletedMed.id))?.inventory?.remaining).toBe(8);
    const storedSkipped = await database.get('logs', skippedIntake.id);
    expect(storedSkipped).toMatchObject({ status: 'skipped' });
    expect(storedSkipped).not.toHaveProperty('inventoryDelta');
    expect(await database.get('logs', deletedIntake.id)).toBeUndefined();
  });

  it('does not restore a LAN-cleared intake again after its linked inventory operation was undone', async () => {
    const database = await openMedboxDatabase();
    const med = medication('med_lan_undo_once', 'LAN undo once', 1);
    med.inventory = { remaining: 9, unit: 'tablet' };
    const intake = {
      ...intakeLog('intake_lan_undo_once', med.id, undefined, undefined, 1),
      inventoryDelta: 1,
      inventoryOperationLogId: 'inventory_lan_undo_once',
    };
    await database.put('meds', med);
    await database.put('logs', intake);
    await database.put('inventoryLogs', {
      id: intake.inventoryOperationLogId,
      medId: med.id,
      medName: med.name,
      action: 'deduct',
      previousRemaining: 10,
      newRemaining: 9,
      delta: -1,
      unit: 'tablet',
      source: 'intake',
      timestamp: 10,
      canUndo: true,
      intakeLogId: intake.id,
    });

    const undone = await undoInventoryOperation(intake.inventoryOperationLogId);
    expect(undone.ok).toBe(true);
    expect((await database.get('meds', med.id))?.inventory?.remaining).toBe(10);
    const intakeAfterUndo = await database.get('logs', intake.id);
    expect(intakeAfterUndo).not.toHaveProperty('inventoryDelta');
    expect(intakeAfterUndo).not.toHaveProperty('inventoryOperationLogId');

    const expectedLocal = await createLanSnapshot('device_local', SESSION_A);
    const remote = await snapshot([await tombstone('intake', intake.id, 50, 'device_remote')]);
    const merged = await mergeLanSnapshots(expectedLocal, remote);
    await applyLanMergedSnapshot(merged.snapshot!, expectedLocal);

    expect((await database.get('meds', med.id))?.inventory?.remaining).toBe(10);
    expect(await database.get('logs', intake.id)).toBeUndefined();
  });

  it('keeps intake history when its medication was soft-deleted before syncing', async () => {
    const database = await openMedboxDatabase();
    const med = medication('med_deleted_history', 'Deleted history', 1);
    const rule = reminderRule('rule_deleted_history', med.id, 1);
    const intake = intakeLog('intake_deleted_history', med.id, undefined, undefined, 1);
    await database.put('meds', med);
    await database.put('rules', rule);
    await database.put('logs', intake);
    await softDeleteMed(med.id);
    const outgoing = await createLanSnapshot('device_source', SESSION_A);
    expect(outgoing.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'medication', entityId: med.id, tombstone: true }),
      expect.objectContaining({ entityType: 'intake', entityId: intake.id, tombstone: false }),
    ]));

    const clear = database.transaction(ALL_STORES, 'readwrite');
    await Promise.all(ALL_STORES.map((storeName) => clear.objectStore(storeName).clear()));
    await clear.done;
    const expectedEmpty = await createLanSnapshot('device_target', SESSION_A);
    await applyLanMergedSnapshot(outgoing, expectedEmpty);

    expect(await database.get('logs', intake.id)).toMatchObject({
      medId: med.id,
      status: 'taken',
    });
    expect((await database.get('syncLanMetadata', `entity:medication\u0000${med.id}`))).toMatchObject({
      tombstone: true,
    });
  });

  it('rejects same-version corruption and immutable schedule conflicts', async () => {
    const firstPayload = selectLanMedicationPayload(medication('med_corrupt', 'First', 1));
    const secondPayload = { ...firstPayload, name: 'Second' };
    const first = await snapshot([await upsert('medication', firstPayload, 7, 'device_same')]);
    const second = await snapshot([await upsert('medication', secondPayload, 7, 'device_same')]);
    const corrupted = await mergeLanSnapshots(first, second);
    expect(corrupted.snapshot).toBeNull();
    expect(corrupted.conflicts[0]?.kind).toBe('same-version-different-payload');

    const scheduleA = scheduleRevision('schedule:immutable:1', 'med_one', 'rule_one', 1);
    const scheduleB = { ...scheduleA, timeLocal: '09:15' };
    const schedules = await mergeLanSnapshots(
      await snapshot([await upsert('schedule', selectLanSchedulePayload(scheduleA), 1, 'device_a')]),
      await snapshot([await upsert('schedule', selectLanSchedulePayload(scheduleB), 9, 'device_b')]),
    );
    expect(schedules.snapshot).toBeNull();
    expect(schedules.conflicts[0]?.kind).toBe('immutable-schedule-mismatch');
  });

  it('rejects immutable overwrite atomically without writing earlier entities or metadata', async () => {
    const database = await openMedboxDatabase();
    const existing = scheduleRevision('schedule:atomic:1', 'med_existing', 'rule_existing', 1);
    await database.put('scheduleRevisions', existing);
    const incomingMed = selectLanMedicationPayload(medication('med_should_rollback', 'Rollback', 2));
    const conflictingSchedule = selectLanSchedulePayload({ ...existing, timeLocal: '10:00' });
    const incoming = await snapshot([
      await upsert('medication', incomingMed, 2, 'device_remote'),
      await upsert('schedule', conflictingSchedule, 3, 'device_remote'),
    ]);
    const expectedLocal = await createLanSnapshot('device_local', SESSION_A);
    const baselineMetadata = await database.getAll('syncLanMetadata');

    await expect(applyLanMergedSnapshot(incoming, expectedLocal)).rejects.toThrow(/Immutable LAN schedule conflict/);
    expect(await database.get('meds', incomingMed.id)).toBeUndefined();
    expect((await database.get('scheduleRevisions', existing.id))?.timeLocal).toBe('08:00');
    expect(await database.getAll('syncLanMetadata')).toEqual(baselineMetadata);
  });

  it('rejects a reminder rule that points at a missing medication', async () => {
    const database = await openMedboxDatabase();
    const rule = selectLanReminderRulePayload(reminderRule('rule_orphan', 'med_missing', 1));
    const malicious = await snapshot([
      await upsert('reminderRule', rule, 1, 'device_remote'),
    ]);
    const expectedLocal = await createLanSnapshot('device_local', SESSION_A);
    const baselineMetadata = await database.getAll('syncLanMetadata');

    await expect(applyLanMergedSnapshot(malicious, expectedLocal)).rejects.toThrow(/missing medication/);
    expect(await database.get('rules', rule.id)).toBeUndefined();
    expect(await database.getAll('syncLanMetadata')).toEqual(baselineMetadata);
  });

  it('rejects missing explicit schedule and reminder references', async () => {
    const database = await openMedboxDatabase();
    const medPayload = selectLanMedicationPayload(medication('med_refs', 'References', 1));
    const intakeWithMissingSchedule = selectLanIntakePayload({
      ...intakeLog('intake_missing_schedule', medPayload.id, undefined, 'schedule:missing', 1),
    });
    const missingScheduleSnapshot = await snapshot([
      await upsert('medication', medPayload, 1, 'device_remote'),
      await upsert('intake', intakeWithMissingSchedule, 2, 'device_remote'),
    ]);
    const expectedEmpty = await createLanSnapshot('device_local', SESSION_A);
    await expect(applyLanMergedSnapshot(missingScheduleSnapshot, expectedEmpty))
      .rejects.toThrow(/missing schedule/);

    const schedule = selectLanSchedulePayload(
      scheduleRevision('schedule:missing-rule', medPayload.id, 'rule_missing', 1),
    );
    const missingRuleSnapshot = await snapshot([
      await upsert('medication', medPayload, 3, 'device_remote'),
      await upsert('schedule', schedule, 4, 'device_remote'),
    ]);
    await expect(applyLanMergedSnapshot(missingRuleSnapshot, expectedEmpty))
      .rejects.toThrow(/missing reminder rule/);
    expect(await database.get('meds', medPayload.id)).toBeUndefined();
  });
});

async function snapshot(entries: LanSyncEntry[]): Promise<LanSyncSnapshot> {
  return parseLanSyncSnapshot({ schemaVersion: 1, sessionId: SESSION_A, entries });
}

async function upsert<T extends LanEntityType>(
  entityType: T,
  payload: LanEntityPayloadMap[T],
  clock: number,
  deviceId: string,
): Promise<LanSyncEntry> {
  return {
    entityType,
    entityId: payload.id,
    tombstone: false,
    clock,
    deviceId,
    payloadHash: await hashLanPayload(payload),
    payload,
  } as LanSyncEntry;
}

async function tombstone(
  entityType: Exclude<LanEntityType, 'schedule'>,
  entityId: string,
  clock: number,
  deviceId: string,
): Promise<LanSyncEntry> {
  return {
    entityType,
    entityId,
    tombstone: true,
    clock,
    deviceId,
    payloadHash: await hashLanPayload(null),
  } as LanSyncEntry;
}

function medication(id: string, name: string, updatedAt: number): Medication {
  return {
    id,
    name,
    dosageText: '5mg',
    amountPerDose: '1 tablet',
    doseQuantity: 1,
    doseUnit: 'tablet',
    slots: ['morning'],
    mealRels: [],
    mealRelsBySlot: {},
    daysOfWeek: [],
    reminderMode: 'strong',
    identity: emptyIdentity(),
    updatedAt,
    createdAt: 1,
  };
}

function reminderRule(id: string, medId: string, updatedAt: number): ReminderRule {
  return {
    id,
    medId,
    slot: 'morning',
    timeLocal: '08:00',
    enabled: true,
    escalate: defaultEscalate(),
    updatedAt,
  };
}

function scheduleRevision(
  id: string,
  medId: string,
  sourceRuleId: string,
  createdAt: number,
): MedicationScheduleRevision {
  return {
    id,
    medId,
    sourceRuleId,
    effectiveDate: '2026-07-17',
    createdAt,
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

function intakeLog(
  id: string,
  medId: string,
  sourceRuleId: string | undefined,
  scheduleRevisionId: string | undefined,
  updatedAt: number,
): IntakeLog {
  return {
    id,
    medId,
    ...(sourceRuleId ? { sourceRuleId } : {}),
    ...(scheduleRevisionId ? { scheduleRevisionId } : {}),
    slot: 'morning',
    dueAt: 1_768_521_600_000,
    status: 'taken',
    ackAt: 1_768_521_660_000,
    updatedAt,
  };
}
