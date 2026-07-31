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

  // BottomSheet 的模态语义、Escape 关闭与焦点恢复改由 tests/bottomSheetBehavior.test.ts
  // 真实开关弹层来验证。此处不再匹配源码文本：焦点陷阱已抽到 components.ts 的
  // trapFocusIn，按实现细节断言只会在每次重构时误报。
  it('delegates the bottom sheet focus trap to the shared helper', () => {
    const sheet = source('src/ui/primitives/BottomSheet.ts');
    expect(sheet).toContain('trapFocusIn');
  });
});
