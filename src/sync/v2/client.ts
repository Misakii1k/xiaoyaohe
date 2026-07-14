import {
  createPairingCode as encodePairingCode,
  decryptEntity,
  encodeRecoveryCode,
  encryptEntity,
  exportDataKey,
  generateRecoveryCode,
  importDataKey,
  importRecoveryCode,
  parsePairingCode,
  base64UrlDecode,
  base64UrlEncode,
} from './crypto';
import { SyncV2Api, SyncV2NetworkError, type DeviceListResponse, type SyncV2CallOptions } from './api';
import {
  createPlatformSyncV2CredentialStore,
  type StoredSyncV2Credentials,
  type SyncV2CredentialStore,
} from './credentials';
import {
  isSyncEntityId,
  parseSyncEntityPayload,
  type SyncEntityPayloadMap,
} from './entities';
import {
  SYNC_V2_LIMITS,
  SYNC_V2_SCHEMA_VERSION,
  isValidHouseholdId,
  validateSyncMutation,
  type EncryptedEntityRecord,
  type MutationResult,
  type SyncEntityType,
  type SyncMutation,
} from './protocol';
import {
  IndexedDbSyncV2StateStore,
  type QueuedSyncV2Mutation,
  type StagedSyncV2Change,
  type SyncV2Connection,
  type SyncV2StateStore,
} from './state';

export type RemoteSyncV2Change =
  | {
      record: EncryptedEntityRecord & { operation: 'upsert' };
      payload: SyncEntityPayloadMap[SyncEntityType];
    }
  | {
      record: EncryptedEntityRecord & { operation: 'delete' };
      payload?: undefined;
    };

export type RemoteChangeDisposition = 'applied' | 'deferred';
export type RemoteChangeHandler = (
  change: RemoteSyncV2Change,
) => RemoteChangeDisposition | void | Promise<RemoteChangeDisposition | void>;

export interface SyncV2ClientOptions {
  api: SyncV2Api;
  credentialStore?: SyncV2CredentialStore;
  stateStore?: SyncV2StateStore;
  applyRemoteChange?: RemoteChangeHandler;
  now?: () => number;
}

export interface ProvisionedHousehold {
  endpoint: string;
  householdId: string;
  householdRevision: number;
  deviceId: string;
  recoveryCode: string;
}

export interface PairingInvitation {
  pairingUri: string;
  expiresAt: number;
}

export interface SyncV2RunResult {
  status: 'complete' | 'offline';
  cursor: number;
  householdRevision: number;
  appliedChanges: RemoteSyncV2Change[];
  deferredChanges: RemoteSyncV2Change[];
  confirmedChanges: RemoteSyncV2Change[];
  confirmedMutationIds: string[];
  accepted: Extract<MutationResult, { status: 'accepted' }>[];
  conflicts: Extract<MutationResult, { status: 'conflict' }>[];
  rejected: Extract<MutationResult, { status: 'rejected' }>[];
  pendingCount: number;
  networkError?: SyncV2NetworkError;
}

export interface QueueMutationOptions {
  mutationId?: string;
  createdAt?: number;
}

export class SyncV2Client {
  private readonly api: SyncV2Api;
  private readonly credentialStore: SyncV2CredentialStore;
  private readonly stateStore: SyncV2StateStore;
  private readonly applyRemoteChange?: RemoteChangeHandler;
  private readonly now: () => number;
  private activeHouseholdId: string | null = null;

  constructor(options: SyncV2ClientOptions) {
    this.api = options.api;
    this.credentialStore = options.credentialStore ?? createPlatformSyncV2CredentialStore();
    this.stateStore = options.stateStore ?? new IndexedDbSyncV2StateStore();
    this.applyRemoteChange = options.applyRemoteChange;
    this.now = options.now ?? Date.now;
  }

  async createHousehold(deviceName: string, options: SyncV2CallOptions = {}): Promise<ProvisionedHousehold> {
    const generated = await generateRecoveryCode();
    const response = await this.api.createHousehold(deviceName, options);
    const dataKey = base64UrlEncode(await exportDataKey(generated.key));
    await this.persistProvisioning(
      {
        endpoint: this.api.endpoint,
        householdId: response.householdId,
        deviceId: response.device.id,
        cursor: 0,
        updatedAt: this.now(),
      },
      { deviceToken: response.device.token, dataKey },
    );
    this.activeHouseholdId = response.householdId;
    return {
      endpoint: this.api.endpoint,
      householdId: response.householdId,
      householdRevision: response.householdRevision,
      deviceId: response.device.id,
      recoveryCode: generated.recoveryCode,
    };
  }

  async useHousehold(householdId: string): Promise<SyncV2Connection> {
    const connection = await this.stateStore.getConnection(householdId);
    if (!connection) throw new Error('Sync household is not configured on this device.');
    if (connection.endpoint !== this.api.endpoint) throw new Error('Configured household uses a different sync endpoint.');
    this.activeHouseholdId = householdId;
    return connection;
  }

