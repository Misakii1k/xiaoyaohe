import {
  SYNC_V2_LIMITS,
  type EncryptedEntityRecord,
  type MutationResult,
  type SyncMutation,
  type SyncResponseV2,
  isValidHouseholdId,
  validateDeviceName,
  validateSyncRequest,
} from '../../src/sync/v2/protocol';
import { internalJson, readJsonBody, RequestBodyError } from './body';
import {
  constantTimeEqual,
  createDeviceToken,
  createPairingSecret,
  fingerprintMutation,
  parseBearerCredentials,
  randomId,
  sha256,
  type BearerCredentials,
} from './security';

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ACTIVE_PAIRING_CODES = 5;
const MAX_DEVICES = 16;

interface HouseholdMeta {
  householdId: string;
  revision: number;
  entityCount: number;
  createdAt: number;
}

interface DeviceRecord {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: number;
  rotatedAt?: number;
  revokedAt?: number;
}

interface PairingRecord {
  createdAt: number;
  expiresAt: number;
  createdByDeviceId: string;
  usedAt?: number;
  usedByDeviceId?: string;
  revokedAt?: number;
}

interface MutationReceipt {
  fingerprint: string;
  result: MutationResult;
  createdAt: number;
}

interface TransactionResponse {
  status: number;
  body: unknown;
}

export class SyncV2Household {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    try {
      if (path === '/internal/create' && request.method === 'POST') return await this.create(request);
      if (path === '/internal/pairing-codes' && request.method === 'POST') return await this.createPairingCode(request);
      if (path === '/internal/pair' && request.method === 'POST') return await this.pairDevice(request);
      if (path === '/internal/sync' && request.method === 'POST') return await this.sync(request);
      if (path === '/internal/devices' && request.method === 'GET') return await this.listDevices(request);

