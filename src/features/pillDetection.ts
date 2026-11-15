/**
 * 药片视觉清点算法 3.0（纯前端，零依赖）
 *
 * 与旧版「全局亮度阈值 + 固定间距寻峰」相比，3.0 做了四件事：
 * 1. 用分块中值 + 网格中值估计背景色场，抵消台面渐变、阴影、暖光/冷光偏色，不再依赖整图亮度均值；
 * 2. 以「与局部背景的感知色距」作为前景分数，白药片、深色药片、彩色药片都能分开；
 *    药片内部高光/刻痕形成的小孔用 3×3 闭运算封住，细环则按一粒计；
 * 3. 连通域 + 距离变换 + 平台峰值合并 + 鞍点校验：一片药只出一个中心点，
 *    长条形药片不会被拆成两粒，相邻/轻微重叠的药片又不会被并成一粒；
 * 4. 以药片半径自适应所有阈值（面积、峰距、间距），不再写死 8.5px，
 *    因此远近、大小不同的照片都稳定。
 */

import type {
  PillAppearanceCluster,
  PillGridConfig,
  PillGridCorner,
  PillPoint,
  PillROI,
} from './pillEngine';

export type {
  PillPoint,
  PillAppearanceCluster,
  PillGridConfig,
  PillGridCorner,
  PillROI,
};

export interface PillDetectOptions {
  /** 手动敏感度偏移（-50 ~ 50，默认 0；正值更敏感，会多检出弱对比药片） */
  sensitivityOffset?: number;
  /** 兼容旧参数：最小中心间距（像素）。不传时按药片半径自适应。 */
  minSpacing?: number;
  /** 可选局部裁剪区域（整图坐标），仅统计该框内并返回整图坐标。 */
  roi?: PillROI;
}

export interface PillDetectionResult {
  points: PillPoint[];
  elapsedMs: number;
  detectedThresh: number;
  pillRadius: number;
  componentCount: number;
}

interface Component {
  id: number;
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  sumX: number;
  sumY: number;
  maxDist: number;
}

interface Peak {
  x: number;
  y: number;
  d: number;
}

const SQRT2 = Math.SQRT2;
const INF = 1e6;
const SCORE_MAX = 255;

function clockNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

const SRGB_LINEAR_LUT = (() => {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i += 1) {
    const s = i / 255;
    lut[i] = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }
  return lut;
})();

