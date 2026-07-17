import { Icon } from '../icons/Icon';
import type { AppIconName } from '../icons/iconRegistry';

export interface IconButtonOptions {
  icon: AppIconName;
  label: string;
  onClick?: () => void;
  pressed?: boolean;
  disabled?: boolean;
}

export function createIconButton(options: IconButtonOptions): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ui-icon-button';
  button.setAttribute('aria-label', options.label);
  button.title = options.label;
  if (options.pressed !== undefined) button.setAttribute('aria-pressed', String(options.pressed));
  button.disabled = options.disabled ?? false;
  button.append(Icon(options.icon));
  if (options.onClick) button.addEventListener('click', options.onClick);
  return button;
}
