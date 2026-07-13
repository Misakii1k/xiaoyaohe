// 药品列表页：按药品分组展示（一种药一张卡片，时段标签直接显示在卡片内）
import { listMeds, listRules, listLogsByRange, batchUpdateRules } from '../db/local';
import {
  SLOT_LABEL,
  SLOT_DEFAULT_TIME,
  SLOTS,
  formatMealRelsBySlot,
  formatMealRelsForSlot,
  type Medication,
  type ReminderRule,
  type IntakeLog,
  type Slot,
} from '../db/schema';
import { el, renderPage, emptyState, icon, toast, openDialog, SLOT_ICON } from '../ui/components';
import { navigate } from '../router';
import { estimateDaysLeft } from '../features/inventory';
import { checkInteractions, type DrugInteraction } from '../data/drugInteractions';
import { isRestDay } from '../features/reminderScheduler';

/** 时段筛选选项（"全部" 不在 SLOTS 内，单独表示） */
type SlotFilter = 'all' | Slot;

const SLOT_FILTER_LABELS: Record<SlotFilter, string> = {
  all: '全部',
  morning: '早',
  noon: '中',
  evening: '晚',
  bedtime: '睡前',
};

const SLOT_FILTER_ORDER: SlotFilter[] = ['all', 'morning', 'noon', 'evening', 'bedtime'];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NEAR_EXPIRY_DAYS = 30;

export async function renderMedListPage(root: HTMLElement): Promise<void> {
  const [meds, rules] = await Promise.all([listMeds(), listRules()]);

  const addBtn = el('button', { class: 'icon-btn', 'aria-label': '新增药品' } as any);
  addBtn.append(icon('plus'));
  addBtn.onclick = () => navigate('/meds/new');

  const batchBtn = el('button', { class: 'icon-btn', 'aria-label': '批量管理' } as any);
  batchBtn.append(icon('list'));
  batchBtn.onclick = () => enterBatchMode(root);
  batchBtn.style.marginRight = '4px';

  const topRight = el('div', { class: 'topbar-actions', style: 'display:flex;align-items:center;gap:4px' } as any);
  topRight.append(batchBtn, addBtn);

  const content = el('div', { class: 'page' });

  if (meds.length === 0) {
    const cta = el('button', { class: 'btn' });
    cta.append(icon('plus'));
    cta.append(el('span', { html: '添加第一种药' }));
    cta.onclick = () => navigate('/meds/new');
    content.append(
      emptyState('pill', '还没有药品', '添加你长期服用的药物，按时段分类、扫码识别都从这里开始。', cta)
    );
    renderPage({ root, title: '药品', activeTab: 'meds', topRight, content });
    return;
  }

  // 提醒时间索引：medId -> slot -> "HH:mm"
  const timeByMedSlot = new Map<string, Map<Slot, string>>();
  for (const r of rules) {
    if (r.deleted || !r.enabled) continue;
    let m = timeByMedSlot.get(r.medId);
    if (!m) {
      m = new Map();
      timeByMedSlot.set(r.medId, m);
    }
    m.set(r.slot, r.timeLocal);
  }

  // 相互作用索引：medId -> 命中的相互作用列表
  const allMedNames = meds.map((m) => m.name);
  const hits = checkInteractions(allMedNames);
  const interactionsByMedId = new Map<string, DrugInteraction[]>();
  for (const med of meds) {
    const lower = med.name.toLowerCase();
    const involved = hits.filter((h) =>
      h.drugs.some((kw) => lower.includes(kw.toLowerCase())),
    );
    if (involved.length > 0) interactionsByMedId.set(med.id, involved);
  }
  const nowMs = Date.now();

  // 取近 7 天 logs，用于依从性显示
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
  const weekAgoStart = todayStart - 6 * MS_PER_DAY; // 含今天，共 7 天
  const weekEnd = todayStart + MS_PER_DAY - 1;
  let weekLogs: IntakeLog[] = [];
  try {
    weekLogs = await listLogsByRange(weekAgoStart, weekEnd);
  } catch {
    weekLogs = [];
  }

  // 按药品排序：先按"是否有未来时段"，再按药名
  const sorted = [...meds].sort((a, b) => {
    const ax = a.slots.length === 0 ? 1 : 0;
    const bx = b.slots.length === 0 ? 1 : 0;
    if (ax !== bx) return ax - bx;
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });

  // 搜索框（防抖 200ms）
  const searchInput = el('input', {
    type: 'search',
    placeholder: '搜索药名 / 规格',
    class: 'med-search-input',
    'aria-label': '搜索药品',
  } as any) as HTMLInputElement;
  const searchBar = el('div', { class: 'med-search-bar' });
  searchBar.append(icon('pill', 'med-search-icon'));
  searchBar.append(searchInput);

  // 时段筛选 chip 组
  const filterRow = el('div', { class: 'med-filter-row chips' });
  const filterChips = new Map<SlotFilter, HTMLButtonElement>();
  let currentFilter: SlotFilter = 'all';
  for (const key of SLOT_FILTER_ORDER) {
    const chip = el('button', {
      class: 'chip sm' + (key === 'all' ? ' on' : ''),
      html: SLOT_FILTER_LABELS[key],
      type: 'button',
    } as any) as HTMLButtonElement;
    chip.onclick = () => {
      if (currentFilter === key) return;
      currentFilter = key;
      for (const [k, c] of filterChips) c.classList.toggle('on', k === key);
      applyFilter();
    };
    filterChips.set(key, chip);
    filterRow.append(chip);
  }

  // 卡片网格
  const grid = el('div', { class: 'meds-grid' });
  const cardByMedId = new Map<string, HTMLElement>();
  for (const m of sorted) {
    const card = renderMedCard(
      m,
      timeByMedSlot.get(m.id),
      rules,
      weekLogs,
      interactionsByMedId.get(m.id) ?? [],
      nowMs,
    );
    cardByMedId.set(m.id, card);
    grid.append(card);
  }

  content.append(searchBar, filterRow, grid);

  // 搜索 + 时段筛选叠加过滤
  let searchTimer: number | undefined;
  const applyFilter = () => {
    const keyword = searchInput.value.trim().toLowerCase();
    for (const m of sorted) {
      const card = cardByMedId.get(m.id);
      if (!card) continue;
      const matchKeyword =
        !keyword ||
        (m.name || '').toLowerCase().includes(keyword) ||
        (m.dosageText || '').toLowerCase().includes(keyword);
      const matchSlot = currentFilter === 'all' || m.slots.includes(currentFilter);
      card.style.display = matchKeyword && matchSlot ? '' : 'none';
    }
  };
  searchInput.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(applyFilter, 200);
  });

  renderPage({ root, title: '药品', activeTab: 'meds', topRight, content });
}

