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

export interface PillPoint {
  x: number;
  y: number;
  id: number;
  isManual?: boolean;
}

export interface PillDetectOptions {
  /** 手动敏感度偏移（-50 ~ 50，默认 0；正值更敏感，会多检出弱对比药片） */
  sensitivityOffset?: number;
  /** 兼容旧参数：最小中心间距（像素）。不传时按药片半径自适应。 */
  minSpacing?: number;
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

/**
 * 从 ImageData 中检测药片中心坐标。
 */
export function detectPillsFromImageData(
  imgData: ImageData,
  options: PillDetectOptions = {},
): PillDetectionResult {
  const started = clockNow();
  const w = imgData.width;
  const h = imgData.height;
  const data = imgData.data;
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

  closePinholes(mask, w, h);

  const { labels, components } = labelComponents(mask, w, h);
  if (components.length === 0) {
    return { ...empty, elapsedMs: clockNow() - started, detectedThresh: threshold };
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

  const pillRadius = estimatePillRadius(components, w, h);
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

  return {
    points,
    elapsedMs: clockNow() - started,
    detectedThresh: threshold,
    pillRadius,
    componentCount: components.length,
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
      const dr = data[idx]! - bgR;
      const dg = data[idx + 1]! - bgG;
      const db = data[idx + 2]! - bgB;
      score[row + x] = Math.sqrt(0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db);
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
