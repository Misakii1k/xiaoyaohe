// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/components', () => ({ confirmDialog: vi.fn(async () => true) }));

import {
  AsrSentenceError,
  arrayBufferToBase64,
  downsampleToPcm16k,
  getAsrHealth,
  isAsrConfigured,
  pcm16ToWav,
  recognizeSentenceWav,
} from '../src/ai/asr';
import {
  clearAsrConfig,
  isAsrCredentialsConfigured,
  setAsrConfig,
} from '../src/ai/asrConfig';
import { initializeSecretStore } from '../src/ai/secretStore';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

class MemorySecureStorage {
  private values = new Map<string, string>();
  async get(key: string): Promise<string | null> { return this.values.get(key) ?? null; }
  async set(key: string, value: string): Promise<void> { this.values.set(key, value); }
  async remove(key: string): Promise<void> { this.values.delete(key); }
}

const originalImport = (key: string, value: unknown): void => {
  (globalThis as Record<string, unknown>)[key] = value;
};

beforeEach(async () => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('secureStorage', new MemorySecureStorage());
  // 接管 @aparajita/capacitor-secure-storage：测试环境用 MemorySecureStorage 模拟
  vi.doMock('@aparajita/capacitor-secure-storage', () => ({
    SecureStorage: {
      setKeyPrefix: () => Promise.resolve(),
      setDefaultKeychainAccess: () => Promise.resolve(),
      get: (key: string) => (globalThis as Record<string, MemorySecureStorage>).secureStorage.get(key),
      set: (key: string, value: string) => (globalThis as Record<string, MemorySecureStorage>).secureStorage.set(key, value),
      remove: (key: string) => (globalThis as Record<string, MemorySecureStorage>).secureStorage.remove(key),
    },
    KeychainAccess: { whenUnlockedThisDeviceOnly: 'unlocked' },
  }));
  vi.resetModules();
  await import('../src/ai/secretStore').then((mod) => mod.initializeSecretStore());
  await clearAsrConfig();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('@aparajita/capacitor-secure-storage');
  vi.resetModules();
  originalImport('mocked', undefined);
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

describe('App-embedded Tencent ASR', () => {
  it('reports ready when credentials are saved and idle otherwise', async () => {
    expect(isAsrConfigured()).toBe(false);
    expect(isAsrCredentialsConfigured()).toBe(false);
    expect(getAsrHealth()).toMatchObject({ stage: 'idle' });
    await setAsrConfig({ secretId: 'AKIDxxxxxx', secretKey: 'sk-xxxxxxxx' });
    expect(isAsrConfigured()).toBe(true);
    expect(isAsrCredentialsConfigured()).toBe(true);
    expect(getAsrHealth()).toMatchObject({ stage: 'ready', message: expect.stringContaining('腾讯云') });
  });

  it('prompts to configure when no credentials are saved', async () => {
    const error = await recognizeSentenceWav(pcm16ToWav(new Int16Array(2000))).catch((value) => value);
    expect(error).toBeInstanceOf(AsrSentenceError);
    expect(error).toMatchObject({ code: 'unconfigured' });
  });

  it('signs the Tencent request directly when credentials are saved', async () => {
    await setAsrConfig({ secretId: 'AKID-test-1234', secretKey: 'sk-test-secret' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      Response: { Result: '阿司匹林每天一片', RequestId: 'req-direct-1' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const text = await recognizeSentenceWav(pcm16ToWav(new Int16Array(2000)));
    expect(text).toBe('阿司匹林每天一片');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://asr.tencentcloudapi.com/');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^TC3-HMAC-SHA256 Credential=AKID-test-1234\//);
    expect(headers['X-TC-Action']).toBe('SentenceRecognition');
    expect(headers['X-TC-Version']).toBe('2019-06-14');
    expect(getAsrHealth()).toMatchObject({
      stage: 'success', requestId: 'req-direct-1', message: '语音识别正常',
    });
  });

  it('maps Tencent SecretIdNotFound to a service-side auth error', async () => {
    await setAsrConfig({ secretId: 'AKID-bad', secretKey: 'sk-bad' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      Response: { Error: { Code: 'AuthFailure.SecretIdNotFound', Message: 'detail' }, RequestId: 'req-auth-1' },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const error = await recognizeSentenceWav(pcm16ToWav(new Int16Array(2000))).catch((value) => value);
    expect(error).toBeInstanceOf(AsrSentenceError);
    expect(error).toMatchObject({ code: 'auth-failed' });
    expect(getAsrHealth()).toMatchObject({
      stage: 'error', code: 'AuthFailure.SecretIdNotFound', requestId: 'req-auth-1',
    });
  });

  it('persists web credentials across simulated page reload', async () => {
    // 首次保存
    await setAsrConfig({ secretId: 'AKID-web', secretKey: 'sk-web-secret' });
    expect(localStorage.getItem('medbox_web_secret::ai-asr-credentials-v1')).toBe(
      JSON.stringify({ secretId: 'AKID-web', secretKey: 'sk-web-secret' }),
    );
    // 模拟页面刷新：模块重置 + 清空 secureStorage（native 路径不命中，验证 web 路径）
    vi.resetModules();
    vi.doMock('@aparajita/capacitor-secure-storage', () => ({
      SecureStorage: {
        setKeyPrefix: () => Promise.resolve(),
        setDefaultKeychainAccess: () => Promise.resolve(),
        get: (key: string) => (globalThis as Record<string, MemorySecureStorage>).secureStorage.get(key),
        set: (key: string, value: string) => (globalThis as Record<string, MemorySecureStorage>).secureStorage.set(key, value),
        remove: (key: string) => (globalThis as Record<string, MemorySecureStorage>).secureStorage.remove(key),
      },
      KeychainAccess: { whenUnlockedThisDeviceOnly: 'unlocked' },
    }));
    // Node 测试环境下 Capacitor.isNativePlatform() 默认为 false，触发 web 兜底分支
    await import('../src/ai/secretStore').then((mod) => mod.initializeSecretStore());
    const cfg = await import('../src/ai/asrConfig').then((mod) => mod.getAsrConfig());
    expect(cfg.secretId).toBe('AKID-web');
    expect(cfg.secretKey).toBe('sk-web-secret');
    expect(await import('../src/ai/asrConfig').then((mod) => mod.isAsrCredentialsConfigured())).toBe(true);
  });
});