function fLab(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

/** Convert sRGB [0..255] into CIE L*a*b* (D65). */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const ri = SRGB_LINEAR_LUT[clamp(Math.round(r), 0, 255)]!;
  const gi = SRGB_LINEAR_LUT[clamp(Math.round(g), 0, 255)]!;
  const bi = SRGB_LINEAR_LUT[clamp(Math.round(b), 0, 255)]!;

  const x = (ri * 0.4124 + gi * 0.3576 + bi * 0.1805) / 0.95047;
  const y = ri * 0.2126 + gi * 0.7152 + bi * 0.0722;
  const z = (ri * 0.0193 + gi * 0.1192 + bi * 0.9505) / 1.08883;

  const fx = fLab(x);
  const fy = fLab(y);
  const fz = fLab(z);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Euclidean CIE76 Delta-E between two Lab vectors. */
export function labDistance(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

interface CroppedRegion {
  imgData: ImageData;
  offsetX: number;
  offsetY: number;
}

function cropImageDataRegion(imgData: ImageData, roi?: PillROI): CroppedRegion {
  if (!roi) return { imgData, offsetX: 0, offsetY: 0 };
  const x0 = clamp(Math.floor(roi.x), 0, imgData.width);
  const y0 = clamp(Math.floor(roi.y), 0, imgData.height);
  const x1 = clamp(Math.ceil(roi.x + roi.width), x0, imgData.width);
  const y1 = clamp(Math.ceil(roi.y + roi.height), y0, imgData.height);
  const cw = x1 - x0;
  const ch = y1 - y0;
  if (cw < 8 || ch < 8 || (x0 === 0 && y0 === 0 && cw === imgData.width && ch === imgData.height)) {
    return { imgData, offsetX: 0, offsetY: 0 };
  }
  const out = new Uint8ClampedArray(cw * ch * 4);
  const src = imgData.data;
  for (let y = 0; y < ch; y += 1) {
    const srcStart = ((y0 + y) * imgData.width + x0) * 4;
    out.set(src.subarray(srcStart, srcStart + cw * 4), y * cw * 4);
  }
  return {
    imgData: { width: cw, height: ch, data: out, colorSpace: imgData.colorSpace } as ImageData,
    offsetX: x0,
    offsetY: y0,
  };
}

function extractPillPointsFromMask(
  mask: Uint8Array,
  w: number,
  h: number,
  options: { minSpacing?: number; overrideRadius?: number; maxComponentArea?: number } = {},
): { points: PillPoint[]; pillRadius: number; componentCount: number } {
  closePinholes(mask, w, h);

  const { labels, components } = labelComponents(mask, w, h);
  if (components.length === 0) {
    return { points: [], pillRadius: 0, componentCount: 0 };
  }

  const dist = chamferDistance(mask, w, h);
  for (const component of components) {
    let maxDist = 0;
    for (let y = component.minY; y <= component.maxY; y += 1) {
      const row = y * w;
      for (let x = component.minX; x <= component.maxX; x += 1) {
        const idx = row + x;
        if (labels[idx] !== component.id) continue;
        const d = dist[idx]!;
        if (d > maxDist) maxDist = d;
      }
    }
    component.maxDist = Math.min(maxDist, INF);
  }

  const holes = analyzeEnclosedHoles(mask, labels, w, h);

  const pillRadius = options.overrideRadius && options.overrideRadius > 0
    ? options.overrideRadius
    : estimatePillRadius(components, w, h);
  const minArea = Math.max(7, Math.PI * pillRadius * pillRadius * 0.18);
  const minPeakDist = Math.max(1.3, pillRadius * 0.32);
  const maxPeakSpacing = Math.max(2.6, pillRadius * 2.3);
  const minCenterSpacing = options.minSpacing && options.minSpacing > 0
    ? Math.max(2, options.minSpacing)
    : Math.max(2.4, pillRadius * 0.55);
  const minCatchmentArea = Math.max(4, Math.PI * pillRadius * pillRadius * 0.2);

  const rawPoints: Array<{ x: number; y: number }> = [];

  for (const component of components) {
    if (component.area < minArea) continue;
    if (options.maxComponentArea && component.area > options.maxComponentArea) continue;
    if (component.maxDist < Math.max(1.25, pillRadius * 0.42)) continue;

    // 药片内部高光/刻痕形成的「细环」：按一粒计，中心取环+孔洞的合并质心。
    const hole = holes.get(component.id);
    if (
      hole
      && hole.area > 0
      && hole.area <= (component.area + hole.area) * 0.72
      && isThinRing(dist, labels, component, w)
    ) {
      const totalArea = component.area + hole.area;
      rawPoints.push({
        x: (component.sumX + hole.sumX) / totalArea,
        y: (component.sumY + hole.sumY) / totalArea,
      });
      continue;
    }

    const peaks = findComponentPeaks(
      labels,
      dist,
      w,
      component,
      Math.max(1.5, pillRadius * 0.3),
      maxPeakSpacing,
      minPeakDist,
    );

    if (peaks.length === 0) {
      rawPoints.push({
        x: component.sumX / component.area,
        y: component.sumY / component.area,
      });
      continue;
    }

    // 每个峰分配其最近的前景像素，用簇质心作为药片中心（比单个峰点更稳）。
    const clusters = peaks.map(() => ({ area: 0, sumX: 0, sumY: 0 }));
    for (let y = component.minY; y <= component.maxY; y += 1) {
      const row = y * w;
      for (let x = component.minX; x <= component.maxX; x += 1) {
        const idx = row + x;
        if (labels[idx] !== component.id) continue;
        let best = 0;
        let bestDist = Infinity;
        for (let k = 0; k < peaks.length; k += 1) {
          const dx = peaks[k]!.x - x;
          const dy = peaks[k]!.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestDist) {
            bestDist = d2;
            best = k;
          }
        }
        const cluster = clusters[best]!;
        cluster.area += 1;
        cluster.sumX += x;
        cluster.sumY += y;
      }
    }

    let accepted = clusters.filter((cluster) => cluster.area >= minCatchmentArea);
    if (accepted.length === 0) {
      // 细小边缘残留：退回整块连通域质心，只算一粒。
      rawPoints.push({
        x: component.sumX / component.area,
        y: component.sumY / component.area,
      });
      continue;
    }

    // 面积上限防御：任何连通域最多按「半粒面积」推算数量，杜绝噪点裂峰导致的离谱多算。
    const hardCap = Math.max(1, Math.ceil(component.area / (Math.PI * pillRadius * pillRadius * 0.45)));
    if (accepted.length > hardCap) {
      accepted = [...accepted].sort((a, b) => b.area - a.area).slice(0, hardCap);
    }

    for (const cluster of accepted) {
      rawPoints.push({
        x: cluster.sumX / cluster.area,
        y: cluster.sumY / cluster.area,
      });
    }
  }

  // 全局最小间距合并：同一次清点里不允许出现两个中心几乎重合的「药片」。
  rawPoints.sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: Array<{ x: number; y: number }> = [];
  for (const point of rawPoints) {
    const duplicate = merged.some(
      (kept) => Math.hypot(kept.x - point.x, kept.y - point.y) < minCenterSpacing,
    );
    if (!duplicate) merged.push(point);
  }

  const points: PillPoint[] = merged.map((point, index) => ({
    x: Math.round(point.x),
    y: Math.round(point.y),
    id: index + 1,
    isManual: false,
  }));

  return { points, pillRadius, componentCount: components.length };
}

/**
 * 从 ImageData 中检测药片中心坐标。
 */
export function detectPillsFromImageData(
  imgData: ImageData,
  options: PillDetectOptions = {},
): PillDetectionResult {
  const started = clockNow();
  const cropped = cropImageDataRegion(imgData, options.roi);
  const target = cropped.imgData;
  const w = target.width;
  const h = target.height;
  const data = target.data;
  const total = w * h;
  const empty: PillDetectionResult = {
    points: [],
    elapsedMs: 0,
    detectedThresh: 0,
    pillRadius: 0,
    componentCount: 0,
  };
  if (w < 8 || h < 8 || total <= 0) return empty;

  const field = estimateBackgroundField(data, w, h);
  const score = computeForegroundScore(data, w, h, field);
  const histogram = buildScoreHistogram(score);
  let threshold = clamp(Math.max(otsuThreshold(histogram, total) * 0.68, 24), 24, 120);
  const userOffset = clamp(options.sensitivityOffset ?? 0, -50, 50);
  threshold = clamp(threshold - userOffset * 0.45, 12, 150);

  // 阈值自校准：背景被误判成前景（或药片几乎全被漏掉）时，往回收一档。
  let mask = buildMask(score, w, h, threshold);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const coverage = countForeground(mask);
    if (coverage > 0.55) {
      threshold = clamp(threshold * 1.35, 14, 170);
      mask = buildMask(score, w, h, threshold);
      continue;
    }
    if (coverage < 0.0012 && threshold > 26) {
      threshold = clamp(threshold * 0.85, 24, 170);
      mask = buildMask(score, w, h, threshold);
      continue;
    }
    break;
  }

  const extracted = extractPillPointsFromMask(mask, w, h, { minSpacing: options.minSpacing });
  const points = (cropped.offsetX !== 0 || cropped.offsetY !== 0)
    ? extracted.points.map((pt) => ({ ...pt, x: pt.x + cropped.offsetX, y: pt.y + cropped.offsetY }))
    : extracted.points;

  return {
    points,
    elapsedMs: clockNow() - started,
    detectedThresh: threshold,
    pillRadius: extracted.pillRadius,
    componentCount: extracted.componentCount,
  };
}

/* ------------------------------------------------------------------ */
/* 背景色场：分块逐通道中值，抗药片遮挡与光照渐变                        */
/* ------------------------------------------------------------------ */

interface BackgroundField {
  cell: number;
  gw: number;
  gh: number;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
}

