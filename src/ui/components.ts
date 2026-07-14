// 通用 UI 组件 / 工具函数（M3，无框架，纯 DOM）
import { SLOT_LABEL, type Slot } from '../db/schema';
import { navigate, registerRouteTransitionCleanup } from '../router';
import { getLastSync, onSync, type SyncState } from '../sync/syncClient';

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

/** 创建元素的简易工厂 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & {
    class?: string;
    text?: string;
    /** @deprecated Legacy alias for text. Markup is intentionally not parsed. */
    html?: string;
    'aria-*'?: string;
    'data-*'?: string;
  } = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: cls, text, html, ...rest } = props as any;
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

/** SVG 图标库（line 风格，stroke-width 1.75） */
export type IconName =
  | 'pill'
  | 'list'
  | 'camera'
  | 'gear'
  | 'arrow-left'
  | 'plus'
  | 'check'
  | 'undo'
  | 'info'
  | 'warn'
  | 'edit'
  | 'bell'
  | 'cloud'
  | 'box'
  | 'sparkles'
  | 'trash'
  | 'clock'
  | 'briefcase'
  | 'timer'
  | 'sun'
  | 'sun-high'
  | 'sunset'
  | 'moon'
  | 'utensils';

const ICON_PATHS: Record<IconName, string> = {
  pill: '<rect x="2.5" y="8" width="19" height="8" rx="4"/><line x1="12" y1="8" x2="12" y2="16"/>',
  list:
    '<line x1="8" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="8" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.2"/><circle cx="4" cy="12" r="1.2"/><circle cx="4" cy="18" r="1.2"/>',
  camera:
    '<path d="M3 8a2 2 0 0 1 2-2h3l1.5-2h5L16 6h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z"/><circle cx="12" cy="13" r="3.5"/>',
  gear:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  'arrow-left': '<polyline points="15 18 9 12 15 6"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  undo: '<polyline points="9 14 4 9 9 4"/><path d="M4 9h11a5 5 0 0 1 5 5v0a5 5 0 0 1-5 5h-4"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><circle cx="12" cy="8" r="0.5" fill="currentColor"/>',
  warn: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  cloud: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
  box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  sparkles:
    '<path d="M12 3l1.8 4.6L18 9l-4.2 1.5L12 15l-1.8-4.5L6 9l4.2-1.4L12 3z"/><path d="M19 14l.9 2.3L22 17l-2.1.7L19 20l-.9-2.3L16 17l2.1-.7L19 14z"/>',
  trash:
    '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  clock:
    '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/>',
  briefcase:
    '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
  timer:
    '<path d="M10 2h4"/><path d="M12 14l3-3"/><circle cx="12" cy="14" r="8"/><path d="M18.5 5.5l1.5-1.5"/>',
  // 时段语义图标
  sun: '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.9" y1="4.9" x2="6.8" y2="6.8"/><line x1="17.2" y1="17.2" x2="19.1" y2="19.1"/><line x1="4.9" y1="19.1" x2="6.8" y2="17.2"/><line x1="17.2" y1="6.8" x2="19.1" y2="4.9"/>',
  'sun-high':
    '<circle cx="12" cy="12" r="3.5"/><line x1="12" y1="3" x2="12" y2="6"/><line x1="3" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="21" y2="12"/><line x1="5.6" y1="5.6" x2="7.7" y2="7.7"/><line x1="16.3" y1="7.7" x2="18.4" y2="5.6"/><path d="M2 20h20"/>',
  sunset:
    '<path d="M2 18h20"/><path d="M5 18a7 7 0 0 1 14 0"/><line x1="12" y1="3" x2="12" y2="9"/><line x1="4.2" y1="10.2" x2="5.6" y2="11.6"/><line x1="18.4" y1="11.6" x2="19.8" y2="10.2"/><line x1="2" y1="22" x2="22" y2="22"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  utensils:
    '<path d="M3 2v7c0 1.1.9 2 2 2h0a2 2 0 0 0 2-2V2"/><line x1="5" y1="11" x2="5" y2="22"/><path d="M18 2v20"/><path d="M18 14c-2 0-3-1-3-4V4a2 2 0 0 1 3-2"/>',
};

/** 返回一个 SVG 元素 */
export function icon(name: IconName, className?: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  const parsed = new DOMParser().parseFromString(
    `<svg xmlns="${ns}">${ICON_PATHS[name]}</svg>`,
    'image/svg+xml',
  );
  for (const child of Array.from(parsed.documentElement.children)) {
    svg.append(document.importNode(child, true));
  }
  return svg;
}

/** 时段语义图标映射 */
export const SLOT_ICON: Record<Slot, IconName> = {
  morning: 'sun',
  noon: 'sun-high',
  evening: 'sunset',
  bedtime: 'moon',
};

