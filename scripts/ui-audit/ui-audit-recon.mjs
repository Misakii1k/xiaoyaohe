import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const URL = 'http://127.0.0.1:5173/';
const OUT = resolve('output');
mkdirSync(OUT, { recursive: true });

const viewports = [
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'phone-320', width: 320, height: 568 },
];

const consoleLogs = [];
const pageErrors = [];

const browser = await chromium.launch({ headless: true });
for (const vp of viewports) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  page.on('console', (msg) => consoleLogs.push({ type: msg.type(), text: msg.text(), location: msg.location() }));
  page.on('pageerror', (err) => pageErrors.push({ message: err.message, stack: err.stack }));
  await page.goto(URL);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: resolve(OUT, `ui-audit-home-${vp.name}.png`), fullPage: true });
  const html = await page.content();
  writeFileSync(resolve(OUT, `ui-audit-home-${vp.name}.html`), html, 'utf8');
  console.log(`screenshot ${vp.name} done`);
  await context.close();
}
await browser.close();

writeFileSync(
  resolve(OUT, 'ui-audit-console.json'),
  JSON.stringify({ console: consoleLogs, pageErrors }, null, 2),
  'utf8'
);
console.log('audit recon done');
