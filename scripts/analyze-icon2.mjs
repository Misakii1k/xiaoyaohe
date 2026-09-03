import sharp from 'sharp';

const path = process.argv[2];
const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const px = (x, y) => {
  const i = (y * W + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3], data[i + 3]];
};

// classify pixels
// - bg: near-neutral light (r,g,b close, high brightness) OR transparent
// - white text: very bright, low saturation (pure white)
// - colorful: saturated (subject)
let bgCount = 0, textCount = 0, subjCount = 0;
const subj = { minX: W, minY: H, maxX: 0, maxY: 0 };
const text = { minX: W, minY: H, maxX: 0, maxY: 0 };
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const [r, g, b, a] = px(x, y);
    if (a < 128) { bgCount++; continue; }
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx - mn;
    if (sat < 18 && mx > 225) {
      // bright near-neutral -> likely white text OR light background
      // background is slightly greyish (~230-240); pure white text ~250+
      if (mx > 243 && r > 240 && g > 240 && b > 240) {
        textCount++;
        if (x < text.minX) text.minX = x;
        if (x > text.maxX) text.maxX = x;
        if (y < text.minY) text.minY = y;
        if (y > text.maxY) text.maxY = y;
      } else {
        bgCount++;
      }
    } else if (sat >= 18) {
      subjCount++;
      if (x < subj.minX) subj.minX = x;
      if (x > subj.maxX) subj.maxX = x;
      if (y < subj.minY) subj.minY = y;
      if (y > subj.maxY) subj.maxY = y;
    } else {
      bgCount++;
    }
  }
}
const pct = (o) => o ? {
  minX: +(o.minX / W * 100).toFixed(1), minY: +(o.minY / H * 100).toFixed(1),
  maxX: +(o.maxX / W * 100).toFixed(1), maxY: +(o.maxY / H * 100).toFixed(1),
  w: +( (o.maxX - o.minX + 1) / W * 100).toFixed(1),
  h: +( (o.maxY - o.minY + 1) / H * 100).toFixed(1),
} : null;
console.log('file:', path, 'size:', W, 'x', H);
console.log('counts bg/subject/text:', { bgCount, subjCount, textCount });
console.log('subject bbox (%):', pct(subj));
console.log('text bbox (%):', pct(text));
// center of subject & text
if (subjCount) console.log('subject center (%, cx,cy):', +(((subj.minX+subj.maxX)/2/W)*100).toFixed(1), +(((subj.minY+subj.maxY)/2/H)*100).toFixed(1));
if (textCount) console.log('text center (%, cx,cy):', +(((text.minX+text.maxX)/2/W)*100).toFixed(1), +(((text.minY+text.maxY)/2/H)*100).toFixed(1));
