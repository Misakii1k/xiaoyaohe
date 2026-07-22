import { expect, test } from '@playwright/test';
import { seedVisualFixtures } from './visual-fixtures';

const primaryRoutes = [
  { path: '/#/today', heading: '今天', name: 'today' },
  { path: '/#/meds', heading: '药品', name: 'medications' },
  { path: '/#/meds/inventory', heading: '库存', name: 'inventory' },
  { path: '/#/meds/new', heading: '新增药品', name: 'medication-batch' },
  { path: '/#/scan', heading: '分药', name: 'scanner' },
  { path: '/#/settings', heading: '设置', name: 'settings' },
] as const;

test.describe('fullscreen visual matrix', () => {
  test('keeps each primary page within its app shell', async ({ page }, testInfo) => {
    await seedVisualFixtures(page);

    for (const route of primaryRoutes) {
      await page.goto(route.path);
      const heading = page.getByRole('heading', { level: 1, name: route.heading });
      await expect(heading).toBeVisible();
      await expect(page.locator('.app-shell')).toHaveCount(1);
      await expect(page.locator('.app-main')).toBeVisible();

      const layout = await page.evaluate(() => ({
        bodyWidth: document.body.scrollWidth,
        viewportWidth: window.innerWidth,
        main: document.querySelector('.app-main')?.getBoundingClientRect(),
        navigation: document.querySelector('.app-navigation')?.getBoundingClientRect(),
      }));
      expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth);
      expect(layout.main).toBeTruthy();
      expect(layout.navigation).toBeTruthy();
      const usesSideNavigation = layout.navigation!.right <= layout.main!.left + 1;
      if (usesSideNavigation) {
        expect(layout.main!.bottom).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
      } else {
        expect(layout.main!.bottom).toBeLessThanOrEqual(layout.navigation!.top + 1);
      }

      await testInfo.attach(`${testInfo.project.name}-${route.name}`, {
        body: await page.screenshot({ fullPage: false }),
        contentType: 'image/png',
      });
    }
  });

  test('moves keyboard focus into the rendered page heading', async ({ page }) => {
    await seedVisualFixtures(page);
    await page.goto('/#/meds');
    await expect(page.getByRole('heading', { level: 1, name: '药品' })).toBeVisible();
    await page.locator('a[href="#/today"]').click();
    await expect(page.getByRole('heading', { level: 1, name: '今天' })).toBeFocused();
  });

  test('redirects the removed work route to today', async ({ page }) => {
    await page.goto('/#/work');
    await expect(page.getByRole('heading', { level: 1, name: '今天' })).toBeVisible();
    await expect(page).toHaveURL(/#\/today$/);
  });
});
