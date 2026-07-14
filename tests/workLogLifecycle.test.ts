import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createWorkPageLifecycle } from '../src/pages/WorkLog';

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

describe('work log route lifecycle', () => {
  it('allows only the current render generation to refresh', async () => {
    let currentGeneration = 4;
    const rerender = vi.fn(async () => undefined);
    const lifecycle = createWorkPageLifecycle(
      undefined,
      4,
      () => currentGeneration,
      rerender,
    );

    await lifecycle.refresh();
    expect(rerender).toHaveBeenCalledTimes(1);

    currentGeneration = 5;
    await lifecycle.refresh();
    expect(lifecycle.isActive()).toBe(false);
    expect(rerender).toHaveBeenCalledTimes(1);
  });

  it('suppresses a delayed callback after its route signal is aborted', async () => {
    const controller = new AbortController();
    const result = deferred<string>();
    const sideEffect = vi.fn();
    const rerender = vi.fn(async () => undefined);
    const lifecycle = createWorkPageLifecycle(
      controller.signal,
      1,
      () => 1,
      rerender,
    );

    const completion = result.promise.then((value) => {
      if (lifecycle.isActive()) sideEffect(value);
    });
    controller.abort();
    result.resolve('late result');
    await completion;
    await lifecycle.refresh();

    expect(lifecycle.isActive()).toBe(false);
    expect(sideEffect).not.toHaveBeenCalled();
    expect(rerender).not.toHaveBeenCalled();
  });

  it('invalidates callbacks when the owning page cleanup runs', async () => {
    const rerender = vi.fn(async () => undefined);
    const lifecycle = createWorkPageLifecycle(undefined, 2, () => 2, rerender);

    lifecycle.dispose();
    await lifecycle.refresh();

    expect(lifecycle.isActive()).toBe(false);
    expect(rerender).not.toHaveBeenCalled();
  });

  it('does not bypass the route-owned root for page refreshes', () => {
    const root = resolve(import.meta.dirname, '..');
    const source = readFileSync(join(root, 'src', 'pages', 'WorkLog.ts'), 'utf8');

    expect(source).not.toContain("document.getElementById('app')");
    expect(source).toContain('refresh: lifecycle.refresh');
  });
});
