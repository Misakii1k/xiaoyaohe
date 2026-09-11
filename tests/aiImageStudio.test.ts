// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROMPT_SCANNER,
  PROMPT_CLEAN,
  buildStudioPackshotPrompt,
  inferDefaultVisualFeatures,
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

describe('aiImageStudio prompts & default features', () => {
  it('defines scanner-like and clean-up reproduction prompts', () => {
    expect(PROMPT_SCANNER).toContain('flatbed scanner');
    expect(PROMPT_SCANNER).toContain('pure white background');
    expect(PROMPT_SCANNER).toContain('Preserve all original text');

    expect(PROMPT_CLEAN).toContain('remove the background and replace with pure white');
    expect(PROMPT_CLEAN).toContain('Do not redesign');
  });

  it('builds commercial studio packshot prompt correctly with straight-on front view', () => {
    const prompt = buildStudioPackshotPrompt({
      name: '布洛芬缓释胶囊',
      dosageText: '0.3g*20粒',
      form: 'paper_box',
      boxColorTheme: 'white carton with red wave',
      featureNotes: 'clear text and logo',
    });
    expect(prompt).toContain('Commercial pharmaceutical product photography');
    expect(prompt).toContain('布洛芬缓释胶囊');
    expect(prompt).toContain('0.3g*20粒');
    expect(prompt).toContain('white carton with red wave');
    expect(prompt).toContain('Direct straight-on front view');
    expect(prompt).not.toContain('Three-quarter isometric');

    const promptWithRef = buildStudioPackshotPrompt(
      {
        name: '布洛芬缓释胶囊',
        dosageText: '0.3g*20粒',
        form: 'paper_box',
      },
      true,
    );
    expect(promptWithRef).toContain('提取出参考素材中的药盒图片');
    expect(promptWithRef).toContain('Direct straight-on front view');
  });

  it('infers default visual features according to medicine name and dosage', () => {
    const syrup = inferDefaultVisualFeatures('止咳糖浆');
    expect(syrup.form).toBe('bottle');

    const cap = inferDefaultVisualFeatures('阿莫西林胶囊');
    expect(cap.form).toBe('paper_box');

    const tablet = inferDefaultVisualFeatures('阿司匹林片');
    expect(tablet.form).toBe('paper_box');
  });
});

