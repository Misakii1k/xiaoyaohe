// 全站页面级动效：让主 Tab、子页面、返回共用一套连续的“翻页”动作。
// 业务状态先更新，动画只负责把前后两个状态接起来；不支持 WAAPI 或用户要求减弱动态时直接到位。
export type PageMotionDirection = 'initial' | 'tab' | 'forward' | 'back';

const IN_DURATION = 420;
const OUT_DURATION = 280;
const IN_EASE = 'cubic-bezier(0.22, 0.8, 0.25, 1)';
const OUT_EASE = 'cubic-bezier(0.4, 0, 0.7, 0.2)';
const SETTLE_TIMEOUT = 560;

interface SavedStyle {
  opacity: string;
  transform: string;
  pointerEvents: string;
  willChange: string;
}

const savedStyles = new WeakMap<HTMLElement, SavedStyle>();
let activeCleanup: (() => void) | null = null;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
let support: boolean | null = null;

/** 真实浏览器且未开启“减少动态效果”时才播放；测试环境没有 WAAPI 会自然走即时切换。 */
export function motionEnabled(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  if (support !== null) return support;
  if (typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function') {
    support = false;
    return support;
  }
  try {
    const probe = document.createElement('div');
    const animation = probe.animate([{ opacity: '1' }, { opacity: '1' }], { duration: 1 });
    support = Boolean(animation && typeof animation.finished?.then === 'function');
    animation?.cancel?.();
  } catch {
    support = false;
  }
  return support;
}

function rememberStyles(el: HTMLElement): void {
  if (savedStyles.has(el)) return;
  savedStyles.set(el, {
    opacity: el.style.opacity,
    transform: el.style.transform,
    pointerEvents: el.style.pointerEvents,
    willChange: el.style.willChange,
  });
}

function restoreStyles(el: HTMLElement): void {
  const saved = savedStyles.get(el);
  if (!saved) return;
  el.style.opacity = saved.opacity;
  el.style.transform = saved.transform;
  el.style.pointerEvents = saved.pointerEvents;
  el.style.willChange = saved.willChange;
  savedStyles.delete(el);
}

function cancelAnimations(el: HTMLElement): void {
  if (typeof el.getAnimations !== 'function') return;
  for (const animation of el.getAnimations()) {
    try {
      animation.cancel();
    } catch {
      /* ignored */
    }
  }
}

function layer(el: HTMLElement, value: 'under' | 'over'): void {
  el.dataset.motionLayer = value;
}

function clearLayer(el: HTMLElement): void {
  delete el.dataset.motionLayer;
}

function setInert(el: HTMLElement, value: boolean): void {
  el.inert = value;
  if (value) el.setAttribute('inert', '');
  else el.removeAttribute('inert');
}

function frameFor(direction: PageMotionDirection, outgoing: boolean): Keyframe {
  if (!outgoing) {
    if (direction === 'initial') return { opacity: 0, transform: 'translate3d(0, 12px, 0)' };
    // 新页保持不透明，从侧面盖住旧页；旧页只在露出的窄边里可见。
    // 这样不会出现两页文字互相透视的“重影”，也符合页面切换只动 transform 的预算。
    if (direction === 'back') return { opacity: 1, transform: 'translate3d(0, 0, 0)' };
    if (direction === 'forward') return { opacity: 1, transform: 'translate3d(30px, 0, 0)' };
    if (direction === 'tab') return { opacity: 1, transform: 'translate3d(24px, 0, 0) scale(0.996)' };
    return { opacity: 1, transform: 'translate3d(24px, 0, 0)' };
  }
  if (direction === 'back') return { opacity: 1, transform: 'translate3d(100%, 0, 0)' };
  if (direction === 'forward') return { opacity: 0.9, transform: 'translate3d(-18px, 0, 0) scale(0.996)' };
  if (direction === 'tab') return { opacity: 0.9, transform: 'translate3d(0, -6px, 0) scale(0.996)' };
  return { opacity: 1, transform: 'translate3d(0, -8px, 0)' };
}

