import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

// consent → ui/components 依赖 DOM；本测试不触发外发确认，直接切断
vi.mock('../src/ui/components', () => ({ confirmDialog: vi.fn(async () => true) }));

import {
  arrayBufferToBase64,
  buildAsrWsUrl,
  buildTc3Authorization,
  downsampleToPcm16k,
  getAsrConfig,
  isAsrConfigured,
  parseAsrMessage,
  pcm16ToWav,
  resetAsrConfig,
  setAsrConfig,
} from '../src/ai/asr';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

beforeEach(async () => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  await resetAsrConfig();
});

describe('buildAsrWsUrl', () => {
  const cfg = { appId: '1250000000', secretId: 'AKIDexample', secretKey: 'test-secret-key' };
  const seed = { voiceId: 'abcd1234abcd1234', timestamp: 1700000000, nonce: 12345 };

  it('signs the host path + sorted query with HmacSHA1 and urlencodes the signature', async () => {
    const url = await buildAsrWsUrl(cfg, seed);
    // 独立复算：签名原文无 wss:// 前缀，参数按 key 字典序
    const query = [
      'engine_model_type=16k_zh',
      `expired=${1700000000 + 3600}`,
      'needvad=1',
      'nonce=12345',
      'secretid=AKIDexample',
      'timestamp=1700000000',
      'voice_format=1',
      'voice_id=abcd1234abcd1234',
    ].join('&');
    const raw = `asr.cloud.tencent.com/asr/v2/1250000000?${query}`;
    const expected = createHmac('sha1', 'test-secret-key').update(raw).digest('base64');
    expect(url).toBe(`wss://${raw}&signature=${encodeURIComponent(expected)}`);
  });

  it('keeps query keys in dictionary order with signature appended last', async () => {
    const url = await buildAsrWsUrl(cfg, seed);
    const keys = url.slice(url.indexOf('?') + 1).split('&').map((pair) => pair.split('=')[0]);
    expect(keys).toEqual([
      'engine_model_type', 'expired', 'needvad', 'nonce',
      'secretid', 'timestamp', 'voice_format', 'voice_id', 'signature',
    ]);
  });

  it('never leaks the SecretKey into the URL', async () => {
    const url = await buildAsrWsUrl(cfg, seed);
    expect(url).not.toContain('test-secret-key');
    expect(url).toContain('secretid=AKIDexample');
    expect(url).toContain('/asr/v2/1250000000?');
  });
});

describe('downsampleToPcm16k', () => {
  it('downsamples 48k input to a third of the samples', () => {
    const input = new Float32Array(4800).fill(0.5);
    const out = downsampleToPcm16k(input, 48000);
    expect(out.length).toBe(1600);
    expect(out[0]).toBe(Math.round(0.5 * 0x7fff));
  });

  it('maps full-scale samples into Int16 range and clamps overflow', () => {
    const out = downsampleToPcm16k(new Float32Array([1, -1, 2, -2, 0]), 16000);
    expect(Array.from(out)).toEqual([0x7fff, -0x8000, 0x7fff, -0x8000, 0]);
  });

  it('passes 16k input through sample-for-sample', () => {
    const out = downsampleToPcm16k(new Float32Array([0.25, -0.25, 0.5]), 16000);
    expect(out.length).toBe(3);
    expect(out[2]).toBe(Math.round(0.5 * 0x7fff));
  });

  it('returns empty output for empty or bogus input', () => {
    expect(downsampleToPcm16k(new Float32Array(0), 48000).length).toBe(0);
    expect(downsampleToPcm16k(new Float32Array([0.5]), 0).length).toBe(0);
  });
});