function renderMedCard(
  m: Medication,
  slotTimes: Map<Slot, string> | undefined,
  allRules: ReminderRule[],
  weekLogs: IntakeLog[],
  interactions: DrugInteraction[],
  nowMs: number,
): HTMLElement {
  const card = el('div', { class: 'card med-card' });

  // 头部：药名 + 编辑按钮
  const head = el('div', { class: 'med-card-head' });
  const titleWrap = el('div', { class: 'med-card-title-wrap' });
  titleWrap.append(el('div', { class: 'med-card-name', html: m.name || '未命名' }));
  const mealText = formatMealRelsBySlot(m.mealRelsBySlot, m.slots);
  const sub = [m.amountPerDose, m.dosageText, mealText].filter(Boolean).join(' · ');
  if (sub) titleWrap.append(el('div', { class: 'med-card-sub muted', html: sub }));
  head.append(titleWrap);

  // 状态标签区：过期/近效期/可用天数/近7天完成率/停药期/相互作用
  const metaTags = el('div', { class: 'med-card-tags' });
  appendExpiryTag(metaTags, m);
  appendDaysLeftTag(metaTags, m, allRules);
  appendAdherenceTag(metaTags, m.id, weekLogs);
  // 停药期标签：该药任一启用 rule 命中 rest 日
  const medRules = allRules.filter((r) => r.medId === m.id && !r.deleted && r.enabled);
  if (medRules.some((r) => isRestDay(m, r, nowMs))) {
    metaTags.append(el('span', { class: 'rest-day-tag', html: '停药期' }));
  }
  // 相互作用图标（点击查看详情）
  if (interactions.length > 0) {
    const warnBtn = el('button', {
      class: 'interaction-icon',
      type: 'button',
      'aria-label': `查看相互作用（${interactions.length} 条）`,
      title: `存在 ${interactions.length} 条相互作用，点击查看`,
    } as any);
    warnBtn.append(icon('warn'));
    warnBtn.onclick = (e) => {
      e.stopPropagation();
      showInteractionDialog(m.name, interactions);
    };
    metaTags.append(warnBtn);
  }
  if (metaTags.childElementCount > 0) {
    titleWrap.append(metaTags);
  }

  const edit = el('button', { class: 'btn small tonal med-card-edit' });
  edit.append(icon('edit'));
  edit.append(el('span', { html: '编辑' }));
  edit.onclick = () => navigate(`/meds/${m.id}/edit`);
  head.append(edit);
  card.append(head);

  // 时段 chips（含提醒时间）
  if (m.slots.length > 0) {
    const slotsRow = el('div', { class: 'med-card-slots' });
    // 按定义顺序排
    for (const s of SLOTS) {
      if (!m.slots.includes(s)) continue;
      const time = slotTimes?.get(s) || SLOT_DEFAULT_TIME[s];
      slotsRow.append(slotChip(s, time, formatMealRelsForSlot(s, m.mealRelsBySlot)));
    }
    card.append(slotsRow);
  } else {
    card.append(
      el('div', { class: 'med-card-empty muted', html: '未设置服药时段，点击编辑添加' })
    );
  }

  // 备注（如果有，截一行）
  if (m.notes) {
    const notes = el('div', { class: 'med-card-notes muted' });
    notes.append(icon('info', 'med-card-notes-icon'));
    notes.append(el('span', { html: m.notes }));
    card.append(notes);
  }

  return card;
}

