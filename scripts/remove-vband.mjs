import sharp from 'sharp';

const src = process.argv[2];
const dst = process.argv[3];

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;

// 1) per-column dark ratio (dark pixels / opaque pixels in that column)
const colDark = new Float32Array(W);
const colTotal = new Int32Array(W);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (data[i + 3] > 200) {
      colTotal[x]++;
      const b = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (b < 100) colDark[x]++;
    }
  }
}
const ratios = [];
for (let x = 0; x < W; x++) {
  ratios.push(colTotal[x] > 20 ? colDark[x] / colTotal[x] : 0);
}

// 2) find vertical dark bands: contiguous columns where ratio > 0.5, band width <= 60
const marked = new Uint8Array(W);
for (let x = 0; x < W; x++) {
  if (ratios[x] > 0.5) {
    let e = x;
    while (e + 1 < W && ratios[e + 1] > 0.5) e++;
    const width = e - x + 1;
    if (width <= 60) {
      for (let k = x; k <= e; k++) marked[k] = 1;
    }
    x = e;
  }
}
const bands = [];
for (let x = 0; x < W; x++) if (marked[x]) { let e = x; while (e + 1 < W && marked[e + 1]) e++; bands.push([x, e]); x = e; }
console.log('vertical dark bands (x ranges):', JSON.stringify(bands));

// 3) for marked columns, replace dark pixels with row-wise nearby bright subject color
let fixed = 0;
const isMarked = (x) => marked[x] === 1;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (data[i + 3] < 200) continue;
    if (!isMarked(x)) continue;
    const b = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (b >= 100) continue;
    // find nearest bright subject pixel to the left, then right
    let lx = -1, rx = -1;
    for (let xx = x - 1; xx >= 0; xx--) {
      const ii = (y * W + xx) * 4;
      if (data[ii + 3] < 200) break; // edge of subject
      if (isMarked(xx)) continue;
      if ((data[ii] + data[ii + 1] + data[ii + 2]) / 3 >= 100) { lx = xx; break; }
    }
    for (let xx = x + 1; xx < W; xx++) {
      const ii = (y * W + xx) * 4;
      if (data[ii + 3] < 200) break;
      if (isMarked(xx)) continue;
      if ((data[ii] + data[ii + 1] + data[ii + 2]) / 3 >= 100) { rx = xx; break; }
    }
    let src2 = -1;
    if (lx >= 0 && rx >= 0) src2 = Math.abs(x - lx) <= Math.abs(rx - x) ? lx : rx;
    else if (lx >= 0) src2 = lx;
    else if (rx >= 0) src2 = rx;
    if (src2 >= 0) {
      const si = (y * W + src2) * 4;
      data[i] = data[si]; data[i + 1] = data[si + 1]; data[i + 2] = data[si + 2];
      fixed++;
    }
  }
}

await sharp(data, { raw: { width: W, height: H, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(dst);
console.log('fixed dark vertical band pixels:', fixed, '->', dst);
