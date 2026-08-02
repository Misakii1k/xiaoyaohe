import type { IDBPTransaction } from 'idb';
import {
  listLogs,
  listMeds,
  listRules,
  listScheduleRevisions,
  openMedboxDatabase,
  type MedboxDB,
  type SyncLanEntityMetadata,
  type SyncLanEntityType,
} from '../../db/local';
import type {
  IntakeLog,
  Medication,
  MedicationScheduleRevision,
  ReminderRule,
} from '../../db/schema';
import { restoreInventory } from '../../features/inventory';
import {
  LAN_SYNC_SCHEMA_VERSION,
  canonicalLanJson,
  hashLanPayload,
  parseLanSyncSnapshot,
  selectLanIntakePayload,
  selectLanMedicationPayload,
  selectLanReminderRulePayload,
  selectLanSchedulePayload,
  verifyLanSyncSnapshotHashes,
  type LanEntityPayloadMap,
  type LanEntityType,
  type LanMedicationEntry,
  type LanReminderRuleEntry,
  type LanScheduleEntry,
  type LanSyncEntry,
  type LanSyncSnapshot,
} from './entities';

export { parseLanSyncSnapshot } from './entities';
export type { LanSyncSnapshot } from './entities';

const COUNTER_KEY = 'counter' as const;
const LAN_STORES = ['meds', 'rules', 'scheduleRevisions', 'logs', 'syncLanMetadata'] as const;
type LanStoreNames = typeof LAN_STORES;
type LanTransaction = IDBPTransaction<MedboxDB, LanStoreNames, 'readwrite'>;

export interface LanSyncConflict {
  kind: 'same-version-different-payload' | 'immutable-schedule-mismatch';
  entityType: LanEntityType;
  entityId: string;
  localVersion: { clock: number; deviceId: string };
  remoteVersion: { clock: number; deviceId: string };
}

export interface LanSyncMergeStats {
  total: number;
  selectedLocal: number;
  selectedRemote: number;
  tombstones: number;
}

export interface LanSyncMergeResult {
  snapshot: LanSyncSnapshot | null;
  conflicts: LanSyncConflict[];
  /** Medication IDs whose non-inventory fields diverged on two devices. */
  inventoryConflicts: string[];
  stats: LanSyncMergeStats;
}

export interface LanSyncApplyResult {
  applied: number;
  unchanged: number;
  tombstones: number;
  medications: number;
  reminderRules: number;
  schedules: number;
  intakes: number;
  reminderRescheduleRequired: boolean;
}

interface CurrentDescription {
  entityType: LanEntityType;
  entityId: string;
  tombstone: boolean;
  payload?: LanEntityPayloadMap[LanEntityType];
}

