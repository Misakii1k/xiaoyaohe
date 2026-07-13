// 感知哈希（aHash 简化版）：把图缩到 8×8 灰度 → 取平均 → 大于均值为 1 → 64 位串。
// 用于"看图找药"的离线兜底：算两张图汉明距离 ≤ 10 即视为同一药盒。
// 比 pHash（DCT）效果稍弱但实现简单、跑在 canvas 上够快；后续可升级。

export async function aHash(blob: Blob): Promise<string> {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(bmp, 0, 0, 8, 8);
  const { data } = ctx.getImageData(0, 0, 8, 8);
  const lum = new Array<number>(64);
  let sum = 0;
  for (let i = 0; i < 64; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    // ITU-R BT.601
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    lum[i] = y;
    sum += y;
  }
  const avg = sum / 64;
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    const v =
      (lum[i] > avg ? 8 : 0) +
      (lum[i + 1] > avg ? 4 : 0) +
      (lum[i + 2] > avg ? 2 : 0) +
      (lum[i + 3] > avg ? 1 : 0);
    hex += v.toString(16);
  }
  return hex;
}

export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/** 在 hashes 数组里找最相似的；返回 {hash, distance}，没有则返回 null */
export function findClosest(
  target: string,
  hashes: string[],
): { hash: string; distance: number } | null {
  let best: { hash: string; distance: number } | null = null;
  for (const h of hashes) {
    const d = hamming(target, h);
    if (!best || d < best.distance) best = { hash: h, distance: d };
  }
  return best;
}