function animateIn(el: HTMLElement, direction: PageMotionDirection): Animation | null {
  if (!motionEnabled()) return null;
  cancelAnimations(el);
  rememberStyles(el);
  el.style.willChange = 'transform, opacity';
  return el.animate(
    [frameFor(direction, false), { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' }],
    { duration: IN_DURATION, easing: IN_EASE, fill: 'both' },
  );
}

function animateOut(el: HTMLElement, direction: PageMotionDirection): Animation | null {
  if (!motionEnabled()) return null;
  cancelAnimations(el);
  rememberStyles(el);
  el.style.willChange = 'transform, opacity';
  return el.animate(
    [{ opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' }, frameFor(direction, true)],
    { duration: OUT_DURATION, easing: OUT_EASE, fill: 'both' },
  );
}

/** 让即将显示的页面先参与布局但不可见，等真实内容渲染完再开始入场。 */
export function preparePage(el: HTMLElement, direction: PageMotionDirection = 'forward'): boolean {
  if (!motionEnabled()) return false;
  rememberStyles(el);
  layer(el, 'over');
  const from = frameFor(direction, false);
  el.style.opacity = '0';
  el.style.transform = String(from.transform ?? 'none');
  el.style.pointerEvents = 'none';
  return true;
}

/**
 * 连续翻页：旧页退场、新页入场同时发生。
 * 默认新页盖在旧页上（进入子页/切 Tab）；返回时旧子页盖在恢复的 Tab 上，露出背后的列表。
 */
export function transitionPages(
  oldEl: HTMLElement,
  newEl: HTMLElement,
  direction: PageMotionDirection,
  options: { oldOver?: boolean; after?: () => void } = {},
): boolean {
  if (!motionEnabled()) return false;
  finishPageMotion();

  const oldOver = Boolean(options.oldOver);
  layer(oldEl, oldOver ? 'over' : 'under');
  layer(newEl, oldOver ? 'under' : 'over');
  rememberStyles(oldEl);
  rememberStyles(newEl);

  setInert(oldEl, true);
  oldEl.setAttribute('aria-hidden', 'true');
  oldEl.style.pointerEvents = 'none';
  newEl.inert = false;
  newEl.removeAttribute('inert');
  newEl.removeAttribute('aria-hidden');
  newEl.style.pointerEvents = 'none';
  newEl.style.opacity = '1';
  newEl.style.transform = 'none';

  const outgoing = animateOut(oldEl, direction);
  const incoming = animateIn(newEl, direction);
  let settled = false;

  const cleanup = () => {
    if (settled) return;
    settled = true;
    if (fallbackTimer !== null) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    activeCleanup = null;
    cancelAnimations(oldEl);
    cancelAnimations(newEl);
    clearLayer(oldEl);
    clearLayer(newEl);
    oldEl.hidden = true;
    oldEl.style.display = 'none';
    oldEl.setAttribute('aria-hidden', 'true');
    setInert(oldEl, false);
    oldEl.style.pointerEvents = '';
    restoreStyles(oldEl);
    newEl.style.pointerEvents = '';
    restoreStyles(newEl);
    options.after?.();
  };

  activeCleanup = cleanup;
  const finalize = () => cleanup();
  if (outgoing && incoming) {
    Promise.all([outgoing.finished.catch(() => undefined), incoming.finished.catch(() => undefined)])
      .then(finalize)
      .catch(finalize);
  } else {
    finalize();
    return true;
  }
  fallbackTimer = setTimeout(finalize, SETTLE_TIMEOUT);
  return true;
}

/** 子页之间替换内容时的一次“同向推进”，旧内容已经卸载，只让新内容从侧面落入。 */
export function animatePageSwap(el: HTMLElement): boolean {
  if (!motionEnabled()) return false;
  finishPageMotion();
  if (el.hidden) return false;
  cancelAnimations(el);
  rememberStyles(el);
  el.style.willChange = 'transform, opacity';
  const animation = el.animate(
    [
      { opacity: 0.65, transform: 'translate3d(14px, 0, 0)' },
      { opacity: 1, transform: 'translate3d(0, 0, 0)' },
    ],
    { duration: 340, easing: IN_EASE, fill: 'both' },
  );
  const settle = () => {
    cancelAnimations(el);
    restoreStyles(el);
  };
  animation.finished.then(settle).catch(settle);
  return true;
}

/** 首屏或没有旧页时的一次入场。 */
export function animatePageIn(el: HTMLElement, direction: PageMotionDirection = 'initial'): boolean {
  if (!motionEnabled()) return false;
  finishPageMotion();
  const animation = animateIn(el, direction);
  if (!animation) return false;
  const settle = () => {
    cancelAnimations(el);
    restoreStyles(el);
  };
  animation.finished.then(settle).catch(settle);
  return true;
}

/** 立即结束正在进行的翻页；供快速连点或路由错误兜底。 */
export function finishPageMotion(): void {
  activeCleanup?.();
}

/** 清掉所有临时的层级与内联样式，不改变页面自身的 hidden 状态。 */
export function resetPageMotion(): void {
  finishPageMotion();
  if (typeof document === 'undefined') return;
  for (const el of document.querySelectorAll<HTMLElement>('[data-motion-layer]')) {
    cancelAnimations(el);
    clearLayer(el);
    setInert(el, false);
    el.style.pointerEvents = '';
    restoreStyles(el);
  }
}
