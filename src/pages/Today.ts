import {
  listMeds,
  listLogsByDay,
  listLogsByRange,
  listScheduleRevisions,
  setOccurrenceAction,
  MedicationIntakeError,
  type IntakeAction,
} from '../db/local';
import {
  formatMealRels,
  type IntakeLog,
  type Medication,
  type MedicationOccurrence,
  type MedicationScheduleRevision,
  type Slot,
  type StructuredDose,
} from '../db/schema';
import {
  addLocalDays,
  calculateAdherence,
  findLogForOccurrence,
  generateOccurrences,
  isMedicationExpiredOn,
  isOccurrenceEligible,
  localDayBounds,
  projectScheduleDate,
  toLocalDate,
  type ScheduleDayProjection,
} from '../domain/medicationSchedule';
import {
  el,
  renderPage,
  toast,
  icon,
  progressRing,
  slotTag,
  badge,
  banner,
  confirmDialog,
} from '../ui/components';
import { closeNotificationsByTag } from '../features/notifier';
import {
  getConfirmedDose,
  suggestStructuredDose,
} from '../features/inventory';
import { sendLowStockReminderIfDue } from '../features/inventoryReminder';
import { checkInteractions, type DrugInteraction } from '../data/drugInteractions';

const EARLY_TAKE_WINDOW_MS = 20 * 60 * 1000;

interface TodayItem {
  revision: MedicationScheduleRevision;
  med: Medication;
  dueAt: number;
  occurrence?: MedicationOccurrence;
  log?: IntakeLog;
  isRest: boolean;
}

interface SlotGroup {
  slot: Slot;
  items: TodayItem[];
  earliest: number;
  earliestTime: string;
}

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export async function renderTodayPage(root: HTMLElement, signal?: AbortSignal): Promise<void> {
  const now = new Date();
  const today = toLocalDate(now);
  const { start, end } = localDayBounds(today);
  const [meds, revisions, logs] = await Promise.all([
    listMeds(),
    listScheduleRevisions(),
    listLogsByDay(start, end),
  ]);
  if (signal?.aborted) return;
  const medById = new Map(meds.map((med) => [med.id, med]));
  const projections = projectScheduleDate(revisions, today);
  const items = projections.flatMap((projection) => {
    const med = medById.get(projection.revision.medId);
    if (!med) return [];
    return [toTodayItem(projection, med, logs)];
  });

  const weekStartDate = addLocalDays(today, -6);
  const weekOccurrences = generateOccurrences(revisions, weekStartDate, today).filter((occurrence) =>
    medById.has(occurrence.medId),
  );
  const weekBounds = localDayBounds(weekStartDate);
  let weekLogs: IntakeLog[] = [];
  try {
    weekLogs = await listLogsByRange(weekBounds.start, end);
  } catch {
    weekLogs = [];
  }
  if (signal?.aborted) return;

  const content = el('div', { class: 'page' });
  const activeItems = items.filter((item) => !item.isRest && item.occurrence);
  const total = activeItems.length;
  const taken = activeItems.filter((item) => item.log?.status === 'taken').length;
  const skipped = activeItems.filter((item) => item.log?.status === 'skipped').length;
  const pending = total - taken - skipped;
  const restCount = items.length - activeItems.length;
  const dateStr = `${now.getMonth() + 1}月${now.getDate()}日 ${WEEKDAY_CN[now.getDay()]}`;

  const statWrap = el('div', { class: 'stat-card-wrap' });
  const stat = el('div', { class: 'card elevated' });
  const statRow = el('div', { style: 'display:flex;align-items:center;gap:18px' } as never);
  statRow.append(progressRing(taken, total));
  const statText = el('div', { style: 'flex:1;min-width:0' } as never);
  statText.append(el('div', { class: 'muted', html: dateStr }));
  statText.append(
    el('div', {
      class: 'big',
      html:
        total === 0
          ? restCount > 0
            ? `今天全部为停药期（${restCount} 项）`
            : '今天没有安排'
          : `已服 ${taken} · 跳过 ${skipped} · 待服 ${pending}${restCount > 0 ? ` · 停药期 ${restCount}` : ''}`,
      style: 'margin-top:4px',
    } as never),
  );
  statRow.append(statText);
  stat.append(statRow);
  statWrap.append(stat);
  content.append(statWrap);

  const cycleReviewCount = new Set(
    projections
      .filter((projection) => projection.revision.reviewFlags.includes('cycle-start-missing'))
      .map((projection) => projection.revision.sourceRuleId),
  ).size;
  if (cycleReviewCount > 0) {
    content.append(
      banner('warn', `${cycleReviewCount} 项周期用药缺少明确首日，已暂按服药日显示，请到药品编辑页复核。`),
    );
  }

  if (items.length > 0) {
    const groupMap = new Map<Slot, SlotGroup>();
    for (const item of items) {
      const slot = item.revision.slot;
      let group = groupMap.get(slot);
      if (!group) {
        group = { slot, items: [], earliest: item.dueAt, earliestTime: item.revision.timeLocal };
        groupMap.set(slot, group);
      }
      group.items.push(item);
      if (item.dueAt < group.earliest) {
        group.earliest = item.dueAt;
        group.earliestTime = item.revision.timeLocal;
      }
    }
    const grid = el('div', { class: 'slot-grid' });
    for (const group of [...groupMap.values()].sort((a, b) => a.earliest - b.earliest)) {
      grid.append(renderSlotCard(group, () => void renderTodayPage(root, signal), today));
    }
    content.append(grid);
  } else {
    content.append(banner('info', '前往“药品”添加药品并设置服药时间，这里会自动生成今日清单。'));
  }

  content.append(renderWeekAdherenceCard(weekOccurrences, weekLogs, today, Date.now()));
  if (!signal?.aborted) {
    renderPage({ root, title: '今天', activeTab: 'today', content });
    focusNotificationTarget(root, signal);
  }
}

