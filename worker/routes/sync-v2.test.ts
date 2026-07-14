import { describe, expect, it } from 'vitest';
import type { Env } from '../types';
import worker from '../index';
import { handleSyncV2 } from './sync-v2';

const namespace = {} as DurableObjectNamespace;

function env(overrides: Partial<Env> = {}): Env {
  return {
    MEDBOX: {} as KVNamespace,
    SYNC_V2_ENABLED: 'true',
    SYNC_V2_ALLOWED_ORIGINS: 'https://app.example.test,http://localhost',
    SYNC_V2_HOUSEHOLDS: namespace,
    SYNC_V2_RATE_LIMITER: namespace,
    ...overrides,
  };
}

describe('sync v2 edge policy', () => {
  it('fails closed unless the feature, bindings, and allowlist are configured', async () => {
    for (const candidate of [
      env({ SYNC_V2_ENABLED: 'false' }),
      env({ SYNC_V2_ALLOWED_ORIGINS: '' }),
      env({ SYNC_V2_ALLOWED_ORIGINS: 'https://app.example.test,*' }),
      env({ SYNC_V2_HOUSEHOLDS: undefined }),
      env({ SYNC_V2_RATE_LIMITER: undefined }),
    ]) {
      const response = await handleSyncV2(new Request('https://worker.test/api/v2/households'), candidate);
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('returns exact-origin CORS headers and rejects wildcard or unlisted origins', async () => {
    const allowed = await handleSyncV2(
      new Request('https://worker.test/api/v2/households', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://app.example.test',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization,content-type',
        },
      }),
      env(),
    );
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.example.test');
    expect(allowed.headers.get('access-control-allow-origin')).not.toBe('*');

    const denied = await handleSyncV2(
      new Request('https://worker.test/api/v2/households', {
        method: 'OPTIONS',
        headers: { origin: 'https://attacker.example', 'access-control-request-method': 'POST' },
      }),
      env(),
    );
    expect(denied.status).toBe(403);
    expect(denied.headers.has('access-control-allow-origin')).toBe(false);
  });

  it('keeps the shared-key AI proxy out of the active Worker flow', async () => {
    const response = await worker.fetch(new Request('https://worker.test/api/identify', { method: 'POST' }), env());
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ error: 'worker_ai_proxy_disabled' });
  });
});
