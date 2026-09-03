import sharp from 'sharp';

const src = process.argv[2];
const dst = process.argv[3];
const EDGE = 4;       // strip width inward from subject edge
const BLACK = 70;     // brightness below this = dark edge pixel
const MIN_A = 50;     // min alpha to consider

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const bri = (bi) => (data[bi] + data[bi + 1] + data[bi + 2]) / 3;

// helper: find replacement color scanning inward along a row
function inwardColor(y, startX, step) {
  for (let x = startX; x >= 0 && x < W; x += step) {
    const i = (y * W + x) * 4;
    if (data[i + 3] < 200) continue;
    if (bri(i) >= 40 && bri(i) < 250) return [data[i], data[i + 1], data[i + 2]];
    if (Math.abs(x - startX) > 25) break;
  }
  return null;
}

let fixed = 0;
// horizontal (left/right) edges
for (let y = 0; y < H; y++) {
  // find subject extent this row (alpha>200)
  let L = -1, R = -1;
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (data[i + 3] > MIN_A) { if (L < 0) L = x; R = x; }
  }
  if (L < 0) continue;
  for (let k = 0; k < EDGE; k++) {
    // left strip
    let xl = L + k;
    if (xl < W) {
      const i = (y * W + xl) * 4;
      if (data[i + 3] > MIN_A && bri(i) < BLACK) {
        const c = inwardColor(y, L + EDGE, 1);
        if (c) { data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; fixed++; }
      }
    }
    // right strip
    let xr = R - k;
    if (xr >= 0) {
      const i = (y * W + xr) * 4;
      if (data[i + 3] > MIN_A && bri(i) < BLACK) {
        const c = inwardColor(y, R - EDGE, -1);
        if (c) { data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; fixed++; }
      }
    }
  }
}
// vertical (top/bottom) edges: same logic on columns
for (let x = 0; x < W; x++) {
  let T = -1, B = -1;
  for (let y = 0; y < H; y++) {
    const i = (y * W + x) * 4;
    if (data[i + 3] > MIN_A) { if (T < 0) T = y; B = y; }
  }
  if (T < 0) continue;
  for (let k = 0; k < EDGE; k++) {
    let yt = T + k;
    if (yt < H) {
      const i = (yt * W + x) * 4;
      if (data[i + 3] > MIN_A && bri(i) < BLACK) {
        // scan downward for subject color
        for (let yy = T + EDGE; yy < H; yy++) {
          const ii = (yy * W + x) * 4;
          if (data[ii + 3] > 200 && bri(ii) >= 40 && bri(ii) < 250) {
            data[i] = data[ii]; data[i + 1] = data[ii + 1]; data[i + 2] = data[ii + 2]; fixed++; break;
          }
          if (yy - T > 25) break;
        }
      }
    }
    let yb = B - k;
    if (yb >= 0) {
      const i = (yb * W + x) * 4;
      if (data[i + 3] > MIN_A && bri(i) < BLACK) {
        for (let yy = B - EDGE; yy >= 0; yy--) {
          const ii = (yy * W + x) * 4;
          if (data[ii + 3] > 200 && bri(ii) >= 40 && bri(ii) < 250) {
            data[i] = data[ii]; data[i + 1] = data[ii + 1]; data[i + 2] = data[ii + 2]; fixed++; break;
          }
          if (B - yy > 25) break;
        }
      }
    }
  }
}

await sharp(data, { raw: { width: W, height: H, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(dst);
console.log('removed edge outline pixels:', fixed, '->', dst);
