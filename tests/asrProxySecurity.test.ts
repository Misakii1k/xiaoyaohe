// 腾讯云语音代理的两条防线：来源白名单与按来源限流。
//
// 背景：代理只绑 127.0.0.1，但 vite.config.ts 里 dev server 是 `host: true`（监听
// 0.0.0.0）并把 /api 转发过来，所以只要 `npm run dev` 在跑，同局域网的人就能借道
// 打到这个代理上，白嫖腾讯云额度。这里守两件事：白名单未配置时默认不放行跨源、
// 限流按真实客户端分桶而不是所有人共用一个配额。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __rateLimitSizeForTests,
  __resetRateLimitForTests,
  createTencentAsrProxy,
} from '../server/tencent-asr-proxy.mjs';

interface FakeResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  setHeader(key: string, value: string): void;
  end(chunk?: string): void;
}

function fakeRequest(options: {
  origin?: string;
  remoteAddress?: string;
  forwardedFor?: string;
  method?: string;
  url?: string;
}) {
  const headers: Record<string, string> = {};
  if (options.origin) headers.origin = options.origin;
  if (options.forwardedFor) headers['x-forwarded-for'] = options.forwardedFor;
  return {
    headers,
    method: options.method ?? 'POST',
    url: options.url ?? '/api/speech/tencent',
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    // 请求体留空即可：限流发生在读 body 之前，空 body 会走到 400，
    // 与本文件关心的 403 / 429 不会混淆。
    on(event: string, callback: () => void) {
      if (event === 'end') queueMicrotask(callback);
      return this;
    },
  };
}

function fakeResponse(): FakeResponse {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end(chunk) {
      this.body = chunk ?? '';
    },
  };
}

/** 带上假凭证，好让请求能走过 503「未配置」这一关，抵达限流逻辑。 */
function makeHandler(allowedOrigins?: string) {
  return createTencentAsrProxy({
    secretId: 'test-id',
    secretKey: 'test-key',
    ...(allowedOrigins === undefined ? {} : { allowedOrigins }),
    quiet: true,
  });
}

async function call(handler: ReturnType<typeof makeHandler>, options: Parameters<typeof fakeRequest>[0]) {
  const response = fakeResponse();
  await handler(fakeRequest(options), response);
  return response;
}

describe('语音代理的来源白名单', () => {
  beforeEach(() => __resetRateLimitForTests());

  it('未配置白名单时，局域网来源一律拒绝（而不是全部放行）', async () => {
    const handler = makeHandler();
    const response = await call(handler, { origin: 'http://192.168.1.7:5173' });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).code).toBe('ORIGIN_NOT_ALLOWED');
    // 被拒的来源绝不能被回显到 CORS 头里
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('未配置白名单时，本机回环来源仍然放行', async () => {
    const handler = makeHandler();
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:8787']) {
      const response = await call(handler, { origin });
      expect(response.statusCode).not.toBe(403);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
    }
  });

  it('配置了白名单时，只放行名单内的来源', async () => {
    const handler = makeHandler('http://192.168.1.7:5173');

    const allowed = await call(handler, { origin: 'http://192.168.1.7:5173' });
    expect(allowed.statusCode).not.toBe(403);

    const denied = await call(handler, { origin: 'http://192.168.1.9:5173' });
    expect(denied.statusCode).toBe(403);
  });

  it('畸形 Origin 不放行', async () => {
    const handler = makeHandler();
    const response = await call(handler, { origin: 'not-a-url' });
    expect(response.statusCode).toBe(403);
  });
});

describe('语音代理的按来源限流', () => {
  beforeEach(() => {
    __resetRateLimitForTests();
    vi.useFakeTimers();
  });

  afterEach(() => vi.useRealTimers());

  it('经代理转发时按真实客户端分桶，不同客户端不共用配额', async () => {
    const handler = makeHandler();

    // 同一个客户端打满 30 次配额
    for (let i = 0; i < 30; i++) {
      const response = await call(handler, { forwardedFor: '192.168.1.7' });
      expect(response.statusCode).not.toBe(429);
    }
    const exhausted = await call(handler, { forwardedFor: '192.168.1.7' });
    expect(exhausted.statusCode).toBe(429);

    // 另一个客户端不该被连坐——这正是「按 remoteAddress 计数」时的误伤
    const other = await call(handler, { forwardedFor: '192.168.1.9' });
    expect(other.statusCode).not.toBe(429);
  });

  it('只采信可信代理追加的最后一段，客户端伪造的前缀无效', async () => {
    const handler = makeHandler();

    for (let i = 0; i < 30; i++) {
      await call(handler, { forwardedFor: '192.168.1.7' });
    }

    // 客户端自己塞一个伪造地址在前面，真实地址仍被代理追加在最后
    const spoofed = await call(handler, { forwardedFor: '10.0.0.1, 192.168.1.7' });
    expect(spoofed.statusCode).toBe(429);
  });

  it('非回环直连时忽略 X-Forwarded-For，改用 socket 地址', async () => {
    const handler = makeHandler();

    for (let i = 0; i < 30; i++) {
      await call(handler, { remoteAddress: '192.168.1.7', forwardedFor: '10.0.0.1' });
    }
    // 换个伪造的 XFF 也没用，键取的是 socket 地址
    const response = await call(handler, { remoteAddress: '192.168.1.7', forwardedFor: '10.0.0.2' });
    expect(response.statusCode).toBe(429);
  });

  it('窗口过期后释放配额，并把空掉的键删除（否则长跑会缓慢泄漏内存）', async () => {
    const handler = makeHandler();

    await call(handler, { forwardedFor: '192.168.1.7' });
    expect(__rateLimitSizeForTests()).toBe(1);

    vi.setSystemTime(Date.now() + 61 * 60 * 1000);

    const later = await call(handler, { forwardedFor: '192.168.1.9' });
    expect(later.statusCode).not.toBe(429);
    // 过期的 192.168.1.7 必须被删掉，只剩新来的那个
    expect(__rateLimitSizeForTests()).toBe(1);
  });
});
