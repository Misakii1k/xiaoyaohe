import { createHmac, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const HOST = 'asr.tencentcloudapi.com';
const ACTION = 'SentenceRecognition';
const VERSION = '2019-06-14';
const SERVICE = 'asr';
const MAX_BODY_BYTES = 4_300_000;
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT = 30;
/** 限流表最多跟踪多少个来源；超出后先清理，仍超出则拒绝，避免表无限膨胀。 */
const MAX_TRACKED_ADDRESSES = 5_000;
const requestsByAddress = new Map();

export function createTencentAsrProxy(options = {}) {
  const secretId = options.secretId ?? process.env.TENCENT_SECRET_ID ?? '';
  const secretKey = options.secretKey ?? process.env.TENCENT_SECRET_KEY ?? '';
  const region = options.region ?? process.env.TENCENT_REGION ?? 'ap-guangzhou';
  const allowedOrigins = new Set(
    (options.allowedOrigins ?? process.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (allowedOrigins.size === 0 && options.quiet !== true) {
    console.error(
      '[asr-proxy] 未配置 ALLOWED_ORIGINS，默认只放行本机回环来源（localhost / 127.0.0.1）。\n'
      + '            若要用手机经局域网访问 dev 站点，请显式配置，例如：\n'
      + '            ALLOWED_ORIGINS=http://192.168.1.7:5173',
    );
  }

  return async function handle(request, response) {
    const origin = request.headers.origin ?? '';
    // 白名单未配置时默认只认本机回环，而不是「全部放行」。
    // 注意 CORS 只约束浏览器，挡不住 curl 直连；真正限制滥用的是下面的按来源限流。
    if (origin && !isOriginAllowed(origin, allowedOrigins)) {
      return send(response, 403, {
        code: 'ORIGIN_NOT_ALLOWED',
        message: '请求来源未获允许（如需从局域网访问，请在服务端配置 ALLOWED_ORIGINS）',
      });
    }
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'OPTIONS') return send(response, 204);
    if (request.method !== 'POST' || request.url !== '/api/speech/tencent') {
      return send(response, 404, { code: 'NOT_FOUND', message: '接口不存在' });
    }
    if (!secretId || !secretKey) {
      return send(response, 503, { code: 'PROXY_NOT_CONFIGURED', message: '语音代理尚未配置' });
    }
    if (!consumeRateLimit(clientKey(request))) {
      return send(response, 429, { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' });
    }

    try {
      const input = JSON.parse(await readBody(request));
      if (input?.format !== 'wav' || typeof input.audioBase64 !== 'string') {
        return send(response, 400, { code: 'INVALID_AUDIO', message: '只接受 WAV 音频' });
      }
      const audio = Buffer.from(input.audioBase64, 'base64');
      if (!isValidWav(audio) || audio.length > MAX_AUDIO_BYTES || wavDurationSeconds(audio) > 60.5) {
        return send(response, 413, { code: 'AUDIO_LIMIT', message: '音频必须为 60 秒以内的 WAV' });
      }
      const payload = JSON.stringify({
        EngSerViceType: '16k_zh',
        SourceType: 1,
        VoiceFormat: 'wav',
        Data: audio.toString('base64'),
        DataLen: audio.length,
        ProjectId: 0,
        SubServiceType: 2,
      });
      const timestamp = Math.floor(Date.now() / 1000);
      const authorization = tc3Authorization({ secretId, secretKey, payload, timestamp });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      let upstream;
      try {
        upstream = await fetch(`https://${HOST}/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            Host: HOST,
            'X-TC-Action': ACTION,
            'X-TC-Version': VERSION,
            'X-TC-Timestamp': String(timestamp),
            'X-TC-Region': region,
            Authorization: authorization,
          },
          body: payload,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      const result = await upstream.json().catch(() => ({}));
      const cloud = result?.Response ?? {};
      if (cloud.Error) {
        const status = /RequestLimit|LimitExceeded/i.test(cloud.Error.Code) ? 429 : 502;
        return send(response, status, {
          code: String(cloud.Error.Code ?? 'TENCENT_ERROR'),
          message: publicTencentMessage(cloud.Error.Code),
          requestId: cloud.RequestId,
        });
      }
      return send(response, 200, {
        text: String(cloud.Result ?? '').trim(),
        requestId: cloud.RequestId,
      });
    } catch (error) {
      if (error?.code === 'BODY_TOO_LARGE') {
        return send(response, 413, { code: 'BODY_TOO_LARGE', message: '请求内容过大' });
      }
      if (error?.name === 'AbortError') {
        return send(response, 504, { code: 'UPSTREAM_TIMEOUT', message: '语音服务响应超时' });
      }
      return send(response, 400, { code: 'INVALID_REQUEST', message: '无法读取语音请求' });
    }
  };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    request.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        const error = new Error('Body too large');
        error.code = 'BODY_TOO_LARGE';
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });
}

function isValidWav(audio) {
  return audio.length >= 44 && audio.toString('ascii', 0, 4) === 'RIFF' && audio.toString('ascii', 8, 12) === 'WAVE';
}

function wavDurationSeconds(audio) {
  const byteRate = audio.readUInt32LE(28);
  const dataBytes = audio.readUInt32LE(40);
  return byteRate > 0 ? dataBytes / byteRate : Number.POSITIVE_INFINITY;
}

/** 白名单未配置时退回「只认本机回环」，而不是放行一切。 */
function isOriginAllowed(origin, allowedOrigins) {
  if (allowedOrigins.size > 0) return allowedOrigins.has(origin);
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  } catch {
    return false; // 畸形 Origin 一律不放行
  }
}

function isLoopbackAddress(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/**
 * 限流用的来源标识。
 *
 * 这台代理只绑 127.0.0.1，所以 remoteAddress 恒为回环地址——直接拿它当键，
 * 会让所有经 Vite dev proxy 转发的用户共用同一个配额：既隔离不了滥用者，
 * 又会误伤正常用户。因此仅在直连来自回环时才采信 X-Forwarded-For
 * （由 vite.config.ts 的 `xfwd: true` 写入）。
 *
 * 取链条的**最后一段**：那是可信代理亲手追加的对端地址；前面的段都可能是
 * 客户端自己伪造塞进来的，不能用来当配额键。
 */
function clientKey(request) {
  const socketAddress = request.socket?.remoteAddress ?? 'unknown';
  if (!isLoopbackAddress(socketAddress)) return socketAddress;
  const forwarded = request.headers['x-forwarded-for'];
  if (!forwarded) return socketAddress;
  const chain = String(forwarded).split(',').map((value) => value.trim()).filter(Boolean);
  return chain.at(-1) ?? socketAddress;
}

function consumeRateLimit(address) {
  const now = Date.now();
  pruneRateLimit(now);
  if (!requestsByAddress.has(address) && requestsByAddress.size >= MAX_TRACKED_ADDRESSES) {
    return false; // 跟踪表已满，宁可拒绝也不让它无限增长
  }
  const recent = (requestsByAddress.get(address) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    requestsByAddress.set(address, recent);
    return false;
  }
  recent.push(now);
  requestsByAddress.set(address, recent);
  return true;
}

/** 清掉过期时间戳；某个来源全过期就把键一并删掉，否则长跑会缓慢泄漏内存。 */
function pruneRateLimit(now) {
  for (const [address, timestamps] of requestsByAddress) {
    const recent = timestamps.filter((at) => now - at < RATE_WINDOW_MS);
    if (recent.length === 0) requestsByAddress.delete(address);
    else requestsByAddress.set(address, recent);
  }
}

/** 仅供测试：重置限流表。 */
export function __resetRateLimitForTests() {
  requestsByAddress.clear();
}

/** 仅供测试：当前跟踪的来源数量，用于验证过期键确实被删掉。 */
export function __rateLimitSizeForTests() {
  return requestsByAddress.size;
}

function tc3Authorization({ secretId, secretKey, payload, timestamp }) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${HOST}\nx-tc-action:${ACTION.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256(payload)].join('\n');
  const scope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', timestamp, scope, sha256(canonicalRequest)].join('\n');
  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, SERVICE);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = createHmac('sha256', secretSigning).update(stringToSign).digest('hex');
  return `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function hmac(key, value) { return createHmac('sha256', key).update(value).digest(); }

function publicTencentMessage(code) {
  if (/SecretIdNotFound/i.test(code ?? '')) return '服务端语音凭证无效';
  if (/AuthFailure|Signature/i.test(code ?? '')) return '服务端语音鉴权失败';
  if (/Limit|Quota|RequestLimit/i.test(code ?? '')) return '语音服务额度或频率受限';
  return '腾讯语音服务暂时不可用';
}

function send(response, status, data) {
  response.statusCode = status;
  if (status === 204) return response.end();
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(data ?? {}));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT ?? 8787);
  createServer(createTencentAsrProxy()).listen(port, '127.0.0.1', () => {
    console.error(`Tencent ASR proxy listening on http://127.0.0.1:${port}`);
  });
}
