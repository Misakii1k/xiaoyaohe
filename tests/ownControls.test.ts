// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createStepper } from '../src/ui/primitives/Stepper';
import { enhanceSelect } from '../src/ui/primitives/Pickers';

describe('createStepper', () => {
  it('按步长加减并受上下限约束', () => {
    const { root, input } = createStepper({ value: 1, min: 1, max: 3, unit: '分钟', ariaLabel: '间隔' });
    const [minus, plus] = root.querySelectorAll<HTMLButtonElement>('.ui-stepper-btn');
    expect(minus.disabled).toBe(true);
    plus.click();
    plus.click();
    plus.click();
    expect(input.value).toBe('3');
    expect(plus.disabled).toBe(true);
    expect(root.querySelector('.ui-stepper-unit')?.textContent).toBe('分钟');
  });

  it('小数步长不产生浮点尾巴', () => {
    const { root, input } = createStepper({ value: 0.1, min: 0, step: 0.1 });
    root.querySelectorAll<HTMLButtonElement>('.ui-stepper-btn')[1].click();
    root.querySelectorAll<HTMLButtonElement>('.ui-stepper-btn')[1].click();
    expect(input.value).toBe('0.3');
  });

  it('allowEmpty 时可留空，外部赋值后按钮状态同步', () => {
    const { root, input } = createStepper({ value: null, min: 0, allowEmpty: true });
    const [minus] = root.querySelectorAll<HTMLButtonElement>('.ui-stepper-btn');
    expect(input.value).toBe('');
    input.dispatchEvent(new Event('blur'));
    expect(input.value).toBe('');
    input.value = '5';
    expect(minus.disabled).toBe(false);
  });

  it('派发 change 事件', () => {
    const { root, input } = createStepper({ value: 2, min: 0 });
    let changed = '';
    input.addEventListener('change', () => { changed = input.value; });
    root.querySelectorAll<HTMLButtonElement>('.ui-stepper-btn')[0].click();
    expect(changed).toBe('1');
  });
});

describe('enhanceSelect', () => {
  it('就地替换原 select，保留引用并跟随选项与显隐变化', async () => {
    const host = document.createElement('div');
    const select = document.createElement('select');
    for (const v of ['a', 'b']) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = `选项${v}`;
      select.append(opt);
    }
    host.append(select);
    const control = enhanceSelect(select, { ariaLabel: '测试' });
    expect(control.select).toBe(select);
    expect(host.firstElementChild).toBe(control.root);
    expect(control.root.contains(select)).toBe(true);
    expect(control.root.querySelector('.ui-picker-value-text')?.textContent).toBe('选项a');

    select.value = 'b';
    control.refresh();
    expect(control.root.querySelector('.ui-picker-value-text')?.textContent).toBe('选项b');

    select.style.display = 'none';
    await new Promise((r) => setTimeout(r, 0));
    expect(control.root.style.display).toBe('none');
  });
});
