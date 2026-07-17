import {
  batchMarkSettled,
  calculateWorkIncome,
  calculateWorkIncomeRange,
  createPaySnapshot,
  exportWorkEntriesCsv,
  listWorkEntries,
  listWorkEntriesByProfile,
  listWorkIncomeByProfile,
  listWorkIncomeSummary,
  listWorkProfiles,
  listWorkSettlements,
  markWorkEntrySettled,
  markWorkSettlementSettled,
  putWorkEntry,
  putWorkProfile,
  putWorkSettlement,
  RunningWorkEntryConflictError,
  startWorkEntry,
  softDeleteWorkEntry,
  softDeleteWorkProfile,
  workUid,
} from '../db/work';
import type { WorkEntry, WorkPayMode, WorkProfile, WorkSettlement } from '../db/schema';
import {
  effectiveWorkDurationMs,
  resolveWorkBreakMinutes,
  type WorkRangeIncomeResult,
} from '../domain/workIncome';
import {
  closeDialog,
  confirmDialog,
  el,
  icon,
  openDialog,
  renderPage,
  toast,
} from '../ui/components';
import { exportWorkReport } from '../tools/registry';
import {
  createDateControl,
  createDateTimeControl,
  createSelectControl,
  createTimeControl,
} from '../ui/primitives/Pickers';

const LAST_WORK_ENTRY_KEY = 'medbox.lastWorkEntry';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const PAGE_SIZE = 20;

type WorkFilter = 'today' | 'week' | 'month' | 'all';
/** Hero 卡片区间选择 */
type HeroRange = 'today' | 'week' | 'month' | 'custom';
/** 班次标签预设 */
const TAG_OPTIONS = ['加班', '节假日', '外勤', '补班'] as const;
type WorkTag = (typeof TAG_OPTIONS)[number];
const MAX_TASK_TEMPLATES = 10;
const CURRENCY_FORMAT = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const DATE_TIME_FORMAT = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const TIME_FORMAT = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

let currentFilter: WorkFilter = 'today';
let shownCount = PAGE_SIZE;
let heroRange: HeroRange = 'today';
let heroCustomStart: number | undefined;
let heroCustomEnd: number | undefined;
let multiSelectMode = false;
const selectedEntryIds = new Set<string>();
let workPageGeneration = 0;
let activeWorkPageCleanup: (() => void) | undefined;

export interface WorkPageLifecycle {
  isActive: () => boolean;
  refresh: () => Promise<void>;
  dispose: () => void;
}

export function createWorkPageLifecycle(
  signal: AbortSignal | undefined,
  generation: number,
  getCurrentGeneration: () => number,
  rerender: () => Promise<unknown>,
): WorkPageLifecycle {
  let disposed = false;
  const isActive = () => !disposed && !signal?.aborted && generation === getCurrentGeneration();
  return {
    isActive,
    refresh: async () => {
      if (!isActive()) return;
      await rerender();
    },
    dispose: () => {
      disposed = true;
    },
  };
}

interface WorkPageState {
  root: HTMLElement;
  isActive: () => boolean;
  refresh: () => Promise<void>;
  profiles: WorkProfile[];
  entries: WorkEntry[];
  filteredEntries: WorkEntry[];
  settlements: WorkSettlement[];
  filteredRange: { start: number; end: number };
  filteredCalculation: WorkRangeIncomeResult;
  running?: WorkEntry;
  now: number;
}

export async function renderWorkLogPage(
  root: HTMLElement,
  signal?: AbortSignal,
): Promise<() => void> {
  activeWorkPageCleanup?.();
  const generation = ++workPageGeneration;
  let tickTimer: number | undefined;
  const lifecycle = createWorkPageLifecycle(
    signal,
    generation,
    () => workPageGeneration,
    () => renderWorkLogPage(root, signal),
  );
  const cleanup = () => {
    signal?.removeEventListener('abort', cleanup);
    lifecycle.dispose();
    if (tickTimer !== undefined) window.clearInterval(tickTimer);
    tickTimer = undefined;
    if (activeWorkPageCleanup === cleanup) activeWorkPageCleanup = undefined;
  };
  activeWorkPageCleanup = cleanup;
  signal?.addEventListener('abort', cleanup, { once: true });
  if (!lifecycle.isActive()) return cleanup;
  renderWorkShell(root, '正在打开上班记录…');
  try {
    const now = Date.now();
    const range = filterRange(currentFilter, now);
    const [profiles, entries, settlements] = await Promise.all([
      listWorkProfiles(),
      listWorkEntries(),
      listWorkSettlements(),
    ]);
    if (!lifecycle.isActive()) return cleanup;
    const filteredRange = range ?? allEntriesRange(entries, now);
    const filteredCalculation = calculateWorkIncomeRange(
      entries,
      profiles,
      settlements,
      filteredRange.start,
      filteredRange.end,
      now,
    );
    const includedIds = new Set(filteredCalculation.entryContributions.map((row) => row.entryId));
    const filteredEntries = entries.filter((entry) => includedIds.has(entry.id));
    const state: WorkPageState = {
      root,
      isActive: lifecycle.isActive,
      refresh: lifecycle.refresh,
      profiles,
      entries,
      filteredEntries,
      settlements,
      filteredRange,
      filteredCalculation,
      running: entries.find((e) => e.status === 'running' && !e.deleted),
      now,
    };

    const content = el('div', { class: 'page page-light work-page' });
    content.append(renderHero(state));
    content.append(renderTimerCard(state));
    content.append(renderProfilesCard(state));
    content.append(renderManualEntryCard(state));
    content.append(renderEntriesCard(state));
    content.append(renderCompareCard(state));
    // 多选模式底部操作栏
    if (multiSelectMode) content.append(renderBatchActionBar(state));

    if (!state.isActive()) return cleanup;
    renderPage({ root, title: '工时收入', activeTab: 'work', content });
    if (state.running) {
      tickTimer = window.setInterval(() => {
        if (state.isActive()) updateRunningUi(state);
      }, 1000);
    }
  } catch (e) {
    if (!lifecycle.isActive()) return cleanup;
    renderWorkShell(root, e instanceof Error ? e.message : '上班记录没打开，刷新一下再试试。');
  }
  return cleanup;
}

function renderWorkShell(root: HTMLElement, message: string): void {
  const content = el('div', { class: 'page page-light work-page' });
  content.append(el('div', { class: 'card' }, [el('div', { class: 'muted', html: message })]));
  renderPage({ root, title: '工时收入', activeTab: 'work', content });
}