/** 相互作用详情对话框：列出该药涉及的所有相互作用组合 */
function showInteractionDialog(medName: string, hits: DrugInteraction[]): void {
  const card = el('div', { class: 'card interaction-dialog' });
  card.append(el('h3', { html: `${medName} · 相互作用` }));
  const list = el('div', { class: 'interaction-list' });
  for (const h of hits) {
    const sev = h.severity;
    const sevCn = sev === 'severe' ? '严重' : sev === 'moderate' ? '中等' : '轻微';
    const item = el('div', { class: 'interaction-item' });
    item.append(el('span', { class: `severity severity-${sev}`, html: sevCn }));
    item.append(el('div', { class: 'interaction-drugs', html: h.drugs.join(' + ') }));
    item.append(el('div', { class: 'interaction-desc muted', html: h.description }));
    list.append(item);
  }
  card.append(list);
  const closeBtn = el('button', { class: 'btn', html: '关闭' });
  card.append(closeBtn);
  const overlay = openDialog(card);
  closeBtn.onclick = () => overlay.remove();
}

/** 追加过期/近效期标签 */
function appendExpiryTag(host: HTMLElement, m: Medication): void {
  if (!m.expiryDate) return;
  const now = Date.now();
  const diffDays = Math.ceil((m.expiryDate - now) / MS_PER_DAY);
  if (diffDays < 0) {
    host.append(
      el('span', { class: 'med-tag med-tag-danger', html: '已过期' })
    );
  } else if (diffDays <= NEAR_EXPIRY_DAYS) {
    host.append(
      el('span', { class: 'med-tag med-tag-warn', html: `${diffDays} 天后过期` })
    );
  }
}

/** 追加可用天数标签 */
function appendDaysLeftTag(host: HTMLElement, m: Medication, rules: ReminderRule[]): void {
  const days = estimateDaysLeft(m, rules);
  if (days == null || days < 0) return;
  const cls = days <= 3 ? 'med-tag-warn' : 'med-tag-info';
  host.append(
    el('span', { class: `med-tag ${cls}`, html: `约还够 ${days} 天` })
  );
}

