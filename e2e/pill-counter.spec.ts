import { expect, test } from '@playwright/test';
import sharp from 'sharp';

const PILLS = [
  { x: 60, y: 60 },
  { x: 145, y: 55 },
  { x: 230, y: 62 },
  { x: 100, y: 155 },
  { x: 195, y: 150 },
];

async function makePillPhoto(): Promise<Buffer> {
  const circles = PILLS.map(
    (pill) => `<circle cx="${pill.x}" cy="${pill.y}" r="16" fill="#eef0f4"/>`,
  ).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">
    <rect width="320" height="240" fill="#242a30"/>
    ${circles}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

test('counts pills from a photo and allows manual correction before confirming', async ({ page }) => {
  await page.addInitScript(() => {
    const stream = new MediaStream();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => stream },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: async () => undefined,
    });
  });

  const photo = await makePillPhoto();
  await page.goto('/#/scan');
  await page.locator('.scan-quick-card', { hasText: '快速数药片' }).click();
  await expect(page.getByRole('button', { name: '拍照' })).toBeVisible();

  // 相机页里的「相册上传」是备用入口；这里直接用它喂一张合成药片照片。
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: '相册上传' }).click(),
  ]);
  await chooser.setFiles({ name: 'pills.png', mimeType: 'image/png', buffer: photo });

  const sheet = page.locator('.pill-counter-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('共 5 粒');

  // 点画面空白处手动补一粒，再点同一处删除，数量回到 5。
  const canvas = sheet.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not laid out');
  const emptySpot = { x: 20, y: Math.round(box.height - 16) };
  await canvas.click({ position: emptySpot });
  await expect(sheet).toContainText('共 6 粒');
  await canvas.click({ position: emptySpot });
  await expect(sheet).toContainText('共 5 粒');

  await page.getByRole('button', { name: `确认 5 片` }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText('已完成清点：共 5 粒药片')).toBeVisible();
  // 确认后回到药片清点入口，不再停留在已经关闭的相机画面。
  await expect(page.getByRole('button', { name: '打开相机' })).toBeVisible();
});

async function makeBlisterPhoto(): Promise<Buffer> {
  const width = 320;
  const height = 240;
  const x0 = width * 0.08;
  const y0 = height * 0.08;
  const gw = width * 0.84;
  const gh = height * 0.84;
  const filled = [true, true, false, true, false, true];
  const circles: string[] = [];
  for (let r = 0; r < 2; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      const cx = Math.round(x0 + ((c + 0.5) / 3) * gw);
      const cy = Math.round(y0 + ((r + 0.5) / 2) * gh);
      const ok = filled[r * 3 + c]!;
      circles.push(
        `<circle cx="${cx}" cy="${cy}" r="${ok ? 18 : 16}" fill="${ok ? '#f7f7f9' : '#6e727a'}"/>`,
      );
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="#b2b6bc"/>
    ${circles.join('')}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

test('switches to blister mode, adjusts grid steppers, and toggles cavity state', async ({ page }) => {
  await page.addInitScript(() => {
    const stream = new MediaStream();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => stream },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: async () => undefined,
    });
  });

  const photo = await makeBlisterPhoto();
  await page.goto('/#/scan');
  await page.locator('.scan-quick-card', { hasText: '快速数药片' }).click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: '相册上传' }).click(),
  ]);
  await chooser.setFiles({ name: 'blister.png', mimeType: 'image/png', buffer: photo });

  const sheet = page.locator('.pill-counter-sheet');
  await expect(sheet).toBeVisible();

  await sheet.getByRole('button', { name: '整板药片' }).click();
  await sheet.getByRole('button', { name: '药板网格' }).click();

  const colsDec = sheet.getByRole('button', { name: '减少 药板列数' });
  // Default grid is 2 rows x 5 cols -> step down cols twice to 3 cols
  await colsDec.click();
  await colsDec.click();
  await expect(sheet).toContainText('共 4 粒');

  // Toggle empty top-right cell (row 0, col 2 => ~78% width, 29% height)
  const canvas = sheet.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not laid out');
  await canvas.click({
    position: {
      x: Math.round(box.width * 0.78),
      y: Math.round(box.height * 0.29),
    },
  });
  await expect(sheet).toContainText('共 5 粒');
});
