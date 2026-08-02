// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearDiagnosticLogs,
  copyDiagnosticLogs,
  listDiagnosticLogs,
  reportSilentFailure,
} from '../src/app/diagnostics';

const STORAGE_KEY = 'medbox.diagnostics.v2';

function persistedText(): string {
  return localStorage.getItem(STORAGE_KEY) ?? '';
}

describe('diagnostics', () => {
  beforeEach(() => {
    localStorage.clear();
    clearDiagnosticLogs();
    vi.restoreAllMocks();
  });

  it('keeps only controlled fields for the newest fixed-capacity entries', () => {
    vi.spyOn(Date, 'now').mockImplementation(() => 1_700_000_000_000 + listDiagnosticLogs().length);

    for (let index = 0; index < 55; index += 1) {
      reportSilentFailure('reminder.replay', new Error(`failure-${index}`));
    }

    const logs = listDiagnosticLogs();
    expect(logs).toHaveLength(50);
    expect(logs[0]).toMatchObject({
      scope: 'reminder.replay',
      code: 'error',
      summary: '操作执行失败',
    });
    expect(logs.every(({ at, id }) => Number.isFinite(at) && /^d-[a-z0-9]+-[a-z0-9]+$/.test(id))).toBe(true);
    expect(persistedText()).not.toContain('failure-');
    expect(JSON.parse(persistedText())[0]).toEqual({
      at: expect.any(Number),
      id: expect.stringMatching(/^d-[a-z0-9]+-[a-z0-9]+$/),
      scope: 'reminder.replay',
      code: 'error',
    });
  });

  it('never persists raw error text, urls, hosts, IPs, users or medication names', () => {
    const rawFragments = [
      'abc.def.ghi',
      'sk-secret',
      'private.example',
      '192.168.1.23',
      'zhangsan',
      '阿司匹林',
    ];
    reportSilentFailure(
      'lan.auto-join',
      new Error(
        'Bearer abc.def.ghi apiKey=sk-secret https://zhangsan@private.example/192.168.1.23 药品阿司匹林',
      ),
    );

    const stored = persistedText();
    for (const fragment of rawFragments) expect(stored).not.toContain(fragment);
    expect(JSON.parse(stored)).toEqual([
      expect.objectContaining({ scope: 'lan.auto-join', code: 'error' }),
    ]);
  });

  it('maps unknown scopes and causes to controlled enums without stringifying values', () => {
    const cause = {
      toString: vi.fn(() => 'https://private.example/阿司匹林'),
    };

    reportSilentFailure('route.https://private.example/user', cause);

    expect(cause.toString).not.toHaveBeenCalled();
    expect(listDiagnosticLogs()[0]).toMatchObject({
      scope: 'unknown',
      code: 'rejected-value',
      summary: '异步操作失败',
    });
    expect(persistedText()).not.toContain('private.example');
    expect(persistedText()).not.toContain('阿司匹林');
  });

  it('classifies malformed URI failures with a safe code', () => {
    reportSilentFailure('route.render', new URIError('URI malformed at https://private.example'));

    expect(listDiagnosticLogs()[0]).toMatchObject({
      scope: 'route.render',
      code: 'uri-error',
      summary: '页面地址格式无效',
    });
    expect(persistedText()).not.toContain('private.example');
  });

  it('drops legacy and malformed persisted entries instead of exposing free text', () => {
    localStorage.setItem('medbox.diagnostics.v1', JSON.stringify([
      { at: 1, scope: 'photo.read', summary: '用户 zhangsan 的阿司匹林' },
    ]));
    localStorage.setItem(STORAGE_KEY, JSON.stringify([
      {
        at: 2,
        id: 'd-safe-1',
        scope: 'photo.read',
        code: 'type-error',
        summary: 'https://private.example/192.168.1.23',
      },
      {
        at: 3,
        id: 'not safe',
        scope: 'photo.read',
        code: 'error',
      },
    ]));

    expect(listDiagnosticLogs()).toEqual([
      {
        at: 2,
        id: 'd-safe-1',
        scope: 'photo.read',
        code: 'type-error',
        summary: '数据类型无效',
      },
    ]);
    expect(localStorage.getItem('medbox.diagnostics.v1')).toBeNull();
    expect(persistedText()).not.toContain('private.example');
    expect(persistedText()).not.toContain('zhangsan');
    expect(persistedText()).not.toContain('阿司匹林');
  });

  it('copies safe structured logs and clears persisted entries', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 31, 8, 9, 10));
    reportSilentFailure('photo.migration', new TypeError('decode private medicine failed'));
    const writeText = vi.fn(async (_text: string) => undefined);

    const copied = await copyDiagnosticLogs(writeText);

    expect(copied).toBe(1);
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(
      /\[photo\.migration\/type-error\] 数据类型无效 \(d-[a-z0-9]+-[a-z0-9]+\)/,
    ));
    expect(writeText.mock.calls[0]?.[0]).not.toContain('private medicine');
    clearDiagnosticLogs();
    expect(listDiagnosticLogs()).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
