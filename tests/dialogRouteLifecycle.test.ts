import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const router = readFileSync(join(root, 'src', 'router.ts'), 'utf8');
const components = readFileSync(join(root, 'src', 'ui', 'components.ts'), 'utf8');
const bottomSheet = readFileSync(join(root, 'src', 'ui', 'primitives', 'BottomSheet.ts'), 'utf8');

describe('dialog and route lifecycle', () => {
  it('keeps route transitions decoupled from concrete dialog implementations', () => {
    expect(router).toContain('export function registerRouteTransitionCleanup');
    expect(router).toMatch(/finally \{[\s\S]*?runRouteTransitionCleanups\(\);\s*\}/);
    expect(components).toContain('registerRouteTransitionCleanup(closeAllDialogs);');
    expect(router).not.toMatch(/from ['"].*ui\/components['"]/);
  });

  it('tracks all component dialogs and restores the app only after the last closes', () => {
    expect(components).toContain('export function closeAllDialogs(): void');
    expect(components).toContain('Array.from(activeDialogs).reverse()');
    expect(components).toMatch(
      /activeDialogs\.delete\(overlay\);[\s\S]*?overlay\.remove\(\);[\s\S]*?restoreAppAfterLastDialog\(\);/,
    );
    // 「只在最后一个弹层关闭后才恢复主体」的计数逻辑由 appInertOwners 维护，
    // 而不是 activeDialogs.size —— BottomSheet 与 VoiceMedEntry 同样共用 inert，
    // 却不登记在 activeDialogs 里。实际行为见 tests/bottomSheetBehavior.test.ts。
    expect(components).toMatch(/if \(appInertOwners > 0 \|\| !dialogAppState\) return;/);
  });

  it('closes active bottom sheets during route transitions and releases their listeners', () => {
    expect(bottomSheet).toContain("import { registerRouteTransitionCleanup } from '../../router';");
    expect(bottomSheet).toContain('export function closeAllBottomSheets(): void');
    expect(bottomSheet).toContain('registerRouteTransitionCleanup(closeAllBottomSheets);');
    // 键盘监听的摘除由 trapFocusIn 返回的清理函数负责，BottomSheet 只需在 close 里调用它。
    // 「关闭后监听器确实失效」这一点用行为验证，见 tests/bottomSheetBehavior.test.ts。
    expect(bottomSheet).toMatch(
      /removeTrap\?\.\(\);[\s\S]*?activeBottomSheets\.delete\(close\);[\s\S]*?overlay\.remove\(\);/,
    );
  });

  it('announces route errors and focuses the error heading after rendering', () => {
    const errorRenderer = router.slice(router.indexOf('function renderRouteError'));

    expect(errorRenderer).toContain("card.setAttribute('role', 'alert')");
    expect(errorRenderer).toContain("card.setAttribute('aria-live', 'assertive')");
    expect(errorRenderer).toMatch(
      /rootEl\.replaceChildren\(topbar, page\);\s*announceNavigation\(\);/,
    );
    expect(router).toMatch(/heading\.tabIndex = -1;\s*heading\.focus\(\{ preventScroll: true \}\);/);
  });
});
