import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const masterPath = join(root, 'design', 'brand', 'master', 'app-icon.png');
const checkOnly = process.argv.includes('--check');
const staleFiles = [];
let outputCount = 0;

let masterBuffer;
try {
  const rawMaster = await readFile(masterPath);
  const isLfsPointer = rawMaster.length < 500 && rawMaster.toString('utf8').startsWith('version https://git-lfs.github.com/spec/v1');
  if (isLfsPointer) {
    if (checkOnly) {
      console.log('检测到当前环境未拉取 Git LFS 母版（如 Cloudflare Pages 构建环境），跳过图标一致性检查，使用仓库中已提交的预构建图标。');
      process.exit(0);
    } else {
      throw new Error('当前环境未拉取 Git LFS 母版，无法重新生成图标。请先运行 git lfs pull。');
    }
  }
  const masterMetadata = await sharp(masterPath).metadata();
  if (masterMetadata.width !== 512 || masterMetadata.height !== 512) {
    throw new Error('图标母版必须为 512x512 PNG');
  }
  masterBuffer = rawMaster;
} catch (error) {
  if (checkOnly) {
    console.warn('图标母版无法读取（可能受 LFS 影响），在检查模式下跳过：', error.message);
    process.exit(0);
  }
  throw error;
}


const pngOptions = {
  compressionLevel: 9,
  adaptiveFiltering: false,
  palette: false,
};

const masterTrimmedBuffer = await sharp(masterPath).ensureAlpha().toBuffer();

async function standardIcon(size) {
  const source = await sharp(masterTrimmedBuffer)
    .resize(size, size, { fit: 'contain', kernel: sharp.kernel.lanczos3 })
    .png(pngOptions)
    .toBuffer();

  return applyMask(source, roundedSquareMask(size, 0.205));
}

async function fullIcon(size) {
  return sharp(masterTrimmedBuffer)
    .resize(size, size, { fit: 'contain', kernel: sharp.kernel.lanczos3 })
    .flatten({ background: '#0d3f32' })
    .png(pngOptions)
    .toBuffer();
}

async function roundIcon(size) {
  const source = await sharp(masterTrimmedBuffer)
    .resize(size, size, { fit: 'contain', kernel: sharp.kernel.lanczos3 })
    .png(pngOptions)
    .toBuffer();

  return applyMask(source, circleMask(size));
}

async function adaptiveForeground(size) {
  // Android adaptive 图标为 108dp 图层，但各启动器遮罩（圆/圆角方）只保证中央
  // 66dp 可见。把母版缩到 66/108 安全区内、四周透出 background 渐变层，
  // 避免成品图边缘/文字被遮罩裁切（此前铺满 72dp 导致文字贴边被切）。
  const iconSize = Math.round(size * (66 / 108));
  const icon = await sharp(masterTrimmedBuffer)
    .resize(iconSize, iconSize, { fit: 'contain', kernel: sharp.kernel.lanczos3 })
    .png(pngOptions)
    .toBuffer();
  const offset = Math.floor((size - iconSize) / 2);

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: icon, left: offset, top: offset }])
    .png(pngOptions)
    .toBuffer();
}

async function splash(width, height) {
  const iconSize = Math.round(Math.min(width, height) * 0.29);
  const icon = await standardIcon(iconSize);

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: '#0d3f32',
    },
  })
    .composite([
      {
        input: icon,
        left: Math.round((width - iconSize) / 2),
        top: Math.round((height - iconSize) / 2),
      },
    ])
    .png(pngOptions)
    .toBuffer();
}

async function applyMask(input, mask) {
  return sharp(input)
    .ensureAlpha()
    .composite([{ input: Buffer.from(mask), blend: 'dest-in' }])
    .png(pngOptions)
    .toBuffer();
}

function roundedSquareMask(size, radiusRatio) {
  const radius = Math.round(size * radiusRatio);
  return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" rx="${radius}" fill="#fff"/></svg>`;
}

function circleMask(size) {
  const radius = size / 2;
  return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${radius}" cy="${radius}" r="${radius}" fill="#fff"/></svg>`;
}

async function emit(path, content) {
  outputCount += 1;
  if (checkOnly) {
    try {
      const current = await readFile(path);
      if (!current.equals(content)) staleFiles.push(relative(root, path));
    } catch {
      staleFiles.push(relative(root, path));
    }
    return;
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

const publicIcons = join(root, 'public', 'icons');
await emit(join(publicIcons, 'icon-192.png'), await standardIcon(192));
await emit(join(publicIcons, 'icon-512.png'), await standardIcon(512));
await emit(join(publicIcons, 'icon-192-full.png'), await fullIcon(192));
await emit(join(publicIcons, 'icon-512-full.png'), await fullIcon(512));
await emit(join(publicIcons, 'apple-touch-icon.png'), await fullIcon(180));
await emit(join(publicIcons, 'favicon.png'), await standardIcon(64));

const densitySizes = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};
const androidRes = join(root, 'android', 'app', 'src', 'main', 'res');
for (const [density, size] of Object.entries(densitySizes)) {
  const mipmap = join(androidRes, `mipmap-${density}`);
  await emit(join(mipmap, 'ic_launcher.png'), await standardIcon(size));
  await emit(join(mipmap, 'ic_launcher_round.png'), await roundIcon(size));
  await emit(join(mipmap, 'ic_launcher_foreground.png'), await adaptiveForeground(size * 2.25));
}

const splashSizes = {
  drawable: [480, 320],
  'drawable-land-mdpi': [480, 320],
  'drawable-land-hdpi': [800, 480],
  'drawable-land-xhdpi': [1280, 720],
  'drawable-land-xxhdpi': [1600, 960],
  'drawable-land-xxxhdpi': [1920, 1280],
  'drawable-port-mdpi': [320, 480],
  'drawable-port-hdpi': [480, 800],
  'drawable-port-xhdpi': [720, 1280],
  'drawable-port-xxhdpi': [960, 1600],
  'drawable-port-xxxhdpi': [1280, 1920],
};
for (const [directory, [width, height]] of Object.entries(splashSizes)) {
  await emit(join(androidRes, directory, 'splash.png'), await splash(width, height));
}

if (checkOnly && staleFiles.length > 0) {
  console.error(`图标资源未同步：\n${staleFiles.map((path) => `- ${path}`).join('\n')}`);
  console.error('请运行 npm run assets:build');
  process.exitCode = 1;
} else if (checkOnly) {
  console.log(`图标资源校验通过（${outputCount} 个文件）`);
} else {
  console.log(`已从 ${relative(root, masterPath)} 生成 ${outputCount} 个图标资源`);
}
