import { chromium } from 'playwright';

const URL = (process.env.UI_AUDIT_URL || 'http://localhost:5175/').replace(/\/$/, '') + '/';
const vp = { name: 'phone-320', width: 320, height: 568 };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
const page = await context.newPage();

await page.goto(URL);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(800);

const seed = await page.evaluate(async () => {
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
        ['meds', 'rules', 'scheduleRevisions', 'logs'].forEach((name) => { if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath: 'id' }); });
      };
    });
    const tx = db.transaction(['meds', 'rules', 'scheduleRevisions', 'logs'], 'readwrite');
    await Promise.all([
      new Promise((res, rej) => { const r = tx.objectStore('meds').put(med); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }),
      new Promise((res, rej) => { const r = tx.objectStore('rules').put(rule); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }),
      new Promise((res, rej) => { const r = tx.objectStore('scheduleRevisions').put(revision); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }),
      new Promise((res, rej) => { const r = tx.objectStore('logs').clear(); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }),
    ]);
    await new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    return { ok: true, medId };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

if (!seed.ok) {
  console.error('seed failed', seed.error);
  await browser.close();
  process.exit(1);
}

await page.goto(URL);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(600);
await page.goto(`${URL}#/today`);
await page.waitForLoadState('networkidle');
await page.reload();
await page.waitForLoadState('networkidle');
await page.waitForTimeout(800);

const initial = await page.evaluate(() => {
  const stats = document.querySelector('.today-summary-stats');
  const launcher = document.querySelector('.ai-launcher');
  const tabbar = document.querySelector('.tabbar.app-navigation');
  const statItems = Array.from(document.querySelectorAll('.today-summary-stat'));
  const style = stats ? getComputedStyle(stats) : null;
  return {
    statsDisplay: style?.display,
    statsGridColumns: style?.gridTemplateColumns,
    statBoxes: statItems.map((s) => {
      const r = s.getBoundingClientRect();
      return { top: r.top, left: r.left, width: r.width, height: r.height };
    }),
    launcherBox: launcher ? (() => { const r = launcher.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; })() : null,
    tabbarBox: tabbar ? (() => { const r = tabbar.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })() : null,
  };
});
console.log('initial layout', JSON.stringify(initial, null, 2));

const buttons = await page.locator('button').all();
const buttonTexts = await Promise.all(buttons.map((b) => b.textContent().catch(() => '')));
console.log('buttons', buttonTexts.map((t) => t.trim()));
const rowCount = await page.locator('.today-medication-row').count();
console.log('row count', rowCount);
if (rowCount > 0) {
  console.log('row text', await page.locator('.today-medication-row').first().textContent());
}
const skipBtn = page.locator('button').filter({ hasText: /跳过/ }).first();
await skipBtn.click();
await page.waitForTimeout(1200);

const afterSkip = await page.evaluate(() => {
  const toast = document.querySelector('.toast');
  const actions = document.querySelector('.today-slot-actions');
  const undo = document.querySelector('.today-slot-actions button');
  const launcher = document.querySelector('.ai-launcher');
  return {
    toastBox: toast ? (() => { const r = toast.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; })() : null,
    actionsBox: actions ? (() => { const r = actions.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })() : null,
    undoBox: undo ? (() => { const r = undo.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })() : null,
    launcherBox: launcher ? (() => { const r = launcher.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })() : null,
  };
});
console.log('after skip', JSON.stringify(afterSkip, null, 2));

await browser.close();
