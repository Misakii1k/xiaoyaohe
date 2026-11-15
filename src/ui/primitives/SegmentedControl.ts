export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export function createSegmentedControl<T extends string>(
  label: string,
  options: readonly SegmentOption<T>[],
  value: T,
  onChange: (value: T) => void,
): HTMLElement {
  const group = document.createElement('div');
  group.className = 'ui-segmented-control';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);

  const indicator = document.createElement('span');
  indicator.className = 'ui-segmented-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  group.append(indicator);

  const placeIndicator = (instant = false) => {
    const selected = group.querySelector<HTMLButtonElement>('button.is-selected');
    if (!selected) return;
    const groupRect = group.getBoundingClientRect();
    const selectedRect = selected.getBoundingClientRect();
    if (groupRect.width === 0 || selectedRect.width === 0) {
      indicator.style.opacity = '0';
      return;
    }
    indicator.style.opacity = '1';
    if (instant) indicator.classList.add('is-instant');
    indicator.style.inlineSize = `${selectedRect.width}px`;
    indicator.style.blockSize = `${selectedRect.height}px`;
    indicator.style.transform = `translate3d(${selectedRect.left - groupRect.left}px, ${selectedRect.top - groupRect.top}px, 0)`;
    if (instant) {
      const nextFrame = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0);
      nextFrame(() => indicator.classList.remove('is-instant'));
    }
  };

  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = option.label;
    button.className = option.value === value ? 'is-selected' : '';
    button.setAttribute('aria-pressed', String(option.value === value));
    button.addEventListener('click', () => {
      for (const sibling of group.querySelectorAll('button')) {
        sibling.classList.toggle('is-selected', sibling === button);
        sibling.setAttribute('aria-pressed', String(sibling === button));
      }
      placeIndicator(false);
      onChange(option.value);
    });
    group.append(button);
  }

  // 首次显示、尺寸变化和字体加载完成后直接放到位，只有用户切换时才滑过去。
  const initialFrame = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0);
  initialFrame(() => placeIndicator(true));
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => placeIndicator(true));
    observer.observe(group);
  }

  return group;
}