export async function createLanSnapshot(
  deviceId: string,
  sessionId: string,
): Promise<LanSyncSnapshot> {
  const [meds, rules, schedules, logs, database] = await Promise.all([
    listMeds(true),
    listRules(true),
    listScheduleRevisions(),
    listLogs(),
    openMedboxDatabase(),
  ]);
  const storedMetadata = await database.getAll('syncLanMetadata');
  const entityMetadata = new Map<string, SyncLanEntityMetadata>();
  let counterClock = 0;
  for (const record of storedMetadata) {
    if (record.kind === 'counter') {
      counterClock = Math.max(counterClock, record.clock);
    } else {
      entityMetadata.set(entityKey(record.entityType, record.entityId), record);
      counterClock = Math.max(counterClock, record.clock);
    }
  }

  const descriptions = describeCurrentState(meds, rules, schedules, logs, entityMetadata);
  const hashed = await Promise.all(descriptions.map(async (description) => ({
    description,
    payloadHash: await hashLanPayload(description.tombstone ? null : description.payload),
  })));
  const metadataUpdates: SyncLanEntityMetadata[] = [];
  const entries: LanSyncEntry[] = [];

  for (const { description, payloadHash } of hashed) {
    const key = entityKey(description.entityType, description.entityId);
    const existing = entityMetadata.get(key);
    let version: Pick<SyncLanEntityMetadata, 'clock' | 'deviceId'>;
    if (
      existing &&
      existing.payloadHash === payloadHash &&
      existing.tombstone === description.tombstone
    ) {
      version = existing;
    } else {
      counterClock += 1;
      version = { clock: counterClock, deviceId };
      metadataUpdates.push({
        key,
        kind: 'entity',
        entityType: description.entityType,
        entityId: description.entityId,
        operation: description.tombstone ? 'delete' : 'upsert',
        clock: version.clock,
        deviceId: version.deviceId,
        payloadHash,
        tombstone: description.tombstone,
      });
    }
    entries.push(toEntry(description, payloadHash, version.clock, version.deviceId));
  }

  entries.sort(compareEntries);
  const snapshot = parseLanSyncSnapshot({
    schemaVersion: LAN_SYNC_SCHEMA_VERSION,
    sessionId,
    entries,
  });
  await verifyLanSyncSnapshotHashes(snapshot);

  const transaction = database.transaction('syncLanMetadata', 'readwrite');
  for (const metadata of metadataUpdates) await transaction.store.put(metadata);
  await transaction.store.put({
    key: COUNTER_KEY,
    kind: 'counter',
    deviceId,
    clock: counterClock,
  });
  await transaction.done;
  return snapshot;
}

export async function mergeLanSnapshots(
  localValue: LanSyncSnapshot,
  remoteValue: LanSyncSnapshot,
): Promise<LanSyncMergeResult> {
  return mergeLanSnapshotsWithPolicy(localValue, remoteValue, 'merge');
}

/** Prefer one whole snapshot or LWW-merge. Overwrite modes still verify session ids/hashes. */
export async function mergeLanSnapshotsWithPolicy(
  localValue: LanSyncSnapshot,
  remoteValue: LanSyncSnapshot,
  policy: 'merge' | 'overwrite-local' | 'overwrite-remote' = 'merge',
): Promise<LanSyncMergeResult> {
  const local = parseLanSyncSnapshot(localValue);
  const remote = parseLanSyncSnapshot(remoteValue);
  if (local.sessionId !== remote.sessionId) {
    throw new Error('LAN sync snapshots belong to different sessions.');
  }
  await Promise.all([
    verifyLanSyncSnapshotHashes(local),
    verifyLanSyncSnapshotHashes(remote),
  ]);

  if (policy === 'overwrite-local') {
    return {
      snapshot: parseLanSyncSnapshot({
        schemaVersion: local.schemaVersion,
        sessionId: local.sessionId,
        entries: local.entries,
      }),
      conflicts: [],
      inventoryConflicts: [],
      stats: {
        total: local.entries.length,
        selectedLocal: local.entries.length,
        selectedRemote: 0,
        tombstones: local.entries.filter((entry) => entry.tombstone).length,
      },
    };
  }
  if (policy === 'overwrite-remote') {
    return {
      snapshot: parseLanSyncSnapshot({
        schemaVersion: remote.schemaVersion,
        sessionId: remote.sessionId,
        entries: remote.entries,
      }),
      conflicts: [],
      inventoryConflicts: [],
      stats: {
        total: remote.entries.length,
        selectedLocal: 0,
        selectedRemote: remote.entries.length,
        tombstones: remote.entries.filter((entry) => entry.tombstone).length,
      },
    };
  }

  const localByKey = new Map(local.entries.map((entry) => [entryKey(entry), entry]));
  const remoteByKey = new Map(remote.entries.map((entry) => [entryKey(entry), entry]));
  const keys = [...new Set([...localByKey.keys(), ...remoteByKey.keys()])].sort(compareText);
  const conflicts: LanSyncConflict[] = [];
  const inventoryConflicts = new Set<string>();
  const merged: LanSyncEntry[] = [];
  let selectedLocal = 0;
  let selectedRemote = 0;

  for (const key of keys) {
    const localEntry = localByKey.get(key);
    const remoteEntry = remoteByKey.get(key);
    if (!localEntry) {
      merged.push(remoteEntry!);
      selectedRemote += 1;
      continue;
    }
    if (!remoteEntry) {
      merged.push(localEntry);
      selectedLocal += 1;
      continue;
    }

    const hashDiffers = localEntry.payloadHash !== remoteEntry.payloadHash ||
      localEntry.tombstone !== remoteEntry.tombstone;
    if (
      localEntry.entityType === 'medication' &&
      hashDiffers &&
      !localEntry.tombstone &&
      !remoteEntry.tombstone &&
      localEntry.deviceId !== remoteEntry.deviceId
    ) {
      inventoryConflicts.add(localEntry.entityId);
    }

    const versionOrder = compareVersions(localEntry, remoteEntry);
    if (localEntry.entityType === 'schedule' && hashDiffers) {
      conflicts.push(conflict('immutable-schedule-mismatch', localEntry, remoteEntry));
    } else if (versionOrder === 0 && hashDiffers) {
      conflicts.push(conflict('same-version-different-payload', localEntry, remoteEntry));
    }

    if (versionOrder >= 0) {
      merged.push(localEntry);
      selectedLocal += 1;
    } else {
      merged.push(remoteEntry);
      selectedRemote += 1;
    }
  }

  merged.sort(compareEntries);
  const stats: LanSyncMergeStats = {
    total: merged.length,
    selectedLocal,
    selectedRemote,
    tombstones: merged.filter((entry) => entry.tombstone).length,
  };
  if (conflicts.length > 0) {
    return {
      snapshot: null,
      conflicts,
      inventoryConflicts: [...inventoryConflicts].sort(compareText),
      stats,
    };
  }

  return {
    snapshot: parseLanSyncSnapshot({
      schemaVersion: LAN_SYNC_SCHEMA_VERSION,
      sessionId: local.sessionId,
      entries: merged,
    }),
    conflicts: [],
    inventoryConflicts: [...inventoryConflicts].sort(compareText),
    stats,
  };
}

