import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

describe('work page compact layout contracts', () => {
  it('renders stable today, month, and pending summaries without replacing the income engine', () => {
    const page = readFileSync(join(root, 'src/pages/WorkLog.ts'), 'utf8');

    expect(page).toContain("class: 'work-overview'");
    expect(page).toContain("metric('今日工时'");
    expect(page).toContain("metric('本月收入'");
    expect(page).toContain("metric('待结算'");
    expect(page).toContain('calculateWorkIncomeRange');
    expect(page).toContain('exportWorkEntriesCsv');
  });

  it('uses list groups and non-overlay batch controls on narrow screens', () => {
    const styles = readFileSync(join(root, 'src/ui/styles/pages/work.css'), 'utf8');

    expect(styles).toContain('.work-overview');
    expect(styles).toContain('.work-page .work-list-card');
    expect(styles).toContain('.work-batch-bar { position: static; }');
    expect(styles).toContain('.work-entry-row');
  });
});
