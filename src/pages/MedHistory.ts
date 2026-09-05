import '../ui/styles/pages/med-history.css';
import {
  listLogsByRange,
  listMeds,
  listScheduleRevisions,
  setOccurrenceAction,
  MedicationIntakeError,
  type IntakeMutationResult,
} from '../db/local';
import {
  type LocalDate,
  type IntakeLog,
  type Medication,
  type MedicationOccurrence,
  type Slot,
  SLOT_LABEL,
  formatMealRels,
} from '../db/schema';

export type IntakeAction = 'taken' | 'skipped';
import {
  addLocalDays,
  calculateAdherence,
  findLogForOccurrence,
  generateOccurrences,
  localDayBounds,
  toLocalDate,
} from '../domain/medicationSchedule';
import {
  el,
  icon,
  renderPage,
  toast,
  banner,
  animateCountUp,
} from '../ui/components';

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

function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function calendarDaysBetween(start: LocalDate, end: LocalDate): number {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  const sUtc = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const eUtc = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  return Math.round((eUtc - sUtc) / 86_400_000);
}

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
    if (!med) continue;
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
      if (isToday) {
        cursor = addLocalDays(cursor, -1);
        continue;
      }
      break;
    }
    const dueItems = items.filter((item) => item.occurrence.dueAt <= now);
    if (dueItems.length === 0) {
      if (isToday) {
        cursor = addLocalDays(cursor, -1);
        continue;
      }
      break;
    }
    const allTaken = dueItems.every((item) => item.status === 'taken');
    if (!allTaken) {
      if (isToday) {
        cursor = addLocalDays(cursor, -1);
        continue;
      }
      break;
    }
    if (isToday) {
      todayFullyTaken = true;
    } else {
      streak += 1;
    }
    cursor = addLocalDays(cursor, -1);
  }
  if (todayFullyTaken && streak > 0) streak += 1;
  return streak;
}

export type HistoryAction = 'taken' | 'skipped' | 'clear';

export function getActionSheetOptions(currentLog: IntakeLog | undefined): Array<{ action: HistoryAction; label: string; tone: 'primary' | 'secondary' | 'danger'; disabled: boolean }> {
  return [
    { action: 'taken', label: '标记已服', tone: 'primary', disabled: currentLog?.status === 'taken' },
    { action: 'skipped', label: '标记跳过', tone: 'secondary', disabled: currentLog?.status === 'skipped' },
    { action: 'clear', label: '清除记录', tone: 'danger', disabled: !currentLog || (currentLog.status !== 'taken' && currentLog.status !== 'skipped') },
  ];
}

export function historyActionToIntake(action: HistoryAction): IntakeAction | undefined {
  if (action === 'taken') return 'taken';
  if (action === 'skipped') return 'skipped';
  return undefined;
}

export function historyActionSuccessMessage(action: HistoryAction): string {
  switch (action) {
    case 'taken': return '已记录为已服';
    case 'skipped': return '已记录为跳过';
    case 'clear': return '已清除记录';
  }
}

export interface HistoryActionDeps {
  setOccurrenceAction: (occurrence: MedicationOccurrence, action: IntakeAction | undefined) => Promise<IntakeMutationResult>;
  toast: (msg: string) => void;
  onRefresh: () => Promise<void>;
}

