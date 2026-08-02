// 通用 UI 组件 / 工具函数（M3，无框架，纯 DOM）
import { SLOT_LABEL, type Slot } from '../db/schema';
import { registerRouteTransitionCleanup } from '../router';
import { renderAppShell } from '../app/AppShell';
import { primaryNavigation } from '../app/navigation';
import { Icon as renderIcon } from './icons/Icon';
import type { AppIconName } from './icons/iconRegistry';

// One-time CSS injection for spinner & skeleton animations
if (typeof document !== 'undefined' && !document.getElementById('medbox-spinner-styles')) {
  const style = document.createElement('style');
  style.id = 'medbox-spinner-styles';
  style.textContent = `
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes skel { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) {
      .spinner, [class*='skeleton'] { animation-duration: 0.01ms !important; }
    }
  `;
  document.head.append(style);
}

type ElementProps<K extends keyof HTMLElementTagNameMap> =
  Omit<Partial<HTMLElementTagNameMap[K]>, 'style'> & {
    class?: string;
    text?: string;
    style?: string | Partial<CSSStyleDeclaration>;
    /** @deprecated Legacy alias for text. Markup is intentionally not parsed. */
    html?: string;
  } & Partial<Record<`aria-${string}` | `data-${string}`, string>>;

/** 创建元素的简易工厂 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: ElementProps<K>,
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: cls, text, html, ...rest } = props ?? {};
  if (cls) node.className = cls;
  const content = text ?? html;
  if (content !== undefined) node.textContent = String(content);
  for (const [k, v] of Object.entries(rest)) {
    if (v == null) continue;
    if (k.startsWith('aria-') || k.startsWith('data-')) {
      node.setAttribute(k, String(v));
    } else {
      (node as any)[k] = v;
    }
  }
  for (const c of children) node.append(c as any);
  return node;
}

/** Functional icon names come from the local, version-locked Lucide registry. */
export type IconName = AppIconName;

/** 返回一个 SVG 元素 */
export function icon(name: IconName, className?: string): SVGSVGElement {
  return renderIcon(name, className);
}

/** 时段语义图标映射 */
export const SLOT_ICON: Record<Slot, IconName> = {
  morning: 'sun',
  noon: 'sun-high',
  evening: 'sunset',
  bedtime: 'moon',
};

/** ---------- Top App Bar ---------- */
export function topbar(title: string, right?: HTMLElement, left?: HTMLElement): HTMLElement {
  const bar = el('div', { class: 'topbar' });
  if (left) bar.append(left);
  bar.append(el('h1', { html: title }));
  if (right) bar.append(right);
  return bar;
}

/** 顶栏「图标 + 文字」胶囊按钮：比纯图标更易懂用途。多个并列时放进 `.topbar-actions` 容器。 */
export function topbarPill(options: {
  icon: IconName;
  label: string;
  variant?: 'primary';
  onClick?: () => void;
}): HTMLButtonElement {
  const btn = el('button', {
    class: `topbar-pill${options.variant === 'primary' ? ' topbar-pill-primary' : ''}`,
    type: 'button',
  });
  btn.append(icon(options.icon), el('span', { text: options.label }));
  if (options.onClick) btn.onclick = options.onClick;
  return btn;
}

/** ---------- Snackbar ---------- */
const toastTimers = new Map<HTMLElement, number[]>();
export function toast(msg: string, ms = 2200): void {
  for (const timers of toastTimers.values()) {
    for (const timer of timers) clearTimeout(timer);
  }
  toastTimers.clear();
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = el('div', { class: 'toast', text: msg });
  t.setAttribute('role', 'status');
  t.setAttribute('aria-live', 'polite');
  t.setAttribute('aria-atomic', 'true');
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  const showTimer = window.setTimeout(() => {
    t.classList.remove('show');
    t.classList.add('hide');
    const hideTimer = window.setTimeout(() => {
      toastTimers.delete(t);
      t.remove();
    }, 260);
    const current = toastTimers.get(t) ?? [];
    toastTimers.set(t, [...current, hideTimer]);
  }, ms);
  toastTimers.set(t, [showTimer]);
}

