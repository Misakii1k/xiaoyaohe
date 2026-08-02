import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { requireAiConsent } from './consent';
import { getAsrConfig, isAsrCredentialsConfigured } from './asrConfig';
import { recognizeWithTencentCloud, TencentAsrError } from './tencentAsr';

const HEALTH_KEY = 'medbox.asrHealth.v1';
const MAX_SENTENCE_SECONDS = 60;
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
const TENCENT_ASR_ORIGIN = 'https://asr.tencentcloudapi.com';

interface NativeSpeechPlugin {
  start(options: { language: string }): Promise<{ text?: string; cancelled?: boolean }>;
  stop(): Promise<void>;
  abort(): Promise<void>;
}

const nativeSpeech = registerPlugin<NativeSpeechPlugin>('NativeSpeech');

export function isNativeSpeechFallbackAvailable(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('NativeSpeech');
  } catch {
    return false;
  }
}

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

export type AsrHealthStage = 'idle' | 'ready' | 'uploading' | 'success' | 'error';

export interface AsrHealth {
  stage: AsrHealthStage;
  message: string;
  at: number;
  code?: string;
  requestId?: string;
}

export class AsrSentenceError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'unconfigured'
      | 'not-allowed'
      | 'audio-capture'
      | 'auth-failed'
      | 'quota'
      | 'service-unavailable'
      | 'network'
      | 'no-speech'
      | 'cancelled'
      | 'too-long',
  ) {
    super(message);
    this.name = 'AsrSentenceError';
  }
}

/**
 * 可选的开发期代理地址（Vite 转发到 server/tencent-asr-proxy.mjs）。
 * App 正式路径不再依赖代理：只要本机填了腾讯云密钥就直连。
 */
export function getAsrProxyUrl(): string {
  return (import.meta.env.VITE_ASR_PROXY_URL ?? '').trim();
}

/** 是否可用腾讯云识别：本机密钥 或 开发代理。 */
export function isAsrConfigured(): boolean {
  return isAsrCredentialsConfigured() || getAsrProxyUrl().length > 0;
}

export function getAsrHealth(): AsrHealth {
  try {
    const parsed = JSON.parse(localStorage.getItem(HEALTH_KEY) ?? '') as Partial<AsrHealth>;
    if (typeof parsed.stage === 'string' && typeof parsed.message === 'string' && typeof parsed.at === 'number') {
      return parsed as AsrHealth;
    }
  } catch { /* ignore invalid diagnostics */ }
  if (isAsrCredentialsConfigured()) {
    return { stage: 'ready', message: '腾讯云语音识别已配置（App 内嵌直连）', at: 0 };
  }
  if (getAsrProxyUrl()) {
    return { stage: 'ready', message: '开发语音代理已配置', at: 0 };
  }
  return {
    stage: 'idle',
    message: isNativeSpeechFallbackAvailable()
      ? '未配置腾讯云密钥，将使用设备语音识别'
      : '请在设置中填写腾讯云 SecretId / SecretKey',
    at: 0,
  };
}

function setAsrHealth(health: AsrHealth): void {
  try { localStorage.setItem(HEALTH_KEY, JSON.stringify(health)); } catch { /* diagnostics are best effort */ }
}

export function downsampleToPcm16k(input: Float32Array, inputRate: number): Int16Array {
  if (!input.length || !Number.isFinite(inputRate) || inputRate <= 0) return new Int16Array();
  const outputRate = 16000;
  if (inputRate === outputRate) return floatToInt16(input);
  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let total = 0;
    for (let sample = start; sample < Math.max(start + 1, end); sample += 1) total += input[sample] ?? 0;
    output[index] = total / Math.max(1, end - start);
  }
  return floatToInt16(output);
}

function floatToInt16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    output[index] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }
  return output;
}