export async function performHistoryAction(
  occurrence: MedicationOccurrence,
  action: HistoryAction,
  deps: HistoryActionDeps,
): Promise<{ ok: true } | { ok: false; error: MedicationIntakeError }> {
  const intakeAction = historyActionToIntake(action);
  try {
    const result = await deps.setOccurrenceAction(occurrence, intakeAction);
    deps.toast(historyActionSuccessMessage(action));
    if (result?.lowStock && result?.lowStockMessage) {
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

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1; // 1-12
let selectedDate: LocalDate = toLocalDate(new Date());

export async function renderMedHistoryPage(root: HTMLElement, signal?: AbortSignal): Promise<void> {
  const today = toLocalDate(new Date());
  const monthStart: LocalDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01` as LocalDate;
  const lastDay = new Date(currentYear, currentMonth, 0).getDate();
  const monthEnd: LocalDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}` as LocalDate;

  if (selectedDate < monthStart || selectedDate > monthEnd) {
    const todayObj = new Date();
    if (currentYear === todayObj.getFullYear() && currentMonth === todayObj.getMonth() + 1) {
      selectedDate = today;
    } else {
      selectedDate = monthStart;
    }
  }

  const { start } = localDayBounds(monthStart);
  const { end } = localDayBounds(monthEnd);

  const streakStart = addLocalDays(today, -89);
  const { start: streakLogStart } = localDayBounds(streakStart);
  const { end: streakLogEnd } = localDayBounds(today);

  const queryStart = Math.min(start, streakLogStart);
  const queryEnd = Math.max(end, streakLogEnd);

  const [meds, revisions, logs] = await Promise.all([
    listMeds(),
    listScheduleRevisions(),
    listLogsByRange(queryStart, queryEnd),
  ]);
  if (signal?.aborted) return;
  const medById = new Map(meds.map((m) => [m.id, m]));

  const monthOccurrences = generateOccurrences(revisions, monthStart, monthEnd).filter((o) =>
    medById.has(o.medId)
  );
  const streakOccurrences = generateOccurrences(revisions, streakStart, today).filter((o) =>
    medById.has(o.medId)
  );

  const content = el('div', { class: 'page history-page' });

  // 0. 当月连续服药天数与依从率统计卡片
  const streakDayGroups = groupOccurrencesByDate(streakOccurrences, logs, medById, Date.now());
  const streak = computeStreak(streakDayGroups, today, Date.now());
  const monthAdh = calculateAdherence(monthOccurrences, logs, Date.now());
  const adherencePct = monthAdh.due > 0 ? Math.round(monthAdh.adherenceRate * 100) : 100;

  const statsGrid = el('div', { class: 'history-stats-grid' });
  const streakCard = el('div', { class: 'history-stat-card streak' });
  const streakIcon = el('div', { class: 'history-stat-icon' });
  streakIcon.append(icon('sparkles'));
  const streakInfo = el('div', { class: 'history-stat-info' });
  const streakVal = el('div', { class: 'history-stat-value' });
  const streakNum = el('span', { class: 'history-stat-num', text: String(streak) });
  streakVal.append(
    streakNum,
    el('span', { class: 'history-stat-unit', text: '天' })
  );
  if (streak > 0) {
    animateCountUp(streakNum, streak, 400);
  }
  streakInfo.append(
    el('div', { class: 'history-stat-title', text: '连续服药' }),
    streakVal,
    el('div', { class: 'history-stat-meta', text: streak > 0 ? '保持良好习惯' : '今日待开始' })
  );
  streakCard.append(streakIcon, streakInfo);

  const adhCard = el('div', { class: 'history-stat-card adherence' });
  const adhIcon = el('div', { class: 'history-stat-icon' });
  adhIcon.append(icon('calendar'));
  const adhInfo = el('div', { class: 'history-stat-info' });
  const adhVal = el('div', { class: 'history-stat-value' });
  const adhNum = el('span', { class: 'history-stat-num', text: `${adherencePct}%` });
  adhVal.append(adhNum);
  if (adherencePct > 0) {
    animateCountUp(adhNum, adherencePct, 450, '%');
  }
  adhInfo.append(
    el('div', { class: 'history-stat-title', text: '当月依从率' }),
    adhVal,
    el('div', { class: 'history-stat-meta', text: `应服 ${monthAdh.due} 次 · 已服 ${monthAdh.taken} 次` })
  );
  adhCard.append(adhIcon, adhInfo);
  statsGrid.append(streakCard, adhCard);
  content.append(statsGrid);

  // 1. 日历卡片
  const calCard = el('div', { class: 'calendar-card' });

  // 月份导航
  const monthHeader = el('div', { class: 'calendar-month-header' });
  const prevBtn = el('button', { class: 'calendar-month-btn', type: 'button', text: '<' });
  prevBtn.onclick = () => {
    if (currentMonth === 1) {
      currentYear--;
      currentMonth = 12;
    } else {
      currentMonth--;
    }
    const todayObj = new Date();
    if (currentYear === todayObj.getFullYear() && currentMonth === todayObj.getMonth() + 1) {
      selectedDate = today;
    } else {
      selectedDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01` as LocalDate;
    }
    void renderMedHistoryPage(root, signal);
  };

  const monthTitle = el('div', {
    class: 'calendar-month-title',
    text: `${currentYear}年${currentMonth}月`,
  });

  const nextBtn = el('button', { class: 'calendar-month-btn', type: 'button', text: '>' });
  nextBtn.onclick = () => {
    if (currentMonth === 12) {
      currentYear++;
      currentMonth = 1;
    } else {
      currentMonth++;
    }
    const todayObj = new Date();
    if (currentYear === todayObj.getFullYear() && currentMonth === todayObj.getMonth() + 1) {
      selectedDate = today;
    } else {
      selectedDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01` as LocalDate;
    }
    void renderMedHistoryPage(root, signal);
  };

  monthHeader.append(prevBtn, monthTitle, nextBtn);
  calCard.append(monthHeader);

  // 星期表头
  const weekGrid = el('div', { class: 'calendar-weekdays' });
  ['日', '一', '二', '三', '四', '五', '六'].forEach((d) => {
    weekGrid.append(el('div', { class: 'calendar-week-cell', text: d }));
  });
  calCard.append(weekGrid);

  // 日期网格
  const daysGrid = el('div', { class: 'calendar-grid' });
  const firstDayOfWeek = new Date(currentYear, currentMonth - 1, 1).getDay();

  // 空白占位
  for (let i = 0; i < firstDayOfWeek; i++) {
    daysGrid.append(el('div', { class: 'calendar-cell is-other-month empty' }));
  }

  // 每日数据
  for (let day = 1; day <= lastDay; day++) {
    const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}` as LocalDate;
    const isSelected = dateStr === selectedDate;
    const isToday = dateStr === today;

    const dayCell = el('button', {
      class: `calendar-cell${isSelected ? ' is-selected selected' : ''}${isToday ? ' today is-today' : ''}`,
      type: 'button',
    });

    dayCell.append(el('span', { class: 'calendar-cell-day calendar-day-num', text: String(day) }));

    // 依从性小圆点
    const dayOccs = monthOccurrences.filter((o) => o.localDate === dateStr);
    const dotsWrap = el('div', { class: 'calendar-dots' });
    if (dayOccs.length > 0) {
      const adh = calculateAdherence(dayOccs, logs, Date.now());
      let dotColor = 'gray';
      if (adh.due > 0) {
        if (adh.adherenceRate === 1) dotColor = 'green';
        else if (adh.taken > 0) dotColor = 'orange';
        else if (dateStr < today) dotColor = 'missed';
      }
      dotsWrap.append(el('span', { class: `calendar-dot ${dotColor}` }));
    }
    dayCell.append(dotsWrap);

    dayCell.onclick = () => {
      selectedDate = dateStr;
      void renderMedHistoryPage(root, signal);
    };

    daysGrid.append(dayCell);
  }

  calCard.append(daysGrid);
  content.append(calCard);

  // 2. 选中日期的时间线用药安排
  const planSection = el('div', { class: 'history-plan-section' });
  const selectedOccs = monthOccurrences.filter((o) => o.localDate === selectedDate);

  const planHeader = el('div', { class: 'history-plan-header' });
  planHeader.append(el('h2', { class: 'history-plan-title', text: `${selectedDate} 用药记录` }));
  planSection.append(planHeader);

  if (selectedOccs.length === 0) {
    planSection.append(banner('info', '该日无用药计划'));
  } else {
    for (const occ of selectedOccs) {
      const med = medById.get(occ.medId);
      if (!med) continue;

      const log = findLogForOccurrence(occ, logs);
      const isTaken = log?.status === 'taken';
      const isSkipped = log?.status === 'skipped';
      const isMissed = !log && occ.dueAt < Date.now();
      const statusClass = isTaken ? 'taken' : isSkipped ? 'skipped' : isMissed ? 'missed' : 'pending';
      const statusLabel = isTaken ? '已服' : isSkipped ? '跳过' : isMissed ? '漏服' : '待服';

      const itemCard = el('div', { class: 'history-plan-item' });

      // 时间标识
      const timeBadge = el('div', { class: 'history-plan-time-badge' });
      const rev = revisions.find((r) => r.medId === occ.medId && r.slot === occ.slot);
      const timeStr = rev?.timeLocal || occ.timeLocal || '08:00';
      let actualTimeStr: string | undefined;
      if (log?.ackAt) {
        const d = new Date(log.ackAt);
        actualTimeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      }

      timeBadge.append(
        el('div', { class: 'history-plan-time', text: actualTimeStr || timeStr }),
        el('div', { class: 'history-plan-slot', text: actualTimeStr ? `计划 ${timeStr}` : (SLOT_LABEL[occ.slot] || '用药') })
      );

      const timelineDot = el('div', { class: `history-plan-timeline-dot ${statusClass}` });

      // 药品信息
      const info = el('div', { class: 'history-plan-info' });
      info.append(el('div', { class: 'history-plan-name', text: med.name }));
      const dose = med.amountPerDose || med.dosageText || '1片';
      const meal = formatMealRels([...(occ.mealRels || [])]);
      info.append(el('div', { class: 'history-plan-meta', text: `${dose}${meal ? ' · ' + meal : ''}` }));

      const statusRow = el('div', { class: 'history-plan-status-row' });
      statusRow.append(el('span', { class: `history-status-badge ${statusClass}`, text: statusLabel }));
      if (actualTimeStr) {
        statusRow.append(el('span', { class: 'history-plan-time-compare', text: `实际打卡 ${actualTimeStr} (计划 ${timeStr})` }));
      } else {
        statusRow.append(el('span', { class: 'history-plan-time-compare', text: `计划 ${timeStr} · ${SLOT_LABEL[occ.slot] || '时段'}` }));
      }
      info.append(statusRow);

      // 操作区域 (按钮 + 圆形打卡圈)
      const actionsWrap = el('div', { class: 'history-plan-actions' });
      const actionBtn = el('button', {
        class: `history-plan-action-btn ${statusClass}`,
        type: 'button',
        text: isTaken ? '撤销' : isMissed ? '补卡' : isSkipped ? '补卡' : '打卡',
      });

      const handleAction = async () => {
        try {
          if (isTaken) {
            await setOccurrenceAction(occ, undefined);
            toast('已撤销打卡');
          } else {
            const result = await setOccurrenceAction(occ, 'taken');
            toast(isMissed || isSkipped ? '补卡成功' : '打卡成功');
            if (result?.lowStock && result?.lowStockMessage) {
              toast(result.lowStockMessage);
            }
          }
          void renderMedHistoryPage(root, signal);
        } catch (error) {
          if (error instanceof MedicationIntakeError) {
            toast(error.message);
          } else {
            toast('操作失败');
          }
        }
      };

      actionBtn.onclick = handleAction;

      const radio = el('button', {
        class: `history-radio-circle${isTaken ? ' taken' : ''}`,
        type: 'button',
        'aria-label': isTaken ? '点击撤销打卡' : '点击打卡',
      } as any);
      if (isTaken) {
        radio.append(icon('check'));
      }
      radio.onclick = handleAction;

      actionsWrap.append(actionBtn, radio);
      itemCard.append(timeBadge, timelineDot, info, actionsWrap);
      planSection.append(itemCard);
    }
  }

  content.append(planSection);

  // 顶栏右上角「今天」按钮
  const todayBtn = el('button', {
    class: 'topbar-pill topbar-pill-primary',
    type: 'button',
    text: '今天',
  });
  todayBtn.onclick = () => {
    currentYear = new Date().getFullYear();
    currentMonth = new Date().getMonth() + 1;
    selectedDate = today;
    void renderMedHistoryPage(root, signal);
  };

  const backBtn = el('button', {
    class: 'icon-btn',
    type: 'button',
    'aria-label': '返回',
  } as any);
  backBtn.append(icon('arrow-left'));
  backBtn.onclick = () => history.back();

  if (!signal?.aborted) {
    renderPage({
      root,
      title: '用药日历',
      activeTab: 'today',
      topLeft: backBtn,
      topRight: todayBtn,
      content,
    });
  }
}
