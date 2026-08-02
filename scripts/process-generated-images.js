const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const brainDir = `C:\\Users\\87850\\.gemini\\antigravity\\brain\\369987a3-9aa2-4854-84e5-d823af476044`;

const imageMap = [
  {
    srcName: 'logo_option_a_1785416871974.jpg',
    rawDest: 'design/brand/inbox/logo-a-raw.jpg',
    pngDest: 'design/brand/inbox/logo-a-transparent.png',
    pubDest: 'public/assets/brand/logo-a.png',
  },
  {
    srcName: 'logo_option_b_1785416883341.jpg',
    rawDest: 'design/brand/inbox/logo-b-raw.jpg',
    pngDest: 'design/brand/inbox/logo-b-transparent.png',
    pubDest: 'public/assets/brand/logo-b.png',
  },
  {
    srcName: 'logo_option_c_1785416894488.jpg',
    rawDest: 'design/brand/inbox/logo-c-raw.jpg',
    pngDest: 'design/brand/inbox/logo-c-transparent.png',
    pubDest: 'public/assets/brand/logo-c.png',
  },
  {
    srcName: 'empty_medications_1785416914635.jpg',
    rawDest: 'design/illustrations/inbox/empty-medications-raw.jpg',
    pngDest: 'design/illustrations/inbox/empty-medications-transparent.png',
    pubDest: 'public/assets/illustrations/empty-medications.png',
  },
  {
    srcName: 'empty_work_logs_1785416926512.jpg',
    rawDest: 'design/illustrations/inbox/empty-work-logs-raw.jpg',
    pngDest: 'design/illustrations/inbox/empty-work-logs-transparent.png',
    pubDest: 'public/assets/illustrations/empty-work-logs.png',
  },
  {
    srcName: 'scan_guide_1785416940599.jpg',
    rawDest: 'design/illustrations/inbox/scan-guide-raw.jpg',
    pngDest: 'design/illustrations/inbox/scan-guide-transparent.png',
    pubDest: 'public/assets/illustrations/scan-guide.png',
  },
];

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function processChromaKey(jpegPath, pngDestPath, pubDestPath) {
  const jpegData = fs.readFileSync(jpegPath);
  const rawImageData = jpeg.decode(jpegData, { useTolerant: true });
  
  const width = rawImageData.width;
  const height = rawImageData.height;
  const png = new PNG({ width, height });

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) * 4;
      const r = rawImageData.data[idx];
      const g = rawImageData.data[idx + 1];
      const b = rawImageData.data[idx + 2];

      // Magenta detection: High R and B, Low G
      // Magenta distance formula in RGB space from pure #FF00FF (255, 0, 255)
      const dist = Math.sqrt((r - 255) ** 2 + (g - 0) ** 2 + (b - 255) ** 2);

      let alpha = 255;
      if (dist < 90) {
        alpha = 0;
      } else if (dist < 140) {
        alpha = Math.round(((dist - 90) / 50) * 255);
      }

      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = alpha;
    }
  }

  ensureDir(pngDestPath);
  const buffer = PNG.sync.write(png);
  fs.writeFileSync(pngDestPath, buffer);
  
  ensureDir(pubDestPath);
  fs.writeFileSync(pubDestPath, buffer);
  console.log(`Processed: ${pngDestPath} (${width}x${height})`);
}

imageMap.forEach(item => {
  const fullSrc = path.join(brainDir, item.srcName);
  if (fs.existsSync(fullSrc)) {
    ensureDir(item.rawDest);
    fs.copyFileSync(fullSrc, item.rawDest);
    processChromaKey(fullSrc, item.pngDest, item.pubDest);
  } else {
    console.error(`Source file not found: ${fullSrc}`);
  }
});
