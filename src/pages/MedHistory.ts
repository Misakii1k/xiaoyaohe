// 服药历史页面：回看任意区间的服药情况，并支持 90 天内补记 / 更正
import {
  listLogsByRange,
  listMeds,
  listScheduleRevisions,
  setOccurrenceAction,
  MedicationIntakeError,
  type IntakeAction,
  type IntakeMutationResult,
} from '../db/local';
import {
  type IntakeLog,
  type LocalDate,
  type Medication,
  type MedicationOccurrence,
  type MedicationScheduleRevision,
  SLOTS,
  SLOT_LABEL,
  type Slot,
  formatMealRels,
} from '../db/schema';
import {
  addLocalDays,
  calculateAdherence,
  findLogForOccurrence,
  generateOccurrences,
  localDayBounds,
  localDateDayOfWeek,
  toLocalDate,
  type AdherenceSummary,
} from '../domain/medicationSchedule';
import {
  banner,
  closeDialog,
  el,
  icon,
  openDialog,
  progressRing,
  renderPage,
  skeletonCard,
  slotTag,
  toast,
} from '../ui/components';
import { createStatusBadge } from '../ui/primitives/StatusBadge';
import { createSegmentedControl } from '../ui/primitives/SegmentedControl';
import { getMedPhotoUrls } from '../features/medPhotos';
import { navigate } from '../router';

/** 时间区间预设 */
export type RangePreset = '7d' | '30d' | '90d' | 'custom';

/** 历史页 UI 状态 */
export interface HistoryState {
  rangePreset: RangePreset;
  /** preset='custom' 时使用；缺省时回退到最近 30 天 */
  customStart?: LocalDate;
  customEnd?: LocalDate;
  filterMed: 'all' | string; // medId
  filterSlot: 'all' | Slot;
  filterStatus: 'all' | 'taken' | 'skipped' | 'missed';
}

/** 历史页加载后的归集数据 */
export interface HistoryData {
  medById: Map<string, Medication>;
  revisions: MedicationScheduleRevision[];
  logs: IntakeLog[];
  occurrences: MedicationOccurrence[];
  /** 已按 localDate 倒序、并按 dueAt 升序排列 */
  dayGroups: HistoryDayGroup[];
}

/** 单条明细的展示态 */
export type HistoryItemStatus = 'taken' | 'skipped' | 'pending' | 'missed';

export interface HistoryDayItem {
  occurrence: MedicationOccurrence;
  log?: IntakeLog;
  med: Medication;
  status: HistoryItemStatus;
}

export interface HistoryDayGroup {
  date: LocalDate;
  items: HistoryDayItem[];
}

/** 编辑窗口：超过该天数的记录视为只读 */
export const HISTORY_EDIT_WINDOW_DAYS = 90;

export const DEFAULT_HISTORY_STATE: HistoryState = {
  rangePreset: '30d',
  filterMed: 'all',
  filterSlot: 'all',
  filterStatus: 'all',
};

/**
 * 根据预设与 today 计算起止 LocalDate（含两端）。
 * 自定义区间跨度超过 90 天时抛 RangeError，由调用方决定如何提示用户。
 */
export function computeRangeBounds(
  state: HistoryState,
  today: LocalDate = toLocalDate(),
): { start: LocalDate; end: LocalDate } {
  if (state.rangePreset === 'custom') {
    if (!isLocalDate(state.customStart) || !isLocalDate(state.customEnd)) {
      return { start: addLocalDays(today, -29), end: today };
    }
    if (state.customStart > state.customEnd) {
      return { start: state.customEnd, end: state.customStart };
    }
    const spanDays = calendarDaysBetween(state.customStart, state.customEnd);
    if (spanDays >= HISTORY_EDIT_WINDOW_DAYS) {
      throw new RangeError('自定义区间最多 90 天');
    }
    return { start: state.customStart, end: state.customEnd };
  }
  const days: Record<Exclude<RangePreset, 'custom'>, number> = {
    '7d': 6,
    '30d': 29,
    '90d': 89,
  };
  return { start: addLocalDays(today, -days[state.rangePreset]), end: today };
}

/**
 * 把 occurrences + logs 组装成按日倒序的明细组。
 * - 已发生且 dueAt < now 但无 log → status='missed'
 * - 未来 due（dueAt > now）→ status='pending'
 * - log.status='taken' / 'skipped' → 对应状态
 */
