import sharp from 'sharp';

const cutout = 'D:/Desktop_Archive/日常工具箱手机端网页端/medbox/design/brand/master/flat-B-clean4-cutout.png';
const masterOut = 'D:/Desktop_Archive/日常工具箱手机端网页端/medbox/design/brand/master/app-icon.png';
const fgOut = 'D:/Desktop_Archive/日常工具箱手机端网页端/medbox/design/brand/master/app-icon-foreground.png';

const SIZE = 512;
const SUBJECT_RATIO = 0.55; // subject occupies 55% of canvas width (safe for circle crop)

// --- background gradient (315deg: top-right -> bottom-left), matching Android drawable
const gradientSvg = `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="1" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#C3B8FA"/>
      <stop offset="50%" stop-color="#D8E2FC"/>
      <stop offset="100%" stop-color="#A9F1E9"/>
    </linearGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#g)"/>
</svg>`;
const bgBuffer = await sharp(Buffer.from(gradientSvg)).png().toBuffer();

// --- trim cutout and resize subject.
// Fill transparent pixels with the subject edge color BEFORE resizing: sharp's lanczos
// resampling mixes RGB of transparent (0,0,0) pixels with the edge, producing a black
// halo line around the subject. Pre-filling reduces (but does not fully remove) it.
const cutoutRaw = await sharp(cutout).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
{
  const CW = cutoutRaw.info.width, CH = cutoutRaw.info.height, cd = cutoutRaw.data;
  const EDGE_COLOR = [30, 75, 113];
  for (let p = 0; p < CW * CH; p++) {
    if (cd[p * 4 + 3] < 20) {
      cd[p * 4] = EDGE_COLOR[0];
      cd[p * 4 + 1] = EDGE_COLOR[1];
      cd[p * 4 + 2] = EDGE_COLOR[2];
    }
  }
}
const trimmed = await sharp(cutoutRaw.data, { raw: { width: cutoutRaw.info.width, height: cutoutRaw.info.height, channels: 4 } })
  .trim()
  .png()
  .toBuffer();

const s = Math.round(SIZE * SUBJECT_RATIO);
const iconBuffer = await sharp(trimmed)
  .resize(s, s, { fit: 'contain', kernel: sharp.kernel.lanczos3 })
  .png()
  .toBuffer();

// --- fix black halo edges on the TRANSPARENT-BG subject (L/R detection works here).
function fixBlackEdges(buf) {
  const { data, info } = { ...{} };
  return sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => {
      const W = info.width, H = info.height;
      const bri = (bi) => (data[bi] + data[bi + 1] + data[bi + 2]) / 3;
      const EDGE = 6, BLACK = 70, MIN_A = 50;
      let fixed = 0;
      // horizontal edges
      for (let y = 0; y < H; y++) {
        let L = -1, R = -1;
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          if (data[i + 3] > MIN_A) { if (L < 0) L = x; R = x; }
        }
        if (L < 0) continue;
        for (let k = 0; k < EDGE; k++) {
          const xl = L + k, xr = R - k;
          for (const x of [xl, xr]) {
            if (x < 0 || x >= W) continue;
            const i = (y * W + x) * 4;
            if (data[i + 3] > MIN_A && bri(i) < BLACK) {
              // find inward bright subject color
              let src = null;
              const step = x === xl ? 1 : -1;
              for (let xx = x + step; xx >= 0 && xx < W; xx += step) {
                const ii = (y * W + xx) * 4;
                if (data[ii + 3] < 50) break;
                if (bri(ii) >= 40 && bri(ii) < 250) { src = ii; break; }
                if (Math.abs(xx - x) > 30) break;
              }
              if (src !== null) {
                data[i] = data[src]; data[i + 1] = data[src + 1]; data[i + 2] = data[src + 2];
                fixed++;
              }
            }
          }
        }
      }
      // vertical edges
      for (let x = 0; x < W; x++) {
        let T = -1, B = -1;
        for (let y = 0; y < H; y++) {
          const i = (y * W + x) * 4;
          if (data[i + 3] > MIN_A) { if (T < 0) T = y; B = y; }
        }
        if (T < 0) continue;
        for (let k = 0; k < EDGE; k++) {
          const yt = T + k, yb = B - k;
          for (const yy of [yt, yb]) {
            if (yy < 0 || yy >= H) continue;
            const i = (yy * W + x) * 4;
            if (data[i + 3] > MIN_A && bri(i) < BLACK) {
              const step = yy === yt ? 1 : -1;
              for (let yy2 = yy + step; yy2 >= 0 && yy2 < H; yy2 += step) {
                const ii = (yy2 * W + x) * 4;
                if (data[ii + 3] < 50) break;
                if (bri(ii) >= 40 && bri(ii) < 250) {
                  data[i] = data[ii]; data[i + 1] = data[ii + 1]; data[i + 2] = data[ii + 2];
                  fixed++; break;
                }
                if (Math.abs(yy2 - yy) > 30) break;
              }
            }
          }
        }
      }
      return sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer().then((b) => ({ b, fixed }));
    });
}

const { b: cleanIcon, fixed } = await fixBlackEdges(iconBuffer);
console.log('fixed black edge pixels after resize:', fixed);

// --- composite subject centered
const offset = Math.round((SIZE - s) / 2);
const master = await sharp({
  create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([
    { input: bgBuffer, top: 0, left: 0 },
    { input: cleanIcon, top: offset, left: offset },
  ])
  .png({ compressionLevel: 9 })
  .toBuffer();
// --- final: drop any pure-black (resize ringing) pixels to transparent on the composed outputs.
async function clearBlackPixels(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  let n = 0;
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    if (data[i + 3] > 200 && data[i] < 12 && data[i + 1] < 12 && data[i + 2] < 12) {
      data[i + 3] = 0;
      n++;
    }
  }
  return sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer().then((b) => ({ b, n }));
}

const { b: masterCleaned, n: nMaster } = await clearBlackPixels(master);
const { b: fgCleaned, n: nFg } = await clearBlackPixels(fg);
await sharp(masterCleaned).toFile(masterOut);
await sharp(fgCleaned).toFile(fgOut);
console.log('cleared black ringing pixels: master', nMaster, 'fg', nFg);

console.log('master:', masterOut, 'subject size:', s, 'offset:', offset);
console.log('foreground:', fgOut);
