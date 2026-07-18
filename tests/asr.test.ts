import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/components', () => ({ confirmDialog: vi.fn(async () => true) }));

import {
  AsrSentenceError,
  arrayBufferToBase64,
  downsampleToPcm16k,
  getAsrHealth,
  getAsrProxyUrl,
  isAsrConfigured,
  pcm16ToWav,
  recognizeSentenceWav,
} from '../src/ai/asr';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.restoreAllMocks();
});

describe('ASR audio helpers', () => {
  it('downsamples 48k input to 16k PCM and clamps full-scale values', () => {
    const input = new Float32Array(4800).fill(0.5);
    const out = downsampleToPcm16k(input, 48000);
    expect(out.length).toBe(1600);
    expect(out[0]).toBe(Math.round(0.5 * 0x7fff));
    expect(Array.from(downsampleToPcm16k(new Float32Array([1, -1, 2, -2]), 16000)))
      .toEqual([0x7fff, -0x8000, 0x7fff, -0x8000]);
  });

  it('returns no samples for invalid input', () => {
    expect(downsampleToPcm16k(new Float32Array(), 48000)).toHaveLength(0);
    expect(downsampleToPcm16k(new Float32Array([0.5]), 0)).toHaveLength(0);
  });

  it('wraps PCM as a valid WAV container', () => {
    const pcm = new Int16Array([0, 1000, -1000]);
    const wav = pcm16ToWav(pcm);
    const bytes = new Uint8Array(wav);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WAVE');
    expect(wav.byteLength).toBe(44 + pcm.byteLength);
    expect(arrayBufferToBase64(wav).length).toBeGreaterThan(20);
  });
});

describe('ASR speech proxy', () => {
  it('uses the same-origin endpoint in web builds without client credentials', () => {
    expect(getAsrProxyUrl()).toBe('/api/speech/tencent');
    expect(isAsrConfigured()).toBe(true);
    expect(getAsrHealth()).toMatchObject({ stage: 'ready' });
    expect(localStorage.getItem('medbox.asrConfig.v1')).toBeNull();
  });

  it('returns text and stores only sanitized diagnostics', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      text: '阿司匹林每天一片',
      requestId: 'req-safe-1',
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    await expect(recognizeSentenceWav(pcm16ToWav(new Int16Array(2000)))).resolves
      .toBe('阿司匹林每天一片');
    expect(getAsrHealth()).toMatchObject({
      stage: 'success', requestId: 'req-safe-1', message: '语音识别正常',
    });
    expect(localStorage.getItem('medbox.asrHealth.v1')).not.toContain('audioBase64');
  });

  it('maps Tencent SecretIdNotFound to a service-side auth error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 'AuthFailure.SecretIdNotFound',
      message: 'internal detail',
      requestId: 'req-auth-1',
    }), { status: 502, headers: { 'content-type': 'application/json' } })));
    const error = await recognizeSentenceWav(pcm16ToWav(new Int16Array(2000))).catch((value) => value);
    expect(error).toBeInstanceOf(AsrSentenceError);
    expect(error).toMatchObject({ code: 'auth-failed', message: '语音服务鉴权失败，服务端凭证需要更新' });
    expect(getAsrHealth()).toMatchObject({
      stage: 'error', code: 'AuthFailure.SecretIdNotFound', requestId: 'req-auth-1',
    });
  });
});
