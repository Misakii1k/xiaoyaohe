import { expect, test } from '@playwright/test';

test('renders assistant card variants without overflowing narrow panels', async ({ page }, testInfo) => {
  await page.goto('/?assistant-preview=1#/settings');
  const panel = page.locator('.ai-panel');
  await expect(page.locator('.ai-root.is-open .ai-panel')).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator('.ai-content-card.is-medication')).toBeVisible();
  await expect(panel.locator('.ai-content-card.is-medication .ai-card-item')).toHaveCount(3);
  await expect(panel.locator('.ai-content-card.is-inventory')).toBeVisible();
  await expect(panel.locator('.ai-content-card.is-stats')).toBeVisible();
  await expect(panel.locator('.ai-content-card.is-search')).toBeVisible();

  const layout = await page.evaluate(() => {
    const panelBox = document.querySelector<HTMLElement>('.ai-panel')!.getBoundingClientRect();
    const cards = [...document.querySelectorAll<HTMLElement>('.ai-content-card')].map((card) => {
      const box = card.getBoundingClientRect();
      return { right: box.right, width: box.width, height: box.height };
    });
    return {
      bodyWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      panelRight: panelBox.right,
      cards,
    };
  });

  expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.cards.length).toBeGreaterThanOrEqual(4);
  expect(layout.cards.every((card) => card.right <= layout.panelRight + 1)).toBe(true);
  expect(layout.cards.every((card) => card.width > 0 && card.height > 0)).toBe(true);
  await testInfo.attach(`${testInfo.project.name}-assistant-cards`, {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png',
  });
});

test('keeps the full-screen assistant inside injected system safe areas', async ({ page }) => {
  await page.goto('/?assistant-preview=1#/settings');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-area-inset-top', '32px');
    document.documentElement.style.setProperty('--safe-area-inset-right', '24px');
    document.documentElement.style.setProperty('--safe-area-inset-left', '20px');
  });
  await page.getByRole('button', { name: '展开面板' }).click();

  const panel = page.locator('.ai-panel');
  const header = panel.locator('.ai-panel-header');
  await expect(panel).toHaveClass(/is-fullscreen/);
  await expect(page.getByRole('button', { name: '收起面板' })).toBeVisible();

  const layout = await header.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      top: box.top,
      left: box.left,
      right: box.right,
      paddingTop: Number.parseFloat(style.paddingTop),
      paddingLeft: Number.parseFloat(style.paddingLeft),
      paddingRight: Number.parseFloat(style.paddingRight),
      viewportWidth: window.innerWidth,
      bodyWidth: document.body.scrollWidth,
    };
  });

  expect(layout.top).toBe(0);
  expect(layout.paddingTop).toBeGreaterThanOrEqual(32);
  expect(layout.paddingLeft).toBeGreaterThanOrEqual(20);
  expect(layout.paddingRight).toBeGreaterThanOrEqual(24);
  expect(layout.left).toBe(0);
  expect(layout.right).toBe(layout.viewportWidth);
  expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth);
});