function toTodayItem(
  projection: ScheduleDayProjection,
  med: Medication,
  logs: readonly IntakeLog[],
): TodayItem {
  return {
    revision: projection.revision,
    med,
    dueAt: projection.dueAt,
    occurrence: projection.occurrence,
    log: projection.occurrence ? findLogForOccurrence(projection.occurrence, logs) : undefined,
    isRest: projection.isRest,
  };
}

function renderWeekAdherenceCard(
  occurrences: readonly MedicationOccurrence[],
  logs: readonly IntakeLog[],
  today: ReturnType<typeof toLocalDate>,
  now: number,
): HTMLElement {
  const card = el('div', { class: 'card adherence-card' });
  card.append(el('h2', { html: '近 7 天依从情况' }));
  const bars: Array<{
    date: ReturnType<typeof toLocalDate>;
    rate: number;
    due: number;
    taken: number;
    skipped: number;
    missed: number;
  }> = [];
  for (let daysAgo = 6; daysAgo >= 0; daysAgo -= 1) {
    const date = addLocalDays(today, -daysAgo);
    const dayOccurrences = occurrences.filter((occurrence) => occurrence.localDate === date);
    const summary = calculateAdherence(dayOccurrences, logs, now);
    bars.push({
      date,
      rate: summary.adherenceRate,
      due: summary.due,
      taken: summary.taken,
      skipped: summary.skipped,
      missed: summary.missed,
    });
  }

  const chart = el('div', { class: 'adherence-chart' });
  chart.setAttribute('role', 'list');
  chart.setAttribute('aria-label', '近 7 天每日依从率');
  for (const item of bars) {
    const column = el('div', { class: 'adherence-col' });
    const barWrap = el('div', { class: 'adherence-bar-wrap' });
    const bar = el('div', {
      class: 'adherence-bar' + (item.due === 0 ? ' empty' : item.rate >= 0.8 ? ' ok' : ' warn'),
    });
    bar.style.height = `${item.due === 0 ? 8 : Math.max(12, Math.round(item.rate * 100))}%`;
    barWrap.append(bar);
    const [, month, day] = item.date.split('-');
    const label = el('div', { class: 'adherence-label', html: `${Number(month)}/${Number(day)}` });
    const pct = el('div', { class: 'adherence-pct muted' });
    pct.textContent = item.due === 0 ? '—' : `${Math.round(item.rate * 100)}%`;
    column.title = item.due === 0
      ? '没有已到期安排'
      : `已服 ${item.taken}，跳过 ${item.skipped}，漏服 ${item.missed}`;
    column.setAttribute('role', 'listitem');
    column.setAttribute(
      'aria-label',
      item.due === 0
        ? `${Number(month)}月${Number(day)}日，没有已到期安排`
        : `${Number(month)}月${Number(day)}日，依从率 ${Math.round(item.rate * 100)}%，已服 ${item.taken}，跳过 ${item.skipped}，漏服 ${item.missed}`,
    );
    column.append(barWrap, label, pct);
    chart.append(column);
  }
  card.append(chart);

  const overall = calculateAdherence(occurrences, logs, now);
  const adherence = overall.due > 0 ? Math.round(overall.adherenceRate * 100) : 0;
  const handled = overall.due > 0 ? Math.round(overall.handledRate * 100) : 0;
  card.append(
    el('div', {
      class: 'adherence-summary muted',
      html:
        overall.due === 0
          ? '近 7 天没有已到期的服药安排'
          : `依从率 ${adherence}%（已服 ${overall.taken}/${overall.due}） · 已处理率 ${handled}% · 跳过 ${overall.skipped} · 漏服 ${overall.missed}`,
    }),
  );
  return card;
}

