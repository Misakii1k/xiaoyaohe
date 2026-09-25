// 自绘数字步进器：「− 数值 +」，替代原生 number 输入框的上下小箭头。
// 内部仍是一个 input，读写 .value 与原来一致，并会派发 input/change。

export interface StepperOptions {
  /** null 表示留空（仅 allowEmpty 时有意义） */
  value: number | null;
  min?: number;
  max?: number;
  step?: number;
  /** 数值后面的单位，如「分钟」「次」 */
  unit?: string;
  ariaLabel?: string;
  placeholder?: string;
  /** 可选字段：允许留空，失焦时不会把空值改成最小值 */
  allowEmpty?: boolean;
  /** 输入法类型，小数步进时用 decimal */
  inputMode?: 'numeric' | 'decimal';
}

export interface StepperControl {
  root: HTMLElement;
  input: HTMLInputElement;
}

function clamp(value: number, min?: number, max?: number): number {
  let next = value;
  if (min !== undefined) next = Math.max(min, next);
  if (max !== undefined) next = Math.min(max, next);
  return next;
}

/** 按步长的小数位取整，避免 0.1 + 0.2 这类浮点尾巴 */
function roundToStep(value: number, step: number): number {
  const decimals = (String(step).split('.')[1] ?? '').length;
  return Number(value.toFixed(decimals));
}

export function createStepper(options: StepperOptions): StepperControl {
  const step = options.step ?? 1;
  const isEmpty = () => input.value.trim() === '';
  const root = document.createElement('div');
  root.className = 'ui-stepper';

  const input = document.createElement('input');
  input.type = 'number';
  input.inputMode = options.inputMode ?? (Number.isInteger(step) ? 'numeric' : 'decimal');
  input.className = 'ui-stepper-input';
  // 步长只作用于按钮；手输允许任意精度（如 0.25 片），避免被原生校验拦下
  input.step = 'any';
  if (options.min !== undefined) input.min = String(options.min);
  if (options.max !== undefined) input.max = String(options.max);
  input.value = options.value == null
    ? (options.allowEmpty ? '' : String(options.min ?? 0))
    : String(clamp(options.value, options.min, options.max));
  if (options.placeholder) input.placeholder = options.placeholder;
  if (options.ariaLabel) input.setAttribute('aria-label', options.ariaLabel);

  const makeButton = (text: string, label: string, delta: number): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ui-stepper-btn';
    btn.textContent = text;
    btn.setAttribute('aria-label', `${label}${options.ariaLabel ? ` ${options.ariaLabel}` : ''}`);
    btn.addEventListener('click', () => {
      if (input.disabled) return;
      const current = Number(input.value);
      const base = Number.isFinite(current) ? current : (options.min ?? 0);
      const next = roundToStep(clamp(base + delta, options.min, options.max), step);
      input.value = String(next);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      syncButtons();
    });
    return btn;
  };

  const minus = makeButton('−', '减少', -step);
  const plus = makeButton('+', '增加', step);

  const syncButtons = () => {
    const current = Number(input.value);
    minus.disabled = input.disabled || isEmpty() || (options.min !== undefined && current <= options.min);
    plus.disabled = input.disabled || (options.max !== undefined && current >= options.max);
  };

  // 手动输入后离开时，把越界值拉回范围内
  input.addEventListener('input', syncButtons);
  input.addEventListener('blur', () => {
    if (options.allowEmpty && isEmpty()) {
      syncButtons();
      return;
    }
    const current = Number(input.value);
    const fixed = clamp(Number.isFinite(current) ? current : (options.min ?? 0), options.min, options.max);
    if (String(fixed) !== input.value) {
      input.value = String(fixed);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    syncButtons();
  });

  const center = document.createElement('div');
  center.className = 'ui-stepper-value';
  center.append(input);
  if (options.unit) {
    const unit = document.createElement('span');
    unit.className = 'ui-stepper-unit';
    unit.textContent = options.unit;
    center.append(unit);
  }

  root.append(minus, center, plus);

  // 业务代码直接赋值 input.value / 改 disabled 时不会派发事件，这里拦截以保持按钮状态同步
  const valueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (valueDesc?.get && valueDesc.set) {
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() { return valueDesc.get!.call(this); },
      set(v: string) { valueDesc.set!.call(this, v); syncButtons(); },
    });
  }
  new MutationObserver(syncButtons).observe(input, { attributes: true, attributeFilter: ['disabled'] });
  syncButtons();
  return { root, input };
}
