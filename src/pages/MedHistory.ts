// 服药历史页面：回看任意区间的服药情况，并支持 90 天内补记 / 更正
import {
  listLogsByRange,
  listMeds,
  listScheduleRevisions,
} from '../db/local';
import {
  type IntakeLog,
  type LocalDate,
  type Medication,
  type MedicationOccurrence,
  type MedicationScheduleRevision,
  type Slot,
} from '../db/schema';
import {
  addLocalDays,
  calculateAdherence,
  findLogForOccurrence,
  generateOccurrences,
  localDayBounds,
  toLocalDate,
  type AdherenceSummary,
} from '../domain/medicationSchedule';
import { el, icon, renderPage } from '../ui/components';
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

export async function renderMedHistoryPage(root: HTMLElement, signal?: AbortSignal): Promise<void> {
  // P0 阶段：先验证路由 + 数据加载能跑通；UI 在 P1 阶段补齐
  const today = toLocalDate();
  let data: HistoryData | null = null;
  let loadError: string | null = null;
  try {
    data = await loadHistoryData(DEFAULT_HISTORY_STATE, today);
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
  }
  if (signal?.aborted) return;

  const content = el('div', { class: 'page history-page' });
  content.setAttribute('aria-label', '服药历史');
  if (loadError) {
    content.append(el('div', { class: 'card', text: `加载失败：${loadError}` }));
  } else if (data) {
    const summary = summarizeHistory(data.occurrences, data.logs);
    content.append(
      el('div', {
        class: 'card history-placeholder',
        text:
          `服药历史（P0 骨架）\n` +
          `区间：${DEFAULT_HISTORY_STATE.rangePreset}\n` +
          `药品：${data.medById.size} 种\n` +
          `occurrences：${data.occurrences.length} 条\n` +
          `logs：${data.logs.length} 条\n` +
          `日卡片：${data.dayGroups.length} 天\n` +
          `按时服药：${summary.taken}/${summary.due}，跳过 ${summary.skipped}，漏服 ${summary.missed}`,
      }),
    );
  } else {
    content.append(el('div', { class: 'card', text: '加载中…' }));
  }

  const back = el('button', {
    class: 'icon-btn',
    type: 'button',
    'aria-label': '返回今日页',
  } as any);
  back.append(icon('arrow-left'));
  back.onclick = () => navigate('/today');

  renderPage({
    root,
    title: '服药历史',
    activeTab: 'today',
    topLeft: back,
    content,
  });
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
