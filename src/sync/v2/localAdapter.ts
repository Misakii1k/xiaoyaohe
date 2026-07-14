import type { IDBPTransaction } from 'idb';
import {
  openMedboxDatabase,
  type MedboxDB,
  type SyncV2EntityMetadata,
} from '../../db/local';
import {
  emptyIdentity,
  inflateMed,
  type IntakeLog,
  type Medication,
  type MedicationInventory,
  type MedicationScheduleRevision,
} from '../../db/schema';
import { getMedicationExpiryLocalDate, isLocalDate } from '../../domain/medicationSchedule';
import { base64UrlEncode } from './crypto';
import {
  parseSyncEntityPayload,
  type SyncEntityPayload,
  type SyncIntakePayload,
  type SyncMedicationPayload,
  type SyncSchedulePayload,
} from './entities';
import {
  SyncV2Client,
  type PairingInvitation,
  type ProvisionedHousehold,
  type QueueMutationOptions,
  type RemoteChangeDisposition,
  type RemoteSyncV2Change,
  type SyncV2ClientOptions,
  type SyncV2RunResult,
} from './client';
import type { SyncV2CallOptions } from './api';
import {
  isValidHouseholdId,
  type SyncEntityType,
  type SyncMutationOperation,
} from './protocol';
import type { QueuedSyncV2Mutation, SyncV2Connection } from './state';

const SYNC_STORES = ['meds', 'scheduleRevisions', 'logs', 'syncV2Metadata'] as const;
type SyncStoreNames = typeof SYNC_STORES;
type SyncTransaction<Mode extends IDBTransactionMode> = IDBPTransaction<MedboxDB, SyncStoreNames, Mode>;

interface DescribedEntityState {
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncMutationOperation;
  payload?: SyncEntityPayload;
  canonicalJson: string;
}

interface PreparedEntityState extends DescribedEntityState {
  canonicalPayloadHash: string;
}

interface LocalEntitySnapshot {
  states: Map<string, PreparedEntityState>;
  metadata: Map<string, SyncV2EntityMetadata>;
}

export interface QueueLocalChangesResult {
  queued: QueuedSyncV2Mutation[];
  skippedUnchanged: number;
  skippedBlocked: number;
}

export interface ConsumeSyncV2RunResult {
  confirmed: number;
}

export type SyncV2QueueClient = Pick<
  SyncV2Client,
  'listQueuedMutations' | 'queueUpsert' | 'queueDelete' | 'discardMutation'
>;

/**
 * Bridges the encrypted sync-v2 client with the local medication database.
 * Work profiles, entries, settlements, photos, rules, and notification state
 * are deliberately outside every transaction and scan in this adapter.
 */
export class MedboxSyncV2Adapter {
  private householdId: string | null;

  constructor(householdId?: string) {
    this.householdId = householdId ?? null;
    if (householdId) assertHouseholdId(householdId);
  }

  activateHousehold(householdId: string): void {
    assertHouseholdId(householdId);
    this.householdId = householdId;
  }

  async clearHouseholdMetadata(householdId = this.requireHouseholdId()): Promise<void> {
    assertHouseholdId(householdId);
    const database = await openMedboxDatabase();
    const transaction = database.transaction('syncV2Metadata', 'readwrite');
    const records = await transaction.objectStore('syncV2Metadata').index('byHousehold').getAll(householdId);
    await Promise.all(records.map((record) => transaction.objectStore('syncV2Metadata').delete(record.key)));
    await transaction.done;
    if (this.householdId === householdId) this.householdId = null;
  }

