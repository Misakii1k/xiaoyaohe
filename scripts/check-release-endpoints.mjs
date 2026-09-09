#!/usr/bin/env node
/**
 * 线上发布链路冒烟检查。
 *
 * 起因：1.0.0 的云端更新在线上完全不可用 —— `version.json` 指向私有仓库的 Release
 * 资产（匿名必然 404），而专门为此加的 Cloudflare 代理没配 `GITHUB_TOKEN`（503）。
 * 这两个问题都不在本地测试的覆盖范围内（测试全程 mock fetch），所以补一个能直接
 * 打线上的检查，让发布后一眼看出链路是断的。
 *
 * 用法：
 *   node scripts/check-release-endpoints.mjs
 *   MEDBOX_CLOUD_ORIGIN=http://127.0.0.1:8788 node scripts/check-release-endpoints.mjs
 *
 * 退出码：0 全通；1 有失败项。
 */

const ORIGIN = (process.env.MEDBOX_CLOUD_ORIGIN || 'https://xiaoyaohe.pages.dev').replace(/\/$/, '');
const TIMEOUT_MS = 20_000;

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

async function get(path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${ORIGIN}${path}`, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function checkVersionJson() {
  try {
    const res = await get('/version.json', { cache: 'no-store' });
    if (!res.ok) return record('version.json', false, `HTTP ${res.status}`);
    const manifest = await res.json();
    if (typeof manifest.version !== 'string' || !manifest.version) {
      return record('version.json', false, '缺少 version 字段');
    }
    if (typeof manifest.versionCode !== 'number') {
      return record('version.json', false, '缺少 versionCode 字段');
    }
    const url = typeof manifest.downloadUrl === 'string' ? manifest.downloadUrl : '';
    if (!url) return record('version.json', false, '缺少 downloadUrl 字段');
    // 私有仓库的 release 直链对匿名用户必然 404，必须走同源代理。
    if (/github\.com\/.*\/releases\/download\//.test(url)) {
      return record('version.json', false, `downloadUrl 仍指向私有仓库直链：${url}`);
    }
    if (!url.startsWith('/api/download') && !url.startsWith(ORIGIN)) {
      return record('version.json', false, `downloadUrl 不是同源代理地址：${url}`);
    }
    const size = typeof manifest.fileSize === 'number' ? `${manifest.fileSize} bytes` : '未声明（跳过大小校验）';
    record('version.json', true, `v${manifest.version} (code ${manifest.versionCode}), ${size}`);
    return manifest;
  } catch (error) {
    return record('version.json', false, error.message);
  }
}

async function checkReleases() {
  try {
    const res = await get('/api/releases', { headers: { Accept: 'application/vnd.github.v3+json' } });
    if (res.status === 503) {
      const body = await res.text();
      return record('/api/releases', false,
        `503 —— 代理未配置。请在 Cloudflare Pages 项目设置里添加 GITHUB_TOKEN。响应：${body.slice(0, 120)}`);
    }
    if (!res.ok) return record('/api/releases', false, `HTTP ${res.status}`);
    const release = await res.json();
    if (typeof release.tag_name !== 'string') {
      return record('/api/releases', false, '响应缺少 tag_name');
    }
    const apk = Array.isArray(release.assets)
      ? release.assets.find((a) => typeof a?.name === 'string' && a.name.endsWith('.apk') && !a.name.includes('unaligned'))
      : undefined;
    if (!apk) return record('/api/releases', false, `${release.tag_name} 没有可用 APK 资产`);
    if (typeof apk.browser_download_url !== 'string' || !apk.browser_download_url.startsWith(ORIGIN)) {
      return record('/api/releases', false, `APK 资产直链未被改写成同源代理：${apk.browser_download_url}`);
    }
    record('/api/releases', true, `${release.tag_name}, ${apk.name}, ${apk.size} bytes`);
    return release;
  } catch (error) {
    return record('/api/releases', false, error.message);
  }
}

async function checkInvalidTag() {
  try {
    const res = await get('/api/releases?tag=../../../../user');
    record('非法 tag 被拒', res.status === 400, `HTTP ${res.status}（期望 400）`);
  } catch (error) {
    record('非法 tag 被拒', false, error.message);
  }
}

async function checkDownload(manifest) {
  if (!manifest?.version) return;
  const tag = `v${manifest.version}`;
  try {
    const res = await get(`/api/download?tag=${encodeURIComponent(tag)}`, { redirect: 'manual' });
    if (res.status === 503) {
      return record('/api/download', false, '503 —— 代理未配置 GITHUB_TOKEN');
    }
    if (res.status === 302 || res.status === 307) {
      const location = res.headers.get('location') || '';
      await res.body?.cancel().catch(() => undefined);
      const host = location ? new URL(location).host : '(缺失)';
      return record('/api/download', Boolean(location), `HTTP ${res.status} -> ${host}`);
    }
    const contentType = res.headers.get('content-type') || '';
    await res.body?.cancel().catch(() => undefined);
    const ok = res.ok && contentType.includes('android.package-archive');
    record('/api/download', ok, `HTTP ${res.status}, content-type ${contentType || '(无)'}`);
  } catch (error) {
    record('/api/download', false, error.message);
  }
}

console.log(`发布链路冒烟检查：${ORIGIN}\n`);
const manifest = await checkVersionJson();
await checkReleases();
await checkInvalidTag();
await checkDownload(manifest);

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  console.log('未通过项：');
  for (const entry of failed) console.log(`  - ${entry.name}: ${entry.detail}`);
  process.exitCode = 1;
}
