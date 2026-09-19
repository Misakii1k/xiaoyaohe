import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const source = (path: string) => readFileSync(join(root, path), 'utf8');

describe('today page compact fullscreen contracts', () => {
  it('uses a compact summary and list-style medication time sections', () => {
    const page = source('src/pages/Today.ts');

    expect(page).toContain("class: 'page today-page'");
    expect(page).toContain("class: 'today-summary'");
    expect(page).toContain('today-slot');
    expect(page).toContain('today-medication-row');
    expect(page).not.toContain('stat-card-wrap');
  });

  it('keeps long medication names, actions, and notification focus inside the shell scroll region', () => {
    const styles = source('src/ui/styles/pages/today.css');

    expect(styles).toContain('.today-medication-name');
    expect(styles).toContain('overflow-wrap: anywhere');
    expect(styles).toContain('.today-slot-actions');
    expect(styles).toContain('min-inline-size: 0');
    expect(styles).toContain('scroll-margin-block');
  });

  it('keeps the summary progress ring prominent across responsive layouts', () => {
    const styles = source('src/ui/styles/pages/today.css');

    expect(styles).toMatch(/\.today-summary-progress\s*\{[^}]*inline-size: 112px;[^}]*block-size: 112px;/s);
    expect(styles).toMatch(/@media \(max-width: 420px\)[\s\S]*\.today-summary-progress,[\s\S]*inline-size: 96px;[\s\S]*block-size: 96px;/);
  });

  it('cancels only local dose notification tags after recording an intake', () => {
    const page = source('src/pages/Today.ts');

    expect(page).toContain('closeNotificationsByTag(item.occurrence.id)');
    expect(page).toContain('closeNotificationsByTag(item.occurrence.legacyLogId)');
    expect(page).not.toContain("item.occurrence.id + '_care'");
  });

  it('provides slot-level batch intake button for pending items and clears notifications', () => {
    const page = source('src/pages/Today.ts');

    expect(page).toContain('today-batch-take-btn');
    expect(page).toContain('setOccurrenceActions');
    expect(page).toContain("class: 'today-time-status-pill taken'");
    expect(page).toContain('pendingItems.length > 0');
    expect(page).not.toContain("i.log?.status !== 'taken'");
  });

  it('contracts: clean header without big date, interactive week strip with today dot and readonly guard', () => {
    const page = source('src/pages/Today.ts');
    const styles = source('src/ui/styles/pages/today.css');

    // 移除右侧巨大斜体数字，仅保留 AI 助手与可选的返回今天按钮
    expect(page).not.toContain('today-date');
    expect(page).toContain('today-ai-btn');
    expect(page).toContain('today-return-btn');

    // 周历胶囊条契约
    expect(page).toContain('week-container');
    expect(page).toContain('week-nav-btn');
    expect(page).toContain('day-today-indicator');
    expect(page).toContain('day-name');

    // 样式契约
    expect(styles).toContain('.day.selected');
    expect(styles).toContain('.day-today-indicator');
    expect(styles).toContain('.today-return-btn');
    expect(styles).toContain('.week-container');

    // 只读保护契约：非今天隐藏下一次用药，卡片受保护
    expect(page).toContain('isViewingToday');
    expect(page).toContain('isReadOnly');
  });

  it('contracts: progress ring adapts font sizing and styling for 100% full state to prevent overflow', () => {
    const components = source('src/ui/components.ts');
    const legacyStyles = source('src/ui/styles/legacy.css');
    const todayStyles = source('src/ui/styles/pages/today.css');

    // 结构标记契约：100% 满格状态输出 is-full 标记与 dataset
    expect(components).toContain("isFull ? ' is-full' : ''");
    expect(components).toContain("wrap.dataset.percent = String(percent)");
    expect(components).toContain("ring-num ring-value' + (isFull ? ' is-full' : '')");

    // 样式防御契约：声明 100% 紧凑字号 19px 与 10.5px，防止三位数溢出 78px 环内圈
    expect(legacyStyles).toContain('.progress-ring.is-full .ring-num');
    expect(legacyStyles).toContain('.progress-ring.is-done .ring-num');
    expect(legacyStyles).toContain('font-size: 19px');
    expect(legacyStyles).toContain('font-size: 10.5px');

    expect(todayStyles).toContain('.today-summary .progress-ring.is-full .ring-num');
    expect(todayStyles).toContain('.today-summary .progress-ring.is-done .ring-num');
    expect(todayStyles).toContain('font-size: 19px');
    expect(todayStyles).toContain('font-size: 10.5px');
  });
});