function renderSlotCard(
  group: SlotGroup,
  refresh: () => void,
  today: ReturnType<typeof toLocalDate>,
): HTMLElement {
  const activeItems = group.items.filter((item) => !item.isRest && item.occurrence);
  const doneCount = activeItems.filter((item) => isHandled(item.log)).length;
  const takenCount = activeItems.filter((item) => item.log?.status === 'taken').length;
  const skippedCount = activeItems.filter((item) => item.log?.status === 'skipped').length;
  const allDone = activeItems.length > 0 && doneCount === activeItems.length;
  const allTaken = activeItems.length > 0 && takenCount === activeItems.length;
  const now = Date.now();
  const eligiblePending = pendingItems(activeItems).filter(
    (item) => item.occurrence && isOccurrenceEligible(item.occurrence, now, EARLY_TAKE_WINDOW_MS),
  );
  const takeableItems = eligiblePending.filter((item) => !isMedicationExpiredOn(item.med, today));
  const upcomingPending = pendingItems(activeItems).filter(
    (item) => item.occurrence && !isOccurrenceEligible(item.occurrence, now, EARLY_TAKE_WINDOW_MS),
  );
  const nextAllowedAt = upcomingPending.length > 0
    ? Math.min(...upcomingPending.map((item) => item.dueAt - EARLY_TAKE_WINDOW_MS))
    : undefined;
  const card = el('div', {
    class: `slot-card${allDone ? ' taken' : ''}${skippedCount > 0 && !allTaken ? ' skipped' : ''}`,
  });

  const head = el('div', { class: 'head' });
  head.append(slotTag(group.slot));
  const distinctTimes = new Set(group.items.map((item) => item.revision.timeLocal));
  head.append(el('span', { class: 'time', html: distinctTimes.size > 1 ? `${group.earliestTime} 起` : group.earliestTime }));
  head.append(el('span', { class: 'spacer' }));
  if (activeItems.length === 0) {
    head.append(badge('全部停药期'));
  } else if (allDone) {
    const pill = el('span', { class: 'check-pill' });
    pill.append(icon(allTaken ? 'check' : 'undo'));
    pill.append(el('span', { html: allTaken ? '已完成' : `已跳过 ${skippedCount}` }));
    head.append(pill);
  } else {
    head.append(badge(`${activeItems.length - doneCount} 待服`));
  }
  card.append(head);

  const meds = el('div', { class: 'meds' });
  for (const item of group.items) {
    const status = item.log?.status === 'taken' || item.log?.status === 'skipped' ? item.log.status : 'pending';
    const expired = isMedicationExpiredOn(item.med, today);
    const line = el('div', {
      class: `med-line med-line-${status}${expired ? ' expired' : ''}${item.isRest ? ' rest-day' : ''}`,
    });
    if (item.occurrence) line.dataset.occurrenceId = item.occurrence.id;
    line.append(el('span', { class: 'dot' }));
    line.append(el('span', { class: 'med-name', html: item.med.name }));
    const structuredDose = item.revision.doseQuantity && item.revision.doseUnit
      ? `${item.revision.doseQuantity}${item.revision.doseUnit}`
      : item.med.amountPerDose;
    const details = [
      item.revision.timeLocal,
      structuredDose,
      formatMealRels([...item.revision.mealRels]),
    ].filter(Boolean).join(' · ');
    if (details) line.append(el('span', { class: 'dose', html: details }));
    if (item.isRest) line.append(el('span', { class: 'rest-day-tag', html: '停药期' }));
    if (status === 'taken') line.append(el('span', { class: 'dose status-text ok', html: '已服' }));
    if (status === 'skipped') line.append(el('span', { class: 'dose status-text warn', html: '已跳过' }));
    if (expired) line.append(el('span', { class: 'dose status-text expired-tag', html: '已过期' }));
    meds.append(line);
  }
  card.append(meds);

  const actions = el('div', { class: 'actions' });
  if (activeItems.length === 0) {
    actions.append(el('span', { class: 'muted', html: '今日为停药期，无需服用' }));
  } else if (allDone) {
    const undo = el('button', { class: 'btn text' });
    undo.append(icon('undo'));
    undo.append(el('span', { html: '撤销整段' }));
    undo.onclick = async () => {
      await applyActions(activeItems, undefined);
      toast('已撤销');
      refresh();
    };
    actions.append(undo);
  } else {
    const takeBtn = el('button', { class: 'btn success' });
    takeBtn.append(icon('check'));
    takeBtn.append(
      el('span', {
        html:
          takeableItems.length > 0
            ? `服用已到时间（${takeableItems.length}）`
            : eligiblePending.length > 0
              ? '过期药不可记录服用'
              : nextAllowedAt != null
                ? `${formatClock(nextAllowedAt)} 后可服用`
                : '暂无可服用项',
      }),
    );
    if (takeableItems.length === 0) takeBtn.disabled = true;
    takeBtn.onclick = async () => {
      if (takeableItems.length === 0) return;
      const hits = checkInteractions(takeableItems.map((item) => item.med.name));
      if (hits.length > 0 && !(await confirmDialog(buildTodayInteractionWarning(hits), '仍要记录', true))) {
        return;
      }
      const confirmations = await prepareDoseConfirmations(takeableItems);
      if (!confirmations) return;
      try {
        await applyActions(takeableItems, 'taken', confirmations);
        toast(`${takeableItems.length} 项服药已记录`);
        refresh();
      } catch (error) {
        toast(intakeErrorMessage(error));
      }
    };

    const skipBtn = el('button', { class: 'btn tonal' });
    skipBtn.append(icon('undo'));
    skipBtn.append(el('span', { html: eligiblePending.length > 0 ? `跳过已到时间（${eligiblePending.length}）` : '暂无可跳过项' }));
    if (eligiblePending.length === 0) skipBtn.disabled = true;
    skipBtn.onclick = async () => {
      if (eligiblePending.length === 0) return;
      await applyActions(eligiblePending, 'skipped');
      toast('已记录为跳过');
      refresh();
    };
    actions.append(takeBtn, skipBtn);
  }
  card.append(actions);
  return card;
}