export async function applyLanMergedSnapshot(
  value: LanSyncSnapshot,
  expectedLocalValue: LanSyncSnapshot,
): Promise<LanSyncApplyResult> {
  const snapshot = parseLanSyncSnapshot(value);
  const expectedLocal = parseLanSyncSnapshot(expectedLocalValue);
  if (snapshot.sessionId !== expectedLocal.sessionId) {
    throw new Error('LAN sync snapshots belong to different sessions.');
  }
  await Promise.all([
    verifyLanSyncSnapshotHashes(snapshot),
    verifyLanSyncSnapshotHashes(expectedLocal),
  ]);
  const expectedLocalByKey = new Map(
    expectedLocal.entries.map((entry) => [entryKey(entry), entry]),
  );
  const database = await openMedboxDatabase();
  const transaction = database.transaction(
    ['meds', 'rules', 'scheduleRevisions', 'logs', 'syncLanMetadata'],
    'readwrite',
  );
  const medicationStore = transaction.objectStore('meds');
  const ruleStore = transaction.objectStore('rules');
  const scheduleStore = transaction.objectStore('scheduleRevisions');
  const intakeStore = transaction.objectStore('logs');
  const metadataStore = transaction.objectStore('syncLanMetadata');

  const result: LanSyncApplyResult = {
    applied: 0,
    unchanged: 0,
    tombstones: 0,
    medications: 0,
    reminderRules: 0,
    schedules: 0,
    intakes: 0,
    reminderRescheduleRequired: false,
  };

  try {
    const medicationEntries = new Map<string, LanMedicationEntry>();
    const reminderEntries = new Map<string, LanReminderRuleEntry>();
    const scheduleEntries = new Map<string, LanScheduleEntry>();
    const referencedMedicationIds = new Set<string>();
    const referencedScheduleIds = new Set<string>();
    const referencedRuleIds = new Set<string>();
    for (const entry of snapshot.entries) {
      if (entry.entityType === 'medication') {
        medicationEntries.set(entry.entityId, entry);
      } else if (entry.entityType === 'reminderRule') {
        reminderEntries.set(entry.entityId, entry);
        if (!entry.tombstone) referencedMedicationIds.add(entry.payload.medId);
      } else if (entry.entityType === 'schedule') {
        scheduleEntries.set(entry.entityId, entry);
        referencedScheduleIds.add(entry.entityId);
        referencedMedicationIds.add(entry.payload.medId);
        referencedRuleIds.add(entry.payload.sourceRuleId);
      } else if (!entry.tombstone) {
        referencedMedicationIds.add(entry.payload.medId);
        if (entry.payload.scheduleRevisionId) referencedScheduleIds.add(entry.payload.scheduleRevisionId);
        if (entry.payload.sourceRuleId) referencedRuleIds.add(entry.payload.sourceRuleId);
      }
    }

    const existingMetadata = await Promise.all(snapshot.entries.map((entry) =>
      metadataStore.get(entityKey(entry.entityType, entry.entityId))));
    const existingMedications = new Map<string, Medication | undefined>();
    await Promise.all([...referencedMedicationIds].map(async (medId) => {
      existingMedications.set(medId, await medicationStore.get(medId));
    }));
    const existingSchedules = new Map<string, MedicationScheduleRevision | undefined>();
    await Promise.all([...referencedScheduleIds].map(async (scheduleId) => {
      existingSchedules.set(scheduleId, await scheduleStore.get(scheduleId));
    }));
    const existingRules = new Map<string, ReminderRule | undefined>();
    await Promise.all([...referencedRuleIds].map(async (ruleId) => {
      existingRules.set(ruleId, await ruleStore.get(ruleId));
    }));

    for (let index = 0; index < snapshot.entries.length; index += 1) {
      const entry = snapshot.entries[index];
      if (!entry) continue;
      const metadata = existingMetadata[index];
      if (metadata?.kind === 'entity') assertIncomingVersionIsApplicable(metadata, entry);
      await assertLocalStateMatchesSnapshot(
        transaction,
        entry,
        expectedLocalByKey.get(entryKey(entry)),
        metadata?.kind === 'entity' ? metadata : undefined,
      );
      if (entry.entityType === 'schedule') {
        const existing = existingSchedules.get(entry.entityId);
        if (
          existing &&
          canonicalLanJson(selectLanSchedulePayload(existing)) !== canonicalLanJson(entry.payload)
        ) {
          throw new Error(`Immutable LAN schedule conflict for ${entry.entityId}.`);
        }
      }
    }
    assertCrossReferences(
      snapshot.entries,
      medicationEntries,
      reminderEntries,
      scheduleEntries,
      existingMedications,
      existingSchedules,
      existingRules,
    );

    for (let index = 0; index < snapshot.entries.length; index += 1) {
      const entry = snapshot.entries[index];
      if (!entry) continue;
      let entityChanged = true;

      if (entry.entityType === 'medication') {
        const current = await medicationStore.get(entry.entityId);
        entityChanged = !matchesMedication(current, entry);
        if (entityChanged) await applyMedication(transaction, current, entry);
        result.medications += Number(entityChanged);
      } else if (entry.entityType === 'reminderRule') {
        const current = await ruleStore.get(entry.entityId);
        entityChanged = !matchesReminderRule(current, entry);
        if (entityChanged) await applyReminderRule(transaction, current, entry);
        result.reminderRules += Number(entityChanged);
      } else if (entry.entityType === 'schedule') {
        const current = existingSchedules.get(entry.entityId);
        entityChanged = current === undefined;
        if (entityChanged) {
          await scheduleStore.put(structuredClone(entry.payload) as MedicationScheduleRevision);
        }
        result.schedules += Number(entityChanged);
      } else {
        const current = await intakeStore.get(entry.entityId) as (IntakeLog & { deleted?: boolean }) | undefined;
        entityChanged = !matchesIntake(current, entry);
        if (entityChanged) await applyIntake(transaction, current, entry);
        result.intakes += Number(entityChanged);
      }

      if (entityChanged) result.applied += 1;
      else result.unchanged += 1;
      if (entry.tombstone) result.tombstones += 1;
      await metadataStore.put(toMetadata(entry));

    }

    const counter = await metadataStore.get(COUNTER_KEY);
    if (counter?.kind === 'counter') {
      const maxIncomingClock = snapshot.entries.reduce(
        (maximum, entry) => Math.max(maximum, entry.clock),
        counter.clock,
      );
      if (maxIncomingClock !== counter.clock) {
        await metadataStore.put({ ...counter, clock: maxIncomingClock });
      }
    }
    await transaction.done;
  } catch (error) {
    try { transaction.abort(); } catch { /* The transaction may already be closed. */ }
    await transaction.done.catch(() => undefined);
    throw error;
  }

  result.reminderRescheduleRequired =
    result.medications + result.reminderRules + result.schedules > 0;
  return result;
}

