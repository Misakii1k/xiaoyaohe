import { describe, expect, it, vi } from 'vitest';
import { detectPillsFromImageData, type PillPoint } from '../src/features/pillCounter';
import * as pillCounterClient from '../src/features/pillCounterClient';
import { countPillsTool } from '../src/ai/tools/pillTools';
import { assistantTools } from '../src/ai/assistantTools';
import * as aiAssistant from '../src/ai/assistant';
import * as toolTypes from '../src/ai/tools/toolTypes';

describe('pillCounter algorithm 2.0', () => {
  it('detects multiple circular pills on dark background and separates them', () => {
    const width = 120;
    const height = 100;
    const buffer = new Uint8ClampedArray(width * height * 4);

    // 填充深色背景 (r=30, g=40, b=35)
    for (let i = 0; i < buffer.length; i += 4) {
      buffer[i] = 30;
      buffer[i + 1] = 40;
      buffer[i + 2] = 35;
      buffer[i + 3] = 255;
    }

    // 画 5 颗明亮的白色圆形药片 (半径 6px)
    const centers = [
      { x: 30, y: 30 },
      { x: 50, y: 30 },
      { x: 70, y: 30 },
      { x: 40, y: 60 },
      { x: 65, y: 60 },
    ];

    for (const c of centers) {
      for (let dy = -6; dy <= 6; dy++) {
        for (let dx = -6; dx <= 6; dx++) {
          if (dx * dx + dy * dy <= 36) {
            const px = c.x + dx;
            const py = c.y + dy;
            if (px >= 0 && px < width && py >= 0 && py < height) {
              const idx = (py * width + px) * 4;
              buffer[idx] = 240;
              buffer[idx + 1] = 240;
              buffer[idx + 2] = 240;
            }
          }
        }
      }
    }

    const imgData = {
      width,
      height,
      data: buffer,
      colorSpace: 'srgb' as PredefinedColorSpace,
    } as ImageData;

    const result = detectPillsFromImageData(imgData);

    expect(result.points.length).toBe(5);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    // 验证检测到的每个点都在某个真实中心 3px 误差范围内
    for (const c of centers) {
      const matched = result.points.some((p: PillPoint) => Math.hypot(p.x - c.x, p.y - c.y) <= 3);
      expect(matched).toBe(true);
    }
  });

  it('filters out tiny dust specks', () => {
    const width = 80;
    const height = 80;
    const buffer = new Uint8ClampedArray(width * height * 4);

    for (let i = 0; i < buffer.length; i += 4) {
      buffer[i] = 25;
      buffer[i + 1] = 25;
      buffer[i + 2] = 25;
      buffer[i + 3] = 255;
    }

    // 画 1 颗正常药片 (半径 6px)
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        if (dx * dx + dy * dy <= 36) {
          const idx = ((40 + dy) * width + (40 + dx)) * 4;
          buffer[idx] = 245;
          buffer[idx + 1] = 245;
          buffer[idx + 2] = 245;
        }
      }
    }

    // 画 1 粒微小的噪点碎屑 (半径 1px)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const idx = ((20 + dy) * width + (20 + dx)) * 4;
        buffer[idx] = 245;
        buffer[idx + 1] = 245;
        buffer[idx + 2] = 245;
      }
    }

    const imgData = {
      width,
      height,
      data: buffer,
      colorSpace: 'srgb' as PredefinedColorSpace,
    } as ImageData;

    const result = detectPillsFromImageData(imgData);
    expect(result.points.length).toBe(1);
    expect(Math.hypot(result.points[0]!.x - 40, result.points[0]!.y - 40)).toBeLessThanOrEqual(2);
  });
});

describe('AI assistant count_pills tool', () => {
  it('is registered in assistantTools list', () => {
    const found = assistantTools.find((t) => t.name === 'count_pills');
    expect(found).toBeDefined();
    expect(found?.label).toBe('视觉清点药片');
  });

  it('prompts the user to attach an image when no image is provided', async () => {
    const res = await countPillsTool.run({});
    expect(res).toEqual({
      ok: false,
      error: expect.stringContaining('未检测到药片图片'),
    });
  });

  it('runs unified detection pipeline with blister mode and builds a compact preview card', async () => {
    const rawImgData = {
      width: 640,
      height: 480,
      data: new Uint8ClampedArray(640 * 480 * 4),
      colorSpace: 'srgb' as PredefinedColorSpace,
    } as ImageData;
    const pipelineSpy = vi
      .spyOn(pillCounterClient, 'runPillDetectionPipeline')
      .mockResolvedValue({
        points: [
          { id: 1, x: 100, y: 120, isManual: false },
          { id: 2, x: 200, y: 120, isManual: false },
          { id: 3, x: 300, y: 120, isManual: false },
          { id: 4, x: 400, y: 120, isManual: false },
        ],
        count: 4,
        engine: 'cloud',
        mode: 'blister',
        imageWidth: 640,
        imageHeight: 480,
        clusters: [{ id: 1, label: '白色', colorHex: '#f5f5f5', count: 4 }],
        consentNeeded: false,
        prepared: {
          width: 640,
          height: 480,
          rawImgData,
          jpegDataUrl: 'data:image/jpeg;base64,prep',
        },
      });
    const medSpy = vi
      .spyOn(toolTypes, 'findMedByName')
      .mockResolvedValue({
        med: {
          id: 'med-1',
          name: '阿司匹林',
          inventory: { remaining: 10, unit: '片', lowThreshold: 3, updatedAt: 1 },
        } as any,
        meds: [],
      });

    try {
      const res = (await countPillsTool.run(
        { mode: 'blister', med_name: '阿司匹林' },
        { attachment: { kind: 'image', dataUrl: 'data:image/jpeg;base64,rawinput' } },
      )) as Record<string, any>;

      expect(pipelineSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'data:image/jpeg;base64,rawinput',
          mode: 'blister',
        }),
      );
      expect(res.ok).toBe(true);
      expect(res.count).toBe(4);
      expect(res.mode).toBe('blister');
      expect(res.engine).toBe('cloud');

      const block = (aiAssistant as any).contentBlockOf(res);
      expect(block).toMatchObject({
        type: 'card',
        pillPreview: {
          count: 4,
          mode: 'blister',
          engine: 'cloud',
          imageWidth: 640,
          imageHeight: 480,
          medId: 'med-1',
          medName: '阿司匹林',
        },
      });

      const wire = (aiAssistant as any).sanitizeToolResultForWire(res) as Record<string, any>;
      expect(wire.ui?.pillPreview?.sourceDataUrl).toBeUndefined();
      expect(wire.ui?.pillPreview?.annotatedDataUrl).toBeUndefined();

      const stripped = (aiAssistant as any).stripHeavyBlockData([block]);
      expect(stripped[0]?.pillPreview?.sourceDataUrl).toBeUndefined();
      expect(stripped[0]?.pillPreview?.annotatedDataUrl).toBeUndefined();
      expect(stripped[0]?.pillPreview?.count).toBe(4);
    } finally {
      pipelineSpy.mockRestore();
      medSpy.mockRestore();
    }
  });
});
