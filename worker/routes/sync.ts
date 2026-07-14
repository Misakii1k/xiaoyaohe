import type { Env } from '../types';
import { checkSecret, getHousehold, json } from '../lib/http';
import { readSnapshot } from '../lib/kv';

/** Legacy v1 is a controlled, read-only migration endpoint and is disabled by default. */
export async function handleSync(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('origin');
  if (env.SYNC_V1_READONLY_ENABLED !== 'true') {
    return decorate(json({ error: 'legacy_sync_disabled' }, 410), origin, null);
  }
  const allowedOrigins = parseAllowedOrigins(env.SYNC_V2_ALLOWED_ORIGINS);
  if (origin && !allowedOrigins.has(origin)) {
    return decorate(json({ error: 'origin_not_allowed' }, 403), origin, null);
  }
  if (request.method === 'OPTIONS') return handlePreflight(request, origin, allowedOrigins);
  if (request.method !== 'GET') {
    return decorate(json({ error: 'legacy_sync_read_only' }, 405, { allow: 'GET,OPTIONS' }), origin, allowedOrigins);
  }
  const household = getHousehold(request);
  if (!household) return decorate(json({ error: 'bad_household' }, 400), origin, allowedOrigins);
  if (!checkSecret(request, env)) return decorate(json({ error: 'unauthorized' }, 401), origin, allowedOrigins);
  return decorate(json(await readSnapshot(env, household)), origin, allowedOrigins);
}

function handlePreflight(request: Request, origin: string | null, allowedOrigins: Set<string>): Response {
  if (!origin || !allowedOrigins.has(origin)) return decorate(json({ error: 'origin_not_allowed' }, 403), origin, null);
  if (request.headers.get('access-control-request-method')?.toUpperCase() !== 'GET') {
    return decorate(json({ error: 'method_not_allowed' }, 405), origin, allowedOrigins);
  }
  const allowedHeaders = new Set(['accept', 'cache-control', 'content-type', 'pragma', 'x-household', 'x-secret']);
  const requestedHeaders = (request.headers.get('access-control-request-headers') ?? '')
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  if (requestedHeaders.some((header) => !allowedHeaders.has(header))) {
    return decorate(json({ error: 'headers_not_allowed' }, 403), origin, allowedOrigins);
  }
  return decorate(new Response(null, { status: 204 }), origin, allowedOrigins);
}

function decorate(response: Response, origin: string | null, allowedOrigins: Set<string> | null): Response {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  headers.set('pragma', 'no-cache');
  headers.set('vary', appendVary(headers.get('vary'), 'Origin'));
  if (origin && allowedOrigins?.has(origin)) {
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-methods', 'GET,OPTIONS');
    headers.set('access-control-allow-headers', 'accept,cache-control,content-type,pragma,x-household,x-secret');
    headers.set('access-control-max-age', '600');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function parseAllowedOrigins(value: string | undefined): Set<string> {
  const origins = new Set<string>();
  for (const entry of value?.split(',') ?? []) {
    const candidate = entry.trim().replace(/\/$/, '');
    if (!candidate || candidate === '*') continue;
    try {
      const parsed = new URL(candidate);
      const localHttp = parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
      if ((parsed.protocol === 'https:' || localHttp) && parsed.origin === candidate) origins.add(parsed.origin);
    } catch {
      // Invalid entries do not broaden the allowlist.
    }
  }
  return origins;
}

function appendVary(current: string | null, value: string): string {
  const values = new Set((current ?? '').split(',').map((entry) => entry.trim()).filter(Boolean));
  values.add(value);
  return [...values].join(', ');
}
