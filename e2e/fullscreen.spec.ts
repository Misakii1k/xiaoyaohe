import { expect, test } from '@playwright/test';
import { seedVisualFixtures } from './visual-fixtures';

// 今日页顶栏自 v1.1.5 起改为常驻问候语（`.today-greeting`），
// h1 文案随当前时辰变化，因此按时段问候语匹配而非固定「今天」。
const TODAY_HEADING = /^(早上好|中午好|下午好|晚上好)$/;

const primaryRoutes = [
  { path: '/#/today', heading: TODAY_HEADING, name: 'today' },
  { path: '/#/meds', heading: '药品', name: 'medications' },
  { path: '/#/meds/inventory', heading: '库存', name: 'inventory' },
  { path: '/#/history', heading: '用药日历', name: 'history' },
  { path: '/#/meds/new', heading: '新增药品', name: 'medication-batch' },
  { path: '/#/scan', heading: '分药', name: 'scanner' },
  { path: '/#/settings', heading: '我的', name: 'settings' },
] as const;

test.describe('fullscreen visual matrix', () => {
  test('keeps each primary page within its app shell', async ({ page }, testInfo) => {
    await seedVisualFixtures(page);

    for (const route of primaryRoutes) {
      await page.goto(route.path);
      const heading = page.getByRole('heading', { level: 1, name: route.heading });
      await expect(heading).toBeVisible();
      // 保活页签（tabPool PRIMARY_TAB_ROUTES）会让每个缓存页签各持有一个 .app-shell，
      // 非激活页签带 hidden + display:none。这里断言「可见的 shell 只有一个」，
      // 既保留原用例意图，又兼容保活架构。
      await expect(page.locator('.app-shell:visible')).toHaveCount(1);
      await expect(page.locator('.app-main:visible')).toBeVisible();

      const layout = await page.evaluate(() => {
        // 取可见的那个，避免 querySelector 命中被保活隐藏的页签
        const visible = (sel: string): HTMLElement | undefined =>
          Array.from(document.querySelectorAll<HTMLElement>(sel)).find((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none';
          });
        return {
          bodyWidth: document.body.scrollWidth,
          viewportWidth: window.innerWidth,
          main: visible('.app-main')?.getBoundingClientRect(),
          navigation: visible('.app-navigation')?.getBoundingClientRect(),
        };
      });
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
    // 保活架构下存在多个 tabbar，取可见的那个
    await page.locator('a[href="#/today"]:visible').first().click();
    await expect(page.getByRole('heading', { level: 1, name: TODAY_HEADING })).toBeFocused();
  });

  test('redirects the removed work route to today', async ({ page }) => {
    await page.goto('/#/work');
    await expect(page.getByRole('heading', { level: 1, name: TODAY_HEADING })).toBeVisible();
    await expect(page).toHaveURL(/#\/today$/);
  });
});
