import sharp from 'sharp';

const src = process.argv[2];
const dst = process.argv[3];
const EDGE = 14;   // edge band thickness (px) within subject to clean
const THRESH = 95; // brightness below this on the edge band = dark outline
const WIN = 9;     // neighborhood window for filling color

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;

// distance transform (L1, two-pass) of non-transparent pixels
const INF = 1e9;
const dist = new Int32Array(W * H);
for (let i = 0; i < W * H; i++) dist[i] = data[i * 4 + 3] > 200 ? INF : 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (dist[i] === 0) continue;
    let d = dist[i];
    if (y > 0) d = Math.min(d, dist[i - W] + 1);
    if (x > 0) d = Math.min(d, dist[i - 1] + 1);
    dist[i] = d;
  }
}
for (let y = H - 1; y >= 0; y--) {
  for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    if (dist[i] === 0) continue;
    let d = dist[i];
    if (y < H - 1) d = Math.min(d, dist[i + W] + 1);
    if (x < W - 1) d = Math.min(d, dist[i + 1] + 1);
    dist[i] = d;
  }
}

const brightness = (i) => (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3;

let fixed = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (data[i * 4 + 3] < 200) continue; // only solid subject interior
    if (dist[i] > EDGE) continue;         // only edge band
    if (brightness(i) >= THRESH) continue; // not dark -> keep
    // find a replacement color from neighborhood: prefer nearest pixel with brightness >= THRESH
    let best = null, bestD = INF;
    const r2 = WIN >> 1;
    for (let dy = -r2; dy <= r2; dy++) {
      for (let dx = -r2; dx <= r2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (data[ni * 4 + 3] < 200) continue;
        if (brightness(ni) < THRESH) continue;
        const dd = dx * dx + dy * dy;
        if (dd < bestD) { bestD = dd; best = ni; }
      }
    }
    if (best !== null) {
      data[i * 4] = data[best * 4];
      data[i * 4 + 1] = data[best * 4 + 1];
      data[i * 4 + 2] = data[best * 4 + 2];
      fixed++;
    }
  }
}

await sharp(data, { raw: { width: W, height: H, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(dst);

console.log('cleaned dark edge pixels:', fixed, '->', dst);