      const rotateMatch = /^\/internal\/devices\/([^/]+)\/rotate$/.exec(path);
      if (rotateMatch && request.method === 'POST') return await this.rotateDevice(request, rotateMatch[1]);
      const deviceMatch = /^\/internal\/devices\/([^/]+)$/.exec(path);
      if (deviceMatch && request.method === 'DELETE') return await this.revokeDevice(request, deviceMatch[1]);
      return internalJson({ error: 'not_found' }, 404);
    } catch (error) {
      if (error instanceof RequestBodyError) {
        return internalJson({ error: error.code, message: error.message }, error.status);
      }
      console.error('sync-v2 durable object failure', error);
      return internalJson({ error: 'internal_error' }, 500);
    }
  }

  private async create(request: Request): Promise<Response> {
    const body = await readJsonBody(request, 2_048);
    if (!isRecord(body) || Object.keys(body).some((key) => key !== 'householdId' && key !== 'deviceName')) {
      return internalJson({ error: 'invalid_create_request' }, 400);
    }
    const deviceName = validateDeviceName(body.deviceName);
    if (!deviceName.ok || !isValidHouseholdId(body.householdId)) {
      return internalJson({ error: 'invalid_create_request', issues: deviceName.ok ? [] : deviceName.issues }, 400);
    }

    const deviceId = randomId('dev');
    const token = createDeviceToken(deviceId);
    const tokenHash = await sha256(token);
    const now = Date.now();
    const result = await this.state.storage.transaction(async (transaction): Promise<TransactionResponse> => {
      if (await transaction.get<HouseholdMeta>('meta')) {
        return { status: 409, body: { error: 'household_exists' } };
      }
      const meta: HouseholdMeta = { householdId: body.householdId as string, revision: 0, entityCount: 0, createdAt: now };
      const device: DeviceRecord = { id: deviceId, name: deviceName.value, tokenHash, createdAt: now };
      await transaction.put('meta', meta);
      await transaction.put(deviceKey(deviceId), device);
      return {
        status: 201,
        body: {
          householdId: meta.householdId,
          householdRevision: 0,
          device: { id: deviceId, name: device.name, token },
        },
      };
    });
    return internalJson(result.body, result.status);
  }

  private async createPairingCode(request: Request): Promise<Response> {
    const credentials = await parseBearerCredentials(request.headers.get('authorization'));
    if (!credentials) return unauthorized();
    const code = createPairingSecret();
    const codeHash = await sha256(code);
    const now = Date.now();
    const result = await this.state.storage.transaction(async (transaction): Promise<TransactionResponse> => {
      const device = await authenticate(transaction, credentials);
      if (!device) return unauthorizedResult();

      const records = await transaction.list<PairingRecord>({ prefix: 'pairing:' });
      let activeCount = 0;
      for (const [key, record] of records) {
        if (!record.usedAt && !record.revokedAt && record.expiresAt > now) activeCount += 1;
        else if (record.expiresAt <= now - PAIRING_CODE_TTL_MS) await transaction.delete(key);
      }
      if (activeCount >= MAX_ACTIVE_PAIRING_CODES) {
        return { status: 429, body: { error: 'too_many_pairing_codes' } };
      }
      const record: PairingRecord = {
        createdAt: now,
        expiresAt: now + PAIRING_CODE_TTL_MS,
        createdByDeviceId: device.id,
      };
      await transaction.put(pairingKey(codeHash), record);
      return { status: 201, body: { pairingCode: code, expiresAt: record.expiresAt } };
    });
    return internalJson(result.body, result.status);
  }

  private async pairDevice(request: Request): Promise<Response> {
    const pairingCode = request.headers.get('x-medbox-pairing-code');
    if (!pairingCode || !/^[A-Za-z0-9_-]{20,128}$/.test(pairingCode)) return unauthorized();
    const body = await readJsonBody(request, 2_048);
    if (!isRecord(body) || Object.keys(body).some((key) => key !== 'deviceName')) {
      return internalJson({ error: 'invalid_pair_request' }, 400);
    }
    const deviceName = validateDeviceName(body.deviceName);
    if (!deviceName.ok) return internalJson({ error: 'invalid_pair_request', issues: deviceName.issues }, 400);

    const codeHash = await sha256(pairingCode);
    const deviceId = randomId('dev');
    const token = createDeviceToken(deviceId);
    const tokenHash = await sha256(token);
    const now = Date.now();
    const result = await this.state.storage.transaction(async (transaction): Promise<TransactionResponse> => {
      const meta = await transaction.get<HouseholdMeta>('meta');
      if (!meta) return { status: 404, body: { error: 'household_not_found' } };
      const pairing = await transaction.get<PairingRecord>(pairingKey(codeHash));
      if (!pairing || pairing.usedAt || pairing.revokedAt || pairing.expiresAt <= now) return unauthorizedResult();

      const devices = await transaction.list<DeviceRecord>({ prefix: 'device:' });
      const activeDevices = [...devices.values()].filter((device) => !device.revokedAt).length;
      if (activeDevices >= MAX_DEVICES) return { status: 409, body: { error: 'device_limit_reached' } };

      const device: DeviceRecord = { id: deviceId, name: deviceName.value, tokenHash, createdAt: now };
      pairing.usedAt = now;
      pairing.usedByDeviceId = deviceId;
      await transaction.put(pairingKey(codeHash), pairing);
      await transaction.put(deviceKey(deviceId), device);
      return {
        status: 201,
        body: { householdId: meta.householdId, householdRevision: meta.revision, device: { id: deviceId, name: device.name, token } },
      };
    });
    return internalJson(result.body, result.status);
  }

  private async rotateDevice(request: Request, targetDeviceId: string): Promise<Response> {
    const credentials = await parseBearerCredentials(request.headers.get('authorization'));
    if (!credentials || credentials.deviceId !== targetDeviceId) return unauthorized();
    const token = createDeviceToken(targetDeviceId);
    const tokenHash = await sha256(token);
    const now = Date.now();
    const result = await this.state.storage.transaction(async (transaction): Promise<TransactionResponse> => {
      const device = await authenticate(transaction, credentials);
      if (!device) return unauthorizedResult();
      device.tokenHash = tokenHash;
      device.rotatedAt = now;
      await transaction.put(deviceKey(device.id), device);
      return { status: 200, body: { device: { id: device.id, name: device.name, token, rotatedAt: now } } };
    });
    return internalJson(result.body, result.status);
  }

  private async listDevices(request: Request): Promise<Response> {
    const credentials = await parseBearerCredentials(request.headers.get('authorization'));
    if (!credentials) return unauthorized();
    const result = await this.state.storage.transaction(async (transaction): Promise<TransactionResponse> => {
      if (!(await authenticate(transaction, credentials))) return unauthorizedResult();
      const records = await transaction.list<DeviceRecord>({ prefix: 'device:' });
      const devices = [...records.values()]
        .map((device) => ({
          id: device.id,
          name: device.name,
          createdAt: device.createdAt,
          ...(device.rotatedAt ? { rotatedAt: device.rotatedAt } : {}),
          ...(device.revokedAt ? { revokedAt: device.revokedAt } : {}),
        }))
        .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
      return { status: 200, body: { authenticatedDeviceId: credentials.deviceId, devices } };
    });
    return internalJson(result.body, result.status);
  }

  private async revokeDevice(request: Request, targetDeviceId: string): Promise<Response> {
    const credentials = await parseBearerCredentials(request.headers.get('authorization'));
    if (!credentials) return unauthorized();
    const now = Date.now();
    const result = await this.state.storage.transaction(async (transaction): Promise<TransactionResponse> => {
      if (!(await authenticate(transaction, credentials))) return unauthorizedResult();
      const target = await transaction.get<DeviceRecord>(deviceKey(targetDeviceId));
      if (!target) return { status: 404, body: { error: 'device_not_found' } };
      if (!target.revokedAt) {
        target.revokedAt = now;
        await transaction.put(deviceKey(target.id), target);
        const pairingCodes = await transaction.list<PairingRecord>({ prefix: 'pairing:' });
        for (const [key, pairing] of pairingCodes) {
          if (pairing.createdByDeviceId === target.id && !pairing.usedAt && !pairing.revokedAt) {
            pairing.revokedAt = now;
            await transaction.put(key, pairing);
          }
        }
      }
      return { status: 200, body: { deviceId: target.id, revokedAt: target.revokedAt } };
    });
    return internalJson(result.body, result.status);
  }

  private async sync(request: Request): Promise<Response> {
    const credentials = await parseBearerCredentials(request.headers.get('authorization'));
    if (!credentials) return unauthorized();
    const raw = await readJsonBody(request, SYNC_V2_LIMITS.requestBytes);
    const parsed = validateSyncRequest(raw);
    if (!parsed.ok) return internalJson({ error: 'invalid_sync_request', issues: parsed.issues }, 400);

    const fingerprints = await Promise.all(parsed.value.mutations.map((mutation) => fingerprintMutation(mutation)));
    const now = Date.now();
    const response = await this.state.storage.transaction(async (transaction): Promise<TransactionResponse> => {
      if (!(await authenticate(transaction, credentials))) return unauthorizedResult();
      const meta = await transaction.get<HouseholdMeta>('meta');
      if (!meta) return { status: 404, body: { error: 'household_not_found' } };
      if (parsed.value.sinceHouseholdRevision > meta.revision) {
        return { status: 409, body: { error: 'sync_cursor_ahead', householdRevision: meta.revision } };
      }

      const results: MutationResult[] = [];
      for (let index = 0; index < parsed.value.mutations.length; index += 1) {
        const mutation = parsed.value.mutations[index];
        const result = await applyMutation(transaction, meta, mutation, fingerprints[index], now);
        results.push(result);
      }
      await transaction.put('meta', meta);

      const storedEntities = await transaction.list<EncryptedEntityRecord>({ prefix: 'entity:' });
      const pendingChanges = [...storedEntities.values()]
        .filter((entity) => entity.householdRevision > parsed.value.sinceHouseholdRevision)
        .sort((left, right) => left.householdRevision - right.householdRevision);
      const changes: EncryptedEntityRecord[] = [];
      let responseBytes = JSON.stringify(results).length + 512;
      for (const entity of pendingChanges) {
        const entityBytes = JSON.stringify(entity).length;
        if (
          changes.length >= SYNC_V2_LIMITS.changesPerResponse ||
          (changes.length > 0 && responseBytes + entityBytes > SYNC_V2_LIMITS.responseBytes)
        ) {
          break;
        }
        changes.push(entity);
        responseBytes += entityBytes;
      }
      const hasMore = changes.length < pendingChanges.length;
      const nextHouseholdRevision = hasMore
        ? changes[changes.length - 1]?.householdRevision ?? parsed.value.sinceHouseholdRevision
        : meta.revision;
      const body: SyncResponseV2 = {
        householdRevision: meta.revision,
        nextHouseholdRevision,
        hasMore,
        results,
        changes,
      };
      return { status: 200, body };
    });
    return internalJson(response.body, response.status);
  }
}

