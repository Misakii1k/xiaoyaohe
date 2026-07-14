import { isValidDeviceId, isValidHouseholdId, validateDeviceName } from '../../src/sync/v2/protocol';
import type { Env } from '../types';
import { internalJson, readJsonBody, RequestBodyError } from '../sync-v2/body';
import { randomHouseholdId, sha256 } from '../sync-v2/security';

interface V2Config {
  households: DurableObjectNamespace;
  rateLimiter: DurableObjectNamespace;
  allowedOrigins: Set<string>;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export async function handleSyncV2(request: Request, env: Env): Promise<Response> {
  const config = getV2Config(env);
  const origin = request.headers.get('origin');
  if (!config) return decorate(internalJson({ error: 'sync_v2_unavailable' }, 503), origin, null);
  if (origin && !config.allowedOrigins.has(origin)) {
    return decorate(internalJson({ error: 'origin_not_allowed' }, 403), origin, null);
  }

  if (request.method === 'OPTIONS') return handlePreflight(request, config, origin);
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  try {
    if (path === '/api/v2/households' && request.method === 'POST') {
      const limited = await enforceRateLimit(config, request, 'create', '', 5, 60 * 60 * 1000);
      if (limited) return decorate(limited, origin, config);
      return decorate(await createHousehold(request, config), origin, config);
    }

    const householdMatch = /^\/api\/v2\/households\/([^/]+)(\/.*)?$/.exec(path);
    if (!householdMatch || !isValidHouseholdId(householdMatch[1])) {
      return decorate(internalJson({ error: 'not_found' }, 404), origin, config);
    }
    const householdId = householdMatch[1];
    const action = householdMatch[2] ?? '';
    const stub = config.households.get(config.households.idFromName(householdId));

    if (action === '/pair' && request.method === 'POST') {
      const limited = await enforceRateLimit(config, request, 'pair', householdId, 10, 10 * 60 * 1000);
      if (limited) return decorate(limited, origin, config);
      return decorate(await forward(request, stub, '/internal/pair'), origin, config);
    }
    if (action === '/pairing-codes' && request.method === 'POST') {
      const limited = await enforceRateLimit(config, request, 'pairing-admin', householdId, 30, 60 * 1000);
      if (limited) return decorate(limited, origin, config);
      return decorate(await forward(request, stub, '/internal/pairing-codes'), origin, config);
    }
    if (action === '/sync' && request.method === 'POST') {
      const limited = await enforceRateLimit(config, request, 'sync', householdId, 240, 60 * 1000);
      if (limited) return decorate(limited, origin, config);
      return decorate(await forward(request, stub, '/internal/sync'), origin, config);
    }
    if (action === '/devices' && request.method === 'GET') {
      const limited = await enforceRateLimit(config, request, 'device-admin', householdId, 30, 60 * 1000);
      if (limited) return decorate(limited, origin, config);
      return decorate(await forward(request, stub, '/internal/devices'), origin, config);
    }

    const rotateMatch = /^\/devices\/([^/]+)\/rotate$/.exec(action);
    if (rotateMatch && request.method === 'POST' && isValidDeviceId(rotateMatch[1])) {
      const limited = await enforceRateLimit(config, request, 'device-admin', householdId, 30, 60 * 1000);
      if (limited) return decorate(limited, origin, config);
      return decorate(await forward(request, stub, `/internal/devices/${rotateMatch[1]}/rotate`), origin, config);
    }
    const deviceMatch = /^\/devices\/([^/]+)$/.exec(action);
    if (deviceMatch && request.method === 'DELETE' && isValidDeviceId(deviceMatch[1])) {
      const limited = await enforceRateLimit(config, request, 'device-admin', householdId, 30, 60 * 1000);
      if (limited) return decorate(limited, origin, config);
      return decorate(await forward(request, stub, `/internal/devices/${deviceMatch[1]}`), origin, config);
    }
    return decorate(internalJson({ error: 'method_not_allowed' }, 405, { allow: allowedMethod(action) }), origin, config);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return decorate(internalJson({ error: error.code, message: error.message }, error.status), origin, config);
    }
    console.error('sync-v2 edge route failure', error);
    return decorate(internalJson({ error: 'sync_v2_unavailable' }, 503), origin, config);
  }
}

function getV2Config(env: Env): V2Config | null {
  if (env.SYNC_V2_ENABLED !== 'true' || !env.SYNC_V2_HOUSEHOLDS || !env.SYNC_V2_RATE_LIMITER) return null;
  const allowedOrigins = parseAllowedOrigins(env.SYNC_V2_ALLOWED_ORIGINS);
  if (!allowedOrigins?.size) return null;
  return { households: env.SYNC_V2_HOUSEHOLDS, rateLimiter: env.SYNC_V2_RATE_LIMITER, allowedOrigins };
}

