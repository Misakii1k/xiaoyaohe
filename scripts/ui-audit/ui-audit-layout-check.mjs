import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const URL = (process.env.UI_AUDIT_URL || 'http://localhost:5173').replace(/\/$/, '');
const OUT = resolve('output', 'layout-check');
mkdirSync(OUT, { recursive: true });

const viewports = [
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'phone-320', width: 320, height: 568 },
];

const consoleLogs = [];
const pageErrors = [];
const findings = [];

function finding(page, vp, severity, category, message, selector) {
  const f = { page, vp: vp.name, severity, category, message, selector, time: new Date().toISOString() };
  findings.push(f);
  console.log(`[${severity}] ${page} @ ${vp.name} — ${category}: ${message}`);
}

async function wait(page, ms = 700) {
  await page.waitForTimeout(ms);
}

async function capture(page, name, vp) {
  const path = resolve(OUT, `${name}-${vp.name}.png`);
  await page.screenshot({ path, fullPage: true });
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
      return { ok: true, medId, ruleId, revisionId: revision.id };
    } catch (err) {
      return { ok: false, error: err.message, stack: err.stack };
    }
  });
  return result;
}

async function detectOverflow(page, pageName, vp) {
  const overflows = await page.evaluate(() => {
    const docWidth = document.documentElement.scrollWidth;
    const clientWidth = document.documentElement.clientWidth;
    const result = { docWidth, clientWidth, overflow: docWidth > clientWidth, elements: [] };
    if (docWidth > clientWidth) {
      const all = document.querySelectorAll('*');
      for (const el of all) {
        if (el.scrollWidth > el.clientWidth + 1) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            result.elements.push({
              tag: el.tagName,
              class: el.className,
              id: el.id,
              scrollWidth: el.scrollWidth,
              clientWidth: el.clientWidth,
              width: rect.width,
              left: rect.left,
              top: rect.top,
              text: el.textContent?.slice(0, 80),
            });
          }
        }
      }
    }
    return result;
  });
  if (overflows.overflow) {
    finding(pageName, vp, 'P1', 'horizontal-overflow', `document scrollWidth (${overflows.docWidth}) > clientWidth (${overflows.clientWidth})`, 'document');
    for (const el of overflows.elements.slice(0, 8)) {
      finding(pageName, vp, 'P1', 'horizontal-overflow-element', `${el.tagName}${el.class ? '.' + el.class.split(' ').join('.') : ''} scrollWidth=${el.scrollWidth} clientWidth=${el.clientWidth} text="${el.text}"`, el.class || el.tagName);
    }
  }
  return overflows;
}

async function checkAssistantOverlap(page, pageName, vp) {
  const info = await page.evaluate(() => {
    const launcher = document.querySelector('.ai-launcher');
    const tabbar = document.querySelector('.tabbar.app-navigation');
    if (!launcher || !tabbar) return null;
    const l = launcher.getBoundingClientRect();
    const t = tabbar.getBoundingClientRect();
    return {
      launcher: { bottom: l.bottom, top: l.top, left: l.left, right: l.right, height: l.height },
      tabbar: { top: t.top, bottom: t.bottom, left: t.left, right: t.right, height: t.height },
      overlapY: l.bottom > t.top,
      gap: t.top - l.bottom,
    };
  });
  if (info?.overlapY) {
    finding(pageName, vp, 'P1', 'assistant-overlap', `AI launcher overlaps bottom nav (launcher bottom=${info.launcher.bottom}, tabbar top=${info.tabbar.top}, gap=${info.gap})`, '.ai-launcher');
  }
  return info;
}

async function checkTopbarLayout(page, pageName, vp) {
  const info = await page.evaluate(() => {
    const topbar = document.querySelector('.topbar');
    const actions = document.querySelector('.medication-list-actions');
    if (!topbar || !actions) return null;
    const t = topbar.getBoundingClientRect();
    const a = actions.getBoundingClientRect();
    const title = topbar.querySelector('h1');
    const titleRect = title?.getBoundingClientRect();
    return {
      topbar: { height: t.height, width: t.width },
      actions: { top: a.top, left: a.left, width: a.width, height: a.height },
      title: titleRect ? { top: titleRect.top, left: titleRect.left, width: titleRect.width, height: titleRect.height } : null,
      actionsOverflowsRight: a.right > t.right,
      actionsBelowTitle: a.top > (titleRect?.bottom ?? 0) + 2,
    };
  });
  if (info?.actionsOverflowsRight) {
    finding(pageName, vp, 'P1', 'topbar-overflow', `topbar actions overflow right edge`, '.medication-list-actions');
  }
  if (info?.actionsBelowTitle && info.actions.width < info.topbar.width * 0.6) {
    finding(pageName, vp, 'P2', 'topbar-wrap', `topbar actions wrapped below title but too narrow`, '.medication-list-actions');
  }
  return info;
}

async function auditPage(browser, pageName, path, vp, opts = {}) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  page.on('console', (msg) => consoleLogs.push({ vp: vp.name, page: pageName, type: msg.type(), text: msg.text() }));
  page.on('pageerror', (err) => pageErrors.push({ vp: vp.name, page: pageName, message: err.message, stack: err.stack }));

  await page.goto(URL + path);
  await page.waitForLoadState('networkidle');
  await wait(page, 800);

  if (opts.seed) await seedData(page);
  if (opts.reload) {
    await page.reload();
    await page.waitForLoadState('networkidle');
    await wait(page, 800);
  }

  await detectOverflow(page, pageName, vp);
  await checkAssistantOverlap(page, pageName, vp);

  if (pageName === 'meds') await checkTopbarLayout(page, pageName, vp);

  if (opts.expandAccordions) {
    const heads = await page.locator('.panel-head').all();
    for (let i = 0; i < heads.length; i++) {
      try {
        await heads[i].click();
        await wait(page, 500);
        await detectOverflow(page, `${pageName}-expanded-${i}`, vp);
      } catch { /* ignore */ }
    }
  }

  await capture(page, pageName, vp);
  await context.close();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  for (const vp of viewports) {
    await auditPage(browser, 'today', '#/today', vp, { seed: true, reload: true });
    await auditPage(browser, 'meds', '#/meds', vp, { seed: true });
    await auditPage(browser, 'meds-new', '#/meds/new', vp);
    await auditPage(browser, 'scan', '#/scan', vp);
    await auditPage(browser, 'inventory', '#/meds/inventory', vp);
    await auditPage(browser, 'settings', '#/settings', vp, { expandAccordions: true });
  }
  await browser.close();

  writeFileSync(resolve(OUT, 'findings.json'), JSON.stringify({
    findings,
    console: consoleLogs.filter((c) => c.type !== 'debug'),
    pageErrors,
  }, null, 2), 'utf8');
  console.log(`\nDone. ${findings.length} findings written to ${resolve(OUT, 'findings.json')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
