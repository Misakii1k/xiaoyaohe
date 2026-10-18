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

  await page.getByRole('button', { name: '确认数量 (5片)' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText('已完成清点：共 5 粒药片')).toBeVisible();
  // 确认后回到药片清点入口，不再停留在已经关闭的相机画面。
  await expect(page.getByRole('button', { name: '打开相机' })).toBeVisible();
});
