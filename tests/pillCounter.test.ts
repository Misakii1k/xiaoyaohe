import { describe, expect, it } from 'vitest';
import { detectPillsFromImageData, type PillPoint } from '../src/features/pillCounter';
import { countPillsTool } from '../src/ai/tools/pillTools';
import { assistantTools } from '../src/ai/assistantTools';

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
});