export function groupOccurrencesByDate(
  occurrences: readonly MedicationOccurrence[],
  logs: readonly IntakeLog[],
  medById: ReadonlyMap<string, Medication>,
  now: number = Date.now(),
): HistoryDayGroup[] {
  const byDate = new Map<LocalDate, HistoryDayItem[]>();
  for (const occurrence of occurrences) {
    const med = medById.get(occurrence.medId);
    if (!med) continue; // 药品已删除（理论上不会，因为 listMeds 默认过滤 deleted）
    const log = findLogForOccurrence(occurrence, logs);
    const status: HistoryItemStatus = log?.status === 'taken'
      ? 'taken'
      : log?.status === 'skipped'
        ? 'skipped'
        : occurrence.dueAt < now
          ? 'missed'
          : 'pending';
    const item: HistoryDayItem = { occurrence, log, med, status };
    const list = byDate.get(occurrence.localDate) ?? [];
    list.push(item);
    byDate.set(occurrence.localDate, list);
  }
  const groups: HistoryDayGroup[] = [];
  for (const [date, items] of byDate) {
    items.sort((a, b) => a.occurrence.dueAt - b.occurrence.dueAt);
    groups.push({ date, items });
  }
  groups.sort((a, b) => b.date.localeCompare(a.date));
  return groups;
}

/**
 * 计算当前连续服药天数（streak）。
 * - 从 today 起向前回溯
 * - 非今日：所有 due 均 taken 则计入；未全 taken 或无 due 则中断
 * - 今日：尚有 pending（未到 dueAt）/ 未全 taken / 无 due → 不中断但不计入
 * - 今日全 taken 时仅当昨日也全 taken（即延续既有 streak）才计入今日；
 *   若昨日已中断，则今日不单独起 streak（与"昨日漏服则 streak 归零"语义一致）
 */
export function computeStreak(
  dayGroups: readonly HistoryDayGroup[],
  today: LocalDate,
  now: number = Date.now(),
): number {
  const byDate = new Map(dayGroups.map((g) => [g.date, g.items] as const));
  let streak = 0;
  let cursor = today;
  let todayFullyTaken = false;
  for (let guard = 0; guard < HISTORY_EDIT_WINDOW_DAYS; guard += 1) {
    const items = byDate.get(cursor);
    const isToday = cursor === today;
    if (!items || items.length === 0) {
      // 当日无应服安排：仅当 cursor 仍为 today 时跳过（不计入也不中断），否则中断
      if (isToday) {
        cursor = addLocalDays(cursor, -1);
        continue;
      }
      break;
    }
    const dueItems = items.filter((item) => item.occurrence.dueAt <= now);
    if (dueItems.length === 0) {
      // 全是未来 due（仅 today 可能出现）
      if (isToday) {
        cursor = addLocalDays(cursor, -1);
        continue;
      }
      break;
    }
    const allTaken = dueItems.every((item) => item.status === 'taken');
    if (!allTaken) {
      // today 未完成不中断也不计入；其他日期未完成则中断
      if (isToday) {
        cursor = addLocalDays(cursor, -1);
        continue;
      }
      break;
    }
    if (isToday) {
      // 今日全 taken：暂不计入，先回溯昨日；若昨日也计入 streak，则循环结束后补计今日
      todayFullyTaken = true;
    } else {
      streak += 1;
    }
    cursor = addLocalDays(cursor, -1);
  }
  // 今日全 taken 且昨日延续 streak（streak > 0）时，今日也计入
  if (todayFullyTaken && streak > 0) streak += 1;
  return streak;
}

/** 区间整体依从性汇总（基于过滤前的全量 occurrences） */
export function summarizeHistory(
  occurrences: readonly MedicationOccurrence[],
  logs: readonly IntakeLog[],
  now: number = Date.now(),
): AdherenceSummary {
  return calculateAdherence(occurrences, logs, now);
}

// ---- P2 编辑能力：操作 sheet + setOccurrenceAction 集成 ----

/** 历史明细行可执行的操作（"清除"对应 setOccurrenceAction(undefined)） */
export type HistoryAction = 'taken' | 'skipped' | 'clear';

/** 操作 sheet 单个选项的可视化与禁用状态 */
export interface HistoryActionOption {
  action: HistoryAction;
  label: string;
  tone: 'primary' | 'secondary' | 'danger';
  disabled: boolean;
}

