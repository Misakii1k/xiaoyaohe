import { expect, test, type Page } from '@playwright/test';
import { seedVisualFixtures } from './visual-fixtures';

/**
 * 移动端视口守卫：B 方案验收清单「移动端」三项的常态化回归防护。
 *
 * 覆盖 320x700 / 390x844 / 430x932 三个视口：
 *   1. 无水平滚动（页面级）
 *   2. 药品名 / 时段标签 / 状态胶囊不发生中文竖排折行
 *   3. 主 CTA 触控高度 >= 44px（var(--tap)）
 *
 * 视口在文件内用 test.use 覆盖，因此不会改动 playwright.config.ts 的既有 project，
 * 也不会让其他 spec 多跑额外视口。
 */

const VIEWPORTS: Array<{ name: string; width: number; height: number }> = [
  { name: '320x700', width: 320, height: 700 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
];

const ROUTES: Array<{ name: string; path: string; needsSeed: boolean }> = [
  { name: '今日', path: '/#/today', needsSeed: true },
  { name: '药品', path: '/#/meds', needsSeed: true },
];

async function openPage(page: Page, path: string, needsSeed: boolean): Promise<void> {
  if (needsSeed) await seedVisualFixtures(page);
  await page.goto(path);
  await page.waitForTimeout(900);
}

for (const vp of VIEWPORTS) {
  test.describe(`viewport ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const route of ROUTES) {
      test(`${route.name}页 无横向溢出`, async ({ page }: { page: Page }) => {
        const errors: string[] = [];
        page.on('pageerror', (e: Error) => errors.push(String(e)));
        await openPage(page, route.path, route.needsSeed);

        const m = await page.evaluate(() => ({
          docScroll: document.documentElement.scrollWidth,
          docClient: document.documentElement.clientWidth,
          bodyScroll: document.body.scrollWidth,
          bodyClient: document.body.clientWidth,
        }));

        expect(m.docScroll, `html scrollWidth(${m.docScroll}) > clientWidth(${m.docClient})`).toBeLessThanOrEqual(m.docClient);
        expect(m.bodyScroll, `body scrollWidth(${m.bodyScroll}) > clientWidth(${m.bodyClient})`).toBeLessThanOrEqual(m.bodyClient);
        expect(errors, `未处理异常: ${errors.join(' | ')}`).toHaveLength(0);
      });
    }

    test('药品页 无中文竖排折行', async ({ page }: { page: Page }) => {
      await openPage(page, '/#/meds', true);

      const offenders = await page.evaluate(() => {
        const sels = ['.med-item-name', '.tag', '.med-stock-pill', '.med-item-spec'];
        const bad: string[] = [];
        for (const sel of sels) {
          for (const el of Array.from(document.querySelectorAll(sel))) {
            const node = el as HTMLElement;
            const cs = getComputedStyle(node);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize);
            const lines = Math.round(node.scrollHeight / lh);
            // 竖排折行的特征：多行，且单行宽度接近一个字宽（元素很窄）
            const isNarrow = node.clientWidth > 0 && node.clientWidth < parseFloat(cs.fontSize) * 1.6;
            if (lines > 1 && isNarrow && cs.whiteSpace !== 'nowrap') {
              bad.push(`${sel} w=${node.clientWidth} lines=${lines} fs=${cs.fontSize}`);
            }
          }
        }
        return bad;
      });

      expect(offenders, `疑似竖排折行: ${offenders.join('; ')}`).toHaveLength(0);
    });

    test('今日页 主 CTA 触控高度 >= 44px', async ({ page }: { page: Page }) => {
      await openPage(page, '/#/today', true);

      const small = await page.evaluate(() => {
        const sels = ['.today-primary-btn', '.today-ai-btn', '.med-fab-add', '.btn'];
        const bad: string[] = [];
        for (const sel of sels) {
          for (const el of Array.from(document.querySelectorAll(sel))) {
            const node = el as HTMLElement;
            const cs = getComputedStyle(node);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            const h = node.getBoundingClientRect().height;
            const minH = parseFloat(cs.minBlockSize || cs.minHeight || '0');
            if (h < 44 && minH < 44) bad.push(`${sel} h=${h.toFixed(1)} min=${minH}`);
          }
        }
        return bad;
      });

      expect(small, `触控高度不足 44px: ${small.join('; ')}`).toHaveLength(0);
    });
  });
}

test.describe('关怀大字模式与分药播报交互回归', () => {
  for (const vp of VIEWPORTS.slice(0, 2)) {
    test.describe(`care-mode ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      test('开启关怀大字后，我的/今日/药品/库存/分药弹窗均无横向溢出且布局适配到位', async ({ page }: { page: Page }) => {
        const errors: string[] = [];
        page.on('pageerror', (e: Error) => errors.push(String(e)));

        await seedVisualFixtures(page);

        // 1. 进入设置页，开启关怀大字模式 & 检查语音播报面板控件
        await page.goto('/#/settings');
        await page.waitForTimeout(600);
        await page.getByRole('button', { name: /外观/ }).click();
        const careSwitch = page.getByRole('switch', { name: '开启关怀大字模式' });
        await expect(careSwitch).toBeVisible();
        await careSwitch.click();

        await expect.poll(() =>
          page.evaluate(() => document.documentElement.dataset.care),
        ).toBe('on');

        await page.getByRole('button', { name: /语音播报/ }).click();
        await expect(page.getByRole('switch', { name: '分药时自动语音播报' })).toBeVisible();
        await expect(page.getByRole('button', { name: '试听示例' })).toBeVisible();

        // 2. 今日页（重载验证冷启动恢复 data-care 且加载预置药品）：无横向溢出 + 52px 触控基线 + 药名 20px 加大
        await page.goto('/#/today');
        await page.reload();
        await page.waitForTimeout(800);
        await expect.poll(() =>
          page.evaluate(() => document.documentElement.dataset.care),
        ).toBe('on');
        const todayMetrics = await page.evaluate(() => {
          const cta = document.querySelector<HTMLElement>('.today-batch-take-btn, .today-primary-btn, .btn.primary');
          const medName = document.querySelector<HTMLElement>('.today-medication-name');
          const tapToken = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap') || '0');
          return {
            docScroll: document.documentElement.scrollWidth,
            docClient: document.documentElement.clientWidth,
            tapToken,
            ctaHeight: cta?.getBoundingClientRect().height ?? 0,
            medNameFontSize: medName ? parseFloat(getComputedStyle(medName).fontSize) : 0,
          };
        });
        expect(todayMetrics.docScroll).toBeLessThanOrEqual(todayMetrics.docClient);
        expect(todayMetrics.tapToken).toBeGreaterThanOrEqual(52);
        expect(todayMetrics.ctaHeight).toBeGreaterThanOrEqual(52);
        expect(todayMetrics.medNameFontSize).toBeGreaterThanOrEqual(20);

        // 3. 药品页：单列全宽排列 + 无横向溢出 + 无竖排断字
        await page.goto('/#/meds');
        await page.waitForTimeout(700);
        const medsMetrics = await page.evaluate(() => {
          const list = document.querySelector<HTMLElement>('.med-card-list');
          const cols = list ? getComputedStyle(list).gridTemplateColumns.trim().split(/\s+/).length : 0;
          const badChips: string[] = [];
          for (const el of Array.from(document.querySelectorAll('.tag, .med-stock-pill'))) {
            const node = el as HTMLElement;
            const cs = getComputedStyle(node);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize);
            if (Math.round(node.scrollHeight / lh) > 1 && node.clientWidth < parseFloat(cs.fontSize) * 1.6) {
              badChips.push(`${node.className} w=${node.clientWidth}`);
            }
          }
          return {
            docScroll: document.documentElement.scrollWidth,
            docClient: document.documentElement.clientWidth,
            cols,
            badChips,
          };
        });
        expect(medsMetrics.docScroll).toBeLessThanOrEqual(medsMetrics.docClient);
        expect(medsMetrics.cols).toBe(1);
        expect(medsMetrics.badChips).toHaveLength(0);

        // 4. 库存页：无横向溢出
        await page.goto('/#/meds/inventory');
        await page.waitForTimeout(700);
        const invMetrics = await page.evaluate(() => ({
          docScroll: document.documentElement.scrollWidth,
          docClient: document.documentElement.clientWidth,
        }));
        expect(invMetrics.docScroll).toBeLessThanOrEqual(invMetrics.docClient);

        // 5. 分药页打开分药向导：静音图标键与重听按钮可见、无横向溢出、退出收起干净
        await page.goto('/#/scan');
        await page.waitForTimeout(700);
        await page.locator('.scan-hero-card.blue').click();
        const dialog = page.getByRole('dialog', { name: '按顺序分药' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: '关闭分药语音播报' })).toBeVisible();
        await expect(dialog.getByRole('button', { name: /重听/ })).toBeVisible();

        const wizardMetrics = await page.evaluate(() => {
          const replayBtn = document.querySelector<HTMLElement>('.med-wizard-host .med-wizard-repeat-btn');
          const primaryAction = document.querySelector<HTMLElement>('.med-wizard-host .med-wizard-actions .ui-button');
          const slotsEl = document.querySelector<HTMLElement>('.med-wizard-host .med-wizard-slots');
          const slotCols = slotsEl ? getComputedStyle(slotsEl).gridTemplateColumns.trim().split(/\s+/).length : 0;
          return {
            docScroll: document.documentElement.scrollWidth,
            docClient: document.documentElement.clientWidth,
            replayVisibleHeight: replayBtn?.getBoundingClientRect().height ?? 0,
            primaryHeight: primaryAction?.getBoundingClientRect().height ?? 0,
            slotCols,
          };
        });
        expect(wizardMetrics.docScroll).toBeLessThanOrEqual(wizardMetrics.docClient);
        expect(wizardMetrics.replayVisibleHeight).toBeGreaterThanOrEqual(32);
        expect(wizardMetrics.primaryHeight).toBeGreaterThanOrEqual(52);
        expect(wizardMetrics.slotCols).toBe(2);

        await dialog.getByRole('button', { name: '先不分了' }).click();
        await expect(dialog).toBeHidden();
        expect(errors, `未处理异常: ${errors.join(' | ')}`).toHaveLength(0);
      });
    });
  }
});
