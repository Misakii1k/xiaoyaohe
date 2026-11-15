/**
 * 数药片数量显示：清点抽屉与记账抽屉共用的大数字结构。
 * 保持 textContent 为「共 N 粒」，现有单测与 E2E 依赖这个可读文本。
 */

export interface PillCountDisplay {
  root: HTMLDivElement;
  setCount: (count: number) => void;
}

export function createPillCountDisplay(initialCount: number): PillCountDisplay {
  const root = document.createElement('div');
  root.className = 'pill-counter-count';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');

  const label = document.createElement('span');
  label.className = 'pill-counter-count-label';
  label.textContent = '共 ';

  const value = document.createElement('span');
  value.className = 'pill-counter-count-value';

  const unit = document.createElement('span');
  unit.className = 'pill-counter-count-unit';
  unit.textContent = ' 粒';

  root.append(label, value, unit);

  let current = -1;
  let bumpTimer: number | undefined;

  const setCount = (count: number) => {
    const next = Math.max(0, Math.round(Number(count) || 0));
    if (next === current) return;
    const shouldBump = current >= 0;
    current = next;
    value.textContent = String(next);
    root.setAttribute('aria-label', `共 ${next} 粒`);
    if (!shouldBump) return;
    root.classList.remove('is-bumped');
    // 强制重排，保证连续改数也能重新播放一次收尾动效。
    void root.offsetWidth;
    root.classList.add('is-bumped');
    if (bumpTimer) window.clearTimeout(bumpTimer);
    bumpTimer = window.setTimeout(() => {
      root.classList.remove('is-bumped');
      bumpTimer = undefined;
    }, 260);
  };
  setCount(initialCount);

  return { root, setCount };
}
