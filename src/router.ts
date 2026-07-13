// 极简 hash 路由
export type RouteHandler = (params: Record<string, string>, root: HTMLElement) => void | Promise<void>;

interface Route {
  pattern: RegExp;
  keys: string[];
  handler: RouteHandler;
}

const routes: Route[] = [];
let rootEl: HTMLElement;
let notFound: RouteHandler | null = null;
let defaultPath = '/today';

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

export function navigate(to: string): void {
  if (location.hash !== `#${to}`) location.hash = to;
  else dispatch();
}

async function dispatch(): Promise<void> {
  const path = location.hash.replace(/^#/, '') || defaultPath;
  for (const r of routes) {
    const m = path.match(r.pattern);
    if (m) {
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      window.scrollTo(0, 0);
      try {
        await r.handler(params, rootEl);
      } catch (e) {
        renderRouteError(e);
      }
      return;
    }
  }
  if (notFound) await notFound({}, rootEl);
}

function renderRouteError(e: unknown): void {
  const message = e instanceof Error ? e.message : String(e);
  rootEl.innerHTML = `
    <div class="topbar"><h1>页面出错</h1></div>
    <div class="page page-light">
      <div class="card">
        <div class="big">页面加载失败</div>
        <div class="muted" style="margin-top:8px;word-break:break-word">${escapeHtml(message)}</div>
      </div>
    </div>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function startRouter(root: HTMLElement, initialPath = '/today'): void {
  rootEl = root;
  defaultPath = initialPath;
  window.addEventListener('hashchange', dispatch);
  if (!location.hash) location.hash = defaultPath;
  else dispatch();
}
