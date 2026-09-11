// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROMPT_SCANNER,
  PROMPT_CLEAN,
  generateMedPackshot,
  ImageGenError,
} from '../src/features/aiImageStudio';
import {
  saveMedPhoto,
  getMedPhotoRecord,
  restoreOriginalMedPhoto,
} from '../src/features/medPhotos';

vi.mock('../src/features/medPhotos', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/medPhotos')>();
  return {
    ...actual,
    compressBoxPhoto: vi.fn(async (b: Blob) => b),
  };
});

describe('aiImageStudio enhancement prompts', () => {
  it('defines scanner-like and clean-up reproduction prompts', () => {
    expect(PROMPT_SCANNER).toContain('flatbed scanner');
    expect(PROMPT_SCANNER).toContain('pure white background');
    expect(PROMPT_SCANNER).toContain('Preserve all original text');

    expect(PROMPT_CLEAN).toContain('remove the background and replace with pure white');
    expect(PROMPT_CLEAN).toContain('Do not redesign');
  });
});

describe('generateMedPackshot network & parsing behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('throws ImageGenError when photoBlob is missing', async () => {
    await expect(generateMedPackshot({
      photoBlob: null as unknown as Blob,
      name: '阿司匹林肠溶片',
    })).rejects.toThrow('需要药盒照片才能进行增强处理');
  });

  it('throws ImageGenError when neither image service nor active LLM is configured', async () => {
    const { setImageGenConfig, setLlmProviderSet } = await import('../src/ai/llmConfig');
    await setImageGenConfig({ enabled: false, baseUrl: '', apiKey: '', model: '' });
    await setLlmProviderSet({
      providers: [{ id: 'default', label: '默认', baseUrl: 'https://api.example.com/v1', apiKey: '', model: 'gpt-4o-mini' }],
      activeId: 'default',
      failover: false,
    });

    const photo = new Blob(['sample-photo-data'], { type: 'image/jpeg' });
    await expect(generateMedPackshot({
      photoBlob: photo,
      name: '阿司匹林肠溶片',
      dosageText: '100mg',
    })).rejects.toThrow(ImageGenError);
  });

  it('submits multipart form-data to /images/edits and parses b64_json response', async () => {
    const { setImageGenConfig } = await import('../src/ai/llmConfig');
    await setImageGenConfig({
      enabled: true,
      baseUrl: 'https://api.mockimage.com/v1',
      apiKey: 'test-key',
      model: 'gpt-image-1',
    });

    const sampleB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const fakeFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ b64_json: sampleB64 }],
      }),
    } as unknown as Response));
    vi.stubGlobal('fetch', fakeFetch);

    const progressSteps: string[] = [];
    const photo = new Blob(['photo-bytes'], { type: 'image/png' });
    const blob = await generateMedPackshot({
      photoBlob: photo,
      name: '阿司匹林肠溶片',
      dosageText: '100mg',
      onProgress: (step) => progressSteps.push(step),
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(progressSteps.length).toBeGreaterThan(0);
    expect(fakeFetch).toHaveBeenCalledWith(
      'https://api.mockimage.com/v1/images/edits',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer test-key',
        }),
      }),
    );
  });

  it('handles 404/405 gracefully with unsupported edits interface explanation', async () => {
    const { setImageGenConfig } = await import('../src/ai/llmConfig');
    await setImageGenConfig({
      enabled: true,
      baseUrl: 'https://api.mockimage.com/v1',
      apiKey: 'test-key',
      model: 'gpt-image-1',
    });

    const fakeFetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({
        error: { message: 'Not found' },
      }),
    } as unknown as Response));
    vi.stubGlobal('fetch', fakeFetch);

    const photo = new Blob(['photo-bytes'], { type: 'image/png' });
    await expect(generateMedPackshot({
      photoBlob: photo,
      name: '测试药品',
    })).rejects.toThrow('当前 AI 服务商不支持图片编辑接口');
  });

  it('handles 400 error response and throws detailed ImageGenError with statusCode', async () => {
    const { setImageGenConfig } = await import('../src/ai/llmConfig');
    await setImageGenConfig({
      enabled: true,
      baseUrl: 'https://api.mockimage.com/v1',
      apiKey: 'test-key',
      model: 'gpt-image-1',
    });

    const fakeFetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: { message: 'Image model quota exceeded' },
      }),
    } as unknown as Response));
    vi.stubGlobal('fetch', fakeFetch);

    const photo = new Blob(['photo-bytes'], { type: 'image/png' });
    await expect(generateMedPackshot({
      photoBlob: photo,
      name: '测试药品',
    })).rejects.toMatchObject({
      name: 'ImageGenError',
      message: 'Image model quota exceeded',
      statusCode: 400,
    });
  });
});

describe('medPhotos packshot and original photo lifecycle', () => {
  beforeEach(async () => {
    const { clearAllDataForTesting } = await import('../src/db/local');
    if (clearAllDataForTesting) await clearAllDataForTesting();
  });

  it('saves packshot with originalBlob and can restore original photo', async () => {
    const originalBlob = new Blob(['fake-original-photo'], { type: 'image/jpeg' });
    const packshotBlob = new Blob(['fake-ai-packshot'], { type: 'image/png' });
    const medId = 'med-test-123';

    await saveMedPhoto(medId, packshotBlob, {
      kind: 'ai_packshot',
      originalBlob,
    });

    const record = await getMedPhotoRecord(medId);
    expect(record).not.toBeNull();
    expect(record?.kind).toBe('ai_packshot');
    expect(record?.originalBlob).toBeDefined();

    const restored = await restoreOriginalMedPhoto(medId);
    expect(restored).toBe(true);

    const recordAfter = await getMedPhotoRecord(medId);
    expect(recordAfter?.kind).toBe('original');
  });
});
