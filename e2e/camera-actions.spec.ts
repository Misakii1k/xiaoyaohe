import { expect, test } from '@playwright/test';

test('keeps camera actions aligned with the app button hierarchy', async ({ page }) => {
  await page.addInitScript(() => {
    const stream = new MediaStream();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => stream },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: async () => undefined,
    });
  });

  await page.goto('/#/scan');
  // 分药页首屏只有「拍单录入 / 快速数药片」两张快捷卡（「拍药盒识别」已不在首屏入口）。
  await page.locator('.scan-quick-card', { hasText: '拍单录入' }).click();

  const capture = page.getByRole('button', { name: '拍照' });
  const album = page.getByRole('button', { name: '相册上传' });
  const back = page.getByRole('button', { name: '返回' });
  await expect(capture).toBeVisible();
  await expect(album).toBeVisible();
  await expect(back).toBeVisible();
  await expect(capture).toBeFocused();

  const layout = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.camera-actions .btn')];
    const [captureButton, albumButton, backButton] = buttons;
    const actions = rect('.camera-actions');
    const preview = rect('.camera-preview');
    const style = (button: HTMLButtonElement) => getComputedStyle(button);
    const colorProbe = document.createElement('span');
    colorProbe.style.color = 'var(--color-primary-pressed)';
    colorProbe.style.backgroundColor = 'var(--color-primary-soft)';
    document.body.append(colorProbe);
    const tokenStyle = getComputedStyle(colorProbe);
    const tokens = {
      primaryPressed: tokenStyle.color,
      primarySoft: tokenStyle.backgroundColor,
    };
    colorProbe.remove();
    return {
      bodyWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      actions: { width: actions.width, right: actions.right },
      preview: { width: preview.width, right: preview.right },
      buttons: buttons.map((button) => {
        const bounds = button.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height, right: bounds.right };
      }),
      captureBackground: style(captureButton).backgroundColor,
      albumBackground: style(albumButton).backgroundColor,
      backBackground: style(backButton).backgroundColor,
      // 悬浮球入口已整体废除（display:none），相机界面不得出现任何浮动助手入口
      assistantDisplay: getComputedStyle(document.querySelector<HTMLElement>('.ai-launcher')!).display,
      tokens,
    };
  });

  expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth);
  // 0.9.11 起操作行在宽屏下限制为 620px（scanner.css 相机契约样式），不再与预览等宽
  expect(layout.actions.width).toBeLessThanOrEqual(620);
  expect(layout.buttons[0].width).toBeCloseTo(layout.actions.width, 0);
  expect(layout.buttons[1].width).toBeCloseTo(layout.buttons[2].width, 0);
  expect(layout.buttons.every((button) => button.height >= 44)).toBe(true);
  expect(layout.buttons.every((button) => button.right <= layout.viewportWidth)).toBe(true);
  expect(layout.captureBackground).toBe(layout.tokens.primaryPressed);
  expect(layout.albumBackground).toBe(layout.tokens.primarySoft);
  expect(layout.backBackground).toBe('rgba(0, 0, 0, 0)');
  expect(layout.assistantDisplay).toBe('none');

  await page.keyboard.press('Tab');
  await expect(album).toBeFocused();
  const focusStyle = await album.evaluate((button) => {
    const style = getComputedStyle(button);
    return { outlineColor: style.outlineColor, outlineWidth: style.outlineWidth };
  });
  expect(focusStyle).toEqual({ outlineColor: layout.tokens.primaryPressed, outlineWidth: '3px' });
});

test('opens the in-app camera directly from the quick pill counter card', async ({ page }) => {
  await page.addInitScript(() => {
    const stream = new MediaStream();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => stream },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: async () => undefined,
    });
  });

  await page.goto('/#/scan');
  await page.locator('.scan-quick-card', { hasText: '快速数药片' }).click();

  // 点击快捷卡后直接进入相机取景，而不是弹系统文件管理器。
  await expect(page.locator('.camera-capture-card')).toContainText('拍照数药片');
  await expect(page.locator('.pill-camera-toolbar')).toBeVisible();
  const looseTab = page.locator('.pill-camera-toolbar').getByRole('button', { name: '散落药片' });
  const blisterTab = page.locator('.pill-camera-toolbar').getByRole('button', { name: '整板药片' });
  await expect(looseTab).toHaveAttribute('aria-pressed', 'true');
  await expect(blisterTab).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.camera-actions .btn')).toHaveCount(3);

  await blisterTab.click();
  await expect(blisterTab).toHaveAttribute('aria-pressed', 'true');
  await expect(looseTab).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.camera-capture-card')).toContainText('整板');

  await expect(page.getByRole('button', { name: '拍照' })).toBeVisible();
  await expect(page.getByRole('button', { name: '相册上传' })).toBeVisible();
  await expect(page.getByRole('button', { name: '返回' })).toBeVisible();

  // 返回后仍停留在药片清点流程，相机与相册两条入口都在。
  await page.getByRole('button', { name: '返回' }).click();
  await expect(page.getByRole('button', { name: '打开相机' })).toBeVisible();
  await expect(page.getByRole('button', { name: '相册上传' })).toBeVisible();
});

test('keeps the torch control from crowding the pill camera mode switch', async ({ page }) => {
  await page.addInitScript(() => {
    const fakeTrack = {
      getCapabilities: () => ({ torch: true }),
      applyConstraints: async () => undefined,
      stop: () => undefined,
    };
    const stream = new MediaStream();
    Object.defineProperty(stream, 'getVideoTracks', {
      configurable: true,
      value: () => [fakeTrack],
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => stream },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: async () => undefined,
    });
  });

  await page.goto('/#/scan');
  await page.locator('.scan-quick-card', { hasText: '快速数药片' }).click();
  const torch = page.locator('.pill-camera-toolbar').getByRole('button', { name: '补光灯' });
  await expect(torch).toBeVisible();

  const layout = await page.evaluate(() => {
    const toolbar = document.querySelector<HTMLElement>('.pill-camera-toolbar')!;
    const segmented = toolbar.querySelector<HTMLElement>('.ui-segmented-control')!;
    const torchButton = toolbar.querySelector<HTMLElement>('.pill-torch-btn')!;
    const toolbarRect = toolbar.getBoundingClientRect();
    const segmentedRect = segmented.getBoundingClientRect();
    const torchRect = torchButton.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      toolbarWidth: toolbarRect.width,
      toolbarRight: toolbarRect.right,
      segmentedWidth: segmentedRect.width,
      torchWidth: torchRect.width,
      torchRight: torchRect.right,
    };
  });

  // 补光灯必须按内容宽度排在模式切换右侧，不能把模式切换挤成 0 宽。
  expect(layout.toolbarWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.segmentedWidth).toBeGreaterThan(0);
  expect(layout.torchWidth).toBeLessThan(layout.toolbarWidth);
  expect(layout.torchRight).toBeLessThanOrEqual(layout.toolbarRight + 1);

  await torch.click();
  await expect(torch).toHaveAttribute('aria-pressed', 'true');
  await expect(torch).toHaveClass(/is-active/);
});
