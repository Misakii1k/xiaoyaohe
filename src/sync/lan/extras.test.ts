import { describe, expect, it } from 'vitest';
import { syncExtrasSchema, SYNC_MAX_PHOTOS } from './extras';

describe('LAN sync extras schema', () => {
  it('accepts an empty object (no extras selected)', () => {
    const result = syncExtrasSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts valid photo entries', () => {
    const result = syncExtrasSchema.safeParse({
      photos: [
        { medId: 'med_001', base64: 'AAAA', at: 1700000000000 },
        { medId: 'med_002', base64: 'BBBB', at: 1700000001000 },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.photos).toHaveLength(2);
    }
  });

  it('accepts valid api config', () => {
    const result = syncExtrasSchema.safeParse({
      apiConfig: {
        llm: { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini' },
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts both photos and apiConfig together', () => {
    const result = syncExtrasSchema.safeParse({
      photos: [{ medId: 'med_001', base64: 'AAAA', at: 1700000000000 }],
      apiConfig: { llm: { baseUrl: 'https://x.com', apiKey: 'k', model: 'm' } },
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown top-level fields', () => {
    const result = syncExtrasSchema.safeParse({ unknownField: true });
    expect(result.success).toBe(false);
  });

  it('rejects photo entries with invalid medId', () => {
    const result = syncExtrasSchema.safeParse({
      photos: [{ medId: '', base64: 'AAAA', at: 1700000000000 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects photo entries with negative timestamp', () => {
    const result = syncExtrasSchema.safeParse({
      photos: [{ medId: 'med_001', base64: 'AAAA', at: -1 }],
    });
    expect(result.success).toBe(false);
  });

  it(`rejects more than ${SYNC_MAX_PHOTOS} photos`, () => {
    const photos = Array.from({ length: SYNC_MAX_PHOTOS + 1 }, (_, i) => ({
      medId: `med_${String(i).padStart(3, '0')}`,
      base64: 'AAAA',
      at: 1700000000000 + i,
    }));
    const result = syncExtrasSchema.safeParse({ photos });
    expect(result.success).toBe(false);
  });

  it('rejects apiConfig with unknown nested fields', () => {
    const result = syncExtrasSchema.safeParse({
      apiConfig: { llm: { baseUrl: 'https://x.com', apiKey: 'k', model: 'm', extra: 1 } },
    });
    expect(result.success).toBe(false);
  });

  // 旧的 agnes 分支从未生效，且接收端会把密钥明文写进 localStorage。
  // 现在旧对端发来的 agnes 字段必须被 schema 拒绝，而不是悄悄写盘。
  it('rejects the retired agnes api config branch', () => {
    const result = syncExtrasSchema.safeParse({
      apiConfig: { agnes: { apiKey: 'sk-agnes', apiBase: 'https://apihub.agnes-ai.com' } },
    });
    expect(result.success).toBe(false);
  });

  it('rejects agnes alongside llm', () => {
    const result = syncExtrasSchema.safeParse({
      apiConfig: {
        llm: { baseUrl: 'https://x.com', apiKey: 'k', model: 'm' },
        agnes: { apiKey: 'sk-agnes', apiBase: 'https://apihub.agnes-ai.com' },
      },
    });
    expect(result.success).toBe(false);
  });
});
