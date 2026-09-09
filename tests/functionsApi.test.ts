import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet as releasesGet, onRequestOptions as releasesOptions } from '../functions/api/releases';
import { onRequestGet as downloadGet } from '../functions/api/download';
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

  it('把 GitHub 的 302 预签名直链原样交给客户端', async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/assets/')) {
        return new Response(null, { status: 302, headers: { location: 'https://objects.githubusercontent.com/signed' } });
      }
      return jsonResponse(RELEASE_FIXTURE);
    }) as unknown as typeof fetch;

    const res = await downloadGet({ request: request('/api/download?tag=v1.0.0'), env: { GITHUB_TOKEN: TOKEN } });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://objects.githubusercontent.com/signed');
  });

  it('拿不到重定向时以 APK 内容类型流式回传', async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/assets/')) return new Response(new Uint8Array([0x50, 0x4b]), { status: 200 });
      return jsonResponse(RELEASE_FIXTURE);
    }) as unknown as typeof fetch;

    const res = await downloadGet({ request: request('/api/download'), env: { GITHUB_TOKEN: TOKEN } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.android.package-archive');
    expect(res.headers.get('content-disposition')).toContain('xiaoyaohe-1.0.0-android-release.apk');
  });

  it('上游 5xx 时脱敏为 502', async () => {
    globalThis.fetch = vi.fn(async () => new Response('upstream boom', { status: 500 })) as unknown as typeof fetch;
    const res = await downloadGet({ request: request('/api/download'), env: { GITHUB_TOKEN: TOKEN } });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('boom');
  });
});
