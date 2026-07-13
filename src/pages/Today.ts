// 今日服药页：按时段聚合，一键打卡（M3）
import { listMeds, listRules, listLogsByDay, listLogsByRange, putLog, putMed } from '../db/local';
import {
  formatMealRelsForSlot,
  type Medication,
  type ReminderRule,
  type IntakeLog,
  type Slot,
} from '../db/schema';
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
import { closeNotificationsByTag, showNotification } from '../features/notifier';
import { deductInventory, inferDoseQuantity, restoreInventory, shouldSendLowStockReminder } from '../features/inventory';
import { checkInteractions, type DrugInteraction } from '../data/drugInteractions';
import { isRestDay } from '../features/reminderScheduler';

const EARLY_TAKE_WINDOW_MS = 20 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface TodayItem {
  rule: ReminderRule;
  med: Medication;
  dueAt: number;
  log?: IntakeLog;
  /** 今日是否为该 rule 的停药期（rest 日）；为 true 时不参与"全部已服用" */
  isRest?: boolean;
}

interface SlotGroup {
  slot: Slot;
  items: TodayItem[];
  earliest: number;
  earliestTime: string;
}

function dayBounds(d = new Date()): { start: number; end: number } {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const e = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  return { start: s.getTime(), end: e.getTime() };
}