function buildTodayInteractionWarning(hits: DrugInteraction[]): string {
  const severity = (value: DrugInteraction['severity']): string =>
    value === 'severe' ? '严重' : value === 'moderate' ? '中等' : '轻微';
  return `常见相互作用提示（仅覆盖应用内置的有限规则，不替代医生或药师判断）：\n\n${hits
    .map(
      (hit) =>
        `注意：${hit.drugs.join(' 与 ')} 存在相互作用（${severity(hit.severity)}）：${hit.description}`,
    )
    .join('\n\n')}\n\n仍要记录为已服用吗？`;
}

async function prepareDoseConfirmations(
  items: readonly TodayItem[],
): Promise<Map<string, StructuredDose> | undefined> {
  const confirmations = new Map<string, StructuredDose>();
  const countByMed = new Map<string, number>();
  for (const item of items) countByMed.set(item.med.id, (countByMed.get(item.med.id) ?? 0) + 1);

  for (const item of items) {
    if (!item.med.inventory || confirmations.has(item.med.id)) continue;
    let dose = getConfirmedDose(item.med);
    if (!dose) {
      const suggestion = item.med.doseMigrationSuggestion ??
        suggestStructuredDose(item.med.amountPerDose, item.med.inventory.unit);
      if (!suggestion) {
        toast(`${item.med.name} 的每次用量无法可靠识别，请先在药品页确认`);
        return undefined;
      }
      const confirmed = await confirmDialog(
        `库存扣减需要结构化剂量。是否确认每次 ${suggestion.quantity}${suggestion.unit}？`,
        '确认剂量',
      );
      if (!confirmed) return undefined;
      dose = suggestion;
      confirmations.set(item.med.id, dose);
    }
    const required = dose.quantity * (countByMed.get(item.med.id) ?? 1);
    if (item.med.inventory.remaining < required) {
      toast(
        `${item.med.name} 库存不足：需要 ${required}${dose.unit}，剩余 ${item.med.inventory.remaining}${item.med.inventory.unit || dose.unit}`,
      );
      return undefined;
    }
  }
  return confirmations;
}

