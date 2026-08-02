import {
  listMeds,
  listLogsByDay,
  listLogsByRange,
  listScheduleRevisions,
  setOccurrenceAction,
  isOccurrencePreDeducted,
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
  infoDialog,
} from '../ui/components';
import { closeNotificationsByTag } from '../features/notifier';
import { getMedPhotoUrls } from '../features/medPhotos';
import { getOrCreateMed3DImage } from '../features/aiImageGen';
import {
  areDoseUnitsCompatible,
  getConfirmedDose,
} from '../features/inventory';
import { sendLowStockReminderIfDue } from '../features/inventoryReminder';
import { createButton } from '../ui/primitives/Button';
import { createStatusBadge } from '../ui/primitives/StatusBadge';
import { navigate } from '../router';

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

// 今日页照片在本会话内基本不变：打卡后整页重渲染时按 medId 集合复用，避免每次重新查库建 URL
let todayPhotoKey = '';
let todayPhotoUrls: ReadonlyMap<string, string> = new Map();

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
  const photoMedIds = [...new Set(items.map((item) => item.med.id))].sort();
  const photoKey = photoMedIds.join('\u0000');
  let photoUrls: ReadonlyMap<string, string>;
  if (photoKey !== todayPhotoKey) {
    photoUrls = await getMedPhotoUrls(photoMedIds);
    todayPhotoKey = photoKey;
    todayPhotoUrls = photoUrls;
  } else {
    photoUrls = todayPhotoUrls;
  }
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
    // topRight：进入服药历史页（P3 Task 10.2）
    const historyBtn = el('button', {
      class: 'icon-btn',
      type: 'button',
      'aria-label': '查看服药历史',
    } as any);
    historyBtn.append(icon('clock'));
    historyBtn.onclick = () => navigate('/history');
    renderPage({ root, title: '今天', activeTab: 'today', content, topRight: historyBtn });
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
    // 二元着色：100% 完成用品牌渐变；只要有漏服/跳过即标记为未完成
    const isComplete = !isEmpty && item.rate === 1;
    const tone = isEmpty ? 'empty' : isComplete ? 'complete' : 'miss';
    const fillPct = isEmpty ? 0 : Math.max(isComplete ? 100 : 14, Math.round(item.rate * 100));

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
  // P3 Task 10.1：底部"查看完整历史"链接，进入 /history 路由
  const historyLink = el('a', {
    class: 'today-adherence-link',
    href: '#/history',
    text: '查看完整历史 →',
    'aria-label': '查看完整服药历史',
  } as any) as HTMLAnchorElement;
  historyLink.addEventListener('click', (event: MouseEvent) => {
    event.preventDefault();
    navigate('/history');
  });
  card.append(historyLink);
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
    const preDeducted = !!item.occurrence && isOccurrencePreDeducted(item.med, item.occurrence);
    const line = el('article', {
      class: `today-medication-row today-medication-${status}${expired ? ' is-expired' : ''}${item.isRest ? ' is-rest-day' : ''}`,
    });
    if (item.occurrence) line.dataset.occurrenceId = item.occurrence.id;
    line.append(el('span', { class: 'today-medication-marker', 'aria-hidden': 'true' } as any));
    // 药盒照片/3D AI 生图缩略图
    const photoUrl = photoUrls.get(item.med.id) || getOrCreateMed3DImage(item.med.id, item.med.name, item.med.amountPerDose);
    const thumb = el('span', { class: 'today-medication-thumb', 'aria-hidden': 'true' } as any);
    const img = el('img', { alt: '', loading: 'lazy', decoding: 'async' } as any) as HTMLImageElement;
    img.src = photoUrl;
    thumb.append(img);
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
    if (preDeducted) statusWrap.append(createStatusBadge('已分药', 'info'));
    if (expired) statusWrap.append(createStatusBadge('已过期', 'danger'));
    if (!item.isRest && item.med.inventory && !(item.occurrence?.doseQuantity && item.occurrence.doseUnit)) {
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
      const result = await applyActions(activeItems, undefined);
      toast(result.failed > 0 ? applyResultMessage(result) : '已撤销');
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
      if (!preflightInventoryActions(takeableItems)) return;
      const insufficient = collectInsufficientMeds(takeableItems);
      if (insufficient.length > 0) {
        await infoDialog(buildInsufficientWarning(insufficient));
      }
      const result = await applyActions(takeableItems, 'taken');
      if (result.failed > 0) toast(applyResultMessage(result));
      else toast(`${result.ok} 项服药已记录`);
      refresh();
    })();

    const skipBtn = createButton({
      label: eligiblePending.length > 0 ? `跳过已到时间（${eligiblePending.length}）` : '暂无可跳过项',
      variant: 'secondary',
      icon: 'undo',
      disabled: eligiblePending.length === 0,
    });
    skipBtn.onclick = () => void (async () => {
      if (eligiblePending.length === 0) return;
      const result = await applyActions(eligiblePending, 'skipped');
      toast(result.failed > 0 ? applyResultMessage(result) : '已记录为跳过');
      refresh();
    })();
    actions.append(takeBtn, skipBtn);
  }
  card.append(actions);
  return card;
}

