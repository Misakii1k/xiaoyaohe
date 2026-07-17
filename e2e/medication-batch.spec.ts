import { expect, test } from '@playwright/test';
import { seedVisualFixtures } from './visual-fixtures';

test.describe('medication batch visual workflow', () => {
  test('adds a blank draft and retains one atomic save command', async ({ page }, testInfo) => {
    await seedVisualFixtures(page);
    await page.goto('/#/meds/new');

    await expect(page.getByRole('button', { name: '保存 1 条药品' })).toBeVisible();
    await page.getByRole('button', { name: '添加空白药品' }).click();
    await expect(page.getByRole('button', { name: '保存 2 条药品' })).toBeVisible();

    await testInfo.attach(`${testInfo.project.name}-batch-add`, {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png',
    });
  });

  test('closes the batch time sheet before a deep-link route transition', async ({ page }) => {
    await seedVisualFixtures(page);
    await page.goto('/#/meds');

    await page.getByRole('button', { name: '批量管理' }).click();
    await page.getByRole('checkbox', { name: /视觉验收用的长药品名称/ }).check();
    await page.getByRole('button', { name: '修改时段' }).click();
    await expect(page.getByRole('dialog', { name: '选择要启用的提醒时段' })).toBeVisible();

    await page.goto('/#/today');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: '今天' })).toBeFocused();
  });
});