function renderHero(state: WorkPageState): HTMLElement {
  const todayRange = rangeFor('today', state.now);
  const monthRange = rangeFor('month', state.now);
  const todaySummary = listWorkIncomeSummary(
    state.entries,
    state.profiles,
    state.settlements,
    todayRange.start,
    todayRange.end,
    state.now,
  );
  const monthSummary = listWorkIncomeSummary(
    state.entries,
    state.profiles,
    state.settlements,
    monthRange.start,
    monthRange.end,
    state.now,
  );
  const selectedRange = heroRangeFor(state.now);
  const selectedSummary = listWorkIncomeSummary(
    state.entries,
    state.profiles,
    state.settlements,
    selectedRange.start,
    selectedRange.end,
    state.now,
  );
  const overview = el('section', { class: 'work-overview', 'aria-label': '收入概览' } as any);
  const hero = el('div', { class: 'card work-hero-card' });
  const heading = el('div', { class: 'work-overview-heading' });
  heading.append(
    el('h2', { text: '收入概览' }),
    el('span', { class: 'muted', text: state.running ? '班次进行中' : '本地记录' }),
  );
  const headline = el('div', { class: 'work-hero-headline' });
  headline.append(
    el('div', { class: 'work-hero-amount', text: moneyText(selectedSummary.estimatedIncome) }),
    el('div', {
      class: 'muted work-hero-caption',
      text: `${heroRangeLabel()}收入 · ${formatDuration(selectedSummary.totalMs)} · 出勤 ${selectedSummary.attendanceDays} 天`,
    }),
  );
  hero.append(heading, headline, buildIncomeTrend(state));

  const bento = el('div', { class: 'work-bento' });
  bento.append(
    metric('本月收入', moneyText(monthSummary.estimatedIncome), `出勤 ${monthSummary.attendanceDays} 天`, 'lilac'),
    metric('今日工时', formatDuration(todaySummary.totalMs), `今日收入 ${moneyText(todaySummary.estimatedIncome)}`),
    metric('待结算', moneyText(monthSummary.pendingIncome), '本月还没拿到手的钱'),
  );
  overview.append(hero, bento);

  const chips: { id: HeroRange; label: string }[] = [
    { id: 'today', label: '今日' },
    { id: 'week', label: '本周' },
    { id: 'month', label: '本月' },
    { id: 'custom', label: '自定义' },
  ];
  const chipRow = el('div', {
    class: 'work-overview-range',
    role: 'group',
    'aria-label': '收入统计区间',
  } as any);
  for (const c of chips) {
    const b = el('button', {
      class: `chip${heroRange === c.id ? ' on' : ''}`,
      type: 'button',
      html: c.label,
      'aria-pressed': String(heroRange === c.id),
    } as any);
    b.onclick = async () => {
      if (!state.isActive()) return;
      heroRange = c.id;
      if (c.id !== 'custom') {
        heroCustomStart = undefined;
        heroCustomEnd = undefined;
      }
      await state.refresh();
    };
    chipRow.append(b);
  }
  hero.append(chipRow);

  if (heroRange === 'custom') {
    const wrap = el('div', { class: 'work-overview-custom' });
    const startPicker = createDateControl({
      value: heroCustomStart ? toDateInputValue(heroCustomStart) : '',
      ariaLabel: '自定义开始日期',
    });
    const endPicker = createDateControl({
      value: heroCustomEnd ? toDateInputValue(heroCustomEnd) : '',
      ariaLabel: '自定义结束日期',
    });
    const startInput = startPicker.input as HTMLInputElement;
    const endInput = endPicker.input as HTMLInputElement;
    const refresh = async () => {
      if (!state.isActive()) return;
      const s = startInput.value ? new Date(startInput.value + 'T00:00:00').getTime() : undefined;
      const e = endInput.value ? new Date(endInput.value + 'T23:59:59.999').getTime() : undefined;
      heroCustomStart = s;
      heroCustomEnd = e;
      await state.refresh();
    };
    startInput.onchange = refresh;
    endInput.onchange = refresh;
    wrap.append(el('span', { class: 'muted', text: '开始' }), startPicker.root, el('span', { class: 'muted', text: '结束' }), endPicker.root);
    hero.append(wrap);
  }
  return overview;
}