function estimateBackgroundField(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): BackgroundField {
  const cell = clamp(Math.round(Math.min(w, h) / 10), 12, 64);
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const count = gw * gh;
  const fieldR = new Float32Array(count);
  const fieldG = new Float32Array(count);
  const fieldB = new Float32Array(count);
  const valid = new Uint8Array(count);

  const step = cell >= 30 ? 3 : 2;
  const maxSamples = Math.ceil(cell / step + 1) * Math.ceil(cell / step + 1);
  const scratchR = new Float32Array(maxSamples);
  const scratchG = new Float32Array(maxSamples);
  const scratchB = new Float32Array(maxSamples);

  for (let gy = 0; gy < gh; gy += 1) {
    const y0 = gy * cell;
    const y1 = Math.min(h, y0 + cell);
    for (let gx = 0; gx < gw; gx += 1) {
      const x0 = gx * cell;
      const x1 = Math.min(w, x0 + cell);
      let samples = 0;
      for (let y = y0; y < y1; y += step) {
        const row = y * w;
        for (let x = x0; x < x1; x += step) {
          if (samples >= maxSamples) break;
          const idx = (row + x) * 4;
          scratchR[samples] = data[idx]!;
          scratchG[samples] = data[idx + 1]!;
          scratchB[samples] = data[idx + 2]!;
          samples += 1;
        }
      }
      const cellIndex = gy * gw + gx;
      if (samples < 5) continue;
      scratchR.subarray(0, samples).sort();
      scratchG.subarray(0, samples).sort();
      scratchB.subarray(0, samples).sort();
      const mid = samples >> 1;
      fieldR[cellIndex] = scratchR[mid]!;
      fieldG[cellIndex] = scratchG[mid]!;
      fieldB[cellIndex] = scratchB[mid]!;
      valid[cellIndex] = 1;
    }
  }

  // 无效块用最近的有效块颜色扩散补齐。
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < count; i += 1) {
    if (valid[i]) queue[tail++] = i;
  }
  if (tail === 0) {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 16) {
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
      n += 1;
    }
    r /= Math.max(1, n);
    g /= Math.max(1, n);
    b /= Math.max(1, n);
    fieldR.fill(r);
    fieldG.fill(g);
    fieldB.fill(b);
    valid.fill(1);
  } else {
    while (head < tail) {
      const index = queue[head++]!;
      const gx = index % gw;
      const gy = (index - gx) / gw;
      const neighbors = [
        gy > 0 ? index - gw : -1,
        gy < gh - 1 ? index + gw : -1,
        gx > 0 ? index - 1 : -1,
        gx < gw - 1 ? index + 1 : -1,
      ];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || valid[neighbor]) continue;
        fieldR[neighbor] = fieldR[index]!;
        fieldG[neighbor] = fieldG[index]!;
        fieldB[neighbor] = fieldB[index]!;
        valid[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }
  }

  // 5×5 网格中值：把「整块落在药片/药堆里」的块值替换成周围台面颜色，
  // 同时保留光照与阴影的缓慢变化。
  const filteredR = new Float32Array(count);
  const filteredG = new Float32Array(count);
  const filteredB = new Float32Array(count);
  const windowSize = 25;
  const windowR = new Float32Array(windowSize);
  const windowG = new Float32Array(windowSize);
  const windowB = new Float32Array(windowSize);
  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      let n = 0;
      for (let dy = -2; dy <= 2; dy += 1) {
        const ny = clamp(gy + dy, 0, gh - 1);
        for (let dx = -2; dx <= 2; dx += 1) {
          const nx = clamp(gx + dx, 0, gw - 1);
          const index = ny * gw + nx;
          windowR[n] = fieldR[index]!;
          windowG[n] = fieldG[index]!;
          windowB[n] = fieldB[index]!;
          n += 1;
        }
      }
      windowR.subarray(0, n).sort();
      windowG.subarray(0, n).sort();
      windowB.subarray(0, n).sort();
      const mid = n >> 1;
      const index = gy * gw + gx;
      filteredR[index] = windowR[mid]!;
      filteredG[index] = windowG[mid]!;
      filteredB[index] = windowB[mid]!;
    }
  }

  return { cell, gw, gh, r: filteredR, g: filteredG, b: filteredB };
}

/** 逐像素计算与局部背景的感知色距（0~255）。 */
function computeForegroundScore(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  field: BackgroundField,
): Float32Array {
  const score = new Float32Array(w * h);
  const { cell, gw, gh, r: fieldR, g: fieldG, b: fieldB } = field;
  for (let y = 0; y < h; y += 1) {
    const gy = y / cell - 0.5;
    let y0 = Math.floor(gy);
    const ty = gy - y0;
    y0 = clamp(y0, 0, gh - 1);
    const y1 = Math.min(gh - 1, y0 + 1);
    const row = y * w;
    for (let x = 0; x < w; x += 1) {
      const gx = x / cell - 0.5;
      let x0 = Math.floor(gx);
      const tx = gx - x0;
      x0 = clamp(x0, 0, gw - 1);
      const x1 = Math.min(gw - 1, x0 + 1);
      const i00 = y0 * gw + x0;
      const i10 = y0 * gw + x1;
      const i01 = y1 * gw + x0;
      const i11 = y1 * gw + x1;
      const w00 = (1 - tx) * (1 - ty);
      const w10 = tx * (1 - ty);
      const w01 = (1 - tx) * ty;
      const w11 = tx * ty;
      const bgR = fieldR[i00]! * w00 + fieldR[i10]! * w10 + fieldR[i01]! * w01 + fieldR[i11]! * w11;
      const bgG = fieldG[i00]! * w00 + fieldG[i10]! * w10 + fieldG[i01]! * w01 + fieldG[i11]! * w11;
      const bgB = fieldB[i00]! * w00 + fieldB[i10]! * w10 + fieldB[i01]! * w01 + fieldB[i11]! * w11;
      const idx = (row + x) * 4;
      const pr = data[idx]!;
      const pg = data[idx + 1]!;
      const pb = data[idx + 2]!;
      const dr = pr - bgR;
      const dg = pg - bgG;
      const db = pb - bgB;
      const rgbScore = Math.sqrt(0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db);
      const labScore = labDistance(rgbToLab(pr, pg, pb), rgbToLab(bgR, bgG, bgB)) * 2.45;
      score[row + x] = rgbScore >= labScore ? rgbScore : labScore;
    }
  }
  return score;
}