interface DoseRequirement {
  med: Medication;
  quantity: number;
  unit: string;
}

/** 汇总今日项按药合并的剂量需求；单位不兼容时回调，返回 false 提前终止 */
function collectDoseRequirements(
  items: readonly TodayItem[],
  onIncompatible?: (med: Medication, reason: 'inventory' | 'cross') => boolean,
): Map<string, DoseRequirement> {
  const requiredByMed = new Map<string, DoseRequirement>();
  for (const item of items) {
    if (!item.occurrence || !item.med.inventory || isOccurrencePreDeducted(item.med, item.occurrence)) continue;
    const dose = item.occurrence.doseQuantity && item.occurrence.doseUnit
      ? { quantity: item.occurrence.doseQuantity, unit: item.occurrence.doseUnit }
      : getConfirmedDose(item.med);
    // 旧自由文本剂量仍允许打卡，但不会产生库存变化。
    if (!dose) continue;
    const inventoryUnit = item.med.inventory.unit?.trim();
    if (inventoryUnit && !areDoseUnitsCompatible(inventoryUnit, dose.unit)) {
      if (onIncompatible?.(item.med, 'inventory') === false) return requiredByMed;
      continue;
    }
    const current = requiredByMed.get(item.med.id);
    if (current && !areDoseUnitsCompatible(current.unit, dose.unit)) {
      if (onIncompatible?.(item.med, 'cross') === false) return requiredByMed;
      continue;
    }
    requiredByMed.set(item.med.id, {
      med: item.med,
      quantity: (current?.quantity ?? 0) + dose.quantity,
      unit: current?.unit ?? dose.unit,
    });
  }
  return requiredByMed;
}

function preflightInventoryActions(items: readonly TodayItem[]): boolean {
  let valid = true;
  collectDoseRequirements(items, (med, reason) => {
    valid = false;
    toast(reason === 'inventory'
      ? `${med.name} 每次用量的单位和剩余药量的单位对不上，这次先不帮你扣药量`
      : `${med.name} 今天的计划剂量单位不一致，请先到药品编辑页复核`);
    return false;
  });
  return valid;
}

interface InsufficientMedInfo {
  med: Medication;
  needed: number;
  remaining: number;
  unit: string;
}

function collectInsufficientMeds(items: readonly TodayItem[]): InsufficientMedInfo[] {
  const result: InsufficientMedInfo[] = [];
  for (const { med, quantity, unit } of collectDoseRequirements(items).values()) {
    if (med.inventory!.remaining < quantity) {
      result.push({
        med,
        needed: quantity,
        remaining: med.inventory!.remaining,
        unit: med.inventory!.unit || unit,
      });
    }
  }
  return result;
}

function buildInsufficientWarning(insufficient: readonly InsufficientMedInfo[]): string {
  const lines = insufficient.map((i) => `- ${i.med.name}：需 ${i.needed}${i.unit}，剩 ${i.remaining}${i.unit}`);
  return `以下药品库存不足，仍会记录服药并扣至 0：\n\n${lines.join('\n')}\n\n记得补药。`;
}

interface ApplyActionResult {
  ok: number;
  failed: number;
  failures: Array<{ name: string; reason: string }>;
}

async function applyActions(
  items: readonly TodayItem[],
  action: IntakeAction | undefined,
): Promise<ApplyActionResult> {
  const failures: ApplyActionResult['failures'] = [];
  let ok = 0;
  for (const item of items) {
    if (!item.occurrence) continue;
    try {
      const result = await setOccurrenceAction(item.occurrence, action);
      item.med = result.med;
      item.log = result.log;
      if (result.lowStock && result.lowStockMessage) {
        toast(result.lowStockMessage);
        await sendLowStockReminderIfDue(result.med, result.lowStockMessage).catch(() => undefined);
      }
      void closeNotificationsByTag(item.occurrence.id);
      void closeNotificationsByTag(item.occurrence.legacyLogId);
      ok += 1;
    } catch (error) {
      failures.push({
        name: item.med.name || '未命名药品',
        reason: error instanceof MedicationIntakeError ? error.message : '',
      });
    }
  }
  return { ok, failed: failures.length, failures };
}

function applyResultMessage(result: ApplyActionResult): string {
  const total = result.ok + result.failed;
  const names = result.failures.map((f) => f.name).join('、');
  const reasons = [...new Set(result.failures.map((f) => f.reason).filter(Boolean))].join('；');
  return `已记录 ${result.ok}/${total} 项，失败项：${names}${reasons ? `（${reasons}）` : ''}`;
}

function pendingItems(items: readonly TodayItem[]): TodayItem[] {
  return items.filter((item) => !isHandled(item.log));
}

function isHandled(log: IntakeLog | undefined): boolean {
  return log?.status === 'taken' || log?.status === 'skipped';
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
