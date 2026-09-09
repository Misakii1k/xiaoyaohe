interface Env {
  GITHUB_TOKEN?: string;
}

export const onRequestGet = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const tagParam = url.searchParams.get('tag');
  const repo = 'Misakii1k/xiaoyaohe';
  const token = env.GITHUB_TOKEN;

  if (!token) {
    return new Response(
      JSON.stringify({
        error: 'GITHUB_TOKEN_NOT_CONFIGURED',
        message: '请在 Cloudflare Pages 环境变量中配置 GITHUB_TOKEN',
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    );
  }

  try {
    const targetUrl = tagParam
      ? `https://api.github.com/repos/${repo}/releases/tags/${tagParam.startsWith('v') ? tagParam : 'v' + tagParam}`
      : `https://api.github.com/repos/${repo}/releases/latest`;

    const res = await fetch(targetUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Xiaoyaohe-Cloudflare-Proxy',
      },
    });

    if (!res.ok) {
      return new Response(`GitHub API error: ${res.status}`, { status: res.status });
    }

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (err: any) {
    return new Response(`Proxy error: ${err.message}`, { status: 500 });
  }
};
