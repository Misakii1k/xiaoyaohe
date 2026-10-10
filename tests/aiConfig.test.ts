import { describe, expect, it } from 'vitest';
import { normalizeAndValidateBaseUrl } from '../src/ai/llmConfig';

describe('AI provider URL validation', () => {
  it('allows HTTPS API paths and rejects credential-bearing or ambiguous URLs', () => {
    expect(normalizeAndValidateBaseUrl('https://api.example.com/v1/')).toBe(
      'https://api.example.com/v1',
    );
    expect(() => normalizeAndValidateBaseUrl('http://api.example.com/v1')).toThrow(/HTTPS/);
    expect(() => normalizeAndValidateBaseUrl('https://user:secret@api.example.com/v1')).toThrow(
      /账号密码/,
    );
    expect(() => normalizeAndValidateBaseUrl('https://api.example.com/v1?token=secret')).toThrow(
      /查询参数/,
    );
    expect(() => normalizeAndValidateBaseUrl('https://api.example.com/v1#models')).toThrow(/片段/);
  });

  it('strips /chat/completions and /models suffixes for third-party OpenAI-compatible providers like WeChat API', () => {
    expect(
      normalizeAndValidateBaseUrl('https://chatapi.weixin.qq.com/openai/v1/chat/completions'),
    ).toBe('https://chatapi.weixin.qq.com/openai/v1');

    expect(
      normalizeAndValidateBaseUrl('https://chatapi.weixin.qq.com/openai/v1/chat/completions/'),
    ).toBe('https://chatapi.weixin.qq.com/openai/v1');

    expect(
      normalizeAndValidateBaseUrl('https://api.deepseek.com/v1/models'),
    ).toBe('https://api.deepseek.com/v1');

    expect(
      normalizeAndValidateBaseUrl('  "https://api.siliconflow.cn/v1/chat/completions"  '),
    ).toBe('https://api.siliconflow.cn/v1');
  });
});
