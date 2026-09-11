// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
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

describe('aiImageStudio packshot prompt & feature inference', () => {
  it('builds commercial pharmaceutical packaging prompt with white background and subtle shadow', () => {
    const prompt = buildStudioPackshotPrompt({
      name: '瑞舒伐他汀钙片',
      dosageText: '10mg*7片/板',
      boxColorTheme: '纯白底配双道翠绿波浪线条',
      featureNotes: 'LuNan brand logo on top left',
    });

    expect(prompt).toContain('Commercial pharmaceutical product photography');
    expect(prompt).toContain('Seamless pure white background with soft subtle contact drop shadow');
    expect(prompt).toContain('Three-quarter isometric front perspective view');
    expect(prompt).toContain('瑞舒伐他汀钙片');
    expect(prompt).toContain('10mg*7片/板');
    expect(prompt).toContain('纯白底配双道翠绿波浪线条');
    expect(prompt).toContain('no background clutter, no hands, no human');
  });

  it('infers bottle form for syrup or liquid medicines and carton box for tablets/capsules', () => {
    const syrup = inferDefaultVisualFeatures('止咳糖浆', '100mL/瓶');
    expect(syrup.form).toBe('bottle');
    expect(syrup.boxColorTheme).toContain('bottle');

    const capsule = inferDefaultVisualFeatures('布洛芬缓释胶囊', '0.3g*20粒');
    expect(capsule.form).toBe('paper_box');
    expect(capsule.name).toBe('布洛芬缓释胶囊');
  });
});

describe('generateMedPackshot network & parsing behavior', () => {
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

    await expect(generateMedPackshot({
      name: '阿司匹林肠溶片',
      dosageText: '100mg',
    })).rejects.toThrow(ImageGenError);
  });

  it('generates packshot from mock OpenAI-compatible b64_json response', async () => {
    const { setImageGenConfig } = await import('../src/ai/llmConfig');
    await setImageGenConfig({
      enabled: true,
      baseUrl: 'https://api.mockimage.com/v1',
      apiKey: 'test-key',
      model: 'dall-e-3',
    });

    // 1x1 transparent PNG in base64
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
    const blob = await generateMedPackshot({
      name: '阿司匹林肠溶片',
      dosageText: '100mg',
      onProgress: (step) => progressSteps.push(step),
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(progressSteps.length).toBeGreaterThan(0);
    expect(fakeFetch).toHaveBeenCalledWith(
      'https://api.mockimage.com/v1/images/generations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer test-key',
        }),
      }),
    );
  });

  it('handles error response and throws detailed ImageGenError with statusCode', async () => {
    const { setImageGenConfig } = await import('../src/ai/llmConfig');
    await setImageGenConfig({
      enabled: true,
      baseUrl: 'https://api.mockimage.com/v1',
      apiKey: 'test-key',
      model: 'dall-e-3',
    });

    const fakeFetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: { message: 'Image model quota exceeded' },
      }),
    } as unknown as Response));
    vi.stubGlobal('fetch', fakeFetch);

    await expect(generateMedPackshot({
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
