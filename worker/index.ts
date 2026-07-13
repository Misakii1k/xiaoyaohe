// Cloudflare Worker 入口：HTTP 路由。
// M2: /api/sync 云同步；M3 强提醒走前端 SW（不在 Worker 跑 cron）；M4: /api/identify 视觉识药。
import type { Env } from './types';
import { preflight, text, json } from './lib/http';
import { handleSync } from './routes/sync';
import { handleIdentify } from './routes/identify';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return preflight();

    const url = new URL(req.url);
    const path = url.pathname;

    if (path === '/' || path === '/health') {
      return text('medbox worker ok');
    }

    if (path === '/api/sync') return handleSync(req, env);
    if (path === '/api/identify') return handleIdentify(req, env);

    return json({ error: 'not found', path }, 404);
  },
};
