import { expect, test } from '@playwright/test';

const TODAY_HEADING = /^(早上好|中午好|下午好|晚上好)$/;

async function preloadTabs(page: import('@playwright/test').Page) {
  await page.goto('/#/today');
  await expect(page.getByRole('heading', { level: 1, name: TODAY_HEADING })).toBeVisible();
  await page.locator('.tab-keepalive-container:not([hidden]) a[href="#/meds"]').click();
  await expect(page.getByRole('heading', { level: 1, name: '药品' })).toBeVisible();
  await page.waitForTimeout(600);
  await page.locator('.tab-keepalive-container:not([hidden]) a[href="#/today"]').click();
  await expect(page.getByRole('heading', { level: 1, name: TODAY_HEADING })).toBeVisible();
  await page.waitForTimeout(600);
}

test('switches cached tabs with a continuous layer swap', async ({ page }) => {
  await preloadTabs(page);

  await page.locator('.tab-keepalive-container:not([hidden]) a[href="#/meds"]').click();
  await expect(page.getByRole('heading', { level: 1, name: '药品' })).toBeVisible();

  await expect(page.locator('.tab-keepalive-container[data-motion-layer="over"]')).toHaveCount(1, { timeout: 1_000 });
  await expect(page.locator('.tab-keepalive-container[data-motion-layer="under"]')).toHaveCount(1, { timeout: 1_000 });

  const layers = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.tab-keepalive-container[data-motion-layer]')].map((el) => ({
      route: el.getAttribute('data-tab-route'),
      layer: el.getAttribute('data-motion-layer'),
      animations: el.getAnimations().length,
    })),
  );
  expect(layers).toHaveLength(2);
  expect(layers.every((entry) => entry.animations > 0)).toBe(true);

  await expect(page.locator('.app-shell:visible')).toHaveCount(1, { timeout: 2_000 });
  const settled = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.tab-keepalive-container')].map((el) => ({
      route: el.getAttribute('data-tab-route'),
      hidden: el.hidden,
      layer: el.getAttribute('data-motion-layer'),
    })),
  );
  expect(settled.find((entry) => entry.route === '/today')).toMatchObject({ hidden: true, layer: null });
  expect(settled.find((entry) => entry.route === '/meds')).toMatchObject({ hidden: false, layer: null });
});

async function watchMotionLayers(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const scope = window as unknown as { __motionSnapshots: unknown[]; __motionTimer?: number };
    scope.__motionSnapshots = [];
    const capture = () => {
      const layers = [...document.querySelectorAll<HTMLElement>('[data-motion-layer]')].map((el) => ({
        selector: el.classList.contains('tab-keepalive-subpage') ? 'subpage' : 'tab',
        layer: el.getAttribute('data-motion-layer'),
      }));
      if (layers.length) scope.__motionSnapshots.push(layers);
    };
    capture();
    scope.__motionTimer = window.setInterval(capture, 10);
  });
}

async function motionSnapshots(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const scope = window as unknown as { __motionSnapshots: Array<Array<{ selector: string; layer: string | null }>> };
    return scope.__motionSnapshots;
  });
}

function sawPair(snapshots: Array<Array<{ selector: string; layer: string | null }>>, over: string, under: string) {
  return snapshots.some((layers) => {
    const overLayer = layers.find((entry) => entry.layer === 'over');
    const underLayer = layers.find((entry) => entry.layer === 'under');
    return overLayer?.selector === over && underLayer?.selector === under;
  });
}

test('enters and leaves a subpage without a white hard cut', async ({ page }) => {
  await page.goto('/#/meds');
  await expect(page.getByRole('heading', { level: 1, name: '药品' })).toBeVisible();
  await page.waitForTimeout(600);
  await watchMotionLayers(page);

  await page.evaluate(() => { location.hash = '#/meds/new'; });
  await expect(page.getByRole('heading', { level: 1, name: '新增药品' })).toBeVisible();
  await page.waitForTimeout(600);
  expect(sawPair(await motionSnapshots(page), 'subpage', 'tab')).toBe(true);
  await expect(page.locator('.app-shell:visible')).toHaveCount(1, { timeout: 2_000 });

  await page.evaluate(() => {
    const scope = window as unknown as { __motionSnapshots: unknown[] };
    scope.__motionSnapshots = [];
  });
  await page.evaluate(() => { history.back(); });
  await expect(page.getByRole('heading', { level: 1, name: '药品' })).toBeVisible();
  await page.waitForTimeout(600);
  expect(sawPair(await motionSnapshots(page), 'subpage', 'tab')).toBe(true);
  await expect(page.locator('.app-shell:visible')).toHaveCount(1, { timeout: 2_000 });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('switches pages immediately without layer animations', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/#/today');
    await expect(page.getByRole('heading', { level: 1, name: TODAY_HEADING })).toBeVisible();
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await page.locator('.tab-keepalive-container:not([hidden]) a[href="#/meds"]').click();
    await expect(page.getByRole('heading', { level: 1, name: '药品' })).toBeVisible();

    const state = await page.evaluate(() => ({
      layers: document.querySelectorAll('[data-motion-layer]').length,
      todayHidden: document.querySelector<HTMLElement>('.tab-keepalive-container[data-tab-route="/today"]')?.hidden,
    }));
    expect(state.layers).toBe(0);
    expect(state.todayHidden).toBe(true);
  });
});

test('moves the segmented indicator to the newly selected option', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { level: 1, name: '我的' })).toBeVisible();
  await page.getByRole('button', { name: '界面外观' }).first().click();
  const group = page.locator('.ui-segmented-control[aria-label="配色方案"]');
  await expect(group).toBeVisible();

  const geometry = async () =>
    page.evaluate(() => {
      const group = document.querySelector<HTMLElement>('.ui-segmented-control[aria-label="配色方案"]');
      const selected = group?.querySelector<HTMLElement>('button.is-selected');
      const indicator = group?.querySelector<HTMLElement>('.ui-segmented-indicator');
      if (!group || !selected || !indicator) return null;
      const groupRect = group.getBoundingClientRect();
      const selectedRect = selected.getBoundingClientRect();
      const indicatorRect = indicator.getBoundingClientRect();
      return {
        indicatorLeft: indicatorRect.left - groupRect.left,
        selectedLeft: selectedRect.left - groupRect.left,
        indicatorWidth: indicatorRect.width,
        opacity: getComputedStyle(indicator).opacity,
      };
    });

  await expect.poll(async () => (await geometry())?.indicatorWidth ?? 0, { timeout: 2_000 }).toBeGreaterThan(0);
  const before = await geometry();
  expect(before).not.toBeNull();
  expect(before!.indicatorWidth).toBeGreaterThan(0);
  expect(before!.opacity).toBe('1');

  await group.locator('button', { hasText: '浅色' }).click();
  await page.waitForTimeout(400);
  const after = await geometry();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.indicatorLeft - after!.selectedLeft)).toBeLessThanOrEqual(1);
  expect(after!.indicatorWidth).toBeGreaterThan(0);
});