function buildScoreHistogram(score: Float32Array): Int32Array {
  const histogram = new Int32Array(SCORE_MAX + 1);
  for (let i = 0; i < score.length; i += 1) {
    const value = score[i]!;
    histogram[value >= SCORE_MAX ? SCORE_MAX : value | 0]! += 1;
  }
  return histogram;
}

function otsuThreshold(histogram: Int32Array, total: number): number {
  let sum = 0;
  for (let i = 0; i <= SCORE_MAX; i += 1) sum += i * histogram[i]!;
  let sumBackground = 0;
  let weightBackground = 0;
  let best = 0;
  let threshold = 0;
  for (let t = 0; t <= SCORE_MAX; t += 1) {
    weightBackground += histogram[t]!;
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground <= 0) break;
    sumBackground += t * histogram[t]!;
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const between = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

function buildMask(score: Float32Array, w: number, h: number, threshold: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < score.length; i += 1) {
    if (score[i]! > threshold) mask[i] = 1;
  }
  return mask;
}

function countForeground(mask: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i]) count += 1;
  }
  return count / mask.length;
}

/**
 * 3×3 闭运算：只封住药片高光/刻痕造成的 1~2px 针孔，
 * 不会像整幅孔洞填充那样把药片之间的缝隙抹平（那会让成堆药片被数成一粒）。
 */
function closePinholes(mask: Uint8Array, w: number, h: number): void {
  const dilated = new Uint8Array(mask.length);
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    for (let x = 0; x < w; x += 1) {
      const index = row + x;
      if (mask[index]) {
        dilated[index] = 1;
        continue;
      }
      let hit = 0;
      for (let dy = -1; dy <= 1 && !hit; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          if (mask[ny * w + nx]) {
            hit = 1;
            break;
          }
        }
      }
      if (hit) dilated[index] = 1;
    }
  }
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    for (let x = 0; x < w; x += 1) {
      const index = row + x;
      if (!dilated[index]) continue;
      let keep = 1;
      for (let dy = -1; dy <= 1 && keep; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          if (!dilated[ny * w + nx]) {
            keep = 0;
            break;
          }
        }
      }
      if (keep) mask[index] = 1;
    }
  }
}

interface HoleInfo {
  area: number;
  sumX: number;
  sumY: number;
}

/**
 * 找出被前景完全包围的背景孔洞，并归属到包住它的连通域。
 * 只用于识别「药片内部高光/刻痕」这类细环，不会改动前景掩膜本身。
 */
function analyzeEnclosedHoles(
  mask: Uint8Array,
  labels: Int32Array,
  w: number,
  h: number,
): Map<number, HoleInfo> {
  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const push = (index: number) => {
    if (visited[index] || mask[index]) return;
    visited[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < w; x += 1) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y += 1) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (head < tail) {
    const index = queue[head++]!;
    const x = index % w;
    if (x > 0) push(index - 1);
    if (x < w - 1) push(index + 1);
    if (index >= w) push(index - w);
    if (index + w < w * h) push(index + w);
  }

  const holes = new Map<number, HoleInfo>();
  const tally = new Map<number, number>();
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] || visited[start]) continue;
    head = 0;
    tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    tally.clear();
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    while (head < tail) {
      const index = queue[head++]!;
      const x = index % w;
      const y = (index - x) / w;
      area += 1;
      sumX += x;
      sumY += y;
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x < w - 1 ? index + 1 : -1,
        y > 0 ? index - w : -1,
        y < h - 1 ? index + w : -1,
      ];
      for (const neighbor of neighbors) {
        if (neighbor < 0) continue;
        if (mask[neighbor]) {
          const label = labels[neighbor]!;
          if (label > 0) tally.set(label, (tally.get(label) ?? 0) + 1);
          continue;
        }
        if (visited[neighbor]) continue;
        visited[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }
    let owner = 0;
    let ownerCount = 0;
    for (const [label, count] of tally) {
      if (count > ownerCount) {
        owner = label;
        ownerCount = count;
      }
    }
    if (owner === 0) continue;
    const existing = holes.get(owner);
    if (existing) {
      existing.area += area;
      existing.sumX += sumX;
      existing.sumY += sumY;
    } else {
      holes.set(owner, { area, sumX, sumY });
    }
  }
  return holes;
}

/** 细环判定：连通域的距离变换分布很窄（环状），而不是实心药片/药堆。 */
function isThinRing(
  dist: Float32Array,
  labels: Int32Array,
  component: Component,
  w: number,
): boolean {
  const values: number[] = [];
  for (let y = component.minY; y <= component.maxY; y += 1) {
    const row = y * w;
    for (let x = component.minX; x <= component.maxX; x += 1) {
      const index = row + x;
      if (labels[index] === component.id) values.push(dist[index]!);
    }
  }
  if (values.length < 24) return false;
  values.sort((a, b) => a - b);
  const p50 = values[values.length >> 1]!;
  const p90 = values[Math.min(values.length - 1, Math.floor(values.length * 0.9))]!;
  return p90 > 0.8 && p90 / Math.max(0.6, p50) < 1.9;
}

function labelComponents(
  mask: Uint8Array,
  w: number,
  h: number,
): { labels: Int32Array; components: Component[] } {
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const components: Component[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || labels[start]) continue;
    const id = components.length + 1;
    let top = 0;
    stack[top++] = start;
    labels[start] = id;
    let area = 0;
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    let sumX = 0;
    let sumY = 0;
    while (top > 0) {
      const index = stack[--top]!;
      const x = index % w;
      const y = (index - x) / w;
      area += 1;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const left = x > 0;
      const right = x < w - 1;
      const up = y > 0;
      const down = y < h - 1;
      for (let dy = -1; dy <= 1; dy += 1) {
        if ((dy < 0 && !up) || (dy > 0 && !down)) continue;
        const row = index + dy * w;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          if ((dx < 0 && !left) || (dx > 0 && !right)) continue;
          const neighbor = row + dx;
          if (labels[neighbor] || !mask[neighbor]) continue;
          labels[neighbor] = id;
          stack[top++] = neighbor;
        }
      }
    }
    components.push({ id, area, minX, minY, maxX, maxY, sumX, sumY, maxDist: 0 });
  }
  return { labels, components };
}