  readonly applyRemoteChange = async (
    change: RemoteSyncV2Change,
  ): Promise<RemoteChangeDisposition> => {
    const householdId = this.requireHouseholdId();
    const incoming = await prepareRemoteChange(change);
    const database = await openMedboxDatabase();
    const localBeforeTransaction = await prepareLocalEntity(
      change.record.entityType,
      change.record.entityId,
      await readRawEntityFromDatabase(database, change.record.entityType, change.record.entityId),
    );
    const transaction = database.transaction(SYNC_STORES, 'readwrite');
    const currentRaw = await readRawEntity(transaction, change.record.entityType, change.record.entityId);
    const currentDescription = describeLocalEntity(change.record.entityType, change.record.entityId, currentRaw);

    // The pre-hash snapshot must still describe the value protected by this
    // readwrite transaction. A concurrent local write is deferred, never lost.
    if (!sameDescription(localBeforeTransaction, currentDescription)) {
      await transaction.done;
      return 'deferred';
    }

    const metadataStore = transaction.objectStore('syncV2Metadata');
    const key = metadataKey(householdId, change.record.entityType, change.record.entityId);
    const metadata = await metadataStore.get(key);
    if (metadata?.pendingMutationId) {
      await transaction.done;
      return 'deferred';
    }

    if (metadata) {
      const localMatchesServer =
        metadata.serverOperation === localBeforeTransaction.operation &&
        metadata.canonicalPayloadHash === localBeforeTransaction.canonicalPayloadHash;
      if (!localMatchesServer) {
        await transaction.done;
        return 'deferred';
      }
      if (change.record.entityRevision < metadata.serverRevision) {
        await transaction.done;
        return 'applied';
      }
      if (change.record.entityRevision === metadata.serverRevision) {
        const sameServerValue =
          metadata.serverOperation === incoming.operation &&
          metadata.canonicalPayloadHash === incoming.canonicalPayloadHash;
        await transaction.done;
        if (!sameServerValue) {
          throw new Error('A sync entity revision resolved to different canonical payloads.');
        }
        return 'applied';
      }
    } else if (localBeforeTransaction.operation === 'upsert') {
      await transaction.done;
      return 'deferred';
    }

    await writeRemoteEntity(transaction, change, incoming, currentRaw);
    await metadataStore.put({
      key,
      householdId,
      entityType: change.record.entityType,
      entityId: change.record.entityId,
      serverRevision: change.record.entityRevision,
      serverOperation: incoming.operation,
      canonicalPayloadHash: incoming.canonicalPayloadHash,
      updatedAt: Date.now(),
    });
    await transaction.done;
    return 'applied';
  };

  async queueLocalChanges(client: SyncV2QueueClient): Promise<QueueLocalChangesResult> {
    const householdId = this.requireHouseholdId();
    const [snapshot, existingMutations] = await Promise.all([
      snapshotLocalEntities(householdId),
      client.listQueuedMutations(),
    ]);
    const blockedEntities = new Set(
      existingMutations.map((item) => entityKey(item.mutation.entityType, item.mutation.entityId)),
    );
    const candidateKeys = new Set([...snapshot.states.keys(), ...snapshot.metadata.keys()]);
    const result: QueueLocalChangesResult = {
      queued: [],
      skippedUnchanged: 0,
      skippedBlocked: 0,
    };

    for (const key of [...candidateKeys].sort()) {
      if (blockedEntities.has(key)) {
        result.skippedBlocked += 1;
        continue;
      }
      const metadata = snapshot.metadata.get(key);
      const state = snapshot.states.get(key) ?? await prepareDeletedEntity(...splitEntityKey(key));
      const serverMatchesLocal =
        metadata?.serverOperation === state.operation &&
        metadata.canonicalPayloadHash === state.canonicalPayloadHash;
      if (serverMatchesLocal) {
        if (metadata?.pendingMutationId) await clearOrphanPendingMutation(metadata);
        result.skippedUnchanged += 1;
        continue;
      }
      // An entity that has never existed on the server needs no delete.
      if (!metadata && state.operation === 'delete') {
        result.skippedUnchanged += 1;
        continue;
      }

      const baseEntityRevision = metadata?.serverRevision ?? 0;
      const queued = await queuePreparedState(client, state, baseEntityRevision);
      const recorded = await recordQueuedMutation(householdId, state, queued, metadata);
      if (!recorded) {
        await client.discardMutation(queued.mutation.mutationId);
        result.skippedBlocked += 1;
        continue;
      }
      result.queued.push(queued);
      blockedEntities.add(key);
    }
    return result;
  }

