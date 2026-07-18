import { expect, test } from '@playwright/test';

test('renders assistant card variants without overflowing narrow panels', async ({ page }, testInfo) => {
  await page.goto('/?assistant-preview=1#/settings');
  const panel = page.locator('.ai-panel');
  await expect(page.locator('.ai-root.is-open .ai-panel')).toBeVisible();
  await expect(panel.locator('.ai-content-card.is-medication')).toBeVisible();
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
  expect(layout.cards.length).toBeGreaterThanOrEqual(3);
  expect(layout.cards.every((card) => card.right <= layout.panelRight + 1)).toBe(true);
  expect(layout.cards.every((card) => card.width > 0 && card.height > 0)).toBe(true);
  await testInfo.attach(`${testInfo.project.name}-assistant-cards`, {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png',
  });
});
