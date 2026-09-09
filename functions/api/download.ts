interface Env {
  GITHUB_TOKEN?: string;
}

export const onRequestGet = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const tagParam = url.searchParams.get('tag') || url.searchParams.get('version');
  const repo = 'Misakii1k/xiaoyaohe';
  const token = env.GITHUB_TOKEN;

  if (!token) {
    return new Response(
      JSON.stringify({
        error: 'GITHUB_TOKEN_NOT_CONFIGURED',
        message: '请在 Cloudflare Pages 控制台的「设置 -> 环境变量」中添加 GITHUB_TOKEN，即可开启私有仓库无缝下载。',
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    );
  }

  try {
    const targetReleaseUrl = tagParam
      ? `https://api.github.com/repos/${repo}/releases/tags/${tagParam.startsWith('v') ? tagParam : 'v' + tagParam}`
      : `https://api.github.com/repos/${repo}/releases/latest`;

    const releaseRes = await fetch(targetReleaseUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Xiaoyaohe-Cloudflare-Proxy',
      },
    });

    if (!releaseRes.ok) {
      return new Response(`GitHub API error: ${releaseRes.status} ${releaseRes.statusText}`, {
        status: releaseRes.status,
      });
    }

    const release = (await releaseRes.json()) as {
      assets?: Array<{ id: number; name: string }>;
    };

    const assets = Array.isArray(release.assets) ? release.assets : [];
    const apkAsset = assets.find((a) => a.name && a.name.endsWith('.apk'));

    if (!apkAsset || !apkAsset.id) {
      return new Response('No APK asset found in release', { status: 404 });
    }

    // 请求私有 Release 资产重定向地址（GitHub 返回 302 重定向至带临时预签名的 AWS S3 直链）
    const assetApiUrl = `https://api.github.com/repos/${repo}/releases/assets/${apkAsset.id}`;
    const assetRes = await fetch(assetApiUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/octet-stream',
        'User-Agent': 'Xiaoyaohe-Cloudflare-Proxy',
      },
      redirect: 'manual',
    });

    const redirectLocation = assetRes.headers.get('location');
    if (redirectLocation) {
      return Response.redirect(redirectLocation, 302);
    }

    // 兜底流式回传
    return new Response(assetRes.body, {
      headers: {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Disposition': `attachment; filename="${apkAsset.name}"`,
      },
    });
  } catch (err: any) {
    return new Response(`Proxy error: ${err.message}`, { status: 500 });
  }
};