  async consumeRunResult(result: SyncV2RunResult): Promise<ConsumeSyncV2RunResult> {
    const householdId = this.requireHouseholdId();
    if (result.accepted.length === 0) return { confirmed: 0 };

    const confirmedByMutation = new Map<string, PreparedEntityState>();
    for (const change of result.confirmedChanges) {
      confirmedByMutation.set(change.record.mutationId, await prepareRemoteChange(change));
    }

    const database = await openMedboxDatabase();
    const transaction = database.transaction('syncV2Metadata', 'readwrite');
    const store = transaction.objectStore('syncV2Metadata');
    const pendingIndex = store.index('byPendingMutation');
    let confirmed = 0;

    for (const accepted of result.accepted) {
      const fromChange = confirmedByMutation.get(accepted.mutationId);
      let metadata = fromChange
        ? await store.get(metadataKey(householdId, fromChange.entityType, fromChange.entityId))
        : await pendingIndex.get(pendingMutationKey(householdId, accepted.mutationId));
      if (!fromChange && !metadata) continue;

      if (fromChange) {
        const change = result.confirmedChanges.find(
          (candidate) => candidate.record.mutationId === accepted.mutationId,
        );
        if (!change || change.record.entityRevision !== accepted.entityRevision) {
          await transaction.done;
          throw new Error('Accepted mutation revision does not match its confirmed server change.');
        }
      }

      const entityType = fromChange?.entityType ?? metadata!.entityType;
      const entityId = fromChange?.entityId ?? metadata!.entityId;
      const operation = fromChange?.operation ?? metadata!.pendingOperation;
      const payloadHash = fromChange?.canonicalPayloadHash ?? metadata!.pendingPayloadHash;
      if (!operation || !payloadHash) continue;

      const key = metadataKey(householdId, entityType, entityId);
      metadata ??= await store.get(key);
      const currentRevision = metadata?.serverRevision ?? 0;
      if (accepted.entityRevision < currentRevision) {
        if (metadata?.pendingMutationId === accepted.mutationId) {
          await store.put(withoutPendingMutation(metadata));
        }
        confirmed += 1;
        continue;
      }
      if (
        accepted.entityRevision === currentRevision &&
        metadata?.serverOperation != null &&
        (metadata.serverOperation !== operation || metadata.canonicalPayloadHash !== payloadHash)
      ) {
        await transaction.done;
        throw new Error('Accepted mutation revision conflicts with existing local sync metadata.');
      }

      const pendingBelongsToAccepted = metadata?.pendingMutationId === accepted.mutationId;
      const next: SyncV2EntityMetadata = {
        ...(metadata ?? {
          key,
          householdId,
          entityType,
          entityId,
          serverRevision: 0,
          serverOperation: null,
          canonicalPayloadHash: null,
          updatedAt: Date.now(),
        }),
        serverRevision: accepted.entityRevision,
        serverOperation: operation,
        canonicalPayloadHash: payloadHash,
        updatedAt: Date.now(),
      };
      await store.put(pendingBelongsToAccepted ? withoutPendingMutation(next) : next);
      confirmed += 1;
    }

    await transaction.done;
    return { confirmed };
  }

  private requireHouseholdId(): string {
    if (!this.householdId) throw new Error('Activate a sync household before accessing local sync data.');
    return this.householdId;
  }
}

export type LocalSyncV2ClientOptions = Omit<SyncV2ClientOptions, 'applyRemoteChange'> & {
  householdId?: string;
};

export interface LocalSyncV2ClientBinding {
  client: SyncV2Client;
  adapter: MedboxSyncV2Adapter;
  createHousehold(deviceName: string, options?: SyncV2CallOptions): Promise<ProvisionedHousehold>;
  pairDevice(invitation: string, deviceName: string, options?: SyncV2CallOptions): Promise<ProvisionedHousehold>;
  useHousehold(householdId: string): Promise<SyncV2Connection>;
  createPairingInvitation(options?: SyncV2CallOptions): Promise<PairingInvitation>;
  queueLocalChanges(): Promise<QueueLocalChangesResult>;
  sync(options?: SyncV2CallOptions): Promise<SyncV2RunResult>;
  forgetHousehold(): Promise<void>;
}

