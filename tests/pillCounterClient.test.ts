import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAiConsents } from '../src/ai/consent';
import { CLOUD_ORIGIN } from '../src/sync/lan/apkTransport';
import { registerLocalYoloProvider, type LocalYoloProvider } from '../src/features/pillEngine';
import {
  preparePillImage,
  runPillDetectionPipeline,
  type PreparedPillImage,
} from '../src/features/pillCounterClient';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

function makeSyntheticPrepared(width = 240, height = 180): PreparedPillImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      data[idx] = 35;
      data[idx + 1] = 38;
      data[idx + 2] = 42;
      data[idx + 3] = 255;
    }
  }
  const drawPill = (cx: number, cy: number, color: [number, number, number]) => {
    for (let y = cy - 12; y <= cy + 12; y += 1) {
      for (let x = cx - 12; x <= cx + 12; x += 1) {
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > 144) continue;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const idx = (y * width + x) * 4;
        data[idx] = color[0];
        data[idx + 1] = color[1];
        data[idx + 2] = color[2];
      }
    }
  };
  drawPill(70, 60, [246, 246, 248]);
  drawPill(165, 110, [246, 246, 248]);

  return {
    width,
    height,
    rawImgData: { width, height, data, colorSpace: 'srgb' as PredefinedColorSpace } as ImageData,
    jpegDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/',
  };
}

function grantCloudPillConsent(): void {
  localStorage.setItem(
    'medbox.ai-consent.v2',
    JSON.stringify([
      { version: 2, origin: CLOUD_ORIGIN, category: 'health', grantedAt: Date.now() },
    ]),
  );
}

describe('pillCounterClient orchestrator', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.stubGlobal('navigator', { onLine: true });
    clearAiConsents();
    registerLocalYoloProvider(null);
  });

  afterEach(() => {
    registerLocalYoloProvider(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('calls cloud /api/count-pills first when consented & online and normalizes points', async () => {
    grantCloudPillConsent();
    const prepared = await preparePillImage(makeSyntheticPrepared(240, 180));
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          mode: 'loose',
          engine: 'cloud',
          points: [
            { x: 70 / 240, y: 60 / 180 },
            { x: 165 / 240, y: 110 / 180 },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const res = await runPillDetectionPipeline({
      source: prepared,
      mode: 'loose',
      fetcher: fetcher as unknown as typeof fetch,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`${CLOUD_ORIGIN}/api/count-pills`);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      image: prepared.jpegDataUrl,
      mode: 'loose',
    });
    expect(res.engine).toBe('cloud');
    expect(res.count).toBe(2);
    expect(res.consentNeeded).toBeFalsy();
  });

  it('never hits the network when pill-photo cloud consent is missing and marks consentNeeded', async () => {
    const fetcher = vi.fn();
    const res = await runPillDetectionPipeline({
      source: makeSyntheticPrepared(),
      mode: 'loose',
      fetcher: fetcher as unknown as typeof fetch,
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(res.engine).toBe('heuristic_local');
    expect(res.consentNeeded).toBe(true);
    expect(res.count).toBe(2);
  });

  it('gracefully falls back to local detection on 429, 503, or network error with degradedReason', async () => {
    grantCloudPillConsent();

    for (const scenario of [
      () => Promise.resolve(new Response('rate limited', { status: 429 })),
      () => Promise.resolve(new Response('not bound', { status: 503 })),
      () => Promise.reject(new Error('network down')),
    ]) {
      const fetcher = vi.fn(scenario);
      const res = await runPillDetectionPipeline({
        source: makeSyntheticPrepared(),
        mode: 'blister',
        fetcher: fetcher as unknown as typeof fetch,
      });
      expect(res.engine).toBe('heuristic_local');
      expect(res.count).toBe(2);
      expect(res.degradedReason).toBeTruthy();
      expect(res.fallbackReason).toBe(res.degradedReason);
    }
  });

  it('prefers registered phase-2 LocalYoloProvider over heuristic fallback and maps ROI coords back', async () => {
    const yolo: LocalYoloProvider = {
      id: 'yolo-v11-pill',
      label: 'YOLO v11',
      isReady: () => true,
      detect: vi.fn(async () => ({
        points: [{ id: 1, x: 20, y: 15, isManual: false }],
      })),
    };
    registerLocalYoloProvider(yolo);

    const res = await runPillDetectionPipeline({
      source: makeSyntheticPrepared(240, 180),
      mode: 'loose',
      allowCloud: false,
      roi: { x: 50, y: 40, width: 100, height: 80 },
    });

    expect(res.engine).toBe('yolo_local');
    expect(res.count).toBe(1);
    expect(res.points[0]).toMatchObject({ x: 70, y: 55 });
  });
});
