export interface CropPoint {
  x: number;
  y: number;
}

export type CropCorners = [CropPoint, CropPoint, CropPoint, CropPoint];

const DETECT_MAX_EDGE = 960;
const WARP_MAX_EDGE = 1600;
const MIN_COMPONENT_PIXELS = 48;

export function createDefaultCropCorners(inset = 0.06): CropCorners {
  const edge = clamp(inset, 0, 0.45);
  return [
    { x: edge, y: edge },
    { x: 1 - edge, y: edge },
    { x: 1 - edge, y: 1 - edge },
    { x: edge, y: 1 - edge },
  ];
}

/**
 * Finds the largest document-like edge contour and returns its four corners as
 * normalized coordinates in top-left, top-right, bottom-right, bottom-left order.
 */
export async function detectBoxPhotoCorners(blob: Blob): Promise<CropCorners | null> {
  const bitmap = await decodeForWidth(blob, DETECT_MAX_EDGE);
  try {
    const scale = Math.min(1, DETECT_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(8, Math.round(bitmap.width * scale));
    const height = Math.max(8, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    return detectCornersFromImageData(pixels);
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}

/**
 * Perspective-like crop using inverse bilinear mapping. The input is decoded at
 * a bounded size before sampling so phone photos cannot create an unbounded
 * canvas allocation.
 */
export async function warpPerspectiveQuad(blob: Blob, corners: CropCorners): Promise<Blob> {
  if (!isUsableQuad(corners)) throw new Error('裁切范围太小，请重新调整四个角');

  const bitmap = await decodeForWidth(blob, WARP_MAX_EDGE);
  try {
    const scale = Math.min(1, WARP_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const sourceWidth = Math.max(2, Math.round(bitmap.width * scale));
    const sourceHeight = Math.max(2, Math.round(bitmap.height * scale));
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = sourceWidth;
    sourceCanvas.height = sourceHeight;
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!sourceContext) throw new Error('当前浏览器不能处理这张照片');
    sourceContext.drawImage(bitmap, 0, 0, sourceWidth, sourceHeight);
    const source = sourceContext.getImageData(0, 0, sourceWidth, sourceHeight);

    const sourceCorners = corners.map((point) => ({
      x: clamp(point.x, 0, 1) * (sourceWidth - 1),
      y: clamp(point.y, 0, 1) * (sourceHeight - 1),
    })) as CropCorners;
    const [topLeft, topRight, bottomRight, bottomLeft] = sourceCorners;
    const targetWidth = Math.max(
      2,
      Math.round((distance(topLeft, topRight) + distance(bottomLeft, bottomRight)) / 2),
    );
    const targetHeight = Math.max(
      2,
      Math.round((distance(topLeft, bottomLeft) + distance(topRight, bottomRight)) / 2),
    );
    const outputScale = Math.min(1, WARP_MAX_EDGE / Math.max(targetWidth, targetHeight));
    const width = Math.max(2, Math.round(targetWidth * outputScale));
    const height = Math.max(2, Math.round(targetHeight * outputScale));

    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = width;
    outputCanvas.height = height;
    const outputContext = outputCanvas.getContext('2d');
    if (!outputContext) throw new Error('当前浏览器不能生成裁切照片');
    const output = outputContext.createImageData(width, height);
    resampleQuad(source, output, sourceCorners);
    outputContext.putImageData(output, 0, 0);
    const result = await canvasToJpeg(outputCanvas, 0.9);
    if (!result || result.size === 0) throw new Error('裁切照片生成失败');
    return result;
  } finally {
    bitmap.close();
  }
}

export function isUsableQuad(corners: readonly CropPoint[]): boolean {
  if (corners.length !== 4 || corners.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return false;
  }
  const area = Math.abs(polygonArea(corners));
  if (area < 0.02) return false;
  const crossProducts = corners.map((point, index) => {
    const next = corners[(index + 1) % 4];
    const after = corners[(index + 2) % 4];
    return cross(next, point, after);
  });
  const hasPositive = crossProducts.some((value) => value > 0.0001);
  const hasNegative = crossProducts.some((value) => value < -0.0001);
  return !(hasPositive && hasNegative) && corners.every((point, index) => distance(point, corners[(index + 1) % 4]) > 0.05);
}

export function detectCornersFromImageData(image: ImageData): CropCorners | null {
  const { width, height, data } = image;
  if (width < 8 || height < 8 || data.length < width * height * 4) return null;

  const gray = new Float32Array(width * height);
  for (let i = 0, pixel = 0; pixel < gray.length; i += 4, pixel += 1) {
    gray[pixel] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  }
  const blurred = boxBlur(gray, width, height);
  const magnitude = new Float32Array(width * height);
  let sum = 0;
  let sumSquares = 0;
  let sampleCount = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const gx =
        -blurred[index - width - 1] + blurred[index - width + 1]
        - 2 * blurred[index - 1] + 2 * blurred[index + 1]
        - blurred[index + width - 1] + blurred[index + width + 1];
      const gy =
        -blurred[index - width - 1] - 2 * blurred[index - width] - blurred[index - width + 1]
        + blurred[index + width - 1] + 2 * blurred[index + width] + blurred[index + width + 1];
      const value = Math.hypot(gx, gy);
      magnitude[index] = value;
      if (value > 1) {
        sum += value;
        sumSquares += value * value;
        sampleCount += 1;
      }
    }
  }
  if (sampleCount < MIN_COMPONENT_PIXELS) return detectContrastBounds(gray, width, height);
  const mean = sum / sampleCount;
  const deviation = Math.sqrt(Math.max(0, sumSquares / sampleCount - mean * mean));
  const threshold = Math.max(32, mean + deviation * 0.45);
  const edges = new Uint8Array(width * height);
  for (let y = 2; y < height - 2; y += 1) {
    for (let x = 2; x < width - 2; x += 1) {
      const index = y * width + x;
      if (magnitude[index] < threshold) continue;
      for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
        for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
          edges[index + offsetY * width + offsetX] = 1;
        }
      }
    }
  }

  const component: number[] = [];
  for (let index = 0; index < edges.length; index += 1) {
    if (edges[index]) component.push(index);
  }
  if (component.length < MIN_COMPONENT_PIXELS) return detectContrastBounds(gray, width, height);
  let topLeft = { x: width, y: height };
  let topRight = { x: 0, y: height };
  let bottomRight = { x: 0, y: 0 };
  let bottomLeft = { x: width, y: 0 };
  let minSum = Infinity;
  let maxSum = -Infinity;
  let minDifference = Infinity;
  let maxDifference = -Infinity;
  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;
  for (const index of component) {
    const x = index % width;
    const y = Math.floor(index / width);
    const sumValue = x + y;
    const difference = x - y;
    if (sumValue < minSum) {
      minSum = sumValue;
      topLeft = { x, y };
    }
    if (difference > maxDifference) {
      maxDifference = difference;
      topRight = { x, y };
    }
    if (sumValue > maxSum) {
      maxSum = sumValue;
      bottomRight = { x, y };
    }
    if (difference < minDifference) {
      minDifference = difference;
      bottomLeft = { x, y };
    }
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if ((maxX - minX) * (maxY - minY) < width * height * 0.08) {
    return detectContrastBounds(gray, width, height);
  }

  const normalized = [topLeft, topRight, bottomRight, bottomLeft].map((point) => ({
    x: clamp(point.x / Math.max(1, width - 1), 0, 1),
    y: clamp(point.y / Math.max(1, height - 1), 0, 1),
  })) as CropCorners;
  return isUsableQuad(normalized) && Math.abs(polygonArea(normalized)) >= 0.08
    ? normalized
    : detectContrastBounds(gray, width, height);
}