  async pairDevice(
    invitation: string,
    deviceName: string,
    options: SyncV2CallOptions = {},
  ): Promise<ProvisionedHousehold> {
    const parsed = await parsePairingCode(invitation);
    if (parsed.endpoint !== this.api.endpoint) throw new Error('Pairing invitation uses a different sync endpoint.');
    const dataKeyObject = await importRecoveryCode(parsed.recoveryCode);
    const response = await this.api.pairDevice(parsed.householdId, parsed.pairingCode, deviceName, options);
    if (response.householdId !== parsed.householdId) throw new Error('Pairing response household does not match the invitation.');
    const dataKey = base64UrlEncode(await exportDataKey(dataKeyObject));
    await this.persistProvisioning(
      {
        endpoint: this.api.endpoint,
        householdId: response.householdId,
        deviceId: response.device.id,
        // A newly paired device must pull the household history from revision zero.
        cursor: 0,
        updatedAt: this.now(),
      },
      { deviceToken: response.device.token, dataKey },
    );
    this.activeHouseholdId = response.householdId;
    return {
      endpoint: this.api.endpoint,
      householdId: response.householdId,
      householdRevision: response.householdRevision,
      deviceId: response.device.id,
      recoveryCode: parsed.recoveryCode,
    };
  }

  async createPairingInvitation(options: SyncV2CallOptions = {}): Promise<PairingInvitation> {
    const { connection, credentials } = await this.requireSession();
    const issued = await this.api.createPairingCode(connection.householdId, credentials.deviceToken, options);
    const recoveryCode = encodeRecoveryCode(await exportDataKey(await importStoredDataKey(credentials)));
    return {
      pairingUri: await encodePairingCode({
        endpoint: connection.endpoint,
        householdId: connection.householdId,
        pairingCode: issued.pairingCode,
        recoveryCode,
      }),
      expiresAt: issued.expiresAt,
    };
  }

  async listDevices(options: SyncV2CallOptions = {}): Promise<DeviceListResponse> {
    const { connection, credentials } = await this.requireSession();
    return this.api.listDevices(connection.householdId, credentials.deviceToken, options);
  }

  async revokeDevice(targetDeviceId: string, options: SyncV2CallOptions = {}): Promise<void> {
    const { connection, credentials } = await this.requireSession();
    await this.api.revokeDevice(connection.householdId, credentials.deviceToken, targetDeviceId, options);
    if (targetDeviceId === connection.deviceId) await this.credentialStore.clear(connection.householdId);
  }

  async rotateCurrentDeviceToken(options: SyncV2CallOptions = {}): Promise<void> {
    const { connection, credentials } = await this.requireSession();
    const device = await this.api.rotateDeviceToken(
      connection.householdId,
      credentials.deviceToken,
      connection.deviceId,
      options,
    );
    await this.credentialStore.save(connection.householdId, {
      ...credentials,
      deviceToken: device.token,
    });
  }

  async queueUpsert<T extends SyncEntityType>(
    entityType: T,
    payload: SyncEntityPayloadMap[T],
    baseEntityRevision: number,
    options: QueueMutationOptions = {},
  ): Promise<QueuedSyncV2Mutation> {
    const { connection, credentials } = await this.requireSession();
    assertRevision(baseEntityRevision);
    const parsed = parseSyncEntityPayload(entityType, payload);
    if (!isRecordWithId(parsed) || !isSyncEntityId(parsed.id)) throw new Error('Synchronized entity must have a valid ID.');
    const mutationId = options.mutationId ?? createMutationId();
    const mutation: SyncMutation = {
      mutationId,
      entityType,
      entityId: parsed.id,
      operation: 'upsert',
      schemaVersion: SYNC_V2_SCHEMA_VERSION,
      baseEntityRevision,
      encrypted: await encryptEntity(
        await importStoredDataKey(credentials),
        {
          householdId: connection.householdId,
          entityType,
          entityId: parsed.id,
          schemaVersion: SYNC_V2_SCHEMA_VERSION,
          mutationId,
          operation: 'upsert',
        },
        parsed,
      ),
    };
    return this.enqueueMutation(connection.householdId, mutation, options.createdAt);
  }

  async queueDelete(
    entityType: SyncEntityType,
    entityId: string,
    baseEntityRevision: number,
    options: QueueMutationOptions = {},
  ): Promise<QueuedSyncV2Mutation> {
    const { connection } = await this.requireSession();
    if (!isSyncEntityId(entityId)) throw new Error('Invalid synchronized entity ID.');
    assertRevision(baseEntityRevision);
    const mutation: SyncMutation = {
      mutationId: options.mutationId ?? createMutationId(),
      entityType,
      entityId,
      operation: 'delete',
      schemaVersion: SYNC_V2_SCHEMA_VERSION,
      baseEntityRevision,
    };
    return this.enqueueMutation(connection.householdId, mutation, options.createdAt);
  }