/** 两遍 Chamfer 距离变换（1 / √2 近似欧氏距离）。 */
function chamferDistance(mask: Uint8Array, w: number, h: number): Float32Array {
  const dist = new Float32Array(w * h);
  for (let i = 0; i < dist.length; i += 1) {
    dist[i] = mask[i] ? INF : 0;
  }
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    for (let x = 0; x < w; x += 1) {
      const index = row + x;
      if (!mask[index]) continue;
      let d = dist[index]!;
      if (x > 0) d = Math.min(d, dist[index - 1]! + 1);
      if (y > 0) {
        d = Math.min(d, dist[index - w]! + 1);
        if (x > 0) d = Math.min(d, dist[index - w - 1]! + SQRT2);
        if (x < w - 1) d = Math.min(d, dist[index - w + 1]! + SQRT2);
      }
      dist[index] = d;
    }
  }
  for (let y = h - 1; y >= 0; y -= 1) {
    const row = y * w;
    for (let x = w - 1; x >= 0; x -= 1) {
      const index = row + x;
      if (!mask[index]) continue;
      let d = dist[index]!;
      if (x < w - 1) d = Math.min(d, dist[index + 1]! + 1);
      if (y < h - 1) {
        d = Math.min(d, dist[index + w]! + 1);
        if (x < w - 1) d = Math.min(d, dist[index + w + 1]! + SQRT2);
        if (x > 0) d = Math.min(d, dist[index + w - 1]! + SQRT2);
      }
      dist[index] = d;
    }
  }
  for (let i = 0; i < dist.length; i += 1) {
    if (dist[i]! > INF) dist[i] = INF;
  }
  return dist;
}

function estimatePillRadius(components: Component[], w: number, h: number): number {
  const singleCandidates: number[] = [];
  const thicknessCandidates: number[] = [];
  for (const component of components) {
    if (component.area < 10 || component.maxDist < 1.8) continue;
    const radiusFromArea = Math.sqrt(component.area / Math.PI);
    const compactness = component.area / (Math.PI * component.maxDist * component.maxDist);
    if (compactness >= 0.5 && compactness <= 1.7 && radiusFromArea <= Math.min(w, h) / 7) {
      singleCandidates.push(radiusFromArea);
    }
    thicknessCandidates.push(component.maxDist);
  }
  const minDim = Math.min(w, h);
  const upper = minDim / 6;
  if (singleCandidates.length >= 2) {
    return clamp(medianOf(singleCandidates), 2.5, upper);
  }
  if (singleCandidates.length === 1) {
    return clamp(medianOf([singleCandidates[0]!, percentile(thicknessCandidates, 0.9)]), 2.5, upper);
  }
  if (thicknessCandidates.length > 0) {
    const guess = percentile(thicknessCandidates, 0.9);
    // 全是划痕/木纹这类细长纹理时，p90 也会很小；此时按画面尺寸兜底，
    // 避免把纹理当成「小药片」从而放大出成百上千个假点。
    if (guess >= minDim * 0.015) return clamp(guess, 2.5, upper);
  }
  return clamp(minDim * 0.025, 2.5, upper);
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.round((sorted.length - 1) * ratio), 0, sorted.length - 1);
  return sorted[index]!;
}

function findComponentPeaks(
  labels: Int32Array,
  dist: Float32Array,
  w: number,
  component: Component,
  mergeRadius: number,
  maxSpacing: number,
  minPeakDist: number,
): Peak[] {
  const candidates: Peak[] = [];
  const height = labels.length / w;
  for (let y = component.minY; y <= component.maxY; y += 1) {
    const row = y * w;
    for (let x = component.minX; x <= component.maxX; x += 1) {
      const index = row + x;
      if (labels[index] !== component.id) continue;
      const d = dist[index]!;
      if (d < minPeakDist) continue;
      let isPeak = true;
      for (let dy = -1; dy <= 1 && isPeak; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          if (dist[ny * w + nx]! > d + 0.01) {
            isPeak = false;
            break;
          }
        }
      }
      if (isPeak) candidates.push({ x, y, d });
    }
  }

  candidates.sort((a, b) => b.d - a.d);
  const kept: Peak[] = [];
  for (const candidate of candidates) {
    let duplicate = false;
    for (const peak of kept) {
      const separation = Math.hypot(peak.x - candidate.x, peak.y - candidate.y);
      if (separation < mergeRadius) {
        duplicate = true;
        break;
      }
      if (separation <= maxSpacing) {
        const saddle = lineSaddle(dist, w, candidate, peak);
        // 两个峰之间若没有明显「腰部」，说明是同一片长条药，而不是两粒相碰。
        if (saddle >= 0.82 * Math.min(peak.d, candidate.d)) {
          duplicate = true;
          break;
        }
      }
    }
    if (!duplicate) kept.push(candidate);
  }
  return kept;
}

function lineSaddle(dist: Float32Array, w: number, a: Peak, b: Peak): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  let saddle = Infinity;
  for (let step = 1; step < steps; step += 1) {
    const t = step / steps;
    const x = Math.round(a.x + dx * t);
    const y = Math.round(a.y + dy * t);
    const value = dist[y * w + x]!;
    if (value < saddle) saddle = value;
  }
  return saddle === Infinity ? 0 : saddle;
}

/* ------------------------------------------------------------------ */
/* 4.0 本地交互式增强：样本区域生长、整板透视网格、混装外观聚类                */
/* ------------------------------------------------------------------ */

export interface PillSampleDetectOptions extends PillDetectOptions {
  /** 允许用户微调样本色彩宽容度（正值宽松，负值收敛）。 */
  colorToleranceOffset?: number;
}

interface SampleColorModel {
  meanRgb: [number, number, number];
  meanLab: [number, number, number];
  rgbTol: number;
  labTol: number;
  radius: number;
  area: number;
}

function samplePatchMeanRgb(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  halfSize = 1,
): [number, number, number] {
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  const x0 = clamp(Math.round(cx) - halfSize, 0, w - 1);
  const x1 = clamp(Math.round(cx) + halfSize, 0, w - 1);
  const y0 = clamp(Math.round(cy) - halfSize, 0, h - 1);
  const y1 = clamp(Math.round(cy) + halfSize, 0, h - 1);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const idx = (y * w + x) * 4;
      sumR += data[idx]!;
      sumG += data[idx + 1]!;
      sumB += data[idx + 2]!;
      count += 1;
    }
  }
  if (count === 0) return [0, 0, 0];
  return [sumR / count, sumG / count, sumB / count];
}