/** 图 4 Overview 卡折线图：近 7 天每日收入趋势（珊瑚红折线 + 虚线网格） */
function buildIncomeTrend(state: WorkPageState): HTMLElement {
  const days: { label: string; amount: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(state.now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const start = d.getTime();
    const summary = listWorkIncomeSummary(state.entries, state.profiles, state.settlements, start, start + 86_399_999, state.now);
    days.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, amount: summary.estimatedIncome });
  }
  const w = 300;
  const h = 96;
  const padL = 34;
  const padR = 8;
  const padT = 10;
  const padB = 10;
  const rawMax = Math.max(...days.map((d) => d.amount));
  const max = rawMax > 0 ? rawMax * 1.15 : 100;
  const stepX = (w - padL - padR) / (days.length - 1);
  const yFor = (v: number) => padT + (h - padT - padB) * (1 - v / max);
  const xFor = (i: number) => padL + stepX * i;
  const gridLevels = [max * 0.85, max * 0.5, max * 0.15];
  const fmtTick = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k` : String(Math.round(v)));
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag: string, attrs: Record<string, string>) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  for (const v of gridLevels) {
    const y = yFor(v).toFixed(1);
    svg.append(svgEl('line', { x1: String(padL), y1: y, x2: String(w - padR), y2: y, class: 'trend-grid' }));
    const tick = svgEl('text', { x: String(padL - 6), y, class: 'trend-tick', 'text-anchor': 'end', 'dominant-baseline': 'middle' });
    tick.textContent = fmtTick(v);
    svg.append(tick);
  }
  const pts = days.map((d, i) => `${xFor(i).toFixed(1)},${yFor(d.amount).toFixed(1)}`).join(' ');
  svg.append(svgEl('polyline', { points: pts, class: 'trend-line' }));
  for (let i = 0; i < days.length; i++) {
    svg.append(svgEl('circle', { cx: xFor(i).toFixed(1), cy: yFor(days[i].amount).toFixed(1), r: '2.6', class: 'trend-dot' }));
  }
  const wrap = el('div', { class: 'work-trend' });
  wrap.setAttribute('role', 'img');
  wrap.setAttribute(
    'aria-label',
    `近 7 天收入趋势：${days.map((d) => `${d.label} ${moneyText(d.amount)}`).join('，')}`,
  );
  wrap.append(svg);
  return wrap;
}

function heroRangeFor(now: number): { start: number; end: number } {
  if (heroRange === 'today') return rangeFor('today', now);
  if (heroRange === 'week') return rangeFor('week', now);
  if (heroRange === 'month') return rangeFor('month', now);
  // 自定义：缺省回落到今日
  if (heroCustomStart && heroCustomEnd) return { start: heroCustomStart, end: heroCustomEnd };
  return rangeFor('today', now);
}

function heroRangeLabel(): string {
  if (heroRange === 'today') return '今日';
  if (heroRange === 'week') return '本周';
  if (heroRange === 'month') return '本月';
  return '自定义区间';
}

function toDateInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function renderTimerCard(state: WorkPageState): HTMLElement {
  const card = el('section', { class: `work-timer-card${state.running ? ' is-running' : ' is-ready'}` });
  const heading = el('div', { class: 'work-card-heading' });
  heading.append(el('h2', { html: state.running ? '正在上班' : '快速打卡' }));
  if (state.running) heading.append(el('span', { class: 'work-status-pill', html: '运行中' }));
  card.append(heading);

  if (state.running) {
    const running = state.running;
    const income = calculateWorkIncome(running, state.entries, Date.now());
    card.append(el('div', { class: 'work-running-project', html: running.paySnapshot?.profileName || running.projectName }));
    card.append(el('div', { class: 'muted', html: `${running.taskName || '未命名班次'} · ${payModeLabel(running.paySnapshot?.mode)} · 预计 ${moneyText(income.amount)}` }));
    const elapsed = el('div', { class: 'work-running-time', html: formatDuration(effectiveWorkDurationMs(running, Date.now())) });
    elapsed.setAttribute('data-work-running-elapsed', '1');
    card.append(elapsed);
    card.append(el('div', { class: 'muted', html: `开始于 ${formatDateTime(running.startAt)}` }));
    const row = el('div', { class: 'btn-row work-actions-row' });
    const stop = el('button', { class: 'btn', html: '停止班次' });
    stop.onclick = async () => {
      if (!state.isActive()) return;
      const plannedBreak = Math.max(0, running.breakMinutes || 0);
      if (plannedBreak > 0) {
        const confirmed = await confirmIfActive(
          state,
          `停止后将扣除计划休息 ${plannedBreak} 分钟。需要调整时请先取消并编辑班次。`,
          '确认停止',
        );
        if (!confirmed) return;
      }
      running.status = 'stopped';
      running.endAt = Date.now();
      await putWorkEntry(running);
      showToast(state, '已停止班次');
      await state.refresh();
    };
    const edit = el('button', { class: 'btn tonal', html: '编辑' });
    edit.onclick = () => openEntryDialog(running, state);
    row.append(stop, edit);
    card.append(row);
    return card;
  }

  if (state.profiles.length === 0) {
    card.append(el('div', { class: 'muted', html: '先添加一份工作，才能开始打卡。' }));
    const add = el('button', { class: 'btn', html: '添加工作' });
    add.onclick = () => openProfileDialog(undefined, state);
    card.append(add);
    return card;
  }

  const profile = selectField('选择工作', state.profiles.map((p) => ({ value: p.id, label: `${p.name} · ${payModeLabel(p.payMode)} ${moneyText(p.baseAmount)}` })));
  const task = inputField('任务/说明', 'text', '例如：晚班、外勤、补班');
  // 任务模板 datalist：根据所选 profile 动态填充
  const datalistId = 'work-task-templates';
  task.input.setAttribute('list', datalistId);
  const datalist = el('datalist', { id: datalistId } as any);
  const refreshTaskDatalist = () => {
    if (!state.isActive()) return;
    datalist.replaceChildren();
    const p = state.profiles.find((x) => x.id === profile.input.value);
    for (const t of p?.taskTemplates || []) datalist.append(el('option', { value: t } as any));
  };
  refreshTaskDatalist();
  profile.input.addEventListener('change', refreshTaskDatalist);
  card.append(profile.wrap, task.wrap, datalist);
  const start = el('button', { class: 'btn', html: '开始班次', style: 'margin-top:12px' } as any);
  start.onclick = async () => {
    if (!state.isActive()) return;
    const p = state.profiles.find((x) => x.id === profile.input.value);
    if (!p) return showToast(state, '请选择工作');
    const taskName = task.input.value.trim();
    start.disabled = true;
    start.setAttribute('aria-busy', 'true');
    try {
      const result = await startWorkEntry(newEntryFromProfile(p, Date.now(), undefined, taskName));
      if (!state.isActive()) return;
      if (!result.started) return showToast(state, '已有班次在进行，请先停止');
      // 任务名非空且未在模板中，自动追加（去重，最多 10 条，超出移除最早的）
      if (taskName) await maybeAddTaskTemplate(p, taskName);
      // 记录最近班次信息，供工具箱"一键开始上次班次"使用
      saveLastWorkEntry(p.id, taskName || undefined);
      showToast(state, '开始班次');
      await state.refresh();
    } catch (error) {
      showToast(state, workActionError(error, '开始班次'));
    } finally {
      if (state.isActive()) {
        start.disabled = false;
        start.removeAttribute('aria-busy');
      }
    }
  };
  card.append(start);
  return card;
}

/** 若任务名不在 profile.taskTemplates 中，自动追加并持久化（去重，最多 10 条，超出移除最早的）。 */
async function maybeAddTaskTemplate(profile: WorkProfile, taskName: string): Promise<void> {
  const list = Array.isArray(profile.taskTemplates) ? [...profile.taskTemplates] : [];
  if (list.includes(taskName)) return;
  list.push(taskName);
  while (list.length > MAX_TASK_TEMPLATES) list.shift();
  profile.taskTemplates = list;
  try {
    await putWorkProfile(profile);
  } catch {
    // 模板追加失败不影响班次保存
  }
}

function renderProfilesCard(state: WorkPageState): HTMLElement {
  const card = el('div', { class: 'card work-list-card' });
  const head = el('div', { class: 'work-card-heading' });
  head.append(el('h2', { html: '我的工作' }));
  const add = el('button', { class: 'btn tonal small', html: '新增' });
  add.onclick = () => openProfileDialog(undefined, state);
  head.append(add);
  card.append(head);
  if (state.profiles.length === 0) {
    card.append(el('div', { class: 'muted', html: '还没有添加工作。拿月薪的、按小时算的、干一天结一天的，都能加。' }));
    return card;
  }
  const list = el('div', { class: 'work-profile-list' });
  for (const profile of state.profiles) {
    const row = el('div', { class: 'work-profile-row' });
    row.append(el('div', { class: 'grow' }, [
      el('div', { class: 'work-entry-title', html: profile.name }),
      el('div', { class: 'muted', html: `${payModeLabel(profile.payMode)} · ${moneyText(profile.baseAmount)}${profile.payMode === 'salary' ? '/月' : profile.payMode === 'hourly' ? '/小时' : '/天'}` }),
    ]));
    const actions = el('div', { class: 'work-entry-actions' });
    const edit = el('button', { class: 'btn text small', html: '编辑' });
    edit.onclick = () => openProfileDialog(profile, state);
    const del = el('button', { class: 'btn text small danger-text', html: '删除' });
    del.onclick = async () => {
      if (!state.isActive()) return;
      const ok = await confirmIfActive(state, '删掉这份工作？之前记过的班次都会留着。', '删除', true);
      if (!ok) return;
      await softDeleteWorkProfile(profile.id);
      showToast(state, '已删掉这份工作');
      await state.refresh();
    };
    actions.append(edit, del);
    row.append(actions);
    list.append(row);
  }
  card.append(list);
  return card;
}

function renderManualEntryCard(state: WorkPageState): HTMLElement {
  const card = el('details', { class: 'card work-manual-card' } as any);
  const summary = el('summary', { class: 'work-details-summary ui-accordion-summary' });
  const titleWrap = el('span', { class: 'work-details-summary-copy' });
  titleWrap.append(el('span', { html: '手动补一班' }));
  titleWrap.append(el('span', { class: 'muted', html: '忘了打卡就在这里补' }));
  const chevron = el('span', { class: 'ui-accordion-chevron', 'aria-hidden': 'true' } as any);
  chevron.append(icon('chevron-right'));
  summary.append(titleWrap, chevron);
  card.append(summary);
  if (state.profiles.length === 0) {
    card.append(el('div', { class: 'muted', html: '先在上面新增一份工作，才能补班次。' }));
    return card;
  }
  card.append(el('div', { class: 'muted work-assistant-hint', html: '也可以点右下角的小助手，直接说"昨天 10 点到 6 点，日结 180"，它会帮你记上。' }));
  const form = renderEntryForm({ state });
  const quick = el('div', { class: 'work-quick-row' });
  const oneHour = el('button', { class: 'chip', type: 'button', html: '刚刚结束 1 小时' } as any);
  const workday = el('button', { class: 'chip', type: 'button', html: '今天默认班次' } as any);
  oneHour.onclick = () => {
    if (state.isActive()) form.setRange(new Date(Date.now() - HOUR), new Date());
  };
  workday.onclick = () => {
    if (!state.isActive()) return;
    const p = state.profiles.find((x) => x.id === form.profileInput.value) || state.profiles[0];
    form.setRange(todayAt(p.defaultStartTime || '09:00'), todayAt(p.defaultEndTime || '18:00'));
    form.breakInput.value = String(p.defaultBreakMinutes || 0);
  };
  quick.append(oneHour, workday);
  card.append(quick, form.wrap);
  const save = el('button', { class: 'btn tonal', html: '保存班次', style: 'margin-top:12px' } as any);
  save.onclick = async () => {
    if (!state.isActive()) return;
    const values = readEntryForm(form, state);
    const error = validateEntry(values);
    if (error) return showToast(state, error);
    try {
      await putWorkEntry(values);
    } catch (error) {
      showToast(state, workActionError(error, '更新班次'));
      return;
    }
    showToast(state, '已保存班次');
    await state.refresh();
  };
  card.append(save);
  return card;
}

function renderEntriesCard(state: WorkPageState): HTMLElement {
  const card = el('div', { class: 'card work-list-card' });
  const head = el('div', { class: 'work-card-heading' });
  head.append(el('h2', { html: '收入明细' }));
  const actions = el('div', { class: 'work-card-actions' });
  const multiBtn = el('button', {
    class: `btn tonal small${multiSelectMode ? ' on' : ''}`,
    type: 'button',
    html: multiSelectMode ? '退出多选' : '多选',
    'aria-pressed': String(multiSelectMode),
  } as any);
  multiBtn.onclick = async () => {
    if (!state.isActive()) return;
    multiSelectMode = !multiSelectMode;
    if (!multiSelectMode) selectedEntryIds.clear();
    await state.refresh();
  };
  const reportBtn = el('button', { class: 'btn tonal small', html: '导出报表' });
  reportBtn.onclick = () => openReportDialog(state);
  const exportBtn = el('button', { class: 'btn tonal small', html: '导出 CSV' });
  exportBtn.onclick = async () => {
    if (!state.isActive()) return;
    const csv = await exportWorkEntriesCsv(state.entries, {
      profiles: state.profiles,
      settlements: state.settlements,
      rangeStart: state.filteredRange.start,
      rangeEnd: state.filteredRange.end,
      now: state.now,
    });
    if (!state.isActive()) return;
    downloadText(csv, `work-income-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
    showToast(state, '已导出 CSV');
  };
  actions.append(multiBtn, reportBtn, exportBtn);
  head.append(actions);
  card.append(head, renderFilterBar(state));
  card.append(el('div', {
    class: 'muted work-multi-hint',
    html: `${filterLabel(currentFilter)}合计 ${moneyText(state.filteredCalculation.summary.estimatedIncome)} · ${formatDuration(state.filteredCalculation.summary.totalMs)}`,
  }));
  if (multiSelectMode && selectedEntryIds.size > 0) {
    card.append(el('div', { class: 'muted work-multi-hint', html: `已选 ${selectedEntryIds.size} 条班次` }));
  }
  const shown = state.filteredEntries.slice(0, shownCount);
  if (shown.length === 0) {
    card.append(el('div', { class: 'muted', html: '这个范围还没有班次记录。' }));
    card.append(renderSalarySettlements(state));
    return card;
  }
  const list = el('div', { class: 'work-entry-list' });
  for (const entry of shown) list.append(renderEntryRow(entry, state));
  card.append(list);
  if (shown.length < state.filteredEntries.length) {
    const more = el('button', { class: 'btn text work-more-btn', html: `查看更多（剩余 ${state.filteredEntries.length - shown.length} 条）` });
    more.onclick = async () => {
      if (!state.isActive()) return;
      shownCount += PAGE_SIZE;
      await state.refresh();
    };
    card.append(more);
  }
  card.append(renderSalarySettlements(state));
  return card;
}

