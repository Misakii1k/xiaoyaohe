import { describe, expect, it } from 'vitest';
import { detectPillsFromImageData } from '../src/features/pillDetection';

type RGB = [number, number, number];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createImage(
  width: number,
  height: number,
  background: RGB | ((x: number, y: number) => RGB),
): Uint8ClampedArray {
  const buffer = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = typeof background === 'function' ? background(x, y) : background;
      const index = (y * width + x) * 4;
      buffer[index] = color[0];
      buffer[index + 1] = color[1];
      buffer[index + 2] = color[2];
      buffer[index + 3] = 255;
    }
  }
  return buffer;
}

function drawEllipse(
  buffer: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: RGB,
  options: { alpha?: number; softness?: number } = {},
): void {
  const alpha = options.alpha ?? 1;
  const softness = options.softness ?? 0.8;
  const minX = Math.max(0, Math.floor(cx - rx - softness - 1));
  const maxX = Math.min(width - 1, Math.ceil(cx + rx + softness + 1));
  const minY = Math.max(0, Math.floor(cy - ry - softness - 1));
  const maxY = Math.min(height - 1, Math.ceil(cy + ry + softness + 1));
  const minRadius = Math.min(rx, ry);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const distance = Math.sqrt(nx * nx + ny * ny);
      const coverage = Math.max(
        0,
        Math.min(1, (1 - distance) * (minRadius / softness) + 0.5),
      );
      if (coverage <= 0) continue;
      const blend = coverage * alpha;
      const index = (y * width + x) * 4;
      buffer[index] = buffer[index]! * (1 - blend) + color[0] * blend;
      buffer[index + 1] = buffer[index + 1]! * (1 - blend) + color[1] * blend;
      buffer[index + 2] = buffer[index + 2]! * (1 - blend) + color[2] * blend;
    }
  }
}

function addNoise(
  buffer: Uint8ClampedArray,
  amplitude: number,
  seed = 7,
): void {
  const random = mulberry32(seed);
  for (let i = 0; i < buffer.length; i += 4) {
    const delta = (random() * 2 - 1) * amplitude;
    buffer[i] = buffer[i]! + delta;
    buffer[i + 1] = buffer[i + 1]! + delta;
    buffer[i + 2] = buffer[i + 2]! + delta;
  }
}

function toImageData(
  buffer: Uint8ClampedArray,
  width: number,
  height: number,
): ImageData {
  return {
    width,
    height,
    data: buffer,
    colorSpace: 'srgb' as PredefinedColorSpace,
  } as ImageData;
}

function detect(
  buffer: Uint8ClampedArray,
  width: number,
  height: number,
): ReturnType<typeof detectPillsFromImageData> {
  return detectPillsFromImageData(toImageData(buffer, width, height));
}

function expectCenters(
  points: Array<{ x: number; y: number }>,
  centers: Array<{ x: number; y: number }>,
  tolerance = 4,
): void {
  for (const center of centers) {
    const matched = points.some(
      (point) => Math.hypot(point.x - center.x, point.y - center.y) <= tolerance,
    );
    expect(matched, `missing center (${center.x}, ${center.y})`).toBe(true);
  }
}

