import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const URL = 'http://localhost:5173/#/today';
const OUT = resolve('output');
mkdirSync(OUT, { recursive: true });

const viewports = [
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'phone-320', width: 320, height: 568 },
];

const consoleLogs = [];
const pageErrors = [];
const auditLog = [];

function log(step, detail) {
  const entry = { step, detail, time: new Date().toISOString() };
  auditLog.push(entry);
  console.log(`[${step}]`, detail);
}

const browser = await chromium.launch({ headless: true });

for (const vp of viewports) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  page.on('console', (msg) => consoleLogs.push({ vp: vp.name, type: msg.type(), text: msg.text(), location: msg.location() }));
  page.on('pageerror', (err) => pageErrors.push({ vp: vp.name, message: err.message, stack: err.stack }));

  log('navigate', `${URL} @ ${vp.name}`);
  await page.goto(URL);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);

  // Capture initial state
  await page.screenshot({ path: resolve(OUT, `ui-audit-today-initial-${vp.name}.png`), fullPage: true });
  const initialHtml = await page.content();
  writeFileSync(resolve(OUT, `ui-audit-today-initial-${vp.name}.html`), initialHtml, 'utf8');

  // Find interactive elements
  const buttons = await page.locator('button').all();
  const buttonTexts = await Promise.all(buttons.map(async (b) => ({
    text: await b.textContent().catch(() => ''),
    ariaLabel: await b.getAttribute('aria-label').catch(() => null),
    disabled: await b.isDisabled().catch(() => false),
    boundingBox: await b.boundingBox().catch(() => null),
  })));
  log('buttons', { viewport: vp.name, count: buttons.length, buttons: buttonTexts.map((b) => ({ text: b.text.trim().slice(0, 40), ariaLabel: b.ariaLabel, disabled: b.disabled, box: b.boundingBox })) });

  // Find medication rows
  const rows = await page.locator('.today-medication-row').all();
  log('rows', { viewport: vp.name, count: rows.length });

  // Try to click "已服" or "跳过" button if present
  const actionButtons = ['已服', '跳过', '标记已服', '标记跳过'];
  let clicked = false;
  for (const label of actionButtons) {
    const locator = page.locator('button').filter({ hasText: new RegExp(label) }).first();
    if (await locator.count() > 0) {
      const box = await locator.boundingBox().catch(() => null);
      log('click', { viewport: vp.name, label, box });
      await locator.click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: resolve(OUT, `ui-audit-today-after-click-${vp.name}.png`), fullPage: true });
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    log('click', { viewport: vp.name, status: 'no-action-button-found' });
  }

  // Check for dialog/modal
  const dialogs = await page.locator('[role="dialog"], .ui-dialog, .ui-confirm-dialog, .ui-bottom-sheet').all();
  log('dialogs', { viewport: vp.name, count: dialogs.length });
  if (dialogs.length > 0) {
    await page.screenshot({ path: resolve(OUT, `ui-audit-today-dialog-${vp.name}.png`), fullPage: true });
    // Try to cancel/close dialog
    const cancelBtn = page.locator('button').filter({ hasText: /取消|关闭|否/ }).first();
    if (await cancelBtn.count() > 0) {
      await cancelBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: resolve(OUT, `ui-audit-today-after-cancel-${vp.name}.png`), fullPage: true });
    }
  }

  await context.close();
}

await browser.close();

writeFileSync(
  resolve(OUT, 'ui-audit-today.json'),
  JSON.stringify({ console: consoleLogs, pageErrors, auditLog }, null, 2),
  'utf8'
);
console.log('today audit done');
