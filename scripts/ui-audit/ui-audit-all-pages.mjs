import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const URL = process.env.UI_AUDIT_URL || 'http://localhost:5173/';
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

async function seedData(page) {
  return page.evaluate(async () => {
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
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('medbox', 7);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
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
      return { ok: true, medId };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

async function capture(page, name, vp) {
  await page.screenshot({ path: resolve(OUT, `ui-audit-${name}-${vp.name}.png`), fullPage: true });
  const html = await page.content();
  writeFileSync(resolve(OUT, `ui-audit-${name}-${vp.name}.html`), html, 'utf8');
  log('screenshot', `${name} @ ${vp.name}`);
}

async function auditViewport(vp) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  page.on('console', (msg) => consoleLogs.push({ vp: vp.name, type: msg.type(), text: msg.text(), location: msg.location() }));
  page.on('pageerror', (err) => pageErrors.push({ vp: vp.name, message: err.message, stack: err.stack }));

  await page.goto(URL);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await seedData(page);
  await page.goto(`${URL}#/today`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);

  // Close assistant if open
  const collapseBtn = page.locator('button[aria-label="收起小助手"]').first();
  if (await collapseBtn.count() > 0 && await collapseBtn.isVisible()) {
    await collapseBtn.click();
    await page.waitForTimeout(300);
  }

  // Today
  await page.goto(`${URL}#/today`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await capture(page, 'today', vp);

  // Meds list
  await page.goto(`${URL}#/meds`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await capture(page, 'meds', vp);

  // Meds add
  await page.goto(`${URL}#/meds/new`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await capture(page, 'meds-new', vp);

  // Scan
  await page.goto(`${URL}#/scan`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await capture(page, 'scan', vp);

  // Inventory
  await page.goto(`${URL}#/meds/inventory`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await capture(page, 'inventory', vp);

  // Settings
  await page.goto(`${URL}#/settings`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await capture(page, 'settings', vp);

  // AI Assistant (open)
  await page.goto(`${URL}#/today`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  const assistantBtn = page.locator('button').filter({ hasText: /小助手/ }).first();
  if (await assistantBtn.count() > 0) {
    await assistantBtn.click();
    await page.waitForTimeout(600);
    await capture(page, 'assistant-open', vp);
  }

  await context.close();
}

const browser = await chromium.launch({ headless: true });
for (const vp of viewports) {
  await auditViewport(vp);
}
await browser.close();

writeFileSync(
  resolve(OUT, 'ui-audit-all-pages.json'),
  JSON.stringify({ console: consoleLogs, pageErrors, auditLog }, null, 2),
  'utf8'
);
console.log('all pages audit done');
