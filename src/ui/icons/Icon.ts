import { createElement } from 'lucide';
import { iconRegistry, type AppIconName } from './iconRegistry';

export function Icon(name: AppIconName, className?: string): SVGSVGElement {
  const svg = createElement(iconRegistry[name], {
    class: className,
    'aria-hidden': 'true',
    'stroke-width': '1.75',
  });
  return svg as SVGSVGElement;
}
