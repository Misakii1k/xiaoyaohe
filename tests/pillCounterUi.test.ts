// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as consentModule from '../src/ai/consent';
import * as pillDetection from '../src/features/pillDetection';
import * as pillCounterClient from '../src/features/pillCounterClient';
import * as pillCounter from '../src/features/pillCounter';
import * as pillCounterFollowup from '../src/features/pillCounterFollowup';
import { renderAssistantBlock } from '../src/ui/assistantContent';
import { openPillCounterSheet } from '../src/features/pillCounter';
import { CLOUD_ORIGIN } from '../src/sync/lan/apkTransport';

function createSyntheticImageData(width = 240, height = 180): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      data[idx] = 40;
      data[idx + 1] = 44;
      data[idx + 2] = 48;
      data[idx + 3] = 255;
    }
  }
  const drawPill = (cx: number, cy: number, rgb: [number, number, number]) => {
    for (let y = cy - 11; y <= cy + 11; y += 1) {
      for (let x = cx - 11; x <= cx + 11; x += 1) {
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > 121) continue;
        const idx = (y * width + x) * 4;
        data[idx] = rgb[0];
        data[idx + 1] = rgb[1];
        data[idx + 2] = rgb[2];
      }
    }
  };
  drawPill(70, 60, [246, 246, 248]);
  drawPill(150, 90, [246, 246, 248]);
  return { width, height, data, colorSpace: 'srgb' as PredefinedColorSpace } as ImageData;
}

function makeFakeCanvasContext(width = 240, height = 180): CanvasRenderingContext2D {
  const imgData = createSyntheticImageData(width, height);
  return {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => imgData),
    putImageData: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    rect: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    clearRect: vi.fn(),
    font: '',
    textAlign: 'center',
    textBaseline: 'middle',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}