describe('generateMedPackshot dual-mode network & parsing behavior', () => {
  const sampleB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
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

  it('in edits mode: throws when photo is missing', async () => {
    const { setImageGenConfig } = await import('../src/ai/llmConfig');
    await setImageGenConfig({
      enabled: true,
      baseUrl: 'https://api.mockimage.com/v1',
      apiKey: 'test-key',
      model: 'gpt-image-1',
      endpointMode: 'edits',
    });

    await expect(generateMedPackshot({
      name: '阿司匹林肠溶片',
    })).rejects.toThrow('修图模式需要药盒照片');
  });

  it('in edits mode: submits multipart form-data to /images/edits and parses b64_json', async () => {
    const { setImageGenConfig } = await import('../src/ai/llmConfig');
    await setImageGenConfig({
      enabled: true,
      baseUrl: 'https://api.mockimage.com/v1',
      apiKey: 'test-key',
      model: 'gpt-image-1',
      endpointMode: 'edits',
    });

    const fakeFetch = vi.fn(async (url: string) => {
      if (url.includes('/images/edits')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ b64_json: sampleB64 }],
          }),
        } as unknown as Response;
      }
      throw new Error(`Unexpected url: ${url}`);
    });
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

  it('in edits mode: handles 404 gracefully with unsupported edits interface explanation', async () => {
    const { setImageGenConfig } = await import('../src/ai/llmConfig');
    await setImageGenConfig({
      enabled: true,
      baseUrl: 'https://api.mockimage.com/v1',
      apiKey: 'test-key',
      model: 'gpt-image-1',
      endpointMode: 'edits',
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

  it('in generations mode: submits JSON payload to /images/generations', async () => {
    const { setImageGenConfig } = await import('../src/ai/llmConfig');
    await setImageGenConfig({
      enabled: true,
      baseUrl: 'https://api.mockimage.com/v1',
      apiKey: 'test-key',
      model: 'dall-e-3',
      endpointMode: 'generations',
    });

    const fakeFetch = vi.fn(async (url: string) => {
      if (url.includes('/images/generations')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ b64_json: sampleB64 }],
          }),
        } as unknown as Response;
      }
      throw new Error(`Unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fakeFetch);

    const blob = await generateMedPackshot({
      name: '板蓝根颗粒',
      dosageText: '10g*10袋',
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(fakeFetch).toHaveBeenCalledWith(
      'https://api.mockimage.com/v1/images/generations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          authorization: 'Bearer test-key',
        }),
      }),
    );
  });

  it('in auto mode: tries edits first, and automatically falls back to generations when edits returns 404', async () => {
    const { setImageGenConfig } = await import('../src/ai/llmConfig');
    await setImageGenConfig({
      enabled: true,
      baseUrl: 'https://api.mockimage.com/v1',
      apiKey: 'test-key',
      model: 'gpt-image-1',
      endpointMode: 'auto',
    });

    const calledUrls: string[] = [];
    const fakeFetch = vi.fn(async (url: string) => {
      calledUrls.push(url);
      if (url.includes('/images/edits')) {
        // Return 404 for edits
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: { message: 'Route /images/edits not found' } }),
        } as unknown as Response;
      }
      if (url.includes('/images/generations')) {
        // Return 200 for generations fallback
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ b64_json: sampleB64 }] }),
        } as unknown as Response;
      }
      return { ok: false, status: 500 } as unknown as Response;
    });
    vi.stubGlobal('fetch', fakeFetch);

    const progressSteps: string[] = [];
    const photo = new Blob(['photo-bytes'], { type: 'image/png' });
    const blob = await generateMedPackshot({
      photoBlob: photo,
      name: '感冒灵颗粒',
      dosageText: '10g*9袋',
      onProgress: (step) => progressSteps.push(step),
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(calledUrls).toContain('https://api.mockimage.com/v1/images/edits');
    expect(calledUrls).toContain('https://api.mockimage.com/v1/images/generations');
    expect(progressSteps.some((s) => s.includes('文生大图'))).toBe(true);
  });

  it('in auto mode: directly uses generations when no photoBlob is provided', async () => {
    const { setImageGenConfig } = await import('../src/ai/llmConfig');
    await setImageGenConfig({
      enabled: true,
      baseUrl: 'https://api.mockimage.com/v1',
      apiKey: 'test-key',
      model: 'gpt-image-1',
      endpointMode: 'auto',
    });

    const fakeFetch = vi.fn(async (url: string) => {
      if (url.includes('/images/generations')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ b64_json: sampleB64 }] }),
        } as unknown as Response;
      }
      throw new Error(`Unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fakeFetch);

    const blob = await generateMedPackshot({
      name: '复合维生素片',
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(fakeFetch).toHaveBeenCalledWith(
      'https://api.mockimage.com/v1/images/generations',
      expect.anything(),
    );
  });

  it('Agnes protocol: generates compliant payload without top-level response_format or n, with return_base64, ratio and extra_body', async () => {
    const { setImageGenConfig } = await import('../src/ai/llmConfig');
    await setImageGenConfig({
      enabled: true,
      baseUrl: 'https://apihub.agnes-ai.com/v1',
      apiKey: 'agnes-secret-key',
      model: 'agnes-image-2.1-flash',
      endpointMode: 'auto',
    });

    let sentBody: Record<string, unknown> | null = null;
    const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/images/generations')) {
        sentBody = JSON.parse(init?.body as string);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ b64_json: sampleB64 }],
          }),
        } as unknown as Response;
      }
      throw new Error(`Unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fakeFetch);

    const blob = await generateMedPackshot({
      name: '板蓝根颗粒',
      dosageText: '10g*10袋',
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(sentBody).not.toBeNull();
    // 严格断言 Agnes 规范要求：
    // 1. 绝不在顶层放置 response_format
    expect(sentBody?.response_format).toBeUndefined();
    // 2. 绝不在顶层发送多余的 n
    expect(sentBody?.n).toBeUndefined();
    // 3. 必须包含 return_base64: true
    expect(sentBody?.return_base64).toBe(true);
    // 4. extra_body 内应包含 response_format: 'b64_json'
    expect((sentBody?.extra_body as Record<string, unknown>)?.response_format).toBe('b64_json');
    // 5. 尺寸和比例规范：1K 和 1:1
    expect(sentBody?.size).toBe('1K');
    expect(sentBody?.ratio).toBe('1:1');
  });

  it('Agnes protocol with photo: directly invokes /images/generations with extra_body.image', async () => {
    const { setImageGenConfig } = await import('../src/ai/llmConfig');
    await setImageGenConfig({
      enabled: true,
      baseUrl: 'https://apihub.agnes-ai.com/v1',
      apiKey: 'agnes-secret-key',
      model: 'agnes-image-2.1-flash',
      endpointMode: 'auto',
    });

    let sentBody: Record<string, unknown> | null = null;
    const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/images/generations')) {
        sentBody = JSON.parse(init?.body as string);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ b64_json: `data:image/png;base64,${sampleB64}` }], // 包含前缀的兼容测试
          }),
        } as unknown as Response;
      }
      throw new Error(`Unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fakeFetch);

    const photo = new Blob(['sample-box-photo'], { type: 'image/jpeg' });
    const blob = await generateMedPackshot({
      photoBlob: photo,
      name: '阿莫西林胶囊',
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(sentBody).not.toBeNull();
    const extra = sentBody?.extra_body as Record<string, unknown>;
    expect(Array.isArray(extra?.image)).toBe(true);
    expect((extra.image as string[])[0]).toContain('data:image/');
  });

  it('handles Google Cloud Storage URL failure with friendly message', async () => {
    const { setImageGenConfig } = await import('../src/ai/llmConfig');
    await setImageGenConfig({
      enabled: true,
      baseUrl: 'https://apihub.agnes-ai.com/v1',
      apiKey: 'agnes-secret-key',
      model: 'agnes-image-2.1-flash',
      endpointMode: 'generations',
    });

    const fakeFetch = vi.fn(async (url: string) => {
      if (url.includes('/images/generations')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ url: 'https://storage.googleapis.com/agnes-aigc/sample.png' }],
          }),
        } as unknown as Response;
      }
      if (url.includes('storage.googleapis.com')) {
        throw new Error('Failed to fetch');
      }
      throw new Error(`Unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fakeFetch);

    await expect(generateMedPackshot({
      name: '感冒灵颗粒',
    })).rejects.toThrow('Google Cloud Storage');
  });
});

describe('ImageGenProfile storage operations', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('can save, list, and delete custom image generation profiles', async () => {
    const {
      getSavedImageGenProfiles,
      saveImageGenProfile,
      deleteImageGenProfile,
    } = await import('../src/ai/llmConfig');

    expect(getSavedImageGenProfiles()).toEqual([]);

    const profile = await saveImageGenProfile({
      name: 'Agnes 2.1 测试',
      baseUrl: 'https://apihub.agnes-ai.com/v1',
      apiKey: 'test-key-123',
      model: 'agnes-image-2.1-flash',
      endpointMode: 'auto',
    });

    expect(profile.id).toBeDefined();
    expect(profile.name).toBe('Agnes 2.1 测试');

    const list = getSavedImageGenProfiles();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('Agnes 2.1 测试');
    expect(list[0].model).toBe('agnes-image-2.1-flash');

    await deleteImageGenProfile(profile.id);
    expect(getSavedImageGenProfiles().length).toBe(0);
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
