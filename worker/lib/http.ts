import type { Env } from '../types';

export function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(JSON.stringify(data), { status, headers });
}

export function text(body: string, status = 200, contentType = 'text/plain; charset=utf-8'): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': contentType, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

export function getHousehold(request: Request): string | null {
  const household = request.headers.get('x-household') ?? '';
  return /^[a-z0-9]{6,64}$/.test(household) ? household : null;
}

export function checkSecret(request: Request, env: Env): boolean {
  if (!env.SYNC_SECRET) return false;
  const supplied = request.headers.get('x-secret') ?? '';
  return constantTimeEqual(supplied, env.SYNC_SECRET);
}

function constantTimeEqual(left: string, right: string): boolean {
  const max = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < max; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}
