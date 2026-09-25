// 自绘时间 / 日期 / 下拉：用底部抽屉替代安卓 WebView 原生选择器，视觉跟新版卡片一致。
import { openBottomSheet } from './BottomSheet';
import { createButton } from './Button';

export interface PickerControl {
  /** 外层控件（放进表单） */
  root: HTMLElement;
  /** 隐藏的原生 input/select，读写 .value 与原来一致，并会派发 input/change */
  input: HTMLInputElement | HTMLSelectElement;
  /** 刷新触发器上的显示文字 */
  refresh: () => void;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function parseTime(value: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return { hour: 8, minute: 0 };
  return {
    hour: Math.min(23, Math.max(0, Number(m[1]) || 0)),
    minute: Math.min(59, Math.max(0, Number(m[2]) || 0)),
  };
}

function formatTime(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

function parseDate(value: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  const now = new Date();
  if (!m) {
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  }
  return {
    year: Number(m[1]),
    month: Math.min(12, Math.max(1, Number(m[2]))),
    day: Math.min(31, Math.max(1, Number(m[3]))),
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function formatDate(year: number, month: number, day: number): string {
  const max = daysInMonth(year, month);
  const d = Math.min(day, max);
  return `${year}-${pad2(month)}-${pad2(d)}`;
}

function parseDateTimeLocal(value: string): { date: string; time: string } {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(value.trim());
  const date = m?.[1];
  const time = m?.[2];
  if (date && time) return { date, time };
  const now = new Date();
  return {
    date: formatDate(now.getFullYear(), now.getMonth() + 1, now.getDate()),
    time: formatTime(now.getHours(), now.getMinutes()),
  };
}

function setControlValue(input: HTMLInputElement | HTMLSelectElement, value: string): void {
  if (input.value === value) return;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function makeTrigger(label: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ui-picker-trigger';
  btn.setAttribute('aria-haspopup', 'dialog');
  const text = document.createElement('span');
  text.className = 'ui-picker-value-text';
  text.textContent = label;
  const chevron = document.createElement('span');
  chevron.className = 'ui-picker-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '›';
  btn.append(text, chevron);
  return btn;
}

function makeHiddenInput(type: string, value: string, ariaLabel?: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  input.className = 'ui-picker-native';
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  if (ariaLabel) input.setAttribute('aria-label', ariaLabel);
  return input;
}

function sheetTitle(text: string): HTMLElement {
  const node = document.createElement('div');
  node.className = 'ui-picker-sheet-title';
  node.textContent = text;
  return node;
}

function optionList(
  items: Array<{ value: string; label: string }>,
  current: string,
  onPick: (value: string) => void,
): HTMLElement {
  const list = document.createElement('div');
  list.className = 'ui-picker-options';
  list.setAttribute('role', 'listbox');
  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ui-picker-option' + (item.value === current ? ' is-selected' : '');
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', String(item.value === current));
    btn.textContent = item.label;
    btn.addEventListener('click', () => onPick(item.value));
    list.append(btn);
  }
  return list;
}

function wheelColumn(
  label: string,
  values: number[],
  current: number,
  format: (n: number) => string,
  onPick: (n: number) => void,
): HTMLElement {
  const col = document.createElement('div');
  col.className = 'ui-picker-wheel';
  const head = document.createElement('div');
  head.className = 'ui-picker-wheel-label';
  head.textContent = label;
  const list = document.createElement('div');
  list.className = 'ui-picker-wheel-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', label);
  for (const value of values) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ui-picker-wheel-item' + (value === current ? ' is-selected' : '');
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', String(value === current));
    btn.textContent = format(value);
    btn.dataset.value = String(value);
    btn.addEventListener('click', () => onPick(value));
    list.append(btn);
  }
  // 滚到当前项附近
  requestAnimationFrame(() => {
    const selected = list.querySelector<HTMLElement>('.is-selected');
    selected?.scrollIntoView({ block: 'center' });
  });
  col.append(head, list);
  return col;
}

function updateWheelSelection(col: HTMLElement, value: number): void {
  for (const item of col.querySelectorAll<HTMLElement>('.ui-picker-wheel-item')) {
    const on = Number(item.dataset.value) === value;
    item.classList.toggle('is-selected', on);
    item.setAttribute('aria-selected', String(on));
  }
}

/** 时间选择：隐藏 type=time，点按钮打开新版底部抽屉 */
export function createTimeControl(options: {
  value?: string;
  ariaLabel?: string;
  placeholder?: string;
  /** 分钟档位，默认 5 分钟 */
  minuteStep?: number;
}): PickerControl {
  const value = options.value && /^\d{1,2}:\d{2}$/.test(options.value)
    ? formatTime(parseTime(options.value).hour, parseTime(options.value).minute)
    : options.value || '';
  const root = document.createElement('div');
  root.className = 'ui-picker ui-picker-time';
  const input = makeHiddenInput('time', value, options.ariaLabel);
  const trigger = makeTrigger(displayTime(value, options.placeholder));
  if (options.ariaLabel) trigger.setAttribute('aria-label', options.ariaLabel);

  const refresh = () => {
    trigger.querySelector('.ui-picker-value-text')!.textContent = displayTime(input.value, options.placeholder);
  };

  trigger.addEventListener('click', () => {
    if (input.disabled) return;
    openTimeSheet(input.value || '08:00', (next) => {
      setControlValue(input, next);
      refresh();
    }, options.ariaLabel || '选择时间', options.minuteStep);
  });

  // 外部改 value 时保持显示同步
  const observer = new MutationObserver(refresh);
  observer.observe(input, { attributes: true, attributeFilter: ['value'] });
  input.addEventListener('input', refresh);
  input.addEventListener('change', refresh);

  root.append(trigger, input);
  return { root, input, refresh };
}

function displayTime(value: string, placeholder?: string): string {
  if (!value) return placeholder || '选择时间';
  const { hour, minute } = parseTime(value);
  return formatTime(hour, minute);
}

function openTimeSheet(
  current: string,
  onConfirm: (value: string) => void,
  title = '选择时间',
  minuteStep = 5,
): void {
  let { hour, minute } = parseTime(current);
  const step = Math.max(1, Math.min(30, Math.floor(minuteStep)));
  // 分钟按档位吸附；若当前不在档位上，就近吸附
  minute = Math.round(minute / step) * step;
  if (minute >= 60) {
    minute = 0;
    hour = (hour + 1) % 24;
  }

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);

  // 顶部大字预览：选了什么一眼可见，不必去两列里找高亮
  const preview = document.createElement('div');
  preview.className = 'ui-picker-preview';
  preview.setAttribute('aria-live', 'polite');
  const syncPreview = () => { preview.textContent = formatTime(hour, minute); };
  syncPreview();

  const wheels = document.createElement('div');
  wheels.className = 'ui-picker-wheels';
  const hourCol = wheelColumn('时', hours, hour, pad2, (n) => {
    hour = n;
    updateWheelSelection(hourCol, hour);
    syncPreview();
  });
  const minuteCol = wheelColumn('分', minutes, minute, pad2, (n) => {
    minute = n;
    updateWheelSelection(minuteCol, minute);
    syncPreview();
  });
  wheels.append(hourCol, minuteCol);

  const actions = document.createElement('div');
  actions.className = 'ui-picker-sheet-actions';
  const cancel = createButton({ label: '取消', variant: 'text', onClick: () => sheet.close() });
  const ok = createButton({
    label: '确定',
    icon: 'check',
    onClick: () => {
      onConfirm(formatTime(hour, minute));
      sheet.close();
    },
  });
  actions.append(cancel, ok);

  const sheet = openBottomSheet({
    label: title,
    content: [sheetTitle(title), preview, wheels, actions],
    initialFocus: ok,
  });
}

/** 日期选择：隐藏 type=date */
export function createDateControl(options: {
  value?: string;
  ariaLabel?: string;
  placeholder?: string;
  required?: boolean;
}): PickerControl {
  const value = options.value && /^\d{4}-\d{2}-\d{2}$/.test(options.value) ? options.value : '';
  const root = document.createElement('div');
  root.className = 'ui-picker ui-picker-date';
  const input = makeHiddenInput('date', value, options.ariaLabel);
  if (options.required) input.required = true;
  const trigger = makeTrigger(displayDate(value, options.placeholder));
  if (options.ariaLabel) trigger.setAttribute('aria-label', options.ariaLabel);

  const refresh = () => {
    trigger.querySelector('.ui-picker-value-text')!.textContent = displayDate(input.value, options.placeholder);
  };

  trigger.addEventListener('click', () => openDateSheet(input.value, (next) => {
    setControlValue(input, next);
    refresh();
  }));

  input.addEventListener('input', refresh);
  input.addEventListener('change', refresh);

  root.append(trigger, input);
  return { root, input, refresh };
}

function displayDate(value: string, placeholder?: string): string {
  if (!value) return placeholder || '选择日期';
  const { year, month, day } = parseDate(value);
  return `${year}年${month}月${day}日`;
}

function openDateSheet(current: string, onConfirm: (value: string) => void): void {
  let { year, month, day } = current ? parseDate(current) : parseDate('');
  const now = new Date();
  // 药品有效期常往后好几年，历史用药记录也可能需要回溯。当前值的年份始终出现在列表里。
  const yearStart = Math.min(now.getFullYear() - 5, year - 2);
  const yearEnd = Math.max(now.getFullYear() + 12, year + 2);
  const years = Array.from({ length: yearEnd - yearStart + 1 }, (_, i) => yearStart + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  const wheels = document.createElement('div');
  wheels.className = 'ui-picker-wheels';

  const rebuildDays = () => {
    const max = daysInMonth(year, month);
    if (day > max) day = max;
    const dayValues = Array.from({ length: max }, (_, i) => i + 1);
    const next = wheelColumn('日', dayValues, day, (n) => String(n), (n) => {
      day = n;
      updateWheelSelection(next, day);
    });
    const old = wheels.querySelector('[data-day-col]');
    next.dataset.dayCol = '1';
    if (old) old.replaceWith(next);
    else wheels.append(next);
  };

  const yearCol = wheelColumn('年', years, year, (n) => String(n), (n) => {
    year = n;
    updateWheelSelection(yearCol, year);
    rebuildDays();
  });
  const monthCol = wheelColumn('月', months, month, (n) => String(n), (n) => {
    month = n;
    updateWheelSelection(monthCol, month);
    rebuildDays();
  });
  wheels.append(yearCol, monthCol);
  rebuildDays();

  const quick = document.createElement('div');
  quick.className = 'ui-picker-quick';
  const todayBtn = createButton({
    label: '今天',
    variant: 'secondary',
    onClick: () => {
      const t = new Date();
      year = t.getFullYear();
      month = t.getMonth() + 1;
      day = t.getDate();
      onConfirm(formatDate(year, month, day));
      sheet.close();
    },
  });
  quick.append(todayBtn);

  const actions = document.createElement('div');
  actions.className = 'ui-picker-sheet-actions';
  const cancel = createButton({ label: '取消', variant: 'text', onClick: () => sheet.close() });
  const ok = createButton({
    label: '确定',
    icon: 'check',
    onClick: () => {
      onConfirm(formatDate(year, month, day));
      sheet.close();
    },
  });
  actions.append(cancel, ok);

  const sheet = openBottomSheet({
    label: '选择日期',
    content: [sheetTitle('选择日期'), wheels, quick, actions],
    initialFocus: ok,
  });
}

/** 日期时间：隐藏 type=datetime-local（YYYY-MM-DDTHH:mm） */
export function createDateTimeControl(options: {
  value?: string;
  ariaLabel?: string;
  placeholder?: string;
}): PickerControl {
  const parsed = options.value ? parseDateTimeLocal(options.value) : parseDateTimeLocal('');
  const value = options.value ? `${parsed.date}T${parsed.time}` : '';
  const root = document.createElement('div');
  root.className = 'ui-picker ui-picker-datetime';
  const input = makeHiddenInput('datetime-local', value, options.ariaLabel);
  const trigger = makeTrigger(displayDateTime(value, options.placeholder));
  if (options.ariaLabel) trigger.setAttribute('aria-label', options.ariaLabel);

  const refresh = () => {
    trigger.querySelector('.ui-picker-value-text')!.textContent = displayDateTime(input.value, options.placeholder);
  };

  trigger.addEventListener('click', () => {
    const cur = parseDateTimeLocal(input.value || `${parsed.date}T${parsed.time}`);
    openDateSheet(cur.date, (date) => {
      openTimeSheet(cur.time, (time) => {
        setControlValue(input, `${date}T${time}`);
        refresh();
      });
    });
  });

  input.addEventListener('input', refresh);
  input.addEventListener('change', refresh);
  root.append(trigger, input);
  return { root, input, refresh };
}

function displayDateTime(value: string, placeholder?: string): string {
  if (!value) return placeholder || '选择日期和时间';
  const { date, time } = parseDateTimeLocal(value);
  return `${displayDate(date)} ${time}`;
}

/** 下拉选择：隐藏 select，点按钮从底部列表选 */
export function createSelectControl(options: {
  options: Array<{ value: string; label: string }>;
  value?: string;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
}): PickerControl & { select: HTMLSelectElement } {
  const root = document.createElement('div');
  root.className = `ui-picker ui-picker-select${options.className ? ` ${options.className}` : ''}`;
  const select = document.createElement('select');
  select.className = 'ui-picker-native';
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  if (options.ariaLabel) select.setAttribute('aria-label', options.ariaLabel);
  for (const opt of options.options) {
    const node = document.createElement('option');
    node.value = opt.value;
    node.textContent = opt.label;
    select.append(node);
  }
  if (options.value != null) select.value = options.value;
  else if (options.options[0]) select.value = options.options[0].value;

  const trigger = makeTrigger(labelFor(select, options.placeholder));
  if (options.ariaLabel) trigger.setAttribute('aria-label', options.ariaLabel);

  const refresh = () => {
    trigger.querySelector('.ui-picker-value-text')!.textContent = labelFor(select, options.placeholder);
  };

  trigger.addEventListener('click', () => {
    const items = options.options;
    const list = optionList(items, select.value, (value) => {
      setControlValue(select, value);
      refresh();
      sheet.close();
    });
    const cancel = createButton({ label: '取消', variant: 'text', onClick: () => sheet.close() });
    const actions = document.createElement('div');
    actions.className = 'ui-picker-sheet-actions';
    actions.append(cancel);
    const sheet = openBottomSheet({
      label: options.ariaLabel || '请选择',
      content: [sheetTitle(options.ariaLabel || '请选择'), list, actions],
      initialFocus: list.querySelector<HTMLElement>('.is-selected') ?? undefined,
    });
  });

  select.addEventListener('change', refresh);
  select.addEventListener('input', refresh);
  root.append(trigger, select);
  return { root, input: select, select, refresh };
}

function labelFor(select: HTMLSelectElement, placeholder?: string): string {
  const opt = select.options[select.selectedIndex];
  if (!opt || !opt.value && !opt.textContent) return placeholder || '请选择';
  return opt.textContent || placeholder || '请选择';
}

/**
 * 把一个已有的 select 就地换成自绘下拉：原 select 引用不变（业务代码照常读写 .value、
 * 增删 option、监听 change），选项在打开时实时读取，适合选项会动态变化的场景。
 * select 被设为 display:none / disabled 时，触发按钮同步隐藏 / 禁用。
 */
export function enhanceSelect(
  select: HTMLSelectElement,
  options: { ariaLabel?: string; placeholder?: string; className?: string } = {},
): PickerControl & { select: HTMLSelectElement } {
  const ariaLabel = options.ariaLabel || select.getAttribute('aria-label') || undefined;
  const root = document.createElement('div');
  root.className = `ui-picker ui-picker-select${options.className ? ` ${options.className}` : ''}`;
  const trigger = makeTrigger(labelFor(select, options.placeholder));
  if (ariaLabel) trigger.setAttribute('aria-label', ariaLabel);

  const refresh = () => {
    trigger.querySelector('.ui-picker-value-text')!.textContent = labelFor(select, options.placeholder);
    trigger.disabled = select.disabled;
    root.style.display = select.style.display === 'none' ? 'none' : '';
  };

  trigger.addEventListener('click', () => {
    if (select.disabled) return;
    const items = Array.from(select.options)
      .filter((opt) => !opt.disabled)
      .map((opt) => ({ value: opt.value, label: opt.textContent || opt.value }));
    const list = optionList(items, select.value, (value) => {
      setControlValue(select, value);
      refresh();
      sheet.close();
    });
    const cancel = createButton({ label: '取消', variant: 'text', onClick: () => sheet.close() });
    const actions = document.createElement('div');
    actions.className = 'ui-picker-sheet-actions';
    actions.append(cancel);
    const title = ariaLabel || '请选择';
    const sheet = openBottomSheet({
      label: title,
      content: [sheetTitle(title), list, actions],
      initialFocus: list.querySelector<HTMLElement>('.is-selected') ?? undefined,
    });
  });

  const parent = select.parentElement;
  if (parent) parent.replaceChild(root, select);
  select.classList.add('ui-picker-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  root.append(trigger, select);

  // 选项增删、禁用、显隐变化时同步触发按钮
  const observer = new MutationObserver(refresh);
  observer.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'style'] });
  select.addEventListener('change', refresh);
  select.addEventListener('input', refresh);
  refresh();
  return { root, input: select, select, refresh };
}

/** 替换已有 input[type=time|date|datetime-local] 为自绘控件，保留同一 input 引用 */
export function enhanceNativePicker(input: HTMLInputElement): PickerControl {
  const type = input.type;
  const parent = input.parentElement;
  let control: PickerControl;
  if (type === 'time') {
    control = createTimeControl({ value: input.value, ariaLabel: input.getAttribute('aria-label') || undefined });
  } else if (type === 'date') {
    control = createDateControl({
      value: input.value,
      ariaLabel: input.getAttribute('aria-label') || undefined,
      required: input.required,
    });
  } else if (type === 'datetime-local') {
    control = createDateTimeControl({ value: input.value, ariaLabel: input.getAttribute('aria-label') || undefined });
  } else {
    const root = document.createElement('div');
    root.append(input);
    return { root, input, refresh: () => undefined };
  }
  // 同步属性
  if (input.id) control.input.id = input.id;
  if (input.name) control.input.name = input.name;
  if (input.required) (control.input as HTMLInputElement).required = true;
  parent?.replaceChild(control.root, input);
  return control;
}