function describeCurrentState(
  meds: Medication[],
  rules: ReminderRule[],
  schedules: MedicationScheduleRevision[],
  logs: IntakeLog[],
  metadata: ReadonlyMap<string, SyncLanEntityMetadata>,
): CurrentDescription[] {
  const descriptions = new Map<string, CurrentDescription>();
  for (const med of meds) {
    setDescription(descriptions, med.deleted
      ? tombstoneDescription('medication', med.id)
      : upsertDescription('medication', med.id, selectLanMedicationPayload(med)));
  }
  for (const rule of rules) {
    setDescription(descriptions, rule.deleted
      ? tombstoneDescription('reminderRule', rule.id)
      : upsertDescription('reminderRule', rule.id, selectLanReminderRulePayload(rule)));
  }
  for (const schedule of schedules) {
    setDescription(
      descriptions,
      upsertDescription('schedule', schedule.id, selectLanSchedulePayload(schedule)),
    );
  }
  for (const log of logs as Array<IntakeLog & { deleted?: boolean }>) {
    if (log.deleted) {
      setDescription(descriptions, tombstoneDescription('intake', log.id));
    } else if (log.status === 'taken' || log.status === 'skipped') {
      setDescription(descriptions, upsertDescription('intake', log.id, selectLanIntakePayload(log)));
    }
  }

  for (const record of metadata.values()) {
    const key = entityKey(record.entityType, record.entityId);
    if (descriptions.has(key) || record.entityType === 'schedule') continue;
    setDescription(descriptions, tombstoneDescription(record.entityType, record.entityId));
  }
  return [...descriptions.values()].sort((left, right) => compareText(
    entityKey(left.entityType, left.entityId),
    entityKey(right.entityType, right.entityId),
  ));
}