/** ---------- Modal Dialog (a11y: focus trap + Escape + focus restore) ---------- */

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * 在容器内建立焦点陷阱：Tab 首尾循环 + Escape 触发 onEscape。
 * 返回清理函数；容器内没有可聚焦元素时 Tab 不拦截（与 openDialog 行为一致）。
 */
export function trapFocusIn(container: HTMLElement, onEscape?: () => void): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onEscape?.();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && first && last && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && first && last && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}

export interface OpenDialogOptions {
  /** id of the element that labels the dialog (sets aria-labelledby) */
  labelId?: string;
  /** Called when the user dismisses (Escape / overlay click). Receives the overlay node. */
  onClose?: () => void;
  /** Element to return focus to on close. Defaults to document.activeElement at open time. */
  returnFocusTo?: HTMLElement;
  /** Optional explicit element to focus first inside the dialog. */
  initialFocus?: HTMLElement;
}

const dialogClosers = new WeakMap<HTMLElement, () => void>();
const activeDialogs = new Set<HTMLElement>();
let openDialogSeq = 0;

interface DialogAppState {
  root: HTMLElement & { inert: boolean };
  inert: boolean;
  ariaHidden: string | null;
}

let dialogAppState: DialogAppState | null = null;
/** 同时打开的弹层数量（openDialog / BottomSheet / VoiceMedEntry 共用） */
let appInertOwners = 0;

/** 让 #app 进入 inert：有弹层打开时页面其余部分不可交互。可嵌套调用。 */
export function makeAppInert(): void {
  appInertOwners += 1;
  if (appInertOwners > 1) return;
  const root = document.getElementById('app') as (HTMLElement & { inert: boolean }) | null;
  if (!root) return;
  dialogAppState = {
    root,
    inert: root.inert ?? false,
    ariaHidden: root.getAttribute('aria-hidden'),
  };
  root.inert = true;
  root.setAttribute('aria-hidden', 'true');
}

/** 弹层关闭后调用；最后一个弹层关闭时恢复 #app 的 inert/aria-hidden。 */
export function restoreAppAfterLastDialog(): void {
  if (appInertOwners > 0) appInertOwners -= 1;
  if (appInertOwners > 0 || !dialogAppState) return;
  const { root, inert, ariaHidden } = dialogAppState;
  dialogAppState = null;
  root.inert = inert;
  if (ariaHidden == null) root.removeAttribute('aria-hidden');
  else root.setAttribute('aria-hidden', ariaHidden);
}

/** Close through the dialog lifecycle so focus and listeners are restored. */
export function closeDialog(overlay: HTMLElement): void {
  dialogClosers.get(overlay)?.();
}

/** Close every component-owned dialog, for example before a route replaces its page. */
export function closeAllDialogs(): void {
  for (const overlay of Array.from(activeDialogs).reverse()) {
    try {
      closeDialog(overlay);
    } catch (error) {
      console.error('Dialog cleanup failed', error);
    }
  }
}

registerRouteTransitionCleanup(closeAllDialogs);

