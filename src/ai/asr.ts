// 说话录药的腾讯云实时语音识别（WebSocket 直连）：国产安卓浏览器/WebView 自带识别常不可用，配置后走这里。
// 签名放在 URL query（HmacSHA1），不受 CORS 限制；SecretKey 由 SecretStore 槽位保管，不落 localStorage。
// 协议：wss://asr.cloud.tencent.com/asr/v2/{appid}，发 16k/16bit 单声道 PCM，收 JSON 分片结果。
import { ASR_SECRET_KEY, clearSessionSecret, getSessionSecret, setSessionSecret } from './secretStore';
import { requireAiConsent } from './consent';

const LS_KEY = 'medbox.asrConfig.v1';
const ASR_HOST = 'asr.cloud.tencent.com';
/** 外发授权按这个 origin 记录（音频只发往腾讯云 ASR） */
export const ASR_CONSENT_URL = 'https://asr.cloud.tencent.com';

// Web Speech API 没有进标准 lib.dom，类型自己描一份够用的；腾讯识别器实现同一接口，UI 层无感切换
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

export interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript?: string }> & { isFinal?: boolean }>;
}

export interface AsrConfig {
  /** 腾讯云 APPID（纯数字） */
  appId: string;
  /** API 密钥的 SecretId（随 URL 明文外发，非高敏） */
  secretId: string;
  /** API 密钥的 SecretKey（只用于本地签名，不外发；存 SecretStore） */
  secretKey: string;
}

export function getAsrConfig(): AsrConfig {
  const secretKey = getSessionSecret(ASR_SECRET_KEY);
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { appId: '', secretId: '', secretKey };
    const parsed = JSON.parse(raw) as Partial<AsrConfig>;
    return {
      appId: typeof parsed.appId === 'string' ? parsed.appId.trim() : '',
      secretId: typeof parsed.secretId === 'string' ? parsed.secretId.trim() : '',
      secretKey,
    };
  } catch {
    return { appId: '', secretId: '', secretKey };
  }
}

export async function setAsrConfig(cfg: AsrConfig): Promise<void> {
  localStorage.setItem(LS_KEY, JSON.stringify({ appId: cfg.appId.trim(), secretId: cfg.secretId.trim() }));
  await setSessionSecret(cfg.secretKey, ASR_SECRET_KEY);
}

export async function resetAsrConfig(): Promise<void> {
  localStorage.removeItem(LS_KEY);
  await clearSessionSecret(ASR_SECRET_KEY);
}

/** 三项都填了才启用；说话录药据此决定用腾讯识别还是浏览器自带识别 */
export function isAsrConfigured(): boolean {
  const cfg = getAsrConfig();
  return cfg.appId.length > 0 && cfg.secretId.length > 0 && cfg.secretKey.length > 0;
}

// —— 签名与消息解析（纯函数，单测覆盖） ——

export interface AsrUrlSeed {
  /** 本次识别的唯一标识（16 位随机串） */
  voiceId: string;
  /** Unix 秒 */
  timestamp: number;
  nonce: number;
}

/**
 * 拼实时识别的 WebSocket URL。
 * 签名原文 = `asr.cloud.tencent.com/asr/v2/{appid}?{按 key 字典序的参数串}`（无协议头），
 * Base64(HmacSHA1(原文, SecretKey)) 再 urlencode 后拼为 &signature=。
 */
export async function buildAsrWsUrl(
  cfg: Pick<AsrConfig, 'appId' | 'secretId' | 'secretKey'>,
  seed: AsrUrlSeed,
): Promise<string> {
  const params: Record<string, string> = {
    engine_model_type: '16k_zh',
    expired: String(seed.timestamp + 3600),
    needvad: '1',
    nonce: String(seed.nonce),
    secretid: cfg.secretId,
    timestamp: String(seed.timestamp),
    voice_format: '1',
    voice_id: seed.voiceId,
  };
  const query = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  const path = `${ASR_HOST}/asr/v2/${cfg.appId}?${query}`;
  const signature = await hmacSha1Base64(cfg.secretKey, path);
  return `wss://${path}&signature=${encodeURIComponent(signature)}`;
}

