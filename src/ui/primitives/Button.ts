import { Icon } from '../icons/Icon';
import type { AppIconName } from '../icons/iconRegistry';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'text';

export interface ButtonOptions {
  label: string;
  variant?: ButtonVariant;
  icon?: AppIconName;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  onClick?: () => void;
}

export function createButton(options: ButtonOptions): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = options.type ?? 'button';
  button.className = `ui-button ui-button-${options.variant ?? 'primary'}`;
  button.disabled = options.disabled ?? false;
  if (options.icon) button.append(Icon(options.icon));
  const label = document.createElement('span');
  label.textContent = options.label;
  button.append(label);
  if (options.onClick) button.addEventListener('click', options.onClick);
  return button;
}