/** Creates a client whose pull handler and local push/confirmation lifecycle are wired. */
export function createLocalSyncV2Client(options: LocalSyncV2ClientOptions): LocalSyncV2ClientBinding {
  const { householdId, ...clientOptions } = options;
  const adapter = new MedboxSyncV2Adapter(householdId);
  let activeHouseholdId = householdId ?? null;
  const client = new SyncV2Client({
    ...clientOptions,
    applyRemoteChange: adapter.applyRemoteChange,
  });

  return {
    client,
    adapter,
    async createHousehold(deviceName, callOptions = {}) {
      const provisioned = await client.createHousehold(deviceName, callOptions);
      adapter.activateHousehold(provisioned.householdId);
      activeHouseholdId = provisioned.householdId;
      return provisioned;
    },
    async pairDevice(invitation, deviceName, callOptions = {}) {
      const provisioned = await client.pairDevice(invitation, deviceName, callOptions);
      adapter.activateHousehold(provisioned.householdId);
      activeHouseholdId = provisioned.householdId;
      return provisioned;
    },
    async useHousehold(id) {
      const connection = await client.useHousehold(id);
      adapter.activateHousehold(id);
      activeHouseholdId = id;
      return connection;
    },
    createPairingInvitation(callOptions = {}) {
      return client.createPairingInvitation(callOptions);
    },
    queueLocalChanges() {
      return adapter.queueLocalChanges(client);
    },
    async sync(callOptions = {}) {
      await adapter.queueLocalChanges(client);
      const run = await client.sync(callOptions);
      await adapter.consumeRunResult(run);
      return run;
    },
    async forgetHousehold() {
      if (!activeHouseholdId) throw new Error('No sync household is selected.');
      const householdToForget = activeHouseholdId;
      await client.forgetHousehold(householdToForget);
      await adapter.clearHouseholdMetadata(householdToForget);
      activeHouseholdId = null;
    },
  };
}

async function snapshotLocalEntities(householdId: string): Promise<LocalEntitySnapshot> {
  const database = await openMedboxDatabase();
  const transaction = database.transaction(SYNC_STORES, 'readonly');
  const [medications, schedules, intakes, metadata] = await Promise.all([
    transaction.objectStore('meds').getAll(),
    transaction.objectStore('scheduleRevisions').getAll(),
    transaction.objectStore('logs').getAll(),
    transaction.objectStore('syncV2Metadata').index('byHousehold').getAll(householdId),
  ]);
  await transaction.done;

  const descriptions: DescribedEntityState[] = [
    ...medications.map((value) => describeLocalEntity('medication', value.id, value)),
    ...schedules.map((value) => describeLocalEntity('schedule', value.id, value)),
    ...intakes.map((value) => describeLocalEntity('intake', value.id, value)),
  ];
  const prepared = await Promise.all(descriptions.map(prepareEntityState));
  return {
    states: new Map(prepared.map((state) => [entityKey(state.entityType, state.entityId), state])),
    metadata: new Map(metadata.map((item) => [entityKey(item.entityType, item.entityId), item])),
  };
}

async function queuePreparedState(
  client: SyncV2QueueClient,
  state: PreparedEntityState,
  baseEntityRevision: number,
  options: QueueMutationOptions = {},
): Promise<QueuedSyncV2Mutation> {
  if (state.operation === 'delete') {
    return client.queueDelete(state.entityType, state.entityId, baseEntityRevision, options);
  }
  if (state.entityType === 'medication') {
    return client.queueUpsert('medication', state.payload as SyncMedicationPayload, baseEntityRevision, options);
  }
  if (state.entityType === 'schedule') {
    return client.queueUpsert('schedule', state.payload as SyncSchedulePayload, baseEntityRevision, options);
  }
  return client.queueUpsert('intake', state.payload as SyncIntakePayload, baseEntityRevision, options);
}