  async discardMutation(mutationId: string): Promise<void> {
    const { connection } = await this.requireSession(false);
    await this.stateStore.deleteMutation(connection.householdId, mutationId);
  }

  async listQueuedMutations(): Promise<QueuedSyncV2Mutation[]> {
    const { connection } = await this.requireSession(false);
    return this.stateStore.listMutations(connection.householdId);
  }

  async listStagedChanges(): Promise<RemoteSyncV2Change[]> {
    const { connection, credentials } = await this.requireSession();
    const key = await importStoredDataKey(credentials);
    const staged = await this.stateStore.listStagedChanges(connection.householdId);
    return Promise.all(staged.map((item) => decryptChange(key, connection.householdId, item.record)));
  }

  async applyStagedChanges(handler: RemoteChangeHandler = this.requireRemoteHandler()): Promise<RemoteSyncV2Change[]> {
    const { connection, credentials } = await this.requireSession();
    const blocked = entityKeys(await this.stateStore.listMutations(connection.householdId));
    const key = await importStoredDataKey(credentials);
    const applied: RemoteSyncV2Change[] = [];
    for (const item of await this.stateStore.listStagedChanges(connection.householdId)) {
      if (blocked.has(entityKey(item.record))) continue;
      const change = await decryptChange(key, connection.householdId, item.record);
      const disposition = await handler(change);
      if (disposition === 'deferred') continue;
      await this.stateStore.deleteStagedChange(connection.householdId, item.record.householdRevision);
      applied.push(change);
    }
    return applied;
  }

  async sync(options: SyncV2CallOptions = {}): Promise<SyncV2RunResult> {
    const { connection, credentials } = await this.requireSession();
    const dataKey = await importStoredDataKey(credentials);
    const outgoing = (await this.stateStore.listMutations(connection.householdId, ['pending']))
      .slice(0, SYNC_V2_LIMITS.mutationsPerRequest);
    const result: SyncV2RunResult = {
      status: 'complete',
      cursor: connection.cursor,
      householdRevision: connection.cursor,
      appliedChanges: [],
      deferredChanges: [],
      confirmedChanges: [],
      confirmedMutationIds: [],
      accepted: [],
      conflicts: [],
      rejected: [],
      pendingCount: 0,
    };

    let cursor = connection.cursor;
    let mutations = outgoing.map((item) => item.mutation);
    const acceptedMutationIds = new Set<string>();
    try {
      for (;;) {
        const response = await this.api.sync(
          connection.householdId,
          credentials.deviceToken,
          { sinceHouseholdRevision: cursor, mutations },
          options,
        );
        for (const mutationId of await this.processMutationResults(connection.householdId, outgoing, response.results, result)) {
          acceptedMutationIds.add(mutationId);
        }
        const unresolved = entityKeys(await this.stateStore.listMutations(connection.householdId));
        const staged: StagedSyncV2Change[] = [];

        for (const record of response.changes) {
          const change = await decryptChange(dataKey, connection.householdId, record);
          if (acceptedMutationIds.has(record.mutationId)) {
            result.confirmedMutationIds.push(record.mutationId);
            result.confirmedChanges.push(change);
            continue;
          }
          if (unresolved.has(entityKey(record)) || !this.applyRemoteChange) {
            staged.push({ householdId: connection.householdId, record, stagedAt: this.now() });
            result.deferredChanges.push(change);
            continue;
          }
          const disposition = await this.applyRemoteChange(change);
          if (disposition === 'deferred') {
            staged.push({ householdId: connection.householdId, record, stagedAt: this.now() });
            result.deferredChanges.push(change);
          } else {
            result.appliedChanges.push(change);
          }
        }

        await this.stateStore.commitPullPage(connection.householdId, staged, response.nextHouseholdRevision);
        cursor = response.nextHouseholdRevision;
        result.cursor = cursor;
        result.householdRevision = response.householdRevision;
        if (!response.hasMore) break;
        mutations = [];
      }
    } catch (error) {
      if (!(error instanceof SyncV2NetworkError) || options.signal?.aborted) throw error;
      result.status = 'offline';
      result.networkError = error;
    }

    result.pendingCount = (await this.stateStore.listMutations(connection.householdId, ['pending'])).length;
    return result;
  }

  async forgetHousehold(householdId = this.activeHouseholdId ?? undefined): Promise<void> {
    if (!householdId) throw new Error('No sync household is selected.');
    if (!isValidHouseholdId(householdId)) throw new Error('Invalid sync household ID.');
    await this.credentialStore.clear(householdId);
    await this.stateStore.clearHousehold(householdId);
    if (this.activeHouseholdId === householdId) this.activeHouseholdId = null;
  }

