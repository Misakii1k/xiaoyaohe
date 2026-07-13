import { detectWorkEntryIssues, parseWorkEntryText, parseWorkProfileText, summarizeWorkIncome, WorkAiError } from '../ai/workAssistant';
import {
  batchMarkSettled,
  calculateWorkIncome,
  createPaySnapshot,
  exportWorkEntriesCsv,
  getRunningWorkEntry,
  listWorkEntries,
  listWorkEntriesByProfile,
  listWorkEntriesByRange,
  listWorkIncomeByProfile,
  listWorkIncomeSummary,
  listWorkProfiles,
  listWorkSettlements,
  markWorkEntrySettled,
  markWorkSettlementSettled,
  putWorkEntry,
  putWorkProfile,
  putWorkSettlement,
  softDeleteWorkEntry,
  softDeleteWorkProfile,
  workUid,
} from '../db/work';
import type { WorkAiDraft, WorkEntry, WorkPayMode, WorkProfile, WorkSettlement } from '../db/schema';
import { navigate } from '../router';
import { confirmDialog, el, icon, renderPage, toast } from '../ui/components';
import { getLlmConfig } from '../ai/llmConfig';
import { exportWorkReport } from '../tools/registry';

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

let tickTimer: number | undefined;
let currentFilter: WorkFilter = 'today';
let shownCount = PAGE_SIZE;
let heroRange: HeroRange = 'today';
let heroCustomStart: number | undefined;
let heroCustomEnd: number | undefined;
let multiSelectMode = false;
const selectedEntryIds = new Set<string>();

interface WorkPageState {
  profiles: WorkProfile[];
  entries: WorkEntry[];
  filteredEntries: WorkEntry[];
  settlements: WorkSettlement[];
  running?: WorkEntry;
  now: number;
}

export async function renderWorkLogPage(root: HTMLElement): Promise<void> {
  window.clearInterval(tickTimer);
  renderWorkShell(root, '正在载入工时收入...');
  try {
    const now = Date.now();
    const range = filterRange(currentFilter, now);
    const [profiles, entries, filteredEntries, settlements] = await Promise.all([
      listWorkProfiles(),
      listWorkEntries(),
      range ? listWorkEntriesByRange(range.start, range.end) : listWorkEntries(),
      listWorkSettlements(),
    ]);
    const state: WorkPageState = {
      profiles,
      entries,
      filteredEntries,
      settlements,
      running: entries.find((e) => e.status === 'running' && !e.deleted),
      now,
    };

    const content = el('div', { class: 'page page-light work-page' });
    content.append(renderHero(state));
    content.append(renderTimerCard(state));
    content.append(renderAiCard(state));
    content.append(renderProfilesCard(state));
    content.append(renderManualEntryCard(state));
    content.append(renderEntriesCard(state));
    content.append(renderCompareCard(state));
    // 多选模式底部操作栏
    if (multiSelectMode) content.append(renderBatchActionBar());

    const back = el('button', { class: 'icon-btn', type: 'button', title: '返回工具箱', 'aria-label': '返回工具箱' } as any);
    back.append(icon('arrow-left'));
    back.onclick = () => navigate('/tools');
    renderPage({ root, title: '工时收入', activeTab: 'work', topLeft: back, content, showTabbar: false });
    if (state.running) tickTimer = window.setInterval(() => updateRunningUi(state.running!), 1000);
  } catch (e) {
    renderWorkShell(root, e instanceof Error ? e.message : '工时收入载入失败，请刷新后重试。');
  }
}

function renderWorkShell(root: HTMLElement, message: string): void {
  const content = el('div', { class: 'page page-light work-page' });
  content.append(el('div', { class: 'card' }, [el('div', { class: 'muted', html: message })]));
  renderPage({ root, title: '工时收入', activeTab: 'work', content, showTabbar: false });
}