function renderEntryRow(entry: WorkEntry, state: WorkPageState): HTMLElement {
  const income = state.filteredCalculation.entryContributions.find((row) => row.entryId === entry.id)
    ?? calculateWorkIncome(entry, state.entries, state.now);
  const runningClass = entry.status === 'running' ? ' running' : '';
  // running 班次优先显示运行中样式，不叠加 settled/pending 背景色
  const settledClass = entry.status === 'running'
    ? ''
    : (entry.settlementStatus === 'settled' ? ' settled' : ' pending');
  const row = el('div', { class: `work-entry-row${runningClass}${settledClass}` });
  // 多选模式下左侧显示复选框
  if (multiSelectMode) {
    const projectName = entry.paySnapshot?.profileName || entry.projectName || '未命名项目';
    const taskName = entry.taskName || '班次';
    const checkbox = el('input', {
      type: 'checkbox',
      class: 'work-entry-check',
      'aria-label': `选择班次：${projectName}，${taskName}`,
    } as any) as HTMLInputElement;
    checkbox.checked = selectedEntryIds.has(entry.id);
    checkbox.onchange = async () => {
      if (!state.isActive()) return;
      if (checkbox.checked) selectedEntryIds.add(entry.id);
      else selectedEntryIds.delete(entry.id);
      await state.refresh();
    };
    const checkboxWrap = el('label', { class: 'work-entry-check-wrap' }, [checkbox]);
    row.append(checkboxWrap);
  }
  const main = el('div', { class: 'grow' });
  main.append(el('div', { class: 'work-entry-title', html: entry.paySnapshot?.profileName || entry.projectName }));
  main.append(el('div', { class: 'muted', html: `${entry.taskName || '班次'} · ${formatDateTime(entry.startAt)} - ${entry.endAt ? formatTime(entry.endAt) : '进行中'} · ${formatDuration(income.effectiveMs)}` }));
  if (!income.billable && entry.paySnapshot?.mode === 'daily') main.append(el('div', { class: 'muted work-entry-note', html: '同一天日结已计入第一条班次' }));
  // 标签 chip 行
  const tags = (entry.tags || []).filter((t) => (TAG_OPTIONS as readonly string[]).includes(t));
  if (tags.length > 0) {
    const tagRow = el('div', { class: 'work-entry-tags' });
    for (const t of tags) tagRow.append(el('span', { class: 'tag-chip', html: t }));
    main.append(tagRow);
  }
  if (entry.note) main.append(el('div', { class: 'muted work-entry-note', html: entry.note }));
  const side = el('div', { class: 'work-entry-side' });
  side.append(el('div', { class: 'work-entry-duration', html: moneyText(income.amount) }));
  side.append(el('div', { class: `work-settle-pill ${entry.settlementStatus === 'settled' ? 'settled' : ''}`, html: entry.settlementStatus === 'settled' ? '已结算' : '待结算' }));
  const actions = el('div', { class: 'work-entry-actions' });
  // 多选模式下隐藏单条操作，仅保留编辑
  const edit = el('button', { class: 'btn text small', html: '编辑' });
  edit.onclick = () => openEntryDialog(entry, state);
  if (!multiSelectMode) {
    const settle = el('button', { class: 'btn text small', html: entry.settlementStatus === 'settled' ? '改待结' : '已结' });
    settle.onclick = async () => {
      if (!state.isActive()) return;
      await markWorkEntrySettled(entry.id, entry.settlementStatus === 'settled' ? 'pending' : 'settled');
      await state.refresh();
    };
    const again = el('button', { class: 'btn text small', html: '继续' });
    again.onclick = () => continueEntry(entry, state);
    const del = el('button', { class: 'btn text small danger-text', html: '删除' });
    del.onclick = async () => {
      if (!state.isActive()) return;
      const ok = await confirmIfActive(state, '删除这条班次记录？', '删除', true);
      if (!ok) return;
      await softDeleteWorkEntry(entry.id);
      showToast(state, '已删除');
      await state.refresh();
    };
    actions.append(settle, edit, again, del);
  } else {
    actions.append(edit);
  }
  side.append(actions);
  row.append(main, side);
  return row;
}

/** 多选模式底部操作栏：标记已结算 / 待结算 + 取消多选 */
function renderBatchActionBar(state: WorkPageState): HTMLElement {
  const bar = el('div', { class: 'work-batch-bar' });
  const hint = el('span', { class: 'muted', html: `已选 ${selectedEntryIds.size} 条` });
  const settledBtn = el('button', { class: 'btn tonal small', html: '标记已结算' });
  settledBtn.onclick = async () => {
    if (!state.isActive()) return;
    if (selectedEntryIds.size === 0) return showToast(state, '请先选择班次');
    await batchMarkSettled([...selectedEntryIds], true);
    if (!state.isActive()) return;
    showToast(state, '已批量标记为已结算');
    selectedEntryIds.clear();
    multiSelectMode = false;
    await state.refresh();
  };
  const pendingBtn = el('button', { class: 'btn tonal small', html: '标记待结算' });
  pendingBtn.onclick = async () => {
    if (!state.isActive()) return;
    if (selectedEntryIds.size === 0) return showToast(state, '请先选择班次');
    await batchMarkSettled([...selectedEntryIds], false);
    if (!state.isActive()) return;
    showToast(state, '已批量标记为待结算');
    selectedEntryIds.clear();
    multiSelectMode = false;
    await state.refresh();
  };
  const cancelBtn = el('button', { class: 'btn text small', html: '退出多选' });
  cancelBtn.onclick = async () => {
    if (!state.isActive()) return;
    multiSelectMode = false;
    selectedEntryIds.clear();
    await state.refresh();
  };
  bar.append(hint, settledBtn, pendingBtn, cancelBtn);
  return bar;
}

