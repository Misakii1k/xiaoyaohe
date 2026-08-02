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
});