function detectContrastBounds(gray: Float32Array, width: number, height: number): CropCorners | null {
  let borderSum = 0;
  let borderCount = 0;
  for (let x = 0; x < width; x += 1) {
    borderSum += gray[x] + gray[(height - 1) * width + x];
    borderCount += 2;
  }
  for (let y = 1; y < height - 1; y += 1) {
    borderSum += gray[y * width] + gray[y * width + width - 1];
    borderCount += 2;
  }
  const background = borderSum / Math.max(1, borderCount);
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (Math.abs(gray[y * width + x] - background) < 28) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      count += 1;
    }
  }
  if (count < width * height * 0.01 || (maxX - minX) * (maxY - minY) < width * height * 0.08) {
    return null;
  }
  const denominatorX = Math.max(1, width - 1);
  const denominatorY = Math.max(1, height - 1);
  return [
    { x: minX / denominatorX, y: minY / denominatorY },
    { x: maxX / denominatorX, y: minY / denominatorY },
    { x: maxX / denominatorX, y: maxY / denominatorY },
    { x: minX / denominatorX, y: maxY / denominatorY },
  ];
}

function boxBlur(source: Float32Array, width: number, height: number): Float32Array {
  const output = new Float32Array(source.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      output[index] = (
        source[index - width - 1] + source[index - width] + source[index - width + 1]
        + source[index - 1] + source[index] + source[index + 1]
        + source[index + width - 1] + source[index + width] + source[index + width + 1]
      ) / 9;
    }
  }
  return output;
}