describe('pill detection 3.0 — background & contrast', () => {
  it('counts dark pills on bright paper without relying on luminance polarity', () => {
    const width = 260;
    const height = 200;
    const buffer = createImage(width, height, [246, 244, 238]);
    const centers = [
      { x: 40, y: 40 },
      { x: 100, y: 42 },
      { x: 160, y: 38 },
      { x: 220, y: 44 },
      { x: 60, y: 110 },
      { x: 130, y: 112 },
      { x: 200, y: 108 },
      { x: 90, y: 165 },
    ];
    for (const center of centers) {
      drawEllipse(buffer, width, height, center.x, center.y, 9, 9, [38, 66, 148]);
    }
    const result = detect(buffer, width, height);
    expect(result.points.length).toBe(centers.length);
    expectCenters(result.points, centers);
  });

  it('keeps large pills as one point each (old fixed-spacing peak finder over-counted)', () => {
    const width = 300;
    const height = 220;
    const buffer = createImage(width, height, [28, 34, 32]);
    const centers = [
      { x: 70, y: 70 },
      { x: 180, y: 66 },
      { x: 260, y: 140 },
      { x: 120, y: 160 },
    ];
    for (const center of centers) {
      drawEllipse(buffer, width, height, center.x, center.y, 17, 17, [238, 240, 245]);
    }
    const result = detect(buffer, width, height);
    expect(result.points.length).toBe(centers.length);
    expectCenters(result.points, centers, 5);
  });

  it('handles a lighting gradient across the tray', () => {
    const width = 300;
    const height = 200;
    const buffer = createImage(width, height, (x) => {
      const level = Math.round(70 + (x / width) * 150);
      return [level, level + 6, level + 12];
    });
    const centers = [
      { x: 45, y: 55 },
      { x: 115, y: 60 },
      { x: 190, y: 52 },
      { x: 255, y: 65 },
      { x: 80, y: 145 },
      { x: 215, y: 150 },
    ];
    for (const center of centers) {
      drawEllipse(buffer, width, height, center.x, center.y, 10, 10, [236, 238, 242]);
    }
    const result = detect(buffer, width, height);
    expect(result.points.length).toBe(centers.length);
    expectCenters(result.points, centers);
  });

  it('separates coloured pills from a similar-luminance wooden table', () => {
    const width = 260;
    const height = 180;
    const buffer = createImage(width, height, [186, 166, 132]);
    const centers = [
      { x: 50, y: 45 },
      { x: 120, y: 50 },
      { x: 195, y: 42 },
      { x: 75, y: 125 },
      { x: 165, y: 130 },
    ];
    for (const center of centers) {
      drawEllipse(buffer, width, height, center.x, center.y, 10, 10, [96, 118, 190]);
    }
    const result = detect(buffer, width, height);
    expect(result.points.length).toBe(centers.length);
    expectCenters(result.points, centers);
  });

  it('ignores soft cast shadows next to pills', () => {
    const width = 240;
    const height = 170;
    const buffer = createImage(width, height, [248, 247, 244]);
    const centers = [
      { x: 55, y: 55 },
      { x: 130, y: 60 },
      { x: 195, y: 55 },
      { x: 90, y: 125 },
    ];
    for (const center of centers) {
      drawEllipse(buffer, width, height, center.x + 5, center.y + 6, 11, 10, [150, 146, 140], {
        alpha: 0.5,
        softness: 4,
      });
      drawEllipse(buffer, width, height, center.x, center.y, 10, 10, [72, 102, 172]);
    }
    const result = detect(buffer, width, height);
    expect(result.points.length).toBe(centers.length);
    expectCenters(result.points, centers, 5);
  });

  it('fills specular holes inside white pills', () => {
    const width = 200;
    const height = 150;
    const buffer = createImage(width, height, [40, 46, 52]);
    const centers = [
      { x: 55, y: 50 },
      { x: 130, y: 55 },
      { x: 90, y: 110 },
    ];
    for (const center of centers) {
      drawEllipse(buffer, width, height, center.x, center.y, 14, 14, [246, 246, 246]);
      // 药片中心的高光/刻痕被误判成背景时，不能把一粒拆成环形多粒
      drawEllipse(buffer, width, height, center.x, center.y, 5, 5, [40, 46, 52]);
    }
    const result = detect(buffer, width, height);
    expect(result.points.length).toBe(centers.length);
  });
});

