import { reportSilentFailure } from './app/diagnostics';
import {
  dispatchTabEvent,
  getActiveTabKey,
  getCachedTabEntry,
  getCachedTabKeys,
  getExistingSubpageContainer,
  getOrCreateSubpageContainer,
  getOrCreateTabContainer,
  getScrollContainer,
  getTabPoolSize,
  hideElement,
  isKeepAliveTab,
  normalizeRoutePath,
  onTabActivated,
  onTabDeactivated,
  resetTabPoolForTesting,
  resolveKeepAliveTabKey,
  restoreTabScrollPosition,
  saveTabScrollPosition,
  setActiveTabKey,
  showElement,
  type PrimaryTabRoute,
  type TabKeepAliveEntry,
  type TabLifecycleDetail,
  type TabLifecycleHandler,
} from './app/tabPool';

// hash 路由：每次导航都提供可取消上下文，页面可返回清理函数。
export interface RouteContext {
  signal: AbortSignal;
  path: string;
}

export type RouteCleanup = () => void;
export type RouteHandler = (
  params: Record<string, string>,
  root: HTMLElement,
  context: RouteContext,
) => void | RouteCleanup | Promise<void | RouteCleanup>;

/** Resolve a code-split route without rendering it after navigation was cancelled. */
export async function runLazyRoute<T>(
  signal: AbortSignal,
  loader: () => Promise<T>,
  render: (module: T) => void | RouteCleanup | Promise<void | RouteCleanup>,
): Promise<void | RouteCleanup> {
  const module = await loader();
  if (signal.aborted) return;
  return render(module);
}

interface Route {
  pattern: RegExp;
  keys: string[];
  handler: RouteHandler;
}

const routes: Route[] = [];
const routeTransitionCleanups = new Set<RouteCleanup>();
let rootEl: HTMLElement;
let notFound: RouteHandler | null = null;
let defaultPath = '/today';
let activeController: AbortController | null = null;
let activeCleanup: RouteCleanup | null = null;
let activeSubpageCleanup: RouteCleanup | null = null;
let navigationSeq = 0;
let hashChangeListener: (() => void) | null = null;

/** 注册路由，path 形如 "/meds/:id" */
export function route(path: string, handler: RouteHandler): void {
  const keys: string[] = [];
  const normalized = normalizeRoutePath(path);
  const pattern = new RegExp(
    '^' +
      normalized.replace(/:[^/]+/g, (m) => {
        keys.push(m.slice(1));
        return '([^/]+)';
      }) +
      '$',
  );
  routes.push({ pattern, keys, handler });
}

export function setNotFound(handler: RouteHandler): void {
  notFound = handler;
}

/** Register persistent UI cleanup that must run before every route is rendered. */
export function registerRouteTransitionCleanup(cleanup: RouteCleanup): RouteCleanup {
  routeTransitionCleanups.add(cleanup);
  return () => routeTransitionCleanups.delete(cleanup);
}

function runRouteTransitionCleanups(): void {
  for (const cleanup of routeTransitionCleanups) runCleanupSafely(cleanup);
}

export function navigate(to: string): void {
  const normalized = normalizeRoutePath(to);
  if (location.hash !== `#${normalized}`) {
    location.hash = normalized;
  } else {
    void dispatch();
  }
}

export function getActiveTab(): PrimaryTabRoute | null {
  return getActiveTabKey();
}

export function getCachedTabs(): PrimaryTabRoute[] {
  return getCachedTabKeys();
}

export {
  isKeepAliveTab,
  onTabActivated,
  onTabDeactivated,
  type PrimaryTabRoute,
  type TabKeepAliveEntry,
  type TabLifecycleDetail,
  type TabLifecycleHandler,
};

