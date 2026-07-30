import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const URL = 'http://localhost:5173/#/settings';
const OUT = resolve('output', 'layout-check');
mkdirSync(OUT, { recursive: true });

async function run() {
  const browser = await chromium.launch({ headless: true });
  for (const vp of [{ name: 'phone-320', width: 320, height: 568 }, { name: 'phone-390', width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    await page.goto(URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    // Find and click AI 服务商 panel head
    const head = page.locator('.panel-head').filter({ hasText: /AI 服务商/ }).first();
    console.log(vp.name, 'head count', await head.count(), 'visible', await head.isVisible().catch(() => false));
    if (await head.count() > 0) {
      await head.click();
      await page.waitForTimeout(800);
      const path = resolve(OUT, `settings-ai-provider-${vp.name}.png`);
      await page.screenshot({ path, fullPage: true });
      console.log('saved', path);

      // Measure overflow
      const info = await page.evaluate(() => {
        const docWidth = document.documentElement.scrollWidth;
        const clientWidth = document.documentElement.clientWidth;
        const panelBody = document.querySelector('.panel.open .panel-body');
        const overflows = [];
        if (docWidth > clientWidth) {
          document.querySelectorAll('*').forEach((el) => {
            if (el.scrollWidth > el.clientWidth + 1) {
              overflows.push({ tag: el.tagName, class: el.className, text: el.textContent?.slice(0, 60) });
            }
          });
        }
        return { docWidth, clientWidth, overflow: docWidth > clientWidth, overflows, bodyWidth: panelBody?.scrollWidth };
      });
      console.log(vp.name, 'overflow info', JSON.stringify(info, null, 2));
    }
    await context.close();
  }
  await browser.close();
}

run().catch((err) => { console.error(err); process.exit(1); });
