import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const PORT = 4188;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const OUT_DIR = resolve('output/fullscreen-acceptance');
mkdirSync(OUT_DIR, { recursive: true });

const PROFILES = [
  {
    name: 'iphone-15-pro-light',
    title: 'iPhone 15/16 Pro (灵动岛全面屏 - 浅色)',
    width: 393,
    height: 852,
    safeTop: 54,
    safeBottom: 34,
    safeLeft: 0,
    safeRight: 0,
    theme: 'light',
  },
  {
    name: 'iphone-15-pro-dark',
    title: 'iPhone 15/16 Pro (灵动岛全面屏 - 深色夜间)',
    width: 393,
    height: 852,
    safeTop: 54,
    safeBottom: 34,
    safeLeft: 0,
    safeRight: 0,
    theme: 'dark',
  },
  {
    name: 'android-edge-to-edge-light',
    title: 'Android 15+ 挖孔全面屏 (Pixel/小米/三星 - 浅色)',
    width: 412,
    height: 915,
    safeTop: 42,
    safeBottom: 24,
    safeLeft: 0,
    safeRight: 0,
    theme: 'light',
  },
  {
    name: 'android-edge-to-edge-dark',
    title: 'Android 15+ 挖孔全面屏 (Pixel/小米/三星 - 深色)',
    width: 412,
    height: 915,
    safeTop: 42,
    safeBottom: 24,
    safeLeft: 0,
    safeRight: 0,
    theme: 'dark',
  },
  {
    name: 'compact-phone-360',
    title: '小屏紧凑全面屏 (360x780)',
    width: 360,
    height: 780,
    safeTop: 36,
    safeBottom: 20,
    safeLeft: 0,
    safeRight: 0,
    theme: 'light',
  },
  {
    name: 'phone-landscape-safe',
    title: '全面屏横屏模式 (852x393 - 带左右安全区)',
    width: 852,
    height: 393,
    safeTop: 0,
    safeBottom: 21,
    safeLeft: 54,
    safeRight: 54,
    theme: 'light',
  },
];

const PAGES = [
  { id: 'today', route: '/#/today', name: '今日用药 (Today)' },
  { id: 'meds', route: '/#/meds', name: '药品列表 (Medications)' },
  { id: 'inventory', route: '/#/meds/inventory', name: '库存管理 (Inventory)' },
  { id: 'history', route: '/#/history', name: '服药历史 (History)' },
  { id: 'scan', route: '/#/scan', name: '分药与扫码 (Scan & Sort)' },
  { id: 'settings', route: '/#/settings', name: '设置与个人中心 (Settings)' },
  { id: 'new-med', route: '/#/meds/new', name: '新增药品批次 (New Medication)' },
];

