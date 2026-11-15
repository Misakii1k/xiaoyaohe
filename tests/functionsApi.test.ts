import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { onRequestGet as releasesGet, onRequestOptions as releasesOptions } from '../functions/api/releases';
import { onRequestGet as downloadGet } from '../functions/api/download';
import { onRequestGet as versionGet } from '../functions/version.json';
import { parseReleaseTag, releaseApiUrl, pickApkAsset } from '../functions/api/_shared';

const TOKEN = 'test-token';
const RELEASE_FIXTURE = {
  tag_name: 'v1.0.0',
  body: '# 1.0.0',
  assets: [
    { id: 1, name: 'xiaoyaohe-1.0.0-unaligned.apk', size: 1, browser_download_url: 'https://github.com/x/unaligned.apk' },
    { id: 2, name: 'xiaoyaohe-1.0.0-android-release.apk', size: 32095374, browser_download_url: 'https://github.com/Misakii1k/xiaoyaohe/releases/download/v1.0.0/xiaoyaohe-1.0.0-android-release.apk' },
    { id: 3, name: 'xiaoyaohe-1.0.0-SHA256SUMS.txt', size: 100, browser_download_url: 'https://github.com/x/SHA256SUMS.txt' },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function request(path: string, origin?: string): Request {
  const headers = origin ? { Origin: origin } : undefined;
  return new Request(`https://xiaoyaohe.pages.dev${path}`, { headers });
}

const originalFetch = globalThis.fetch;

describe('Cloudflare Functions: tag 校验', () => {
  it('接受合法版本号，缺省与空串回落 latest', () => {
    expect(parseReleaseTag(null)).toEqual({ ok: true, tag: null });
    expect(parseReleaseTag('')).toEqual({ ok: true, tag: null });
    expect(parseReleaseTag('v1.0.0')).toEqual({ ok: true, tag: 'v1.0.0' });
    expect(parseReleaseTag('1.0.15')).toEqual({ ok: true, tag: '1.0.15' });
    expect(parseReleaseTag('v1.0.0-beta.1')).toEqual({ ok: true, tag: 'v1.0.0-beta.1' });
  });

  it('拒绝路径穿越与查询注入', () => {
    for (const evil of ['../../../../user', '..%2f..%2fuser', 'x?per_page=1', 'v1.0.0/../../issues', 'v1/../../user', 'v1.0.0#frag', 'latest']) {
      expect(parseReleaseTag(evil), evil).toEqual({ ok: false });
    }
  });

  it('releaseApiUrl 始终落在预期 API 前缀下', () => {
    expect(releaseApiUrl(null)).toBe('https://api.github.com/repos/Misakii1k/xiaoyaohe/releases/latest');
    expect(releaseApiUrl('1.0.0')).toBe('https://api.github.com/repos/Misakii1k/xiaoyaohe/releases/tags/v1.0.0');
    // 只有以 v 开头的 tag 不会被再补一个 v，因此这里用 v 前缀构造真正的穿越
    expect(() => releaseApiUrl('v1/../../user')).toThrow();
    expect(new URL(releaseApiUrl('1.0.0')).pathname).toBe('/repos/Misakii1k/xiaoyaohe/releases/tags/v1.0.0');
  });

  it('APK 资产选择跳过 unaligned', () => {
    expect(pickApkAsset(RELEASE_FIXTURE.assets)?.id).toBe(2);
    expect(pickApkAsset(undefined)).toBeNull();
  });
});

describe('Cloudflare Functions: releases 代理', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => jsonResponse(RELEASE_FIXTURE)) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('非法 tag 返回 400 且不打上游', async () => {
    const res = await releasesGet({ request: request('/api/releases?tag=../../../../user'), env: { GITHUB_TOKEN: TOKEN } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('INVALID_TAG');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('未配置 token 返回 503', async () => {
    const res = await releasesGet({ request: request('/api/releases'), env: {} });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('GITHUB_TOKEN_NOT_CONFIGURED');
  });

  it('把 APK 资产改写成同源代理直链（私有仓库 browser_download_url 对匿名用户必然 404）', async () => {
    const res = await releasesGet({ request: request('/api/releases?tag=v1.0.0'), env: { GITHUB_TOKEN: TOKEN } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assets[1].browser_download_url).toBe('https://xiaoyaohe.pages.dev/api/download?tag=v1.0.0');
    // 非 APK 资产保持原样
    expect(body.assets[2].browser_download_url).toBe('https://github.com/x/SHA256SUMS.txt');
  });

  it('CORS 只对白名单来源回显，且带 Vary', async () => {
    const allowed = await releasesGet({ request: request('/api/releases', 'https://xiaoyaohe.pages.dev'), env: { GITHUB_TOKEN: TOKEN } });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://xiaoyaohe.pages.dev');
    expect(allowed.headers.get('vary')).toBe('Origin');

    const evil = await releasesGet({ request: request('/api/releases', 'https://evil.example'), env: { GITHUB_TOKEN: TOKEN } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('预检对白名单来源返回 204', async () => {
    const res = await releasesOptions({ request: request('/api/releases', 'https://localhost') });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://localhost');
  });

  it('上游失败时脱敏，不回显 GitHub 原文', async () => {
    globalThis.fetch = vi.fn(async () => new Response('Bad credentials for token ghp_secret', { status: 401 })) as unknown as typeof fetch;
    const res = await releasesGet({ request: request('/api/releases'), env: { GITHUB_TOKEN: TOKEN } });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('ghp_secret');
    expect(JSON.parse(text).error).toBe('UPSTREAM_ERROR');
  });

  it('上游 404 保留 404 语义', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    const res = await releasesGet({ request: request('/api/releases?tag=v9.9.9'), env: { GITHUB_TOKEN: TOKEN } });
    expect(res.status).toBe(404);
  });
});

describe('Cloudflare Functions: download 代理', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('非法 tag 返回 400', async () => {
    const res = await downloadGet({ request: request('/api/download?tag=../../../../user'), env: { GITHUB_TOKEN: TOKEN } });
    expect(res.status).toBe(400);
  });

  it('未配置 token 返回 503', async () => {
    const res = await downloadGet({ request: request('/api/download'), env: {} });
    expect(res.status).toBe(503);
  });

  it('无 APK 资产返回 404', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ tag_name: 'v1.0.0', assets: [] })) as unknown as typeof fetch;
    const res = await downloadGet({ request: request('/api/download'), env: { GITHUB_TOKEN: TOKEN } });
    expect(res.status).toBe(404);
  });

  it('流式代理回传 APK，设置正确的 Content-Type 与 Content-Length', async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/assets/')) {
        return new Response(new Uint8Array([0x50, 0x4b]), {
          status: 200,
          headers: {
            'content-type': 'application/vnd.android.package-archive',
            'content-length': '32095374',
          },
        });
      }
      return jsonResponse(RELEASE_FIXTURE);
    }) as unknown as typeof fetch;

    const res = await downloadGet({ request: request('/api/download?tag=v1.0.0'), env: { GITHUB_TOKEN: TOKEN } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.android.package-archive');
    expect(res.headers.get('content-disposition')).toContain('xiaoyaohe-1.0.0-android-release.apk');
    expect(res.headers.get('content-length')).toBe('32095374');
  });

  it('上游 5xx 时脱敏为 502', async () => {
    globalThis.fetch = vi.fn(async () => new Response('upstream boom', { status: 500 })) as unknown as typeof fetch;
    const res = await downloadGet({ request: request('/api/download'), env: { GITHUB_TOKEN: TOKEN } });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('boom');
  });
});

/**
 * /version.json 是客户端更新判定的唯一权威来源，而 Pages Functions 打包
 * 不引 scripts/，只能在 functions 里镜像一份版本映射与底座门槛常量。
 * 这里守住两份常量不漂移——此前 versionCode 兜底写死 48、
 * minNativeVersionCode 写死 44（权威值已是 58），线上下发了错误元数据。
 */
describe('version.json 动态元数据', () => {
  const versionFixture = (tag: string, body: string, assets: unknown[]) => ({
    tag_name: tag,
    body,
    published_at: '2026-09-23T03:09:23Z',
    assets,
  });

  const apkAsset = (version: string, size = 20929065) => ({
    id: 10,
    name: `xiaoyaohe-${version}-android-release.apk`,
    size,
    digest: 'sha256:7a7159407a0146e5089c832313a597c0e75057636350e665fac8bebad555d1e3',
  });

  const bundleAsset = (version: string, size = 8297859) => ({
    id: 11,
    name: `xiaoyaohe-${version}-web-bundle.zip`,
    size,
    digest: 'sha256:f3f7b4a82401cbd0e85d38388da08c772b19a27bb0425414528e0634726f45a6',
  });

  it('镜像的版本映射与 release-utils 权威表一致', async () => {
    const { VERSION_CODE_BY_VERSION, MIN_NATIVE_BUNDLE_VERSION_CODE } = await import(
      '../scripts/lib/release-utils.mjs'
    );
    const source = readFileSync(join(process.cwd(), 'functions', 'version.json.ts'), 'utf8');

    // 底座门槛必须等于权威常量，不能各写一个数字
    expect(source).toContain(`const MIN_NATIVE_BUNDLE_VERSION_CODE = ${MIN_NATIVE_BUNDLE_VERSION_CODE};`);

    // 镜像表里出现的每个版本，其 code 必须与权威表相同
    const mirrored = [...source.matchAll(/'(\d+\.\d+\.\d+)':\s*(\d+),/g)];
    expect(mirrored.length).toBeGreaterThan(0);
    for (const [, version, code] of mirrored) {
      expect(VERSION_CODE_BY_VERSION[version]).toBe(Number(code));
    }

    // 当前发布版本必须已登记进镜像表，否则线上会省略 versionCode
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string };
    expect(source).toContain(`'${pkg.version}': ${VERSION_CODE_BY_VERSION[pkg.version]},`);
  });

  it('按映射表下发正确的 versionCode 与底座门槛', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(
      versionFixture('v1.1.9', '# 小药盒 v1.1.9 更新说明', [apkAsset('1.1.9'), bundleAsset('1.1.9')]),
    )) as unknown as typeof fetch;

    const res = await versionGet({ request: request('/version.json'), env: { GITHUB_TOKEN: TOKEN } });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;

    expect(body.version).toBe('1.1.9');
    expect(body.versionCode).toBe(67);
    // 回归：曾写死 44，会让底座 44~57 的设备被误判为可增量更新
    expect(body.minNativeVersionCode).toBe(58);
    expect(body.fileSize).toBe(20929065);
    expect(body.sha256).toBe('7a7159407a0146e5089c832313a597c0e75057636350e665fac8bebad555d1e3');
    expect(body.bundleSize).toBe(8297859);
    expect(body.downloadUrl).toBe('/api/download?tag=v1.1.9');
  });

  it('发布说明里显式声明的 versionCode 优先于映射表', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(
      versionFixture('v9.9.9', 'versionCode: 123\n\n说明', [apkAsset('9.9.9')]),
    )) as unknown as typeof fetch;

    const res = await versionGet({ request: request('/version.json'), env: { GITHUB_TOKEN: TOKEN } });
    const body = await res.json() as Record<string, unknown>;
    expect(body.versionCode).toBe(123);
  });

  it('正文注释里的 versionCode 被解析，但注释元数据不进入展示用的更新说明', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(
      versionFixture('v9.9.9', '# 小药盒 v9.9.9 更新说明\n\n1. 打卡更顺手。\n\n<!-- versionCode: 124 -->', [apkAsset('9.9.9')]),
    )) as unknown as typeof fetch;

    const res = await versionGet({ request: request('/version.json'), env: { GITHUB_TOKEN: TOKEN } });
    const body = await res.json() as Record<string, unknown>;
    expect(body.versionCode).toBe(124);
    expect(body.releaseNotes).toBe('# 小药盒 v9.9.9 更新说明\n\n1. 打卡更顺手。');
  });

  it('未登记且无法推断时省略 versionCode，而不是编造数字', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(
      versionFixture('v2.5.0', '# 未登记版本', [apkAsset('2.5.0')]),
    )) as unknown as typeof fetch;

    const res = await versionGet({ request: request('/version.json'), env: { GITHUB_TOKEN: TOKEN } });
    const body = await res.json() as Record<string, unknown>;
    expect(body.version).toBe('2.5.0');
    expect(body).not.toHaveProperty('versionCode');
  });

  it('1.0.x 历史线性规律仍可推断', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(
      versionFixture('v1.0.9', '# 1.0.9', [apkAsset('1.0.9')]),
    )) as unknown as typeof fetch;

    const res = await versionGet({ request: request('/version.json'), env: { GITHUB_TOKEN: TOKEN } });
    const body = await res.json() as Record<string, unknown>;
    expect(body.versionCode).toBe(44);
  });

  it('无增量包时不下发 bundle 字段与底座门槛', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(
      versionFixture('v1.1.9', '# 1.1.9', [apkAsset('1.1.9')]),
    )) as unknown as typeof fetch;

    const res = await versionGet({ request: request('/version.json'), env: { GITHUB_TOKEN: TOKEN } });
    const body = await res.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty('bundleUrl');
    expect(body).not.toHaveProperty('minNativeVersionCode');
  });

  it('未配置 token 时返回 503', async () => {
    const res = await versionGet({ request: request('/version.json'), env: {} });
    expect(res.status).toBe(503);
  });
});

