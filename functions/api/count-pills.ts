import {
  errorResponse,
  isOriginAllowed,
  jsonResponse,
  postCorsHeaders,
  type Env,
} from './_shared';

const MOONDREAM_MODEL = '@cf/moondream/moondream3.1-9B-A2B';
const MAX_IMAGE_DATA_URL_CHARS = 1_500_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 15;

const DATA_URL_RE = /^data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\s]+$/;

type CountMode = 'loose' | 'blister';

interface RawPoint {
  x: number;
  y: number;
}

const ipHits = new Map<string, number[]>();

/** Clear in-memory rate limit buckets during unit tests. */
export function resetCountPillsRateLimiterForTest(): void {
  ipHits.clear();
}

function consumeRateLimit(ip: string, now = Date.now()): boolean {
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const recent = (ipHits.get(ip) ?? []).filter((ts) => ts > cutoff);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    ipHits.set(ip, recent);
    return false;
  }
  recent.push(now);
  ipHits.set(ip, recent);

  if (ipHits.size > 512) {
    for (const [key, timestamps] of ipHits) {
      const last = timestamps[timestamps.length - 1];
      if (last === undefined || last <= cutoff) {
        ipHits.delete(key);
      }
    }
  }
  return true;
}

function extractPoints(raw: unknown): RawPoint[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  const nestedResult = obj.result && typeof obj.result === 'object' ? (obj.result as Record<string, unknown>) : null;
  const nestedResponse =
    obj.response && typeof obj.response === 'object' ? (obj.response as Record<string, unknown>) : null;

  const candidate =
    (Array.isArray(obj.points) ? obj.points : null) ??
    (nestedResult && Array.isArray(nestedResult.points) ? nestedResult.points : null) ??
    (nestedResponse && Array.isArray(nestedResponse.points) ? nestedResponse.points : null) ??
    [];

  const out: RawPoint[] = [];
  for (const item of candidate) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    if (
      typeof p.x === 'number' &&
      typeof p.y === 'number' &&
      Number.isFinite(p.x) &&
      Number.isFinite(p.y) &&
      p.x >= 0 &&
      p.y >= 0
    ) {
      out.push({ x: p.x, y: p.y });
    }
  }
  return out;
}

export async function onRequestOptions(context: { request: Request }): Promise<Response> {
  return new Response(null, { status: 204, headers: postCorsHeaders(context.request) });
}

export async function onRequestGet(context: { request: Request }): Promise<Response> {
  return errorResponse('METHOD_NOT_ALLOWED', '请使用 POST 提交图片', 405, {
    ...postCorsHeaders(context.request),
    Allow: 'POST, OPTIONS',
  });
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;

  if (!isOriginAllowed(request)) {
    return errorResponse('FORBIDDEN_ORIGIN', '非法请求来源', 403);
  }

  const cors = postCorsHeaders(request);

  if (!env.AI || typeof env.AI.run !== 'function') {
    return errorResponse('AI_NOT_BOUND', '云端视觉识别服务尚未启用，已切换本地识别', 503, cors);
  }

  const clientIp =
    request.headers.get('CF-Connecting-IP')?.trim() ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown';

  if (!consumeRateLimit(clientIp)) {
    return errorResponse('RATE_LIMITED', '请求过于频繁，请稍后再试', 429, {
      ...cors,
      'Retry-After': '60',
    });
  }

  const declaredLen = Number(request.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(declaredLen) && declaredLen > MAX_IMAGE_DATA_URL_CHARS + 65_536) {
    return errorResponse('PAYLOAD_TOO_LARGE', '图片体积过大，请压缩后重试', 413, cors);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return errorResponse('INVALID_JSON', '请求格式无效', 400, cors);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return errorResponse('INVALID_JSON', '无法解析请求体', 400, cors);
  }

  const image = body.image;
  if (typeof image !== 'string') {
    return errorResponse('INVALID_IMAGE', '缺少有效图片数据', 400, cors);
  }
  if (image.length > MAX_IMAGE_DATA_URL_CHARS) {
    return errorResponse('PAYLOAD_TOO_LARGE', '图片体积过大，请压缩后重试', 413, cors);
  }
  if (!DATA_URL_RE.test(image)) {
    return errorResponse('INVALID_IMAGE', '仅支持 JPEG/PNG/WebP Base64 图片', 400, cors);
  }

  const rawMode = body.mode;
  let mode: CountMode = 'loose';
  if (rawMode !== undefined) {
    if (rawMode !== 'loose' && rawMode !== 'blister') {
      return errorResponse('INVALID_MODE', '不支持的识别模式', 400, cors);
    }
    mode = rawMode;
  }

  const target =
    mode === 'blister'
      ? 'unopened blister pocket containing a pill or capsule'
      : 'pill, tablet, or capsule';

  try {
    const aiResult = await env.AI.run(MOONDREAM_MODEL, {
      task: 'point',
      image,
      target,
      max_objects: 250,
    });
    const points = extractPoints(aiResult);
    return jsonResponse(
      {
        ok: true,
        mode,
        engine: 'cloud',
        points,
      },
      200,
      cors,
    );
  } catch {
    return errorResponse('UPSTREAM_AI_ERROR', '云端识图服务暂时不可用', 502, cors);
  }
}