function buildSampleModel(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  field: BackgroundField,
  sx: number,
  sy: number,
  colorOffset: number,
): SampleColorModel {
  const seedX = clamp(Math.round(sx), 0, w - 1);
  const seedY = clamp(Math.round(sy), 0, h - 1);
  const seedRgb = samplePatchMeanRgb(data, w, h, seedX, seedY, 1);
  const seedLab = rgbToLab(seedRgb[0], seedRgb[1], seedRgb[2]);

  // Estimate local background color at seed using bilinear interpolation on field
  const gx = clamp(seedX / field.cell - 0.5, 0, field.gw - 1);
  const gy = clamp(seedY / field.cell - 0.5, 0, field.gh - 1);
  const bgIdx = Math.round(gy) * field.gw + Math.round(gx);
  const bgRgb: [number, number, number] = [
    field.r[bgIdx] ?? seedRgb[0],
    field.g[bgIdx] ?? seedRgb[1],
    field.b[bgIdx] ?? seedRgb[2],
  ];
  const bgLab = rgbToLab(bgRgb[0], bgRgb[1], bgRgb[2]);
  const bgDeltaRgb = Math.hypot(
    seedRgb[0] - bgRgb[0],
    seedRgb[1] - bgRgb[1],
    seedRgb[2] - bgRgb[2],
  );
  const bgDeltaLab = labDistance(seedLab, bgLab);

  const growRgbCap = bgDeltaRgb > 14 ? Math.min(26, bgDeltaRgb * 0.45) : 18;
  const growLabCap = bgDeltaLab > 7 ? Math.min(13, bgDeltaLab * 0.55) : 9;

  const maxRadius = Math.max(24, Math.round(Math.min(w, h) * 0.18));
  const maxPixels = Math.min(8000, Math.round(w * h * 0.12));
  const visited = new Uint8Array(w * h);
  const queueX = new Int32Array(maxPixels);
  const queueY = new Int32Array(maxPixels);
  const grownIndices: number[] = [];

  let head = 0;
  let tail = 0;
  const startIdx = seedY * w + seedX;
  visited[startIdx] = 1;
  queueX[tail] = seedX;
  queueY[tail] = seedY;
  tail += 1;

  while (head < tail && grownIndices.length < maxPixels) {
    const cx = queueX[head]!;
    const cy = queueY[head]!;
    head += 1;
    const pIdx = cy * w + cx;
    grownIndices.push(pIdx);

    const neighbors = [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ];
    for (const pair of neighbors) {
      const nx = pair[0]!;
      const ny = pair[1]!;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (Math.hypot(nx - seedX, ny - seedY) > maxRadius) continue;
      const nIdx = ny * w + nx;
      if (visited[nIdx]) continue;
      const off = nIdx * 4;
      const r = data[off]!;
      const g = data[off + 1]!;
      const b = data[off + 2]!;
      const rgbDist = Math.hypot(r - seedRgb[0], g - seedRgb[1], b - seedRgb[2]);
      if (rgbDist > growRgbCap && labDistance(rgbToLab(r, g, b), seedLab) > growLabCap) {
        continue;
      }
      visited[nIdx] = 1;
      if (tail < maxPixels) {
        queueX[tail] = nx;
        queueY[tail] = ny;
        tail += 1;
      }
    }
  }

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  const count = Math.max(1, grownIndices.length);
  for (const pIdx of grownIndices) {
    const off = pIdx * 4;
    sumR += data[off]!;
    sumG += data[off + 1]!;
    sumB += data[off + 2]!;
  }
  const meanRgb: [number, number, number] = [sumR / count, sumG / count, sumB / count];
  const meanLab = rgbToLab(meanRgb[0], meanRgb[1], meanRgb[2]);

  const rgbSpreads: number[] = [];
  const labSpreads: number[] = [];
  for (const pIdx of grownIndices) {
    const off = pIdx * 4;
    const r = data[off]!;
    const g = data[off + 1]!;
    const b = data[off + 2]!;
    rgbSpreads.push(Math.hypot(r - meanRgb[0], g - meanRgb[1], b - meanRgb[2]));
    labSpreads.push(labDistance(rgbToLab(r, g, b), meanLab));
  }

  const p90Rgb = rgbSpreads.length > 0 ? percentile(rgbSpreads, 0.9) : 12;
  const p90Lab = labSpreads.length > 0 ? percentile(labSpreads, 0.9) : 6;
  const adj = clamp(colorOffset, -40, 40) * 0.35;

  let rgbTol = clamp(Math.max(18, p90Rgb * 2.1 + adj), 14, 52);
  let labTol = clamp(Math.max(8, p90Lab * 2.1 + adj * 0.45), 6, 26);

  if (bgDeltaRgb > 16) {
    rgbTol = Math.min(rgbTol, bgDeltaRgb * 0.62);
  }
  if (bgDeltaLab > 6.5) {
    labTol = Math.min(labTol, bgDeltaLab * 0.65);
  }

  const area = grownIndices.length > 16 && grownIndices.length < maxPixels * 0.85
    ? grownIndices.length
    : Math.PI * 100;
  const radius = clamp(Math.sqrt(area / Math.PI), 4, Math.min(w, h) * 0.16);

  return { meanRgb, meanLab, rgbTol, labTol, radius, area };
}

/**
 * Sample-calibrated local pill detector: users tap one or more sample pills and
 * all matching pills across the scene (or ROI) are isolated even in high clutter.
 */