function todayAt(timeLocal: string): number {
  const [h, m] = timeLocal.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export async function renderTodayPage(root: HTMLElement): Promise<void> {
  const now = new Date();
  const weekday = now.getDay();
  const [meds, rules, { start, end }] = await Promise.all([
    listMeds(),
    listRules(),
    Promise.resolve(dayBounds(now)),
  ]);
  const medById = new Map(meds.map((m) => [m.id, m]));
  const logs = await listLogsByDay(start, end);

  // 取近 7 天 logs，用于依从性显示（含今天，共 7 天）
  const todayStart = start;
  const weekAgoStart = todayStart - 6 * MS_PER_DAY;
  const weekEnd = end;
  let weekLogs: IntakeLog[] = [];
  try {
    weekLogs = await listLogsByRange(weekAgoStart, weekEnd);
  } catch {
    weekLogs = [];
  }

  // 组装今日项
  const items: TodayItem[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const med = medById.get(rule.medId);
    if (!med) continue;
    if (med.daysOfWeek.length > 0 && !med.daysOfWeek.includes(weekday)) continue;
    const isRest = isRestDay(med, rule, now.getTime());
    const dueAt = todayAt(rule.timeLocal);
    const log = logs.find((l) => l.id === makeLogId(rule.id, dueAt));
    items.push({ rule, med, dueAt, log, isRest });
  }

  const content = el('div', { class: 'page' });

  // 顶部统计卡（停药期项不计入应服/已服/跳过/待服）
  const activeItems = items.filter((i) => !i.isRest);
  const total = activeItems.length;
  const taken = activeItems.filter((i) => i.log?.status === 'taken').length;
  const skipped = activeItems.filter((i) => i.log?.status === 'skipped').length;
  const pending = total - taken - skipped;
  const restCount = items.length - activeItems.length;
  const dateStr = `${now.getMonth() + 1}月${now.getDate()}日 ${WEEKDAY_CN[weekday]}`;

  const statWrap = el('div', { class: 'stat-card-wrap' });
  const stat = el('div', { class: 'card elevated' });
  const statRow = el(
    'div',
    { style: 'display:flex;align-items:center;gap:18px' } as any
  );
  statRow.append(progressRing(taken, total));
  const statText = el('div', { style: 'flex:1;min-width:0' } as any);
  statText.append(el('div', { class: 'muted', html: dateStr }));
  statText.append(
    el('div', {
      class: 'big',
      html: total === 0
        ? (restCount > 0 ? `今天 ${restCount} 项停药期` : '今天没有安排')
        : `已服 ${taken} · 跳过 ${skipped} · 待服 ${pending}${restCount > 0 ? ` · 停药期 ${restCount}` : ''}`,
      style: 'margin-top:4px',
    } as any)
  );
  statRow.append(statText);
  stat.append(statRow);
  statWrap.append(stat);
  content.append(statWrap);

  if (total === 0) {
    content.append(
      banner('info', '前往「药品」添加药品并设置服药时段，这里会自动生成今日清单。')
    );
    renderPage({ root, title: '今天', activeTab: 'today', content });
    return;
  }

  // 按时段分组
  const groupMap = new Map<Slot, SlotGroup>();
  for (const it of items) {
    const slot = it.rule.slot;
    let g = groupMap.get(slot);
    if (!g) {
      g = { slot, items: [], earliest: it.dueAt, earliestTime: it.rule.timeLocal };
      groupMap.set(slot, g);
    }
    g.items.push(it);
    if (it.dueAt < g.earliest) {
      g.earliest = it.dueAt;
      g.earliestTime = it.rule.timeLocal;
    }
  }
  const groups = [...groupMap.values()].sort((a, b) => a.earliest - b.earliest);

  const grid = el('div', { class: 'slot-grid' });
  for (const g of groups) {
    grid.append(renderSlotCard(g, () => renderTodayPage(root)));
  }
  content.append(grid);

  // 本周依从性卡片（取近 7 天 logs，按日聚合）
  content.append(renderWeekAdherenceCard(weekLogs));

  renderPage({ root, title: '今天', activeTab: 'today', content });
}

/** 渲染本周依从性卡片：7 个竖条，颜色区分达标（≥80% 绿）/未达标（红） */
function renderWeekAdherenceCard(weekLogs: IntakeLog[]): HTMLElement {
  const card = el('div', { class: 'card adherence-card' });
  card.append(el('h3', { html: '本周依从性' }));

  // 计算最近 7 天每天的服药率
  const todayStart = dayBounds().start;
  const bars: { date: Date; rate: number; done: number; due: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = todayStart - i * MS_PER_DAY;
    const dayEnd = dayStart + MS_PER_DAY - 1;
    const dayLogs = weekLogs.filter((l) => l.dueAt >= dayStart && l.dueAt <= dayEnd);
    const due = dayLogs.length;
    const done = dayLogs.filter((l) => l.status === 'taken' || l.status === 'skipped').length;
    const rate = due > 0 ? done / due : 0;
    bars.push({ date: new Date(dayStart), rate, done, due });
  }

  const chart = el('div', { class: 'adherence-chart' });
  for (const b of bars) {
    const col = el('div', { class: 'adherence-col' });
    const barWrap = el('div', { class: 'adherence-bar-wrap' });
    const bar = el('div', {
      class: 'adherence-bar' + (b.due === 0 ? ' empty' : b.rate >= 0.8 ? ' ok' : ' warn'),
    });
    // 高度按比例（最低 12% 保底可见）
    const heightPct = b.due === 0 ? 8 : Math.max(12, Math.round(b.rate * 100));
    bar.style.height = `${heightPct}%`;
    barWrap.append(bar);
    const label = el('div', { class: 'adherence-label', html: `${b.date.getMonth() + 1}/${b.date.getDate()}` });
    const pct = el('div', { class: 'adherence-pct muted' });
    pct.textContent = b.due === 0 ? '—' : `${Math.round(b.rate * 100)}%`;
    col.append(barWrap, label, pct);
    chart.append(col);
  }
  card.append(chart);

  // 说明
  const totalDue = bars.reduce((s, b) => s + b.due, 0);
  const totalDone = bars.reduce((s, b) => s + b.done, 0);
  const overallRate = totalDue > 0 ? Math.round((totalDone / totalDue) * 100) : 0;
  card.append(
    el('div', { class: 'adherence-summary muted', html: `近 7 天总依从率 ${overallRate}%（已服+跳过 / 应服）` })
  );

  return card;
}

function renderSlotCard(group: SlotGroup, refresh: () => void): HTMLElement {
  // 区分活跃项与停药期项：停药期项不参与"全部已服用"统计与操作
  const activeItems = group.items.filter((i) => !i.isRest);
  const doneCount = activeItems.filter((i) => i.log?.status === 'taken' || i.log?.status === 'skipped').length;
  const takenCount = activeItems.filter((i) => i.log?.status === 'taken').length;
  const skippedCount = activeItems.filter((i) => i.log?.status === 'skipped').length;
  const allDone = activeItems.length > 0 && doneCount === activeItems.length;
  const allTaken = activeItems.length > 0 && takenCount === activeItems.length;
  const now = Date.now();
  const earliestAllowed = group.earliest - EARLY_TAKE_WINDOW_MS;
  const canTakeAll = now >= earliestAllowed;
  const card = el('div', { class: `slot-card${allDone ? ' taken' : ''}${skippedCount > 0 && !allTaken ? ' skipped' : ''}` });

  // 头部：slot 标签 + 时间 + 状态
  const head = el('div', { class: 'head' });
  head.append(slotTag(group.slot));
  head.append(el('span', { class: 'time', html: group.earliestTime }));
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

  // 药品列表
  const meds = el('div', { class: 'meds' });
  for (const it of group.items) {
    const status = it.log?.status ?? 'pending';
    const isExpired = it.med.expiryDate != null && it.med.expiryDate < Date.now();
    const restCls = it.isRest ? ' rest-day' : '';
    const line = el('div', { class: `med-line med-line-${status}${isExpired ? ' expired' : ''}${restCls}` });
    line.append(el('span', { class: 'dot' }));
    line.append(el('span', { class: 'med-name', html: it.med.name }));
    const dose = [it.med.amountPerDose, formatMealRelsForSlot(it.rule.slot, it.med.mealRelsBySlot)]
      .filter(Boolean)
      .join(' · ');
    if (dose) line.append(el('span', { class: 'dose', html: dose }));
    if (it.isRest) line.append(el('span', { class: 'rest-day-tag', html: '停药期' }));
    if (status === 'taken') line.append(el('span', { class: 'dose status-text ok', html: '已服' }));
    if (status === 'skipped') line.append(el('span', { class: 'dose status-text warn', html: '已跳过' }));
    if (isExpired) line.append(el('span', { class: 'dose status-text expired-tag', html: '已过期' }));
    meds.append(line);
  }
  card.append(meds);

  // 操作区
  const actions = el('div', { class: 'actions' });
  if (activeItems.length === 0) {
    // 该段今日全部为停药期，不显示服药按钮
    actions.append(el('span', { class: 'muted', html: '今日为停药期，无需服用' }));
  } else if (allDone) {
    const undo = el('button', { class: 'btn text' });
    undo.append(icon('undo'));
    undo.append(el('span', { html: '撤销整段' }));
    undo.onclick = async () => {
      await batchSetStatus(activeItems, 'pending');
      toast('已撤销');
      refresh();
    };
    actions.append(undo);
  } else {
    const takeBtn = el('button', { class: 'btn success' });
    takeBtn.append(icon('check'));
    takeBtn.append(el('span', { html: canTakeAll ? '全部已服用' : `${formatClock(earliestAllowed)} 后可服用` }));
    if (!canTakeAll) takeBtn.setAttribute('disabled', 'true');
    takeBtn.onclick = async () => {
      if (!canTakeAll) return;
      const targets = pendingItems(activeItems);
      // 相互作用确认：若待服药品存在已知相互作用，弹确认对话框
      const hits = checkInteractions(targets.map((t) => t.med.name));
      if (hits.length > 0) {
        const msg = buildTodayInteractionWarning(hits);
        if (!(await confirmDialog(msg, '仍要记录', true))) {
          return;
        }
      }
      await batchSetStatus(targets, 'taken');
      toast(`${targets.length} 种药已记录`);
      refresh();
    };
    const skipBtn = el('button', { class: 'btn tonal' });
    skipBtn.append(icon('undo'));
    skipBtn.append(el('span', { html: '跳过整段' }));
    skipBtn.onclick = async () => {
      const targets = pendingItems(activeItems);
      await batchSetStatus(targets, 'skipped');
      toast('已记录为跳过');
      refresh();
    };
    actions.append(takeBtn, skipBtn);
  }
  card.append(actions);

  return card;
}

/** 构造今日服药时相互作用确认对话框文案 */
function buildTodayInteractionWarning(hits: DrugInteraction[]): string {
  const sevCn = (s: DrugInteraction['severity']) => (s === 'severe' ? '严重' : s === 'moderate' ? '中等' : '轻微');
  const lines = hits.map(
    (h) => `注意：${h.drugs.join(' 与 ')} 存在相互作用（${sevCn(h.severity)}：${h.description}）`,
  );
  return lines.join('<br><br>') + '<br><br>仍要记录为已服用吗？';
}

async function batchSetStatus(items: TodayItem[], status: IntakeLog['status']): Promise<void> {
  for (const it of items) {
    const logId = makeLogId(it.rule.id, it.dueAt);
    const log: IntakeLog = it.log || {
      id: logId,
      medId: it.med.id,
      slot: it.rule.slot,
      dueAt: it.dueAt,
      status: 'pending',
      updatedAt: 0,
    };
    const previous = log.status;
    if (previous === 'taken' && status !== 'taken') {
      const delta = log.inventoryDelta ?? inferDoseQuantity(it.med.amountPerDose, it.med.inventory?.unit).quantity;
      if (restoreInventory(it.med, delta)) {
        await putMed(it.med);
      }
      log.inventoryDelta = undefined;
    }
    log.status = status;
    log.ackAt = status === 'pending' ? undefined : Date.now();
    if (status === 'taken' && previous !== 'taken') {
      const dose = inferDoseQuantity(it.med.amountPerDose, it.med.inventory?.unit).quantity;
      const inv = deductInventory(it.med);
      if (inv.changed) log.inventoryDelta = dose;
      if (inv.changed) {
        if (inv.low && inv.message) {
          toast(inv.message);
          if (shouldSendLowStockReminder(it.med)) {
            it.med.inventory!.lastReminderAt = Date.now();
            void showNotification('药量快不够了', {
              body: inv.message,
              tag: `inventory_${it.med.id}`,
              data: { kind: 'inventory', medId: it.med.id },
            });
          }
        }
        await putMed(it.med);
      }
    }
    await putLog(log);
    it.log = log;
    if (status !== 'pending') {
      void closeNotificationsByTag(logId);
      void closeNotificationsByTag(logId + '_care');
    }
  }
}

function pendingItems(items: TodayItem[]): TodayItem[] {
  return items.filter((i) => i.log?.status !== 'taken' && i.log?.status !== 'skipped');
}

function makeLogId(ruleId: string, dueAt: number): string {
  return `${ruleId}_${ymd(new Date(dueAt))}`;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