function setDescription(
  descriptions: Map<string, CurrentDescription>,
  description: CurrentDescription,
): void {
  descriptions.set(entityKey(description.entityType, description.entityId), description);
}

function upsertDescription<T extends LanEntityType>(
  entityType: T,
  entityId: string,
  payload: LanEntityPayloadMap[T],
): CurrentDescription {
  return { entityType, entityId, tombstone: false, payload };
}

function tombstoneDescription(
  entityType: Exclude<LanEntityType, 'schedule'>,
  entityId: string,
): CurrentDescription {
  return { entityType, entityId, tombstone: true };
}

function toEntry(
  description: CurrentDescription,
  payloadHash: string,
  versionClock: number,
  deviceId: string,
): LanSyncEntry {
  const version = {
    entityType: description.entityType,
    entityId: description.entityId,
    clock: versionClock,
    deviceId,
    payloadHash,
  };
  if (description.tombstone) {
    return { ...version, tombstone: true } as LanSyncEntry;
  }
  return { ...version, tombstone: false, payload: description.payload } as LanSyncEntry;
}

function toMetadata(entry: LanSyncEntry): SyncLanEntityMetadata {
  return {
    key: entityKey(entry.entityType, entry.entityId),
    kind: 'entity',
    entityType: entry.entityType,
    entityId: entry.entityId,
    operation: entry.tombstone ? 'delete' : 'upsert',
    clock: entry.clock,
    deviceId: entry.deviceId,
    payloadHash: entry.payloadHash,
    tombstone: entry.tombstone,
  };
}

