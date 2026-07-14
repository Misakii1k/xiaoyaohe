import type { Env } from './types';
import { json, text } from './lib/http';
import { handleSync } from './routes/sync';
import { handleSyncV2 } from './routes/sync-v2';

export { SyncV2Household } from './sync-v2/household';
export { SyncV2RateLimiter } from './sync-v2/rate-limiter';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/' || path === '/health') return text('medbox worker ok');

    if (path.startsWith('/api/v2/')) return handleSyncV2(request, env);
    if (path === '/api/sync') return handleSync(request, env);
    if (path === '/api/identify') {
      return json({ error: 'worker_ai_proxy_disabled', message: 'Use a client-configured HTTPS AI provider.' }, 410);
    }
    return json({ error: 'not_found', path }, 404);
  },
};
