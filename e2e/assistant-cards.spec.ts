import { expect, test } from '@playwright/test';

/**
 * 小助手面板的首次冷启动预算。
 *
 * `/?assistant-preview=1` 要先让 Vite dev server 现场转译 `assistantContent` 等
 * 懒加载分块，单跑实测约 13s（生产构建是预生成静态块，不存在这个问题）。
 * 原来的 15s 在并行门禁下（`--repeat-each`、四套视口并发）必然打满并超时，
 * 表现为 `.ai-root.is-open .ai-panel` 找不到 —— 是测试预算问题，不是面板缺陷。
 * 这里放宽到 25s，仍严格小于 playwright.config.ts 的 30s 单测超时。
 */
const PANEL_BOOT_TIMEOUT = 25_000;

test('renders assistant card variants without overflowing narrow panels', async ({ page }, testInfo) => {
  await page.goto('/?assistant-preview=1#/settings');
  const panel = page.locator('.ai-panel');
  await expect(page.locator('.ai-root.is-open .ai-panel')).toBeVisible({ timeout: PANEL_BOOT_TIMEOUT });
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

test('drags the panel header to morph between floating and full-screen', async ({ page }) => {
  await page.goto('/?assistant-preview=1#/settings');
  const panel = page.locator('.ai-panel');
  await expect(page.locator('.ai-root.is-open .ai-panel')).toBeVisible({ timeout: PANEL_BOOT_TIMEOUT });
  await expect(panel).not.toHaveClass(/is-fullscreen/);

  // 手势依赖 rAF 与过渡时序，四视口并行时偶发被拖慢；失败就再拖一次，最多两轮。
  const dragUntil = async (dy: number, fullscreen: boolean): Promise<void> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const header = panel.locator('.ai-panel-header');
      const box = await header.boundingBox();
      if (!box) throw new Error('panel header not measurable');
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy + dy, { steps: 12 });
      // 停一下再松手：让落点由「拖过一半」决定，而不是被最后一帧的速度窗口左右。
      await page.waitForTimeout(180);
      await page.mouse.up();
      const matched = await expect(panel)
        .toHaveClass(fullscreen ? /is-fullscreen/ : /^(?!.*is-fullscreen).*$/, { timeout: 4000 })
        .then(() => true)
        .catch(() => false);
      if (matched) return;
    }
    throw new Error(`drag ${dy}px did not reach ${fullscreen ? 'fullscreen' : 'floating'}`);
  };

  // 按住头部向上拖：浮动面板渐变进全屏
  await dragUntil(-300, true);
  await expect(page.getByRole('button', { name: '收起面板' })).toBeVisible();

  // 全屏态按住头部向下拖：渐变还原回浮动面板
  await dragUntil(300, false);
  await expect(page.getByRole('button', { name: '展开面板' })).toBeVisible();
});
