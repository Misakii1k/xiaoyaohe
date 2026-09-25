import { expect, test } from '@playwright/test';
import { seedVisualFixtures } from './visual-fixtures';

/**
 * 添加药品表单对齐契约：两列并排的输入框 / 自绘选择器 / 步进器
 * 必须等高、同一行顶部对齐，且不能撑出所在字段。
 */
const ROUTES = ['/meds/new', '/meds/create'];

for (const route of ROUTES) {
  test(`添加药品表单控件对齐 ${route}`, async ({ page }) => {
    await seedVisualFixtures(page);
    await page.goto(`/#${route}`);
    await page.getByRole('heading', { level: 1 }).waitFor();
    await page.waitForTimeout(600);

    const issues = await page.evaluate(() => {
      const main = Array.from(document.querySelectorAll<HTMLElement>('.app-main'))
        .find((m) => m.getBoundingClientRect().width > 0)!;
      // 展开所有折叠区与向导步骤，让全部字段参与测量
      for (const d of main.querySelectorAll('details')) (d as HTMLDetailsElement).open = true;
      for (const s of main.querySelectorAll<HTMLElement>('.med-wizard-step-content[hidden]')) s.hidden = false;

      const controls = Array.from(main.querySelectorAll<HTMLElement>(
        '.ui-stepper, .ui-picker-trigger, .field > input[type=text], .medication-field > input[type=text]',
      )).filter((e) => e.getBoundingClientRect().width > 0);

      const found: string[] = [];
      const rows = new Map<number, DOMRect[]>();
      for (const control of controls) {
        const rect = control.getBoundingClientRect();
        const field = (control.closest('.field, .medication-field') ?? control.parentElement!) as HTMLElement;
        const box = field.getBoundingClientRect();
        if (rect.right > box.right + 1.5 || rect.left < box.left - 1.5) {
          found.push(`溢出字段：${field.textContent?.trim().slice(0, 8)}`);
        }
        const key = Math.round(rect.top);
        rows.set(key, [...(rows.get(key) ?? []), rect]);
      }
      const heights = new Set(controls.map((c) => Math.round(c.getBoundingClientRect().height)));
      if (heights.size > 1) found.push(`单行控件高度不一致：${[...heights].join('/')}`);
      return found;
    });

    expect(issues).toEqual([]);
  });
}