  private async enqueueMutation(
    householdId: string,
    mutation: SyncMutation,
    createdAt = this.now(),
  ): Promise<QueuedSyncV2Mutation> {
    const validated = validateSyncMutation(mutation);
    if (!validated.ok) throw new Error(validated.issues[0]?.message ?? 'Invalid sync mutation.');
    const item: QueuedSyncV2Mutation = {
      householdId,
      mutation: validated.value,
      status: 'pending',
      createdAt,
    };
    await this.stateStore.putMutation(item);
    return (await this.stateStore.getMutation(householdId, mutation.mutationId)) ?? item;
  }

  private async processMutationResults(
    householdId: string,
    outgoing: readonly QueuedSyncV2Mutation[],
    results: readonly MutationResult[],
    aggregate: SyncV2RunResult,
  ): Promise<Set<string>> {
    const byId = new Map(outgoing.map((item) => [item.mutation.mutationId, item]));
    const accepted = new Set<string>();
    for (const result of results) {
      const queued = byId.get(result.mutationId);
      if (!queued) continue;
      if (result.status === 'accepted') {
        aggregate.accepted.push(result);
        accepted.add(result.mutationId);
        await this.stateStore.deleteMutation(householdId, result.mutationId);
      } else if (result.status === 'conflict') {
        aggregate.conflicts.push(result);
        await this.stateStore.updateMutation({
          ...queued,
          status: 'conflict',
          conflictRevision: result.currentEntityRevision,
        });
      } else {
        aggregate.rejected.push(result);
        await this.stateStore.updateMutation({
          ...queued,
          status: 'rejected',
          rejectionCode: result.code,
        });
      }
    }
    return accepted;
  }

  private async persistProvisioning(
    connection: SyncV2Connection,
    credentials: StoredSyncV2Credentials,
  ): Promise<void> {
    await this.credentialStore.save(connection.householdId, credentials);
    try {
      await this.stateStore.saveConnection(connection);
    } catch (error) {
      await this.credentialStore.clear(connection.householdId).catch(() => undefined);
      throw error;
    }
  }

  private async requireSession(requireCredentials = true): Promise<{
    connection: SyncV2Connection;
    credentials: StoredSyncV2Credentials;
  }> {
    if (!this.activeHouseholdId) throw new Error('No active sync household.');
    const connection = await this.stateStore.getConnection(this.activeHouseholdId);
    if (!connection) throw new Error('Sync household is not configured on this device.');
    if (connection.endpoint !== this.api.endpoint) throw new Error('Configured household uses a different sync endpoint.');
    const credentials = await this.credentialStore.load(connection.householdId);
    if (requireCredentials && !credentials) throw new Error('Sync credentials are unavailable or the browser session ended.');
    return { connection, credentials: credentials ?? { deviceToken: '', dataKey: '' } };
  }

  private requireRemoteHandler(): RemoteChangeHandler {
    if (!this.applyRemoteChange) throw new Error('No remote-change handler is configured.');
    return this.applyRemoteChange;
  }
}

async function importStoredDataKey(credentials: StoredSyncV2Credentials): Promise<CryptoKey> {
  return importDataKey(base64UrlDecode(credentials.dataKey));
}

async function decryptChange(
  key: CryptoKey,
  householdId: string,
  record: EncryptedEntityRecord,
): Promise<RemoteSyncV2Change> {
  if (record.operation === 'delete') {
    return { record: record as EncryptedEntityRecord & { operation: 'delete' } };
  }
  if (!record.encrypted) throw new Error('Encrypted upsert is missing ciphertext.');
  const plaintext = await decryptEntity<unknown>(
    key,
    {
      householdId,
      entityType: record.entityType,
      entityId: record.entityId,
      schemaVersion: record.schemaVersion,
      mutationId: record.mutationId,
      operation: record.operation,
    },
    record.encrypted,
  );
  const payload = parseSyncEntityPayload(record.entityType, plaintext);
  if (!isRecordWithId(payload) || payload.id !== record.entityId) {
    throw new Error('Decrypted entity ID does not match its encrypted envelope.');
  }
  return {
    record: record as EncryptedEntityRecord & { operation: 'upsert' },
    payload,
  };
}

function entityKeys(items: readonly QueuedSyncV2Mutation[]): Set<string> {
  return new Set(items.map((item) => entityKey(item.mutation)));
}

function entityKey(value: Pick<SyncMutation, 'entityType' | 'entityId'>): string {
  return `${value.entityType}\u0000${value.entityId}`;
}

function createMutationId(): string {
  return `mut_${crypto.randomUUID()}`;
}

function assertRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Base entity revision must be a non-negative integer.');
}

function isRecordWithId(value: unknown): value is { id: string } {
  return typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string';
}