/**
 * 根据当前 log 决定每个操作的禁用态：
 * - 已 taken → 禁用"标记已服"（已经是该状态）
 * - 已 skipped → 禁用"标记跳过"（已经是该状态）
 * - 无 log（pending / missed）→ 禁用"清除记录"（没有记录可清）
 */
export function getActionSheetOptions(currentLog: IntakeLog | undefined): HistoryActionOption[] {
  const isTaken = currentLog?.status === 'taken';
  const isSkipped = currentLog?.status === 'skipped';
  const hasLog = !!currentLog;
  return [
    { action: 'taken', label: '标记已服', tone: 'primary', disabled: isTaken },
    { action: 'skipped', label: '标记跳过', tone: 'secondary', disabled: isSkipped },
    { action: 'clear', label: '清除记录', tone: 'danger', disabled: !hasLog },
  ];
}

/**
 * 把 HistoryAction 映射为 setOccurrenceAction 接受的 IntakeAction | undefined。
 * 'clear' → undefined（删除既有 log）
 */
export function historyActionToIntake(action: HistoryAction): IntakeAction | undefined {
  return action === 'taken' ? 'taken' : action === 'skipped' ? 'skipped' : undefined;
}

/** 操作成功的反馈文案 */
export function historyActionSuccessMessage(action: HistoryAction): string {
  switch (action) {
    case 'taken': return '已记录为已服';
    case 'skipped': return '已记录为跳过';
    case 'clear': return '已清除记录';
  }
}

/** 操作依赖（注入便于单测） */
export interface HistoryActionDeps {
  setOccurrenceAction: (occurrence: MedicationOccurrence, action: IntakeAction | undefined) => Promise<IntakeMutationResult>;
  toast: (msg: string) => void;
  onRefresh: () => Promise<void>;
}

/**
 * 执行历史明细行的操作：
 * - 成功 → toast 反馈并触发 onRefresh 局部刷新（保留筛选/滚动由 onRefresh 负责）
 * - MedicationIntakeError（expired / insufficient-inventory / dose-review-required / medication-not-found）→ toast 错误信息，不刷新
 * - 其他未知错误 → 向上抛出
 * 返回值：{ ok: true } 或 { ok: false, error }，方便调用方决定后续 UI 行为
 */
export async function performHistoryAction(
  occurrence: MedicationOccurrence,
  action: HistoryAction,
  deps: HistoryActionDeps,
): Promise<{ ok: true } | { ok: false; error: MedicationIntakeError }> {
  const intakeAction = historyActionToIntake(action);
  try {
    const result = await deps.setOccurrenceAction(occurrence, intakeAction);
    deps.toast(historyActionSuccessMessage(action));
    // 库存低时附带提醒（与 Today.ts 行为一致）
    if (result.lowStock && result.lowStockMessage) {
      deps.toast(result.lowStockMessage);
    }
    await deps.onRefresh();
    return { ok: true };
  } catch (error) {
    if (error instanceof MedicationIntakeError) {
      deps.toast(error.message);
      return { ok: false, error };
    }
    throw error;
  }
}

/** 加载历史页所需数据：并发查 meds / revisions / logs，组装 occurrences 与 dayGroups */
export async function loadHistoryData(
  state: HistoryState,
  today: LocalDate = toLocalDate(),
  now: number = Date.now(),
): Promise<HistoryData> {
  const bounds = computeRangeBounds(state, today);
  const rangeStartMs = localDayBounds(bounds.start).start;
  const rangeEndMs = localDayBounds(bounds.end).end;
  const [meds, revisions, logs] = await Promise.all([
    listMeds(),
    listScheduleRevisions(),
    listLogsByRange(rangeStartMs, rangeEndMs),
  ]);
  const medById = new Map(meds.map((med) => [med.id, med] as const));
  const occurrences = generateOccurrences(revisions, bounds.start, bounds.end).filter(
    (occurrence) => medById.has(occurrence.medId),
  );
  const dayGroups = groupOccurrencesByDate(occurrences, logs, medById, now);
  return { medById, revisions, logs, occurrences, dayGroups };
}

// ---- P1 UI 渲染 ----

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const FILTER_DEBOUNCE_MS = 200;

/** "X 月 X 日 周X" */
function formatDayTitle(date: LocalDate): string {
  const [, month, day] = date.split('-');
  const dow = WEEKDAY_CN[localDateDayOfWeek(date)];
  return `${Number(month)} 月 ${Number(day)} 日 ${dow}`;
}

