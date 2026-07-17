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
      onChange(option.value);
    });
    group.append(button);
  }
  return group;
}