async function recordQueuedMutation(
  householdId: string,
  state: PreparedEntityState,
  queued: QueuedSyncV2Mutation,
  expectedMetadata: SyncV2EntityMetadata | undefined,
): Promise<boolean> {
  const database = await openMedboxDatabase();
  const transaction = database.transaction(SYNC_STORES, 'readwrite');
  const currentRaw = await readRawEntity(transaction, state.entityType, state.entityId);
  const current = describeLocalEntity(state.entityType, state.entityId, currentRaw);
  const store = transaction.objectStore('syncV2Metadata');
  const key = metadataKey(householdId, state.entityType, state.entityId);
  const metadata = await store.get(key);
  if (!sameDescription(state, current) || !sameMetadataVersion(metadata, expectedMetadata)) {
    await transaction.done;
    return false;
  }

  const base: SyncV2EntityMetadata = metadata ?? {
    key,
    householdId,
    entityType: state.entityType,
    entityId: state.entityId,
    serverRevision: 0,
    serverOperation: null,
    canonicalPayloadHash: null,
    updatedAt: Date.now(),
  };
  await store.put({
    ...base,
    pendingMutationId: queued.mutation.mutationId,
    pendingMutationKey: pendingMutationKey(householdId, queued.mutation.mutationId),
    pendingOperation: state.operation,
    pendingPayloadHash: state.canonicalPayloadHash,
    updatedAt: Date.now(),
  });
  await transaction.done;
  return true;
}

async function clearOrphanPendingMutation(metadata: SyncV2EntityMetadata): Promise<void> {
  const database = await openMedboxDatabase();
  const transaction = database.transaction('syncV2Metadata', 'readwrite');
  const current = await transaction.store.get(metadata.key);
  if (current && current.pendingMutationId === metadata.pendingMutationId) {
    await transaction.store.put(withoutPendingMutation(current));
  }
  await transaction.done;
}

function withoutPendingMutation(metadata: SyncV2EntityMetadata): SyncV2EntityMetadata {
  const {
    pendingMutationId: _pendingMutationId,
    pendingMutationKey: _pendingMutationKey,
    pendingOperation: _pendingOperation,
    pendingPayloadHash: _pendingPayloadHash,
    ...confirmed
  } = metadata;
  return confirmed;
}

function sameMetadataVersion(
  current: SyncV2EntityMetadata | undefined,
  expected: SyncV2EntityMetadata | undefined,
): boolean {
  if (!current || !expected) return current === expected;
  return current.serverRevision === expected.serverRevision &&
    current.serverOperation === expected.serverOperation &&
    current.canonicalPayloadHash === expected.canonicalPayloadHash &&
    current.pendingMutationId === expected.pendingMutationId;
}

async function prepareRemoteChange(change: RemoteSyncV2Change): Promise<PreparedEntityState> {
  let payload: SyncEntityPayload | undefined;
  if (change.record.operation === 'upsert') {
    if (change.record.entityType === 'medication') {
      payload = selectMedication(change.payload as Medication);
    } else if (change.record.entityType === 'schedule') {
      payload = selectSchedule(change.payload as MedicationScheduleRevision);
    } else {
      payload = selectIntake(change.payload as IntakeLog);
    }
  }
  return prepareEntityState({
    entityType: change.record.entityType,
    entityId: change.record.entityId,
    operation: change.record.operation,
    ...(payload ? { payload } : {}),
    canonicalJson: canonicalJson(payload ?? null),
  });
}

async function prepareLocalEntity(
  entityType: SyncEntityType,
  entityId: string,
  raw: Medication | MedicationScheduleRevision | IntakeLog | undefined,
): Promise<PreparedEntityState> {
  return prepareEntityState(describeLocalEntity(entityType, entityId, raw));
}

async function prepareDeletedEntity(
  entityType: SyncEntityType,
  entityId: string,
): Promise<PreparedEntityState> {
  return prepareEntityState({
    entityType,
    entityId,
    operation: 'delete',
    canonicalJson: canonicalJson(null),
  });
}

async function prepareEntityState(state: DescribedEntityState): Promise<PreparedEntityState> {
  const bytes = new TextEncoder().encode(state.canonicalJson);
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
  return {
    ...state,
    canonicalPayloadHash: `sha256:${base64UrlEncode(new Uint8Array(digest))}`,
  };
}

