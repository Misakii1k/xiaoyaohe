// 腾讯云一句话识别（SentenceRecognition）—— App 内嵌直连，无需本地/远端代理。
// 密钥由设置页写入 SecureStorage；本文件只做 TC3 签名与 HTTP 调用。
// API 文档：https://cloud.tencent.com/document/api/1093/35646

const HOST = 'asr.tencentcloudapi.com';
const ACTION = 'SentenceRecognition';
const VERSION = '2019-06-14';
const SERVICE = 'asr';
const REGION_DEFAULT = 'ap-guangzhou';

export interface TencentAsrCredentials {
  secretId: string;
  secretKey: string;
  region?: string;
}

export interface TencentAsrResult {
  text: string;
  requestId?: string;
}

export class TencentAsrError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'TencentAsrError';
  }
}

const REQUEST_TIMEOUT_MS = 30_000;

/** 把 WAV 音频发给腾讯云一句话识别，返回转写文字。 */
export async function recognizeWithTencentCloud(
  wav: ArrayBuffer,
  credentials: TencentAsrCredentials,
  options: { signal?: AbortSignal } = {},
): Promise<TencentAsrResult> {
  const secretId = credentials.secretId.trim();
  const secretKey = credentials.secretKey.trim();
  if (!secretId || !secretKey) {
    throw new TencentAsrError('请先在设置里填写腾讯云 SecretId 和 SecretKey', 'UNCONFIGURED');
  }
  const region = (credentials.region ?? REGION_DEFAULT).trim() || REGION_DEFAULT;
  const audioBase64 = arrayBufferToBase64(wav);
  const payload = JSON.stringify({
    EngSerViceType: '16k_zh',
    SourceType: 1,
    VoiceFormat: 'wav',
    Data: audioBase64,
    DataLen: wav.byteLength,
    ProjectId: 0,
    SubServiceType: 2,
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const authorization = await tc3Authorization({ secretId, secretKey, payload, timestamp });
  const response = await fetch(`https://${HOST}/`, {
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
    signal: combineSignals(options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)),
  });
  const result = await response.json().catch(() => ({})) as {
    Response?: {
      Result?: string;
      RequestId?: string;
      Error?: { Code?: string; Message?: string };
    };
  };
  const cloud = result.Response ?? {};
  if (cloud.Error) {
    throw new TencentAsrError(
      publicTencentMessage(cloud.Error.Code),
      String(cloud.Error.Code ?? 'TENCENT_ERROR'),
      cloud.RequestId,
    );
  }
  return {
    text: String(cloud.Result ?? '').trim(),
    requestId: cloud.RequestId,
  };
}

export function publicTencentMessage(code?: string): string {
  if (/SecretIdNotFound/i.test(code ?? '')) return '腾讯云 SecretId 无效，请检查设置';
  if (/AuthFailure|Signature/i.test(code ?? '')) return '腾讯云鉴权失败，请核对 SecretKey 与手机时间';
  if (/Limit|Quota|RequestLimit/i.test(code ?? '')) return '语音服务额度或频率受限，请稍后再试';
  return '腾讯语音服务暂时不可用';
}

/** TC3-HMAC-SHA256 签名（浏览器 Web Crypto，无 Node 依赖）。 */
export async function tc3Authorization(input: {
  secretId: string;
  secretKey: string;
  payload: string;
  timestamp: number;
}): Promise<string> {
  const { secretId, secretKey, payload, timestamp } = input;
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders =
    `content-type:application/json; charset=utf-8\nhost:${HOST}\nx-tc-action:${ACTION.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const hashedPayload = await sha256Hex(payload);
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, hashedPayload].join('\n');
  const scope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', String(timestamp), scope, await sha256Hex(canonicalRequest)].join('\n');
  const secretDate = await hmac(`TC3${secretKey}`, date);
  const secretService = await hmac(secretDate, SERVICE);
  const secretSigning = await hmac(secretService, 'tc3_request');
  const signature = await hmacHex(secretSigning, stringToSign);
  return `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bufferToHex(digest);
}

async function hmac(key: string | ArrayBuffer, value: string): Promise<ArrayBuffer> {
  const keyBytes = typeof key === 'string' ? new TextEncoder().encode(key) : new Uint8Array(key);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value));
}

async function hmacHex(key: ArrayBuffer, value: string): Promise<string> {
  return bufferToHex(await hmac(key, value));
}

function bufferToHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function combineSignals(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
  if (!a) return b;
  const controller = new AbortController();
  for (const s of [a, b]) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}