/** occurrence.localDate 距 today 是否仍在 90 天编辑窗口内 */
function isWithinEditWindow(localDate: LocalDate, today: LocalDate): boolean {
  return calendarDaysBetween(localDate, today) < HISTORY_EDIT_WINDOW_DAYS;
}

/** 区间 chip 组（7 天 / 30 天 / 90 天 / 自定义） */
function renderRangeChips(state: HistoryState, onChange: (next: HistoryState) => void): HTMLElement {
  const wrap = el('div', { class: 'history-range-bar' });
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', '时间区间');
  const options: Array<{ value: RangePreset; label: string }> = [
    { value: '7d', label: '7 天' },
    { value: '30d', label: '30 天' },
    { value: '90d', label: '90 天' },
    { value: 'custom', label: '自定义' },
  ];
  const control = createSegmentedControl('时间区间', options, state.rangePreset, (value) => {
    onChange({ ...state, rangePreset: value });
  });
  wrap.append(control);
  return wrap;
}

/** 自定义区间两个 date input；仅在 rangePreset='custom' 时显示 */
function renderCustomRangeInputs(
  state: HistoryState,
  today: LocalDate,
  onChange: (next: HistoryState) => void,
): HTMLElement {
  const wrap = el('div', { class: 'history-custom-range' });
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', '自定义时间区间');
  const minDate = addLocalDays(today, -(HISTORY_EDIT_WINDOW_DAYS - 1));
  const startDate = state.customStart ?? addLocalDays(today, -29);
  const endDate = state.customEnd ?? today;

  const startInput = el('input', {
    type: 'date',
    class: 'history-date-input',
    'aria-label': '开始日期',
  } as any) as HTMLInputElement;
  startInput.value = startDate;
  startInput.min = minDate;
  startInput.max = endDate;

  const endInput = el('input', {
    type: 'date',
    class: 'history-date-input',
    'aria-label': '结束日期',
  } as any) as HTMLInputElement;
  endInput.value = endDate;
  endInput.min = startDate;
  endInput.max = today;

  let debounce: number | undefined;
  const fire = (next: HistoryState) => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => onChange(next), FILTER_DEBOUNCE_MS);
  };

  startInput.addEventListener('change', () => {
    const v = startInput.value;
    if (!v) return;
    endInput.min = v;
    fire({ ...state, customStart: v as LocalDate, customEnd: endInput.value as LocalDate });
  });
  endInput.addEventListener('change', () => {
    const v = endInput.value;
    if (!v) return;
    startInput.max = v;
    fire({ ...state, customStart: startInput.value as LocalDate, customEnd: v as LocalDate });
  });

  wrap.append(
    startInput,
    el('span', { class: 'history-custom-range-sep', text: '至', 'aria-hidden': 'true' } as any),
    endInput,
  );
  return wrap;
}

/** 区间汇总卡片：进度环 + 4 个 metric + 连续服药天数徽章 */
function renderSummaryCard(
  data: HistoryData,
  streak: number,
  now: number,
): HTMLElement {
  const card = el('section', { class: 'history-summary card' });
  card.setAttribute('aria-label', '区间汇总');
  const summary = summarizeHistory(data.occurrences, data.logs, now);

  if (summary.due === 0) {
    card.append(el('div', { class: 'history-summary-empty muted', text: '区间内没有已到期的服药安排' }));
    return card;
  }

  const left = el('div', { class: 'history-summary-progress' });
  const adherencePct = Math.round(summary.adherenceRate * 100);
  const ring = progressRing(summary.taken, summary.due);
  ring.querySelector('.ring-value')?.replaceWith(
    el('span', { class: 'ring-value', text: `${adherencePct}%` }),
  );
  ring.querySelector('.ring-caption')?.replaceWith(
    el('span', { class: 'ring-caption', text: '按时服药' }),
  );
  left.append(ring);
  left.append(el('div', { class: 'history-summary-caption', text: `按时服药 ${adherencePct}%` }));

  const right = el('div', { class: 'history-summary-stats' });
  right.setAttribute('role', 'list');
  const handledPct = Math.round(summary.handledRate * 100);
  right.append(summaryMetric('已服', `${summary.taken}/${summary.due}`, 'success'));
  right.append(summaryMetric('跳过', String(summary.skipped), summary.skipped > 0 ? 'warning' : 'muted'));
  right.append(summaryMetric('漏服', String(summary.missed), summary.missed > 0 ? 'danger' : 'muted'));
  right.append(summaryMetric('已处理', `${handledPct}%`, 'info'));

  card.append(left, right);

  if (streak > 0) {
    const badgeWrap = el('div', { class: 'history-summary-streak' });
    badgeWrap.append(createStatusBadge(`连续服药 ${streak} 天`, 'success'));
    card.append(badgeWrap);
  }
  return card;
}

