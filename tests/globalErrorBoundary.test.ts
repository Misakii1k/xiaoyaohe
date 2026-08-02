// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => vi.fn());

function rejectionEvent(reason: unknown): Event {
  return Object.assign(new Event('unhandledrejection'), { reason });
}

vi.mock('../src/ui/components', () => ({ toast }));

import {
  installGlobalErrorBoundary,
  resetGlobalErrorBoundaryForTesting,
} from '../src/app/globalErrorBoundary';

describe('globalErrorBoundary', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    toast.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(Date, 'now').mockReturnValue(20_000);
    resetGlobalErrorBoundaryForTesting();
  });

  afterEach(() => {
    resetGlobalErrorBoundaryForTesting();
    vi.restoreAllMocks();
  });

  it('keeps rendered content and deduplicates quiet notices for runtime failures', () => {
    const root = document.createElement('div');
    root.append(document.createElement('main'));
    document.body.append(root);
    installGlobalErrorBoundary(root);

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('private detail') }));
    window.dispatchEvent(rejectionEvent(new Error('secret detail')));

    expect(root.querySelector('main')).not.toBeNull();
    expect(toast).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith('刚才有个操作没成功，可以再试一次');
    expect(document.body.textContent).not.toContain('private detail');
    expect(document.body.textContent).not.toContain('secret detail');
  });

  it('renders an accessible reload fallback when an unhandled rejection leaves a blank root', () => {
    const root = document.createElement('div');
    document.body.append(root);
    installGlobalErrorBoundary(root);

    window.dispatchEvent(rejectionEvent('internal failure'));

    expect(root.querySelector('[role="alert"]')?.getAttribute('aria-live')).toBe('assertive');
    expect(root.textContent).toContain('应用没能正常打开');
    expect(root.textContent).toContain('重新加载');
    expect(root.textContent).not.toContain('internal failure');
    expect(document.activeElement?.textContent).toBe('出错了');
  });

  it('removes old listeners when test state is reset and installed for another root', () => {
    const oldRoot = document.createElement('div');
    const nextRoot = document.createElement('div');
    document.body.append(oldRoot, nextRoot);
    installGlobalErrorBoundary(oldRoot);
    resetGlobalErrorBoundaryForTesting();
    installGlobalErrorBoundary(nextRoot);

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('boom') }));

    expect(oldRoot.childElementCount).toBe(0);
    expect(nextRoot.textContent).toContain('应用没能正常打开');
  });
});