async function startViteServer() {
  console.log(`[Server] Starting Vite test server on port ${PORT}...`);
  const server = spawn('npx.cmd', ['vite', '--port', String(PORT), '--host', '127.0.0.1'], {
    stdio: 'pipe',
    shell: true,
    cwd: resolve('.'),
  });

  server.stdout.on('data', (d) => {
    // console.log(`[Vite stdout] ${d}`);
  });
  server.stderr.on('data', (d) => {
    // console.error(`[Vite stderr] ${d}`);
  });

  // Wait for server to listen
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(BASE_URL);
      if (res.ok) {
        console.log(`[Server] Vite server ready at ${BASE_URL}`);
        return server;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Vite server failed to start at ${BASE_URL}`);
}

async function seedData(page) {
  await page.evaluate(async () => {
    try {
      const { createScheduleRevision } = await import('/src/domain/medicationSchedule.ts');
      const today = new Date();
      const offset = today.getTimezoneOffset() * 60000;
      const local = new Date(today.getTime() - offset);
      const localDate = local.toISOString().slice(0, 10);
      const now = Date.now();

      const sampleMeds = [
        {
          id: 'med-aspirin',
          name: '阿司匹林肠溶片',
          dosageText: '100mg/片',
          amountPerDose: '1片',
          doseQuantity: 1,
          doseUnit: '片',
          doseSourceText: '1片',
          slots: ['morning'],
          mealRels: ['after'],
          mealRelsBySlot: { morning: ['after'] },
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          reminderMode: 'strong',
          inventory: { remaining: 28, unit: '片', packageQuantity: 30, lowThreshold: 5 },
          notes: '早餐后温水送服',
          identity: { gtins: [], rawCodes: [], ocrNames: [], photoHashes: [] },
          updatedAt: now,
          createdAt: now,
        },
        {
          id: 'med-metformin',
          name: '盐酸二甲双胍片',
          dosageText: '0.5g/片',
          amountPerDose: '1片',
          doseQuantity: 1,
          doseUnit: '片',
          doseSourceText: '1片',
          slots: ['morning', 'noon', 'evening'],
          mealRels: ['with'],
          mealRelsBySlot: { morning: ['with'], noon: ['with'], evening: ['with'] },
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          reminderMode: 'alarm',
          inventory: { remaining: 4, unit: '片', packageQuantity: 60, lowThreshold: 6 },
          notes: '餐中服用，避免胃肠不适',
          identity: { gtins: [], rawCodes: [], ocrNames: [], photoHashes: [] },
          updatedAt: now,
          createdAt: now,
        },
        {
          id: 'med-vitaminc',
          name: '维生素C咀嚼片',
          dosageText: '0.1g/片',
          amountPerDose: '2片',
          doseQuantity: 2,
          doseUnit: '片',
          doseSourceText: '2片',
          slots: ['noon'],
          mealRels: ['after'],
          mealRelsBySlot: { noon: ['after'] },
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          reminderMode: 'notification',
          inventory: { remaining: 60, unit: '片', packageQuantity: 100, lowThreshold: 10 },
          notes: '午餐后咀嚼服用',
          identity: { gtins: [], rawCodes: [], ocrNames: [], photoHashes: [] },
          updatedAt: now,
          createdAt: now,
        },
      ];

      const sampleRules = [
        {
          id: 'rule-aspirin',
          medId: 'med-aspirin',
          slot: 'morning',
          timeLocal: '08:00',
          enabled: true,
          escalate: { repeatEveryMin: 10, maxRepeats: 3, notifyCaregiverAfterMin: 30 },
          updatedAt: now,
        },
        {
          id: 'rule-metformin-m',
          medId: 'med-metformin',
          slot: 'morning',
          timeLocal: '08:00',
          enabled: true,
          escalate: { repeatEveryMin: 10, maxRepeats: 3, notifyCaregiverAfterMin: 30 },
          updatedAt: now,
        },
        {
          id: 'rule-metformin-n',
          medId: 'med-metformin',
          slot: 'noon',
          timeLocal: '12:30',
          enabled: true,
          escalate: { repeatEveryMin: 10, maxRepeats: 3, notifyCaregiverAfterMin: 30 },
          updatedAt: now,
        },
        {
          id: 'rule-vitaminc',
          medId: 'med-vitaminc',
          slot: 'noon',
          timeLocal: '12:30',
          enabled: true,
          escalate: { repeatEveryMin: 10, maxRepeats: 3, notifyCaregiverAfterMin: 30 },
          updatedAt: now,
        },
      ];

      const revisions = [
        createScheduleRevision(sampleMeds[0], sampleRules[0], { effectiveDate: localDate, createdAt: now, enabled: true }),
        createScheduleRevision(sampleMeds[1], sampleRules[1], { effectiveDate: localDate, createdAt: now, enabled: true }),
        createScheduleRevision(sampleMeds[1], sampleRules[2], { effectiveDate: localDate, createdAt: now, enabled: true }),
        createScheduleRevision(sampleMeds[2], sampleRules[3], { effectiveDate: localDate, createdAt: now, enabled: true }),
      ];

      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('medbox', 9);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (e) => {
          const d = request.result;
          if (!d.objectStoreNames.contains('meds')) d.createObjectStore('meds', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('rules')) {
            const s = d.createObjectStore('rules', { keyPath: 'id' });
            s.createIndex('byMed', 'medId');
          }
          if (!d.objectStoreNames.contains('logs')) {
            const s = d.createObjectStore('logs', { keyPath: 'id' });
            s.createIndex('byDue', 'dueAt');
          }
          if (!d.objectStoreNames.contains('photos')) {
            const s = d.createObjectStore('photos', { keyPath: 'id' });
            s.createIndex('byMed', 'medId');
          }
          if (!d.objectStoreNames.contains('pushStates')) d.createObjectStore('pushStates', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('scheduleRevisions')) {
            const s = d.createObjectStore('scheduleRevisions', { keyPath: 'id' });
            s.createIndex('byMed', 'medId');
            s.createIndex('bySourceRule', 'sourceRuleId');
          }
          if (!d.objectStoreNames.contains('syncLanMetadata')) d.createObjectStore('syncLanMetadata', { keyPath: 'key' });
          if (!d.objectStoreNames.contains('inventoryLogs')) {
            const s = d.createObjectStore('inventoryLogs', { keyPath: 'id' });
            s.createIndex('byMed', 'medId');
            s.createIndex('byTimestamp', 'timestamp');
          }
          if (!d.objectStoreNames.contains('reminderPeriods')) d.createObjectStore('reminderPeriods', { keyPath: 'slot' });
        };
      });

      const tx = db.transaction(['meds', 'rules', 'scheduleRevisions'], 'readwrite');
      for (const m of sampleMeds) tx.objectStore('meds').put(m);
      for (const r of sampleRules) tx.objectStore('rules').put(r);
      for (const rev of revisions) tx.objectStore('scheduleRevisions').put(rev);

      await new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    } catch (e) {
      console.error('seedData error', e);
    }
  });
}

async function injectSafeAreaAndTheme(page, profile) {
  await page.evaluate(({ safeTop, safeBottom, safeLeft, safeRight, theme }) => {
    // Inject CSS safe area simulation
    document.documentElement.style.setProperty('--safe-area-inset-top', `${safeTop}px`);
    document.documentElement.style.setProperty('--safe-area-inset-bottom', `${safeBottom}px`);
    document.documentElement.style.setProperty('--safe-area-inset-left', `${safeLeft}px`);
    document.documentElement.style.setProperty('--safe-area-inset-right', `${safeRight}px`);
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-liquid', 'on');
  }, profile);
}

async function runVisualAudit() {
  const server = await startViteServer();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const report = [];

  try {
    for (const profile of PROFILES) {
      console.log(`\n========================================`);
      console.log(`📱 正在模拟全面屏设备: ${profile.title}`);
      console.log(`   尺寸: ${profile.width}x${profile.height} | 安全区: 顶=${profile.safeTop}px 底=${profile.safeBottom}px 左=${profile.safeLeft}px 右=${profile.safeRight}px | 主题: ${profile.theme}`);
      console.log(`========================================`);

      const context = await browser.newContext({
        viewport: { width: profile.width, height: profile.height },
        colorScheme: profile.theme,
      });

      await context.addInitScript(({ safeTop, safeBottom, safeLeft, safeRight, theme }) => {
        document.documentElement.style.setProperty('--safe-area-inset-top', `${safeTop}px`);
        document.documentElement.style.setProperty('--safe-area-inset-bottom', `${safeBottom}px`);
        document.documentElement.style.setProperty('--safe-area-inset-left', `${safeLeft}px`);
        document.documentElement.style.setProperty('--safe-area-inset-right', `${safeRight}px`);
        document.documentElement.setAttribute('data-theme', theme);
        document.documentElement.setAttribute('data-liquid', 'on');
      }, profile);

      const page = await context.newPage();

      await page.goto(`${BASE_URL}/#/today`);
      await page.waitForLoadState('networkidle');
      await seedData(page);

      for (const p of PAGES) {
        await page.goto(`${BASE_URL}${p.route}`);
        await injectSafeAreaAndTheme(page, profile);
        await page.waitForTimeout(400);

        const filename = `${profile.name}-${p.id}.png`;
        const screenshotPath = resolve(OUT_DIR, filename);
        await page.screenshot({ path: screenshotPath, fullPage: false });

        if (p.id === 'settings' && profile.name === 'iphone-15-pro-light') {
          await page.evaluate(() => {
            const main = document.querySelector('.app-main');
            if (main) main.scrollTo(0, 1200);
          });
          await page.waitForTimeout(300);
          await page.screenshot({ path: resolve(OUT_DIR, 'iphone-15-pro-light-settings-about.png') });
          await page.evaluate(() => {
            const main = document.querySelector('.app-main');
            if (main) main.scrollTo(0, 0);
          });
        }

        // 视觉与布局诊断检查 (Layout & Visual Inspection)
        const metrics = await page.evaluate(({ safeTop, safeBottom, safeLeft, safeRight, theme }) => {
          const bodyWidth = document.body.scrollWidth;
          const viewportWidth = window.innerWidth;
          const hasHorizontalOverflow = bodyWidth > viewportWidth;

          // Check top boundary collision (only inspect visible heading elements)
          const allHeadings = Array.from(document.querySelectorAll('.today-header-title, .topbar h1, .app-header h1, h1'));
          const visibleHeading = allHeadings.find((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          const headingRect = visibleHeading ? visibleHeading.getBoundingClientRect() : null;
          const topCollision = headingRect ? (headingRect.top < safeTop && safeTop > 0) : false;

          // Check tabbar / action dock bottom bounds
          const nav = document.querySelector('.tabbar.app-navigation');
          const navRect = nav ? nav.getBoundingClientRect() : null;
          const navBottomGap = navRect ? (window.innerHeight - navRect.bottom) : 0;

          // Check Dark Mode white background anomalies
          const whiteCardElements = [];
          if (theme === 'dark') {
            const cards = document.querySelectorAll('.card, .panel, .today-progress-card, .med-stat-card, .inventory-overview-card, .inventory-card-item, .scan-quick-card, .scan-record-card, .profile-hero-card, .profile-menu-card, .calendar-card, .history-plan-item, .medication-draft-card, .med-detail-hero-card');
            cards.forEach((c) => {
              const bg = window.getComputedStyle(c).backgroundColor;
              if (bg === 'rgb(255, 255, 255)' || bg === '#ffffff' || bg === 'white') {
                whiteCardElements.push(c.className.split(' ')[0]);
              }
            });
          }

          // Check interactive touch target sizes (< 44px)
          const smallTouchTargets = [];
          const clickables = document.querySelectorAll('button:not([hidden]), a:not([hidden]), input:not([hidden]):not([type="hidden"])');
          clickables.forEach((el) => {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && (rect.width < 40 || rect.height < 40)) {
              // Ignore small inline radio check indicators if parent or pseudo expands
              if (!el.classList.contains('today-radio-btn') && !el.classList.contains('today-filter-pill')) {
                smallTouchTargets.push({ tag: el.tagName, class: el.className, w: Math.round(rect.width), h: Math.round(rect.height) });
              }
            }
          });

          return {
            bodyWidth,
            viewportWidth,
            hasHorizontalOverflow,
            topCollision,
            firstHeadingTop: headingRect?.top ?? 0,
            navBottomGap,
            whiteCardElements: [...new Set(whiteCardElements)],
            smallTouchTargetsCount: smallTouchTargets.length,
          };
        }, profile);

        console.log(`   ✓ [${p.name}] 截图: ${filename}`);
        if (metrics.hasHorizontalOverflow) {
          console.warn(`     ⚠️ 发现水平溢出! bodyWidth=${metrics.bodyWidth} > viewportWidth=${metrics.viewportWidth}`);
        }
        if (metrics.topCollision) {
          console.warn(`     ⚠️ 顶部状态栏可能遮挡! 标题顶部=${metrics.firstHeadingTop}px < 安全区顶部=${profile.safeTop}px`);
        }
        if (metrics.whiteCardElements.length > 0) {
          console.warn(`     ⚠️ 暗色模式下存在纯白底卡片! 类名: ${metrics.whiteCardElements.join(', ')}`);
        }

        report.push({
          profile: profile.title,
          profileKey: profile.name,
          page: p.name,
          pageId: p.id,
          screenshot: filename,
          metrics,
        });
      }

      // 测试弹窗浮层视觉: TakeMedModal, BottomSheet, AiAssistant
      if (profile.name === 'iphone-15-pro-light' || profile.name === 'iphone-15-pro-dark') {
        // Test TakeMedModal
        await page.goto(`${BASE_URL}/#/today`);
        await injectSafeAreaAndTheme(page, profile);
        await page.waitForTimeout(300);
        await page.evaluate(() => {
          const row = document.querySelector('.today-card-item');
          if (row) row.click();
        });
        await page.waitForTimeout(400);
        const modalFile = `${profile.name}-modal-takemed.png`;
        await page.screenshot({ path: resolve(OUT_DIR, modalFile) });
        console.log(`   ✓ [服药打卡弹窗 TakeMedModal] 截图: ${modalFile}`);

        // Test AI Assistant Open
        await page.goto(`${BASE_URL}/#/today`);
        await injectSafeAreaAndTheme(page, profile);
        await page.waitForTimeout(300);
        await page.evaluate(() => {
          const btn = document.querySelector('.ai-launcher');
          if (btn) btn.click();
        });
        await page.waitForTimeout(400);
        const aiFile = `${profile.name}-modal-assistant.png`;
        await page.screenshot({ path: resolve(OUT_DIR, aiFile) });
        console.log(`   ✓ [小助手底部聊天面板 AiAssistant] 截图: ${aiFile}`);
      }

      await context.close();
    }

    // Write HTML Summary Report
    const reportHtml = generateHtmlReport(report);
    writeFileSync(resolve(OUT_DIR, 'index.html'), reportHtml, 'utf8');
    console.log(`\n🎉 模拟器视觉验收测试完成！完整报告生成至: ${resolve(OUT_DIR, 'index.html')}`);

  } finally {
    try { await browser.close(); } catch {}
    try {
      if (server.pid) {
        spawn('taskkill', ['/pid', String(server.pid), '/f', '/t']);
      }
    } catch {}
    setTimeout(() => process.exit(0), 200);
  }
}

