import sharp from 'sharp';

const masterPath = 'D:/Desktop_Archive/日常工具箱手机端网页端/medbox/design/brand/master/app-icon.png';
const { width, height, channels } = await sharp(masterPath).metadata();
console.log('size:', width, 'x', height, 'channels:', channels);

const { data, info } = await sharp(masterPath)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const W = info.width, H = info.height;
const px = (x, y) => {
  const i = (y * W + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
};

// 1) opaque bounding box (alpha > 10)
let minX = W, minY = H, maxX = -1, maxY = -1;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (data[(y * W + x) * 4 + 3] > 10) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
console.log('opaque bbox (px):', { minX, minY, maxX, maxY });
console.log('opaque bbox (%):', {
  minX: +(minX / W * 100).toFixed(1),
  minY: +(minY / H * 100).toFixed(1),
  maxX: +(maxX / W * 100).toFixed(1),
  maxY: +(maxY / H * 100).toFixed(1),
});
console.log('trim size:', maxX - minX + 1, 'x', maxY - minY + 1);

// 2) corner colors (sample near corners, avoiding transparent)
const corner = (x, y, step = 8) => {
  for (let d = 0; d < 60; d += step) {
    const [r, g, b, a] = px(Math.min(W - 1, x + d), Math.min(H - 1, y + d));
    if (a > 128) return [r, g, b];
  }
  return null;
};
const cTL = corner(0, 0), cTR = corner(W - 1, 0), cBL = corner(0, H - 1), cBR = corner(W - 1, H - 1);
console.log('corner colors:', { TL: cTL, TR: cTR, BL: cBL, BR: cBR });

// 3) background gradient check along a horizontal line near top (y=30) and vertical
const row = (y) => {
  const arr = [];
  for (let x = 0; x < W; x += 32) {
    const [r, g, b, a] = px(x, y);
    arr.push(a > 128 ? `${x}:${r},${g},${b}` : `${x}:trans`);
  }
  return arr;
};
console.log('row y=20:', row(20).join(' '));
console.log('row y=256:', row(256).join(' '));

// 4) detect bright/white text pixels region (text is white ~ high R,G,B, lowish saturation)
const textStats = { count: 0, minX: W, minY: H, maxX: 0, maxY: 0 };
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a > 128 && r > 235 && g > 235 && b > 235) {
      textStats.count++;
      if (x < textStats.minX) textStats.minX = x;
      if (x > textStats.maxX) textStats.maxX = x;
      if (y < textStats.minY) textStats.minY = y;
      if (y > textStats.maxY) textStats.maxY = y;
    }
  }
}
if (textStats.count > 0) {
  console.log('white text region (px):', textStats, 'count:', textStats.count);
  console.log('white text region (%):', {
    minX: +(textStats.minX / W * 100).toFixed(1),
    minY: +(textStats.minY / H * 100).toFixed(1),
    maxX: +(textStats.maxX / W * 100).toFixed(1),
    maxY: +(textStats.maxY / H * 100).toFixed(1),
  });
} else {
  console.log('no white text detected');
}