export function openDialog(
  card: HTMLElement,
  opts: OpenDialogOptions = {}
): HTMLElement {
  const overlay = el('div', { class: 'overlay' }, [card]);
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  if (opts.labelId) {
    overlay.setAttribute('aria-labelledby', opts.labelId);
  } else {
    const heading = card.querySelector<HTMLElement>('h1,h2,h3,[data-dialog-title],.big');
    if (heading) {
      heading.id ||= `open-dialog-title-${++openDialogSeq}`;
      overlay.setAttribute('aria-labelledby', heading.id);
    } else {
      overlay.setAttribute('aria-label', '对话框');
    }
  }

  // Make overlay scrollable & top-anchored so virtual keyboard doesn't hide inputs
  overlay.style.alignItems = 'flex-start';
  overlay.style.overflow = 'auto';
  overlay.style.paddingTop = 'max(28px, var(--safe-top))';
  overlay.style.paddingBottom = 'max(28px, var(--safe-bottom))';

  const previouslyFocused = opts.returnFocusTo ?? (document.activeElement as HTMLElement | null);
  activeDialogs.add(overlay);
  makeAppInert();

  const focusFirst = () => {
    const f = overlay.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    const target = opts.initialFocus ?? f[0];
    target?.focus();
  };

  let closed = false;
  let removeTrap: (() => void) | null = null;
  const close = () => {
    if (closed) return;
    closed = true;
    dialogClosers.delete(overlay);
    activeDialogs.delete(overlay);
    removeTrap?.();
    overlay.remove();
    restoreAppAfterLastDialog();
    opts.onClose?.();
    previouslyFocused?.focus();
  };
  dialogClosers.set(overlay, close);
  removeTrap = trapFocusIn(overlay, close);
  // Click on overlay (not on card) closes
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  document.body.append(overlay);
  // Defer focus to next frame so the overlay is painted first
  requestAnimationFrame(focusFirst);

  // Return the overlay so callers can imperatively close it if needed
  return overlay;
}

/** ---------- Dialog ---------- */
let dialogSeq = 0;

interface DialogSharedOptions {
  okText: string;
  danger: boolean;
  /** true = 确认对话框（确定/取消），false = 单按钮告知对话框 */
  cancellable: boolean;
}

