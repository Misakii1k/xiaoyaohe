import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const URL = (process.env.UI_AUDIT_URL || 'http://localhost:5173/').replace(/\/$/, '') + '/';
const OUT = resolve('output', 'interactions');
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

async function wait(page, ms = 700) {
  await page.waitForTimeout(ms);
}

async function capture(page, name, vp) {
  const path = resolve(OUT, `ui-audit-${name}-${vp.name}.png`);
  await page.screenshot({ path, fullPage: true });
  log('screenshot', `${name} @ ${vp.name}`);
}

async function safeClick(page, selectorOrLocator, label, vp) {
  try {
    const locator = typeof selectorOrLocator === 'string' ? page.locator(selectorOrLocator).first() : selectorOrLocator.first();
    if (await locator.count() > 0 && await locator.isVisible().catch(() => false)) {
      await locator.click();
      await wait(page, 500);
      return true;
    }
  } catch (err) {
    log('click-failed', { label, vp: vp.name, error: err.message });
  }
  return false;
}

async function seedData(page) {
  const result = await page.evaluate(async () => {
    try {
      const { createScheduleRevision } = await import('/src/domain/medicationSchedule.ts');
      const today = new Date();
      const offset = today.getTimezoneOffset() * 60000;
      const local = new Date(today.getTime() - offset);
      const localDate = local.toISOString().slice(0, 10);
      const now = Date.now();
      const medId = `med-ui-test-${now}`;
      const ruleId = `rule-ui-test-${now}`;
      const med = {
        id: medId,
        name: '测试药品',
        dosageText: '5mg/片',
        amountPerDose: '1片',
        doseQuantity: 1,
        doseUnit: '片',
        doseSourceText: '1片',
        slots: ['morning'],
        mealRels: ['before'],
        mealRelsBySlot: { morning: ['before'] },
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        reminderMode: 'strong',
        inventory: { remaining: 30, unit: '片', packageQuantity: 30, lowThreshold: 5 },
        notes: 'UI 测试用药',
        identity: { gtins: [], rawCodes: [], ocrNames: [], photoHashes: [] },
        updatedAt: now,
        createdAt: now,
      };
      const rule = {
        id: ruleId,
        medId,
        slot: 'morning',
        timeLocal: '08:00',
        enabled: true,
        escalate: { repeatEveryMin: 10, maxRepeats: 3, notifyCaregiverAfterMin: 30 },
        updatedAt: now,
      };
      const revision = createScheduleRevision(med, rule, { effectiveDate: localDate, createdAt: now, enabled: true });
      const db = await new Promise((res, rej) => {
        const request = indexedDB.open('medbox', 7);
        request.onerror = () => rej(request.error);
        request.onsuccess = () => res(request.result);
        request.onupgradeneeded = () => {
          const d = request.result;
          if (!d.objectStoreNames.contains('meds')) d.createObjectStore('meds', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('rules')) {
            const s = d.createObjectStore('rules', { keyPath: 'id' });
            s.createIndex('byMed', 'medId');
          }
          if (!d.objectStoreNames.contains('scheduleRevisions')) {
            const s = d.createObjectStore('scheduleRevisions', { keyPath: 'id' });
            s.createIndex('byMed', 'medId');
            s.createIndex('bySourceRule', 'sourceRuleId');
          }
        };
      });
      const tx = db.transaction(['meds', 'rules', 'scheduleRevisions'], 'readwrite');
      await Promise.all([
        new Promise((res, rej) => { const r = tx.objectStore('meds').put(med); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }),
        new Promise((res, rej) => { const r = tx.objectStore('rules').put(rule); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }),
        new Promise((res, rej) => { const r = tx.objectStore('scheduleRevisions').put(revision); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }),
      ]);
      await new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
      return { ok: true, medId, ruleId };
    } catch (err) {
      return { ok: false, error: err.message, stack: err.stack };
    }
  });
  return result;
}

async function closeAssistant(page) {
  const collapseBtn = page.locator('button[aria-label="收起小助手"]').first();
  if (await collapseBtn.count() > 0 && await collapseBtn.isVisible().catch(() => false)) {
    await collapseBtn.click();
    await wait(page, 300);
  }
}

async function closeBottomSheet(page) {
  const overlay = page.locator('.bottom-sheet-overlay').first();
  if (await overlay.count() > 0 && await overlay.isVisible().catch(() => false)) {
    await overlay.click({ position: { x: 10, y: 10 } });
    await wait(page, 300);
  }
}

async function closeAnyWizard(page) {
  const quit = page.locator('.med-wizard-skip').first();
  if (await quit.count() > 0 && await quit.isVisible().catch(() => false)) {
    await quit.click();
    await wait(page, 400);
    return;
  }
  const wizardOverlay = page.locator('.med-wizard-overlay').first();
  if (await wizardOverlay.count() > 0 && await wizardOverlay.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await wait(page, 400);
  }
}

