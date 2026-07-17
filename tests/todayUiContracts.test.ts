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
});