function renderSalarySettlements(state: WorkPageState): HTMLElement {
  const salaryProfiles = state.profiles.filter((p) => p.payMode === 'salary');
  const wrap = el('div', { class: 'work-salary-settlements' });
  if (salaryProfiles.length === 0 || currentFilter === 'today') return wrap;
  wrap.append(el('h2', { html: '固定薪资结算' }));
  const periodKey = monthKey(state.now);
  for (const profile of salaryProfiles) {
    const settlement = state.settlements.find((s) => s.profileId === profile.id && s.periodKey === periodKey && !s.deleted);
    const row = el('div', { class: 'work-profile-row' });
    row.append(el('div', { class: 'grow' }, [
      el('div', { class: 'work-entry-title', html: `${profile.name} · ${periodKey}` }),
      el('div', { class: 'muted', html: `${moneyText(settlement?.amount ?? profile.baseAmount)} · ${settlement?.status === 'settled' ? '已结算' : '待结算'}` }),
    ]));
    const btn = el('button', { class: 'btn text small', html: settlement?.status === 'settled' ? '改待结' : '已结算' });
    btn.onclick = async () => {
      if (!state.isActive()) return;
      const id = `${profile.id}_${periodKey}`;
      if (!settlement) {
        await putWorkSettlement({ id, profileId: profile.id, periodKey, amount: profile.baseAmount, status: 'settled', settledAt: Date.now(), updatedAt: Date.now() });
      } else {
        await markWorkSettlementSettled(id, settlement.status === 'settled' ? 'pending' : 'settled');
      }
      await state.refresh();
    };
    row.append(btn);
    wrap.append(row);
  }
  return wrap;
}

/** 按工作档案分组对比视图：使用 hero 当前选择的区间 */
function renderCompareCard(state: WorkPageState): HTMLElement {
  const card = el('div', { class: 'card work-list-card work-compare-card' });
  const head = el('div', { class: 'work-card-heading' });
  head.append(el('h2', { html: '几份工作各挣多少' }));
  const rangeLabel = el('span', { class: 'muted', html: heroRangeLabel() });
  head.append(rangeLabel);
  card.append(head);
  if (state.profiles.length === 0) {
    card.append(el('div', { class: 'muted', html: '还没有添加工作。' }));
    return card;
  }
  const heroR = heroRangeFor(state.now);
  // 列表加载是异步的，使用占位后再填充
  const listWrap = el('div', { class: 'work-compare-list' });
  listWrap.append(el('div', { class: 'muted', html: '正在算…' }));
  card.append(listWrap);
  void Promise.all([
    listWorkIncomeByProfile(state.entries, state.profiles, state.settlements, heroR.start, heroR.end, state.now),
    // 同时拉取每个 profile 的最新班次（用于展示最近一次班次信息）
    Promise.all(state.profiles.map((p) => listWorkEntriesByProfile(p.id).then((entries) => ({ profileId: p.id, latest: entries[0] })))),
  ]).then(([rows, latests]) => {
    if (!state.isActive()) return;
    listWrap.replaceChildren();
    if (rows.length === 0) {
      listWrap.append(el('div', { class: 'muted', html: '该区间没有班次数据。' }));
      return;
    }
    const latestMap = new Map(latests.map((x) => [x.profileId, x.latest]));
    const totalIncome = rows.reduce((sum, row) => sum + row.totalIncome, 0);
    const totalMs = rows.reduce((sum, row) => sum + row.totalMs, 0);
    const tints = ['tint-gray', '', 'tint-blue', 'tint-pink', 'tint-green', 'tint-orange'];
    rows.forEach((row, index) => {
      const share = totalIncome > 0
        ? Math.round((row.totalIncome / totalIncome) * 100)
        : totalMs > 0
          ? Math.round((row.totalMs / totalMs) * 100)
          : 0;
      const item = el('div', { class: 'work-compare-row' });
      const iconWrap = el('span', { class: `tint-icon ${tints[index % tints.length]}`.trim() });
      iconWrap.append(icon('briefcase'));
      const main = el('div', { class: 'work-compare-main' });
      const titleRow = el('div', { class: 'work-compare-title-row' });
      titleRow.append(
        el('span', { class: 'work-entry-title', html: row.profileName }),
        el('span', { class: 'muted work-compare-share', html: `${share}%` }),
        el('span', { class: 'work-compare-amount', html: moneyText(row.totalIncome) }),
      );
      main.append(titleRow);
      const meta = el('div', { class: 'muted work-compare-meta', html: `${formatDuration(row.totalMs)} · ${row.entryCount} 班` });
      main.append(meta);
      const latest = latestMap.get(row.profileId);
      if (latest) {
        main.append(el('div', { class: 'muted work-compare-latest', html: `最近：${latest.taskName || '班次'} · ${formatDateTime(latest.startAt)}` }));
      }
      const bar = el('div', { class: 'work-compare-bar' });
      const fill = el('i');
      fill.style.inlineSize = `${Math.max(share, 2)}%`;
      bar.append(fill);
      main.append(bar);
      item.append(iconWrap, main);
      listWrap.append(item);
    });
  }).catch(() => {
    if (!state.isActive()) return;
    listWrap.replaceChildren(el('div', { class: 'muted', html: '这里没算出来，过会儿再看看。' }));
  });
  return card;
}