function summaryMetric(
  label: string,
  value: string,
  tone: 'success' | 'warning' | 'danger' | 'info' | 'muted',
): HTMLElement {
  const metric = el('div', { class: 'history-summary-stat', role: 'listitem' } as any);
  metric.append(el('span', { class: 'history-summary-stat-label', text: label }));
  const valueNode = el('strong', { class: 'history-summary-stat-value', text: value });
  valueNode.append(createStatusBadge('', tone));
  valueNode.lastElementChild?.setAttribute('aria-hidden', 'true');
  metric.append(valueNode);
  return metric;
}

/** 筛选条：药品 / 时段 / 状态 三个 select，带 200ms 防抖 */
function renderFilterBar(
  meds: readonly Medication[],
  state: HistoryState,
  onChange: (next: HistoryState) => void,
): HTMLElement {
  const wrap = el('div', { class: 'history-filter-bar' });
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', '筛选条件');
  let debounce: number | undefined;
  const fire = (next: HistoryState) => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => onChange(next), FILTER_DEBOUNCE_MS);
  };

  // 药品下拉
  const medSelect = el('select', {
    class: 'history-filter-select',
    'aria-label': '按药品筛选',
  } as any) as HTMLSelectElement;
  medSelect.append(el('option', { value: 'all', text: '全部药品' } as any) as HTMLOptionElement);
  for (const med of meds) {
    medSelect.append(el('option', { value: med.id, text: med.name } as any) as HTMLOptionElement);
  }
  medSelect.value = state.filterMed;
  medSelect.addEventListener('change', () => {
    fire({ ...state, filterMed: medSelect.value });
  });

  // 时段下拉
  const slotSelect = el('select', {
    class: 'history-filter-select',
    'aria-label': '按时段筛选',
  } as any) as HTMLSelectElement;
  slotSelect.append(el('option', { value: 'all', text: '全部时段' } as any) as HTMLOptionElement);
  for (const slot of SLOTS) {
    slotSelect.append(el('option', { value: slot, text: SLOT_LABEL[slot] } as any) as HTMLOptionElement);
  }
  slotSelect.value = state.filterSlot;
  slotSelect.addEventListener('change', () => {
    fire({ ...state, filterSlot: slotSelect.value as 'all' | Slot });
  });

  // 状态下拉
  const statusSelect = el('select', {
    class: 'history-filter-select',
    'aria-label': '按状态筛选',
  } as any) as HTMLSelectElement;
  const statusOptions: Array<{ value: 'all' | 'taken' | 'skipped' | 'missed'; label: string }> = [
    { value: 'all', label: '全部状态' },
    { value: 'taken', label: '已服' },
    { value: 'skipped', label: '已跳过' },
    { value: 'missed', label: '漏服' },
  ];
  for (const opt of statusOptions) {
    statusSelect.append(el('option', { value: opt.value, text: opt.label } as any) as HTMLOptionElement);
  }
  statusSelect.value = state.filterStatus;
  statusSelect.addEventListener('change', () => {
    fire({ ...state, filterStatus: statusSelect.value as 'all' | 'taken' | 'skipped' | 'missed' });
  });

  wrap.append(medSelect, slotSelect, statusSelect);
  return wrap;
}

/** 在 dayGroups 上应用筛选条件；过滤后空日卡片被剔除 */
function applyFilters(
  dayGroups: readonly HistoryDayGroup[],
  state: HistoryState,
): HistoryDayGroup[] {
  const result: HistoryDayGroup[] = [];
  for (const group of dayGroups) {
    const items = group.items.filter((item) => {
      if (state.filterMed !== 'all' && item.med.id !== state.filterMed) return false;
      if (state.filterSlot !== 'all' && item.occurrence.slot !== state.filterSlot) return false;
      if (state.filterStatus !== 'all' && item.status !== state.filterStatus) return false;
      return true;
    });
    if (items.length > 0) result.push({ date: group.date, items });
  }
  return result;
}

