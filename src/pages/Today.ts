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
  icon,
  renderPage,
  toast,
  progressRing,
  slotTag,
  banner,
  confirmDialog,
} from '../ui/components';
import { closeNotificationsByTag } from '../features/notifier';
import { getMedPhotoUrls } from '../features/medPhotos';
import {
  areDoseUnitsCompatible,
  getConfirmedDose,
} from '../features/inventory';
import { sendLowStockReminderIfDue } from '../features/inventoryReminder';
import { checkInteractions, filterNewInteractions, acknowledgeInteractions, type DrugInteraction } from '../data/drugInteractions';
import { createButton } from '../ui/primitives/Button';
import { createStatusBadge } from '../ui/primitives/StatusBadge';

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

  // 今日清单每行带药盒照片缩略图，长辈按图找药
  const photoUrls = await getMedPhotoUrls([...new Set(items.map((item) => item.med.id))]);
  if (signal?.aborted) return;

  const content = el('div', { class: 'page today-page' });
  const activeItems = items.filter((item) => !item.isRest && item.occurrence);
  const total = activeItems.length;
  const taken = activeItems.filter((item) => item.log?.status === 'taken').length;
  const skipped = activeItems.filter((item) => item.log?.status === 'skipped').length;
  const pending = total - taken - skipped;
  const restCount = items.length - activeItems.length;
  const dateStr = `${now.getMonth() + 1}月${now.getDate()}日 ${WEEKDAY_CN[now.getDay()]}`;

  const summary = el('section', { class: 'today-summary', 'aria-label': '今日服药概览' } as any);
  const summaryCopy = el('div', { class: 'today-summary-copy' });
  summaryCopy.append(el('div', { class: 'today-summary-date', text: dateStr }));
  summaryCopy.append(el('h2', {
    class: 'today-summary-title',
    text:
      total === 0
        ? restCount > 0
          ? `今天全部为停药期（${restCount} 项）`
          : '今天没有安排'
        : `待处理 ${pending} 项`,
  }));
  const summaryStats = el('div', { class: 'today-summary-stats', role: 'list', 'aria-label': '今日服药统计' } as any);
  summaryStats.append(
    summaryMetric('已服', `${taken}/${total}`, 'success'),
    summaryMetric('待服', String(pending), pending > 0 ? 'warning' : 'muted'),
    summaryMetric('跳过', String(skipped), skipped > 0 ? 'warning' : 'muted'),
  );
  if (restCount > 0) summaryStats.append(summaryMetric('停药期', String(restCount), 'muted'));
  summaryCopy.append(summaryStats);
  const progress = el('div', { class: 'today-summary-progress' });
  progress.append(progressRing(taken, total));
  summary.append(summaryCopy, progress);
  content.append(summary);

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
    const grid = el('div', { class: 'today-schedule' });
    for (const group of [...groupMap.values()].sort((a, b) => a.earliest - b.earliest)) {
      grid.append(renderSlotSection(group, () => void renderTodayPage(root, signal), today, photoUrls));
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

function summaryMetric(
  label: string,
  value: string,
  tone: Parameters<typeof createStatusBadge>[1],
): HTMLElement {
  const metric = el('div', { class: 'today-summary-stat', role: 'listitem' } as any);
  metric.append(el('span', { class: 'today-summary-stat-label', text: label }));
  const valueNode = el('strong', { class: 'today-summary-stat-value', text: value });
  valueNode.append(createStatusBadge('', tone));
  valueNode.lastElementChild?.setAttribute('aria-hidden', 'true');
  metric.append(valueNode);
  return metric;
}

function renderWeekAdherenceCard(
  occurrences: readonly MedicationOccurrence[],
  logs: readonly IntakeLog[],
  today: ReturnType<typeof toLocalDate>,
  now: number,
): HTMLElement {
  const card = el('section', { class: 'today-adherence', 'aria-label': '近 7 天服药情况' } as any);
  card.append(el('h2', { text: '近 7 天服药情况' }));
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
  chart.setAttribute('aria-label', '近 7 天每日按时服药比例');
  for (const item of bars) {
    const isToday = item.date === today;
    const isEmpty = item.due === 0;
    const tone = isEmpty ? 'empty' : item.rate >= 0.8 ? 'ok' : item.rate > 0 ? 'warn' : 'miss';
    const fillPct = isEmpty ? 0 : Math.max(item.rate > 0 ? 14 : 8, Math.round(item.rate * 100));

    const column = el('div', {
      class: 'adherence-col' + (isToday ? ' is-today' : '') + (isEmpty ? ' is-empty' : ''),
    });
    const barWrap = el('div', { class: 'adherence-bar-wrap' });
    const track = el('div', { class: 'adherence-track' });
    const bar = el('div', { class: `adherence-bar ${tone}` });
    bar.style.setProperty('--adherence-fill', `${fillPct}%`);
    track.append(bar);
    barWrap.append(track);

    const [, month, day] = item.date.split('-');
    const label = el('div', {
      class: 'adherence-label' + (isToday ? ' is-today' : ''),
      text: `${Number(month)}/${Number(day)}`,
    });
    const pct = el('div', { class: 'adherence-pct' + (isEmpty ? ' is-empty' : '') });
    pct.textContent = isEmpty ? '休' : `${Math.round(item.rate * 100)}%`;

    column.title = isEmpty
      ? '没有已到期安排'
      : `已服 ${item.taken}，跳过 ${item.skipped}，漏服 ${item.missed}`;
    column.setAttribute('role', 'listitem');
    column.setAttribute(
      'aria-label',
      isEmpty
        ? `${Number(month)}月${Number(day)}日，没有已到期安排`
        : `${Number(month)}月${Number(day)}日，按时服药 ${Math.round(item.rate * 100)}%，已服 ${item.taken}，跳过 ${item.skipped}，漏服 ${item.missed}`,
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
          : `按时服药 ${adherence}%（已服 ${overall.taken}/${overall.due}） · 已处理 ${handled}% · 跳过 ${overall.skipped} · 漏服 ${overall.missed}`,
    }),
  );
  return card;
}

