import {
  errorResponse,
  isOriginAllowed,
  jsonResponse,
  postCorsHeaders,
  type Env,
} from './_shared';

const MOONDREAM_MODEL = '@cf/moondream/moondream3.1-9B-A2B';
const VLM_FALLBACK_MODEL = '@cf/qwen/qwen3.8-27b';
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

function unwrapResultObject(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.result && typeof obj.result === 'object') return obj.result as Record<string, unknown>;
  if (obj.response && typeof obj.response === 'object') return obj.response as Record<string, unknown>;
  return obj;
}

function normalizeCoordPair(x: number, y: number): RawPoint | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return null;
  // Qwen 等 VLM 常输出 [0..1000] 整数坐标；> 1 时按千分比归一化，Moondream 原生 [0..1] 原样保留。
  const nx = x > 1 ? x / 1000 : x;
  const ny = y > 1 ? y / 1000 : y;
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
  return { x: Number(nx.toFixed(4)), y: Number(ny.toFixed(4)) };
}

function deduplicatePoints(points: RawPoint[], minSep = 0.015): RawPoint[] {
  const out: RawPoint[] = [];
  for (const pt of points) {
    if (out.some((kept) => Math.hypot(kept.x - pt.x, kept.y - pt.y) < minSep)) continue;
    out.push(pt);
  }
  return out;
}