/**
 * 历史明细行操作 sheet（基于 openDialog 实现：自带焦点陷阱、Escape 关闭、焦点归还）。
 * 选项根据 currentLog 智能禁用；选择后回调 onSelect 并关闭 sheet。
 */
export function openHistoryActionSheet(
  occurrence: MedicationOccurrence,
  med: Medication,
  currentLog: IntakeLog | undefined,
  onSelect: (action: HistoryAction) => void,
): HTMLElement {
  const titleId = 'history-action-sheet-title';
  const card = el('div', { class: 'card history-action-sheet' });

  const title = el('div', { class: 'history-action-sheet-title', id: titleId });
  title.append(el('div', { class: 'history-action-sheet-med', text: med.name }));
  const subParts = [
    SLOT_LABEL[occurrence.slot],
    occurrence.timeLocal,
    formatMealRels([...occurrence.mealRels]),
  ].filter(Boolean);
  if (subParts.length > 0) {
    title.append(el('div', { class: 'history-action-sheet-sub muted', text: subParts.join(' · ') }));
  }
  card.append(title);

  const options = el('div', { class: 'history-action-sheet-options' });
  options.setAttribute('role', 'list');
  for (const opt of getActionSheetOptions(currentLog)) {
    const btn = el('button', {
      class: `btn history-action-sheet-option tone-${opt.tone}${opt.disabled ? ' is-disabled' : ''}`,
      type: 'button',
      text: opt.label,
      'aria-label': opt.label,
    } as any) as HTMLButtonElement;
    btn.disabled = opt.disabled;
    if (opt.disabled) {
      btn.setAttribute('aria-disabled', 'true');
    }
    options.append(btn);
  }
  card.append(options);

  const cancel = el('button', {
    class: 'btn text history-action-sheet-cancel',
    type: 'button',
    text: '取消',
    'aria-label': '取消',
  } as any);
  card.append(cancel);

  let overlay: HTMLElement | null = null;
  const close = () => {
    if (overlay) {
      const toClose = overlay;
      overlay = null;
      closeDialog(toClose);
    }
  };

  // 绑定选项点击：通过 index 映射回 action
  const optionButtons = options.querySelectorAll<HTMLButtonElement>('.history-action-sheet-option');
  optionButtons.forEach((btn, idx) => {
    const opt = getActionSheetOptions(currentLog)[idx];
    if (!opt || btn.disabled) return;
    btn.onclick = () => {
      close();
      onSelect(opt.action);
    };
  });
  cancel.onclick = close;

  overlay = openDialog(card, { labelId: titleId });
  overlay.classList.add('history-action-sheet-overlay');
  return overlay;
}

/** 日卡片：日期标题 + 当日小环 + 按 slot 分组的明细行 */
function renderDayCard(
  group: HistoryDayGroup,
  today: LocalDate,
  now: number,
  photoUrls: ReadonlyMap<string, string>,
  onItemActivate: (item: HistoryDayItem) => void,
): HTMLElement {
  const card = el('section', { class: 'history-day-card' });
  const isToday = group.date === today;
  if (isToday) card.classList.add('is-today');

  const head = el('div', { class: 'history-day-head' });
  head.append(el('h2', { class: 'history-day-title', text: formatDayTitle(group.date) }));
  const dueItems = group.items.filter((item) => item.occurrence.dueAt <= now);
  const takenItems = dueItems.filter((item) => item.status === 'taken');
  const dayRing = progressRing(takenItems.length, dueItems.length);
  dayRing.classList.add('history-day-ring');
  head.append(dayRing);
  card.append(head);

  // 按 slot 分组
  const bySlot = new Map<Slot, HistoryDayItem[]>();
  for (const item of group.items) {
    const list = bySlot.get(item.occurrence.slot) ?? [];
    list.push(item);
    bySlot.set(item.occurrence.slot, list);
  }
  for (const slot of SLOTS) {
    const items = bySlot.get(slot);
    if (!items || items.length === 0) continue;
    const slotGroup = el('div', { class: 'history-slot-group' });
    slotGroup.append(slotTag(slot));
    const list = el('div', { class: 'history-medication-list' });
    for (const item of items) {
      list.append(renderDayItem(item, today, photoUrls, onItemActivate));
    }
    slotGroup.append(list);
    card.append(slotGroup);
  }
  return card;
}