async function hmacSha1Base64(secret: string, text: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(text));
  let binary = '';
  for (const byte of new Uint8Array(mac)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export interface AsrParsedMessage {
  code: number;
  message: string;
  /** final=1：服务端识别完了，随后会断开 */
  final: boolean;
  /** 0 一段开始 / 1 一段还在变（文本是这段迄今全文） / 2 这段定稿 */
  sliceType: 0 | 1 | 2 | null;
  text: string;
}

/** 解析服务端 JSON 文本帧；二进制帧或坏 JSON 返回 null */
export function parseAsrMessage(raw: unknown): AsrParsedMessage | null {
  if (typeof raw !== 'string') return null;
  try {
    const data = JSON.parse(raw) as {
      code?: unknown;
      message?: unknown;
      final?: unknown;
      result?: { slice_type?: unknown; voice_text_str?: unknown } | null;
    };
    if (!data || typeof data !== 'object' || typeof data.code !== 'number') return null;
    const slice = data.result?.slice_type;
    return {
      code: data.code,
      message: typeof data.message === 'string' ? data.message : '',
      final: data.final === 1,
      sliceType: slice === 0 || slice === 1 || slice === 2 ? slice : null,
      text: typeof data.result?.voice_text_str === 'string' ? data.result.voice_text_str : '',
    };
  } catch {
    return null;
  }
}

/** 麦克风 Float32 采样 → 16kHz 16bit 单声道 PCM（线性插值降采样）；采样率不高于 16k 时逐样本直转 */
export function downsampleToPcm16k(input: Float32Array, inputRate: number): Int16Array {
  if (inputRate <= 0 || input.length === 0) return new Int16Array(0);
  const ratio = inputRate / 16000;
  const length = ratio <= 1 ? input.length : Math.floor(input.length / ratio);
  const out = new Int16Array(length);
  for (let i = 0; i < length; i += 1) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, input.length - 1);
    const frac = pos - left;
    const sample = (input[left] ?? 0) * (1 - frac) + (input[right] ?? 0) * frac;
    const clamped = Math.max(-1, Math.min(1, sample));
    out[i] = Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
  }
  return out;
}

// —— 识别器适配器：对 UI 表现得像一个 SpeechRecognition ——

const STOP_FINAL_WAIT_MS = 2000;

/**
 * 腾讯云实时识别器。start() 里依次：外发授权 → 开话筒 → 建 WebSocket；
 * 中间结果走 onresult(isFinal:false)（覆盖式预览），每段定稿走 onresult(isFinal:true)；
 * stop() 发 {"type":"end"} 等服务端吐完最后一段，2 秒兜底强关。
 */