describe('Cloudflare Functions: count-pills', () => {
  const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';

  function postReq(
    body: unknown,
    opts: { origin?: string; ip?: string; method?: string } = {},
  ): Request {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opts.origin) headers.Origin = opts.origin;
    if (opts.ip) headers['CF-Connecting-IP'] = opts.ip;
    return new Request('https://xiaoyaohe.pages.dev/api/count-pills', {
      method: opts.method ?? 'POST',
      headers,
      body: opts.method === 'GET' || opts.method === 'OPTIONS' ? undefined : JSON.stringify(body),
    });
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      const mod = await import('../functions/api/count-pills');
      mod.resetCountPillsRateLimiterForTest();
    } catch {
      // Module does not exist during red-phase TDD check
    }
  });

  it('OPTIONS 预检允许 POST 且拒绝非法 Origin 的 POST 请求', async () => {
    const { onRequestOptions, onRequestPost, onRequestGet } = await import('../functions/api/count-pills');

    const optRes = await onRequestOptions({
      request: postReq(null, { origin: 'https://xiaoyaohe.pages.dev', method: 'OPTIONS' }),
    });
    expect(optRes.status).toBe(204);
    expect(optRes.headers.get('access-control-allow-origin')).toBe('https://xiaoyaohe.pages.dev');
    expect(optRes.headers.get('access-control-allow-methods')).toContain('POST');

    const getRes = await onRequestGet({
      request: postReq(null, { origin: 'https://xiaoyaohe.pages.dev', method: 'GET' }),
    });
    expect(getRes.status).toBe(405);

    const evilRes = await onRequestPost({
      request: postReq({ image: TINY_JPEG, mode: 'loose' }, { origin: 'https://evil.example' }),
      env: { AI: { run: vi.fn() } },
    });
    expect(evilRes.status).toBe(403);
    expect(evilRes.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('缺少 env.AI 绑定时返回 503 AI_NOT_BOUND', async () => {
    const { onRequestPost } = await import('../functions/api/count-pills');
    const res = await onRequestPost({
      request: postReq({ image: TINY_JPEG, mode: 'loose' }, { origin: 'https://xiaoyaohe.pages.dev' }),
      env: {},
    });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('AI_NOT_BOUND');
  });

  it('图片体积超过 1.5MB base64 时返回 413 PAYLOAD_TOO_LARGE', async () => {
    const { onRequestPost } = await import('../functions/api/count-pills');
    const oversized = `data:image/jpeg;base64,${'A'.repeat(1_550_000)}`;
    const run = vi.fn();
    const res = await onRequestPost({
      request: postReq({ image: oversized, mode: 'loose' }, { origin: 'https://localhost' }),
      env: { AI: { run } },
    });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('PAYLOAD_TOO_LARGE');
    expect(run).not.toHaveBeenCalled();
  });

  it('loose 与 blister 模式分别传简短 target 调用 Moondream point，并在 empty 时级联 detect 与 VLM fallback', async () => {
    const { onRequestPost } = await import('../functions/api/count-pills');
    const run = vi.fn(async (model: string, input: Record<string, unknown>) => {
      if (model === '@cf/moondream/moondream3.1-9B-A2B' && input.target === 'pill in blister') {
        return { points: [{ x: 0.25, y: 0.5 }] };
      }
      if (model === '@cf/moondream/moondream3.1-9B-A2B' && input.task === 'point') {
        return { points: [{ x: 0.2, y: 0.3 }, { x: 0.7, y: 0.8 }] };
      }
      return { points: [] };
    });

    const looseRes = await onRequestPost({
      request: postReq({ image: TINY_JPEG, mode: 'loose' }, { origin: 'capacitor://localhost', ip: '1.1.1.1' }),
      env: { AI: { run } },
    });
    expect(looseRes.status).toBe(200);
    const looseJson = await looseRes.json();
    expect(looseJson).toMatchObject({
      ok: true,
      mode: 'loose',
      engine: 'cloud',
      points: [{ x: 0.2, y: 0.3 }, { x: 0.7, y: 0.8 }],
    });
    expect(run).toHaveBeenNthCalledWith(
      1,
      '@cf/moondream/moondream3.1-9B-A2B',
      expect.objectContaining({
        task: 'point',
        image: TINY_JPEG,
        target: 'pill',
        max_objects: 150,
      }),
    );

    const blisterRes = await onRequestPost({
      request: postReq({ image: TINY_JPEG, mode: 'blister' }, { origin: 'https://xiaoyaohe.pages.dev', ip: '1.1.1.2' }),
      env: { AI: { run } },
    });
    expect(blisterRes.status).toBe(200);
    const blisterJson = await blisterRes.json();
    expect(blisterJson).toMatchObject({
      ok: true,
      mode: 'blister',
      engine: 'cloud',
      points: [{ x: 0.25, y: 0.5 }],
    });
    expect(run).toHaveBeenNthCalledWith(
      2,
      '@cf/moondream/moondream3.1-9B-A2B',
      expect.objectContaining({
        task: 'point',
        target: 'pill in blister',
      }),
    );

    // 当 point 返回空时自动降级 detect 并解析 objects 框中心，且剔除超大误框
    const detectRun = vi.fn(async (_model: string, input: Record<string, unknown>) => {
      if (input.task === 'detect') {
        return {
          objects: [
            { x_min: 0.1, y_min: 0.2, x_max: 0.2, y_max: 0.3 },
            { x_min: 0.0, y_min: 0.0, x_max: 0.9, y_max: 0.9 },
          ],
        };
      }
      return { points: [] };
    });
    const detectRes = await onRequestPost({
      request: postReq({ image: TINY_JPEG, mode: 'loose' }, { origin: 'https://xiaoyaohe.pages.dev', ip: '1.1.1.3' }),
      env: { AI: { run: detectRun } },
    });
    expect(detectRes.status).toBe(200);
    const detectJson = await detectRes.json();
    expect(detectJson.points).toEqual([{ x: 0.15, y: 0.25 }]);
    expect(detectJson.meta?.strategy).toBe('moondream_detect');

    // 当 Moondream point + detect 都为空时自动使用 Qwen VLM 兜底并解析千分比 JSON 坐标
    const vlmRun = vi.fn(async (model: string) => {
      if (model === '@cf/qwen/qwen3.8-27b') {
        return {
          response: '```json\n{"points": [[250, 500], [750, 250]]}\n```',
        };
      }
      return { points: [] };
    });
    const vlmRes = await onRequestPost({
      request: postReq({ image: TINY_JPEG, mode: 'loose' }, { origin: 'https://xiaoyaohe.pages.dev', ip: '1.1.1.4' }),
      env: { AI: { run: vlmRun } },
    });
    expect(vlmRes.status).toBe(200);
    const vlmJson = await vlmRes.json();
    expect(vlmJson.points).toEqual([
      { x: 0.25, y: 0.5 },
      { x: 0.75, y: 0.25 },
    ]);
    expect(vlmJson.meta?.strategy).toBe('qwen_vlm_points');
  });

  it('同 IP 高频请求触发 429 RATE_LIMITED 限流保护', async () => {
    const { onRequestPost } = await import('../functions/api/count-pills');
    const run = vi.fn(async () => ({ points: [] }));

    let lastStatus = 200;
    let lastCode = '';
    for (let i = 0; i < 20; i++) {
      const res = await onRequestPost({
        request: postReq({ image: TINY_JPEG, mode: 'loose' }, { origin: 'https://localhost', ip: '9.9.9.9' }),
        env: { AI: { run } },
      });
      lastStatus = res.status;
      if (res.status === 429) {
        lastCode = (await res.json()).error;
        break;
      }
    }
    expect(lastStatus).toBe(429);
    expect(lastCode).toBe('RATE_LIMITED');
  });
});