async function dispatch(): Promise<void> {
  const navigationId = ++navigationSeq;
  const rawPath = location.hash.replace(/^#/, '') || defaultPath;
  const path = normalizeRoutePath(rawPath);
  const targetTabKey = resolveKeepAliveTabKey(path);

  // 1. Destination is a primary keep-alive tab
  if (targetTabKey) {
    const previousTabKey = getActiveTabKey();

    // If subpage was active, clean it up and hide its container
    if (activeSubpageCleanup) {
      runCleanupSafely(activeSubpageCleanup);
      activeSubpageCleanup = null;
    }
    const subpageEl = getExistingSubpageContainer();
    if (subpageEl) {
      hideElement(subpageEl);
      subpageEl.replaceChildren();
    }

    // If another tab was active, save its scroll, dispatch deactivation, and hide it
    if (previousTabKey && previousTabKey !== targetTabKey) {
      const prevEntry = getCachedTabEntry(previousTabKey);
      if (prevEntry) {
        saveTabScrollPosition(prevEntry);
        hideElement(prevEntry.container);
        dispatchTabEvent('deactivated', previousTabKey, prevEntry.container, {
          tab: previousTabKey,
          path,
          nextTab: targetTabKey,
        });
      }
    }

    // If tapping the currently active tab again, smooth scroll to top
    if (previousTabKey === targetTabKey) {
      const currentEntry = getCachedTabEntry(targetTabKey);
      if (currentEntry) {
        const scrollEl = getScrollContainer(currentEntry.container);
        scrollEl.scrollTop = 0;
        if (typeof scrollEl.scrollTo === 'function') {
          try {
            scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
          } catch {
            /* ignore */
          }
        }
        currentEntry.savedScrollTop = 0;
        dispatchTabEvent('activated', targetTabKey, currentEntry.container, {
          tab: targetTabKey,
          path,
          previousTab: targetTabKey,
        });
        announceNavigation();
        return;
      }
    }

    runRouteTransitionCleanups();

    const entry = getOrCreateTabContainer(targetTabKey, rootEl);
    if (entry.rendered) {
      // TAB CACHE HIT! Instant display and scroll restoration
      setActiveTabKey(targetTabKey);
      showElement(entry.container);
      restoreTabScrollPosition(entry);
      dispatchTabEvent('activated', targetTabKey, entry.container, {
        tab: targetTabKey,
        path,
        previousTab: previousTabKey,
      });
      announceNavigation();
      return;
    }

    // First render of this tab
    setActiveTabKey(targetTabKey);
    showElement(entry.container);

    const controller = new AbortController();
    entry.controller = controller;
    activeController = controller;

    try {
      const matched = findRoute(path);
      if (!matched) {
        if (!notFound) return;
        entry.cleanup = asOnceCleanup(
          await notFound({}, entry.container, { signal: controller.signal, path }),
        );
      } else {
        const params = decodeParams(matched.route, matched.match);
        if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
        entry.cleanup = asOnceCleanup(
          await matched.route.handler(params, entry.container, { signal: controller.signal, path }),
        );
      }

      if (controller.signal.aborted || navigationId !== navigationSeq) {
        runCleanupSafely(entry.cleanup ?? null);
        entry.cleanup = null;
        return;
      }
      entry.rendered = true;
      dispatchTabEvent('activated', targetTabKey, entry.container, {
        tab: targetTabKey,
        path,
        previousTab: previousTabKey,
      });
      announceNavigation();
    } catch (cause) {
      if (controller.signal.aborted || navigationId !== navigationSeq) {
        runCleanupSafely(entry.cleanup ?? null);
        entry.cleanup = null;
        return;
      }
      controller.abort();
      if (activeController === controller) activeController = null;
      runCleanupSafely(entry.cleanup ?? null);
      entry.cleanup = null;
      renderRouteError(cause);
    }
    return;
  }

  // 2. Destination is a Subpage / non-tab route
  const previousTabKey = getActiveTabKey();
  if (previousTabKey) {
    const prevEntry = getCachedTabEntry(previousTabKey);
    if (prevEntry) {
      saveTabScrollPosition(prevEntry);
      hideElement(prevEntry.container);
      dispatchTabEvent('deactivated', previousTabKey, prevEntry.container, {
        tab: previousTabKey,
        path,
        nextTab: null,
      });
    }
    setActiveTabKey(null);
  }

  activeController?.abort();
  activeController = null;
  const previousCleanup = activeCleanup ?? activeSubpageCleanup;
  activeCleanup = null;
  activeSubpageCleanup = null;
  try {
    runCleanupSafely(previousCleanup);
  } finally {
    runRouteTransitionCleanups();
  }

  const controller = new AbortController();
  activeController = controller;
  let routeCleanup: RouteCleanup | null = null;

  let targetContainer: HTMLElement;
  const isUsingTabPool = getTabPoolSize() > 0;
  if (isUsingTabPool) {
    const subEl = getOrCreateSubpageContainer(rootEl);
    subEl.replaceChildren();
    showElement(subEl);
    targetContainer = subEl;
  } else {
    targetContainer = rootEl;
  }

  try {
    const matched = findRoute(path);
    if (!matched) {
      if (!notFound) return;
      routeCleanup = asOnceCleanup(
        await notFound({}, targetContainer, { signal: controller.signal, path }),
      );
    } else {
      const params = decodeParams(matched.route, matched.match);
      if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
      routeCleanup = asOnceCleanup(
        await matched.route.handler(params, targetContainer, { signal: controller.signal, path }),
      );
    }

    if (controller.signal.aborted || navigationId !== navigationSeq) {
      runCleanupSafely(routeCleanup);
      return;
    }

    if (isUsingTabPool) {
      activeSubpageCleanup = routeCleanup;
    } else {
      activeCleanup = routeCleanup;
    }
    routeCleanup = null;
    announceNavigation();
  } catch (cause) {
    if (controller.signal.aborted || navigationId !== navigationSeq) {
      runCleanupSafely(routeCleanup);
      return;
    }
    controller.abort();
    if (activeController === controller) activeController = null;
    if (activeCleanup === routeCleanup) activeCleanup = null;
    if (activeSubpageCleanup === routeCleanup) activeSubpageCleanup = null;
    runCleanupSafely(routeCleanup);
    renderRouteError(cause);
  }
}

function findRoute(path: string): { route: Route; match: RegExpMatchArray } | null {
  for (const candidate of routes) {
    const match = path.match(candidate.pattern);
    if (match) return { route: candidate, match };
  }
  return null;
}

function decodeParams(routeEntry: Route, match: RegExpMatchArray): Record<string, string> {
  const params: Record<string, string> = {};
  routeEntry.keys.forEach((key, index) => {
    const value = match[index + 1];
    if (value !== undefined) params[key] = decodeURIComponent(value);
  });
  return params;
}

function asOnceCleanup(value: void | RouteCleanup): RouteCleanup | null {
  if (typeof value !== 'function') return null;
  let called = false;
  return () => {
    if (called) return;
    called = true;
    value();
  };
}

function runCleanupSafely(cleanup: RouteCleanup | null): void {
  if (!cleanup) return;
  try {
    cleanup();
  } catch (cause) {
    const diagnosticId = reportSilentFailure('route.cleanup', cause);
    console.error('[medbox] 路由清理失败，诊断编号', diagnosticId);
  }
}

function announceNavigation(): void {
  if (typeof requestAnimationFrame !== 'function') return;
  requestAnimationFrame(() => {
    const headings = Array.from(rootEl.querySelectorAll<HTMLElement>('h1'));
    const heading =
      headings.find((h) => h.offsetParent !== null || h.getClientRects().length > 0) ?? headings[0];
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  });
}

function renderRouteError(cause: unknown): void {
  const diagnosticId = reportSilentFailure('route.render', cause);
  console.error('[medbox] 页面加载失败，诊断编号', diagnosticId);
  const topbar = document.createElement('div');
  topbar.className = 'topbar';
  const heading = document.createElement('h1');
  heading.textContent = '页面暂时打不开';
  topbar.append(heading);
  const page = document.createElement('main');
  page.className = 'page page-light';
  const card = document.createElement('div');
  card.className = 'card';
  card.setAttribute('role', 'alert');
  card.setAttribute('aria-live', 'assertive');
  card.setAttribute('aria-atomic', 'true');
  const title = document.createElement('div');
  title.className = 'big';
  title.textContent = '暂时无法打开这个页面';
  const detail = document.createElement('div');
  detail.className = 'muted';
  detail.style.cssText = 'margin-top:8px;word-break:break-word';
  detail.textContent = '此错误页不会修改本机用药记录。可以重试一次；如果仍然失败，可到设置里复制诊断记录。';
  const actions = document.createElement('div');
  actions.className = 'btn-row mt-3';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn';
  retry.textContent = '重试';
  retry.onclick = () => void dispatch();
  actions.append(retry);
  card.append(title, detail, actions);
  page.append(card);

  rootEl.replaceChildren(topbar, page);
  announceNavigation();
}

export function startRouter(root: HTMLElement, initialPath = '/today'): void {
  rootEl = root;
  defaultPath = normalizeRoutePath(initialPath);
  hashChangeListener ??= () => void dispatch();
  window.addEventListener('hashchange', hashChangeListener);
  if (!location.hash) location.hash = defaultPath;
  else void dispatch();
}

/** Only for isolating router lifecycle tests. */
export function resetRouterForTesting(): void {
  activeController?.abort();
  activeController = null;
  runCleanupSafely(activeCleanup);
  activeCleanup = null;
  runCleanupSafely(activeSubpageCleanup);
  activeSubpageCleanup = null;

  resetTabPoolForTesting();

  if (hashChangeListener) window.removeEventListener('hashchange', hashChangeListener);
  hashChangeListener = null;
  routes.length = 0;
  routeTransitionCleanups.clear();
  notFound = null;
  defaultPath = '/today';
  navigationSeq = 0;
}
