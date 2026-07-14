import { describe, expect, it } from 'vitest';
import type { SyncMutation, SyncResponseV2 } from '../../src/sync/v2/protocol';
import { SyncV2Household } from './household';
import { randomHouseholdId } from './security';

class MemoryStorage {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    for (const [key, value] of [...this.values.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      if (!options?.prefix || key.startsWith(options.prefix)) result.set(key, structuredClone(value) as T);
    }
    return result;
  }

  async transaction<T>(callback: (transaction: DurableObjectTransaction) => Promise<T>): Promise<T> {
    return callback(this as unknown as DurableObjectTransaction);
  }
}

interface CreatedHousehold {
  householdId: string;
  householdRevision: number;
  device: { id: string; name: string; token: string };
}

const householdId = 'a'.repeat(26);
const encrypted = {
  algorithm: 'AES-GCM-256' as const,
  iv: 'AAAAAAAAAAAAAAAA',
  ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA',
};

function mutation(overrides: Partial<SyncMutation> = {}): SyncMutation {
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

async function setup(): Promise<{ object: SyncV2Household; storage: MemoryStorage; created: CreatedHousehold }> {
  const storage = new MemoryStorage();
  const object = new SyncV2Household({ storage } as unknown as DurableObjectState);
  const response = await call(object, '/internal/create', 'POST', { householdId, deviceName: 'Owner phone' });
  expect(response.status).toBe(201);
  return { object, storage, created: (await response.json()) as CreatedHousehold };
}

async function call(
  object: SyncV2Household,
  path: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return object.fetch(new Request(`https://household.internal${path}`, init));
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe('SyncV2Household', () => {
  it('generates valid high-entropy household IDs', () => {
    const ids = new Set(Array.from({ length: 1_000 }, () => randomHouseholdId()));
    expect(ids.size).toBe(1_000);
    for (const id of ids) expect(id).toMatch(/^[a-z2-9]{26}$/);
  });

  it('assigns revisions, returns conflicts, and makes duplicate mutations idempotent', async () => {
    const { object, created } = await setup();
    const request = { sinceHouseholdRevision: 0, mutations: [mutation()] };
    const first = await call(object, '/internal/sync', 'POST', request, bearer(created.device.token));
    expect(first.status).toBe(200);
    const firstBody = await first.json() as SyncResponseV2;
    expect(firstBody.results[0]).toMatchObject({ status: 'accepted', entityRevision: 1, householdRevision: 1 });
    expect(firstBody.changes).toHaveLength(1);

    const duplicate = await call(object, '/internal/sync', 'POST', request, bearer(created.device.token));
    const duplicateBody = await duplicate.json() as SyncResponseV2;
    expect(duplicateBody.householdRevision).toBe(1);
    expect(duplicateBody.results[0]).toEqual(firstBody.results[0]);

    const conflict = await call(
      object,
      '/internal/sync',
      'POST',
      { sinceHouseholdRevision: 1, mutations: [mutation({ mutationId: 'mutation_02', baseEntityRevision: 0 })] },
      bearer(created.device.token),
    );
    const conflictBody = await conflict.json() as SyncResponseV2;
    expect(conflictBody.results[0]).toEqual({ mutationId: 'mutation_02', status: 'conflict', currentEntityRevision: 1 });
    expect(conflictBody.householdRevision).toBe(1);

    const reused = await call(
      object,
      '/internal/sync',
      'POST',
      { sinceHouseholdRevision: 1, mutations: [mutation({ entityId: 'med_02' })] },
      bearer(created.device.token),
    );
    const reusedBody = await reused.json() as SyncResponseV2;
    expect(reusedBody.results[0]).toMatchObject({ status: 'rejected', code: 'mutation_id_reused' });
  });

  it('consumes pairing codes once and stores only hashes of tokens and codes', async () => {
    const { object, storage, created } = await setup();
    const pairingResponse = await call(object, '/internal/pairing-codes', 'POST', undefined, bearer(created.device.token));
    expect(pairingResponse.status).toBe(201);
    const pairing = await pairingResponse.json() as { pairingCode: string };

    const pairedResponse = await call(
      object,
      '/internal/pair',
      'POST',
      { deviceName: 'Caregiver phone' },
      { 'x-medbox-pairing-code': pairing.pairingCode },
    );
    expect(pairedResponse.status).toBe(201);
    const paired = await pairedResponse.json() as CreatedHousehold;

    const listed = await call(object, '/internal/devices', 'GET', undefined, bearer(created.device.token));
    expect(listed.status).toBe(200);
    const listedBody = await listed.json() as { devices: Array<Record<string, unknown>> };
    expect(listedBody.devices).toHaveLength(2);
    expect(listedBody.devices.map((device) => device.id)).toEqual(
      expect.arrayContaining([created.device.id, paired.device.id]),
    );
    expect(JSON.stringify(listedBody)).not.toContain('tokenHash');
    expect(JSON.stringify(listedBody)).not.toContain(created.device.token);

    const replay = await call(
      object,
      '/internal/pair',
      'POST',
      { deviceName: 'Replay phone' },
      { 'x-medbox-pairing-code': pairing.pairingCode },
    );
    expect(replay.status).toBe(401);
    const persisted = JSON.stringify([...storage.values.entries()]);
    expect(persisted).not.toContain(pairing.pairingCode);
    expect(persisted).not.toContain(created.device.token);
    expect(persisted).not.toContain(paired.device.token);
  });

  it('rotates and revokes device credentials immediately', async () => {
    const { object, created } = await setup();
    const pairingResponse = await call(object, '/internal/pairing-codes', 'POST', undefined, bearer(created.device.token));
    const pairing = await pairingResponse.json() as { pairingCode: string };
    const pairedResponse = await call(
      object,
      '/internal/pair',
      'POST',
      { deviceName: 'Second phone' },
      { 'x-medbox-pairing-code': pairing.pairingCode },
    );
    const paired = await pairedResponse.json() as CreatedHousehold;

    const rotation = await call(
      object,
      `/internal/devices/${created.device.id}/rotate`,
      'POST',
      undefined,
      bearer(created.device.token),
    );
    expect(rotation.status).toBe(200);
    const rotated = await rotation.json() as { device: { token: string } };
    expect(
      (await call(object, '/internal/sync', 'POST', { sinceHouseholdRevision: 0, mutations: [] }, bearer(created.device.token))).status,
    ).toBe(401);
    expect(
      (await call(object, '/internal/sync', 'POST', { sinceHouseholdRevision: 0, mutations: [] }, bearer(rotated.device.token))).status,
    ).toBe(200);

    expect(
      (await call(object, `/internal/devices/${paired.device.id}`, 'DELETE', undefined, bearer(rotated.device.token))).status,
    ).toBe(200);
    expect(
      (await call(object, '/internal/sync', 'POST', { sinceHouseholdRevision: 0, mutations: [] }, bearer(paired.device.token))).status,
    ).toBe(401);
  });

  it('rejects work mutations and oversized bodies before storage', async () => {
    const { object, created } = await setup();
    const work = await call(
      object,
      '/internal/sync',
      'POST',
      { sinceHouseholdRevision: 0, mutations: [{ ...mutation(), entityType: 'work' }] },
      bearer(created.device.token),
    );
    expect(work.status).toBe(400);

    const oversized = await call(
      object,
      '/internal/sync',
      'POST',
      { sinceHouseholdRevision: 0, mutations: [], padding: 'x'.repeat(512 * 1024) },
      bearer(created.device.token),
    );
    expect(oversized.status).toBe(413);

    const wrongMediaType = await object.fetch(
      new Request('https://household.internal/internal/sync', {
        method: 'POST',
        headers: { ...bearer(created.device.token), 'content-type': 'text/plain' },
        body: JSON.stringify({ sinceHouseholdRevision: 0, mutations: [] }),
      }),
    );
    expect(wrongMediaType.status).toBe(415);
  });
});