export function createTencentAsrRecognizer(): SpeechRecognitionLike {
  let active = false;
  let stopping = false;
  let ready = false;
  let ended = true;
  let ws: WebSocket | null = null;
  let stream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let stopTimer: number | null = null;

  const recognizer: SpeechRecognitionLike = {
    lang: 'zh-CN',
    continuous: true,
    interimResults: true,
    onresult: null,
    onerror: null,
    onend: null,
    start() {
      if (active) throw new Error('识别已经在进行中');
      active = true;
      stopping = false;
      ready = false;
      ended = false;
      void begin();
    },
    stop() {
      requestStop();
    },
    abort() {
      teardown();
    },
  };

  function emitResult(text: string, isFinal: boolean): void {
    if (!text) return;
    recognizer.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: text }], { isFinal })],
    });
  }

  function fail(error: string): void {
    recognizer.onerror?.({ error });
    teardown();
  }

  function stopAudioCapture(): void {
    if (processor) {
      processor.onaudioprocess = null;
      try { processor.disconnect(); } catch { /* 已断开 */ }
      processor = null;
    }
    if (sourceNode) {
      try { sourceNode.disconnect(); } catch { /* 已断开 */ }
      sourceNode = null;
    }
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    if (audioContext) {
      const context = audioContext;
      audioContext = null;
      if (context.state !== 'closed') void context.close().catch(() => { /* 关不掉也无妨 */ });
    }
  }

  function teardown(): void {
    if (stopTimer !== null) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }
    stopAudioCapture();
    if (ws) {
      const socket = ws;
      ws = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try { socket.close(); } catch { /* 已关 */ }
    }
    active = false;
    stopping = false;
    ready = false;
    if (!ended) {
      ended = true;
      recognizer.onend?.();
    }
  }

  function requestStop(): void {
    if (!active) return;
    // 用户点了停：立刻放开话筒；连接还活着就等服务端把最后一段吐完
    stopAudioCapture();
    if (!ws || ws.readyState !== WebSocket.OPEN || !ready) {
      teardown();
      return;
    }
    if (stopping) return;
    stopping = true;
    try {
      ws.send('{"type":"end"}');
    } catch {
      teardown();
      return;
    }
    stopTimer = window.setTimeout(() => teardown(), STOP_FINAL_WAIT_MS);
  }

  function handleMessage(raw: unknown): void {
    if (!active) return;
    const msg = parseAsrMessage(raw);
    if (!msg) return;
    if (msg.code !== 0) {
      if (msg.code === 4008) fail('no-speech'); // 半天没声音被服务端挂断，静默收场
      else if (msg.code === 4002) fail('auth-failed'); // 签名不对：密钥错了，或手机时间偏差超 5 分钟
      else fail('network');
      return;
    }
    if (!ready) ready = true; // 首条 code:0 是握手确认，之后才能发音频
    if (msg.text) emitResult(msg.text, msg.sliceType === 2);
    if (msg.final) teardown();
  }

  async function begin(): Promise<void> {
    try {
      await requireAiConsent('voice-medication', ASR_CONSENT_URL);
    } catch {
      fail('aborted'); // 用户没同意外发，静默收场
      return;
    }
    if (!active) return;
    const cfg = getAsrConfig();
    if (!cfg.appId || !cfg.secretId || !cfg.secretKey) {
      fail('auth-failed');
      return;
    }
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      fail(name === 'NotAllowedError' || name === 'SecurityError' ? 'not-allowed' : 'audio-capture');
      return;
    }
    if (!active) {
      for (const track of media.getTracks()) track.stop();
      return;
    }
    stream = media;

    let url: string;
    try {
      url = await buildAsrWsUrl(cfg, {
        voiceId: randomVoiceId(),
        timestamp: Math.floor(Date.now() / 1000),
        nonce: Math.floor(Math.random() * 1e9) + 1,
      });
    } catch {
      fail('network');
      return;
    }
    if (!active) return;

    const socket = new WebSocket(url);
    ws = socket;
    socket.onmessage = (event) => {
      if (socket === ws) handleMessage(event.data);
    };
    socket.onerror = () => {
      if (socket === ws && active) fail('network');
    };
    socket.onclose = () => {
      if (socket !== ws || !active) return;
      if (stopping) teardown(); // 等 final 时被断开：结果已尽力，静默结束
      else fail('network');
    };

    try {
      const context = new AudioContext();
      audioContext = context;
      if (context.state === 'suspended') void context.resume().catch(() => { /* 点按手势内一般无需 */ });
      sourceNode = context.createMediaStreamSource(media);
      // ScriptProcessor 虽已 deprecated 但覆盖面最好；4096 帧 @48k ≈ 85ms，重采样后约 2.7KB/帧
      processor = context.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => {
        if (!ready || stopping || !ws || ws.readyState !== WebSocket.OPEN) return;
        const pcm = downsampleToPcm16k(event.inputBuffer.getChannelData(0), context.sampleRate);
        if (pcm.length === 0) return;
        try {
          ws.send(pcm.buffer);
        } catch { /* 这帧丢了，下帧再发 */ }
      };
      sourceNode.connect(processor);
      processor.connect(context.destination); // 不接 destination 部分浏览器不触发回调；输出为静音
    } catch {
      fail('audio-capture');
    }
  }

  return recognizer;
}

function randomVoiceId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  } catch {
    return (Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)).padEnd(16, '0').slice(0, 16);
  }
}

// —— 一句话识别（≤60s，按住说话用）：腾讯云 API 3.0 SentenceRecognition ——
// 文档：https://cloud.tencent.com/document/product/1093/35646
// 走 HTTPS + TC3 签名；Android 开启 CapacitorHttp 后可绕过 WebView CORS。

const SENTENCE_HOST = 'asr.tencentcloudapi.com';
const SENTENCE_SERVICE = 'asr';
const SENTENCE_ACTION = 'SentenceRecognition';
const SENTENCE_VERSION = '2019-06-14';
/** 外发授权按这个 origin 记录 */
export const ASR_SENTENCE_CONSENT_URL = 'https://asr.tencentcloudapi.com';
const MAX_SENTENCE_SECONDS = 60;

export class AsrSentenceError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'unconfigured'
      | 'not-allowed'
      | 'audio-capture'
      | 'auth-failed'
      | 'network'
      | 'no-speech'
      | 'cancelled'
      | 'too-long',
  ) {
    super(message);
    this.name = 'AsrSentenceError';
  }
}