/** 单条明细行：缩略图 / 药名 / 时间·用量·餐前·餐中·餐后 / 状态徽章 */
function renderDayItem(
  item: HistoryDayItem,
  today: LocalDate,
  photoUrls: ReadonlyMap<string, string>,
  onItemActivate: (item: HistoryDayItem) => void,
): HTMLElement {
  const { occurrence, med, status, log } = item;
  const readonly = !isWithinEditWindow(occurrence.localDate, today);
  const line = el('article', {
    class: `history-medication-row history-medication-${status}${readonly ? ' is-readonly' : ''}${status === 'missed' ? ' is-missed' : ''}`,
  });
  line.dataset.occurrenceId = occurrence.id;
  if (readonly) {
    line.title = '超过 90 天的记录不可编辑';
    line.setAttribute('aria-disabled', 'true');
  } else {
    line.setAttribute('tabindex', '0');
    line.setAttribute('role', 'button');
    line.setAttribute(
      'aria-label',
      `${formatDayTitle(occurrence.localDate)} ${SLOT_LABEL[occurrence.slot]} ${occurrence.timeLocal} ${med.name} ${statusLabel(status)}`,
    );
    const activate = () => onItemActivate(item);
    line.addEventListener('click', activate);
    line.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
    });
  }

  // 缩略图（认盒不认字；没照片时用淡紫药丸占位）
  const photoUrl = photoUrls.get(med.id);
  const thumb = el('span', {
    class: 'history-medication-thumb' + (photoUrl ? '' : ' is-placeholder'),
    'aria-hidden': 'true',
  } as any);
  if (photoUrl) {
    const img = el('img', { alt: '', loading: 'lazy', decoding: 'async' } as any) as HTMLImageElement;
    img.src = photoUrl;
    thumb.append(img);
  } else {
    thumb.append(icon('pill'));
  }
  line.append(thumb);

  const copy = el('div', { class: 'history-medication-copy' });
  copy.append(el('div', { class: 'history-medication-name', text: med.name }));
  const structuredDose = occurrence.doseQuantity && occurrence.doseUnit
    ? `${occurrence.doseQuantity}${occurrence.doseUnit}`
    : med.amountPerDose;
  const details = [
    occurrence.timeLocal,
    structuredDose,
    formatMealRels([...occurrence.mealRels]),
  ].filter(Boolean).join(' · ');
  if (details) copy.append(el('div', { class: 'history-medication-meta', text: details }));
  line.append(copy);

  const statusWrap = el('div', { class: 'history-medication-status' });
  statusWrap.append(createStatusBadge(statusLabel(status), statusTone(status)));
  if (log?.ackAt) {
    const ackTime = new Date(log.ackAt);
    const hh = String(ackTime.getHours()).padStart(2, '0');
    const mm = String(ackTime.getMinutes()).padStart(2, '0');
    statusWrap.append(el('span', { class: 'history-medication-ack muted', text: `${hh}:${mm}` }));
  }
  line.append(statusWrap);
  return line;
}

function statusLabel(status: HistoryItemStatus): string {
  switch (status) {
    case 'taken': return '已服';
    case 'skipped': return '已跳过';
    case 'missed': return '漏服';
    case 'pending': return '待服';
  }
}

function statusTone(status: HistoryItemStatus): 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'taken': return 'success';
    case 'skipped': return 'warning';
    case 'missed': return 'danger';
    case 'pending': return 'info';
  }
}

