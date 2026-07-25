import { iconRegistry, type AppIconName } from './iconRegistry';

const svgParser = typeof DOMParser !== 'undefined' ? new DOMParser() : null;

export function Icon(name: AppIconName, className?: string): SVGSVGElement {
  const svgText = iconRegistry[name];
  if (!svgParser) {
    // SSR / 测试兜底：返回一个占位 svg 元素
    const fallback = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    fallback.setAttribute('viewBox', '0 0 24 24');
    return fallback as SVGSVGElement;
  }
  const doc = svgParser.parseFromString(svgText, 'image/svg+xml');
  const svg = doc.documentElement as unknown as SVGSVGElement;
  if (className) svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  // Tabler 默认 stroke-width=2；在 UI 中统一收细到 1.75 更接近原有观感
  svg.setAttribute('stroke-width', '1.75');
  return svg;
}
