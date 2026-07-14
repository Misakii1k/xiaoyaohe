import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { SyncV2Api, type SyncFetch } from './api';
import { SyncV2Client } from './client';
import {
  SessionSyncV2CredentialStore,
  type StoredSyncV2Credentials,
  type SyncV2CredentialStore,
} from './credentials';
import { base64UrlDecode, encryptEntity, importDataKey } from './crypto';
import type { SyncMedicationPayload } from './entities';
import {
  IndexedDbSyncV2StateStore,
  MemorySyncV2StateStore,
  type SyncV2Connection,
} from './state';
import type { SyncMutation } from './protocol';

const ENDPOINT = 'https://sync.example.test';
const HOUSEHOLD = 'a'.repeat(26);
const DEVICE_ID = 'dev_primary';
const TOKEN = `${DEVICE_ID}.${'s'.repeat(43)}`;

class TestCredentialStore implements SyncV2CredentialStore {
  readonly values = new Map<string, StoredSyncV2Credentials>();

  async load(householdId: string) {
    const value = this.values.get(householdId);
    return value ? { ...value } : null;
  }

  async save(householdId: string, credentials: StoredSyncV2Credentials) {
    this.values.set(householdId, { ...credentials });
  }

  async clear(householdId: string) {
    this.values.delete(householdId);
  }
}

