import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectBoxPhotoCorners,
  detectCornersFromImageData,
  warpPerspectiveQuad,
} from '../src/features/boxPhotoCrop';

function rectangleImage(width = 160, height = 120): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = x >= 24 && x <= 136 && y >= 18 && y <= 102;
      const value = inside ? 55 : 238;
      const offset = (y * width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data, colorSpace: 'srgb' } as ImageData;
}

function bitmap(width: number, height: number): ImageBitmap {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('box photo crop', () => {
  it('finds the approximate four corners of a high-contrast box', () => {
    const corners = detectCornersFromImageData(rectangleImage());
    expect(corners).not.toBeNull();
    expect(corners![0].x).toBeCloseTo(24 / 159, 1);
    expect(corners![0].y).toBeCloseTo(18 / 119, 1);
    expect(corners![2].x).toBeCloseTo(136 / 159, 1);
    expect(corners![2].y).toBeCloseTo(102 / 119, 1);
  });

  it('detects corners from a Blob through the bounded canvas path', async () => {
    const image = rectangleImage();
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: image.width, height: image.height, close })));
    const context = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => image),
    };
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({ width: 0, height: 0, getContext: vi.fn(() => context) })),
    });

    const corners = await detectBoxPhotoCorners(new Blob(['photo'], { type: 'image/jpeg' }));
    expect(corners).not.toBeNull();
    expect(context.drawImage).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('warps a valid quad into a non-empty jpeg', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap(100, 80)));
    const sourceData = new Uint8ClampedArray(100 * 80 * 4).fill(190);
    const sourceImage = { width: 100, height: 80, data: sourceData, colorSpace: 'srgb' } as ImageData;
    const sourceContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => sourceImage),
    };
    const outputContext = {
      createImageData: vi.fn((width: number, height: number) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
        colorSpace: 'srgb',
      } as ImageData)),
      putImageData: vi.fn(),
    };
    let canvasCount = 0;
    vi.stubGlobal('document', {
      createElement: vi.fn(() => {
        canvasCount += 1;
        if (canvasCount === 1) return { width: 0, height: 0, getContext: vi.fn(() => sourceContext) };
        return {
          width: 0,
          height: 0,
          getContext: vi.fn(() => outputContext),
          toBlob: (callback: (blob: Blob | null) => void) => callback(new Blob(['jpeg'], { type: 'image/jpeg' })),
        };
      }),
    });

    const result = await warpPerspectiveQuad(new Blob(['photo']), [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.08 },
      { x: 0.92, y: 0.9 },
      { x: 0.08, y: 0.88 },
    ]);

    expect(result.type).toBe('image/jpeg');
    expect(result.size).toBeGreaterThan(0);
    expect(outputContext.putImageData).toHaveBeenCalledOnce();
  });
});