function assertIncomingVersionIsApplicable(
  current: SyncLanEntityMetadata,
  incoming: LanSyncEntry,
): void {
  const order = compareVersions(current, incoming);
  if (order > 0) {
    throw new Error(`LAN sync snapshot is stale for ${incoming.entityType}:${incoming.entityId}.`);
  }
  if (
    order === 0 &&
    (current.payloadHash !== incoming.payloadHash || current.tombstone !== incoming.tombstone)
  ) {
    throw new Error(`LAN sync version conflict for ${incoming.entityType}:${incoming.entityId}.`);
  }
}

async function assertLocalStateMatchesSnapshot(
  transaction: LanTransaction,
  incoming: LanSyncEntry,
  expected: LanSyncEntry | undefined,
  metadata: SyncLanEntityMetadata | undefined,
): Promise<void> {
  const current = await describeStoredEntry(transaction, incoming, metadata);
  const matches = expected
    ? Boolean(
        current &&
        current.tombstone === expected.tombstone &&
        (expected.tombstone || canonicalLanJson(current.payload) === canonicalLanJson(expected.payload)),
      )
    : current === null;
  if (!matches) {
    throw new Error(`Local LAN sync data changed during transfer for ${incoming.entityType}:${incoming.entityId}.`);
  }
}

async function describeStoredEntry(
  transaction: LanTransaction,
  entry: LanSyncEntry,
  metadata: SyncLanEntityMetadata | undefined,
): Promise<CurrentDescription | null> {
  if (entry.entityType === 'medication') {
    const current = await transaction.objectStore('meds').get(entry.entityId);
    if (current) {
      return current.deleted
        ? tombstoneDescription('medication', entry.entityId)
        : upsertDescription('medication', entry.entityId, selectLanMedicationPayload(current));
    }
  } else if (entry.entityType === 'reminderRule') {
    const current = await transaction.objectStore('rules').get(entry.entityId);
    if (current) {
      return current.deleted
        ? tombstoneDescription('reminderRule', entry.entityId)
        : upsertDescription('reminderRule', entry.entityId, selectLanReminderRulePayload(current));
    }
  } else if (entry.entityType === 'schedule') {
    const current = await transaction.objectStore('scheduleRevisions').get(entry.entityId);
    return current
      ? upsertDescription('schedule', entry.entityId, selectLanSchedulePayload(current))
      : null;
  } else {
    const current = await transaction.objectStore('logs').get(entry.entityId) as
      (IntakeLog & { deleted?: boolean }) | undefined;
    if (current?.deleted) return tombstoneDescription('intake', entry.entityId);
    if (current?.status === 'taken' || current?.status === 'skipped') {
      return upsertDescription('intake', entry.entityId, selectLanIntakePayload(current));
    }
  }
  return metadata
    ? tombstoneDescription(entry.entityType, entry.entityId)
    : null;
}