async function applyActions(
  items: readonly TodayItem[],
  action: IntakeAction | undefined,
  confirmations = new Map<string, StructuredDose>(),
): Promise<void> {
  for (const item of items) {
    if (!item.occurrence) continue;
    const result = await setOccurrenceAction(item.occurrence, action, {
      confirmedDose: confirmations.get(item.med.id),
    });
    item.med = result.med;
    item.log = result.log;
    if (result.lowStock && result.lowStockMessage) {
      toast(result.lowStockMessage);
      await sendLowStockReminderIfDue(result.med, result.lowStockMessage);
    }
    void closeNotificationsByTag(item.occurrence.id);
    void closeNotificationsByTag(item.occurrence.id + '_care');
    void closeNotificationsByTag(item.occurrence.legacyLogId);
  }
}

function pendingItems(items: readonly TodayItem[]): TodayItem[] {
  return items.filter((item) => !isHandled(item.log));
}

function isHandled(log: IntakeLog | undefined): boolean {
  return log?.status === 'taken' || log?.status === 'skipped';
}

function intakeErrorMessage(error: unknown): string {
  if (error instanceof MedicationIntakeError) return error.message;
  return '记录失败，请稍后重试';
}

function formatClock(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function focusNotificationTarget(root: HTMLElement, signal?: AbortSignal): void {
  const storageKey = 'medbox.notification-target-occurrence';
  const targetId = sessionStorage.getItem(storageKey);
  if (!targetId) return;
  const target = Array.from(root.querySelectorAll<HTMLElement>('[data-occurrence-id]'))
    .find((element) => element.dataset.occurrenceId === targetId);
  sessionStorage.removeItem(storageKey);
  if (!target) {
    toast('通知对应的任务不在今天清单中');
    return;
  }
  target.tabIndex = -1;
  target.classList.add('notification-target');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (signal?.aborted || !target.isConnected) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
    target.focus({ preventScroll: true });
  }));
}
