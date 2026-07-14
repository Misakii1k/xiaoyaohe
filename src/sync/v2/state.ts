import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  canonicalMutation,
  isValidDeviceId,
  isValidHouseholdId,
  type EncryptedEntityRecord,
  type SyncMutation,
} from './protocol';

const DATABASE_NAME = 'medbox-sync-v2';
const DATABASE_VERSION = 1;

export interface SyncV2Connection {
  endpoint: string;
  householdId: string;
  deviceId: string;
  cursor: number;
  updatedAt: number;
}

export type QueuedMutationStatus = 'pending' | 'conflict' | 'rejected';

export interface QueuedSyncV2Mutation {
  householdId: string;
  mutation: SyncMutation;
  status: QueuedMutationStatus;
  createdAt: number;
  conflictRevision?: number;
  rejectionCode?: 'mutation_id_reused' | 'entity_limit_reached';
}

export interface StagedSyncV2Change {
  householdId: string;
  record: EncryptedEntityRecord;
  stagedAt: number;
}

export interface SyncV2StateStore {
  getConnection(householdId: string): Promise<SyncV2Connection | null>;
  saveConnection(connection: SyncV2Connection): Promise<void>;
  getMutation(householdId: string, mutationId: string): Promise<QueuedSyncV2Mutation | null>;
  putMutation(item: QueuedSyncV2Mutation): Promise<void>;
  listMutations(householdId: string, statuses?: readonly QueuedMutationStatus[]): Promise<QueuedSyncV2Mutation[]>;
  updateMutation(item: QueuedSyncV2Mutation): Promise<void>;
  deleteMutation(householdId: string, mutationId: string): Promise<void>;
  listStagedChanges(householdId: string): Promise<StagedSyncV2Change[]>;
  commitPullPage(
    householdId: string,
    staged: readonly StagedSyncV2Change[],
    nextCursor: number,
  ): Promise<void>;
  deleteStagedChange(householdId: string, householdRevision: number): Promise<void>;
  clearHousehold(householdId: string): Promise<void>;
}

interface StoredConnection extends SyncV2Connection {
  key: string;
}

interface StoredMutation extends QueuedSyncV2Mutation {
  key: string;
}

interface StoredStagedChange extends StagedSyncV2Change {
  key: string;
}

interface SyncV2Database extends DBSchema {
  connections: { key: string; value: StoredConnection };
  mutations: { key: string; value: StoredMutation };
  stagedChanges: { key: string; value: StoredStagedChange };
}

export class IndexedDbSyncV2StateStore implements SyncV2StateStore {
  private databasePromise: Promise<IDBPDatabase<SyncV2Database>> | null = null;

  async getConnection(householdId: string): Promise<SyncV2Connection | null> {
    assertHouseholdId(householdId);
    const stored = await (await this.database()).get('connections', householdId);
    return stored ? withoutKey(stored) : null;
  }

  async saveConnection(connection: SyncV2Connection): Promise<void> {
    assertConnection(connection);
    await (await this.database()).put('connections', { ...connection, key: connection.householdId }, connection.householdId);
  }

  async getMutation(householdId: string, mutationId: string): Promise<QueuedSyncV2Mutation | null> {
    assertHouseholdId(householdId);
    const stored = await (await this.database()).get('mutations', mutationKey(householdId, mutationId));
    return stored ? withoutKey(stored) : null;
  }

  async putMutation(item: QueuedSyncV2Mutation): Promise<void> {
    assertQueuedMutation(item);
    const database = await this.database();
    const key = mutationKey(item.householdId, item.mutation.mutationId);
    const existing = await database.get('mutations', key);
    assertMutationIdempotency(existing, item);
    if (!existing) await database.put('mutations', { ...item, key }, key);
  }

  async listMutations(
    householdId: string,
    statuses?: readonly QueuedMutationStatus[],
  ): Promise<QueuedSyncV2Mutation[]> {
    assertHouseholdId(householdId);
    const allowed = statuses ? new Set(statuses) : null;
    return (await (await this.database()).getAll('mutations'))
      .filter((item) => item.householdId === householdId && (!allowed || allowed.has(item.status)))
      .sort((left, right) => left.createdAt - right.createdAt || left.mutation.mutationId.localeCompare(right.mutation.mutationId))
      .map(withoutKey);
  }

  async updateMutation(item: QueuedSyncV2Mutation): Promise<void> {
    assertQueuedMutation(item);
    const key = mutationKey(item.householdId, item.mutation.mutationId);
    const database = await this.database();
    const existing = await database.get('mutations', key);
    if (!existing) throw new Error(`Unknown queued mutation: ${item.mutation.mutationId}`);
    assertMutationIdempotency(existing, item);
    await database.put('mutations', { ...item, key }, key);
  }

