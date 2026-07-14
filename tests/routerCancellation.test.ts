import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  registerRouteTransitionCleanup,
  route,
  startRouter,
  type RouteContext,
} from '../src/router';

describe('router cancellation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the latest page when an earlier async route finishes late', async () => {
    const listeners = new Map<string, () => Promise<void>>();
    const fakeLocation = { hash: '#/test-slow-route' };
    vi.stubGlobal('location', fakeLocation);
    vi.stubGlobal('window', {
      addEventListener: (type: string, listener: () => Promise<void>) => {
        listeners.set(type, listener);
      },
      scrollTo: vi.fn(),
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    const root = {
      page: '',
      querySelector: () => null,
    } as unknown as HTMLElement & { page: string };
    let slowContext!: RouteContext;
    let releaseSlow!: () => void;
    let markSlowStarted!: () => void;
    const slowStarted = new Promise<void>((resolve) => {
      markSlowStarted = resolve;
    });
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });

    route('/test-slow-route', async (_params, routeRoot, context) => {
      slowContext = context;
      markSlowStarted();
      await slowGate;
      if (!context.signal.aborted) (routeRoot as typeof root).page = 'slow';
    });
    route('/test-fast-route', (_params, routeRoot) => {
      (routeRoot as typeof root).page = 'fast';
    });

    startRouter(root, '/test-slow-route');
    await slowStarted;
    const transitionCleanup = vi.fn();
    const unregister = registerRouteTransitionCleanup(transitionCleanup);

    fakeLocation.hash = '#/test-fast-route';
    await listeners.get('hashchange')?.();

    expect(slowContext.signal.aborted).toBe(true);
    expect(transitionCleanup).toHaveBeenCalledTimes(1);
    expect(root.page).toBe('fast');

    releaseSlow();
    await slowGate;
    await Promise.resolve();
    expect(root.page).toBe('fast');
    unregister();
  });
});