/** Liquid Glass 不需要 ripple —— 按压反馈由 CSS :active { transform: scale(0.97) } 提供。
 * 保留导出避免破坏调用方。 */
export function installRipple(): void {
  /* no-op under Liquid Glass design */
}

/** ---------- Top App Bar ---------- */
export function topbar(title: string, right?: HTMLElement, left?: HTMLElement): HTMLElement {
  const bar = el('div', { class: 'topbar' });
  if (left) bar.append(left);
  bar.append(el('h1', { html: title }));
  if (right) bar.append(right);
  return bar;
}

/** ---------- 同步状态图标按钮 ---------- */
/** 把 SyncState 映射为可读中文，用于 aria-label / title */
function syncStateLabel(state: SyncState): string {
  switch (state) {
    case 'syncing': return '正在同步…';
    case 'ok': return '已云同步';
    case 'error': return '同步出错，点击查看';
    case 'offline': return '当前离线';
    case 'unconfigured': return '未配置云同步';
    case 'disabled': return '云同步已暂停';
    default: return '云同步状态';
  }
}

/** 创建同步状态图标按钮；点击跳转 /settings */
export function syncStatusIcon(initialState: SyncState): HTMLElement {
  const btn = el('button', {
    class: 'icon-btn sync-status-btn',
    type: 'button',
    'aria-label': syncStateLabel(initialState),
    title: syncStateLabel(initialState),
  } as any);
  btn.append(icon('cloud'));
  applySyncState(btn, initialState);
  btn.onclick = () => navigate('/settings');
  return btn;
}

/** 根据 SyncState 更新按钮外观（class + label） */
function applySyncState(btn: HTMLElement, state: SyncState): void {
  btn.className = `icon-btn sync-status-btn sync-state-${state}`;
  const label = syncStateLabel(state);
  btn.setAttribute('aria-label', label);
  btn.setAttribute('title', label);
}

/** ---------- Snackbar ---------- */
let toastTimer: number | undefined;
let toastHideTimer: number | undefined;
export function toast(msg: string, ms = 2200): void {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = el('div', { class: 'toast', html: msg });
  t.setAttribute('role', 'status');
  t.setAttribute('aria-live', 'polite');
  t.setAttribute('aria-atomic', 'true');
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  clearTimeout(toastHideTimer);
  toastTimer = window.setTimeout(() => {
    t.classList.remove('show');
    t.classList.add('hide');
    toastHideTimer = window.setTimeout(() => t.remove(), 260);
  }, ms);
}

/** ---------- Modal Dialog (a11y: focus trap + Escape + focus restore) ---------- */
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

function makeAppInert(): void {
  const root = document.getElementById('app') as (HTMLElement & { inert: boolean }) | null;
  if (!root) return;
  if (!dialogAppState) {
    dialogAppState = {
      root,
      inert: root.inert ?? false,
      ariaHidden: root.getAttribute('aria-hidden'),
    };
  }
  root.inert = true;
  root.setAttribute('aria-hidden', 'true');
}

function restoreAppAfterLastDialog(): void {
  if (activeDialogs.size > 0 || !dialogAppState) return;
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
  restoreAppAfterLastDialog();
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
  overlay.style.paddingTop = 'max(28px, env(safe-area-inset-top))';
  overlay.style.paddingBottom = 'max(28px, env(safe-area-inset-bottom))';

  const previouslyFocused = opts.returnFocusTo ?? (document.activeElement as HTMLElement | null);
  activeDialogs.add(overlay);
  makeAppInert();
  const focusables = () =>
    overlay.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

  const focusFirst = () => {
    const f = focusables();
    const target = opts.initialFocus ?? f[0];
    target?.focus();
  };

  const trapKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const f = focusables();
    if (f.length === 0) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    dialogClosers.delete(overlay);
    activeDialogs.delete(overlay);
    overlay.removeEventListener('keydown', trapKeydown);
    overlay.remove();
    restoreAppAfterLastDialog();
    opts.onClose?.();
    previouslyFocused?.focus();
  };
  dialogClosers.set(overlay, close);

  overlay.addEventListener('keydown', trapKeydown);
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
export function confirmDialog(message: string, okText = '确定', danger = false): Promise<boolean> {
  const titleId = `dialog-title-${++dialogSeq}`;
  const ok = el('button', { class: `btn ${danger ? 'danger' : ''}`, html: okText });
  const cancel = el('button', { class: 'btn text', html: '取消' });
  const title = el('div', { class: 'big', html: message, id: titleId, style: 'margin-bottom:24px' } as any);
  title.style.whiteSpace = 'pre-line';
  const actions = el(
    'div',
    { style: 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap' } as any,
    [cancel, ok]
  );
  const box = el('div', { class: 'card' }, [title, actions]);
  let overlay: HTMLElement | null = null;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const close = (v: boolean, dismissedByDialog = false) => {
      if (settled) return;
      settled = true;
      if (overlay && !dismissedByDialog) closeDialog(overlay);
      resolve(v);
    };
    ok.onclick = () => close(true);
    cancel.onclick = () => close(false);
    overlay = openDialog(box, {
      labelId: titleId,
      onClose: () => close(false, true),
      initialFocus: danger ? cancel : ok,
    });
  });
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
  cta?: HTMLElement
): HTMLElement {
  const wrap = el('div', { class: 'empty' });
  const circle = el('div', { class: 'ic-circle' });
  circle.append(icon(iconName));
  wrap.append(circle);
  wrap.append(el('div', { class: 'title', html: title }));
  if (sub) wrap.append(el('div', { class: 'sub', html: sub }));
  if (cta) wrap.append(cta);
  return wrap;
}