/** 导出报表对话框：选择周/月 + 日期，生成 CSV 下载，文本摘要展示可复制 */
function openReportDialog(state: WorkPageState): void {
  if (!state.isActive()) return;
  let overlay: HTMLElement;
  const box = el('div', { class: 'card work-edit-dialog' });
  box.append(el('h3', { html: '导出区间报表' }));
  const modeField = selectField('报表周期', [
    { value: 'week', label: '本周（按周）' },
    { value: 'month', label: '本月（按月）' },
  ]);
  modeField.input.value = 'month';
  const startField = inputField('开始日期', 'date');
  const endField = inputField('结束日期', 'date');
  // 默认填充本月
  const monthRange = rangeFor('month', state.now);
  startField.input.value = toDateInputValue(monthRange.start);
  endField.input.value = toDateInputValue(monthRange.end);
  // 快捷：本周 / 本月 chip
  const quickRow = el('div', { class: 'work-quick-row' });
  const weekChip = el('button', { class: 'chip', type: 'button', html: '本周' } as any);
  weekChip.onclick = () => {
    if (!state.isActive()) return;
    modeField.input.value = 'week';
    const r = rangeFor('week', state.now);
    startField.input.value = toDateInputValue(r.start);
    endField.input.value = toDateInputValue(r.end);
    refreshPreview();
  };
  const monthChip = el('button', { class: 'chip', type: 'button', html: '本月' } as any);
  monthChip.onclick = () => {
    if (!state.isActive()) return;
    modeField.input.value = 'month';
    const r = rangeFor('month', state.now);
    startField.input.value = toDateInputValue(r.start);
    endField.input.value = toDateInputValue(r.end);
    refreshPreview();
  };
  quickRow.append(weekChip, monthChip);
  box.append(modeField.wrap, quickRow, startField.wrap, endField.wrap);

  const summaryBox = el('div', { class: 'work-report-summary' });
  const summaryText = el('textarea', { class: 'work-report-summary-text', readonly: true } as any) as HTMLTextAreaElement;
  summaryText.id = 'work-report-summary';
  summaryText.name = summaryText.id;
  summaryBox.append(el('label', { html: '区间摘要（可复制）', htmlFor: summaryText.id } as any), summaryText);
  box.append(summaryBox);

  const refreshPreview = () => {
    if (!state.isActive()) return;
    const startMs = new Date(startField.input.value + 'T00:00:00').getTime();
    const endMs = new Date(endField.input.value + 'T23:59:59.999').getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
      summaryText.value = '请选择有效的开始/结束日期';
      return;
    }
    const mode = modeField.input.value === 'week' ? 'week' : 'month';
    const { summary } = exportWorkReport(
      state.entries,
      state.profiles,
      state.settlements,
      startMs,
      endMs,
      mode,
      state.now,
    );
    summaryText.value = summary;
  };
  refreshPreview();
  startField.input.addEventListener('change', refreshPreview);
  endField.input.addEventListener('change', refreshPreview);
  modeField.input.addEventListener('change', refreshPreview);

  const row = el('div', { class: 'btn-row' });
  const cancel = el('button', { class: 'btn text', html: '取消' });
  const download = el('button', { class: 'btn', html: '下载 CSV' });
  cancel.onclick = () => {
    if (state.isActive()) closeDialog(overlay);
  };
  download.onclick = () => {
    if (!state.isActive()) return;
    const startMs = new Date(startField.input.value + 'T00:00:00').getTime();
    const endMs = new Date(endField.input.value + 'T23:59:59.999').getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
      showToast(state, '请选择有效的开始/结束日期');
      return;
    }
    const mode = modeField.input.value === 'week' ? 'week' : 'month';
    const { csv } = exportWorkReport(
      state.entries,
      state.profiles,
      state.settlements,
      startMs,
      endMs,
      mode,
      state.now,
    );
    const startStr = startField.input.value || 'report';
    const endStr = endField.input.value || '';
    const fname = `work-report-${startStr}${endStr ? `_to_${endStr}` : ''}.csv`;
    downloadText(csv, fname, 'text/csv;charset=utf-8');
    showToast(state, '已下载 CSV 报表');
  };
  row.append(cancel, download);
  box.append(row);
  overlay = openDialog(box, { initialFocus: modeField.input });
}

function renderFilterBar(state: WorkPageState): HTMLElement {
  const filters: { id: WorkFilter; label: string }[] = [
    { id: 'today', label: '今日' },
    { id: 'week', label: '本周' },
    { id: 'month', label: '本月' },
    { id: 'all', label: '全部' },
  ];
  const row = el('div', {
    class: 'work-filter-row',
    role: 'group',
    'aria-label': '班次筛选区间',
  } as any);
  for (const filter of filters) {
    const b = el('button', {
      class: `chip${currentFilter === filter.id ? ' on' : ''}`,
      type: 'button',
      html: filter.label,
      'aria-pressed': String(currentFilter === filter.id),
    } as any);
    b.onclick = async () => {
      if (!state.isActive()) return;
      currentFilter = filter.id;
      shownCount = PAGE_SIZE;
      // 切换过滤区间时清空多选状态
      multiSelectMode = false;
      selectedEntryIds.clear();
      await state.refresh();
    };
    row.append(b);
  }
  return row;
}

function openProfileDialog(profile: WorkProfile | undefined, state: WorkPageState): void {
  if (!state.isActive()) return;
  let overlay: HTMLElement;
  const box = el('div', { class: 'card work-edit-dialog' });
  box.append(el('h3', { html: profile ? '编辑这份工作' : '添加工作' }));
  const name = inputField('工作名称', 'text', '例如：奶茶店');
  const mode = selectField('薪资模式', [
    { value: 'hourly', label: '时薪' },
    { value: 'daily', label: '日结' },
    { value: 'salary', label: '固定薪资' },
  ]);
  const amount = inputField('金额', 'number', '0');
  amount.input.step = '0.01';
  const expected = inputField('月应出勤天数', 'number', '可选');
  const start = inputField('默认开始', 'time');
  const end = inputField('默认结束', 'time');
  const rest = inputField('默认休息分钟', 'number', '0');
  const note = el('textarea', { placeholder: '备注，可选' } as any) as HTMLTextAreaElement;
  name.input.value = profile?.name || '';
  mode.input.value = profile?.payMode || 'hourly';
  amount.input.value = String(profile?.baseAmount || '');
  expected.input.value = String(profile?.expectedWorkDaysPerMonth || '');
  start.input.value = profile?.defaultStartTime || '09:00';
  end.input.value = profile?.defaultEndTime || '18:00';
  rest.input.value = String(profile?.defaultBreakMinutes ?? 60);
  note.value = profile?.note || '';
  box.append(name.wrap, mode.wrap, amount.wrap, expected.wrap, start.wrap, end.wrap, rest.wrap, fieldWrap('备注', note));

  // 任务模板管理区：最多 10 条
  const templates: string[] = Array.isArray(profile?.taskTemplates) ? [...profile!.taskTemplates!] : [];
  const templateSection = el('div', { class: 'field work-template-field' });
  const labelNode = el('label', { html: `任务模板（${templates.length}/${MAX_TASK_TEMPLATES}）` });
  const chipList = el('div', { class: 'work-template-chips' });
  const updateLabel = () => {
    labelNode.textContent = `任务模板（${templates.length}/${MAX_TASK_TEMPLATES}）`;
  };
  const renderChips = () => {
    chipList.replaceChildren();
    if (templates.length === 0) {
      chipList.append(el('span', { class: 'muted', html: '暂无模板，可在下方输入并添加。' }));
      return;
    }
    for (let i = 0; i < templates.length; i++) {
      const idx = i;
      const item = el('span', { class: 'work-template-chip' });
      item.append(el('span', { html: templates[idx] }));
      const delBtn = el('button', { class: 'btn text small work-template-del', type: 'button', 'aria-label': '删除该模板', html: '×' } as any);
      delBtn.onclick = () => {
        if (!state.isActive()) return;
        templates.splice(idx, 1);
        renderChips();
        updateLabel();
      };
      item.append(delBtn);
      chipList.append(item);
    }
  };
  templateSection.append(labelNode, chipList);
  const newTplInput = el('input', { type: 'text', placeholder: '输入新模板后回车 / 点击添加', class: 'work-template-input' } as any) as HTMLInputElement;
  newTplInput.id = `work-template-${profile?.id || 'new'}`;
  newTplInput.name = newTplInput.id;
  labelNode.htmlFor = newTplInput.id;
  const addBtn = el('button', { class: 'btn tonal small', type: 'button', html: '添加' });
  const addTemplate = () => {
    if (!state.isActive()) return;
    const v = newTplInput.value.trim();
    if (!v) return;
    if (templates.includes(v)) {
      showToast(state, '该模板已存在');
      return;
    }
    if (templates.length >= MAX_TASK_TEMPLATES) {
      showToast(state, `最多 ${MAX_TASK_TEMPLATES} 条，请先删除旧的`);
      return;
    }
    templates.push(v);
    newTplInput.value = '';
    renderChips();
    updateLabel();
  };
  addBtn.onclick = addTemplate;
  newTplInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTemplate();
    }
  });
  const addRow = el('div', { class: 'work-template-add' });
  addRow.append(newTplInput, addBtn);
  templateSection.append(addRow);
  renderChips();
  box.append(templateSection);

  const row = el('div', { class: 'btn-row' });
  const cancel = el('button', { class: 'btn text', html: '取消' });
  const save = el('button', { class: 'btn', html: '保存' });
  cancel.onclick = () => {
    if (state.isActive()) closeDialog(overlay);
  };
  save.onclick = async () => {
    if (!state.isActive()) return;
    if (!name.input.value.trim()) return showToast(state, '请填写工作名称');
    await putWorkProfile({
      id: profile?.id || workUid(),
      name: name.input.value.trim(),
      payMode: mode.input.value as WorkPayMode,
      baseAmount: Number(amount.input.value || 0),
      settlementCycle: mode.input.value === 'salary' ? 'month' : mode.input.value === 'daily' ? 'day' : 'entry',
      expectedWorkDaysPerMonth: Number(expected.input.value || 0) || undefined,
      defaultStartTime: start.input.value,
      defaultEndTime: end.input.value,
      defaultBreakMinutes: Number(rest.input.value || 0),
      note: note.value.trim(),
      taskTemplates: templates,
      updatedAt: profile?.updatedAt || Date.now(),
    });
    if (!state.isActive()) return;
    closeDialog(overlay);
    showToast(state, '已保存这份工作');
    await state.refresh();
  };
  row.append(cancel, save);
  box.append(row);
  overlay = openDialog(box, { initialFocus: name.input });
}