/** 追加近 7 天完成率标签 */
function appendAdherenceTag(host: HTMLElement, medId: string, weekLogs: IntakeLog[]): void {
  const medLogs = weekLogs.filter((l) => l.medId === medId);
  const due = medLogs.length;
  if (due === 0) return;
  const done = medLogs.filter((l) => l.status === 'taken' || l.status === 'skipped').length;
  const rate = Math.round((done / due) * 100);
  const cls = rate >= 80 ? 'med-tag-ok' : 'med-tag-warn';
  host.append(
    el('span', { class: `med-tag ${cls}`, html: `近 7 天 ${rate}%` })
  );
}

function slotChip(slot: Slot, time: string, mealText: string): HTMLElement {
  const chip = el('span', { class: 'med-card-slot slot-' + slot });
  chip.append(icon(SLOT_ICON[slot], 'med-card-slot-icon'));
  chip.append(el('span', { class: 'med-card-slot-label', html: SLOT_LABEL[slot] }));
  chip.append(el('span', { class: 'med-card-slot-time', html: time }));
  if (mealText) chip.append(el('span', { class: 'med-card-slot-meal', html: mealText }));
  return chip;
}

// ============ Task 6: 批量管理模式 ============

async function enterBatchMode(root: HTMLElement): Promise<void> {
  const [meds, rules] = await Promise.all([listMeds(), listRules()]);
  if (meds.length === 0) {
    toast('暂无药品可管理');
    return;
  }

  const medRulesMap = new Map<string, ReminderRule[]>();
  for (const m of meds) {
    medRulesMap.set(m.id, rules.filter((r) => r.medId === m.id && !r.deleted));
  }

  const selected = new Set<string>();

  const cancelBtn = el('button', { class: 'icon-btn', 'aria-label': '退出批量管理' } as any);
  cancelBtn.append(icon('arrow-left'));
  cancelBtn.onclick = () => renderMedListPage(root);

  const topRight = el('div', { class: 'topbar-actions', style: 'display:flex;align-items:center;gap:4px' } as any);
  topRight.append(cancelBtn);

  const content = el('div', { class: 'page med-batch-page' });

  // 顶部全选/取消
  const toolbar = el('div', { class: 'med-batch-toolbar' });
  const selectAllBtn = el('button', { class: 'btn small tonal', type: 'button' } as any);
  selectAllBtn.append(el('span', { html: '全选' }));
  selectAllBtn.onclick = () => {
    if (selected.size === meds.length) {
      selected.clear();
    } else {
      for (const m of meds) selected.add(m.id);
    }
    refreshCheckboxStates();
    refreshSelectAllLabel();
  };
  const counterLabel = el('span', { class: 'med-batch-counter muted', html: '已选 0 种' });
  toolbar.append(selectAllBtn, counterLabel);
  content.append(toolbar);

  // 卡片网格
  const grid = el('div', { class: 'meds-grid' });
  const checkboxByMedId = new Map<string, HTMLInputElement>();
  for (const m of meds) {
    const card = el('div', { class: 'card med-card med-batch-card' });
    const checkboxWrap = el('label', { class: 'med-batch-checkbox-wrap' });
    const cb = el('input', { type: 'checkbox', class: 'med-batch-checkbox' } as any) as HTMLInputElement;
    cb.onchange = () => {
      if (cb.checked) selected.add(m.id);
      else selected.delete(m.id);
      refreshSelectAllLabel();
    };
    checkboxWrap.append(cb);
    checkboxByMedId.set(m.id, cb);
    card.append(checkboxWrap);

    const titleWrap = el('div', { class: 'med-card-title-wrap' });
    titleWrap.append(el('div', { class: 'med-card-name', html: m.name || '未命名' }));
    const sub = [m.amountPerDose, m.dosageText].filter(Boolean).join(' · ');
    if (sub) titleWrap.append(el('div', { class: 'med-card-sub muted', html: sub }));
    card.append(titleWrap);

    // 显示该药的时段规则状态
    const slotsRow = el('div', { class: 'med-card-slots' });
    const medRules = medRulesMap.get(m.id) ?? [];
    for (const s of SLOTS) {
      const rule = medRules.find((r) => r.slot === s);
      if (!rule) continue;
      const time = rule.timeLocal || SLOT_DEFAULT_TIME[s];
      const chipEl = el('span', { class: 'med-card-slot slot-' + s + (rule.enabled ? '' : ' disabled') });
      chipEl.append(icon(SLOT_ICON[s], 'med-card-slot-icon'));
      chipEl.append(el('span', { class: 'med-card-slot-label', html: SLOT_LABEL[s] }));
      chipEl.append(el('span', { class: 'med-card-slot-time', html: time }));
      if (!rule.enabled) chipEl.append(el('span', { class: 'med-card-slot-state', html: '已禁用' }));
      slotsRow.append(chipEl);
    }
    if (slotsRow.childElementCount === 0) {
      slotsRow.append(el('span', { class: 'muted', html: '无提醒规则' }));
    }
    card.append(slotsRow);

    grid.append(card);
  }
  content.append(grid);

  // 底部固定操作栏
  const actionbar = el('div', { class: 'med-batch-actionbar' });
  const makeBtn = (text: string, onClick: () => void) => {
    const b = el('button', { class: 'btn small tonal', type: 'button' } as any);
    b.append(el('span', { html: text }));
    b.onclick = onClick;
    return b;
  };
  const allOnBtn = makeBtn('全部启用', () => setRulesForSelected(true));
  const allOffBtn = makeBtn('全部禁用', () => setRulesForSelected(false));
  const morningBtn = makeBtn('早', () => setSlotForSelected('morning', true));
  const noonBtn = makeBtn('中', () => setSlotForSelected('noon', true));
  const eveningBtn = makeBtn('晚', () => setSlotForSelected('evening', true));
  const bedtimeBtn = makeBtn('睡前', () => setSlotForSelected('bedtime', true));

  const slotBtnRow = el('div', { class: 'med-batch-slot-row' });
  slotBtnRow.append(morningBtn, noonBtn, eveningBtn, bedtimeBtn);

  actionbar.append(allOnBtn, allOffBtn, slotBtnRow);
  content.append(actionbar);

  renderPage({ root, title: '批量管理', activeTab: 'meds', topRight, content, showTabbar: false });

  function refreshCheckboxStates(): void {
    for (const [id, cb] of checkboxByMedId) {
      cb.checked = selected.has(id);
    }
    refreshSelectAllLabel();
  }
  function refreshSelectAllLabel(): void {
    selectAllBtn.querySelector('span')!.textContent = selected.size === meds.length ? '取消全选' : '全选';
    counterLabel.textContent = `已选 ${selected.size} 种`;
  }

  async function setRulesForSelected(enabled: boolean): Promise<void> {
    if (selected.size === 0) {
      toast('请先选择药品');
      return;
    }
    const updates: { id: string; enabled: boolean }[] = [];
    for (const medId of selected) {
      const rs = medRulesMap.get(medId) ?? [];
      for (const r of rs) updates.push({ id: r.id, enabled });
    }
    if (updates.length === 0) {
      toast('所选药品没有可操作的提醒');
      return;
    }
    await batchUpdateRules(updates);
    toast(`已${enabled ? '启用' : '禁用'} ${updates.length} 条提醒`);
    renderMedListPage(root);
  }

  async function setSlotForSelected(slot: Slot, enabled: boolean): Promise<void> {
    if (selected.size === 0) {
      toast('请先选择药品');
      return;
    }
    const updates: { id: string; enabled: boolean }[] = [];
    for (const medId of selected) {
      const rs = medRulesMap.get(medId) ?? [];
      for (const r of rs) {
        if (r.slot === slot) updates.push({ id: r.id, enabled });
      }
    }
    if (updates.length === 0) {
      toast(`所选药品没有「${SLOT_LABEL[slot]}」提醒`);
      return;
    }
    await batchUpdateRules(updates);
    toast(`已${enabled ? '启用' : '禁用'} ${updates.length} 条「${SLOT_LABEL[slot]}」提醒`);
    renderMedListPage(root);
  }
}
