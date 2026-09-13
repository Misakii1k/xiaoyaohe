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
function parseVersionCode(version: string, body?: string): number {
  if (body) {
    const m = body.match(/versionCode[:\s]+(\d+)/i) || body.match(/code[:\s]+(\d+)/i);
    const codeStr = m?.[1];
    if (codeStr) return parseInt(codeStr, 10);
  }
  const match = version.match(/^1\.0\.(\d+)$/);
  const patchStr = match?.[1];
  if (patchStr) {
    return 35 + parseInt(patchStr, 10);
  }
  return 48;
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
      versionCode: parseVersionCode(version, typeof release.body === 'string' ? release.body : undefined),
      releaseDate: typeof release.published_at === 'string' ? release.published_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
      downloadUrl: `/api/download?tag=v${encodeURIComponent(version)}`,
    };

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
      manifest.minNativeVersionCode = 44;
    }

    if (typeof release.body === 'string' && release.body.trim()) {
      manifest.releaseNotes = release.body.trim();
    }

    return jsonResponse(manifest, 200, cacheHeaders);
  } catch {
    return upstreamFailureResponse(500);
  }
};

export const onRequestPost = async () => errorResponse('METHOD_NOT_ALLOWED', '只支持 GET。', 405, { Allow: 'GET, OPTIONS' });