function openEntryDialog(entry: WorkEntry, state: WorkPageState): void {
  if (!state.isActive()) return;
  let overlay: HTMLElement;
  const box = el('div', { class: 'card work-edit-dialog' });
  box.append(el('h3', { html: '编辑班次' }));
  const form = renderEntryForm({ state, entry });
  box.append(form.wrap);
  const row = el('div', { class: 'btn-row' });
  const cancel = el('button', { class: 'btn text', html: '取消' });
  const save = el('button', { class: 'btn', html: '保存' });
  cancel.onclick = () => {
    if (state.isActive()) closeDialog(overlay);
  };
  save.onclick = async () => {
    if (!state.isActive()) return;
    const values = readEntryForm(form, state, entry);
    const error = validateEntry(values);
    if (error) return showToast(state, error);
    try {
      await putWorkEntry(values);
    } catch (error) {
      showToast(state, workActionError(error, '更新班次'));
      return;
    }
    if (!state.isActive()) return;
    closeDialog(overlay);
    showToast(state, '已更新班次');
    await state.refresh();
  };
  row.append(cancel, save);
  box.append(row);
  overlay = openDialog(box, { initialFocus: form.profileInput });
}

function renderEntryForm(opts: { state: WorkPageState; entry?: WorkEntry }) {
  const wrap = el('div', { class: 'work-entry-form' });
  const profile = selectField('工作', opts.state.profiles.map((p) => ({ value: p.id, label: p.name })));
  const task = inputField('任务/说明', 'text', '例如：晚班');
  const start = inputField('开始时间', 'datetime-local');
  const end = inputField('结束时间', 'datetime-local');
  const rest = inputField('休息分钟', 'number', '0');
  const amount = inputField('手动覆盖金额', 'number', '留空则自动计算');
  amount.input.step = '0.01';
  const settled = selectField('结算状态', [{ value: 'pending', label: '待结算' }, { value: 'settled', label: '已结算' }]);
  const note = el('textarea', { placeholder: '备注，可选' } as any) as HTMLTextAreaElement;
  const now = new Date();
  profile.input.value = opts.entry?.profileId || opts.state.profiles[0]?.id || '';
  task.input.value = opts.entry?.taskName || '';
  start.input.value = toDateTimeLocal(opts.entry ? new Date(opts.entry.startAt) : new Date(now.getTime() - HOUR));
  end.input.value = toDateTimeLocal(opts.entry?.endAt ? new Date(opts.entry.endAt) : now);
  rest.input.value = String(resolveWorkBreakMinutes(
    opts.entry?.breakMinutes,
    opts.state.profiles.find((p) => p.id === profile.input.value)?.defaultBreakMinutes,
  ));
  amount.input.value = opts.entry?.amountOverride !== undefined ? String(opts.entry.amountOverride) : '';
  settled.input.value = opts.entry?.settlementStatus || 'pending';
  note.value = opts.entry?.note || '';
  wrap.append(profile.wrap, task.wrap, start.wrap, end.wrap, rest.wrap, amount.wrap, settled.wrap, fieldWrap('备注', note));

  // 任务模板 datalist：根据所选 profile 动态填充
  const datalistId = 'work-entry-task-templates';
  task.input.setAttribute('list', datalistId);
  const datalist = el('datalist', { id: datalistId } as any);
  const refreshTaskDatalist = () => {
    if (!opts.state.isActive()) return;
    datalist.replaceChildren();
    const p = opts.state.profiles.find((x) => x.id === profile.input.value);
    for (const t of p?.taskTemplates || []) datalist.append(el('option', { value: t } as any));
  };
  refreshTaskDatalist();
  profile.input.addEventListener('change', refreshTaskDatalist);
  wrap.append(datalist);

  // 标签多选 chip
  const tagsField = el('div', { class: 'field work-tags-field' });
  const tagsLabel = el('div', { html: '标签', id: `work-tags-${++workFieldSeq}` });
  tagsField.append(tagsLabel);
  const selectedTags = new Set<WorkTag>((opts.entry?.tags || []) as WorkTag[]);
  const tagChips = el('div', { class: 'work-tags-row' });
  const renderTagChips = () => {
    tagChips.replaceChildren();
    for (const t of TAG_OPTIONS) {
      const on = selectedTags.has(t);
      const c = el('button', {
        class: `chip${on ? ' on' : ''}`,
        type: 'button',
        html: t,
        'aria-pressed': String(on),
      } as any);
      c.onclick = () => {
        if (!opts.state.isActive()) return;
        if (on) selectedTags.delete(t);
        else selectedTags.add(t);
        renderTagChips();
      };
      tagChips.append(c);
    }
  };
  renderTagChips();
  tagChips.setAttribute('role', 'group');
  tagChips.setAttribute('aria-labelledby', tagsLabel.id);
  tagsField.append(tagChips);
  wrap.append(tagsField);

  return {
    wrap,
    profileInput: profile.input,
    taskInput: task.input,
    startInput: start.input,
    endInput: end.input,
    breakInput: rest.input,
    amountInput: amount.input,
    settledInput: settled.input,
    noteInput: note,
    selectedTags,
    setRange: (s: Date, e: Date) => {
      if (!opts.state.isActive()) return;
      start.input.value = toDateTimeLocal(s);
      end.input.value = toDateTimeLocal(e);
    },
  };
}

function readEntryForm(form: ReturnType<typeof renderEntryForm>, state: WorkPageState, existing?: WorkEntry): WorkEntry {
  const profile = state.profiles.find((p) => p.id === form.profileInput.value) || state.profiles[0];
  const status = existing?.status === 'running' ? 'running' : 'stopped';
  return {
    ...(existing || {}),
    id: existing?.id || workUid(),
    profileId: profile.id,
    projectName: profile.name,
    taskName: form.taskInput.value.trim(),
    paySnapshot: existing?.paySnapshot && existing.profileId === profile.id ? existing.paySnapshot : createPaySnapshot(profile),
    startAt: new Date(form.startInput.value).getTime(),
    endAt: status === 'running' ? undefined : new Date(form.endInput.value).getTime(),
    breakMinutes: Number(form.breakInput.value || 0),
    amountOverride: form.amountInput.value.trim() ? Number(form.amountInput.value) : undefined,
    settlementStatus: form.settledInput.value === 'settled' ? 'settled' : 'pending',
    settledAt: form.settledInput.value === 'settled' ? (existing?.settledAt || Date.now()) : undefined,
    note: form.noteInput.value.trim(),
    tags: [...form.selectedTags],
    status,
    updatedAt: existing?.updatedAt || Date.now(),
  };
}

