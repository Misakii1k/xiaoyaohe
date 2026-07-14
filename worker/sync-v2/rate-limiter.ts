import { internalJson } from './body';

interface RateBucket {
  count: number;
  resetsAt: number;
}

interface RateRequest {
  limit: number;
  windowMs: number;
  now: number;
}

export class SyncV2RateLimiter {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/internal/check') {
      return internalJson({ error: 'not_found' }, 404);
    }
    let body: RateRequest;
    try {
      body = (await request.json()) as RateRequest;
    } catch {
      return internalJson({ error: 'bad_json' }, 400);
    }
    if (
      !Number.isSafeInteger(body.limit) ||
      body.limit < 1 ||
      body.limit > 10_000 ||
      !Number.isSafeInteger(body.windowMs) ||
      body.windowMs < 1_000 ||
      body.windowMs > 86_400_000 ||
      !Number.isSafeInteger(body.now) ||
      body.now < 0
    ) {
      return internalJson({ error: 'invalid_rate_limit' }, 400);
    }

    const result = await this.state.storage.transaction(async (transaction) => {
      const current = await transaction.get<RateBucket>('bucket');
      const bucket: RateBucket = !current || current.resetsAt <= body.now
        ? { count: 0, resetsAt: body.now + body.windowMs }
        : current;
      if (bucket.count >= body.limit) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetsAt - body.now) / 1000)) };
      }
      bucket.count += 1;
      await transaction.put('bucket', bucket);
      return {
        allowed: true,
        remaining: body.limit - bucket.count,
        retryAfterSeconds: 0,
      };
    });
    return internalJson(result);
  }
}