function describeLocalEntity(
  entityType: SyncEntityType,
  entityId: string,
  raw: Medication | MedicationScheduleRevision | IntakeLog | undefined,
): DescribedEntityState {
  let payload: SyncEntityPayload | undefined;
  if (entityType === 'medication') {
    const medication = raw as Medication | undefined;
    if (medication && !medication.deleted) payload = selectMedication(medication);
  } else if (entityType === 'schedule') {
    const schedule = raw as MedicationScheduleRevision | undefined;
    if (schedule) payload = selectSchedule(schedule);
  } else {
    const intake = raw as (IntakeLog & { deleted?: boolean }) | undefined;
    if (intake && !intake.deleted && (intake.status === 'taken' || intake.status === 'skipped')) {
      payload = selectIntake(intake);
    }
  }
  return {
    entityType,
    entityId,
    operation: payload ? 'upsert' : 'delete',
    ...(payload ? { payload } : {}),
    canonicalJson: canonicalJson(payload ?? null),
  };
}

function selectMedication(raw: Medication): SyncMedicationPayload {
  const medication = inflateMed(structuredClone(raw)) as Medication;
  const hasStructuredDose =
    Number.isFinite(medication.doseQuantity) &&
    Number(medication.doseQuantity) > 0 &&
    typeof medication.doseUnit === 'string' &&
    medication.doseUnit.trim().length > 0;
  const expiryLocalDate = isLocalDate(medication.expiryLocalDate)
    ? medication.expiryLocalDate
    : getMedicationExpiryLocalDate(medication);
  return parseSyncEntityPayload('medication', {
    id: medication.id,
    name: medication.name,
    dosageText: medication.dosageText,
    amountPerDose: medication.amountPerDose,
    ...(hasStructuredDose ? {
      doseQuantity: Number(medication.doseQuantity),
      doseUnit: medication.doseUnit!.trim(),
      ...(medication.doseSourceText !== undefined ? { doseSourceText: medication.doseSourceText } : {}),
    } : {}),
    ...(!hasStructuredDose && medication.doseMigrationSuggestion
      ? { doseMigrationSuggestion: medication.doseMigrationSuggestion }
      : {}),
    ...(!hasStructuredDose && medication.doseReviewRequired !== undefined
      ? { doseReviewRequired: medication.doseReviewRequired }
      : {}),
    slots: medication.slots,
    mealRels: medication.mealRels,
    mealRelsBySlot: medication.mealRelsBySlot,
    daysOfWeek: [...new Set(medication.daysOfWeek)].sort((left, right) => left - right),
    ...(medication.inventory ? { inventory: selectInventory(medication.inventory) } : {}),
    ...(medication.notes !== undefined ? { notes: medication.notes } : {}),
    ...(expiryLocalDate ? { expiryLocalDate } : {}),
    identity: medication.identity ?? emptyIdentity(),
    updatedAt: medication.updatedAt,
    ...(medication.createdAt !== undefined ? { createdAt: medication.createdAt } : {}),
  });
}

function selectInventory(value: MedicationInventory): MedicationInventory {
  return {
    remaining: value.remaining,
    unit: value.unit,
    ...(value.packageQuantity !== undefined ? { packageQuantity: value.packageQuantity } : {}),
    ...(value.lowThreshold !== undefined ? { lowThreshold: value.lowThreshold } : {}),
    ...(value.sourceNote !== undefined ? { sourceNote: value.sourceNote } : {}),
    ...(value.lastReminderAt !== undefined ? { lastReminderAt: value.lastReminderAt } : {}),
    ...(value.dailyConsumption !== undefined ? { dailyConsumption: value.dailyConsumption } : {}),
  };
}

function selectSchedule(value: MedicationScheduleRevision): SyncSchedulePayload {
  return parseSyncEntityPayload('schedule', {
    id: value.id,
    medId: value.medId,
    sourceRuleId: value.sourceRuleId,
    effectiveDate: value.effectiveDate,
    createdAt: value.createdAt,
    enabled: value.enabled,
    slot: value.slot,
    timeLocal: value.timeLocal,
    daysOfWeek: [...value.daysOfWeek],
    ...(value.cycle ? { cycle: { ...value.cycle } } : {}),
    ...(value.cycleStartDate ? { cycleStartDate: value.cycleStartDate } : {}),
    mealRels: [...value.mealRels],
    ...(value.doseQuantity !== undefined ? { doseQuantity: value.doseQuantity } : {}),
    ...(value.doseUnit !== undefined ? { doseUnit: value.doseUnit } : {}),
    reviewFlags: [...value.reviewFlags],
  });
}

