import { reportSilentFailure } from './app/diagnostics';

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
let navigationSeq = 0;

/** 注册路由，path 形如 "/meds/:id" */
export function route(path: string, handler: RouteHandler): void {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' +
      path.replace(/:[^/]+/g, (m) => {
        keys.push(m.slice(1));
        return '([^/]+)';
      }) +
      '$'
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
  for (const cleanup of routeTransitionCleanups) {
    try {
      cleanup();
    } catch (error) {
      console.error('Route transition cleanup failed', error);
    }
  }
}

export function navigate(to: string): void {
  if (location.hash !== `#${to}`) location.hash = to;
  else dispatch();
}

async function dispatch(): Promise<void> {
  const path = location.hash.replace(/^#/, '') || defaultPath;
  const navigationId = ++navigationSeq;
  activeController?.abort();
  const cleanup = activeCleanup;
  activeCleanup = null;
  try {
    cleanup?.();
  } finally {
    runRouteTransitionCleanups();
  }
  const controller = new AbortController();
  activeController = controller;
  for (const r of routes) {
    const m = path.match(r.pattern);
    if (m) {
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => {
        const value = m[i + 1];
        if (value !== undefined) params[k] = decodeURIComponent(value);
      });
      window.scrollTo(0, 0);
      try {
        const cleanup = await r.handler(params, rootEl, { signal: controller.signal, path });
        if (controller.signal.aborted || navigationId !== navigationSeq) {
          if (typeof cleanup === 'function') cleanup();
          return;
        }
        activeCleanup = typeof cleanup === 'function' ? cleanup : null;
        announceNavigation();
      } catch (e) {
        if (controller.signal.aborted || navigationId !== navigationSeq) return;
        renderRouteError(e, path);
      }
      return;
    }
  }
  if (notFound) await notFound({}, rootEl, { signal: controller.signal, path });
}

function announceNavigation(): void {
  requestAnimationFrame(() => {
    const heading = rootEl.querySelector<HTMLElement>('h1');
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  });
}

function renderRouteError(e: unknown, path: string): void {
  runRouteTransitionCleanups();
  activeController = null;
  reportSilentFailure(`route.${diagnosticPath(path)}`, e);
  console.error('[medbox] route render failed', { path, cause: e });
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
  detail.textContent = '你的用药记录没有丢失。可以重试一次；如果仍然失败，可到设置里复制诊断记录。';
  const actions = document.createElement('div');
  actions.className = 'btn-row mt-3';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn';
  retry.textContent = '重试';
  retry.onclick = () => dispatch();
  actions.append(retry);
  card.append(title, detail, actions);
  page.append(card);
  rootEl.replaceChildren(topbar, page);
  announceNavigation();
}

function diagnosticPath(path: string): string {
  const [pathname = path] = path.split('?');
  const normalized = pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => (/^[a-z-]+$/i.test(segment) ? segment : ':value'))
    .join('.');
  return normalized || 'root';
}

export function startRouter(root: HTMLElement, initialPath = '/today'): void {
  rootEl = root;
  defaultPath = initialPath;
  window.addEventListener('hashchange', dispatch);
  if (!location.hash) location.hash = defaultPath;
  else dispatch();
}