export function pcm16ToWav(pcm: Int16Array, sampleRate = 16000): ArrayBuffer {
  const dataSize = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  return buffer;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export async function recognizeSentenceWav(
  wav: ArrayBuffer,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  if (wav.byteLength > MAX_AUDIO_BYTES) {
    throw new AsrSentenceError('录音太长了，请控制在一分钟内', 'too-long');
  }

  // 优先：本机腾讯云密钥直连（任意设备、App/Web 均可）
  if (isAsrCredentialsConfigured()) {
    await requireAiConsent('voice-medication', TENCENT_ASR_ORIGIN);
    if (options.signal?.aborted) throw new AsrSentenceError('已取消', 'cancelled');
    setAsrHealth({ stage: 'uploading', message: '正在发送语音到腾讯云', at: Date.now() });
    try {
      const result = await recognizeWithTencentCloud(wav, getAsrConfig(), options);
      if (options.signal?.aborted) throw new AsrSentenceError('已取消', 'cancelled');
      const text = result.text.trim();
      if (!text) throw new AsrSentenceError('没听清，请再说一次', 'no-speech');
      setAsrHealth({
        stage: 'success',
        message: '语音识别正常',
        requestId: result.requestId,
        at: Date.now(),
      });
      return text;
    } catch (error) {
      if (error instanceof AsrSentenceError) throw error;
      if (error instanceof TencentAsrError) {
        const kind = /AuthFailure|Signature|SecretIdNotFound|UNCONFIGURED/i.test(error.code)
          ? 'auth-failed'
          : /Limit|Quota|RequestLimit/i.test(error.code)
            ? 'quota'
            : 'service-unavailable';
        setAsrHealth({
          stage: 'error',
          message: error.message,
          code: error.code,
          requestId: error.requestId,
          at: Date.now(),
        });
        throw new AsrSentenceError(error.message, kind);
      }
      if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        if (options.signal?.aborted) throw new AsrSentenceError('已取消', 'cancelled');
        throw new AsrSentenceError('语音识别超时，请检查网络后重试', 'network');
      }
      const message = error instanceof Error ? error.message : '语音服务连接失败';
      setAsrHealth({ stage: 'error', message, code: 'NETWORK', at: Date.now() });
      throw new AsrSentenceError(message, 'network');
    }
  }

  // 开发兜底：走 Vite 代理（需 npm run server:asr）
  const endpoint = getAsrProxyUrl();
  if (!endpoint) {
    throw new AsrSentenceError(
      '请先在「设置 → AI 服务商 → 语音识别」填写腾讯云 SecretId 和 SecretKey',
      'unconfigured',
    );
  }
  const consentUrl = new URL(endpoint, globalThis.location?.origin ?? 'https://localhost').origin;
  await requireAiConsent('voice-medication', consentUrl);
  if (options.signal?.aborted) throw new AsrSentenceError('已取消', 'cancelled');
  setAsrHealth({ stage: 'uploading', message: '正在发送语音', at: Date.now() });

  let response: { data: unknown; status: number };
  try {
    response = await postSpeechProxy(
      endpoint,
      { audioBase64: arrayBufferToBase64(wav), format: 'wav', language: 'zh-CN' },
      options.signal,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : '语音服务连接失败';
    setAsrHealth({ stage: 'error', message, code: 'NETWORK', at: Date.now() });
    throw new AsrSentenceError(message, 'network');
  }
  if (options.signal?.aborted) throw new AsrSentenceError('已取消', 'cancelled');

  const body = response.data as { text?: string; code?: string; message?: string; requestId?: string };
  const code = body.code ?? (response.status >= 400 ? `HTTP_${response.status}` : '');
  if (code) {
    const kind = /AuthFailure|Signature|SecretIdNotFound/i.test(code)
      ? 'auth-failed'
      : /Limit|Quota|RequestLimitExceeded/i.test(code)
        ? 'quota'
        : response.status === 429 || response.status >= 500
          ? 'service-unavailable'
          : 'network';
    const message = kind === 'auth-failed'
      ? '语音服务鉴权失败，请检查腾讯云密钥'
      : kind === 'quota'
        ? '语音服务额度已用完，请稍后再试'
        : body.message || '语音服务暂时不可用';
    setAsrHealth({ stage: 'error', message, code, requestId: body.requestId, at: Date.now() });
    throw new AsrSentenceError(message, kind);
  }
  const text = (body.text ?? '').trim();
  if (!text) throw new AsrSentenceError('没听清，请再说一次', 'no-speech');
  setAsrHealth({ stage: 'success', message: '语音识别正常', requestId: body.requestId, at: Date.now() });
  return text;
}

async function postSpeechProxy(
  url: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ data: unknown; status: number }> {
  if (Capacitor.isNativePlatform()) {
    const result = await CapacitorHttp.request({
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      data: body,
      connectTimeout: 20_000,
      readTimeout: 60_000,
    });
    const data = typeof result.data === 'string' ? JSON.parse(result.data || '{}') : result.data;
    return { data, status: result.status };
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return { data: await response.json().catch(() => ({})), status: response.status };
}

export interface HoldToTalkSession {
  start: () => Promise<void>;
  finish: (cancel?: boolean) => Promise<string | null>;
  isRecording: () => boolean;
  elapsedSeconds: () => number;
}

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
  let nativeRecognition: Promise<{ text?: string; cancelled?: boolean }> | null = null;
  const chunks: Int16Array[] = [];

  const cleanup = () => {
    if (tickTimer != null) clearInterval(tickTimer);
    tickTimer = null;
    if (processor) {
      processor.onaudioprocess = null;
      try { processor.disconnect(); } catch { /* ignore */ }
    }
    processor = null;
    if (sourceNode) try { sourceNode.disconnect(); } catch { /* ignore */ }
    sourceNode = null;
    if (stream) for (const track of stream.getTracks()) track.stop();
    stream = null;
    const context = audioContext;
    audioContext = null;
    if (context?.state !== 'closed') void context?.close().catch(() => undefined);
    recording = false;
  };

  return {
    isRecording: () => recording,
    elapsedSeconds: () => recording ? Math.floor((Date.now() - startedAt) / 1000) : 0,
    async start() {
      if (recording) return;
      chunks.length = 0;
      if (!isAsrConfigured() && isNativeSpeechFallbackAvailable()) {
        nativeRecognition = nativeSpeech.start({ language: 'zh-CN' });
        recording = true;
        startedAt = Date.now();
        tickTimer = window.setInterval(() => options.onTick?.(Math.floor((Date.now() - startedAt) / 1000)), 200);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
      } catch (error) {
        const name = error instanceof DOMException ? error.name : '';
        const denied = name === 'NotAllowedError' || name === 'SecurityError';
        throw new AsrSentenceError(denied ? '没有麦克风权限' : '打不开麦克风', denied ? 'not-allowed' : 'audio-capture');
      }
      try {
        const context = new AudioContext();
        audioContext = context;
        if (context.state === 'suspended') await context.resume().catch(() => undefined);
        sourceNode = context.createMediaStreamSource(stream);
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
      tickTimer = window.setInterval(() => options.onTick?.(Math.floor((Date.now() - startedAt) / 1000)), 200);
    },
    async finish(cancel = false) {
      if (!recording && chunks.length === 0) return null;
      recording = false;
      const elapsed = (Date.now() - startedAt) / 1000;
      const nativeRequest = nativeRecognition;
      nativeRecognition = null;
      if (nativeRequest) {
        if (cancel) {
          await nativeSpeech.abort().catch(() => undefined);
          await nativeRequest.catch(() => undefined);
          cleanup();
          return null;
        }
        await nativeSpeech.stop().catch(() => undefined);
        cleanup();
        try {
          const result = await nativeRequest;
          const text = (result.text ?? '').trim();
          if (result.cancelled) return null;
          if (!text) throw new AsrSentenceError('没听清，请再说一次', 'no-speech');
          return text;
        } catch (error) {
          if (error instanceof AsrSentenceError) throw error;
          const code = (error as { code?: string })?.code;
          if (code === 'NOT_ALLOWED') throw new AsrSentenceError('没有麦克风权限', 'not-allowed');
          if (code === 'NO_SPEECH') throw new AsrSentenceError('没听清，请再说一次', 'no-speech');
          throw new AsrSentenceError('设备语音识别暂时不可用，请检查网络或系统语音服务', 'service-unavailable');
        }
      }
      cleanup();
      if (cancel) return null;
      const total = chunks.reduce((count, chunk) => count + chunk.length, 0);
      if (elapsed < 0.4 || total < 1600) throw new AsrSentenceError('没听清，请按住多说一会儿', 'no-speech');
      const merged = new Int16Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      const pcm = merged.subarray(0, Math.min(merged.length, 16000 * maxSeconds));
      return recognizeSentenceWav(pcm16ToWav(pcm));
    },
  };
}

export function createProxyAsrRecognizer(): SpeechRecognitionLike {
  let session: HoldToTalkSession | null = null;
  const recognizer: SpeechRecognitionLike = {
    lang: 'zh-CN',
    continuous: false,
    interimResults: false,
    onresult: null,
    onerror: null,
    onend: null,
    start() {
      if (session) return;
      session = createHoldToTalkSession();
      void session.start().catch((error) => {
        session = null;
        recognizer.onerror?.({ error: error instanceof AsrSentenceError ? error.code : 'audio-capture' });
        recognizer.onend?.();
      });
    },
    stop() {
      if (!session) return;
      const active = session;
      session = null;
      void active.finish(false).then((text) => {
        if (!text) return;
        const alternative = [{ transcript: text }] as ArrayLike<{ transcript?: string }> & { isFinal?: boolean };
        alternative.isFinal = true;
        recognizer.onresult?.({ resultIndex: 0, results: [alternative] });
      }).catch((error) => {
        recognizer.onerror?.({ error: error instanceof AsrSentenceError ? error.code : 'network' });
      }).finally(() => recognizer.onend?.());
    },
    abort() {
      if (!session) return;
      const active = session;
      session = null;
      void active.finish(true).finally(() => recognizer.onend?.());
    },
  };
  return recognizer;
}