function validateEntry(entry: WorkEntry): string | undefined {
  if (!entry.profileId) return '请选择工作';
  if (!Number.isFinite(entry.startAt)) return '请填写开始时间';
  if (entry.status !== 'running' && (!entry.endAt || !Number.isFinite(entry.endAt))) return '请填写结束时间';
  if (entry.status !== 'running' && entry.endAt! <= entry.startAt) return '结束时间必须晚于开始时间';
  if (!Number.isFinite(entry.breakMinutes) || entry.breakMinutes < 0) return '休息分钟不能为负数';
  return undefined;
}

async function continueEntry(entry: WorkEntry, state: WorkPageState): Promise<void> {
  if (!state.isActive()) return;
  const profile = state.profiles.find((p) => p.id === entry.profileId) || state.profiles[0];
  let result;
  try {
    result = await startWorkEntry(
      newEntryFromProfile(profile, Date.now(), undefined, entry.taskName),
    );
  } catch (error) {
    showToast(state, workActionError(error, '继续班次'));
    return;
  }
  if (!state.isActive()) return;
  if (!result.started) return showToast(state, '已有班次在进行，请先停止');
  // 同步最近班次信息，供工具箱"一键开始上次班次"使用
  if (profile) saveLastWorkEntry(profile.id, entry.taskName || undefined);
  showToast(state, '已继续该工作');
  await state.refresh();
}

function newEntryFromProfile(profile: WorkProfile, startAt: number, endAt?: number, taskName = ''): WorkEntry {
  return {
    id: workUid(),
    profileId: profile.id,
    projectName: profile.name,
    taskName,
    paySnapshot: createPaySnapshot(profile),
    startAt,
    endAt,
    breakMinutes: profile.defaultBreakMinutes || 0,
    status: endAt ? 'stopped' : 'running',
    settlementStatus: 'pending',
    updatedAt: Date.now(),
  };
}

function showToast(state: WorkPageState, message: string, duration?: number): void {
  if (state.isActive()) toast(message, duration);
}

function workActionError(error: unknown, action: string): string {
  if (error instanceof RunningWorkEntryConflictError) return error.message;
  const detail = error instanceof Error && error.message ? `：${error.message}` : '，请重试';
  return `${action}失败${detail}`;
}

async function confirmIfActive(
  state: WorkPageState,
  message: string,
  confirmText = '确定',
  danger = false,
): Promise<boolean> {
  if (!state.isActive()) return false;
  const confirmed = await confirmDialog(message, confirmText, danger);
  return state.isActive() && confirmed;
}

function metric(label: string, value: string, sub?: string, variant?: 'lilac'): HTMLElement {
  const card = el('div', { class: `work-income-metric${variant ? ` is-${variant}` : ''}` });
  card.append(el('div', { class: 'muted', html: label }));
  card.append(el('div', { class: 'work-summary-value', html: value }));
  if (sub) card.append(el('div', { class: 'muted work-metric-sub', html: sub }));
  return card;
}

function inputField(label: string, type: string, placeholder = ''): { wrap: HTMLElement; input: HTMLInputElement } {
  if (type === 'time') {
    const control = createTimeControl({ ariaLabel: label, placeholder: placeholder || '选择时间' });
    return { wrap: fieldWrap(label, control.root, control.input), input: control.input as HTMLInputElement };
  }
  if (type === 'date') {
    const control = createDateControl({ ariaLabel: label, placeholder: placeholder || '选择日期' });
    return { wrap: fieldWrap(label, control.root, control.input), input: control.input as HTMLInputElement };
  }
  if (type === 'datetime-local') {
    const control = createDateTimeControl({ ariaLabel: label, placeholder: placeholder || '选择日期和时间' });
    return { wrap: fieldWrap(label, control.root, control.input), input: control.input as HTMLInputElement };
  }
  const input = el('input', { type, placeholder } as any) as HTMLInputElement;
  return { wrap: fieldWrap(label, input, input), input };
}

function selectField(label: string, options: { value: string; label: string }[]): { wrap: HTMLElement; input: HTMLSelectElement } {
  const control = createSelectControl({ options, ariaLabel: label, placeholder: '请选择' });
  return { wrap: fieldWrap(label, control.root, control.select), input: control.select };
}

let workFieldSeq = 0;
function fieldWrap(label: string, visible: HTMLElement, control?: HTMLElement): HTMLElement {
  const wrap = el('div', { class: 'field' });
  const target = control ?? visible;
  const id = target.id || `work-field-${++workFieldSeq}`;
  target.id = id;
  if (!target.getAttribute('name')) target.setAttribute('name', id);
  wrap.append(el('label', { html: label, htmlFor: id } as any), visible);
  return wrap;
}

function updateRunningUi(state: WorkPageState): void {
  if (!state.isActive() || !state.running) return;
  const elapsed = state.root.querySelector<HTMLElement>('[data-work-running-elapsed]');
  if (elapsed) elapsed.textContent = formatDuration(effectiveWorkDurationMs(state.running, Date.now()));
}

function filterRange(filter: WorkFilter, now: number): { start: number; end: number } | null {
  if (filter === 'all') return null;
  return rangeFor(filter, now);
}

function allEntriesRange(entries: WorkEntry[], now: number): { start: number; end: number } {
  if (entries.length === 0) return rangeFor('month', now);
  const start = Math.min(...entries.map((entry) => entry.startAt));
  const endExclusive = Math.max(...entries.map((entry) => entry.endAt ?? now), start + 1);
  return { start, end: endExclusive - 1 };
}

function filterLabel(filter: WorkFilter): string {
  if (filter === 'today') return '今日';
  if (filter === 'week') return '本周';
  if (filter === 'month') return '本月';
  return '全部';
}

function rangeFor(filter: Exclude<WorkFilter, 'all'>, now: number): { start: number; end: number } {
  if (filter === 'today') {
    const start = startOfDay(now);
    return { start, end: start + DAY - 1 };
  }
  if (filter === 'week') {
    const start = startOfWeek(now);
    return { start, end: start + 7 * DAY - 1 };
  }
  const start = startOfMonth(now);
  return { start, end: endOfMonth(now) };
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / MINUTE);
  return `${Math.floor(minutes / 60)}小时${String(minutes % 60).padStart(2, '0')}分`;
}

function formatDateTime(ms: number): string {
  return DATE_TIME_FORMAT.format(new Date(ms));
}

function formatTime(ms: number): string {
  return TIME_FORMAT.format(new Date(ms));
}

function moneyText(value: number): string {
  return CURRENCY_FORMAT.format(Number.isFinite(value) ? value : 0);
}

function payModeLabel(mode?: WorkPayMode): string {
  if (mode === 'salary') return '固定薪资';
  if (mode === 'daily') return '日结';
  return '时薪';
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms));
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return d.getTime();
}

function startOfMonth(ms: number): number {
  const d = new Date(ms);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function endOfMonth(ms: number): number {
  const d = new Date(ms);
  d.setMonth(d.getMonth() + 1, 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime() - 1;
}

function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function todayAt(time: string): Date {
  const [h, m] = time.split(':').map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

function toDateTimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function downloadText(text: string, filename: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 写入最近一次班次信息（profileId + taskName），供工具箱"一键开始上次班次"使用。 */
function saveLastWorkEntry(profileId: string, taskName?: string): void {
  try {
    const payload = JSON.stringify({ profileId, taskName });
    localStorage.setItem(LAST_WORK_ENTRY_KEY, payload);
  } catch {
    /* localStorage 不可用时忽略 */
  }
}
