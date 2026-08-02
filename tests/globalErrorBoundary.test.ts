// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listDiagnosticLogs } from '../src/app/diagnostics';

const toast = vi.hoisted(() => vi.fn());

function rejectionEvent(reason: unknown): Event {
  return Object.assign(new Event('unhandledrejection', { cancelable: true }), { reason });
}

vi.mock('../src/ui/components', () => ({ toast }));

import {
  installGlobalErrorBoundary,
  resetGlobalErrorBoundaryForTesting,
} from '../src/app/globalErrorBoundary';

describe('globalErrorBoundary', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    toast.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(Date, 'now').mockReturnValue(20_000);
    resetGlobalErrorBoundaryForTesting();
  });

  afterEach(() => {
    resetGlobalErrorBoundaryForTesting();
    vi.restoreAllMocks();
  });

  it('keeps rendered content, records safe codes and deduplicates quiet notices', async () => {
    const root = document.createElement('div');
    root.append(document.createElement('main'));
    document.body.append(root);
    installGlobalErrorBoundary(root);
    const error = new Error('private https://user@private.example/阿司匹林');
    const rejection = new Error('secret 192.168.1.23 zhangsan');

    window.dispatchEvent(new ErrorEvent('error', { cancelable: true, error }));
    window.dispatchEvent(rejectionEvent(rejection));

    expect(root.querySelector('main')).not.toBeNull();
    await vi.waitFor(() => expect(toast).toHaveBeenCalledOnce());
    expect(toast).toHaveBeenCalledWith('刚才有个操作没成功，可以再试一次');
    expect(document.body.textContent).not.toContain('private.example');
    expect(document.body.textContent).not.toContain('zhangsan');
    expect(listDiagnosticLogs().map(({ scope, code }) => ({ scope, code }))).toEqual([
      { scope: 'global.error', code: 'error' },
      { scope: 'global.rejection', code: 'error' },
    ]);
    expect(JSON.stringify(listDiagnosticLogs())).not.toContain('阿司匹林');
    expect(JSON.stringify(listDiagnosticLogs())).not.toContain('192.168.1.23');
    expect(console.error).not.toHaveBeenCalledWith(expect.anything(), error);
    expect(console.error).not.toHaveBeenCalledWith(expect.anything(), rejection);
    expect(console.error).toHaveBeenCalledWith(
      '[medbox] 未捕获错误，诊断编号',
      expect.stringMatching(/^d-[a-z0-9]+-[a-z0-9]+$/),
    );
  });

  it('renders an accessible reload fallback when an unhandled rejection leaves a blank root', () => {
    const root = document.createElement('div');
    document.body.append(root);
    installGlobalErrorBoundary(root);
    const rawCause = { patient: 'zhangsan', medicine: '阿司匹林' };

    const handled = !window.dispatchEvent(rejectionEvent(rawCause));

    expect(handled).toBe(true);
    expect(root.querySelector('[role="alert"]')?.getAttribute('aria-live')).toBe('assertive');
    expect(root.textContent).toContain('应用没能正常打开');
    expect(root.textContent).toContain('重新加载');
    expect(root.textContent).not.toContain('zhangsan');
    expect(root.textContent).not.toContain('阿司匹林');
    expect(document.activeElement?.textContent).toBe('出错了');
    expect(console.error).not.toHaveBeenCalledWith(expect.anything(), rawCause);
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