function renderHero(state: WorkPageState): HTMLElement {
  const heroR = heroRangeFor(state.now);
  const summary = listWorkIncomeSummary(state.entries, state.profiles, state.settlements, heroR.start, heroR.end, state.now);
  const card = el('div', { class: 'card work-income-hero' });
  card.append(el('div', { class: 'muted', html: state.running ? '当前正在记录班次' : '个人收入台账' }));
  card.append(el('div', { class: 'work-income-main', html: moneyText(summary.estimatedIncome) }));
  card.append(el('div', { class: 'muted', html: `${heroRangeLabel()}预计 · ${formatDuration(summary.totalMs)} · 出勤 ${summary.attendanceDays} 天` }));
  const grid = el('div', { class: 'work-income-grid' });
  grid.append(metric('区间总收入', moneyText(summary.estimatedIncome)));
  grid.append(metric('待结算', moneyText(summary.pendingIncome)));
  grid.append(metric('已结算', moneyText(summary.settledIncome)));
  grid.append(metric('区间工时', formatDuration(summary.totalMs)));
  card.append(grid);
  // 区间切换 chip
  const chips: { id: HeroRange; label: string }[] = [
    { id: 'today', label: '今日' },
    { id: 'week', label: '本周' },
    { id: 'month', label: '本月' },
    { id: 'custom', label: '自定义' },
  ];
  const chipRow = el('div', { class: 'work-filter-row work-hero-range-row' });
  for (const c of chips) {
    const b = el('button', { class: `chip${heroRange === c.id ? ' on' : ''}`, type: 'button', html: c.label } as any);
    b.onclick = async () => {
      heroRange = c.id;
      if (c.id !== 'custom') {
        heroCustomStart = undefined;
        heroCustomEnd = undefined;
        await renderWorkLogPage(document.getElementById('app')!);
      } else {
        await renderWorkLogPage(document.getElementById('app')!);
      }
    };
    chipRow.append(b);
  }
  card.append(chipRow);
  // 自定义区间选择
  if (heroRange === 'custom') {
    const wrap = el('div', { class: 'work-hero-custom' });
    const startInput = el('input', { type: 'date', class: 'work-hero-date', 'aria-label': '自定义开始日期' } as any) as HTMLInputElement;
    const endInput = el('input', { type: 'date', class: 'work-hero-date', 'aria-label': '自定义结束日期' } as any) as HTMLInputElement;
    if (heroCustomStart) startInput.value = toDateInputValue(heroCustomStart);
    if (heroCustomEnd) endInput.value = toDateInputValue(heroCustomEnd);
    const refresh = async () => {
      const s = startInput.value ? new Date(startInput.value + 'T00:00:00').getTime() : undefined;
      const e = endInput.value ? new Date(endInput.value + 'T23:59:59').getTime() : undefined;
      heroCustomStart = s;
      heroCustomEnd = e;
      await renderWorkLogPage(document.getElementById('app')!);
    };
    startInput.onchange = refresh;
    endInput.onchange = refresh;
    wrap.append(el('span', { class: 'muted', html: '起：' }), startInput, el('span', { class: 'muted', html: '止：' }), endInput);
    card.append(wrap);
  }
  return card;
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
  const card = el('div', { class: 'card work-timer-card work-primary-card' });
  const heading = el('div', { class: 'work-card-heading' });
  heading.append(el('h3', { html: state.running ? '正在上班' : '快速打卡' }));
  if (state.running) heading.append(el('span', { class: 'work-status-pill', html: '运行中' }));
  card.append(heading);

  if (state.running) {
    const running = state.running;
    const income = calculateWorkIncome(running, state.entries, Date.now());
    card.append(el('div', { class: 'work-running-project', html: escapeHtml(running.paySnapshot?.profileName || running.projectName) }));
    card.append(el('div', { class: 'muted', html: `${escapeHtml(running.taskName || '未命名班次')} · ${payModeLabel(running.paySnapshot?.mode)} · 预计 ${moneyText(income.amount)}` }));
    const elapsed = el('div', { class: 'work-running-time', html: formatDuration(durationMs(running, Date.now())) });
    elapsed.setAttribute('data-work-running-elapsed', '1');
    card.append(elapsed);
    card.append(el('div', { class: 'muted', html: `开始于 ${formatDateTime(running.startAt)}` }));
    const row = el('div', { class: 'btn-row work-actions-row' });
    const stop = el('button', { class: 'btn', html: '停止班次' });
    stop.onclick = async () => {
      running.status = 'stopped';
      running.endAt = Date.now();
      await putWorkEntry(running);
      toast('已停止班次');
      await renderWorkLogPage(document.getElementById('app')!);
    };
    const edit = el('button', { class: 'btn tonal', html: '编辑' });
    edit.onclick = () => openEntryDialog(running, state);
    row.append(stop, edit);
    card.append(row);
    return card;
  }

  if (state.profiles.length === 0) {
    card.append(el('div', { class: 'muted', html: '先创建一个工作档案，再开始记录班次。' }));
    const add = el('button', { class: 'btn', html: '新增工作档案' });
    add.onclick = () => openProfileDialog(undefined);
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
    datalist.innerHTML = '';
    const p = state.profiles.find((x) => x.id === profile.input.value);
    for (const t of p?.taskTemplates || []) datalist.append(el('option', { value: t } as any));
  };
  refreshTaskDatalist();
  profile.input.addEventListener('change', refreshTaskDatalist);
  card.append(profile.wrap, task.wrap, datalist);
  const start = el('button', { class: 'btn', html: '开始班次', style: 'margin-top:12px' } as any);
  start.onclick = async () => {
    const active = await getRunningWorkEntry();
    if (active) return toast('已有班次在进行，请先停止');
    const p = state.profiles.find((x) => x.id === profile.input.value);
    if (!p) return toast('请选择工作');
    const taskName = task.input.value.trim();
    await putWorkEntry(newEntryFromProfile(p, Date.now(), undefined, taskName));
    // 任务名非空且未在模板中，自动追加（去重，最多 10 条，超出移除最早的）
    if (taskName) await maybeAddTaskTemplate(p, taskName);
    // 记录最近班次信息，供工具箱"一键开始上次班次"使用
    saveLastWorkEntry(p.id, taskName || undefined);
    toast('开始班次');
    await renderWorkLogPage(document.getElementById('app')!);
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

function renderAiCard(state: WorkPageState): HTMLElement {
  const card = el('details', { class: 'card work-ai-card' } as any);
  const summary = el('summary', { class: 'work-details-summary' });
  summary.append(el('span', { html: 'AI 助手' }));
  summary.append(el('span', { class: 'muted', html: '解析文字 · 总结收入 · 发现异常' }));
  card.append(summary);

  const cfg = getLlmConfig();
  if (!cfg.apiKey) {
    card.append(el('div', { class: 'banner info', html: 'AI 未配置。普通记工时不受影响；需要 AI 时到设置页填写 API 密钥。' }));
    return card;
  }

  const text = el('textarea', { placeholder: '例如：昨天奶茶店 10 点到 18 点，休息 1 小时，日结 180，已结' } as any) as HTMLTextAreaElement;
  card.append(text);
  const row = el('div', { class: 'btn-row', style: 'margin-top:10px' } as any);
  const parseProfile = el('button', { class: 'btn tonal', html: '解析工作档案' });
  const parseEntry = el('button', { class: 'btn tonal', html: '解析班次' });
  const summarize = el('button', { class: 'btn tonal', html: '生成月度总结' });
  const issues = el('button', { class: 'btn tonal', html: '检查最近异常' });
  parseProfile.onclick = async () => runAi(parseProfile, async () => previewProfileDraft(await parseWorkProfileText(text.value)));
  parseEntry.onclick = async () => runAi(parseEntry, async () => previewEntryDraft(await parseWorkEntryText(text.value, state.profiles), state));
  summarize.onclick = async () => {
    const month = rangeFor('month', state.now);
    const data = listWorkIncomeSummary(state.entries, state.profiles, state.settlements, month.start, month.end, state.now);
    await runAi(summarize, async () => previewSummaryDraft(await summarizeWorkIncome(data)));
  };
  issues.onclick = async () => {
    const entry = state.entries[0];
    if (!entry) return toast('还没有班次可检查');
    await runAi(issues, async () => previewSummaryDraft(await detectWorkEntryIssues(entry, { profiles: state.profiles, recentEntries: state.entries.slice(0, 20) })));
  };
  row.append(parseProfile, parseEntry, summarize, issues);
  card.append(row);
  return card;
}

function renderProfilesCard(state: WorkPageState): HTMLElement {
  const card = el('div', { class: 'card work-list-card' });
  const head = el('div', { class: 'work-card-heading' });
  head.append(el('h3', { html: '工作档案' }));
  const add = el('button', { class: 'btn tonal small', html: '新增' });
  add.onclick = () => openProfileDialog(undefined);
  head.append(add);
  card.append(head);
  if (state.profiles.length === 0) {
    card.append(el('div', { class: 'muted', html: '还没有工作档案。固定薪资、时薪、日结都从这里配置。' }));
    return card;
  }
  const list = el('div', { class: 'work-profile-list' });
  for (const profile of state.profiles) {
    const row = el('div', { class: 'work-profile-row' });
    row.append(el('div', { class: 'grow' }, [
      el('div', { class: 'work-entry-title', html: escapeHtml(profile.name) }),
      el('div', { class: 'muted', html: `${payModeLabel(profile.payMode)} · ${moneyText(profile.baseAmount)}${profile.payMode === 'salary' ? '/月' : profile.payMode === 'hourly' ? '/小时' : '/天'}` }),
    ]));
    const actions = el('div', { class: 'work-entry-actions' });
    const edit = el('button', { class: 'btn text small', html: '编辑' });
    edit.onclick = () => openProfileDialog(profile);
    const del = el('button', { class: 'btn text small danger-text', html: '删除' });
    del.onclick = async () => {
      const ok = await confirmDialog('删除这个工作档案？已有班次不会被删除。', '删除', true);
      if (!ok) return;
      await softDeleteWorkProfile(profile.id);
      toast('已删除工作档案');
      await renderWorkLogPage(document.getElementById('app')!);
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
  const summary = el('summary', { class: 'work-details-summary' });
  summary.append(el('span', { html: '手动补录' }));
  summary.append(el('span', { class: 'muted', html: '补班次、休息、金额覆盖' }));
  card.append(summary);
  if (state.profiles.length === 0) {
    card.append(el('div', { class: 'muted', html: '请先新增工作档案。' }));
    return card;
  }
  const form = renderEntryForm({ state });
  const quick = el('div', { class: 'work-quick-row' });
  const oneHour = el('button', { class: 'chip', type: 'button', html: '刚刚结束 1 小时' } as any);
  const workday = el('button', { class: 'chip', type: 'button', html: '今天默认班次' } as any);
  oneHour.onclick = () => form.setRange(new Date(Date.now() - HOUR), new Date());
  workday.onclick = () => {
    const p = state.profiles.find((x) => x.id === form.profileInput.value) || state.profiles[0];
    form.setRange(todayAt(p.defaultStartTime || '09:00'), todayAt(p.defaultEndTime || '18:00'));
    form.breakInput.value = String(p.defaultBreakMinutes || 0);
  };
  quick.append(oneHour, workday);
  card.append(quick, form.wrap);
  const save = el('button', { class: 'btn tonal', html: '保存班次', style: 'margin-top:12px' } as any);
  save.onclick = async () => {
    const values = readEntryForm(form, state);
    const error = validateEntry(values);
    if (error) return toast(error);
    await putWorkEntry(values);
    toast('已保存班次');
    await renderWorkLogPage(document.getElementById('app')!);
  };
  card.append(save);
  return card;
}

function renderEntriesCard(state: WorkPageState): HTMLElement {
  const card = el('div', { class: 'card work-list-card' });
  const head = el('div', { class: 'work-card-heading' });
  head.append(el('h3', { html: '收入明细' }));
  const actions = el('div', { class: 'work-card-actions' });
  const multiBtn = el('button', { class: `btn tonal small${multiSelectMode ? ' on' : ''}`, html: multiSelectMode ? '退出多选' : '多选' });
  multiBtn.onclick = async () => {
    multiSelectMode = !multiSelectMode;
    if (!multiSelectMode) selectedEntryIds.clear();
    await renderWorkLogPage(document.getElementById('app')!);
  };
  const reportBtn = el('button', { class: 'btn tonal small', html: '导出报表' });
  reportBtn.onclick = () => openReportDialog(state);
  const exportBtn = el('button', { class: 'btn tonal small', html: '导出 CSV' });
  exportBtn.onclick = async () => {
    const csv = await exportWorkEntriesCsv(state.filteredEntries);
    downloadText(csv, `work-income-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
    toast('已导出 CSV');
  };
  actions.append(multiBtn, reportBtn, exportBtn);
  head.append(actions);
  card.append(head, renderFilterBar());
  if (multiSelectMode && selectedEntryIds.size > 0) {
    card.append(el('div', { class: 'muted work-multi-hint', html: `已选 ${selectedEntryIds.size} 条班次` }));
  }
  const shown = state.filteredEntries.slice(0, shownCount);
  if (shown.length === 0) {
    card.append(el('div', { class: 'muted', html: '这个范围还没有班次记录。' }));
    return card;
  }
  const list = el('div', { class: 'work-entry-list' });
  for (const entry of shown) list.append(renderEntryRow(entry, state));
  card.append(list);
  if (shown.length < state.filteredEntries.length) {
    const more = el('button', { class: 'btn text work-more-btn', html: `查看更多（剩余 ${state.filteredEntries.length - shown.length} 条）` });
    more.onclick = async () => {
      shownCount += PAGE_SIZE;
      await renderWorkLogPage(document.getElementById('app')!);
    };
    card.append(more);
  }
  card.append(renderSalarySettlements(state));
  return card;
}

function renderEntryRow(entry: WorkEntry, state: WorkPageState): HTMLElement {
  const income = calculateWorkIncome(entry, state.filteredEntries, state.now);
  const runningClass = entry.status === 'running' ? ' running' : '';
  // running 班次优先显示运行中样式，不叠加 settled/pending 背景色
  const settledClass = entry.status === 'running'
    ? ''
    : (entry.settlementStatus === 'settled' ? ' settled' : ' pending');
  const row = el('div', { class: `work-entry-row${runningClass}${settledClass}` });
  // 多选模式下左侧显示复选框
  if (multiSelectMode) {
    const checkbox = el('input', { type: 'checkbox', class: 'work-entry-check', 'aria-label': '选择此班次' } as any) as HTMLInputElement;
    checkbox.checked = selectedEntryIds.has(entry.id);
    checkbox.onchange = async () => {
      if (checkbox.checked) selectedEntryIds.add(entry.id);
      else selectedEntryIds.delete(entry.id);
      await renderWorkLogPage(document.getElementById('app')!);
    };
    row.append(checkbox);
  }
  const main = el('div', { class: 'grow' });
  main.append(el('div', { class: 'work-entry-title', html: escapeHtml(entry.paySnapshot?.profileName || entry.projectName) }));
  main.append(el('div', { class: 'muted', html: `${escapeHtml(entry.taskName || '班次')} · ${formatDateTime(entry.startAt)} - ${entry.endAt ? formatTime(entry.endAt) : '进行中'} · ${formatDuration(income.effectiveMs)}` }));
  if (!income.billable && entry.paySnapshot?.mode === 'daily') main.append(el('div', { class: 'muted work-entry-note', html: '同一天日结已计入第一条班次' }));
  // 标签 chip 行
  const tags = (entry.tags || []).filter((t) => (TAG_OPTIONS as readonly string[]).includes(t));
  if (tags.length > 0) {
    const tagRow = el('div', { class: 'work-entry-tags' });
    for (const t of tags) tagRow.append(el('span', { class: 'tag-chip', html: escapeHtml(t) }));
    main.append(tagRow);
  }
  if (entry.note) main.append(el('div', { class: 'muted work-entry-note', html: escapeHtml(entry.note) }));
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
      await markWorkEntrySettled(entry.id, entry.settlementStatus === 'settled' ? 'pending' : 'settled');
      await renderWorkLogPage(document.getElementById('app')!);
    };
    const again = el('button', { class: 'btn text small', html: '继续' });
    again.onclick = () => continueEntry(entry, state);
    const del = el('button', { class: 'btn text small danger-text', html: '删除' });
    del.onclick = async () => {
      const ok = await confirmDialog('删除这条班次记录？', '删除', true);
      if (!ok) return;
      await softDeleteWorkEntry(entry.id);
      toast('已删除');
      await renderWorkLogPage(document.getElementById('app')!);
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
function renderBatchActionBar(): HTMLElement {
  const bar = el('div', { class: 'work-batch-bar' });
  const hint = el('span', { class: 'muted', html: `已选 ${selectedEntryIds.size} 条` });
  const settledBtn = el('button', { class: 'btn tonal small', html: '标记已结算' });
  settledBtn.onclick = async () => {
    if (selectedEntryIds.size === 0) return toast('请先选择班次');
    await batchMarkSettled([...selectedEntryIds], true);
    toast('已批量标记为已结算');
    selectedEntryIds.clear();
    multiSelectMode = false;
    await renderWorkLogPage(document.getElementById('app')!);
  };
  const pendingBtn = el('button', { class: 'btn tonal small', html: '标记待结算' });
  pendingBtn.onclick = async () => {
    if (selectedEntryIds.size === 0) return toast('请先选择班次');
    await batchMarkSettled([...selectedEntryIds], false);
    toast('已批量标记为待结算');
    selectedEntryIds.clear();
    multiSelectMode = false;
    await renderWorkLogPage(document.getElementById('app')!);
  };
  const cancelBtn = el('button', { class: 'btn text small', html: '退出多选' });
  cancelBtn.onclick = async () => {
    multiSelectMode = false;
    selectedEntryIds.clear();
    await renderWorkLogPage(document.getElementById('app')!);
  };
  bar.append(hint, settledBtn, pendingBtn, cancelBtn);
  return bar;
}

function renderSalarySettlements(state: WorkPageState): HTMLElement {
  const salaryProfiles = state.profiles.filter((p) => p.payMode === 'salary');
  const wrap = el('div', { class: 'work-salary-settlements' });
  if (salaryProfiles.length === 0 || currentFilter === 'today') return wrap;
  wrap.append(el('h3', { html: '固定薪资结算' }));
  const periodKey = monthKey(state.now);
  for (const profile of salaryProfiles) {
    const settlement = state.settlements.find((s) => s.profileId === profile.id && s.periodKey === periodKey && !s.deleted);
    const row = el('div', { class: 'work-profile-row' });
    row.append(el('div', { class: 'grow' }, [
      el('div', { class: 'work-entry-title', html: `${escapeHtml(profile.name)} · ${periodKey}` }),
      el('div', { class: 'muted', html: `${moneyText(settlement?.amount ?? profile.baseAmount)} · ${settlement?.status === 'settled' ? '已结算' : '待结算'}` }),
    ]));
    const btn = el('button', { class: 'btn text small', html: settlement?.status === 'settled' ? '改待结' : '已结算' });
    btn.onclick = async () => {
      const id = `${profile.id}_${periodKey}`;
      if (!settlement) {
        await putWorkSettlement({ id, profileId: profile.id, periodKey, amount: profile.baseAmount, status: 'settled', settledAt: Date.now(), updatedAt: Date.now() });
      } else {
        await markWorkSettlementSettled(id, settlement.status === 'settled' ? 'pending' : 'settled');
      }
      await renderWorkLogPage(document.getElementById('app')!);
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
  head.append(el('h3', { html: '按工作档案分组' }));
  const rangeLabel = el('span', { class: 'muted', html: heroRangeLabel() });
  head.append(rangeLabel);
  card.append(head);
  if (state.profiles.length === 0) {
    card.append(el('div', { class: 'muted', html: '还没有工作档案。' }));
    return card;
  }
  const heroR = heroRangeFor(state.now);
  // 列表加载是异步的，使用占位后再填充
  const listWrap = el('div', { class: 'work-compare-list', html: '<div class="muted">载入中...</div>' });
  card.append(listWrap);
  void Promise.all([
    listWorkIncomeByProfile(state.entries, state.profiles, state.settlements, heroR.start, heroR.end, state.now),
    // 同时拉取每个 profile 的最新班次（用于展示最近一次班次信息）
    Promise.all(state.profiles.map((p) => listWorkEntriesByProfile(p.id).then((entries) => ({ profileId: p.id, latest: entries[0] })))),
  ]).then(([rows, latests]) => {
    listWrap.innerHTML = '';
    if (rows.length === 0) {
      listWrap.append(el('div', { class: 'muted', html: '该区间没有班次数据。' }));
      return;
    }
    const latestMap = new Map(latests.map((x) => [x.profileId, x.latest]));
    for (const row of rows) {
      const item = el('div', { class: 'work-compare-row' });
      item.append(el('div', { class: 'work-entry-title', html: escapeHtml(row.profileName) }));
      const meta = el('div', { class: 'muted', html: `${moneyText(row.totalIncome)} · ${formatDuration(row.totalMs)} · ${row.entryCount} 班` });
      item.append(meta);
      const latest = latestMap.get(row.profileId);
      if (latest) {
        item.append(el('div', { class: 'muted work-compare-latest', html: `最近：${escapeHtml(latest.taskName || '班次')} · ${formatDateTime(latest.startAt)}` }));
      }
      listWrap.append(item);
    }
  });
  return card;
}

/** 导出报表对话框：选择周/月 + 日期，生成 CSV 下载，文本摘要展示可复制 */
function openReportDialog(state: WorkPageState): void {
  const overlay = el('div', { class: 'overlay' });
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
    modeField.input.value = 'week';
    const r = rangeFor('week', state.now);
    startField.input.value = toDateInputValue(r.start);
    endField.input.value = toDateInputValue(r.end);
    refreshPreview();
  };
  const monthChip = el('button', { class: 'chip', type: 'button', html: '本月' } as any);
  monthChip.onclick = () => {
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
  summaryText.setAttribute('aria-label', '区间报表文本摘要');
  summaryBox.append(el('label', { html: '区间摘要（可复制）' }), summaryText);
  box.append(summaryBox);

  const refreshPreview = () => {
    const startMs = new Date(startField.input.value + 'T00:00:00').getTime();
    const endMs = new Date(endField.input.value + 'T23:59:59').getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
      summaryText.value = '请选择有效的开始/结束日期';
      return;
    }
    const mode = modeField.input.value === 'week' ? 'week' : 'month';
    const { summary } = exportWorkReport(state.entries, state.profiles, state.settlements, startMs, endMs, mode);
    summaryText.value = summary;
  };
  refreshPreview();
  startField.input.addEventListener('change', refreshPreview);
  endField.input.addEventListener('change', refreshPreview);
  modeField.input.addEventListener('change', refreshPreview);

  const row = el('div', { class: 'btn-row' });
  const cancel = el('button', { class: 'btn text', html: '取消' });
  const download = el('button', { class: 'btn', html: '下载 CSV' });
  cancel.onclick = () => overlay.remove();
  download.onclick = () => {
    const startMs = new Date(startField.input.value + 'T00:00:00').getTime();
    const endMs = new Date(endField.input.value + 'T23:59:59').getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
      toast('请选择有效的开始/结束日期');
      return;
    }
    const mode = modeField.input.value === 'week' ? 'week' : 'month';
    const { csv } = exportWorkReport(state.entries, state.profiles, state.settlements, startMs, endMs, mode);
    const startStr = startField.input.value || 'report';
    const endStr = endField.input.value || '';
    const fname = `work-report-${startStr}${endStr ? `_to_${endStr}` : ''}.csv`;
    downloadText(csv, fname, 'text/csv;charset=utf-8');
    toast('已下载 CSV 报表');
  };
  row.append(cancel, download);
  box.append(row);
  overlay.append(box);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.append(overlay);
}

function renderFilterBar(): HTMLElement {
  const filters: { id: WorkFilter; label: string }[] = [
    { id: 'today', label: '今日' },
    { id: 'week', label: '本周' },
    { id: 'month', label: '本月' },
    { id: 'all', label: '全部' },
  ];
  const row = el('div', { class: 'work-filter-row' });
  for (const filter of filters) {
    const b = el('button', { class: `chip${currentFilter === filter.id ? ' on' : ''}`, type: 'button', html: filter.label } as any);
    b.onclick = async () => {
      currentFilter = filter.id;
      shownCount = PAGE_SIZE;
      // 切换过滤区间时清空多选状态
      multiSelectMode = false;
      selectedEntryIds.clear();
      await renderWorkLogPage(document.getElementById('app')!);
    };
    row.append(b);
  }
  return row;
}

function openProfileDialog(profile?: WorkProfile): void {
  const overlay = el('div', { class: 'overlay' });
  const box = el('div', { class: 'card work-edit-dialog' });
  box.append(el('h3', { html: profile ? '编辑工作档案' : '新增工作档案' }));
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
    labelNode.innerHTML = `任务模板（${templates.length}/${MAX_TASK_TEMPLATES}）`;
  };
  const renderChips = () => {
    chipList.innerHTML = '';
    if (templates.length === 0) {
      chipList.append(el('span', { class: 'muted', html: '暂无模板，可在下方输入并添加。' }));
      return;
    }
    for (let i = 0; i < templates.length; i++) {
      const idx = i;
      const item = el('span', { class: 'work-template-chip' });
      item.append(el('span', { html: escapeHtml(templates[idx]) }));
      const delBtn = el('button', { class: 'btn text small work-template-del', type: 'button', 'aria-label': '删除该模板', html: '×' } as any);
      delBtn.onclick = () => {
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
  const addBtn = el('button', { class: 'btn tonal small', type: 'button', html: '添加' });
  const addTemplate = () => {
    const v = newTplInput.value.trim();
    if (!v) return;
    if (templates.includes(v)) {
      toast('该模板已存在');
      return;
    }
    if (templates.length >= MAX_TASK_TEMPLATES) {
      toast(`最多 ${MAX_TASK_TEMPLATES} 条，请先删除旧的`);
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
  cancel.onclick = () => overlay.remove();
  save.onclick = async () => {
    if (!name.input.value.trim()) return toast('请填写工作名称');
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
    overlay.remove();
    toast('已保存工作档案');
    await renderWorkLogPage(document.getElementById('app')!);
  };
  row.append(cancel, save);
  box.append(row);
  overlay.append(box);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.append(overlay);
}

function openEntryDialog(entry: WorkEntry, state: WorkPageState): void {
  const overlay = el('div', { class: 'overlay' });
  const box = el('div', { class: 'card work-edit-dialog' });
  box.append(el('h3', { html: '编辑班次' }));
  const form = renderEntryForm({ state, entry });
  box.append(form.wrap);
  const row = el('div', { class: 'btn-row' });
  const cancel = el('button', { class: 'btn text', html: '取消' });
  const save = el('button', { class: 'btn', html: '保存' });
  cancel.onclick = () => overlay.remove();
  save.onclick = async () => {
    const values = readEntryForm(form, state, entry);
    const error = validateEntry(values);
    if (error) return toast(error);
    await putWorkEntry(values);
    overlay.remove();
    toast('已更新班次');
    await renderWorkLogPage(document.getElementById('app')!);
  };
  row.append(cancel, save);
  box.append(row);
  overlay.append(box);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.append(overlay);
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
  rest.input.value = String(opts.entry?.breakMinutes || opts.state.profiles.find((p) => p.id === profile.input.value)?.defaultBreakMinutes || 0);
  amount.input.value = opts.entry?.amountOverride !== undefined ? String(opts.entry.amountOverride) : '';
  settled.input.value = opts.entry?.settlementStatus || 'pending';
  note.value = opts.entry?.note || '';
  wrap.append(profile.wrap, task.wrap, start.wrap, end.wrap, rest.wrap, amount.wrap, settled.wrap, fieldWrap('备注', note));

  // 任务模板 datalist：根据所选 profile 动态填充
  const datalistId = 'work-entry-task-templates';
  task.input.setAttribute('list', datalistId);
  const datalist = el('datalist', { id: datalistId } as any);
  const refreshTaskDatalist = () => {
    datalist.innerHTML = '';
    const p = opts.state.profiles.find((x) => x.id === profile.input.value);
    for (const t of p?.taskTemplates || []) datalist.append(el('option', { value: t } as any));
  };
  refreshTaskDatalist();
  profile.input.addEventListener('change', refreshTaskDatalist);
  wrap.append(datalist);

  // 标签多选 chip
  const tagsField = el('div', { class: 'field work-tags-field' });
  tagsField.append(el('label', { html: '标签' }));
  const selectedTags = new Set<WorkTag>((opts.entry?.tags || []) as WorkTag[]);
  const tagChips = el('div', { class: 'work-tags-row' });
  const renderTagChips = () => {
    tagChips.innerHTML = '';
    for (const t of TAG_OPTIONS) {
      const on = selectedTags.has(t);
      const c = el('button', { class: `chip${on ? ' on' : ''}`, type: 'button', html: t } as any);
      c.onclick = () => {
        if (on) selectedTags.delete(t);
        else selectedTags.add(t);
        renderTagChips();
      };
      tagChips.append(c);
    }
  };
  renderTagChips();
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
    setRange: (s: Date, e: Date) => { start.input.value = toDateTimeLocal(s); end.input.value = toDateTimeLocal(e); },
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
  const active = await getRunningWorkEntry();
  if (active) return toast('已有班次在进行，请先停止');
  const profile = state.profiles.find((p) => p.id === entry.profileId) || state.profiles[0];
  await putWorkEntry(newEntryFromProfile(profile, Date.now(), undefined, entry.taskName));
  // 同步最近班次信息，供工具箱"一键开始上次班次"使用
  if (profile) saveLastWorkEntry(profile.id, entry.taskName || undefined);
  toast('已继续该工作');
  await renderWorkLogPage(document.getElementById('app')!);
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

async function runAi(button: HTMLButtonElement, fn: () => Promise<void>): Promise<void> {
  const old = button.innerHTML;
  button.setAttribute('disabled', 'true');
  button.innerHTML = 'AI 处理中...';
  try {
    await fn();
  } catch (e) {
    const msg = e instanceof WorkAiError ? e.message : e instanceof Error ? e.message : String(e);
    toast('AI 失败：' + msg, 3600);
  } finally {
    button.removeAttribute('disabled');
    button.innerHTML = old;
  }
}

function previewProfileDraft(draft: WorkAiDraft): void {
  const profile = draft.profile || {};
  openProfileDialog({
    id: workUid(),
    name: String(profile.name || ''),
    payMode: (profile.payMode === 'salary' || profile.payMode === 'daily' ? profile.payMode : 'hourly') as WorkPayMode,
    baseAmount: Number(profile.baseAmount || 0),
    settlementCycle: profile.payMode === 'salary' ? 'month' : profile.payMode === 'daily' ? 'day' : 'entry',
    expectedWorkDaysPerMonth: Number(profile.expectedWorkDaysPerMonth || 0) || undefined,
    defaultStartTime: String(profile.defaultStartTime || '09:00'),
    defaultEndTime: String(profile.defaultEndTime || '18:00'),
    defaultBreakMinutes: Number(profile.defaultBreakMinutes || 0),
    note: [String(profile.note || ''), draft.warnings.join('；')].filter(Boolean).join('\n'),
    updatedAt: Date.now(),
  });
}

function previewEntryDraft(draft: WorkAiDraft, state: WorkPageState): void {
  const raw = draft.entry || draft.entries?.[0];
  if (!raw) return toast('AI 没有解析出班次');
  const profile = state.profiles.find((p) => p.id === raw.profileId)
    || state.profiles.find((p) => raw.projectName && p.name.includes(String(raw.projectName)))
    || state.profiles[0];
  if (!profile) return toast('请先创建工作档案');
  const startAt = parseAiTime((raw as any).startAtText) || Number(raw.startAt) || Date.now() - HOUR;
  const endAt = parseAiTime((raw as any).endAtText) || Number(raw.endAt) || Date.now();
  openEntryDialog({
    id: workUid(),
    profileId: profile.id,
    projectName: profile.name,
    taskName: String(raw.taskName || 'AI 补录'),
    paySnapshot: createPaySnapshot(profile),
    startAt,
    endAt,
    breakMinutes: Number(raw.breakMinutes || profile.defaultBreakMinutes || 0),
    amountOverride: raw.amountOverride !== undefined ? Number(raw.amountOverride) : undefined,
    settlementStatus: raw.settlementStatus === 'settled' ? 'settled' : 'pending',
    settledAt: raw.settlementStatus === 'settled' ? Date.now() : undefined,
    note: [String(raw.note || ''), draft.warnings.join('；')].filter(Boolean).join('\n'),
    status: 'stopped',
    updatedAt: Date.now(),
  }, state);
}

function previewSummaryDraft(draft: WorkAiDraft): void {
  const overlay = el('div', { class: 'overlay' });
  const box = el('div', { class: 'card work-edit-dialog' });
  box.append(el('h3', { html: 'AI 月度总结' }));
  box.append(el('div', { class: 'muted', html: escapeHtml(draft.summary || '暂无总结') }));
  if (draft.warnings.length) box.append(el('div', { class: 'banner warn', html: escapeHtml(draft.warnings.join('；')) }));
  const close = el('button', { class: 'btn', html: '知道了', style: 'margin-top:16px' } as any);
  close.onclick = () => overlay.remove();
  box.append(close);
  overlay.append(box);
  document.body.append(overlay);
}

function metric(label: string, value: string): HTMLElement {
  const card = el('div', { class: 'work-income-metric' });
  card.append(el('div', { class: 'muted', html: label }));
  card.append(el('div', { class: 'work-summary-value', html: value }));
  return card;
}

function inputField(label: string, type: string, placeholder = ''): { wrap: HTMLElement; input: HTMLInputElement } {
  const input = el('input', { type, placeholder } as any) as HTMLInputElement;
  return { wrap: fieldWrap(label, input), input };
}

function selectField(label: string, options: { value: string; label: string }[]): { wrap: HTMLElement; input: HTMLSelectElement } {
  const input = el('select') as HTMLSelectElement;
  for (const option of options) input.append(el('option', { value: option.value, html: option.label } as any));
  return { wrap: fieldWrap(label, input), input };
}

function fieldWrap(label: string, input: HTMLElement): HTMLElement {
  const wrap = el('div', { class: 'field' });
  wrap.append(el('label', { html: label }), input);
  return wrap;
}

function updateRunningUi(running: WorkEntry): void {
  const elapsed = document.querySelector<HTMLElement>('[data-work-running-elapsed]');
  if (elapsed) elapsed.innerHTML = formatDuration(durationMs(running, Date.now()));
}

function durationMs(entry: WorkEntry, now: number): number {
  const end = entry.endAt ?? now;
  return Math.max(0, end - entry.startAt - (entry.breakMinutes || 0) * MINUTE);
}

function filterRange(filter: WorkFilter, now: number): { start: number; end: number } | null {
  if (filter === 'all') return null;
  return rangeFor(filter, now);
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
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${formatTime(ms)}`;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function moneyText(value: number): string {
  return `¥${(Number.isFinite(value) ? value : 0).toFixed(2)}`;
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

function parseAiTime(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const t = Date.parse(value);
  if (Number.isFinite(t)) return t;
  const m = value.match(/(\d{1,2})[:点](\d{0,2})/);
  if (!m) return undefined;
  const d = new Date();
  d.setHours(Number(m[1]), Number(m[2] || 0), 0, 0);
  return d.getTime();
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

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