function renderSlotSection(
  group: SlotGroup,
  refresh: () => void,
  today: ReturnType<typeof toLocalDate>,
  photoUrls: ReadonlyMap<string, string>,
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
  const card = el('section', {
    class: `today-slot${allDone ? ' is-complete' : ''}${skippedCount > 0 && !allTaken ? ' is-skipped' : ''}`,
  });

  const head = el('div', { class: 'today-slot-header' });
  head.append(slotTag(group.slot));
  const distinctTimes = new Set(group.items.map((item) => item.revision.timeLocal));
  head.append(el('span', { class: 'today-slot-time', text: distinctTimes.size > 1 ? `${group.earliestTime} 起` : group.earliestTime }));
  head.append(el('span', { class: 'today-slot-spacer' }));
  if (activeItems.length === 0) {
    head.append(createStatusBadge('全部停药期', 'muted'));
  } else if (allDone) {
    head.append(createStatusBadge(allTaken ? '已服完成' : `已跳过 ${skippedCount}`, allTaken ? 'success' : 'warning'));
  } else {
    head.append(createStatusBadge(`${activeItems.length - doneCount} 待服`, 'info'));
  }
  card.append(head);

  const meds = el('div', { class: 'today-medication-list' });
  for (const item of group.items) {
    const status = item.log?.status === 'taken' || item.log?.status === 'skipped' ? item.log.status : 'pending';
    const expired = isMedicationExpiredOn(item.med, today);
    const line = el('article', {
      class: `today-medication-row today-medication-${status}${expired ? ' is-expired' : ''}${item.isRest ? ' is-rest-day' : ''}`,
    });
    if (item.occurrence) line.dataset.occurrenceId = item.occurrence.id;
    line.append(el('span', { class: 'today-medication-marker', 'aria-hidden': 'true' } as any));
    // 药盒照片缩略图：认盒不认字，没照片时用淡紫药丸占位
    const photoUrl = photoUrls.get(item.med.id);
    const thumb = el('span', { class: 'today-medication-thumb' + (photoUrl ? '' : ' is-placeholder'), 'aria-hidden': 'true' } as any);
    if (photoUrl) {
      const img = el('img', { alt: '', loading: 'lazy', decoding: 'async' } as any) as HTMLImageElement;
      img.src = photoUrl;
      thumb.append(img);
    } else {
      thumb.append(icon('pill'));
    }
    line.append(thumb);
    const copy = el('div', { class: 'today-medication-copy' });
    copy.append(el('div', { class: 'today-medication-name', text: item.med.name }));
    const structuredDose = item.revision.doseQuantity && item.revision.doseUnit
      ? `${item.revision.doseQuantity}${item.revision.doseUnit}`
      : item.med.amountPerDose;
    const details = [
      item.revision.timeLocal,
      structuredDose,
      formatMealRels([...item.revision.mealRels]),
    ].filter(Boolean).join(' · ');
    if (details) copy.append(el('div', { class: 'today-medication-meta', text: details }));
    line.append(copy);
    const statusWrap = el('div', { class: 'today-medication-status' });
    if (item.isRest) statusWrap.append(createStatusBadge('停药期', 'muted'));
    else if (status === 'taken') statusWrap.append(createStatusBadge('已服', 'success'));
    else if (status === 'skipped') statusWrap.append(createStatusBadge('已跳过', 'warning'));
    if (expired) statusWrap.append(createStatusBadge('已过期', 'danger'));
    if (!item.isRest && item.med.inventory && !getConfirmedDose(item.med)) {
      statusWrap.append(createStatusBadge('剂量待复核', 'warning'));
    }
    if (statusWrap.childElementCount > 0) line.append(statusWrap);
    meds.append(line);
  }
  card.append(meds);

  const actions = el('div', { class: 'today-slot-actions' });
  if (activeItems.length === 0) {
    actions.append(el('span', { class: 'today-slot-empty', text: '今日为停药期，无需服用' }));
  } else if (allDone) {
    const undo = createButton({ label: '撤销本时段', variant: 'text', icon: 'undo' });
    undo.onclick = () => void (async () => {
      await applyActions(activeItems, undefined);
      toast('已撤销');
      refresh();
    })();
    actions.append(undo);
  } else {
    const takeLabel = takeableItems.length > 0
      ? `服用已到时间（${takeableItems.length}）`
      : eligiblePending.length > 0
        ? '过期药不可记录服用'
        : nextAllowedAt != null
          ? `${formatClock(nextAllowedAt)} 后可服用`
          : '暂无可服用项';
    const takeBtn = createButton({ label: takeLabel, icon: 'check', disabled: takeableItems.length === 0 });
    takeBtn.classList.add('today-slot-take');
    takeBtn.onclick = () => void (async () => {
      if (takeableItems.length === 0) return;
      const hits = checkInteractions(takeableItems.map((item) => item.med.name));
      // 只对"新"的相互作用弹窗：已确认过的组合不再打扰，出现新组合才再提示
      const fresh = filterNewInteractions(hits);
      if (fresh.length > 0 && !(await confirmDialog(buildTodayInteractionWarning(fresh), '仍要记录', true))) {
        return;
      }
      if (fresh.length > 0) acknowledgeInteractions(fresh);
      if (!preflightInventoryActions(takeableItems)) return;
      try {
        await applyActions(takeableItems, 'taken');
        toast(`${takeableItems.length} 项服药已记录`);
        refresh();
      } catch (error) {
        toast(intakeErrorMessage(error));
      }
    })();

    const skipBtn = createButton({
      label: eligiblePending.length > 0 ? `跳过已到时间（${eligiblePending.length}）` : '暂无可跳过项',
      variant: 'secondary',
      icon: 'undo',
      disabled: eligiblePending.length === 0,
    });
    skipBtn.onclick = () => void (async () => {
      if (eligiblePending.length === 0) return;
      await applyActions(eligiblePending, 'skipped');
      toast('已记录为跳过');
      refresh();
    })();
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

function preflightInventoryActions(items: readonly TodayItem[]): boolean {
  const countByMed = new Map<string, number>();
  for (const item of items) countByMed.set(item.med.id, (countByMed.get(item.med.id) ?? 0) + 1);

  for (const item of items) {
    if (!item.med.inventory) continue;
    const dose = getConfirmedDose(item.med);
    // Intake remains recordable for old free-text doses, but no inventory delta
    // is created until the user edits the medication into a structured dose.
    if (!dose) continue;
    const inventoryUnit = item.med.inventory.unit?.trim();
    if (inventoryUnit && !areDoseUnitsCompatible(inventoryUnit, dose.unit)) {
      toast(`${item.med.name} 每次用量的单位和剩余药量的单位对不上，这次先不帮你扣药量`);
      return false;
    }
    const required = dose.quantity * (countByMed.get(item.med.id) ?? 1);
    if (item.med.inventory.remaining < required) {
      toast(
        `${item.med.name} 不够吃了：这次要 ${required}${dose.unit}，只剩 ${item.med.inventory.remaining}${item.med.inventory.unit || dose.unit}，记得补药`,
      );
      return false;
    }
  }
  return true;
}

async function applyActions(
  items: readonly TodayItem[],
  action: IntakeAction | undefined,
): Promise<void> {
  for (const item of items) {
    if (!item.occurrence) continue;
    const result = await setOccurrenceAction(item.occurrence, action);
    item.med = result.med;
    item.log = result.log;
    if (result.lowStock && result.lowStockMessage) {
      toast(result.lowStockMessage);
      await sendLowStockReminderIfDue(result.med, result.lowStockMessage);
    }
    void closeNotificationsByTag(item.occurrence.id);
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
