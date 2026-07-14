import { describe, expect, it, vi } from 'vitest';
import { runLazyRoute } from '../src/router';

describe('runLazyRoute', () => {
  it('does not render a module that resolves after its route is aborted', async () => {
    const controller = new AbortController();
    let resolveModule!: (value: { name: string }) => void;
    const loader = new Promise<{ name: string }>((resolve) => {
      resolveModule = resolve;
    });
    const render = vi.fn();

    const pending = runLazyRoute(controller.signal, () => loader, render);
    controller.abort();
    resolveModule({ name: 'stale-page' });

    await expect(pending).resolves.toBeUndefined();
    expect(render).not.toHaveBeenCalled();
  });

  it('renders an active module and returns its cleanup', async () => {
    const controller = new AbortController();
    const cleanup = vi.fn();
    const render = vi.fn(() => cleanup);

    await expect(
      runLazyRoute(controller.signal, async () => ({ name: 'active-page' }), render),
    ).resolves.toBe(cleanup);
    expect(render).toHaveBeenCalledWith({ name: 'active-page' });
  });
});