describe('parseAsrMessage', () => {
  it('reads interim and stable slices', () => {
    expect(parseAsrMessage(JSON.stringify({
      code: 0, message: 'success', result: { slice_type: 1, voice_text_str: '阿司匹林每天', index: 0 },
    }))).toEqual({ code: 0, message: 'success', final: false, sliceType: 1, text: '阿司匹林每天' });
    expect(parseAsrMessage(JSON.stringify({
      code: 0, message: 'success', result: { slice_type: 2, voice_text_str: '阿司匹林每天一片。', index: 0 },
    }))).toMatchObject({ sliceType: 2, text: '阿司匹林每天一片。' });
  });

  it('flags the final message', () => {
    expect(parseAsrMessage(JSON.stringify({ code: 0, message: 'success', final: 1 })))
      .toEqual({ code: 0, message: 'success', final: true, sliceType: null, text: '' });
  });

  it('surfaces business error codes', () => {
    const msg = parseAsrMessage(JSON.stringify({ code: 4002, message: 'check signature failed' }));
    expect(msg).toMatchObject({ code: 4002, message: 'check signature failed' });
  });

  it('returns null for binary frames, bad JSON, or payloads without a code', () => {
    expect(parseAsrMessage(new ArrayBuffer(4))).toBeNull();
    expect(parseAsrMessage('not-json')).toBeNull();
    expect(parseAsrMessage('{}')).toBeNull();
    expect(parseAsrMessage(JSON.stringify({ code: '0' }))).toBeNull();
  });
});

describe('asr config', () => {
  it('never writes the SecretKey into localStorage plaintext', async () => {
    await setAsrConfig({ appId: '1250000000', secretId: 'AKIDtest', secretKey: 'sk-asr-secret' });
    const raw = localStorage.getItem('medbox.asrConfig.v1') ?? '';
    expect(raw).not.toContain('sk-asr-secret');
    expect(raw).toContain('AKIDtest');
    expect(getAsrConfig()).toEqual({ appId: '1250000000', secretId: 'AKIDtest', secretKey: 'sk-asr-secret' });
  });

  it('is configured only when all three values are present', async () => {
    expect(isAsrConfigured()).toBe(false);
    await setAsrConfig({ appId: '1250000000', secretId: 'AKIDtest', secretKey: '' });
    expect(isAsrConfigured()).toBe(false);
    await setAsrConfig({ appId: '1250000000', secretId: '', secretKey: 'sk' });
    expect(isAsrConfigured()).toBe(false);
    await setAsrConfig({ appId: '1250000000', secretId: 'AKIDtest', secretKey: 'sk' });
    expect(isAsrConfigured()).toBe(true);
    await resetAsrConfig();
    expect(isAsrConfigured()).toBe(false);
    expect(getAsrConfig()).toEqual({ appId: '', secretId: '', secretKey: '' });
  });

  it('trims whitespace around identifiers', async () => {
    await setAsrConfig({ appId: ' 125 ', secretId: ' AKIDtest ', secretKey: ' sk ' });
    expect(getAsrConfig()).toEqual({ appId: '125', secretId: 'AKIDtest', secretKey: 'sk' });
  });
});

describe('one-shot sentence helpers', () => {
  it('wraps pcm16 samples as a valid wav container', () => {
    const pcm = new Int16Array([0, 1000, -1000]);
    const wav = pcm16ToWav(pcm, 16000);
    const bytes = new Uint8Array(wav);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WAVE');
    expect(wav.byteLength).toBe(44 + pcm.byteLength);
    expect(arrayBufferToBase64(wav).length).toBeGreaterThan(20);
  });

  it('builds a TC3 authorization header with credential scope', async () => {
    const auth = await buildTc3Authorization({
      secretId: 'AKIDexample',
      secretKey: 'secret',
      service: 'asr',
      host: 'asr.tencentcloudapi.com',
      action: 'SentenceRecognition',
      version: '2019-06-14',
      payload: '{"EngSerViceType":"16k_zh"}',
      timestamp: 1700000000,
    });
    expect(auth.startsWith('TC3-HMAC-SHA256 Credential=AKIDexample/')).toBe(true);
    expect(auth).toContain('/asr/tc3_request');
    expect(auth).toContain('SignedHeaders=content-type;host;x-tc-action');
    expect(auth).toContain('Signature=');
    expect(auth).not.toContain('secret');
  });
});
