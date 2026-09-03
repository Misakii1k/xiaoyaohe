import sharp from 'sharp';
const svg = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="#575CCF"/>
  <text x="256" y="300" font-size="80" fill="white" font-family="Microsoft YaHei, SimHei, sans-serif" text-anchor="middle" font-weight="bold">小药盒</text>
</svg>`;
try {
  await sharp(Buffer.from(svg)).png().toFile('test-cn-text.png');
  console.log('OK rendered');
} catch (e) {
  console.log('ERR', e.message);
}