function resampleQuad(source: ImageData, output: ImageData, corners: CropCorners): void {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  const width = output.width;
  const height = output.height;
  for (let y = 0; y < height; y += 1) {
    const v = height === 1 ? 0 : y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const u = width === 1 ? 0 : x / (width - 1);
      const sourceX = bilinear(topLeft.x, topRight.x, bottomRight.x, bottomLeft.x, u, v);
      const sourceY = bilinear(topLeft.y, topRight.y, bottomRight.y, bottomLeft.y, u, v);
      sampleBilinear(source, sourceX, sourceY, output.data, (y * width + x) * 4);
    }
  }
}

function sampleBilinear(source: ImageData, x: number, y: number, target: Uint8ClampedArray, offset: number): void {
  const x0 = clamp(Math.floor(x), 0, source.width - 1);
  const y0 = clamp(Math.floor(y), 0, source.height - 1);
  const x1 = Math.min(source.width - 1, x0 + 1);
  const y1 = Math.min(source.height - 1, y0 + 1);
  const fx = clamp(x - x0, 0, 1);
  const fy = clamp(y - y0, 0, 1);
  const offsets = [
    (y0 * source.width + x0) * 4,
    (y0 * source.width + x1) * 4,
    (y1 * source.width + x0) * 4,
    (y1 * source.width + x1) * 4,
  ];
  for (let channel = 0; channel < 4; channel += 1) {
    target[offset + channel] = bilinear(
      source.data[offsets[0] + channel],
      source.data[offsets[1] + channel],
      source.data[offsets[3] + channel],
      source.data[offsets[2] + channel],
      fx,
      fy,
    );
  }
}

function bilinear(topLeft: number, topRight: number, bottomRight: number, bottomLeft: number, x: number, y: number): number {
  return (1 - y) * ((1 - x) * topLeft + x * topRight) + y * ((1 - x) * bottomLeft + x * bottomRight);
}

function polygonArea(points: readonly CropPoint[]): number {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function cross(a: CropPoint, b: CropPoint, c: CropPoint): number {
  return (a.x - b.x) * (c.y - b.y) - (a.y - b.y) * (c.x - b.x);
}

function distance(a: CropPoint, b: CropPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

async function decodeForWidth(blob: Blob, resizeWidth: number): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { resizeWidth, resizeQuality: 'high' } as ImageBitmapOptions);
  } catch {
    return createImageBitmap(blob);
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
    } catch {
      resolve(null);
    }
  });
}