function extractPoints(raw: unknown): RawPoint[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  const nested = unwrapResultObject(raw);

  const candidatePoints =
    (Array.isArray(obj.points) ? obj.points : null) ??
    (nested && Array.isArray(nested.points) ? nested.points : null);

  const out: RawPoint[] = [];
  if (candidatePoints) {
    for (const item of candidatePoints) {
      if (Array.isArray(item) && item.length >= 2) {
        const pt = normalizeCoordPair(Number(item[0]), Number(item[1]));
        if (pt) out.push(pt);
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      const p = item as Record<string, unknown>;
      if (typeof p.x === 'number' && typeof p.y === 'number') {
        const pt = normalizeCoordPair(p.x, p.y);
        if (pt) out.push(pt);
      }
    }
  }
  if (out.length > 0) return deduplicatePoints(out);

  const candidateObjects =
    (Array.isArray(obj.objects) ? obj.objects : null) ??
    (nested && Array.isArray(nested.objects) ? nested.objects : null);

  if (candidateObjects) {
    for (const item of candidateObjects) {
      if (!item || typeof item !== 'object') continue;
      const b = item as Record<string, unknown>;
      const xMin = typeof b.x_min === 'number' ? b.x_min : typeof b.xmin === 'number' ? b.xmin : null;
      const yMin = typeof b.y_min === 'number' ? b.y_min : typeof b.ymin === 'number' ? b.ymin : null;
      const xMax = typeof b.x_max === 'number' ? b.x_max : typeof b.xmax === 'number' ? b.xmax : null;
      const yMax = typeof b.y_max === 'number' ? b.y_max : typeof b.ymax === 'number' ? b.ymax : null;
      if (xMin === null || yMin === null || xMax === null || yMax === null) continue;
      const bw = Math.abs(xMax - xMin);
      const bh = Math.abs(yMax - yMin);
      // 过滤整桌/整盒级别的大框，只保留单粒药片。
      const normW = bw > 1 ? bw / 1000 : bw;
      const normH = bh > 1 ? bh / 1000 : bh;
      if (normW > 0.45 || normH > 0.45 || normW < 0.008 || normH < 0.008) continue;
      const pt = normalizeCoordPair((xMin + xMax) / 2, (yMin + yMax) / 2);
      if (pt) out.push(pt);
    }
  }
  return deduplicatePoints(out);
}

function extractPointsFromVlmJson(raw: unknown): RawPoint[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  const choices = Array.isArray(obj.choices) ? obj.choices : null;
  const firstMsg =
    choices && choices[0] && typeof choices[0] === 'object'
      ? ((choices[0] as Record<string, unknown>).message as Record<string, unknown> | undefined)
      : undefined;
  const textCandidates = [
    typeof obj.response === 'string' ? obj.response : '',
    typeof obj.answer === 'string' ? obj.answer : '',
    typeof firstMsg?.content === 'string' ? firstMsg.content : '',
    typeof (unwrapResultObject(raw)?.response) === 'string' ? String(unwrapResultObject(raw)?.response) : '',
  ].filter(Boolean);

  for (const text of textCandidates) {
    const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!jsonMatch) continue;
    try {
      const parsed = JSON.parse(jsonMatch[0]) as unknown;
      if (Array.isArray(parsed)) {
        const pts: RawPoint[] = [];
        for (const item of parsed) {
          if (Array.isArray(item) && item.length >= 2) {
            const pt = normalizeCoordPair(Number(item[0]), Number(item[1]));
            if (pt) pts.push(pt);
          } else if (item && typeof item === 'object') {
            const r = item as Record<string, unknown>;
            if (Array.isArray(r.point_2d) && r.point_2d.length >= 2) {
              const pt = normalizeCoordPair(Number(r.point_2d[0]), Number(r.point_2d[1]));
              if (pt) pts.push(pt);
            } else if (typeof r.x === 'number' && typeof r.y === 'number') {
              const pt = normalizeCoordPair(r.x, r.y);
              if (pt) pts.push(pt);
            }
          }
        }
        if (pts.length > 0) return deduplicatePoints(pts);
      } else if (parsed && typeof parsed === 'object') {
        const pts = extractPoints(parsed);
        if (pts.length > 0) return pts;
      }
    } catch {
      // Malformed JSON fragment — continue scanning
    }
  }
  return [];
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

  const primaryTarget = mode === 'blister' ? 'pill in blister' : 'pill';

  let anyAiSucceeded = false;
  let points: RawPoint[] = [];
  let strategy = 'moondream_point';
  let finishReason: string | undefined;
  let lastRawKeys: string[] = [];

  const recordMeta = (raw: unknown) => {
    anyAiSucceeded = true;
    if (raw && typeof raw === 'object') {
      const rec = raw as Record<string, unknown>;
      lastRawKeys = Object.keys(rec).slice(0, 8);
      if (typeof rec.finish_reason === 'string') finishReason = rec.finish_reason;
    }
  };

  try {
    const pointRes = await env.AI.run(MOONDREAM_MODEL, {
      task: 'point',
      image,
      target: primaryTarget,
      max_objects: 150,
    });
    recordMeta(pointRes);
    points = extractPoints(pointRes);
  } catch {
    // Allow fallback strategies below
  }

  if (points.length === 0 && mode === 'blister') {
    try {
      const retryPointRes = await env.AI.run(MOONDREAM_MODEL, {
        task: 'point',
        image,
        target: 'pill',
        max_objects: 150,
      });
      recordMeta(retryPointRes);
      points = extractPoints(retryPointRes);
      if (points.length > 0) strategy = 'moondream_point_generic';
    } catch {
      // Allow fallback strategies below
    }
  }

  if (points.length === 0) {
    try {
      const detectRes = await env.AI.run(MOONDREAM_MODEL, {
        task: 'detect',
        image,
        target: 'pill',
        max_objects: 150,
      });
      recordMeta(detectRes);
      points = extractPoints(detectRes);
      if (points.length > 0) strategy = 'moondream_detect';
    } catch {
      // Allow VLM fallback below
    }
  }

  if (points.length === 0) {
    try {
      const vlmPrompt =
        mode === 'blister'
          ? 'Locate every filled pill/tablet/capsule inside the blister pack (ignore empty pressed pockets and glare). Reply ONLY valid JSON: {"points":[[x,y],...]} where x and y are integer 0..1000 normalized center coordinates.'
          : 'Locate every individual medicine pill/tablet/capsule on the surface (ignore cast shadows, reflections, wires, and table edges). Reply ONLY valid JSON: {"points":[[x,y],...]} where x and y are integer 0..1000 normalized center coordinates.';
      const vlmRes = await env.AI.run(VLM_FALLBACK_MODEL, {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: image } },
              { type: 'text', text: vlmPrompt },
            ],
          },
        ],
        max_tokens: 768,
        temperature: 0.1,
        chat_template_kwargs: { enable_thinking: false },
      });
      recordMeta(vlmRes);
      points = extractPointsFromVlmJson(vlmRes);
      if (points.length > 0) strategy = 'qwen_vlm_points';
    } catch {
      // Checked via anyAiSucceeded below
    }
  }

  if (!anyAiSucceeded) {
    return errorResponse('UPSTREAM_AI_ERROR', '云端识图服务暂时不可用', 502, cors);
  }

  return jsonResponse(
    {
      ok: true,
      mode,
      engine: 'cloud',
      points,
      meta: {
        strategy,
        rawKeys: lastRawKeys,
        ...(finishReason ? { finishReason } : {}),
      },
    },
    200,
    cors,
  );
}