async function applyMutation(
  transaction: DurableObjectTransaction,
  meta: HouseholdMeta,
  mutation: SyncMutation,
  fingerprint: string,
  now: number,
): Promise<MutationResult> {
  const existingReceipt = await transaction.get<MutationReceipt>(mutationKey(mutation.mutationId));
  if (existingReceipt) {
    if (constantTimeEqual(existingReceipt.fingerprint, fingerprint)) return existingReceipt.result;
    return { mutationId: mutation.mutationId, status: 'rejected', code: 'mutation_id_reused' };
  }

  const current = await transaction.get<EncryptedEntityRecord>(entityKey(mutation.entityType, mutation.entityId));
  const currentRevision = current?.entityRevision ?? 0;
  let result: MutationResult;
  if (mutation.baseEntityRevision !== currentRevision) {
    result = {
      mutationId: mutation.mutationId,
      status: 'conflict',
      currentEntityRevision: currentRevision,
    };
  } else if (!current && meta.entityCount >= SYNC_V2_LIMITS.entitiesPerHousehold) {
    result = { mutationId: mutation.mutationId, status: 'rejected', code: 'entity_limit_reached' };
  } else {
    meta.revision += 1;
    if (!current) meta.entityCount += 1;
    const record: EncryptedEntityRecord = {
      entityType: mutation.entityType,
      entityId: mutation.entityId,
      operation: mutation.operation,
      schemaVersion: mutation.schemaVersion,
      mutationId: mutation.mutationId,
      entityRevision: currentRevision + 1,
      householdRevision: meta.revision,
      ...(mutation.encrypted ? { encrypted: mutation.encrypted } : {}),
    };
    await transaction.put(entityKey(record.entityType, record.entityId), record);
    result = {
      mutationId: mutation.mutationId,
      status: 'accepted',
      entityRevision: record.entityRevision,
      householdRevision: record.householdRevision,
    };
  }
  const receipt: MutationReceipt = { fingerprint, result, createdAt: now };
  await transaction.put(mutationKey(mutation.mutationId), receipt);
  return result;
}

async function authenticate(
  storage: Pick<DurableObjectTransaction, 'get'>,
  credentials: BearerCredentials,
): Promise<DeviceRecord | null> {
  const device = await storage.get<DeviceRecord>(deviceKey(credentials.deviceId));
  if (!device || device.revokedAt || !constantTimeEqual(device.tokenHash, credentials.tokenHash)) return null;
  return device;
}

function unauthorized(): Response {
  return internalJson({ error: 'unauthorized' }, 401, { 'www-authenticate': 'Bearer realm="medbox-sync-v2"' });
}

function unauthorizedResult(): TransactionResponse {
  return { status: 401, body: { error: 'unauthorized' } };
}

function deviceKey(deviceId: string): string {
  return `device:${deviceId}`;
}

function pairingKey(codeHash: string): string {
  return `pairing:${codeHash}`;
}

function mutationKey(mutationId: string): string {
  return `mutation:${mutationId}`;
}

function entityKey(entityType: string, entityId: string): string {
  return `entity:${entityType}:${entityId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
