import sharp from 'sharp';

const src = process.argv[2];
const dst = process.argv[3];

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;

// sample background color from corners (assume corners are background)
const sample = (cx, cy, r) => {
  let s = [0, 0, 0], n = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const i = (y * W + x) * 4;
    s[0] += data[i]; s[1] += data[i + 1]; s[2] += data[i + 2]; n++;
  }
  return s.map((v) => Math.round(v / n));
};
const r = Math.round(Math.min(W, H) * 0.03);
const corners = [
  sample(Math.round(W * 0.05), Math.round(H * 0.05), r),
  sample(Math.round(W * 0.95), Math.round(H * 0.05), r),
  sample(Math.round(W * 0.05), Math.round(H * 0.95), r),
  sample(Math.round(W * 0.95), Math.round(H * 0.95), r),
];
// average of corner colors as bg
const bg = [0, 1, 2].map((k) => Math.round((corners[0][k] + corners[1][k] + corners[2][k] + corners[3][k]) / 4));
console.log('corner samples:', corners.map((c) => c.join(',')).join(' | '));
console.log('bg color:', bg.join(','));

// background color distance (max channel diff) threshold
function bgDist(r, g, b) {
  // use max absolute channel difference from bg
  return Math.max(Math.abs(r - bg[0]), Math.abs(g - bg[1]), Math.abs(b - bg[2]));
}

const out = Buffer.alloc(W * H * 4);
const INNER = 70;  // distance below which fully transparent (background)
const OUTER = 160; // distance above which fully opaque (subject)
let minX = W, minY = H, maxX = -1, maxY = -1;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    const d = bgDist(r, g, b);
    let na;
    if (d <= INNER) na = 0;
    else if (d >= OUTER) na = 255;
    else na = Math.round(((d - INNER) / (OUTER - INNER)) * 255);
    // despill: remove bg color proportionally for semi-transparent pixels
    let nr = r, ng = g, nb = b;
    if (na < 255 && na > 0) {
      const t = 1 - na / 255;
      nr = Math.round(r - bg[0] * t);
      ng = Math.round(g - bg[1] * t);
      nb = Math.round(b - bg[2] * t);
      nr = Math.max(0, Math.min(255, nr));
      ng = Math.max(0, Math.min(255, ng));
      nb = Math.max(0, Math.min(255, nb));
    }
    const o = i;
    out[o] = nr; out[o + 1] = ng; out[o + 2] = nb; out[o + 3] = na;
    if (na > 10) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}

await sharp(out, { raw: { width: W, height: H, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(dst);

console.log('cutout saved:', dst, W, 'x', H);
console.log('subject bbox (px):', { minX, minY, maxX, maxY });
console.log('subject bbox (%):', {
  minX: +(minX / W * 100).toFixed(1), minY: +(minY / H * 100).toFixed(1),
  maxX: +(maxX / W * 100).toFixed(1), maxY: +(maxY / H * 100).toFixed(1),
  w: +((maxX - minX + 1) / W * 100).toFixed(1), h: +((maxY - minY + 1) / H * 100).toFixed(1),
});
console.log('subject center (%,cx,cy):', +(((minX + maxX) / 2 / W) * 100).toFixed(1), +(((minY + maxY) / 2 / H) * 100).toFixed(1));