export function detectPillsFromSample(
  imgData: ImageData,
  samplePoints: readonly { x: number; y: number }[],
  options: PillSampleDetectOptions = {},
): PillDetectionResult {
  const started = clockNow();
  if (!samplePoints || samplePoints.length === 0) {
    return detectPillsFromImageData(imgData, options);
  }

  const cropped = cropImageDataRegion(imgData, options.roi);
  const target = cropped.imgData;
  const w = target.width;
  const h = target.height;
  const data = target.data;
  const total = w * h;
  if (w < 8 || h < 8 || total <= 0) {
    return { points: [], elapsedMs: 0, detectedThresh: 0, pillRadius: 0, componentCount: 0 };
  }

  const localSamples = samplePoints
    .map((p) => ({ x: p.x - cropped.offsetX, y: p.y - cropped.offsetY }))
    .filter((p) => p.x >= 0 && p.y >= 0 && p.x < w && p.y < h);
  if (localSamples.length === 0) {
    return detectPillsFromImageData(imgData, options);
  }

  const field = estimateBackgroundField(data, w, h);
  const colorOffset = options.colorToleranceOffset ?? options.sensitivityOffset ?? 0;
  const models = localSamples.map((s) =>
    buildSampleModel(data, w, h, field, s.x, s.y, colorOffset),
  );

  const mask = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    const off = i * 4;
    const r = data[off]!;
    const g = data[off + 1]!;
    const b = data[off + 2]!;
    const lab = rgbToLab(r, g, b);
    for (const model of models) {
      const rgbDist = Math.hypot(
        r - model.meanRgb[0],
        g - model.meanRgb[1],
        b - model.meanRgb[2],
      );
      if (rgbDist <= model.rgbTol || labDistance(lab, model.meanLab) <= model.labTol) {
        mask[i] = 1;
        break;
      }
    }
  }

  const medianRadius = medianOf(models.map((m) => m.radius));
  const maxSampleArea = Math.max(...models.map((m) => m.area));
  const extracted = extractPillPointsFromMask(mask, w, h, {
    minSpacing: options.minSpacing,
    overrideRadius: medianRadius,
    maxComponentArea: Math.max(maxSampleArea * 12, total * 0.28),
  });

  const points = (cropped.offsetX !== 0 || cropped.offsetY !== 0)
    ? extracted.points.map((pt) => ({ ...pt, x: pt.x + cropped.offsetX, y: pt.y + cropped.offsetY }))
    : extracted.points;

  return {
    points,
    elapsedMs: clockNow() - started,
    detectedThresh: Math.round(models[0]?.labTol ?? 0),
    pillRadius: extracted.pillRadius,
    componentCount: extracted.componentCount,
  };
}

export interface EvaluateBlisterGridOptions {
  rows: number;
  cols: number;
  corners?: [PillGridCorner, PillGridCorner, PillGridCorner, PillGridCorner];
  sensitivityOffset?: number;
}

function interpolateQuad(
  corners: [PillGridCorner, PillGridCorner, PillGridCorner, PillGridCorner],
  u: number,
  v: number,
): PillGridCorner {
  const [tl, tr, br, bl] = corners;
  const wTL = (1 - u) * (1 - v);
  const wTR = u * (1 - v);
  const wBR = u * v;
  const wBL = (1 - u) * v;
  return {
    x: tl.x * wTL + tr.x * wTR + br.x * wBR + bl.x * wBL,
    y: tl.y * wTL + tr.y * wTR + br.y * wBR + bl.y * wBL,
  };
}

/**
 * Evaluate each pocket of an M x N blister grid mapped across arbitrary four corners,
 * distinguishing filled pills/capsules from empty crushed cavities.
 */
