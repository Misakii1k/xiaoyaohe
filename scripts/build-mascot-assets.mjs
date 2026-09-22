import sharp from 'sharp';
import path from 'node:path';

async function processTo512(src, dst) {
  const trimmed = await sharp(src).trim().toBuffer();
  const meta = await sharp(trimmed).metadata();
  const maxDim = Math.max(meta.width, meta.height);
  const pad = Math.round(maxDim * 0.05);
  const totalDim = maxDim + pad * 2;
  const padLeft = Math.floor((totalDim - meta.width) / 2);
  const padRight = totalDim - meta.width - padLeft;
  const padTop = Math.floor((totalDim - meta.height) / 2);
  const padBottom = totalDim - meta.height - padTop;

  await sharp(trimmed)
    .extend({
      top: padTop,
      bottom: padBottom,
      left: padLeft,
      right: padRight,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .resize(512, 512, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 })
    .toFile(dst);
  console.log('Saved 512x512:', dst);
}

async function processToAvatar(src, dst) {
  const trimmed = await sharp(src).trim().toBuffer();
  const targetDim = 215;
  const resized = await sharp(trimmed)
    .resize(targetDim, targetDim, { fit: 'inside', kernel: sharp.kernel.lanczos3 })
    .toBuffer();
  const rMeta = await sharp(resized).metadata();
  const padLeft = Math.floor((256 - rMeta.width) / 2);
  const padRight = 256 - rMeta.width - padLeft;
  const padTop = Math.floor((256 - rMeta.height) / 2);
  const padBottom = 256 - rMeta.height - padTop;

  await sharp(resized)
    .extend({
      top: padTop,
      bottom: padBottom,
      left: padLeft,
      right: padRight,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png({ compressionLevel: 9 })
    .toFile(dst);
  console.log('Saved transparent avatar 256x256:', dst);
}

const rawDir = 'design/brand/raw';
const img3dDir = 'src/assets/images3d';

// 1. 分药助手横幅专用 · 盒宝 · 分药小管家
await processTo512(path.join(rawDir, '【分药助手横幅专用】盒宝 · 分药小管家.png'), path.join(img3dDir, 'pillbox-banner.png'));

// 2. 全部药品统计卡片 · 盒宝 · 药箱小卫士
await processTo512(path.join(rawDir, '【全部药品统计卡片】盒宝 · 药箱小卫士.png'), path.join(img3dDir, 'stat-pillbox.png'));

// 3. 服药计划统计卡片 · 盒宝 · 日历计划官
await processTo512(path.join(rawDir, '【服药计划统计卡片】盒宝 · 日历计划官.png'), path.join(img3dDir, 'stat-notebook.png'));

// 4. 服药打卡卡片 · 盒宝 · 点赞鼓励官
await processTo512(path.join(rawDir, '【服药打卡卡片 & 弹窗】盒宝 · 点赞鼓励官.png'), path.join(img3dDir, 'stat-target.png'));

// 5. 服药打卡确认弹窗
await processTo512(path.join(rawDir, '【服药打卡卡片 & 弹窗】盒宝 · 点赞鼓励官.png'), path.join(img3dDir, 'floating-pill.png'));

// 6. 空状态治愈插画
await processTo512(path.join(rawDir, '【服药计划统计卡片】盒宝 · 日历计划官.png'), path.join(img3dDir, 'mascot-empty.png'));

// 7. 盒宝官方专属头像 avatar_17_hebao.png (256x256 透明底)
const bustSrc = path.join(rawDir, '【服药打卡卡片 & 弹窗】盒宝 · 点赞鼓励官.png');
const avatarDst = 'src/ui/assets/avatars/avatar_17_hebao.png';
await processToAvatar(bustSrc, avatarDst);
