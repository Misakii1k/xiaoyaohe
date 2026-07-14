import { describe, expect, it, vi } from 'vitest';
import { commitBatchRuleUpdatesForRoute } from '../src/pages/MedList';
import {
  importBackupFileForRoute,
  type BackupImportRouteOperations,
} from '../src/pages/Settings';
import type { BackupPreviewResult } from '../src/tools/registry';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function nextMicrotask(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('medication batch route lifecycle', () => {
  it('finishes persistence and reminder scheduling without completing a stale route', async () => {
    const controller = new AbortController();
    const database = deferred<void>();
    const reminders = deferred<void>();
    const updateRules = vi.fn(() => database.promise);
    const reschedule = vi.fn(() => reminders.promise);
    const complete = vi.fn();

    const operation = commitBatchRuleUpdatesForRoute(
      [{ id: 'rule-1', enabled: false }],
      controller.signal,
      complete,
      { updateRules, reschedule },
    );

    database.resolve();
    await nextMicrotask();
    expect(reschedule).toHaveBeenCalledOnce();

    controller.abort();
    reminders.resolve();
    await operation;

    expect(updateRules).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
  });

  it('runs the active-route completion only after both persistent stages finish', async () => {
    const complete = vi.fn();
    const order: string[] = [];

    await commitBatchRuleUpdatesForRoute(
      [{ id: 'rule-1', enabled: true }],
      new AbortController().signal,
      () => {
        order.push('complete');
        complete();
      },
      {
        updateRules: async () => {
          order.push('database');
        },
        reschedule: async () => {
          order.push('reminders');
        },
      },
    );

    expect(order).toEqual(['database', 'reminders', 'complete']);
    expect(complete).toHaveBeenCalledOnce();
  });
});

const preview: BackupPreviewResult = {
  providers: [
    { key: 'meds', label: '吃药工具', added: 1, updated: 0, skipped: 0 },
  ],
  warnings: [],
};

function backupOperations(overrides: Partial<BackupImportRouteOperations> = {}) {
  const notify = vi.fn();
  const rerender = vi.fn(async () => undefined);
  const confirm = vi.fn(async () => true);
  const providerImport = vi.fn(async () => ({ added: 1, updated: 0, skipped: 0 }));
  const operations: BackupImportRouteOperations = {
    validateFile: vi.fn(),
    readText: vi.fn(async () => '{"app":"medbox"}'),
    parse: vi.fn(() => ({ app: 'medbox' })),
    preview: vi.fn(async () => preview),
    confirm,
    providers: [{ label: '吃药工具', import: providerImport }],
    notify,
    rerender,
    ...overrides,
  };
  return { operations, notify, rerender, confirm, providerImport };
}

const fakeRoot = {} as HTMLElement;
const fakeFile = { size: 20 } as File;

describe('backup import route lifecycle', () => {
  it('stops after an aborted file read without previewing or opening a dialog', async () => {
    const controller = new AbortController();
    const fileText = deferred<string>();
    const state = backupOperations({ readText: vi.fn(() => fileText.promise) });

    const operation = importBackupFileForRoute(
      fakeRoot,
      fakeFile,
      controller.signal,
      state.operations,
    );
    controller.abort();
    fileText.resolve('{"app":"medbox"}');
    await operation;

    expect(state.operations.preview).not.toHaveBeenCalled();
    expect(state.confirm).not.toHaveBeenCalled();
    expect(state.notify).not.toHaveBeenCalled();
    expect(state.rerender).not.toHaveBeenCalled();
  });

  it('does not open the confirmation dialog when preview resolves after navigation', async () => {
    const controller = new AbortController();
    const previewResult = deferred<BackupPreviewResult>();
    const state = backupOperations({ preview: vi.fn(() => previewResult.promise) });

    const operation = importBackupFileForRoute(
      fakeRoot,
      fakeFile,
      controller.signal,
      state.operations,
    );
    await nextMicrotask();
    expect(state.operations.preview).toHaveBeenCalledOnce();

    controller.abort();
    previewResult.resolve(preview);
    await operation;

    expect(state.confirm).not.toHaveBeenCalled();
    expect(state.providerImport).not.toHaveBeenCalled();
    expect(state.notify).not.toHaveBeenCalled();
  });

  it('ignores a confirmation result delivered after the route is aborted', async () => {
    const controller = new AbortController();
    const confirmation = deferred<boolean>();
    const state = backupOperations({ confirm: vi.fn(() => confirmation.promise) });

    const operation = importBackupFileForRoute(
      fakeRoot,
      fakeFile,
      controller.signal,
      state.operations,
    );
    await nextMicrotask();
    expect(state.operations.confirm).toHaveBeenCalledOnce();

    controller.abort();
    confirmation.resolve(true);
    await operation;

    expect(state.providerImport).not.toHaveBeenCalled();
    expect(state.notify).not.toHaveBeenCalled();
    expect(state.rerender).not.toHaveBeenCalled();
  });

  it('finishes an accepted import but suppresses toast and render after navigation', async () => {
    const controller = new AbortController();
    const imported = deferred<{ added: number; updated: number; skipped: number }>();
    const state = backupOperations({
      providers: [{ label: '吃药工具', import: vi.fn(() => imported.promise) }],
    });

    const operation = importBackupFileForRoute(
      fakeRoot,
      fakeFile,
      controller.signal,
      state.operations,
    );
    await nextMicrotask();
    expect(state.operations.providers[0].import).toHaveBeenCalledOnce();

    controller.abort();
    imported.resolve({ added: 1, updated: 0, skipped: 0 });
    await operation;

    expect(state.notify).not.toHaveBeenCalled();
    expect(state.rerender).not.toHaveBeenCalled();
  });

  it('passes the same active route signal into the settings self-render', async () => {
    const controller = new AbortController();
    const state = backupOperations();

    await importBackupFileForRoute(
      fakeRoot,
      fakeFile,
      controller.signal,
      state.operations,
    );

    expect(state.notify).toHaveBeenCalledWith('吃药工具 新增 1，更新 0，跳过 0', 4200);
    expect(state.rerender).toHaveBeenCalledOnce();
    expect(state.rerender).toHaveBeenCalledWith(controller.signal);
  });
});
