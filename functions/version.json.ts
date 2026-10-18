import {
  corsHeaders,
  errorResponse,
  fetchWithTimeout,
  githubHeaders,
  jsonResponse,
  releaseApiUrl,
  tokenMissingResponse,
  upstreamFailureResponse,
  type Env,
  type GithubRelease,
} from './api/_shared';

export const onRequestOptions = async (context: { request: Request }) => {
  const headers = corsHeaders(context.request);
  if (Object.keys(headers).length === 0) {
    return new Response(null, { status: 204, headers: { 'X-Content-Type-Options': 'nosniff' } });
  }
  return new Response(null, { status: 204, headers: { ...headers, 'X-Content-Type-Options': 'nosniff' } });
};

/**
 * 动态版本元数据端点（GET /version.json）。
 *
 * 优先从 GitHub Releases 读取最新正式发布的 Release 元数据，
 * 动态提取 APK 与 Web Bundle 的真实字节数与 SHA256 校验和，
 * 彻底杜绝 CDN 静态 version.json 与实际分发附件之间的哈希漂移。
 */

/**
 * package.json 版本号 → Android versionCode 映射。
 *
 * 必须与 `scripts/lib/release-utils.mjs` 的 `VERSION_CODE_BY_VERSION` 保持一致
 * （Pages Functions 打包不引 scripts/，只能在此镜像一份；
 * `tests/functionsApi.test.ts` 有一致性断言守住两者不漂移）。
 */
const VERSION_CODE_BY_VERSION: Record<string, number> = {
  '1.0.20': 55,
  '1.0.21': 56,
  '1.0.22': 57,
  '1.1.0': 58,
  '1.1.1': 59,
  '1.1.2': 60,
  '1.1.3': 61,
  '1.1.4': 62,
  '1.1.5': 63,
  '1.1.6': 64,
  '1.1.7': 65,
  '1.1.8': 66,
  '1.1.9': 67, '1.1.10': 68, '1.1.11': 69, '1.1.12': 70, '1.1.13': 71, '1.1.14': 72,
  '1.1.15': 73,
  '1.1.16': 74, '1.1.17': 75, '1.1.18': 76,
  '1.2.0': 77,
  '1.2.1': 78,
};

/**
 * 支持 Web 增量热更新的最低原生底座 versionCode。
 * 与 `scripts/lib/release-utils.mjs` 的 `MIN_NATIVE_BUNDLE_VERSION_CODE` 一致：
 * 低于此值的底座缺少 v1.1.0 起的原生闹钟修复，必须走全量 APK 更新。
 */
const MIN_NATIVE_BUNDLE_VERSION_CODE = 58;

/**
 * 解析 Android versionCode，按可靠性从高到低尝试：
 * 1. 发布说明正文里显式声明的 versionCode；
 * 2. 版本号映射表（发版 SOP 要求新版本必须登记）；
 * 3. `1.0.x` 的历史线性规律（35 + patch）。
 *
 * 全部落空时返回 null——绝不编造数字，让调用方省略该字段，
 * 客户端会退回按版本号字符串比较，而不是拿错误的 code 做判断。
 */
function parseVersionCode(version: string, body?: string): number | null {
  if (body) {
    const m = body.match(/versionCode[:\s]+(\d+)/i);
    const codeStr = m?.[1];
    if (codeStr) return parseInt(codeStr, 10);
  }
  const mapped = VERSION_CODE_BY_VERSION[version];
  if (typeof mapped === 'number') return mapped;
  const match = version.match(/^1\.0\.(\d+)$/);
  const patchStr = match?.[1];
  if (patchStr) {
    return 35 + parseInt(patchStr, 10);
  }
  return null;
}

export const onRequestGet = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;
  const token = env.GITHUB_TOKEN;
  const cors = corsHeaders(request);
  const cacheHeaders = { 'Cache-Control': 'public, max-age=60, s-maxage=300', ...cors };

  if (!token) {
    return tokenMissingResponse();
  }

  try {
    const res = await fetchWithTimeout(releaseApiUrl(null), {
      headers: githubHeaders(token, 'application/vnd.github.v3+json'),
    });

    if (!res.ok) {
      return upstreamFailureResponse(res.status);
    }

    const release = (await res.json()) as GithubRelease;
    const rawTag = typeof release.tag_name === 'string' ? release.tag_name.trim() : '';
    const version = rawTag.startsWith('v') || rawTag.startsWith('V') ? rawTag.slice(1) : rawTag;
    if (!version) {
      return upstreamFailureResponse(502);
    }

    const assets = Array.isArray(release.assets) ? release.assets : [];
    const apkAsset = assets.find((a) => typeof a.name === 'string' && a.name.endsWith('.apk') && !a.name.includes('unaligned'));
    const bundleAsset = assets.find((a) => typeof a.name === 'string' && a.name.endsWith('.zip') && (a.name.includes('bundle') || a.name.includes('web')));

    const apkDigest = typeof (apkAsset as Record<string, unknown> | undefined)?.digest === 'string' ? (apkAsset as Record<string, unknown>).digest as string : undefined;
    const apkSha256 = apkDigest && apkDigest.startsWith('sha256:')
      ? apkDigest.slice(7).toLowerCase()
      : undefined;

    const bundleDigest = typeof (bundleAsset as Record<string, unknown> | undefined)?.digest === 'string' ? (bundleAsset as Record<string, unknown>).digest as string : undefined;
    const bundleSha256 = bundleDigest && bundleDigest.startsWith('sha256:')
      ? bundleDigest.slice(7).toLowerCase()
      : undefined;

    const manifest: Record<string, unknown> = {
      version,
      releaseDate: typeof release.published_at === 'string' ? release.published_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
      downloadUrl: `/api/download?tag=v${encodeURIComponent(version)}`,
    };

    // 解析不出可信的 versionCode 时整个字段省略，客户端退回按版本号字符串比较。
    const versionCode = parseVersionCode(version, typeof release.body === 'string' ? release.body : undefined);
    if (versionCode !== null) {
      manifest.versionCode = versionCode;
    }

    if (apkAsset) {
      if (typeof apkAsset.size === 'number' && apkAsset.size > 0) {
        manifest.fileSize = apkAsset.size;
      }
      if (apkSha256) {
        manifest.sha256 = apkSha256;
      }
    }

    if (bundleAsset) {
      manifest.bundleUrl = `/api/download?tag=v${encodeURIComponent(version)}&asset=bundle`;
      if (typeof bundleAsset.size === 'number' && bundleAsset.size > 0) {
        manifest.bundleSize = bundleAsset.size;
      }
      if (bundleSha256) {
        manifest.bundleSha256 = bundleSha256;
      }
      manifest.minNativeVersionCode = MIN_NATIVE_BUNDLE_VERSION_CODE;
    }

    if (typeof release.body === 'string' && release.body.trim()) {
      // versionCode 已在上面从正文注释里解析过；`<!-- versionCode: 68 -->` 这类元数据不展示给用户
      const notes = release.body.replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').trim();
      if (notes) manifest.releaseNotes = notes;
    }

    return jsonResponse(manifest, 200, cacheHeaders);
  } catch {
    return upstreamFailureResponse(500);
  }
};

export const onRequestPost = async () => errorResponse('METHOD_NOT_ALLOWED', '只支持 GET。', 405, { Allow: 'GET, OPTIONS' });
