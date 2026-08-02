// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearDiagnosticLogs,
  copyDiagnosticLogs,
  listDiagnosticLogs,
  reportSilentFailure,
} from '../src/app/diagnostics';

describe('diagnostics', () => {
  beforeEach(() => {
    localStorage.clear();
    clearDiagnosticLogs();
    vi.restoreAllMocks();
  });

  it('keeps only the newest fixed-capacity entries with time and scope', () => {
    vi.spyOn(Date, 'now').mockImplementation(() => 1_700_000_000_000 + listDiagnosticLogs().length);

    for (let index = 0; index < 55; index += 1) {
      reportSilentFailure('reminder.replay', new Error(`failure-${index}`));
    }

    const logs = listDiagnosticLogs();
    expect(logs).toHaveLength(50);
    expect(logs[0]).toMatchObject({ scope: 'reminder.replay', summary: 'Error: failure-5' });
    expect(logs[49]).toMatchObject({ scope: 'reminder.replay', summary: 'Error: failure-54' });
    expect(logs.every(({ at }) => Number.isFinite(at))).toBe(true);
  });

  it('redacts credentials, tokens, urls and quoted private content', () => {
    reportSilentFailure(
      'lan.auto-join',
      new Error('Bearer abc.def.ghi apiKey=sk-secret https://user:pass@example.com/path?token=private 药品「阿司匹林」'),
    );

    const text = JSON.stringify(listDiagnosticLogs());
    expect(text).not.toContain('abc.def.ghi');
    expect(text).not.toContain('sk-secret');
    expect(text).not.toContain('user:pass');
    expect(text).not.toContain('token=private');
    expect(text).not.toContain('阿司匹林');
    expect(text).toContain('[已脱敏]');
  });

  it('copies readable logs and clears persisted entries', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 31, 8, 9, 10));
    reportSilentFailure('photo.migration', new TypeError('decode failed'));
    const writeText = vi.fn(async (_text: string) => undefined);

    const copied = await copyDiagnosticLogs(writeText);

    expect(copied).toBe(1);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('[photo.migration] TypeError: decode failed'));
    clearDiagnosticLogs();
    expect(listDiagnosticLogs()).toEqual([]);
    expect(localStorage.getItem('medbox.diagnostics.v1')).toBeNull();
  });
});
