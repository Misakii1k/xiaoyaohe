import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const URL = (process.env.UI_AUDIT_URL || 'http://localhost:5173/').replace(/\/$/, '') + '/';
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

function toLocalDate(d) {
  const offset = d.getTimezoneOffset() * 60000;
  const local = new Date(d.getTime() - offset);
  return local.toISOString().slice(0, 10);
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
  await page.waitForTimeout(1000);

  // Seed test medication data via browser module imports
  log('seed', 'creating test medication + schedule revision');
  const seedResult = await page.evaluate(async () => {
    // Clear old test data first to avoid collisions
    try {
      const d = await new Promise((resolve, reject) => {
        const request = indexedDB.open('medbox', 7);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = () => {
          const db = request.result;
          ['meds', 'rules', 'scheduleRevisions', 'logs'].forEach((name) => { if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' }); });
        };
      });
      const tx = d.transaction(['meds', 'rules', 'scheduleRevisions', 'logs'], 'readwrite');
      const clearAll = (name) => new Promise((res, rej) => { const r = tx.objectStore(name).clear(); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
      await Promise.all(['meds', 'rules', 'scheduleRevisions', 'logs'].map(clearAll));
      await new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    } catch {}

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

      // Write directly to IndexedDB
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
        new Promise((resolve, reject) => {
          const r = tx.objectStore('meds').put(med);
          r.onsuccess = () => resolve();
          r.onerror = () => reject(r.error);
        }),
        new Promise((resolve, reject) => {
          const r = tx.objectStore('rules').put(rule);
          r.onsuccess = () => resolve();
          r.onerror = () => reject(r.error);
        }),
        new Promise((resolve, reject) => {
          const r = tx.objectStore('scheduleRevisions').put(revision);
          r.onsuccess = () => resolve();
          r.onerror = () => reject(r.error);
        }),
      ]);
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return { ok: true, medId, ruleId, revisionId: revision.id };
    } catch (err) {
      return { ok: false, error: err.message, stack: err.stack };
    }
  });
  log('seed-result', seedResult);

  // Close AI assistant panel if open (look for collapse button)
  const collapseBtn = page.locator('button[aria-label="收起小助手"]').first();
  if (await collapseBtn.count() > 0 && await collapseBtn.isVisible()) {
    log('assistant', 'closing open assistant panel');
    await collapseBtn.click();
    await page.waitForTimeout(400);
  }

  // Reload to ensure seeded data is visible to the app
  await page.goto(`${URL}#/today`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);
  log('navigate', `/today @ ${vp.name} (after reload)`);

  // Debug: inspect DB state and projection
  const debugState = await page.evaluate(async () => {
    try {
      const { projectScheduleDate, toLocalDate, localDayBounds } = await import('/src/domain/medicationSchedule.ts');
      const { listMeds, listScheduleRevisions, listLogsByDay } = await import('/src/db/local.ts');
      const meds = await listMeds();
      const revisions = await listScheduleRevisions();
      const today = toLocalDate();
      const { start, end } = localDayBounds(today);
      const logs = await listLogsByDay(start, end);
      const medById = new Map(meds.map((med) => [med.id, med]));
      const projections = projectScheduleDate(revisions, today);
      const items = projections.flatMap((projection) => {
        const med = medById.get(projection.revision.medId);
        if (!med) return [];
        return [{ medId: med.id, occurrence: !!projection.occurrence, isRest: projection.isRest }];
      });
      return {
        today,
        medCount: meds.length,
        revisionCount: revisions.length,
        medIds: meds.map((m) => m.id),
        projections: projections.map((p) => ({ isRest: p.isRest, hasOccurrence: !!p.occurrence, dueAt: p.dueAt, medId: p.revision.medId, enabled: p.revision.enabled, daysOfWeek: p.revision.daysOfWeek, effectiveDate: p.revision.effectiveDate })),
        items,
        logsCount: logs.length,
      };
    } catch (err) {
      return { error: err.message, stack: err.stack };
    }
  });
  log('debug-state', debugState);

  // Capture initial state
  await page.screenshot({ path: resolve(OUT, `ui-audit-today-data-initial-${vp.name}.png`), fullPage: true });

  // Find medication rows
  const rows = await page.locator('.today-medication-row').all();
  log('rows', { viewport: vp.name, count: rows.length });

  // Find action buttons
  const actionButtons = ['已服', '跳过', '标记已服', '标记跳过'];
  let clicked = false;
  for (const label of actionButtons) {
    const locator = page.locator('button').filter({ hasText: new RegExp(label) }).first();
    if (await locator.count() > 0) {
      const box = await locator.boundingBox().catch(() => null);
      log('click', { viewport: vp.name, label, box });
      await locator.click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: resolve(OUT, `ui-audit-today-data-after-click-${vp.name}.png`), fullPage: true });
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
    await page.screenshot({ path: resolve(OUT, `ui-audit-today-data-dialog-${vp.name}.png`), fullPage: true });
    const cancelBtn = page.locator('button').filter({ hasText: /取消|关闭|否/ }).first();
    if (await cancelBtn.count() > 0) {
      await cancelBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: resolve(OUT, `ui-audit-today-data-after-cancel-${vp.name}.png`), fullPage: true });
    }
  }

  // Test "查看完整历史" link
  const historyLink = page.locator('a.today-adherence-link').first();
  if (await historyLink.count() > 0) {
    log('history-link', { viewport: vp.name, text: await historyLink.textContent() });
    await historyLink.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(OUT, `ui-audit-today-data-history-${vp.name}.png`), fullPage: true });
    // Go back
    await page.goto(`${URL}#/today`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);
  }

  await context.close();
}

await browser.close();

writeFileSync(
  resolve(OUT, 'ui-audit-today-with-data.json'),
  JSON.stringify({ console: consoleLogs, pageErrors, auditLog }, null, 2),
  'utf8'
);
console.log('today with data audit done');
