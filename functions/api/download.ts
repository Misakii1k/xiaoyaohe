import {
  assetApiUrl,
  errorResponse,
  fetchWithTimeout,
  githubHeaders,
  invalidTagResponse,
  parseReleaseTag,
  pickApkAsset,
  releaseApiUrl,
  tokenMissingResponse,
  upstreamFailureResponse,
  type Env,
  type GithubRelease,
} from './_shared';

/**
 * 私有仓库 Release APK 代理。
 *
 * GitHub 返回 302 到带临时签名的 S3 直链，这里把该重定向原样交给客户端
 * （原生 `downloadHttp` 会自己跟随多跳重定向），拿不到重定向时再流式回传。
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
    const apkAsset = pickApkAsset(release.assets);
    if (!apkAsset || typeof apkAsset.id !== 'number' || typeof apkAsset.name !== 'string') {
      return errorResponse('APK_NOT_FOUND', '该版本没有可用的安装包。', 404);
    }

    const assetRes = await fetchWithTimeout(assetApiUrl(apkAsset.id), {
      method: 'GET',
      headers: githubHeaders(token, 'application/octet-stream'),
      redirect: 'manual',
    });

    const redirectLocation = assetRes.headers.get('location');
    if (redirectLocation) {
      return Response.redirect(redirectLocation, 302);
    }

    if (!assetRes.ok || !assetRes.body) {
      return upstreamFailureResponse(assetRes.status);
    }

    const headers = new Headers({
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': `attachment; filename="${apkAsset.name}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=0, no-store',
    });
    const contentLength = assetRes.headers.get('content-length');
    if (contentLength) headers.set('Content-Length', contentLength);

    return new Response(assetRes.body, { headers });
  } catch {
    return upstreamFailureResponse(500);
  }
};
