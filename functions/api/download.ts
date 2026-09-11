import {
  assetApiUrl,
  errorResponse,
  fetchWithTimeout,
  githubHeaders,
  invalidTagResponse,
  parseReleaseTag,
  pickApkAsset,
  pickBundleAsset,
  releaseApiUrl,
  tokenMissingResponse,
  upstreamFailureResponse,
  type Env,
  type GithubRelease,
} from './_shared';

/**
 * 私有仓库 Release APK 与 Web 增量更新包代理。
 *
 * 通过 Cloudflare 边缘代理直接流式回传私有 Release APK 或增量包。
 * 不走 302 重定向到 release-assets.githubusercontent.com，
 * 避免国内移动端直连 GitHub/Azure 存储时因网络拦截或签名策略导致 403 Forbidden。
 */
export const onRequestGet = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const parsedTag = parseReleaseTag(url.searchParams.get('tag') || url.searchParams.get('version'));
  if (!parsedTag.ok) return invalidTagResponse();

  const token = env.GITHUB_TOKEN;
  if (!token) return tokenMissingResponse();

  try {
    const releaseRes = await fetchWithTimeout(releaseApiUrl(parsedTag.tag), {
      headers: githubHeaders(token, 'application/vnd.github.v3+json'),
    });

    if (!releaseRes.ok) {
      return upstreamFailureResponse(releaseRes.status);
    }

    const release = (await releaseRes.json()) as GithubRelease;
    const isBundle = url.searchParams.get('asset') === 'bundle' || url.searchParams.get('type') === 'bundle';
    const targetAsset = isBundle ? pickBundleAsset(release.assets) : pickApkAsset(release.assets);
    if (!targetAsset || typeof targetAsset.id !== 'number' || typeof targetAsset.name !== 'string') {
      return errorResponse(
        isBundle ? 'BUNDLE_NOT_FOUND' : 'APK_NOT_FOUND',
        isBundle ? '该版本没有可用的增量更新包。' : '该版本没有可用的安装包。',
        404,
      );
    }

    const assetRes = await fetchWithTimeout(
      assetApiUrl(targetAsset.id),
      {
        method: 'GET',
        headers: githubHeaders(token, 'application/octet-stream'),
        redirect: 'follow',
      },
      30_000,
    );

    if (!assetRes.ok || !assetRes.body) {
      return upstreamFailureResponse(assetRes.status);
    }

    const mimeType = isBundle ? 'application/zip' : 'application/vnd.android.package-archive';
    const headers = new Headers({
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${targetAsset.name}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=0, no-store',
    });
    const contentLength = assetRes.headers.get('content-length') || (typeof targetAsset.size === 'number' && targetAsset.size > 0 ? String(targetAsset.size) : null);
    if (contentLength) headers.set('Content-Length', contentLength);

    return new Response(assetRes.body, { headers });
  } catch {
    return upstreamFailureResponse(500);
  }
};
