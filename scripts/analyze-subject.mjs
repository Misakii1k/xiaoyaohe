import sharp from 'sharp';

const path = process.argv[2];
const meta = await sharp(path).metadata();
console.log('format:', meta.format, 'size:', meta.width, 'x', meta.height);
const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;

// Build a background model: sample 4 corner regions (avoid center), bilinear interpolate
const sample = (cx, cy, r) => {
  let s = [0, 0, 0, 0], n = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = (y * W + x) * 4;
      s[0] += data[i]; s[1] += data[i + 1]; s[2] += data[i + 2]; s[3] += data[i + 3];
      n++;
    }
  }
  return s.map((v) => v / n);
};
// corners at ~6% inset
const r = Math.round(W * 0.02);
const cTL = sample(Math.round(W * 0.06), Math.round(H * 0.06), r);
const cTR = sample(Math.round(W * 0.94), Math.round(H * 0.06), r);
const cBL = sample(Math.round(W * 0.06), Math.round(H * 0.94), r);
const cBR = sample(Math.round(W * 0.94), Math.round(H * 0.94), r);
console.log('corner bg:', { TL: cTL.map(Math.round), TR: cTR.map(Math.round), BL: cBL.map(Math.round), BR: cBR.map(Math.round) });

// bilinear background estimate
const bgEst = (x, y) => {
  const fx = x / (W - 1), fy = y / (H - 1);
  const top = [0, 1, 2].map((k) => cTL[k] + (cTR[k] - cTL[k]) * fx);
  const bot = [0, 1, 2].map((k) => cBL[k] + (cBR[k] - cBL[k]) * fx);
  return [0, 1, 2].map((k) => top[k] + (bot[k] - top[k]) * fy);
};

// detect subject = pixels significantly different from bg model
let minX = W, minY = H, maxX = -1, maxY = -1, count = 0;
const diffMap = new Float32Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const [br, bg_, bb] = bgEst(x, y);
    const d = Math.abs(r - br) + Math.abs(g - bg_) + Math.abs(b - bb);
    diffMap[y * W + x] = d;
    if (d > 60) {
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
console.log('subject (diff>60) bbox px:', { minX, minY, maxX, maxY, count });
console.log('subject bbox (%):', {
  minX: +(minX / W * 100).toFixed(1), minY: +(minY / H * 100).toFixed(1),
  maxX: +(maxX / W * 100).toFixed(1), maxY: +(maxY / H * 100).toFixed(1),
  w: +((maxX - minX + 1) / W * 100).toFixed(1), h: +((maxY - minY + 1) / H * 100).toFixed(1),
});
console.log('subject center (%,cx,cy):', +(((minX + maxX) / 2 / W) * 100).toFixed(1), +(((minY + maxY) / 2 / H) * 100).toFixed(1));

// row-wise subject extent (to see vertical distribution)
const rowMinMax = [];
for (let y = 0; y < H; y += Math.max(1, Math.round(H / 24))) {
  let rmin = W, rmax = -1;
  for (let x = 0; x < W; x++) {
    if (diffMap[y * W + x] > 60) {
      if (x < rmin) rmin = x;
      if (x > rmax) rmax = x;
    }
  }
  rowMinMax.push({ y: Math.round(y / H * 100), x0: rmin === W ? '-' : Math.round(rmin / W * 100), x1: rmax === -1 ? '-' : Math.round(rmax / W * 100) });
}
console.log('subject row distribution:', JSON.stringify(rowMinMax));