export async function renderMedHistoryPage(root: HTMLElement, signal?: AbortSignal): Promise<void> {
  const today = toLocalDate();
  const now = Date.now();
  let state: HistoryState = { ...DEFAULT_HISTORY_STATE };

  // 闭包内重渲染：保留滚动位置（DOM 替换会自然丢失，但 content 容器位置不变时浏览器会保持视口）
  const content = el('div', { class: 'page history-page' });
  content.setAttribute('aria-label', '服药历史');

  const back = el('button', {
    class: 'icon-btn',
    type: 'button',
    'aria-label': '返回今日页',
  } as any);
  back.append(icon('arrow-left'));
  back.onclick = () => navigate('/today');

  // 先渲染外壳，再异步填充内容
  renderPage({
    root,
    title: '服药历史',
    activeTab: 'today',
    topLeft: back,
    content,
  });

  if (signal?.aborted) return;

  // 区间 chip 始终显示；其下方根据 state.rangePreset 决定是否显示自定义日期
  const rangeBar = renderRangeChips(state, (next) => { state = next; void rerender(); });
  content.append(rangeBar);

  const customWrap = el('div', { class: 'history-custom-wrap' });
  content.append(customWrap);

  const filterHost = el('div', { class: 'history-filter-host' });
  content.append(filterHost);

  const listHost = el('div', { class: 'history-list-host' });
  content.append(listHost);

  // 判断是否需要骨架（90 天或自定义跨度 > 30 天）
  function needsSkeleton(s: HistoryState): boolean {
    if (s.rangePreset === '90d') return true;
    if (s.rangePreset === 'custom' && s.customStart && s.customEnd) {
      return calendarDaysBetween(s.customStart, s.customEnd) > 30;
    }
    return false;
  }

  async function rerender(preserveScroll = false): Promise<void> {
    if (signal?.aborted) return;

    // 保留滚动位置：DOM 替换后浏览器可能跳顶，编辑后局部刷新时需要还原
    const savedScrollY = preserveScroll ? window.scrollY : 0;

    // 更新区间 chip 选中态
    rangeBar.querySelectorAll('button').forEach((btn) => {
      const label = btn.textContent ?? '';
      const preset = label === '7 天' ? '7d'
        : label === '30 天' ? '30d'
        : label === '90 天' ? '90d'
        : 'custom';
      btn.classList.toggle('is-selected', preset === state.rangePreset);
      btn.setAttribute('aria-pressed', String(preset === state.rangePreset));
    });

    // 自定义区间输入
    customWrap.replaceChildren();
    if (state.rangePreset === 'custom') {
      customWrap.append(renderCustomRangeInputs(state, today, (next) => { state = next; void rerender(); }));
    }

    // 骨架占位
    filterHost.replaceChildren();
    listHost.replaceChildren();
    if (needsSkeleton(state)) {
      for (let i = 0; i < 5; i += 1) listHost.append(skeletonCard());
    } else {
      listHost.append(el('div', { class: 'card history-loading', text: '加载中…' }));
    }

    // 加载数据
    let data: HistoryData;
    try {
      data = await loadHistoryData(state, today, now);
    } catch (error) {
      if (signal?.aborted) return;
      listHost.replaceChildren();
      listHost.append(banner('warn', error instanceof Error ? error.message : String(error)));
      return;
    }
    if (signal?.aborted) return;

    // 筛选条（需要 meds 列表）
    filterHost.replaceChildren();
    const medList = Array.from(data.medById.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    filterHost.append(renderFilterBar(medList, state, (next) => { state = next; void rerender(); }));

    // 汇总卡片（基于全量 occurrences，不受筛选影响）
    listHost.replaceChildren();
    const streak = computeStreak(data.dayGroups, today, now);
    listHost.append(renderSummaryCard(data, streak, now));

    // 应用筛选后的日卡片列表
    const filtered = applyFilters(data.dayGroups, state);
    if (filtered.length === 0) {
      listHost.append(banner('info', '该区间内没有符合条件的记录'));
      if (preserveScroll) window.scrollTo(0, savedScrollY);
      return;
    }

    // 预加载药盒缩略图（按筛选用到的 medId）
    const medIds = new Set<string>();
    for (const group of filtered) {
      for (const item of group.items) medIds.add(item.med.id);
    }
    const photoUrls = await getMedPhotoUrls([...medIds]);
    if (signal?.aborted) return;

    for (const group of filtered) {
      listHost.append(renderDayCard(group, today, now, photoUrls, handleItemActivate));
    }

    if (preserveScroll) window.scrollTo(0, savedScrollY);
  }

  /**
   * 明细行激活（点击 / Enter / Space）→ 打开操作 sheet → 选择后调用 setOccurrenceAction → 局部刷新（保留滚动与筛选状态）
   * 超过 90 天的只读行不会绑定此处理器（renderDayItem 已跳过）
   */
  function handleItemActivate(item: HistoryDayItem): void {
    if (signal?.aborted) return;
    openHistoryActionSheet(item.occurrence, item.med, item.log, (action) => {
      void performHistoryAction(item.occurrence, action, {
        setOccurrenceAction,
        toast,
        onRefresh: () => rerender(true),
      });
    });
  }

  await rerender();
}

// ---- 内部小工具 ----

function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function calendarDaysBetween(start: LocalDate, end: LocalDate): number {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const sUtc = Date.UTC(sy, sm - 1, sd);
  const eUtc = Date.UTC(ey, em - 1, ed);
  return Math.round((eUtc - sUtc) / 86_400_000);
}
