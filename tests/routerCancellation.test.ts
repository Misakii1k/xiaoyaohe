// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listDiagnosticLogs } from '../src/app/diagnostics';
import {
  registerRouteTransitionCleanup,
  resetRouterForTesting,
  route,
  startRouter,
  type RouteContext,
} from '../src/router';

interface RouterEnvironment {
  fakeLocation: { hash: string };
  listeners: Map<string, () => Promise<void> | void>;
  root: HTMLElement & { page?: string };
}

function installRouterEnvironment(initialHash: string): RouterEnvironment {
  const listeners = new Map<string, () => Promise<void> | void>();
  const fakeLocation = { hash: initialHash };
  vi.stubGlobal('location', fakeLocation);
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: () => Promise<void> | void) => {
      listeners.set(type, listener);
    },
    removeEventListener: (type: string) => {
      listeners.delete(type);
    },
    scrollTo: vi.fn(),
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  const root = document.createElement('div') as HTMLElement & { page?: string };
  document.body.append(root);
  return { fakeLocation, listeners, root };
}

describe('router cancellation and recovery', () => {
  beforeEach(() => {
    resetRouterForTesting();
    document.body.replaceChildren();
    localStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    resetRouterForTesting();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps the latest page when an earlier async route finishes late', async () => {
    const { fakeLocation, listeners, root } = installRouterEnvironment('#/test-slow-route');
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

  it('recovers malformed encoded route parameters without an uncaught URIError', async () => {
    const { root } = installRouterEnvironment('#/test-malformed/%E0%A4%A');
    const handler = vi.fn();
    const transitionCleanup = vi.fn();
    registerRouteTransitionCleanup(transitionCleanup);
    route('/test-malformed/:id', handler);

    startRouter(root, '/today');

    await vi.waitFor(() => expect(root.textContent).toContain('暂时无法打开这个页面'));
    expect(handler).not.toHaveBeenCalled();
    expect(transitionCleanup).toHaveBeenCalledOnce();
    expect(listDiagnosticLogs()).toEqual([
      expect.objectContaining({ scope: 'route.render', code: 'uri-error' }),
    ]);
    expect(console.error).toHaveBeenCalledWith(
      '[medbox] 页面加载失败，诊断编号',
      expect.stringMatching(/^d-[a-z0-9]+-[a-z0-9]+$/),
    );
    expect(JSON.stringify(listDiagnosticLogs())).not.toContain('%E0%A4%A');
  });

  it('aborts a failed route and runs route and transition cleanup once', async () => {
    const { root } = installRouterEnvironment('#/test-route-failure');
    const abortCleanup = vi.fn();
    const transitionCleanup = vi.fn();
    let failedContext!: RouteContext;
    const rawCause = new Error('private failure for zhangsan and 阿司匹林');
    registerRouteTransitionCleanup(transitionCleanup);
    route('/test-route-failure', (_params, _root, context) => {
      failedContext = context;
      context.signal.addEventListener('abort', abortCleanup, { once: true });
      throw rawCause;
    });

    startRouter(root, '/today');

    await vi.waitFor(() => expect(root.textContent).toContain('暂时无法打开这个页面'));
    expect(failedContext.signal.aborted).toBe(true);
    expect(abortCleanup).toHaveBeenCalledOnce();
    expect(transitionCleanup).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(abortCleanup).toHaveBeenCalledOnce();
    expect(transitionCleanup).toHaveBeenCalledOnce();
    expect(JSON.stringify(listDiagnosticLogs())).not.toContain('zhangsan');
    expect(JSON.stringify(listDiagnosticLogs())).not.toContain('阿司匹林');
  });

  it('does not recycle the previous route cleanup again when the next route fails', async () => {
    const { fakeLocation, listeners, root } = installRouterEnvironment('#/test-stable-route');
    const stableCleanup = vi.fn();
    let failedContext!: RouteContext;
    route('/test-stable-route', () => stableCleanup);
    route('/test-next-failure', (_params, _root, context) => {
      failedContext = context;
      throw new Error('failed next route');
    });

    startRouter(root, '/today');
    await vi.waitFor(() => expect(root.querySelector('h1')).toBeNull());

    fakeLocation.hash = '#/test-next-failure';
    await listeners.get('hashchange')?.();
    await vi.waitFor(() => expect(root.textContent).toContain('暂时无法打开这个页面'));

    expect(failedContext.signal.aborted).toBe(true);
    expect(stableCleanup).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(stableCleanup).toHaveBeenCalledOnce();
  });
});