function medication(id: string, name = 'Example medicine'): SyncMedicationPayload {
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
    identity: { gtins: [], rawCodes: [], ocrNames: [], photoHashes: [] },
    updatedAt: 1,
    createdAt: 1,
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function createdHousehold(deviceId = DEVICE_ID, token = TOKEN) {
  return {
    householdId: HOUSEHOLD,
    householdRevision: 0,
    device: { id: deviceId, name: 'Primary phone', token },
  };
}

function parseBody(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

function mutationRecord(mutation: SyncMutation, entityRevision: number, householdRevision: number) {
  return {
    entityType: mutation.entityType,
    entityId: mutation.entityId,
    operation: mutation.operation,
    schemaVersion: mutation.schemaVersion,
    mutationId: mutation.mutationId,
    entityRevision,
    householdRevision,
    ...(mutation.encrypted ? { encrypted: mutation.encrypted } : {}),
  };
}

describe('SyncV2Client', () => {
  it('retains the exact encrypted mutation across an offline retry and never sends plaintext', async () => {
    const requests: { url: string; init?: RequestInit; body: string }[] = [];
    let syncAttempts = 0;
    const fetchMock: SyncFetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v2/households')) return json(createdHousehold(), 201);
      if (url.endsWith(`/${HOUSEHOLD}/sync`)) {
        requests.push({ url, init, body: String(init?.body) });
        syncAttempts += 1;
        if (syncAttempts === 1) throw new TypeError('offline');
        const request = parseBody(init) as unknown as { sinceHouseholdRevision: number; mutations: SyncMutation[] };
        const mutation = request.mutations[0];
        return json({
          householdRevision: 1,
          nextHouseholdRevision: 1,
          hasMore: false,
          results: [{ mutationId: mutation.mutationId, status: 'accepted', entityRevision: 1, householdRevision: 1 }],
          changes: [mutationRecord(mutation, 1, 1)],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const credentials = new TestCredentialStore();
    const state = new MemorySyncV2StateStore();
    const client = new SyncV2Client({
      api: new SyncV2Api(ENDPOINT, { fetch: fetchMock, timeoutMs: 1_000 }),
      credentialStore: credentials,
      stateStore: state,
    });

    await client.createHousehold('Primary phone');
    await client.queueUpsert('medication', medication('med_01', 'Private medicine name'), 0);
    const first = await client.sync();
    expect(first.status).toBe('offline');
    expect(await client.listQueuedMutations()).toHaveLength(1);

    const second = await client.sync();
    expect(second.status).toBe('complete');
    expect(second.confirmedMutationIds).toHaveLength(1);
    expect(second.accepted[0]).toMatchObject({ entityRevision: 1, householdRevision: 1 });
    expect(await client.listQueuedMutations()).toHaveLength(0);
    expect(requests[1].body).toBe(requests[0].body);
    expect(requests[0].body).not.toContain('Private medicine name');
    expect(requests[0].url).not.toContain(TOKEN);
    expect(new Headers(requests[0].init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(new Headers(requests[0].init?.headers).get('cache-control')).toBe('no-store');
    expect(requests[0].init?.cache).toBe('no-store');
  });

  it('surfaces conflicts, keeps the local mutation, and defers the remote entity', async () => {
    const credentials = new TestCredentialStore();
    const state = new MemorySyncV2StateStore();
    const applyRemote = vi.fn(() => 'applied' as const);
    let localMutation: SyncMutation | null = null;
    const fetchMock: SyncFetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v2/households')) return json(createdHousehold(), 201);
      if (!url.endsWith(`/${HOUSEHOLD}/sync`)) throw new Error(`Unexpected URL: ${url}`);
      const request = parseBody(init) as unknown as { mutations: SyncMutation[] };
      localMutation = request.mutations[0];
      const stored = credentials.values.get(HOUSEHOLD)!;
      const key = await importDataKey(base64UrlDecode(stored.dataKey));
      const remoteMutationId = 'remote_mutation_01';
      const encrypted = await encryptEntity(key, {
        householdId: HOUSEHOLD,
        entityType: 'medication',
        entityId: 'med_conflict',
        schemaVersion: 2,
        mutationId: remoteMutationId,
        operation: 'upsert',
      }, medication('med_conflict', 'Remote value'));
      return json({
        householdRevision: 1,
        nextHouseholdRevision: 1,
        hasMore: false,
        results: [{ mutationId: localMutation.mutationId, status: 'conflict', currentEntityRevision: 1 }],
        changes: [{
          entityType: 'medication',
          entityId: 'med_conflict',
          operation: 'upsert',
          schemaVersion: 2,
          mutationId: remoteMutationId,
          entityRevision: 1,
          householdRevision: 1,
          encrypted,
        }],
      });
    });
    const client = new SyncV2Client({
      api: new SyncV2Api(ENDPOINT, { fetch: fetchMock }),
      credentialStore: credentials,
      stateStore: state,
      applyRemoteChange: applyRemote,
    });

    await client.createHousehold('Primary phone');
    const queued = await client.queueUpsert('medication', medication('med_conflict', 'Local edit'), 0);
    const run = await client.sync();
    expect(run.conflicts).toEqual([{ mutationId: queued.mutation.mutationId, status: 'conflict', currentEntityRevision: 1 }]);
    expect(run.deferredChanges[0]?.payload).toMatchObject({ name: 'Remote value' });
    expect(applyRemote).not.toHaveBeenCalled();
    expect((await client.listQueuedMutations())[0]).toMatchObject({ status: 'conflict', conflictRevision: 1 });
    expect(await client.listStagedChanges()).toHaveLength(1);

    await client.discardMutation(queued.mutation.mutationId);
    await expect(client.applyStagedChanges()).resolves.toHaveLength(1);
    expect(applyRemote).toHaveBeenCalledTimes(1);
    expect(await client.listStagedChanges()).toHaveLength(0);
    expect(localMutation).not.toBeNull();
  });

  it('pulls every page in order and sends mutations only on the first page', async () => {
    const credentials = new TestCredentialStore();
    const state = new MemorySyncV2StateStore();
    const applied: string[] = [];
    let page = 0;
    const seenBodies: Record<string, unknown>[] = [];
    const fetchMock: SyncFetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v2/households')) return json(createdHousehold(), 201);
      const request = parseBody(init);
      seenBodies.push(request);
      page += 1;
      const stored = credentials.values.get(HOUSEHOLD)!;
      const key = await importDataKey(base64UrlDecode(stored.dataKey));
      const id = `med_remote_${page}`;
      const mutationId = `remote_mutation_${page}`;
      const encrypted = await encryptEntity(key, {
        householdId: HOUSEHOLD,
        entityType: 'medication',
        entityId: id,
        schemaVersion: 2,
        mutationId,
        operation: 'upsert',
      }, medication(id, `Remote ${page}`));
      return json({
        householdRevision: 2,
        nextHouseholdRevision: page,
        hasMore: page === 1,
        results: [],
        changes: [{
          entityType: 'medication', entityId: id, operation: 'upsert', schemaVersion: 2,
          mutationId, entityRevision: 1, householdRevision: page, encrypted,
        }],
      });
    });
    const client = new SyncV2Client({
      api: new SyncV2Api(ENDPOINT, { fetch: fetchMock }),
      credentialStore: credentials,
      stateStore: state,
      applyRemoteChange(change) {
        applied.push(change.record.entityId);
        return 'applied';
      },
    });
    await client.createHousehold('Primary phone');
    const run = await client.sync();
    expect(run.cursor).toBe(2);
    expect(applied).toEqual(['med_remote_1', 'med_remote_2']);
    expect(seenBodies).toEqual([
      { sinceHouseholdRevision: 0, mutations: [] },
      { sinceHouseholdRevision: 1, mutations: [] },
    ]);
    expect((await state.getConnection(HOUSEHOLD))?.cursor).toBe(2);
  });

  it('keeps the pairing secret and recovery key out of the HTTP URL', async () => {
    const firstCredentials = new TestCredentialStore();
    const secondCredentials = new TestCredentialStore();
    const pairingSecret = 'p'.repeat(32);
    let pairRequest: { url: string; init?: RequestInit } | null = null;
    const fetchMock: SyncFetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v2/households')) return json(createdHousehold(), 201);
      if (url.endsWith('/pairing-codes')) return json({ pairingCode: pairingSecret, expiresAt: 12345 }, 201);
      if (url.endsWith('/pair')) {
        pairRequest = { url, init };
        return json(createdHousehold('dev_second', `dev_second.${'t'.repeat(43)}`), 201);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const api = new SyncV2Api(ENDPOINT, { fetch: fetchMock });
    const first = new SyncV2Client({ api, credentialStore: firstCredentials, stateStore: new MemorySyncV2StateStore() });
    await first.createHousehold('Primary phone');
    const invitation = await first.createPairingInvitation();
    const parsedInvitation = new URL(invitation.pairingUri);
    expect(parsedInvitation.search).not.toContain(pairingSecret);
    expect(parsedInvitation.hash).toContain(pairingSecret);

    const second = new SyncV2Client({ api, credentialStore: secondCredentials, stateStore: new MemorySyncV2StateStore() });
    await second.pairDevice(invitation.pairingUri, 'Second phone');
    expect(pairRequest).not.toBeNull();
    const request = pairRequest as unknown as { url: string; init?: RequestInit };
    expect(request.url).not.toContain(pairingSecret);
    expect(request.url).not.toContain('#');
    expect(new Headers(request.init?.headers).get('x-medbox-pairing-code')).toBe(pairingSecret);
    expect(secondCredentials.values.get(HOUSEHOLD)?.dataKey).toBe(firstCredentials.values.get(HOUSEHOLD)?.dataKey);
  });

  it('lists devices, rotates only the current token, and revokes another device', async () => {
    const credentials = new TestCredentialStore();
    const rotatedToken = `${DEVICE_ID}.${'r'.repeat(43)}`;
    const authorizations: string[] = [];
    const fetchMock: SyncFetch = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v2/households') return json(createdHousehold(), 201);
      authorizations.push(new Headers(init?.headers).get('authorization') ?? '');
      if (url.pathname.endsWith(`/${DEVICE_ID}/rotate`)) {
        return json({ device: { id: DEVICE_ID, name: 'Primary phone', token: rotatedToken, rotatedAt: 20 } });
      }
      if (url.pathname.endsWith('/devices') && init?.method === 'GET') {
        return json({
          authenticatedDeviceId: DEVICE_ID,
          devices: [
            { id: DEVICE_ID, name: 'Primary phone', createdAt: 1, rotatedAt: 20 },
            { id: 'dev_second', name: 'Second phone', createdAt: 2 },
          ],
        });
      }
      if (url.pathname.endsWith('/dev_second') && init?.method === 'DELETE') {
        return json({ deviceId: 'dev_second', revokedAt: 30 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const client = new SyncV2Client({
      api: new SyncV2Api(ENDPOINT, { fetch: fetchMock }),
      credentialStore: credentials,
      stateStore: new MemorySyncV2StateStore(),
    });
    await client.createHousehold('Primary phone');
    await expect(client.listDevices()).resolves.toMatchObject({ authenticatedDeviceId: DEVICE_ID });
    await client.rotateCurrentDeviceToken();
    expect(credentials.values.get(HOUSEHOLD)?.deviceToken).toBe(rotatedToken);
    await client.listDevices();
    await client.revokeDevice('dev_second');
    expect(authorizations).toEqual([
      `Bearer ${TOKEN}`,
      `Bearer ${TOKEN}`,
      `Bearer ${rotatedToken}`,
      `Bearer ${rotatedToken}`,
    ]);
  });

  it('rejects work-shaped plaintext before it can enter the encrypted queue', async () => {
    const fetchMock: SyncFetch = vi.fn(async () => json(createdHousehold(), 201));
    const client = new SyncV2Client({
      api: new SyncV2Api(ENDPOINT, { fetch: fetchMock }),
      credentialStore: new TestCredentialStore(),
      stateStore: new MemorySyncV2StateStore(),
    });
    await client.createHousehold('Primary phone');
    await expect(client.queueUpsert('medication', {
      ...medication('med_01'),
      workEntries: [{ id: 'work_01', salary: 1000 }],
    } as unknown as SyncMedicationPayload, 0)).rejects.toThrow(/unrecognized|key/i);
    expect(await client.listQueuedMutations()).toHaveLength(0);
  });
});

describe('sync v2 storage boundaries', () => {
  it('accepts only an HTTPS origin as the sync endpoint', () => {
    expect(() => new SyncV2Api('http://sync.example.test')).toThrow(/HTTPS/);
    expect(() => new SyncV2Api('https://user:pass@sync.example.test')).toThrow(/HTTPS/);
    expect(() => new SyncV2Api('https://sync.example.test/path')).toThrow(/HTTPS/);
    expect(new SyncV2Api(ENDPOINT).endpoint).toBe(ENDPOINT);
  });

  it('keeps PWA credentials in session memory without touching localStorage', async () => {
    const household = 'b'.repeat(26);
    const localStorage = {
      getItem: vi.fn(() => { throw new Error('localStorage must not be read'); }),
      setItem: vi.fn(() => { throw new Error('localStorage must not be written'); }),
      removeItem: vi.fn(() => { throw new Error('localStorage must not be written'); }),
    };
    vi.stubGlobal('localStorage', localStorage);
    const store = new SessionSyncV2CredentialStore();
    const value = { deviceToken: `dev_web.${'w'.repeat(43)}`, dataKey: 'A'.repeat(43) };
    await store.save(household, value);
    await expect(store.load(household)).resolves.toEqual(value);
    expect(localStorage.setItem).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('persists only public connection data and encrypted mutations in IndexedDB', async () => {
    const household = 'c'.repeat(26);
    const state = new IndexedDbSyncV2StateStore();
    const connection: SyncV2Connection = {
      endpoint: ENDPOINT,
      householdId: household,
      deviceId: 'dev_indexed',
      cursor: 0,
      updatedAt: 1,
    };
    await state.saveConnection(connection);
    const reopened = new IndexedDbSyncV2StateStore();
    await expect(reopened.getConnection(household)).resolves.toEqual(connection);
    expect(JSON.stringify(await reopened.getConnection(household))).not.toMatch(/token|dataKey/i);
    await reopened.clearHousehold(household);
  });
});
