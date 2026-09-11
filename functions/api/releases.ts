import {
  corsHeaders,
  errorResponse,
  fetchWithTimeout,
  githubHeaders,
  invalidTagResponse,
  jsonResponse,
  parseReleaseTag,
  releaseApiUrl,
  tokenMissingResponse,
  upstreamFailureResponse,
  type Env,
  type GithubRelease,
} from './_shared';

/**
 * 私有仓库 Release 元数据代理。
 *
 * 客户端只读 `tag_name` / `body` / `assets[]`。这里额外把 APK 资产的
 * `browser_download_url` 改写成同源的 `/api/download?tag=…`：私有仓库的
 * `browser_download_url` 对未登录用户必然 404，改写后客户端无需理解代理细节。
 */
export const onRequestOptions = async (context: { request: Request }) => {
  const headers = corsHeaders(context.request);
  if (Object.keys(headers).length === 0) {
    return new Response(null, { status: 204, headers: { 'X-Content-Type-Options': 'nosniff' } });
  }
  return new Response(null, { status: 204, headers: { ...headers, 'X-Content-Type-Options': 'nosniff' } });
};

export const onRequestGet = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const parsedTag = parseReleaseTag(url.searchParams.get('tag'));
  if (!parsedTag.ok) return invalidTagResponse();

  const token = env.GITHUB_TOKEN;
  if (!token) return tokenMissingResponse();

  const cors = corsHeaders(request);
  const cacheHeaders = { 'Cache-Control': 'public, max-age=60, s-maxage=300', ...cors };

  try {
    const res = await fetchWithTimeout(releaseApiUrl(parsedTag.tag), {
      headers: githubHeaders(token, 'application/vnd.github.v3+json'),
    });

    if (!res.ok) {
      return upstreamFailureResponse(res.status);
    }

    const release = (await res.json()) as GithubRelease;
    const tag = typeof release.tag_name === 'string' ? release.tag_name : parsedTag.tag;
    const downloadProxyUrl = tag ? `${url.origin}/api/download?tag=${encodeURIComponent(tag)}` : '';

    if (downloadProxyUrl && Array.isArray(release.assets)) {
      for (const asset of release.assets) {
        if (typeof asset?.name !== 'string') continue;
        if (asset.name.endsWith('.apk') && !asset.name.includes('unaligned')) {
          asset.browser_download_url = downloadProxyUrl;
        } else if (asset.name.endsWith('.zip') && (asset.name.includes('bundle') || asset.name.includes('web'))) {
          asset.browser_download_url = `${downloadProxyUrl}&asset=bundle`;
        }
      }
    }

    return jsonResponse(release, 200, cacheHeaders);
  } catch {
    return upstreamFailureResponse(500);
  }
};

/** 只允许 GET / OPTIONS。 */
export const onRequestPost = async () => errorResponse('METHOD_NOT_ALLOWED', '只支持 GET。', 405, { Allow: 'GET, OPTIONS' });
