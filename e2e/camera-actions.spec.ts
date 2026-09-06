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
  // 0.9.11 起分药页首屏改为入口卡；「拍药盒识别」快捷卡（div，非 button role）直接打开智能相机工作台
  await page.locator('.scan-quick-card', { hasText: '拍药盒识别' }).click();

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