function assertCrossReferences(
  entries: readonly LanSyncEntry[],
  medicationEntries: ReadonlyMap<string, LanMedicationEntry>,
  reminderEntries: ReadonlyMap<string, LanReminderRuleEntry>,
  scheduleEntries: ReadonlyMap<string, LanScheduleEntry>,
  existingMedications: ReadonlyMap<string, Medication | undefined>,
  existingSchedules: ReadonlyMap<string, MedicationScheduleRevision | undefined>,
  existingRules: ReadonlyMap<string, ReminderRule | undefined>,
): void {
  const isMedicationActive = (medId: string): boolean => {
    const incoming = medicationEntries.get(medId);
    if (incoming) return !incoming.tombstone;
    const existing = existingMedications.get(medId);
    return Boolean(existing && !existing.deleted);
  };
  const isMedicationKnown = (medId: string): boolean =>
    medicationEntries.has(medId) || Boolean(existingMedications.get(medId));
  const isRuleKnown = (ruleId: string): boolean =>
    reminderEntries.has(ruleId) || Boolean(existingRules.get(ruleId));

  for (const entry of entries) {
    if (entry.entityType === 'reminderRule' && !entry.tombstone) {
      if (!isMedicationActive(entry.payload.medId)) {
        throw new Error(`LAN reminder rule references a missing medication: ${entry.entityId}.`);
      }
      continue;
    }
    if (entry.entityType === 'schedule') {
      if (!isMedicationKnown(entry.payload.medId)) {
        throw new Error(`LAN schedule references a missing medication: ${entry.entityId}.`);
      }
      if (!isRuleKnown(entry.payload.sourceRuleId)) {
        throw new Error(`LAN schedule references a missing reminder rule: ${entry.entityId}.`);
      }
      const incomingRule = reminderEntries.get(entry.payload.sourceRuleId);
      const ruleMedId = incomingRule && !incomingRule.tombstone
        ? incomingRule.payload.medId
        : existingRules.get(entry.payload.sourceRuleId)?.medId;
      if (ruleMedId && ruleMedId !== entry.payload.medId) {
        throw new Error(`LAN schedule reminder medication mismatch: ${entry.entityId}.`);
      }
      continue;
    }
    if (entry.entityType !== 'intake' || entry.tombstone) continue;
    if (!isMedicationKnown(entry.payload.medId)) {
      throw new Error(`LAN intake references a missing medication: ${entry.entityId}.`);
    }

    if (entry.payload.scheduleRevisionId) {
      const incomingSchedule = scheduleEntries.get(entry.payload.scheduleRevisionId);
      const existingSchedule = existingSchedules.get(entry.payload.scheduleRevisionId);
      if (!incomingSchedule && !existingSchedule) {
        throw new Error(`LAN intake references a missing schedule: ${entry.entityId}.`);
      }
      const scheduleMedId = incomingSchedule?.payload.medId ?? existingSchedule?.medId;
      if (scheduleMedId !== entry.payload.medId) {
        throw new Error(`LAN intake schedule medication mismatch: ${entry.entityId}.`);
      }
    }
    if (entry.payload.sourceRuleId) {
      const incomingRule = reminderEntries.get(entry.payload.sourceRuleId);
      const existingRule = existingRules.get(entry.payload.sourceRuleId);
      if (!incomingRule && !existingRule) {
        throw new Error(`LAN intake references a missing reminder rule: ${entry.entityId}.`);
      }
      const ruleMedId = incomingRule && !incomingRule.tombstone
        ? incomingRule.payload.medId
        : existingRule?.medId;
      if (ruleMedId && ruleMedId !== entry.payload.medId) {
        throw new Error(`LAN intake reminder medication mismatch: ${entry.entityId}.`);
      }
    }
  }
}

async function applyMedication(
  transaction: LanTransaction,
  current: Medication | undefined,
  entry: Extract<LanSyncEntry, { entityType: 'medication' }>,
): Promise<void> {
  const store = transaction.objectStore('meds');
  const appliedAt = Math.max(Date.now(), current?.updatedAt ?? 0);
  if (entry.tombstone) {
    if (current) await store.put({ ...current, deleted: true, updatedAt: appliedAt });
    return;
  }
  const payload = structuredClone(entry.payload);
  const next: Medication = {
    ...payload,
    identity: {
      ...payload.identity,
      photoHashes: [...(current?.identity?.photoHashes ?? [])],
    },
    // Inventory and pre-deduction state remain device-local (not part of LAN medication payload).
    ...(current?.inventory ? { inventory: structuredClone(current.inventory) } : {}),
    ...(current?.preDeduction ? { preDeduction: structuredClone(current.preDeduction) } : {}),
    ...(current?.lastPreDeductedAt !== undefined ? { lastPreDeductedAt: current.lastPreDeductedAt } : {}),
    updatedAt: appliedAt,
  };
  await store.put(next);
}