describe('pill detection 3.0 — shape & separation', () => {
  it('separates touching and slightly overlapping round pills', () => {
    const width = 260;
    const height = 170;
    const buffer = createImage(width, height, [32, 36, 40]);
    const pairs = [
      [{ x: 70, y: 55 }, { x: 91, y: 55 }],
      [{ x: 170, y: 60 }, { x: 190, y: 60 }],
      [{ x: 115, y: 120 }, { x: 135, y: 120 }],
    ];
    for (const pair of pairs) {
      for (const center of pair) {
        drawEllipse(buffer, width, height, center.x, center.y, 11, 11, [232, 234, 238]);
      }
    }
    const result = detect(buffer, width, height);
    expect(result.points.length).toBe(6);
    expectCenters(result.points, pairs.flat(), 5);
  });

  it('counts each long capsule once instead of splitting it into two pills', () => {
    const width = 280;
    const height = 170;
    const buffer = createImage(width, height, [30, 34, 38]);
    const centers = [
      { x: 70, y: 50 },
      { x: 190, y: 55 },
      { x: 120, y: 120 },
    ];
    for (const center of centers) {
      drawEllipse(buffer, width, height, center.x, center.y, 21, 9, [235, 214, 120]);
    }
    const result = detect(buffer, width, height);
    expect(result.points.length).toBe(centers.length);
    expectCenters(result.points, centers, 5);
  });

  it('counts a tight cluster of pills individually', () => {
    const width = 240;
    const height = 200;
    const buffer = createImage(width, height, [34, 38, 42]);
    const centers = [
      { x: 90, y: 70 },
      { x: 113, y: 70 },
      { x: 79, y: 90 },
      { x: 102, y: 90 },
      { x: 125, y: 90 },
      { x: 90, y: 110 },
      { x: 113, y: 110 },
    ];
    for (const center of centers) {
      drawEllipse(buffer, width, height, center.x, center.y, 10.5, 10.5, [230, 232, 236]);
    }
    const result = detect(buffer, width, height);
    expect(result.points.length).toBe(centers.length);
    expectCenters(result.points, centers, 6);
  });

  it('rejects dust specks while keeping real pills', () => {
    const width = 200;
    const height = 160;
    const buffer = createImage(width, height, [36, 40, 44]);
    const random = mulberry32(11);
    for (let i = 0; i < 30; i += 1) {
      const x = 10 + Math.floor(random() * (width - 20));
      const y = 10 + Math.floor(random() * (height - 20));
      drawEllipse(buffer, width, height, x, y, 1, 1, [230, 230, 230]);
    }
    const centers = [
      { x: 55, y: 50 },
      { x: 140, y: 55 },
      { x: 90, y: 115 },
      { x: 160, y: 120 },
    ];
    for (const center of centers) {
      drawEllipse(buffer, width, height, center.x, center.y, 9, 9, [232, 234, 238]);
    }
    const result = detect(buffer, width, height);
    expect(result.points.length).toBe(centers.length);
    expectCenters(result.points, centers);
  });

  it('is stable under sensor noise', () => {
    const width = 260;
    const height = 190;
    const buffer = createImage(width, height, [48, 54, 58]);
    const centers = [
      { x: 50, y: 50 },
      { x: 120, y: 45 },
      { x: 200, y: 55 },
      { x: 70, y: 130 },
      { x: 160, y: 135 },
      { x: 225, y: 120 },
    ];
    for (const center of centers) {
      drawEllipse(buffer, width, height, center.x, center.y, 10, 10, [225, 227, 232]);
    }
    addNoise(buffer, 9, 3);
    const result = detect(buffer, width, height);
    expect(result.points.length).toBe(centers.length);
  });

  it('returns the same count when the same scene is captured at a larger scale', () => {
    const centers = [
      { x: 55, y: 45 },
      { x: 125, y: 50 },
      { x: 195, y: 44 },
      { x: 80, y: 120 },
      { x: 165, y: 125 },
    ];
    const make = (scale: number) => {
      const width = Math.round(240 * scale);
      const height = Math.round(160 * scale);
      const buffer = createImage(width, height, [30, 35, 40]);
      for (const center of centers) {
        drawEllipse(
          buffer,
          width,
          height,
          center.x * scale,
          center.y * scale,
          9 * scale,
          9 * scale,
          [234, 236, 240],
        );
      }
      return detect(buffer, width, height).points.length;
    };
    expect(make(1)).toBe(centers.length);
    expect(make(2)).toBe(centers.length);
  });

  it('counts randomly scattered pills across many layouts', () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      const random = mulberry32(seed * 97);
      const width = 320;
      const height = 240;
      const buffer = createImage(width, height, [44, 48, 54]);
      const centers: Array<{ x: number; y: number }> = [];
      let guard = 0;
      while (centers.length < 14 && guard < 2000) {
        guard += 1;
        const candidate = {
          x: 20 + Math.round(random() * (width - 40)),
          y: 20 + Math.round(random() * (height - 40)),
        };
        if (centers.some((center) => Math.hypot(center.x - candidate.x, center.y - candidate.y) < 32)) {
          continue;
        }
        centers.push(candidate);
      }
      for (const center of centers) {
        drawEllipse(buffer, width, height, center.x, center.y, 9, 9, [228, 230, 235]);
      }
      addNoise(buffer, 5, seed);
      const result = detect(buffer, width, height);
      expect(result.points.length, `seed ${seed}`).toBe(centers.length);
    }
  });

  it('separates heavily overlapping pills when a waist is still visible', () => {
    const width = 220;
    const height = 140;
    const buffer = createImage(width, height, [30, 34, 40]);
    const centers = [
      { x: 70, y: 70 },
      { x: 98, y: 70 },
    ];
    for (const center of centers) {
      drawEllipse(buffer, width, height, center.x, center.y, 14, 14, [230, 232, 236]);
    }
    const result = detect(buffer, width, height);
    expect(result.points.length).toBe(2);
    expectCenters(result.points, centers, 6);
  });

  it('handles a vignette / off-centre light falloff', () => {
    const width = 300;
    const height = 220;
    const buffer = createImage(width, height, (x, y) => {
      const dx = (x - width * 0.3) / width;
      const dy = (y - height * 0.3) / height;
      const falloff = Math.max(0, 1 - Math.hypot(dx, dy) * 1.4);
      const level = Math.round(70 + falloff * 130);
      return [level, level, level - 4];
    });
    const centers = [
      { x: 60, y: 60 },
      { x: 150, y: 70 },
      { x: 235, y: 90 },
      { x: 90, y: 155 },
      { x: 205, y: 160 },
    ];
    for (const center of centers) {
      drawEllipse(buffer, width, height, center.x, center.y, 10, 10, [242, 242, 244]);
    }
    const result = detect(buffer, width, height);
    expect(result.points.length).toBe(centers.length);
  });

  it('stays fast and accurate on a full-size camera frame with many pills', () => {
    const width = 720;
    const height = 540;
    const buffer = createImage(width, height, [46, 52, 58]);
    const random = mulberry32(2024);
    const centers: Array<{ x: number; y: number }> = [];
    let guard = 0;
    while (centers.length < 42 && guard < 6000) {
      guard += 1;
      const candidate = {
        x: 28 + Math.round(random() * (width - 56)),
        y: 28 + Math.round(random() * (height - 56)),
      };
      if (centers.some((center) => Math.hypot(center.x - candidate.x, center.y - candidate.y) < 62)) {
        continue;
      }
      centers.push(candidate);
    }
    for (const center of centers) {
      drawEllipse(buffer, width, height, center.x, center.y, 16, 16, [226, 228, 233]);
    }
    addNoise(buffer, 6, 5);
    const result = detect(buffer, width, height);
    expect(result.points.length).toBe(centers.length);
    expect(result.elapsedMs).toBeLessThan(1500);
  });

  it('returns zero on an empty textured table', () => {
    const width = 320;
    const height = 240;
    const random = mulberry32(31);
    const buffer = createImage(width, height, (x, y) => {
      const grain = Math.sin(x * 0.15 + y * 0.07) * 10 + Math.sin(x * 0.41) * 4;
      const level = 120 + grain;
      return [level + 14, level + 6, level - 6];
    });
    addNoise(buffer, 7, 17);
    // 几道细划痕
    for (let i = 0; i < 6; i += 1) {
      const x0 = random() * width;
      const y0 = random() * height;
      const angle = random() * Math.PI;
      for (let t = 0; t < 60; t += 1) {
        const x = Math.round(x0 + Math.cos(angle) * t);
        const y = Math.round(y0 + Math.sin(angle) * t);
        if (x < 0 || x >= width || y < 0 || y >= height) break;
        const index = (y * width + x) * 4;
        buffer[index] = 165;
        buffer[index + 1] = 152;
        buffer[index + 2] = 132;
      }
    }
    const result = detect(buffer, width, height);
    expect(result.points.length).toBe(0);
  });

  it('counts pills seated in a blister-style tray', () => {
    const width = 300;
    const height = 240;
    const buffer = createImage(width, height, [232, 234, 238]);
    const columns = 4;
    const rows = 3;
    const centers: Array<{ x: number; y: number }> = [];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const center = { x: 55 + column * 63, y: 60 + row * 62 };
        centers.push(center);
        // 铝塑板的凹槽阴影
        drawEllipse(buffer, width, height, center.x, center.y, 18, 17, [186, 191, 201], {
          softness: 3,
        });
        // 白色药片
        drawEllipse(buffer, width, height, center.x, center.y, 12, 12, [250, 251, 253]);
      }
    }
    const result = detect(buffer, width, height);
    expect(result.points.length).toBe(centers.length);
    expectCenters(result.points, centers, 5);
  });

  it('still finds low-contrast white pills on a light grey table', () => {
    const width = 280;
    const height = 200;
    const buffer = createImage(width, height, [218, 220, 224]);
    const centers = [
      { x: 50, y: 50 },
      { x: 120, y: 55 },
      { x: 200, y: 50 },
      { x: 80, y: 130 },
      { x: 170, y: 135 },
      { x: 240, y: 120 },
    ];
    for (const center of centers) {
      drawEllipse(buffer, width, height, center.x, center.y, 10, 10, [248, 248, 250]);
    }
    const result = detect(buffer, width, height);
    expect(result.points.length).toBe(centers.length);
  });
});