/** 16bit 单声道 PCM → WAV（一句话识别 VoiceFormat=wav） */
export function pcm16ToWav(pcm: Int16Array, sampleRate = 16000): ArrayBuffer {
  const dataSize = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  return buffer;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** TC3-HMAC-SHA256 签名，返回 Authorization 头 */
export async function buildTc3Authorization(options: {
  secretId: string;
  secretKey: string;
  service: string;
  host: string;
  action: string;
  version: string;
  payload: string;
  timestamp: number;
  region?: string;
}): Promise<string> {
  const date = new Date(options.timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders =
    `content-type:application/json; charset=utf-8\n` +
    `host:${options.host}\n` +
    `x-tc-action:${options.action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const hashedPayload = await sha256Hex(options.payload);
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join('\n');
  const credentialScope = `${date}/${options.service}/tc3_request`;
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(options.timestamp),
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');
  const secretDate = await hmacSha256Raw(`TC3${options.secretKey}`, date);
  const secretService = await hmacSha256Raw(secretDate, options.service);
  const secretSigning = await hmacSha256Raw(secretService, 'tc3_request');
  const signature = await hmacSha256Hex(secretSigning, stringToSign);
  return (
    `TC3-HMAC-SHA256 Credential=${options.secretId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`
  );
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return bufferToHex(digest);
}

async function hmacSha256Raw(key: string | ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const keyData = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
}

async function hmacSha256Hex(key: ArrayBuffer, message: string): Promise<string> {
  return bufferToHex(await hmacSha256Raw(key, message));
}

function bufferToHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 调用腾讯云一句话识别（≤60 秒音频）。
 * 需要 SecretId/SecretKey；AppId 在本接口不强制，但配置完整性仍要求三项。
 */
export async function recognizeSentenceWav(
  wav: ArrayBuffer,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  const cfg = getAsrConfig();
  if (!cfg.secretId || !cfg.secretKey) {
    throw new AsrSentenceError('还没配置腾讯云语音识别密钥', 'unconfigured');
  }
  if (wav.byteLength > 3 * 1024 * 1024) {
    throw new AsrSentenceError('录音太长了，请控制在一分钟内', 'too-long');
  }
  await requireAiConsent('voice-medication', ASR_SENTENCE_CONSENT_URL);
  if (options.signal?.aborted) throw new AsrSentenceError('已取消', 'cancelled');

  const dataB64 = arrayBufferToBase64(wav);
  const payloadObj = {
    EngSerViceType: '16k_zh',
    SourceType: 1,
    VoiceFormat: 'wav',
    Data: dataB64,
    DataLen: wav.byteLength,
    ProjectId: 0,
    SubServiceType: 2,
  };
  const payload = JSON.stringify(payloadObj);
  const timestamp = Math.floor(Date.now() / 1000);
  const authorization = await buildTc3Authorization({
    secretId: cfg.secretId,
    secretKey: cfg.secretKey,
    service: SENTENCE_SERVICE,
    host: SENTENCE_HOST,
    action: SENTENCE_ACTION,
    version: SENTENCE_VERSION,
    payload,
    timestamp,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    Host: SENTENCE_HOST,
    'X-TC-Action': SENTENCE_ACTION,
    'X-TC-Version': SENTENCE_VERSION,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Region': 'ap-guangzhou',
    Authorization: authorization,
  };

  const response = await postJsonPreferNative(
    `https://${SENTENCE_HOST}/`,
    headers,
    payload,
    options.signal,
  );
  if (options.signal?.aborted) throw new AsrSentenceError('已取消', 'cancelled');

  const body = response.data as {
    Response?: {
      Result?: string;
      Error?: { Code?: string; Message?: string };
    };
  };
  const err = body.Response?.Error;
  if (err) {
    const code = err.Code || '';
    if (/AuthFailure|Signature/i.test(code)) {
      throw new AsrSentenceError('语音识别鉴权失败，请检查 SecretId/SecretKey', 'auth-failed');
    }
    throw new AsrSentenceError(err.Message || `识别失败（${code}）`, 'network');
  }
  const text = (body.Response?.Result || '').trim();
  if (!text) throw new AsrSentenceError('没听清，请再说一次', 'no-speech');
  return text;
}

async function postJsonPreferNative(
  url: string,
  headers: Record<string, string>,
  body: string,
  signal?: AbortSignal,
): Promise<{ data: unknown; status: number }> {
  // Capacitor 原生 HTTP（绕过 CORS）；config 里 CapacitorHttp.enabled=true 时 window.fetch 也会走原生
  try {
    const { Capacitor, CapacitorHttp } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const result = await CapacitorHttp.request({
        url,
        method: 'POST',
        headers,
        data: JSON.parse(body) as Record<string, unknown>,
        connectTimeout: 30_000,
        readTimeout: 60_000,
      });
      // 原生层可能返回字符串
      const data = typeof result.data === 'string'
        ? JSON.parse(result.data || '{}')
        : result.data;
      if (result.status >= 400) {
        throw new AsrSentenceError(`语音服务出错（${result.status}）`, 'network');
      }
      return { data, status: result.status };
    }
  } catch (error) {
    if (error instanceof AsrSentenceError) throw error;
    /* 回落 fetch */
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new AsrSentenceError(`语音服务出错（${resp.status}）`, 'network');
  }
  return { data, status: resp.status };
}

export interface HoldToTalkSession {
  /** 开始录音（应在 pointerdown 用户手势里立刻调用） */
  start: () => Promise<void>;
  /** 结束并识别；cancel=true 时丢弃音频 */
  finish: (cancel?: boolean) => Promise<string | null>;
  /** 是否已在录 */
  isRecording: () => boolean;
  /** 当前已录秒数 */
  elapsedSeconds: () => number;
}

/** 按住说话会话：录 PCM → 松手转 WAV → 一句话识别 */
export function createHoldToTalkSession(options: {
  onTick?: (seconds: number) => void;
  maxSeconds?: number;
} = {}): HoldToTalkSession {
  const maxSeconds = Math.min(MAX_SENTENCE_SECONDS, options.maxSeconds ?? MAX_SENTENCE_SECONDS);
  let recording = false;
  let startedAt = 0;
  let tickTimer: number | null = null;
  let stream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  const chunks: Int16Array[] = [];
  let aborted = false;

  const cleanup = () => {
    if (tickTimer != null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    if (processor) {
      processor.onaudioprocess = null;
      try { processor.disconnect(); } catch { /* */ }
      processor = null;
    }
    if (sourceNode) {
      try { sourceNode.disconnect(); } catch { /* */ }
      sourceNode = null;
    }
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    if (audioContext) {
      const ctx = audioContext;
      audioContext = null;
      if (ctx.state !== 'closed') void ctx.close().catch(() => undefined);
    }
    recording = false;
  };

  return {
    isRecording: () => recording,
    elapsedSeconds: () => (recording ? Math.floor((Date.now() - startedAt) / 1000) : 0),
    async start() {
      if (recording) return;
      if (!isAsrConfigured()) {
        throw new AsrSentenceError('请先在设置里填好腾讯云语音识别三项', 'unconfigured');
      }
      aborted = false;
      chunks.length = 0;
      let media: MediaStream;
      try {
        media = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
      } catch (error) {
        const name = error instanceof DOMException ? error.name : '';
        throw new AsrSentenceError(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? '没有麦克风权限'
            : '打不开麦克风',
          name === 'NotAllowedError' || name === 'SecurityError' ? 'not-allowed' : 'audio-capture',
        );
      }
      stream = media;
      try {
        const context = new AudioContext();
        audioContext = context;
        if (context.state === 'suspended') await context.resume().catch(() => undefined);
        sourceNode = context.createMediaStreamSource(media);
        processor = context.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (event) => {
          if (!recording) return;
          const pcm = downsampleToPcm16k(event.inputBuffer.getChannelData(0), context.sampleRate);
          if (pcm.length) chunks.push(pcm);
        };
        sourceNode.connect(processor);
        processor.connect(context.destination);
      } catch {
        cleanup();
        throw new AsrSentenceError('录音组件启动失败', 'audio-capture');
      }
      recording = true;
      startedAt = Date.now();
      tickTimer = window.setInterval(() => {
        const sec = Math.floor((Date.now() - startedAt) / 1000);
        options.onTick?.(sec);
        if (sec >= maxSeconds) {
          // 到 60 秒自动停采，等 finish 去识别
          if (processor) processor.onaudioprocess = null;
        }
      }, 200);
    },
    async finish(cancel = false) {
      if (!recording && chunks.length === 0) return null;
      recording = false;
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      cleanup();
      if (cancel || aborted) return null;
      if (elapsed < 0.4 && chunks.length === 0) {
        throw new AsrSentenceError('说话时间太短了', 'no-speech');
      }
      const total = chunks.reduce((n, c) => n + c.length, 0);
      if (total < 1600) {
        // 不足约 0.1s
        throw new AsrSentenceError('没听清，请按住多说一会儿', 'no-speech');
      }
      const merged = new Int16Array(total);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.length;
      }
      // 截断到 60s
      const maxSamples = 16000 * maxSeconds;
      const pcm = merged.length > maxSamples ? merged.subarray(0, maxSamples) : merged;
      const wav = pcm16ToWav(pcm, 16000);
      return recognizeSentenceWav(wav);
    },
  };
}