  async deleteMutation(householdId: string, mutationId: string): Promise<void> {
    assertHouseholdId(householdId);
    await (await this.database()).delete('mutations', mutationKey(householdId, mutationId));
  }

  async listStagedChanges(householdId: string): Promise<StagedSyncV2Change[]> {
    assertHouseholdId(householdId);
    return (await (await this.database()).getAll('stagedChanges'))
      .filter((item) => item.householdId === householdId)
      .sort((left, right) => left.record.householdRevision - right.record.householdRevision)
      .map(withoutKey);
  }

  async commitPullPage(
    householdId: string,
    staged: readonly StagedSyncV2Change[],
    nextCursor: number,
  ): Promise<void> {
    assertHouseholdId(householdId);
    assertRevision(nextCursor, 'pull cursor');
    const database = await this.database();
    const transaction = database.transaction(['connections', 'stagedChanges'], 'readwrite');
    const connection = await transaction.objectStore('connections').get(householdId);
    if (!connection) throw new Error('Sync connection is not configured.');
    if (nextCursor < connection.cursor) throw new Error('Sync pull cursor cannot move backwards.');
    for (const item of staged) {
      if (item.householdId !== householdId) throw new Error('Cannot stage a change for another household.');
      const key = stagedKey(householdId, item.record.householdRevision);
      await transaction.objectStore('stagedChanges').put({ ...item, key }, key);
    }
    connection.cursor = nextCursor;
    connection.updatedAt = Date.now();
    await transaction.objectStore('connections').put(connection, householdId);
    await transaction.done;
  }

  async deleteStagedChange(householdId: string, householdRevision: number): Promise<void> {
    assertHouseholdId(householdId);
    assertRevision(householdRevision, 'household revision');
    await (await this.database()).delete('stagedChanges', stagedKey(householdId, householdRevision));
  }

  async clearHousehold(householdId: string): Promise<void> {
    assertHouseholdId(householdId);
    const database = await this.database();
    const transaction = database.transaction(['connections', 'mutations', 'stagedChanges'], 'readwrite');
    await transaction.objectStore('connections').delete(householdId);
    const mutations = await transaction.objectStore('mutations').getAll();
    const staged = await transaction.objectStore('stagedChanges').getAll();
    await Promise.all([
      ...mutations.filter((item) => item.householdId === householdId).map((item) => transaction.objectStore('mutations').delete(item.key)),
      ...staged.filter((item) => item.householdId === householdId).map((item) => transaction.objectStore('stagedChanges').delete(item.key)),
    ]);
    await transaction.done;
  }

  private database(): Promise<IDBPDatabase<SyncV2Database>> {
    this.databasePromise ??= openDB<SyncV2Database>(DATABASE_NAME, DATABASE_VERSION, {
      upgrade(database) {
        database.createObjectStore('connections');
        database.createObjectStore('mutations');
        database.createObjectStore('stagedChanges');
      },
    });
    return this.databasePromise;
  }
}

export class MemorySyncV2StateStore implements SyncV2StateStore {
  private readonly connections = new Map<string, SyncV2Connection>();
  private readonly mutations = new Map<string, QueuedSyncV2Mutation>();
  private readonly staged = new Map<string, StagedSyncV2Change>();

  async getConnection(householdId: string): Promise<SyncV2Connection | null> {
    assertHouseholdId(householdId);
    const value = this.connections.get(householdId);
    return value ? structuredClone(value) : null;
  }

  async saveConnection(connection: SyncV2Connection): Promise<void> {
    assertConnection(connection);
    this.connections.set(connection.householdId, structuredClone(connection));
  }

  async getMutation(householdId: string, mutationId: string): Promise<QueuedSyncV2Mutation | null> {
    assertHouseholdId(householdId);
    const value = this.mutations.get(mutationKey(householdId, mutationId));
    return value ? structuredClone(value) : null;
  }

  async putMutation(item: QueuedSyncV2Mutation): Promise<void> {
    assertQueuedMutation(item);
    const key = mutationKey(item.householdId, item.mutation.mutationId);
    const existing = this.mutations.get(key);
    assertMutationIdempotency(existing, item);
    if (!existing) this.mutations.set(key, structuredClone(item));
  }