describe('pillCounter interactive sheet UI', () => {
  const prepared: pillCounterClient.PreparedPillImage = {
    width: 240,
    height: 180,
    rawImgData: createSyntheticImageData(240, 180),
    jpegDataUrl: 'data:image/jpeg;base64,/9j/test',
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    consentModule.clearAiConsents();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => makeFakeCanvasContext(240, 180),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(
      () => 'data:image/jpeg;base64,/9j/annotated',
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('renders mode segmented switch, undo, sample calibration, ROI crop, and hold-to-preview controls', async () => {
    vi.spyOn(pillCounterClient, 'runPillDetectionPipeline').mockResolvedValue({
      points: [
        { id: 1, x: 70, y: 60, isManual: false },
        { id: 2, x: 150, y: 90, isManual: false },
      ],
      count: 2,
      engine: 'heuristic_local',
      mode: 'loose',
      imageWidth: 240,
      imageHeight: 180,
      consentNeeded: true,
      prepared,
    });

    void openPillCounterSheet({ image: prepared });

    await vi.waitFor(() => {
      expect(document.querySelector('.pill-counter-sheet')).not.toBeNull();
    });
    const sheet = document.querySelector('.pill-counter-sheet')!;
    expect(sheet.textContent).toContain('共 2 粒');

    const buttons = [...sheet.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(buttons).toContain('散落药片');
    expect(buttons).toContain('整板药片');
    expect(buttons).toContain('点样本校准');
    expect(buttons).toContain('框选范围');
    expect(buttons).toContain('长按看原图');
    expect(buttons).toContain('撤销');
    expect(sheet.textContent).toContain('开启云端识别');
  });

  it('supports sample calibration on canvas and restoring prior count with undo', async () => {
    vi.spyOn(pillCounterClient, 'runPillDetectionPipeline').mockResolvedValue({
      points: [
        { id: 1, x: 70, y: 60, isManual: false },
        { id: 2, x: 150, y: 90, isManual: false },
      ],
      count: 2,
      engine: 'heuristic_local',
      mode: 'loose',
      imageWidth: 240,
      imageHeight: 180,
      prepared,
    });

    const sampleSpy = vi.spyOn(pillDetection, 'detectPillsFromSample').mockReturnValue({
      points: [
        { id: 1, x: 70, y: 60, isManual: false },
        { id: 2, x: 150, y: 90, isManual: false },
        { id: 3, x: 200, y: 120, isManual: false },
      ],
      elapsedMs: 4,
      detectedThresh: 20,
      pillRadius: 11,
      componentCount: 3,
    });

    void openPillCounterSheet({ image: prepared });
    await vi.waitFor(() => {
      expect(document.querySelector('.pill-counter-sheet')).not.toBeNull();
    });
    const sheet = document.querySelector('.pill-counter-sheet')!;
    const canvas = sheet.querySelector('canvas')!;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      width: 240,
      height: 180,
      right: 240,
      bottom: 180,
      toJSON: () => ({}),
    });

    const sampleBtn = [...sheet.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('点样本校准'),
    )!;
    sampleBtn.click();

    canvas.dispatchEvent(new MouseEvent('click', { clientX: 70, clientY: 60, bubbles: true }));
    expect(sampleSpy).toHaveBeenCalledTimes(1);
    expect(sheet.textContent).toContain('共 3 粒');

    const undoBtn = [...sheet.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('撤销'),
    )!;
    undoBtn.click();
    expect(sheet.textContent).toContain('共 2 粒');
  });

  it('shows non-blocking cloud consent banner and re-runs cloud detection once user grants consent', async () => {
    const pipelineSpy = vi
      .spyOn(pillCounterClient, 'runPillDetectionPipeline')
      .mockResolvedValueOnce({
        points: [{ id: 1, x: 70, y: 60, isManual: false }],
        count: 1,
        engine: 'heuristic_local',
        mode: 'loose',
        imageWidth: 240,
        imageHeight: 180,
        consentNeeded: true,
        prepared,
      })
      .mockResolvedValueOnce({
        points: [
          { id: 1, x: 70, y: 60, isManual: false },
          { id: 2, x: 150, y: 90, isManual: false },
        ],
        count: 2,
        engine: 'cloud',
        mode: 'loose',
        imageWidth: 240,
        imageHeight: 180,
        prepared,
      });

    const consentSpy = vi
      .spyOn(consentModule, 'grantAiConsentForOrigins')
      .mockResolvedValue(true);

    void openPillCounterSheet({ image: prepared });
    await vi.waitFor(() => {
      expect(document.querySelector('.pill-counter-sheet')).not.toBeNull();
    });
    const sheet = document.querySelector('.pill-counter-sheet')!;
    expect(sheet.textContent).toContain('共 1 粒');

    const enableBtn = [...sheet.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('开启云端识别'),
    )!;
    enableBtn.click();
    await vi.waitFor(() => {
      expect(consentSpy).toHaveBeenCalledWith(
        [CLOUD_ORIGIN],
        expect.any(String),
      );
      expect(pipelineSpy).toHaveBeenCalledTimes(2);
      expect(sheet.textContent).toContain('共 2 粒');
    });
  });

  it('renders assistant pillPreview card with thumbnail, adjust button, and safe replay fallback', async () => {
    const openSheetSpy = vi
      .spyOn(pillCounter, 'openPillCounterSheet')
      .mockResolvedValue(null);
    const followupSpy = vi
      .spyOn(pillCounterFollowup, 'openPillCountFollowupSheet')
      .mockResolvedValue(undefined);

    const liveCard = renderAssistantBlock(
      {
        type: 'card',
        title: '识别出 4 粒药片',
        badge: '共 4 粒',
        tone: 'success',
        pillPreview: {
          count: 4,
          mode: 'blister',
          engine: 'cloud',
          imageWidth: 640,
          imageHeight: 480,
          points: [{ id: 1, x: 100, y: 100, isManual: false }],
          annotatedDataUrl: 'data:image/jpeg;base64,thumbdata',
          sourceDataUrl: 'data:image/jpeg;base64,sourcedata',
          medId: 'med-1',
          medName: '阿司匹林',
        } as any,
      },
      () => undefined,
    );

    const img = liveCard.querySelector<HTMLImageElement>('.ai-pill-preview-img');
    expect(img).not.toBeNull();
    expect(img?.src).toBe('data:image/jpeg;base64,thumbdata');

    const editBtn = [...liveCard.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('微调并回填库存'),
    );
    expect(editBtn).toBeDefined();
    editBtn!.click();
    await vi.waitFor(() => {
      expect(openSheetSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          image: 'data:image/jpeg;base64,sourcedata',
          mode: 'blister',
        }),
      );
    });

    const replayCard = renderAssistantBlock(
      {
        type: 'card',
        title: '识别出 4 粒药片',
        badge: '共 4 粒',
        pillPreview: {
          count: 4,
          mode: 'loose',
          engine: 'heuristic_local',
          imageWidth: 640,
          imageHeight: 480,
          points: [],
          medId: 'med-1',
        } as any,
      },
      () => undefined,
    );

    expect(replayCard.querySelector('.ai-pill-preview-img')).toBeNull();
    expect(replayCard.querySelector('.ai-pill-preview-fallback')).not.toBeNull();
    const fallbackBtn = [...replayCard.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('回填库存'),
    );
    expect(fallbackBtn).toBeDefined();
    fallbackBtn!.click();
    await vi.waitFor(() => {
      expect(followupSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          count: 4,
          defaultMedId: 'med-1',
          mode: 'loose',
        }),
      );
    });
  });
});
