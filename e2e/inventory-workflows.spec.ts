import { expect, test } from '@playwright/test';
import { seedVisualFixtures } from './visual-fixtures';

test.describe('inventory entry workflows', () => {
  test('adds stock to the current remaining amount instead of replacing it', async ({ page }) => {
    await seedVisualFixtures(page);
    await page.goto('/#/meds/inventory');

    await page.getByRole('button', { name: '添加库存', exact: true }).click();
    await page.getByRole('button', { name: /给视觉验收用的长药品名称.*添加库存/ }).click();
    // 0.9.11 起数量输入改为步进器；label 内含 +/- 按钮，直接定位输入框
    await page.locator('.inventory-stepper-input').fill('2.5');

    await expect(page.locator('.inventory-add-preview-card')).toContainText('当前 12.5片 → 入库后 15片');
    await page.getByRole('button', { name: '确认添加库存' }).click();

    await expect(page.locator('.inventory-card-days').first()).toContainText('剩余 15片');
  });
});
