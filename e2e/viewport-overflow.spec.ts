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
