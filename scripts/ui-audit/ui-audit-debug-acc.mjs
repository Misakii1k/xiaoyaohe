import { chromium } from 'playwright';

const URL = 'http://localhost:5174/#/meds/new';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
await page.goto(URL);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(800);

async function state() {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('details.ui-accordion')).map((d, i) => ({
      i,
      open: d.open,
      text: d.querySelector('.ui-accordion-title')?.textContent,
    }));
  });
}

console.log('initial', await state());
for (const label of ['库存与有效期', '用药规则', '备注与识别依据']) {
  const acc = page.locator('.ui-accordion-summary').filter({ hasText: new RegExp(label) }).first();
  console.log(label, 'count', await acc.count(), 'visible', await acc.isVisible().catch(() => false));
  await acc.click();
  await page.waitForTimeout(600);
  console.log('after', label, await state());
  await page.screenshot({ path: `output/debug-${label}.png`, fullPage: false });
}
await browser.close();
