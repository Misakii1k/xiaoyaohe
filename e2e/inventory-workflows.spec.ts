import { expect, test } from '@playwright/test';
import { seedVisualFixtures } from './visual-fixtures';

test.describe('inventory entry workflows', () => {
  test('adds stock to the current remaining amount instead of replacing it', async ({ page }) => {
    await seedVisualFixtures(page);
    await page.goto('/#/meds/inventory');

    await page.getByRole('button', { name: '添加库存', exact: true }).click();
    await page.getByRole('button', { name: /给视觉验收用的长药品名称.*添加库存/ }).click();
    await page.getByLabel('本次新增数量').fill('2.5');

    await expect(page.locator('.inventory-add-preview')).toContainText('12.5片 + 2.5片 = 15片');
    await page.getByRole('button', { name: '确认添加库存' }).click();

    await expect(page.locator('.inventory-row-details')).toContainText('剩余 15片');
  });
});