export function evaluateBlisterGrid(
  imgData: ImageData,
  options: EvaluateBlisterGridOptions,
): { grid: PillGridConfig; points: PillPoint[] } {
  const rows = clamp(Math.round(options.rows), 1, 20);
  const cols = clamp(Math.round(options.cols), 1, 20);
  const w = imgData.width;
  const h = imgData.height;
  const data = imgData.data;

  const corners: [PillGridCorner, PillGridCorner, PillGridCorner, PillGridCorner] =
    options.corners ?? [
      { x: Math.round(w * 0.08), y: Math.round(h * 0.08) },
      { x: Math.round(w * 0.92), y: Math.round(h * 0.08) },
      { x: Math.round(w * 0.92), y: Math.round(h * 0.92) },
      { x: Math.round(w * 0.08), y: Math.round(h * 0.92) },
    ];

  if (w < 8 || h < 8) {
    const emptyCells = new Array(rows * cols).fill(false) as boolean[];
    return { grid: { rows, cols, corners, cells: emptyCells }, points: [] };
  }

  interface CellStat {
    r: number;
    c: number;
    cx: number;
    cy: number;
    signal: number;
    foilDelta: number;
  }

  // Estimate blister foil baseline from grid border dividers
  const borderL: number[] = [];
  const borderA: number[] = [];
  const borderB: number[] = [];
  const sampleAtUv = (u: number, v: number): [number, number, number] => {
    const pt = interpolateQuad(corners, u, v);
    const px = clamp(Math.round(pt.x), 0, w - 1);
    const py = clamp(Math.round(pt.y), 0, h - 1);
    const idx = (py * w + px) * 4;
    return [data[idx]!, data[idx + 1]!, data[idx + 2]!];
  };

  for (let rr = 0; rr <= rows; rr += 1) {
    const v = rr / rows;
    for (let s = 1; s < cols * 2; s += 2) {
      const u = s / (cols * 2);
      const [lr, la, lb] = rgbToLab(...sampleAtUv(u, v));
      borderL.push(lr);
      borderA.push(la);
      borderB.push(lb);
    }
  }
  const foilLab: [number, number, number] = [
    medianOf(borderL),
    medianOf(borderA),
    medianOf(borderB),
  ];

  const stats: CellStat[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cu = (c + 0.5) / cols;
      const cv = (r + 0.5) / rows;
      const center = interpolateQuad(corners, cu, cv);

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let samples = 0;
      for (let dv = -2; dv <= 2; dv += 1) {
        for (let du = -2; du <= 2; du += 1) {
          const u = cu + (du * 0.08) / cols;
          const v = cv + (dv * 0.08) / rows;
          const [sr, sg, sb] = sampleAtUv(u, v);
          sumR += sr;
          sumG += sg;
          sumB += sb;
          samples += 1;
        }
      }
      const meanLab = rgbToLab(sumR / samples, sumG / samples, sumB / samples);
      const chroma = Math.hypot(meanLab[1], meanLab[2]);
      const foilDelta = labDistance(meanLab, foilLab);
      const isDarkNeutralHole = meanLab[0] < foilLab[0] - 8 && chroma < 10;
      // Filled capsules/tablets score high on luminance or chroma contrast without falling into dark gray cavity shadow
      const signal = isDarkNeutralHole
        ? meanLab[0] - 24
        : meanLab[0] + chroma * 1.45 + Math.max(0, foilDelta - 14) * 0.4;

      stats.push({ r, c, cx: center.x, cy: center.y, signal, foilDelta });
    }
  }

  const signals = stats.map((s) => s.signal);
  const minSig = Math.min(...signals);
  const maxSig = Math.max(...signals);
  const spread = maxSig - minSig;
  const sensAdj = clamp(options.sensitivityOffset ?? 0, -50, 50) * 0.25;

  let cells: boolean[];
  if (spread > 14) {
    // 1D 2-means cluster split between empty cavities (low signal) and filled pockets (high signal)
    let low = minSig;
    let high = maxSig;
    for (let iter = 0; iter < 8; iter += 1) {
      const mid = (low + high) / 2;
      let sumLow = 0;
      let countLow = 0;
      let sumHigh = 0;
      let countHigh = 0;
      for (const s of signals) {
        if (s < mid) {
          sumLow += s;
          countLow += 1;
        } else {
          sumHigh += s;
          countHigh += 1;
        }
      }
      if (countLow > 0) low = sumLow / countLow;
      if (countHigh > 0) high = sumHigh / countHigh;
    }
    const splitThresh = (low + high) / 2 - sensAdj;
    cells = stats.map((s) => s.signal >= splitThresh);
  } else {
    const medianDelta = medianOf(stats.map((s) => s.foilDelta));
    const allFilled = medianDelta > 7 - sensAdj * 0.2;
    cells = stats.map(() => allFilled);
  }

  const points: PillPoint[] = [];
  let idCounter = 1;
  for (let i = 0; i < stats.length; i += 1) {
    if (!cells[i]) continue;
    const st = stats[i]!;
    points.push({
      id: idCounter++,
      x: Math.round(st.cx),
      y: Math.round(st.cy),
      isManual: false,
    });
  }

  return {
    grid: { rows, cols, corners, cells },
    points,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const hex = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function labelForAppearanceCluster(lab: readonly [number, number, number]): string {
  const [l, a, b] = lab;
  const chroma = Math.hypot(a, b);
  if (chroma < 14) {
    if (l >= 82) return '浅白药粒';
    if (l <= 45) return '深色药粒';
    return '灰褐药粒';
  }
  const hue = (Math.atan2(b, a) * 180) / Math.PI;
  const normHue = hue < 0 ? hue + 360 : hue;
  if (normHue >= 330 || normHue < 25) return '红色药粒';
  if (normHue >= 25 && normHue < 62) return l < 60 ? '棕橙药粒' : '橙色药粒';
  if (normHue >= 62 && normHue < 110) return '黄色药粒';
  if (normHue >= 110 && normHue < 180) return '绿色药粒';
  if (normHue >= 180 && normHue < 265) return '蓝色药粒';
  return '紫粉药粒';
}

/**
 * Group detected pills by 5x5 local Lab median color so mixed regimens surface a lightweight
 * appearance summary when 2+ visually distinct types are present. Returns [] if uniform.
 */
export function clusterPillAppearances(
  imgData: ImageData,
  points: readonly PillPoint[],
): PillAppearanceCluster[] {
  if (!points || points.length < 2 || imgData.width <= 0 || imgData.height <= 0) {
    return [];
  }

  const w = imgData.width;
  const h = imgData.height;
  const data = imgData.data;

  interface ClusterAccum {
    sumL: number;
    sumA: number;
    sumB: number;
    sumR: number;
    sumG: number;
    sumBlue: number;
    pointIds: number[];
    meanLab: [number, number, number];
  }

  const clusters: ClusterAccum[] = [];
  const MERGE_DELTA_E = 22;

  for (const pt of points) {
    const cx = clamp(Math.round(pt.x), 0, w - 1);
    const cy = clamp(Math.round(pt.y), 0, h - 1);
    const rs: number[] = [];
    const gs: number[] = [];
    const bs: number[] = [];
    for (let dy = -2; dy <= 2; dy += 1) {
      const y = clamp(cy + dy, 0, h - 1);
      for (let dx = -2; dx <= 2; dx += 1) {
        const x = clamp(cx + dx, 0, w - 1);
        const off = (y * w + x) * 4;
        rs.push(data[off]!);
        gs.push(data[off + 1]!);
        bs.push(data[off + 2]!);
      }
    }
    const mr = medianOf(rs);
    const mg = medianOf(gs);
    const mb = medianOf(bs);
    const lab = rgbToLab(mr, mg, mb);

    let bestCluster: ClusterAccum | null = null;
    let bestDist = Infinity;
    for (const c of clusters) {
      const d = labDistance(lab, c.meanLab);
      if (d <= MERGE_DELTA_E && d < bestDist) {
        bestDist = d;
        bestCluster = c;
      }
    }

    if (bestCluster) {
      bestCluster.pointIds.push(pt.id);
      bestCluster.sumL += lab[0];
      bestCluster.sumA += lab[1];
      bestCluster.sumB += lab[2];
      bestCluster.sumR += mr;
      bestCluster.sumG += mg;
      bestCluster.sumBlue += mb;
      const n = bestCluster.pointIds.length;
      bestCluster.meanLab = [
        bestCluster.sumL / n,
        bestCluster.sumA / n,
        bestCluster.sumB / n,
      ];
    } else {
      clusters.push({
        sumL: lab[0],
        sumA: lab[1],
        sumB: lab[2],
        sumR: mr,
        sumG: mg,
        sumBlue: mb,
        pointIds: [pt.id],
        meanLab: lab,
      });
    }
  }

  if (clusters.length < 2) {
    return [];
  }

  const sorted = [...clusters].sort((a, b) => b.pointIds.length - a.pointIds.length);
  const labelCounts = new Map<string, number>();

  return sorted.map((c) => {
    const n = c.pointIds.length;
    const baseLabel = labelForAppearanceCluster(c.meanLab);
    const seen = (labelCounts.get(baseLabel) ?? 0) + 1;
    labelCounts.set(baseLabel, seen);
    const label = seen > 1 ? `${baseLabel}${seen}` : baseLabel;
    return {
      label,
      count: n,
      swatch: rgbToHex(c.sumR / n, c.sumG / n, c.sumBlue / n),
      pointIds: c.pointIds,
    };
  });
}