function selectIntake(value: IntakeLog): SyncIntakePayload {
  return parseSyncEntityPayload('intake', {
    id: value.id,
    ...(value.occurrenceId ? { occurrenceId: value.occurrenceId } : {}),
    ...(value.scheduleRevisionId ? { scheduleRevisionId: value.scheduleRevisionId } : {}),
    ...(value.sourceRuleId ? { sourceRuleId: value.sourceRuleId } : {}),
    medId: value.medId,
    slot: value.slot,
    dueAt: value.dueAt,
    status: value.status,
    ...(value.ackAt !== undefined ? { ackAt: value.ackAt } : {}),
    ...(value.inventoryDelta !== undefined ? { inventoryDelta: value.inventoryDelta } : {}),
    updatedAt: value.updatedAt,
  });
}

async function readRawEntityFromDatabase(
  database: Awaited<ReturnType<typeof openMedboxDatabase>>,
  entityType: SyncEntityType,
  entityId: string,
): Promise<Medication | MedicationScheduleRevision | IntakeLog | undefined> {
  if (entityType === 'medication') return database.get('meds', entityId);
  if (entityType === 'schedule') return database.get('scheduleRevisions', entityId);
  return database.get('logs', entityId);
}

async function readRawEntity<Mode extends IDBTransactionMode>(
  transaction: SyncTransaction<Mode>,
  entityType: SyncEntityType,
  entityId: string,
): Promise<Medication | MedicationScheduleRevision | IntakeLog | undefined> {
  if (entityType === 'medication') return transaction.objectStore('meds').get(entityId);
  if (entityType === 'schedule') return transaction.objectStore('scheduleRevisions').get(entityId);
  return transaction.objectStore('logs').get(entityId);
}

async function writeRemoteEntity(
  transaction: SyncTransaction<'readwrite'>,
  change: RemoteSyncV2Change,
  incoming: PreparedEntityState,
  currentRaw: Medication | MedicationScheduleRevision | IntakeLog | undefined,
): Promise<void> {
  if (change.record.entityType === 'medication') {
    const store = transaction.objectStore('meds');
    if (change.record.operation === 'upsert') {
      await store.put(structuredClone(incoming.payload as SyncMedicationPayload) as Medication);
    } else if (currentRaw) {
      await store.put({
        ...(currentRaw as Medication),
        deleted: true,
        updatedAt: Math.max((currentRaw as Medication).updatedAt, Date.now()),
      });
    }
    return;
  }
  if (change.record.entityType === 'schedule') {
    const store = transaction.objectStore('scheduleRevisions');
    if (change.record.operation === 'upsert') {
      await store.put(structuredClone(incoming.payload as SyncSchedulePayload));
    } else {
      await store.delete(change.record.entityId);
    }
    return;
  }
  const store = transaction.objectStore('logs');
  if (change.record.operation === 'upsert') {
    await store.put(structuredClone(incoming.payload as SyncIntakePayload));
  } else {
    await store.delete(change.record.entityId);
  }
}

function sameDescription(left: DescribedEntityState, right: DescribedEntityState): boolean {
  return left.entityType === right.entityType &&
    left.entityId === right.entityId &&
    left.operation === right.operation &&
    left.canonicalJson === right.canonicalJson;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) sorted[key] = sortJson(value[key]);
  }
  return sorted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function metadataKey(householdId: string, entityType: SyncEntityType, entityId: string): string {
  return `${householdId}\u0000${entityType}\u0000${entityId}`;
}

function pendingMutationKey(householdId: string, mutationId: string): string {
  return `${householdId}\u0000${mutationId}`;
}

function entityKey(entityType: SyncEntityType, entityId: string): string {
  return `${entityType}\u0000${entityId}`;
}

function splitEntityKey(key: string): [SyncEntityType, string] {
  const separator = key.indexOf('\u0000');
  if (separator < 0) throw new Error('Invalid local sync entity key.');
  return [key.slice(0, separator) as SyncEntityType, key.slice(separator + 1)];
}

function assertHouseholdId(householdId: string): void {
  if (!isValidHouseholdId(householdId)) throw new Error('Invalid sync household ID.');
}
