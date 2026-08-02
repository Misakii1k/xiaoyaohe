import { reportSilentFailure, type DiagnosticScope } from './diagnostics';

/**
 * 全局兜底：未捕获异常与未处理的 Promise rejection。
 *
 * 反应分两档，取决于出错时页面是不是空的：
 * - 页面上还有内容 → 只弹一条轻提示，不替换用户正在看的页面。
 * - 页面已经空了（真白屏）→ 接管整屏，给出「出错了 + 重新加载」。
 *
 * 原始报错不会写入持久诊断，也不会传给 console。诊断只保留受控类别和安全 id。
 */

/** 一次故障常连着抛好几条，冷却期内只提示一次，避免刷屏。 */
const NOTICE_COOLDOWN_MS = 10_000;

let installed = false;
let lastNoticeAt = 0;
let errorListener: ((event: ErrorEvent) => void) | undefined;
let rejectionListener: ((event: PromiseRejectionEvent) => void) | undefined;

export function installGlobalErrorBoundary(root: HTMLElement): void {
  if (installed) return;
  installed = true;

  errorListener = (event) => {
    event.preventDefault();
    captureGlobalFailure(root, event.error ?? event.message, 'global.error');
  };
  rejectionListener = (event) => {
    event.preventDefault();
    captureGlobalFailure(root, event.reason, 'global.rejection');
  };
  window.addEventListener('error', errorListener);
  window.addEventListener('unhandledrejection', rejectionListener);
}

/** 仅供测试重置模块级状态。 */
export function resetGlobalErrorBoundaryForTesting(): void {
  if (errorListener) window.removeEventListener('error', errorListener);
  if (rejectionListener) window.removeEventListener('unhandledrejection', rejectionListener);
  installed = false;
  lastNoticeAt = 0;
  errorListener = undefined;
  rejectionListener = undefined;
}

export function captureGlobalFailure(
  root: HTMLElement,
  cause: unknown,
  scope: DiagnosticScope = 'global.error',
): void {
  const diagnosticId = reportSilentFailure(scope, cause);
  console.error('[medbox] 未捕获错误，诊断编号', diagnosticId);
  if (root.childElementCount > 0) {
    notifyQuietly();
    return;
  }
  renderBlankScreenFallback(root);
}

function notifyQuietly(): void {
  const now = Date.now();
  if (now - lastNoticeAt < NOTICE_COOLDOWN_MS) return;
  lastNoticeAt = now;
  void import('../ui/components')
    .then(({ toast }) => toast('刚才有个操作没成功，可以再试一次'))
    .catch(() => undefined);
}

function renderBlankScreenFallback(root: HTMLElement): void {
  const topbar = document.createElement('div');
  topbar.className = 'topbar';
  const heading = document.createElement('h1');
  heading.textContent = '出错了';
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
  title.textContent = '应用没能正常打开';
  const detail = document.createElement('div');
  detail.className = 'muted';
  detail.style.cssText = 'margin-top:8px;word-break:break-word';
  detail.textContent = '此错误页不会修改本机用药记录。重新加载一次通常就能继续使用。';

  const actions = document.createElement('div');
  actions.className = 'btn-row mt-3';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn';
  retry.textContent = '重新加载';
  retry.onclick = () => location.reload();
  actions.append(retry);

  card.append(title, detail, actions);
  page.append(card);
  root.replaceChildren(topbar, page);
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}