function showDialog(message: string, options: DialogSharedOptions): Promise<boolean | undefined> {
  const titleId = `dialog-title-${++dialogSeq}`;
  const ok = el('button', { class: `btn ${options.danger ? 'danger' : ''}`, html: options.okText });
  const title = el('div', { class: 'big', html: message, id: titleId, style: 'margin-bottom:24px' } as any);
  title.style.whiteSpace = 'pre-line';
  const buttons: HTMLElement[] = [];
  let cancel: HTMLElement | null = null;
  if (options.cancellable) {
    cancel = el('button', { class: 'btn text', html: '取消' });
    buttons.push(cancel);
  }
  buttons.push(ok);
  const actions = el(
    'div',
    { style: 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap' } as any,
    buttons,
  );
  const box = el('div', { class: 'card' }, [title, actions]);
  let overlay: HTMLElement | null = null;
  return new Promise<boolean | undefined>((resolve) => {
    let settled = false;
    const close = (value: boolean | undefined, dismissedByDialog = false) => {
      if (settled) return;
      settled = true;
      if (overlay && !dismissedByDialog) closeDialog(overlay);
      resolve(value);
    };
    ok.onclick = () => close(options.cancellable ? true : undefined);
    if (cancel) cancel.onclick = () => close(false);
    overlay = openDialog(box, {
      labelId: titleId,
      onClose: () => close(options.cancellable ? false : undefined, true),
      initialFocus: options.cancellable && options.danger ? cancel ?? ok : ok,
    });
    overlay.classList.add('confirm-dialog-overlay');
    overlay.addEventListener('contextmenu', (event) => event.preventDefault(), { capture: true });
  });
}

export function confirmDialog(message: string, okText = '确定', danger = false): Promise<boolean> {
  return showDialog(message, { okText, danger, cancellable: true }) as Promise<boolean>;
}

/** 单按钮信息弹窗，仅用于告知，不询问。点击按钮 / ESC / 遮罩关闭即 resolve。 */
export function infoDialog(message: string, okText = '知道了'): Promise<void> {
  return showDialog(message, { okText, danger: false, cancellable: false }).then(() => undefined);
}

/** ---------- slot 标签（M3 assist chip 色版） ---------- */
export function slotTag(slot: Slot): HTMLElement {
  return el('span', { class: `slot-tag slot-${slot}`, html: SLOT_LABEL[slot] });
}

/** ---------- 时段卡片头：图标 + 时段名 + 右槽 ---------- */
export function slotHeader(slot: Slot, extra?: string, right?: HTMLElement): HTMLElement {
  const wrap = el(
    'div',
    { style: 'display:flex;align-items:center;gap:12px;margin-bottom:12px' } as any
  );
  wrap.append(slotTag(slot));
  if (extra) wrap.append(el('span', { class: 'muted', html: extra }));
  if (right) {
    wrap.append(el('span', { style: 'flex:1' } as any));
    wrap.append(right);
  }
  return wrap;
}

/** ---------- 空状态 ---------- */
export function emptyState(
  iconName: IconName,
  title: string,
  sub?: string,
  cta?: HTMLElement | HTMLElement[]
): HTMLElement {
  const wrap = el('div', { class: 'empty' });
  const circle = el('div', { class: 'ic-circle' });
  circle.append(icon(iconName));
  wrap.append(circle);
  wrap.append(el('div', { class: 'title', html: title }));
  if (sub) wrap.append(el('div', { class: 'sub', html: sub }));
  if (cta) {
    const actions = Array.isArray(cta)
      ? el('div', { class: 'empty-actions' }, cta)
      : cta;
    wrap.append(actions);
  }
  return wrap;
}

/** ---------- 进度环（大百分比仪表盘） ---------- */
export function progressRing(value: number, total: number): HTMLElement {
  const safeTotal = Math.max(0, total);
  const safeValue = Math.max(0, Math.min(value, safeTotal || value));
  const ratio = safeTotal > 0 ? Math.min(1, safeValue / safeTotal) : 0;
  const percent = Math.round(ratio * 100);
  const wrap = el('div', {
    class:
      'progress-ring'
      + (safeTotal === 0 ? ' is-empty' : ratio >= 1 ? ' is-done' : ratio > 0 ? ' is-active' : ' is-pending'),
  });
  wrap.setAttribute('role', 'progressbar');
  wrap.setAttribute('aria-valuemin', '0');
  wrap.setAttribute('aria-valuemax', String(safeTotal));
  wrap.setAttribute('aria-valuenow', String(safeValue));
  wrap.setAttribute('aria-label', `已完成 ${safeValue} 项，共 ${safeTotal} 项`);
  wrap.style.setProperty('--ring-progress', String(ratio));

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', '0 0 100 100');

  const defs = document.createElementNS(ns, 'defs');
  const gradientId = `ring_grad_${Math.random().toString(36).substring(2, 8)}`;
  const linearGrad = document.createElementNS(ns, 'linearGradient');
  linearGrad.setAttribute('id', gradientId);
  linearGrad.setAttribute('x1', '0%');
  linearGrad.setAttribute('y1', '0%');
  linearGrad.setAttribute('x2', '100%');
  linearGrad.setAttribute('y2', '100%');

  const stop1 = document.createElementNS(ns, 'stop');
  stop1.setAttribute('offset', '0%');
  stop1.setAttribute('stop-color', '#818cf8');
  const stop2 = document.createElementNS(ns, 'stop');
  stop2.setAttribute('offset', '50%');
  stop2.setAttribute('stop-color', '#c084fc');
  const stop3 = document.createElementNS(ns, 'stop');
  stop3.setAttribute('offset', '100%');
  stop3.setAttribute('stop-color', '#38bdf8');
  linearGrad.append(stop1, stop2, stop3);
  defs.append(linearGrad);
  svg.append(defs);

  const track = document.createElementNS(ns, 'circle');
  track.setAttribute('class', 'ring-bg');
  track.setAttribute('cx', '50');
  track.setAttribute('cy', '50');
  track.setAttribute('r', '40');
  track.setAttribute('pathLength', '100');
  svg.append(track);

  const fg = document.createElementNS(ns, 'circle');
  fg.setAttribute('class', 'ring-fg');
  fg.setAttribute('cx', '50');
  fg.setAttribute('cy', '50');
  fg.setAttribute('r', '40');
  fg.setAttribute('pathLength', '100');
  fg.setAttribute('stroke', `url(#${gradientId})`);
  fg.setAttribute('stroke-linecap', 'round');
  fg.setAttribute('stroke-dasharray', `${percent} 100`);
  fg.setAttribute('stroke-dashoffset', '0');
  svg.append(fg);

  const label = el('div', { class: 'ring-label' });
  label.setAttribute('aria-hidden', 'true');
  if (safeTotal === 0) {
    label.append(
      el('span', { class: 'ring-value', text: '—' }),
      el('span', { class: 'ring-caption', text: '无安排' }),
    );
  } else {
    label.append(
      el('span', { class: 'ring-value', text: `${percent}%` }),
      el('span', {
        class: 'ring-caption',
        text: ratio >= 1 ? '已完成' : `已服 ${safeValue}/${safeTotal}`,
      }),
    );
  }

  wrap.append(svg, label);
  return wrap;
}

/** ---------- 数量徽章 ---------- */
export function badge(text: string | number): HTMLElement {
  return el('span', { class: 'badge', html: String(text) });
}

/** ---------- Banner ---------- */
export function banner(
  kind: 'info' | 'warn' | 'ok',
  text: string,
  withIcon = true
): HTMLElement {
  const b = el('div', { class: `banner ${kind}` });
  if (withIcon) {
    const iconName: IconName = kind === 'ok' ? 'check' : kind === 'warn' ? 'warn' : 'info';
    b.append(icon(iconName));
  }
  b.append(el('span', { html: text }));
  return b;
}

/** ---------- Bottom Navigation Bar ---------- */
export function tabbar(active: string): HTMLElement {
  const bar = el('nav', { class: 'tabbar' });
  bar.setAttribute('aria-label', '主导航');
  for (const item of primaryNavigation) {
    const isActive = active === item.id;
    const a = el('a', {
      href: `#${item.href}`,
      class: isActive ? 'active' : '',
    });
    if (isActive) a.setAttribute('aria-current', 'page');
    const ic = el('span', { class: 'ic' });
    ic.append(icon(item.icon));
    a.append(ic);
    a.append(el('span', { html: item.label }));
    bar.append(a);
  }
  return bar;
}

/** ---------- FAB ---------- */
export function fab(iconName: IconName, label?: string, onClick?: () => void): HTMLElement {
  const b = el('button', {
    class: label ? 'fab extended' : 'fab',
    'aria-label': label || iconName,
  } as any);
  b.append(icon(iconName));
  if (label) b.append(el('span', { html: label }));
  if (onClick) b.onclick = onClick;
  return b;
}

/** ---------- 渲染整页 ---------- */
export function renderPage(opts: {
  root: HTMLElement;
  title: string;
  activeTab: string;
  topRight?: HTMLElement;
  topLeft?: HTMLElement;
  content: HTMLElement;
  fab?: HTMLElement;
  actionDock?: HTMLElement;
  showTabbar?: boolean;
}): void {
  opts.root.replaceChildren();
  document.title = `${opts.title} · 小药盒`;
  const left = opts.topLeft;

  opts.content.setAttribute('role', 'main');
  opts.content.setAttribute('id', 'main-content');
  opts.content.setAttribute('tabindex', '-1');
  const dock = opts.actionDock ?? (opts.fab ? el('div', {}, [opts.fab]) : undefined);
  renderAppShell({
    root: opts.root,
    header: topbar(opts.title, opts.topRight, left),
    content: opts.content,
    dock,
    navigation: opts.showTabbar !== false ? tabbar(opts.activeTab) : undefined,
  });
}

/** ---------- Form field wrapper (label + input + error slot) ---------- */
let fieldSeq = 0;

export interface FieldOptions {
  /** id of the input element, used to wire label[for] and aria-describedby */
  inputId?: string;
  /** id of the error text element, used for aria-describedby on the input */
  errorId?: string;
  /** initial error message (empty string = no error) */
  error?: string;
  /** extra classes on the wrapper */
  class?: string;
}

export function field(
  labelText: string,
  inputEl: HTMLElement,
  opts: FieldOptions = {}
): HTMLElement {
  const wrap = el('div', { class: `field ${opts.class ?? ''}`.trim() });
  const label = el('label', { html: labelText });
  const generatedId = opts.inputId || inputEl.id || `field-${++fieldSeq}`;
  label.setAttribute('for', generatedId);
  inputEl.setAttribute('id', generatedId);
  if (!inputEl.getAttribute('name')) inputEl.setAttribute('name', generatedId);
  wrap.append(label);
  wrap.append(inputEl);
  const errorText = el('small', { class: 'error-text', html: opts.error ?? '' });
  if (opts.errorId) {
    errorText.setAttribute('id', opts.errorId);
    inputEl.setAttribute('aria-describedby', opts.errorId);
  }
  if (!opts.error) {
    errorText.style.display = 'none';
  }
  wrap.append(errorText);
  return wrap;
}

/** Helper: set/clear field error state */
export function setFieldError(
  inputEl: HTMLElement,
  message: string | null,
  errorId?: string
): void {
  const wrap = inputEl.closest('.field');
  if (!wrap) {
    if (!message) inputEl.removeAttribute('aria-invalid');
    else inputEl.setAttribute('aria-invalid', 'true');
    return;
  }
  const errorText = wrap.querySelector('.error-text');
  if (message) {
    wrap.classList.add('error');
    inputEl.setAttribute('aria-invalid', 'true');
    if (errorText) {
      if (errorId) errorText.setAttribute('id', errorId);
      errorText.textContent = message;
      (errorText as HTMLElement).style.display = '';
    }
  } else {
    wrap.classList.remove('error');
    inputEl.removeAttribute('aria-invalid');
    if (errorText) {
      errorText.textContent = '';
      (errorText as HTMLElement).style.display = 'none';
    }
  }
}

/** ---------- Spinner ---------- */
export function spinner(size = 20): HTMLElement {
  const s = el('span', { class: 'spinner' });
  s.style.cssText = `display:inline-block;width:${size}px;height:${size}px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;vertical-align:middle;`;
  return s;
}

/** ---------- Skeleton Card ---------- */
export function skeletonCard(): HTMLElement {
  const card = el('div', { class: 'card' });
  const line = (w: string, h = '14px', mb = '12px') => {
    const l = el('div');
    l.style.cssText = `width:${w};height:${h};margin-bottom:${mb};background:linear-gradient(90deg, rgba(0,0,0,0.06), rgba(0,0,0,0.10), rgba(0,0,0,0.06));border-radius:6px;background-size:200% 100%;animation:skel 1.4s ease-in-out infinite;`;
    return l;
  };
  card.append(line('60%', '20px', '16px'));
  card.append(line('100%'));
  card.append(line('90%'));
  card.append(line('40%'));
  return card;
}

/** ---------- Async button busy state ---------- */
export async function withBusyState<T>(
  btn: HTMLButtonElement,
  fn: () => Promise<T>
): Promise<T> {
  if (btn.disabled) return Promise.reject(new Error('Button already busy'));
  const originalChildren = Array.from(btn.childNodes);
  const originalWidth = btn.style.width;
  const sp = spinner(18);
  sp.style.marginRight = '8px';
  btn.disabled = true;
  btn.replaceChildren();
  btn.append(sp);
  btn.append(document.createTextNode('处理中…'));
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.replaceChildren(...originalChildren);
    btn.style.width = originalWidth;
  }
}
