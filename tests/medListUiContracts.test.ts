import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const source = (path: string) => readFileSync(join(root, path), 'utf8');

describe('medication list and batch-management contracts', () => {
  it('renders full-width medication rows and a semantic two-column batch list', () => {
    const page = source('src/pages/MedList.ts');

    expect(page).toContain('medication-list-page');
    expect(page).toContain('medication-list-row');
    expect(page).toContain('medication-batch-row');
    expect(page).toContain("'aria-selected'");
    expect(page).toContain('softDeleteMed');
    expect(page).toContain('deleteSelected');
  });

  it('uses the app-shell action dock and a focus-managed bottom sheet for batch commands', () => {
    const page = source('src/pages/MedList.ts');
    const styles = source('src/ui/styles/pages/medications.css');

    expect(page).toContain('createActionDock');
    expect(page).toContain('openBottomSheet');
    expect(page).toContain('actionDock: dock');
    expect(styles).toContain('grid-template-columns: var(--tap) minmax(0, 1fr)');
    expect(styles).toContain('overflow-wrap: anywhere');
    expect(styles).toContain('appearance: none');
    expect(styles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(styles).not.toContain('position: fixed');
  });
});