function parseAllowedOrigins(value: string | undefined): Set<string> | null {
  const origins = new Set<string>();
  const entries = value?.split(',') ?? [];
  if (!entries.length) return null;
  for (const entry of entries) {
    const candidate = entry.trim();
    if (!candidate || candidate === '*') return null;
    try {
      const parsed = new URL(candidate);
      const localHttp = parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
      if ((parsed.protocol === 'https:' || localHttp) && parsed.origin === candidate.replace(/\/$/, '')) {
        origins.add(parsed.origin);
      } else {
        return null;
      }
    } catch {
      return null;
    }
  }
  return origins;
}

async function createHousehold(request: Request, config: V2Config): Promise<Response> {
  const body = await readJsonBody(request, 2_048);
  if (!isRecord(body) || Object.keys(body).some((key) => key !== 'deviceName')) {
    return internalJson({ error: 'invalid_create_request' }, 400);
  }
  const deviceName = validateDeviceName(body.deviceName);
  if (!deviceName.ok) return internalJson({ error: 'invalid_create_request', issues: deviceName.issues }, 400);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const householdId = randomHouseholdId();
    const stub = config.households.get(config.households.idFromName(householdId));
    const response = await stub.fetch('https://household.internal/internal/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ householdId, deviceName: deviceName.value }),
    });
    if (response.status !== 409) return response;
  }
  return internalJson({ error: 'household_id_generation_failed' }, 503);
}

async function forward(request: Request, stub: DurableObjectStub, internalPath: string): Promise<Response> {
  const headers = new Headers();
  const authorization = request.headers.get('authorization');
  const pairingCode = request.headers.get('x-medbox-pairing-code');
  const contentType = request.headers.get('content-type');
  if (authorization) headers.set('authorization', authorization);
  if (pairingCode) headers.set('x-medbox-pairing-code', pairingCode);
  if (contentType) headers.set('content-type', contentType);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'DELETE';
  return stub.fetch(`https://household.internal${internalPath}`, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
  });
}

async function enforceRateLimit(
  config: V2Config,
  request: Request,
  scope: string,
  householdId: string,
  limit: number,
  windowMs: number,
): Promise<Response | null> {
  const source = request.headers.get('cf-connecting-ip') ?? 'local-or-native';
  const key = await sha256(`${scope}\u0000${householdId}\u0000${source}`);
  const stub = config.rateLimiter.get(config.rateLimiter.idFromName(`${scope}:${key}`));
  const response = await stub.fetch('https://rate-limit.internal/internal/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ limit, windowMs, now: Date.now() }),
  });
  if (!response.ok) return internalJson({ error: 'rate_limiter_unavailable' }, 503);
  const result = (await response.json()) as RateLimitResult;
  if (result.allowed) return null;
  return internalJson(
    { error: 'rate_limited', retryAfterSeconds: result.retryAfterSeconds },
    429,
    { 'retry-after': String(result.retryAfterSeconds) },
  );
}

function handlePreflight(request: Request, config: V2Config, origin: string | null): Response {
  if (!origin || !config.allowedOrigins.has(origin)) return decorate(internalJson({ error: 'origin_not_allowed' }, 403), origin, null);
  const method = request.headers.get('access-control-request-method')?.toUpperCase() ?? '';
  if (!['GET', 'POST', 'DELETE'].includes(method)) return decorate(internalJson({ error: 'method_not_allowed' }, 405), origin, config);
  const requestedHeaders = (request.headers.get('access-control-request-headers') ?? '')
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  const allowedHeaders = new Set(['authorization', 'content-type', 'x-medbox-pairing-code']);
  if (requestedHeaders.some((header) => !allowedHeaders.has(header))) {
    return decorate(internalJson({ error: 'headers_not_allowed' }, 403), origin, config);
  }
  return decorate(new Response(null, { status: 204 }), origin, config);
}

function decorate(response: Response, origin: string | null, config: V2Config | null): Response {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  headers.set('pragma', 'no-cache');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('vary', appendVary(headers.get('vary'), 'Origin'));
  if (origin && config?.allowedOrigins.has(origin)) {
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
    headers.set('access-control-allow-headers', 'authorization,content-type,x-medbox-pairing-code');
    headers.set('access-control-expose-headers', 'retry-after');
    headers.set('access-control-max-age', '600');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function appendVary(current: string | null, value: string): string {
  const values = new Set((current ?? '').split(',').map((entry) => entry.trim()).filter(Boolean));
  values.add(value);
  return [...values].join(', ');
}

function allowedMethod(action: string): string {
  if (action === '/devices') return 'GET,OPTIONS';
  return action.startsWith('/devices/') && !action.endsWith('/rotate') ? 'DELETE,OPTIONS' : 'POST,OPTIONS';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
