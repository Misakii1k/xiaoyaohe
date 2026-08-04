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

  test('keeps the inventory voice sheet inside the viewport above navigation and assistant UI', async ({ page }) => {
    await page.addInitScript(() => {
      class MockSpeechRecognition {
        lang = 'zh-CN';
        continuous = false;
        interimResults = false;
        onresult: ((event: unknown) => void) | null = null;
        onerror: ((event: unknown) => void) | null = null;
        onend: (() => void) | null = null;
        start() {}
        stop() { this.onend?.(); }
        abort() { this.onend?.(); }
      }
      Object.defineProperty(window, 'SpeechRecognition', {
        configurable: true,
        value: MockSpeechRecognition,
      });
    });
    await seedVisualFixtures(page);
    await page.goto('/#/meds/inventory');

    await page.getByRole('button', { name: '智能录入', exact: true }).click();
    await page.getByRole('button', { name: '按住说话' }).click();

    const dialog = page.getByRole('dialog', { name: '说一说库存' });
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel('库存描述')).toBeVisible();
    await expect(page.getByRole('button', { name: '开始说' })).toBeVisible();
    await expect(page.getByRole('button', { name: '整理成库存' })).toBeVisible();

    const layout = await page.evaluate(() => {
      const sheet = document.querySelector<HTMLElement>('.inventory-voice-sheet')!;
      const overlay = sheet.closest<HTMLElement>('.bottom-sheet-overlay')!;
      const actions = sheet.querySelector<HTMLElement>('.inventory-voice-actions')!;
      const navigation = document.querySelector<HTMLElement>('.app-navigation');
      const launcher = document.querySelector<HTMLElement>('.ai-launcher');
      const box = sheet.getBoundingClientRect();
      const actionBox = actions.getBoundingClientRect();
      return {
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        sheetTop: box.top,
        sheetBottom: box.bottom,
        sheetLeft: box.left,
        sheetRight: box.right,
        actionsBottom: actionBox.bottom,
        overlayZ: Number.parseInt(getComputedStyle(overlay).zIndex, 10),
        navigationZ: navigation ? Number.parseInt(getComputedStyle(navigation).zIndex || '0', 10) : 0,
        launcherZ: launcher ? Number.parseInt(getComputedStyle(launcher).zIndex || '0', 10) : 0,
        bodyWidth: document.body.scrollWidth,
      };
    });

    expect(layout.sheetTop).toBeGreaterThanOrEqual(0);
    expect(layout.sheetBottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
    expect(layout.actionsBottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
    expect(layout.sheetLeft).toBeGreaterThanOrEqual(0);
    expect(layout.sheetRight).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.overlayZ).toBeGreaterThan(layout.navigationZ);
    expect(layout.overlayZ).toBeGreaterThan(layout.launcherZ);
  });
});
