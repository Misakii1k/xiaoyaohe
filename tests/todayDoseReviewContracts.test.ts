import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const source = (path: string) => readFileSync(join(root, path), 'utf8');

describe('today dose review workflow', () => {
  it('does not ask a separate confirmation dialog for a legacy dose during intake', () => {
    const page = source('src/pages/Today.ts');

    expect(page).not.toContain("'确认剂量'");
    expect(page).toContain('剂量待复核');
    expect(page).toContain('preflightInventoryActions');
  });
});
