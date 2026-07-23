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

  return async function handle(request, response) {
    const origin = request.headers.origin ?? '';
    if (origin && allowedOrigins.size > 0 && !allowedOrigins.has(origin)) {
      return send(response, 403, { code: 'ORIGIN_NOT_ALLOWED', message: '请求来源未获允许' });
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
    if (!consumeRateLimit(request.socket.remoteAddress ?? 'unknown')) {
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

function consumeRateLimit(address) {
  const now = Date.now();
  const recent = (requestsByAddress.get(address) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  requestsByAddress.set(address, recent);
  return true;
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