  async listMutations(
    householdId: string,
    statuses?: readonly QueuedMutationStatus[],
  ): Promise<QueuedSyncV2Mutation[]> {
    assertHouseholdId(householdId);
    const allowed = statuses ? new Set(statuses) : null;
    return [...this.mutations.values()]
      .filter((item) => item.householdId === householdId && (!allowed || allowed.has(item.status)))
      .sort((left, right) => left.createdAt - right.createdAt || left.mutation.mutationId.localeCompare(right.mutation.mutationId))
      .map((item) => structuredClone(item));
  }

  async updateMutation(item: QueuedSyncV2Mutation): Promise<void> {
    assertQueuedMutation(item);
    const key = mutationKey(item.householdId, item.mutation.mutationId);
    const existing = this.mutations.get(key);
    if (!existing) throw new Error(`Unknown queued mutation: ${item.mutation.mutationId}`);
    assertMutationIdempotency(existing, item);
    this.mutations.set(key, structuredClone(item));
  }

  async deleteMutation(householdId: string, mutationId: string): Promise<void> {
    assertHouseholdId(householdId);
    this.mutations.delete(mutationKey(householdId, mutationId));
  }

  async listStagedChanges(householdId: string): Promise<StagedSyncV2Change[]> {
    assertHouseholdId(householdId);
    return [...this.staged.values()]
      .filter((item) => item.householdId === householdId)
      .sort((left, right) => left.record.householdRevision - right.record.householdRevision)
      .map((item) => structuredClone(item));
  }

  async commitPullPage(
    householdId: string,
    staged: readonly StagedSyncV2Change[],
    nextCursor: number,
  ): Promise<void> {
    assertHouseholdId(householdId);
    assertRevision(nextCursor, 'pull cursor');
    const connection = this.connections.get(householdId);
    if (!connection) throw new Error('Sync connection is not configured.');
    if (nextCursor < connection.cursor) throw new Error('Sync pull cursor cannot move backwards.');
    for (const item of staged) {
      if (item.householdId !== householdId) throw new Error('Cannot stage a change for another household.');
      this.staged.set(stagedKey(householdId, item.record.householdRevision), structuredClone(item));
    }
    this.connections.set(householdId, { ...connection, cursor: nextCursor, updatedAt: Date.now() });
  }

  async deleteStagedChange(householdId: string, householdRevision: number): Promise<void> {
    assertHouseholdId(householdId);
    assertRevision(householdRevision, 'household revision');
    this.staged.delete(stagedKey(householdId, householdRevision));
  }

  async clearHousehold(householdId: string): Promise<void> {
    assertHouseholdId(householdId);
    this.connections.delete(householdId);
    for (const [key, value] of this.mutations) if (value.householdId === householdId) this.mutations.delete(key);
    for (const [key, value] of this.staged) if (value.householdId === householdId) this.staged.delete(key);
  }
}

function assertConnection(connection: SyncV2Connection): void {
  assertHouseholdId(connection.householdId);
  if (!isValidDeviceId(connection.deviceId)) throw new Error('Invalid sync device ID.');
  if (typeof connection.endpoint !== 'string' || !connection.endpoint) throw new Error('Invalid sync endpoint.');
  assertRevision(connection.cursor, 'pull cursor');
  if (!Number.isFinite(connection.updatedAt) || connection.updatedAt < 0) throw new Error('Invalid connection timestamp.');
}

function assertQueuedMutation(item: QueuedSyncV2Mutation): void {
  assertHouseholdId(item.householdId);
  if (!['pending', 'conflict', 'rejected'].includes(item.status)) throw new Error('Invalid queued mutation status.');
  if (!Number.isFinite(item.createdAt) || item.createdAt < 0) throw new Error('Invalid queued mutation timestamp.');
}

function assertMutationIdempotency(
  existing: QueuedSyncV2Mutation | undefined,
  incoming: QueuedSyncV2Mutation,
): void {
  if (existing && canonicalMutation(existing.mutation) !== canonicalMutation(incoming.mutation)) {
    throw new Error(`Mutation ID ${incoming.mutation.mutationId} is already bound to different content.`);
  }
}

function assertHouseholdId(householdId: string): void {
  if (!isValidHouseholdId(householdId)) throw new Error('Invalid sync household ID.');
}

function assertRevision(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label}.`);
}

function mutationKey(householdId: string, mutationId: string): string {
  return `${householdId}:${mutationId}`;
}

function stagedKey(householdId: string, revision: number): string {
  return `${householdId}:${revision}`;
}

function withoutKey<T extends { key: string }>(value: T): Omit<T, 'key'> {
  const { key: _key, ...rest } = value;
  return rest;
}
