// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDiagnosticLogs, reportSilentFailure } from '../src/app/diagnostics';
import { renderDiagnosticsPanel } from '../src/pages/Settings';

describe('settings diagnostics panel', () => {
  beforeEach(() => {
    localStorage.clear();
    clearDiagnosticLogs();
    document.body.replaceChildren();
  });

  it('shows redacted records and refreshes the count after clearing', () => {
    reportSilentFailure('photo.read', new Error('private detail'));
    const notify = vi.fn();
    const confirm = vi.fn(async () => true);
    const panel = renderDiagnosticsPanel({ notify, confirm });
    document.body.append(panel);

    expect(panel.textContent).toContain('诊断记录');
    expect(panel.textContent).toContain('photo.read');
    expect(panel.textContent).toContain('操作执行失败');
    expect(panel.textContent).not.toContain('private detail');
    expect(panel.textContent).toContain('1 条');

    const clear = [...panel.querySelectorAll('button')].find((button) => button.textContent === '清空');
    clear?.click();

    return vi.waitFor(() => {
      expect(confirm).toHaveBeenCalledOnce();
      expect(panel.textContent).toContain('暂无诊断记录');
      expect(panel.textContent).toContain('0 条');
      expect(notify).toHaveBeenCalledWith('诊断记录已清空');
    });
  });

  it('copies records and reports clipboard failure', async () => {
    reportSilentFailure('lan.auto-join', new Error('connect failed'));
    const notify = vi.fn();
    const copy = vi.fn()
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('denied'));
    const panel = renderDiagnosticsPanel({ notify, confirm: async () => true, copy });
    document.body.append(panel);
    const copyButton = [...panel.querySelectorAll('button')].find((button) => button.textContent === '复制');

    copyButton?.click();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith('已复制 1 条诊断记录'));
    copyButton?.click();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith('复制失败，请检查剪贴板权限'));
  });
});
