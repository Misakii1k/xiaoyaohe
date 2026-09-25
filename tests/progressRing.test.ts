// @vitest-environment happy-dom
//
// 打卡后进度环应从上次位置延伸到新值，而不是每次重渲染都从 0 整圈重扫。
import { describe, expect, it } from 'vitest';
import { progressRing } from '../src/ui/components';

function fg(ring: HTMLElement): SVGCircleElement | null {
  return ring.querySelector('.ring-fg');
}

describe('progressRing', () => {
  it('首次渲染（无上次进度）走整圈入场扫掠', () => {
    const ring = progressRing(1, 3);
    expect(fg(ring)?.getAttribute('class')).toContain('ring-fg-animated');
  });

  it('传入上次进度时从该位置延伸，不再从 0 重扫', () => {
    const ring = progressRing(2, 3, 33);
    const arc = fg(ring)!;
    expect(arc.getAttribute('class')).toContain('ring-fg-grow');
    expect(arc.getAttribute('class')).not.toContain('ring-fg-animated');
    expect(arc.style.getPropertyValue('--ring-from')).toBe('33 100');
    expect(arc.getAttribute('stroke-dasharray')).toBe('67 100');
  });

  it('进度未变化时不播放任何动画', () => {
    const arc = fg(progressRing(1, 3, 33))!;
    expect(arc.getAttribute('class')).toBe('ring-fg');
  });

  it('从 0 开始第一次打卡时也是延伸而非整圈扫掠', () => {
    const arc = fg(progressRing(1, 3, 0))!;
    expect(arc.getAttribute('class')).toContain('ring-fg-grow');
    expect(arc.style.getPropertyValue('--ring-from')).toBe('0 100');
  });
});