async function applyReminderRule(
  transaction: LanTransaction,
  current: ReminderRule | undefined,
  entry: Extract<LanSyncEntry, { entityType: 'reminderRule' }>,
): Promise<void> {
  const store = transaction.objectStore('rules');
  if (entry.tombstone) {
    if (current) await store.put({ ...current, deleted: true });
    return;
  }
  await store.put(structuredClone(entry.payload) as ReminderRule);
}

async function applyIntake(
  transaction: LanTransaction,
  current: (IntakeLog & { deleted?: boolean }) | undefined,
  entry: Extract<LanSyncEntry, { entityType: 'intake' }>,
): Promise<void> {
  const store = transaction.objectStore('logs');
  const keepsLocalDeduction =
    !entry.tombstone &&
    entry.payload.status === 'taken' &&
    current?.status === 'taken' &&
    current.medId === entry.payload.medId;
  if (current?.status === 'taken' && current.inventoryDelta && !keepsLocalDeduction) {
    const medicationStore = transaction.objectStore('meds');
    const medication = await medicationStore.get(current.medId);
    if (medication && restoreInventory(medication, current.inventoryDelta)) {
      await medicationStore.put(medication);
    }
  }
  if (entry.tombstone) await store.delete(entry.entityId);
  else {
    const next = structuredClone(entry.payload) as IntakeLog;
    // Inventory is device-local. Preserve only a deduction this phone actually made.
    if (keepsLocalDeduction && current.inventoryDelta) {
      next.inventoryDelta = current.inventoryDelta;
    }
    await store.put(next);
  }
}

function matchesMedication(
  current: Medication | undefined,
  entry: Extract<LanSyncEntry, { entityType: 'medication' }>,
): boolean {
  if (entry.tombstone) return !current || current.deleted === true;
  if (!current || current.deleted) return false;
  return canonicalLanJson(selectLanMedicationPayload(current)) === canonicalLanJson(entry.payload);
}

function matchesReminderRule(
  current: ReminderRule | undefined,
  entry: Extract<LanSyncEntry, { entityType: 'reminderRule' }>,
): boolean {
  if (entry.tombstone) return !current || current.deleted === true;
  if (!current || current.deleted) return false;
  return canonicalLanJson(selectLanReminderRulePayload(current)) === canonicalLanJson(entry.payload);
}

function matchesIntake(
  current: (IntakeLog & { deleted?: boolean }) | undefined,
  entry: Extract<LanSyncEntry, { entityType: 'intake' }>,
): boolean {
  if (entry.tombstone) return !current || current.deleted === true;
  if (!current || current.deleted || current.status === 'pending') return false;
  return canonicalLanJson(selectLanIntakePayload(current)) === canonicalLanJson(entry.payload);
}

function conflict(
  kind: LanSyncConflict['kind'],
  local: LanSyncEntry,
  remote: LanSyncEntry,
): LanSyncConflict {
  return {
    kind,
    entityType: local.entityType,
    entityId: local.entityId,
    localVersion: { clock: local.clock, deviceId: local.deviceId },
    remoteVersion: { clock: remote.clock, deviceId: remote.deviceId },
  };
}

function entityKey(entityType: SyncLanEntityType, entityId: string): string {
  return `entity:${entityType}\u0000${entityId}`;
}

function entryKey(entry: LanSyncEntry): string {
  return entityKey(entry.entityType, entry.entityId);
}

function compareEntries(left: LanSyncEntry, right: LanSyncEntry): number {
  return compareText(entryKey(left), entryKey(right));
}

function compareVersions(
  left: Pick<LanSyncEntry, 'clock' | 'deviceId'>,
  right: Pick<LanSyncEntry, 'clock' | 'deviceId'>,
): number {
  if (left.clock !== right.clock) return left.clock < right.clock ? -1 : 1;
  return compareText(left.deviceId, right.deviceId);
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