/** ---------- 进度环 ---------- */
export function progressRing(value: number, total: number): HTMLElement {
  const wrap = el('div', { class: 'progress-ring' });
  wrap.setAttribute('role', 'progressbar');
  wrap.setAttribute('aria-valuemin', '0');
  wrap.setAttribute('aria-valuemax', String(Math.max(0, total)));
  wrap.setAttribute('aria-valuenow', String(Math.max(0, value)));
  wrap.setAttribute('aria-label', `已完成 ${value} 项，共 ${total} 项`);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', '0 0 80 80');
  const bg = document.createElementNS(ns, 'circle');
  bg.setAttribute('class', 'ring-bg');
  bg.setAttribute('cx', '40');
  bg.setAttribute('cy', '40');
  bg.setAttribute('r', '32');
  svg.append(bg);
  const r = 32;
  const c = 2 * Math.PI * r;
  const ratio = total > 0 ? Math.min(1, value / total) : 0;
  const fg = document.createElementNS(ns, 'circle');
  fg.setAttribute('class', 'ring-fg');
  fg.setAttribute('cx', '40');
  fg.setAttribute('cy', '40');
  fg.setAttribute('r', String(r));
  fg.setAttribute('stroke-dasharray', String(c));
  fg.setAttribute('stroke-dashoffset', String(c * (1 - ratio)));
  svg.append(fg);
  wrap.append(svg);
  wrap.append(el('div', { class: 'ring-label', html: `${value}/${total}` }));
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
  const tabs: { route: string; ic: IconName; label: string }[] = [
    { route: 'today', ic: 'pill', label: '今天' },
    { route: 'meds', ic: 'list', label: '药品' },
    { route: 'scan', ic: 'camera', label: '扫码分药' },
    { route: 'settings', ic: 'gear', label: '设置' },
  ];
  const bar = el('nav', { class: 'tabbar' });
  bar.setAttribute('aria-label', '主导航');
  for (const t of tabs) {
    const isActive = active === t.route;
    const a = el('a', {
      href: `#/${t.route}`,
      class: isActive ? 'active' : '',
    });
    if (isActive) a.setAttribute('aria-current', 'page');
    const ic = el('span', { class: 'ic' });
    ic.append(icon(t.ic));
    a.append(ic);
    a.append(el('span', { html: t.label }));
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
  showTabbar?: boolean;
}): void {
  installRipple();
  opts.root.replaceChildren();
  document.title = `${opts.title} · 日常工具箱`;
  const left = opts.topLeft || (opts.showTabbar !== false && opts.activeTab !== 'tools'
    ? toolboxButton()
    : undefined);

  // 右侧：同步状态图标 + 可选的页面级 topRight
  const syncBtn = syncStatusIcon(getLastSync().state);
  let right: HTMLElement | undefined;
  if (opts.topRight) {
    right = el('div', { class: 'topbar-actions' });
    right.append(syncBtn, opts.topRight);
  } else {
    right = syncBtn;
  }
  // 订阅同步状态变化，实时更新图标
  let unsub: (() => void) | undefined;
  unsub = onSync((r) => {
    if (document.body.contains(syncBtn)) applySyncState(syncBtn, r.state);
    else if (unsub) unsub();
  });
  window.addEventListener('hashchange', () => unsub?.(), { once: true });

  opts.content.setAttribute('role', 'main');
  opts.content.setAttribute('id', 'main-content');
  opts.content.setAttribute('tabindex', '-1');
  opts.root.append(topbar(opts.title, right, left));
  opts.root.append(opts.content);
  if (opts.fab) opts.root.append(opts.fab);
  if (opts.showTabbar !== false) opts.root.append(tabbar(opts.activeTab));
}

function toolboxButton(): HTMLElement {
  const b = el('button', {
    class: 'icon-btn',
    type: 'button',
    title: '返回工具箱',
    'aria-label': '返回工具箱',
  } as any);
  b.append(icon('box'));
  b.onclick = () => {
    location.hash = '#/tools';
  };
  return b;
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