function generateHtmlReport(report) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>全面屏前端 UI 模拟器视觉验收报告</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 24px; background: #0f172a; color: #f8fafc; }
    h1 { font-size: 28px; margin-bottom: 8px; }
    .subtitle { color: #94a3b8; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 24px; }
    .card { background: #1e293b; border-radius: 16px; overflow: hidden; border: 1px solid #334155; display: flex; flex-direction: column; }
    .card-head { padding: 16px; border-bottom: 1px solid #334155; }
    .card-title { font-size: 16px; font-weight: 700; color: #38bdf8; margin: 0 0 4px; }
    .card-profile { font-size: 13px; color: #94a3b8; }
    .img-wrap { background: #000; display: flex; justify-content: center; padding: 12px; }
    .img-wrap img { max-width: 100%; max-height: 480px; object-fit: contain; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
    .card-tags { padding: 12px 16px; display: flex; flex-wrap: wrap; gap: 8px; }
    .badge { padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: 600; }
    .badge-ok { background: #065f46; color: #34d399; }
    .badge-warn { background: #7c2d12; color: #fb923c; }
  </style>
</head>
<body>
  <h1>📱 小药盒 · 全面屏前端 UI 模拟器视觉验收报告</h1>
  <div class="subtitle">覆盖 iPhone 15/16 Pro 灵动岛、Android 15+ 沉浸式挖孔屏、小屏 360px、横屏模式及深色夜间模式</div>
  <div class="grid">
    ${report.map((item) => `
      <div class="card">
        <div class="card-head">
          <div class="card-title">${item.page}</div>
          <div class="card-profile">${item.profile}</div>
        </div>
        <div class="img-wrap">
          <img src="${item.screenshot}" alt="${item.page}">
        </div>
        <div class="card-tags">
          <span class="badge ${item.metrics.hasHorizontalOverflow ? 'badge-warn' : 'badge-ok'}">
            ${item.metrics.hasHorizontalOverflow ? '⚠️ 水平溢出' : ' 无水平溢出'}
          </span>
          <span class="badge ${item.metrics.topCollision ? 'badge-warn' : 'badge-ok'}">
            ${item.metrics.topCollision ? '⚠️ 状态栏可能遮挡' : ' 顶部安全区正常'}
          </span>
          ${item.metrics.whiteCardElements.length > 0 ? `
            <span class="badge badge-warn">⚠️ 深色白底异常: ${item.metrics.whiteCardElements.join(', ')}</span>
          ` : ''}
        </div>
      </div>
    `).join('')}
  </div>
</body>
</html>`;
}

runVisualAudit().catch((err) => {
  console.error('Visual audit failed:', err);
  process.exit(1);
});
