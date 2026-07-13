// HTTP 小工具：JSON 响应、CORS、household/secret 校验。
import type { Env } from '../types';

export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,PUT,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-household,x-secret',
  'access-control-max-age': '86400',
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
  });
}

export function text(body: string, status = 200, contentType = 'text/plain; charset=utf-8'): Response {
  return new Response(body, { status, headers: { 'content-type': contentType, ...CORS } });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

/** 取 household（必填，仅允许 base36，防注入键名） */
export function getHousehold(req: Request): string | null {
  const h = req.headers.get('x-household') || new URL(req.url).searchParams.get('household') || '';
  if (!h || !/^[a-z0-9]{6,64}$/.test(h)) return null;
  return h;
}

/** 校验共享密钥；若 Worker 未设 SYNC_SECRET 则跳过校验（便于本地起步） */
export function checkSecret(req: Request, env: Env): boolean {
  if (!env.SYNC_SECRET) return true;
  const s = req.headers.get('x-secret') || new URL(req.url).searchParams.get('secret') || '';
  return s === env.SYNC_SECRET;
}
