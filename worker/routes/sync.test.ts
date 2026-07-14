import { describe, expect, it } from 'vitest';
import type { Env } from '../types';
import { handleSync } from './sync';

const snapshot = JSON.stringify({ meds: [], rules: [], logs: [], updatedAt: 7 });

function env(overrides: Partial<Env> = {}): Env {
  return {
    MEDBOX: { get: async () => snapshot } as unknown as KVNamespace,
    SYNC_SECRET: 'migration-secret',
    SYNC_V1_READONLY_ENABLED: 'true',
    SYNC_V2_ALLOWED_ORIGINS: 'https://app.example.test,http://localhost',
    ...overrides,
  };
}

describe('legacy v1 read-only migration route', () => {
  it('supports an exact-origin browser preflight for the authenticated GET', async () => {
    const response = await handleSync(
      new Request('https://worker.test/api/sync', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://app.example.test',
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'cache-control,pragma,x-household,x-secret',
        },
      }),
      env(),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example.test');
    expect(response.headers.get('access-control-allow-origin')).not.toBe('*');
  });

  it('decorates the read response but rejects unlisted origins and every write method', async () => {
    const allowed = await handleSync(
      new Request('https://worker.test/api/sync', {
        headers: {
          origin: 'https://app.example.test',
          'x-household': 'family01',
          'x-secret': 'migration-secret',
        },
      }),
      env(),
    );
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.example.test');
    await expect(allowed.json()).resolves.toMatchObject({ updatedAt: 7 });

    const denied = await handleSync(
      new Request('https://worker.test/api/sync', {
        headers: { origin: 'https://attacker.example', 'x-household': 'family01', 'x-secret': 'migration-secret' },
      }),
      env(),
    );
    expect(denied.status).toBe(403);
    expect(denied.headers.has('access-control-allow-origin')).toBe(false);

    const write = await handleSync(
      new Request('https://worker.test/api/sync', { method: 'PUT', headers: { origin: 'https://app.example.test' } }),
      env(),
    );
    expect(write.status).toBe(405);
  });

  it('fails closed when the migration switch is off', async () => {
    const response = await handleSync(
      new Request('https://worker.test/api/sync', { headers: { origin: 'https://app.example.test' } }),
      env({ SYNC_V1_READONLY_ENABLED: 'false' }),
    );
    expect(response.status).toBe(410);
    expect(response.headers.has('access-control-allow-origin')).toBe(false);
  });
});
