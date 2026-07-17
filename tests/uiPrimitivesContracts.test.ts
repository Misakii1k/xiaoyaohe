import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const source = (path: string) => readFileSync(join(root, path), 'utf8');

describe('shared UI primitive contracts', () => {
  const primitives = [
    'src/ui/primitives/Button.ts',
    'src/ui/primitives/IconButton.ts',
    'src/ui/primitives/Accordion.ts',
    'src/ui/primitives/BottomSheet.ts',
    'src/ui/primitives/ActionDock.ts',
    'src/ui/primitives/Pickers.ts',
  ];

  it('provides one module for every reusable interactive primitive', () => {
    for (const file of primitives) expect(existsSync(join(root, file))).toBe(true);
  });

  it('keeps icon-only controls named for assistive technology', () => {
    const iconButton = source('src/ui/primitives/IconButton.ts');
    expect(iconButton).toContain("'aria-label'");
    expect(iconButton).toContain('title');
  });

  it('uses native details semantics for collapsed advanced fields', () => {
    const accordion = source('src/ui/primitives/Accordion.ts');
    expect(accordion).toContain("document.createElement('details')");
    expect(accordion).toContain("document.createElement('summary')");
    expect(accordion).toContain('ui-accordion-chevron');
  });

  it('exposes custom time/date/select pickers instead of relying on OS chrome', () => {
    const pickers = source('src/ui/primitives/Pickers.ts');
    expect(pickers).toContain('export function createTimeControl');
    expect(pickers).toContain('export function createDateControl');
    expect(pickers).toContain('export function createSelectControl');
    expect(pickers).toContain('openBottomSheet');
  });

  it('uses a modal, keyboard-dismissible bottom sheet with focus restoration', () => {
    const sheet = source('src/ui/primitives/BottomSheet.ts');
    expect(sheet).toContain("'aria-modal', 'true'");
    expect(sheet).toContain("event.key === 'Escape'");
    expect(sheet).toContain('previouslyFocused?.focus');
  });
});