async function auditViewport(vp) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  page.on('console', (msg) => consoleLogs.push({ vp: vp.name, type: msg.type(), text: msg.text(), location: msg.location() }));
  page.on('pageerror', (err) => pageErrors.push({ vp: vp.name, message: err.message, stack: err.stack }));

  await page.goto(URL);
  await page.waitForLoadState('networkidle');
  await wait(page, 800);

  const seedResult = await seedData(page);
  log('seed', seedResult);
  const medId = seedResult.ok ? seedResult.medId : null;

  // --- Meds list interactions ---
  await page.goto(`${URL}#/meds`);
  await page.waitForLoadState('networkidle');
  await closeAssistant(page);
  await wait(page, 700);
  await capture(page, 'meds-list', vp);

  await safeClick(page, page.locator('button').filter({ hasText: /^早$/ }), 'filter-morning', vp);
  await capture(page, 'meds-list-filter-morning', vp);

  await safeClick(page, page.locator('button').filter({ hasText: /^全部$/ }), 'filter-all', vp);
  await capture(page, 'meds-list-filter-all', vp);

  // --- Meds add interactions ---
  await page.goto(`${URL}#/meds/new`);
  await page.waitForLoadState('networkidle');
  await closeAssistant(page);
  await wait(page, 700);
  await capture(page, 'meds-new', vp);

  for (const label of ['库存与有效期', '用药规则', '备注与识别依据']) {
    const acc = page.locator('.ui-accordion-summary').filter({ hasText: new RegExp(label) }).first();
    if (await acc.count() > 0) {
      await acc.click();
      await wait(page, 500);
      await capture(page, `meds-new-accordion-${label}`, vp);
    }
  }

  // --- Meds edit page ---
  if (medId) {
    await page.goto(`${URL}#/meds/${medId}/edit`);
    await page.waitForLoadState('networkidle');
    await closeAssistant(page);
    await wait(page, 800);
    await capture(page, 'meds-edit', vp);
  }

  // --- Scan interactions ---
  await page.goto(`${URL}#/scan`);
  await page.waitForLoadState('networkidle');
  await closeAssistant(page);
  await wait(page, 700);
  await capture(page, 'scan-home', vp);

  await safeClick(page, page.locator('.scan-entry-card').filter({ hasText: /开始分药/ }), 'scan-start-sort', vp);
  await capture(page, 'scan-sort-opened', vp);
  await closeAnyWizard(page);
  await page.goto(`${URL}#/scan`);
  await wait(page, 600);

  await safeClick(page, page.locator('.scan-entry-card').filter({ hasText: /扫一扫认药/ }), 'scan-qr-opened', vp);
  await capture(page, 'scan-qr-opened', vp);
  await page.goto(`${URL}#/scan`);
  await wait(page, 600);

  for (const label of ['拍药单录入', '拍药盒识别', '手动添加']) {
    const btn = page.locator('.scan-more-btn, button').filter({ hasText: new RegExp(label) }).first();
    if (await btn.count() > 0 && await btn.isVisible().catch(() => false)) {
      await btn.click();
      await wait(page, 700);
      await capture(page, `scan-action-${label}`, vp);
      await closeAnyWizard(page);
      await page.goto(`${URL}#/scan`);
      await wait(page, 500);
    }
  }

  // --- Inventory interactions ---
  await page.goto(`${URL}#/meds/inventory`);
  await page.waitForLoadState('networkidle');
  await closeAssistant(page);
  await wait(page, 700);
  await capture(page, 'inventory-home', vp);

  await safeClick(page, page.locator('button').filter({ hasText: /智能录入/ }), 'inventory-smart-entry', vp);
  await capture(page, 'inventory-smart-entry', vp);
  await closeBottomSheet(page);

  await safeClick(page, page.locator('button').filter({ hasText: /分享/ }), 'inventory-share', vp);
  await capture(page, 'inventory-share', vp);
  await closeBottomSheet(page);

  if (medId) {
    await page.goto(`${URL}#/meds/${medId}/edit`);
    await page.waitForLoadState('networkidle');
    await wait(page, 600);
    await capture(page, 'inventory-edit-med', vp);
  }

  // --- Settings interactions ---
  await page.goto(`${URL}#/settings`);
  await page.waitForLoadState('networkidle');
  await closeAssistant(page);
  await wait(page, 800);
  await capture(page, 'settings-collapsed', vp);

  const summaries = await page.locator('.panel-head').all();
  for (let i = 0; i < summaries.length; i++) {
    const summary = summaries[i];
    const title = await summary.locator('.panel-title').textContent().catch(() => `acc-${i}`);
    const slug = title.trim().replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fa5-]/g, '').slice(0, 20);
    await summary.click();
    await wait(page, 600);
    await capture(page, `settings-expanded-${i}-${slug}`, vp);
    // Keep expanded to check cumulative layout / scroll
  }

  await context.close();
}

const browser = await chromium.launch({ headless: true });
for (const vp of viewports) {
  await auditViewport(vp);
}
await browser.close();

writeFileSync(
  resolve(OUT, 'ui-audit-interactions.json'),
  JSON.stringify({ console: consoleLogs, pageErrors, auditLog }, null, 2),
  'utf8'
);
console.log('interactions audit done');
