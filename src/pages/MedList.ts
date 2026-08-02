// 药品列表页：按药品分组展示（一种药一张卡片，时段标签直接显示在卡片内）
import '../ui/styles/pages/medications.css';
import {
  listMeds,
  listRules,
  listLogsByRange,
  listScheduleRevisions,
  batchUpdateRules,
  softDeleteMed,
} from '../db/local';
import {
  SLOT_LABEL,
  SLOT_DEFAULT_TIME,
  SLOTS,
  formatMealRelsBySlot,
  formatMealRelsForSlot,
  type Medication,
  type MedicationOccurrence,
  type ReminderRule,
  type IntakeLog,
  type Slot,
} from '../db/schema';
import {
  el,
  renderPage,
  emptyState,
  icon,
  toast,
  confirmDialog,
  openDialog,
  closeDialog,
  SLOT_ICON,
  topbarPill,
} from '../ui/components';
import { navigate } from '../router';
import { estimateDaysLeft } from '../features/inventory';
import { getMedPhotoUrls } from '../features/medPhotos';
import { getOrCreateMed3DImage } from '../features/aiImageGen';
import { checkInteractions, type DrugInteraction } from '../data/drugInteractions';
import { isRestDay, rescheduleMedicationReminders } from '../features/reminderScheduler';
import { openBottomSheet } from '../ui/primitives/BottomSheet';
import { createActionDock } from '../ui/primitives/ActionDock';
import { createButton } from '../ui/primitives/Button';
import { createIconButton } from '../ui/primitives/IconButton';
import {
  addLocalDays,
  calculateAdherence,
  generateOccurrences,
  getMedicationExpiryLocalDate,
  localDayBounds,
  toLocalDate,
  type AdherenceSummary,
} from '../domain/medicationSchedule';

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

/** 药品过多时按主时段分组；取 SLOTS 顺序里第一个命中的时段 */
function getPrimarySlot(m: Medication): Slot | 'none' {
  for (const s of SLOTS) {
    if (m.slots.includes(s)) return s;
  }
  return 'none';
}

const GROUP_SLOT_ORDER: Array<Slot | 'none'> = [...SLOTS, 'none'];

export async function renderMedListPage(root: HTMLElement, signal?: AbortSignal): Promise<void> {
  const [meds, rules, revisions] = await Promise.all([
    listMeds(),
    listRules(),
    listScheduleRevisions(),
  ]);
  if (signal?.aborted) return;
  const photoUrls = await getMedPhotoUrls(meds.map((m) => m.id));
  if (signal?.aborted) return;

  const addBtn = topbarPill({ icon: 'plus', label: '添加药品', variant: 'primary', onClick: () => navigate('/meds/new') });

  const batchBtn = topbarPill({ icon: 'list', label: '批量管理' });
  let cleanupPageInteractions: () => void = () => undefined;
  batchBtn.onclick = () => {
    cleanupPageInteractions();
    void enterBatchMode(root, signal);
  };
  const topRight = el('div', { class: 'topbar-actions medication-list-actions' });
  topRight.append(batchBtn, addBtn);

  const content = el('div', { class: 'page medication-list-page' });

  if (meds.length === 0) {
    const addBtn = createButton({ label: '手动添加', icon: 'plus', onClick: () => navigate('/meds/new') });
    const scanBtn = createButton({ label: '扫码添加', icon: 'scan', variant: 'secondary', onClick: () => navigate('/scan') });
    content.append(
      emptyState(
        'pill',
        '还没有药品',
        '添加你长期服用的药物，按时段分类、扫码识别都从这里开始。',
        [addBtn, scanBtn],
      ),
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
  const today = toLocalDate(nowMs);
  const weekStart = addLocalDays(today, -6);
  const weekAgoStart = localDayBounds(weekStart).start;
  const weekEnd = localDayBounds(today).end;
  let weekLogs: IntakeLog[] = [];
  try {
    weekLogs = await listLogsByRange(weekAgoStart, weekEnd);
  } catch {
    weekLogs = [];
  }
  if (signal?.aborted) return;
  const weekOccurrences = generateOccurrences(revisions, weekStart, today);
  const occurrencesByMedId = new Map<string, MedicationOccurrence[]>();
  for (const occurrence of weekOccurrences) {
    const list = occurrencesByMedId.get(occurrence.medId);
    if (list) list.push(occurrence);
    else occurrencesByMedId.set(occurrence.medId, [occurrence]);
  }
  const adherenceByMedId = new Map<string, AdherenceSummary>();
  for (const med of meds) {
    adherenceByMedId.set(
      med.id,
      calculateAdherence(occurrencesByMedId.get(med.id) ?? [], weekLogs, nowMs),
    );
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
  const filterRow = el('div', { class: 'med-filter-row medication-filter-row', role: 'group', 'aria-label': '服药时段筛选' } as any);
  const filterChips = new Map<SlotFilter, HTMLButtonElement>();
  let currentFilter: SlotFilter = 'all';
  for (const key of SLOT_FILTER_ORDER) {
    const chip = el('button', {
      class: 'medication-filter-button' + (key === 'all' ? ' is-selected' : ''),
      html: SLOT_FILTER_LABELS[key],
      type: 'button',
      'aria-pressed': String(key === 'all'),
    } as any) as HTMLButtonElement;
    chip.onclick = () => {
      if (currentFilter === key) return;
      currentFilter = key;
      for (const [k, c] of filterChips) {
        c.classList.toggle('is-selected', k === key);
        c.setAttribute('aria-pressed', String(k === key));
      }
      applyFilter();
    };
    filterChips.set(key, chip);
    filterRow.append(chip);
  }

  const useGroups = meds.length > 8;
  const grid = el('div', { class: 'medication-list' + (useGroups ? ' is-grouped' : ''), role: 'list' } as any);
  const cardByMedId = new Map<string, HTMLElement>();
  const groupSections = new Map<Slot | 'none', HTMLElement>();
  const groupCountBadges = new Map<Slot | 'none', HTMLElement>();

  if (useGroups) {
    for (const slot of GROUP_SLOT_ORDER) {
      const section = el('section', { class: 'medication-list-group', role: 'list' } as any);
      const header = el('div', { class: 'medication-list-group-header' });
      header.append(el('h3', { text: slot === 'none' ? '未分时段' : SLOT_LABEL[slot] }));
      const countBadge = el('span', { class: 'medication-list-group-count' });
      header.append(countBadge);
      section.append(header);
      grid.append(section);
      groupSections.set(slot, section);
      groupCountBadges.set(slot, countBadge);
    }
  }

  for (const m of sorted) {
    const card = renderMedCard(
      m,
      timeByMedSlot.get(m.id),
      rules,
      adherenceByMedId.get(m.id),
      interactionsByMedId.get(m.id) ?? [],
      nowMs,
      photoUrls.get(m.id),
    );
    cardByMedId.set(m.id, card);
    if (useGroups) {
      groupSections.get(getPrimarySlot(m))?.append(card);
    } else {
      grid.append(card);
    }
  }

  content.append(searchBar, filterRow, grid);

  // 搜索 + 时段筛选叠加过滤；分组模式下同步更新组标题计数
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
    if (useGroups) {
      for (const [slot, section] of groupSections) {
        const visible = [...section.querySelectorAll<HTMLElement>('.medication-list-row')].filter(
          (c) => c.style.display !== 'none',
        );
        section.hidden = visible.length === 0;
        groupCountBadges.get(slot)?.setAttribute('data-count', String(visible.length));
        groupCountBadges.get(slot)?.setAttribute('aria-label', `${visible.length} 种药品`);
      }
    }
  };
  const onSearchInput = () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      searchTimer = undefined;
      if (!signal?.aborted) applyFilter();
    }, 200);
  };
  const cleanupSearch = () => {
    window.clearTimeout(searchTimer);
    searchTimer = undefined;
    searchInput.removeEventListener('input', onSearchInput);
    signal?.removeEventListener('abort', cleanupSearch);
  };
  cleanupPageInteractions = cleanupSearch;
  searchInput.addEventListener('input', onSearchInput);
  signal?.addEventListener('abort', cleanupSearch, { once: true });

  renderPage({ root, title: '药品', activeTab: 'meds', topRight, content });
}

function renderMedCard(
  m: Medication,
  slotTimes: Map<Slot, string> | undefined,
  allRules: ReminderRule[],
  adherence: AdherenceSummary | undefined,
  interactions: DrugInteraction[],
  nowMs: number,
  photoUrl?: string,
): HTMLElement {
  const card = el('article', { class: 'medication-list-row', role: 'listitem' } as any);

  const head = el('div', { class: 'medication-list-row-header' });
  // 药盒照片或 3D AI 生图立绘
  const finalPhotoUrl = photoUrl || getOrCreateMed3DImage(m.id, m.name, m.amountPerDose);
  const thumb = el('div', { class: 'medication-list-thumb' });
  const img = el('img', { alt: '', loading: 'lazy', decoding: 'async' });
  img.src = finalPhotoUrl;
  thumb.append(img);
  head.append(thumb);
  const titleWrap = el('div', { class: 'medication-list-copy' });
  titleWrap.append(el('div', { class: 'medication-list-name', text: m.name || '未命名' }));
  const mealText = formatMealRelsBySlot(m.mealRelsBySlot, m.slots);
  const sub = [m.amountPerDose, m.dosageText, mealText].filter(Boolean).join(' · ');
  if (sub) titleWrap.append(el('div', { class: 'medication-list-subline', text: sub }));
  head.append(titleWrap);

  // 状态标签区：过期/近效期/可用天数/近7天完成率/停药期/相互作用
  const metaTags = el('div', { class: 'medication-list-statuses' });
  appendExpiryTag(metaTags, m);
  appendDaysLeftTag(metaTags, m, allRules);
  appendAdherenceTag(metaTags, adherence);
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
      'aria-label': `查看常见相互作用提示（${interactions.length} 条）`,
      title: `内置规则命中 ${interactions.length} 条常见相互作用提示`,
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

  const edit = createIconButton({ icon: 'edit', label: `编辑${m.name || '药品'}`, onClick: () => navigate(`/meds/${m.id}/edit`) });
  head.append(edit);
  card.append(head);

  if (m.slots.length > 0) {
    const slotsRow = el('div', { class: 'medication-list-slots' });
    for (const s of SLOTS) {
      if (!m.slots.includes(s)) continue;
      const time = slotTimes?.get(s) || SLOT_DEFAULT_TIME[s];
      slotsRow.append(slotChip(s, time, formatMealRelsForSlot(s, m.mealRelsBySlot)));
    }
    card.append(slotsRow);
  } else {
    card.append(el('div', { class: 'medication-list-empty', text: '未设置服药时段，点击编辑添加' }));
  }

  // 备注（如果有，截一行）
  if (m.notes) {
    const notes = el('div', { class: 'medication-list-notes' });
    notes.append(icon('info', 'medication-list-notes-icon'));
    notes.append(el('span', { text: m.notes }));
    card.append(notes);
  }

  return card;
}

/** 相互作用详情对话框：列出该药涉及的所有相互作用组合 */
function showInteractionDialog(medName: string, hits: DrugInteraction[]): void {
  const card = el('div', { class: 'card interaction-dialog' });
  card.append(el('h3', { html: `${medName} · 常见相互作用提示` }));
  card.append(el('p', {
    class: 'muted',
    text: '仅覆盖应用内置的有限常见组合，不代表完整药物审查，也不能替代医生或药师意见。',
  }));
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
  closeBtn.onclick = () => closeDialog(overlay);
}

/** 追加过期/近效期标签 */
function appendExpiryTag(host: HTMLElement, m: Medication): void {
  const expiryDate = getMedicationExpiryLocalDate(m);
  if (!expiryDate) return;
  const today = toLocalDate();
  const diffDays = Math.round(
    (localDayBounds(expiryDate).start - localDayBounds(today).start) / MS_PER_DAY,
  );
  if (diffDays < 0) {
    host.append(
      el('span', { class: 'med-tag med-tag-danger', html: '已过期' })
    );
  } else if (diffDays === 0) {
    host.append(el('span', { class: 'med-tag med-tag-warn', html: '今天到期' }));
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

/** 跳过仅计入处理率；依从率固定为已服 / 已到期应服。 */
function appendAdherenceTag(host: HTMLElement, summary: AdherenceSummary | undefined): void {
  if (!summary || summary.due === 0) return;
  const rate = Math.round(summary.adherenceRate * 100);
  const handled = Math.round(summary.handledRate * 100);
  const cls = rate >= 80 ? 'med-tag-ok' : 'med-tag-warn';
  host.append(el('span', {
    class: `med-tag ${cls}`,
    html: `近 7 天按时服药 ${rate}%`,
    title: `已服 ${summary.taken}/${summary.due}；已处理 ${handled}%（跳过 ${summary.skipped}，漏服 ${summary.missed}）`,
  } as any));
}

function slotChip(slot: Slot, time: string, mealText: string): HTMLElement {
  const chip = el('span', { class: 'medication-slot-chip slot-' + slot });
  chip.append(icon(SLOT_ICON[slot], 'medication-slot-icon'));
  chip.append(el('span', { class: 'medication-slot-label', text: SLOT_LABEL[slot] }));
  chip.append(el('span', { class: 'medication-slot-time', text: time }));
  if (mealText) chip.append(el('span', { class: 'medication-slot-meal', text: mealText }));
  return chip;
}

// ============ Task 6: 批量管理模式 ============

export interface BatchRuleRouteOperations {
  updateRules: (updates: { id: string; enabled: boolean }[]) => Promise<void>;
  reschedule: () => Promise<unknown>;
}

const defaultBatchRuleRouteOperations: BatchRuleRouteOperations = {
  updateRules: batchUpdateRules,
  reschedule: rescheduleMedicationReminders,
};

/** Complete persistent work even if navigation starts, but never write back to a stale page. */
export async function commitBatchRuleUpdatesForRoute(
  updates: { id: string; enabled: boolean }[],
  signal: AbortSignal | undefined,
  complete: () => void | Promise<void>,
  operations: BatchRuleRouteOperations = defaultBatchRuleRouteOperations,
): Promise<void> {
  await operations.updateRules(updates);
  await operations.reschedule().catch(() => undefined);
  if (signal?.aborted) return;
  await complete();
}

async function enterBatchMode(root: HTMLElement, signal?: AbortSignal): Promise<void> {
  const [meds, rules] = await Promise.all([listMeds(), listRules()]);
  if (signal?.aborted) return;
  if (meds.length === 0) {
    toast('暂无药品可管理');
    return;
  }

  const medRulesMap = new Map<string, ReminderRule[]>();
  for (const m of meds) {
    medRulesMap.set(m.id, rules.filter((r) => r.medId === m.id && !r.deleted));
  }

  const selected = new Set<string>();
  const cancelBtn = topbarPill({
    icon: 'arrow-left',
    label: '退出批量',
    onClick: () => {
      if (!signal?.aborted) void renderMedListPage(root, signal);
    },
  });
  const topRight = el('div', { class: 'topbar-actions medication-list-actions' });
  topRight.append(cancelBtn);

  const content = el('div', { class: 'page medication-batch-page' });
  const toolbar = el('div', { class: 'medication-batch-toolbar' });
  const selectAllBtn = createButton({ label: '全选', variant: 'text' });
  const counterLabel = el('span', { class: 'medication-batch-counter', text: '已选 0 种' });
  selectAllBtn.onclick = () => {
    if (selected.size === meds.length) {
      selected.clear();
    } else {
      for (const m of meds) selected.add(m.id);
    }
    refreshSelectionState();
  };
  toolbar.append(selectAllBtn, counterLabel);
  content.append(toolbar);

  const grid = el('div', {
    class: 'medication-batch-list',
    role: 'listbox',
    'aria-label': '批量选择药品',
    'aria-multiselectable': 'true',
  } as any);
  const checkboxByMedId = new Map<string, HTMLInputElement>();
  const rowByMedId = new Map<string, HTMLElement>();
  let batchMedNameSeq = 0;
  for (const m of meds) {
    const card = el('article', {
      class: 'medication-batch-row',
      role: 'option',
      'aria-selected': 'false',
    } as any);
    const checkboxWrap = el('label', { class: 'medication-batch-checkbox-wrap' });
    const medNameId = `med-batch-name-${++batchMedNameSeq}`;
    const cb = el('input', {
      type: 'checkbox',
      class: 'medication-batch-checkbox',
      'aria-labelledby': medNameId,
    } as any) as HTMLInputElement;
    cb.onchange = () => {
      if (cb.checked) selected.add(m.id); else selected.delete(m.id);
      refreshSelectionState();
    };
    checkboxWrap.append(cb);
    checkboxByMedId.set(m.id, cb);
    rowByMedId.set(m.id, card);
    card.append(checkboxWrap);

    const body = el('div', { class: 'medication-batch-body' });
    const titleWrap = el('div', { class: 'medication-batch-copy' });
    titleWrap.append(el('div', { id: medNameId, class: 'medication-batch-name', text: m.name || '未命名' }));
    const sub = [m.amountPerDose, m.dosageText].filter(Boolean).join(' · ');
    if (sub) titleWrap.append(el('div', { class: 'medication-batch-subline', text: sub }));
    body.append(titleWrap);

    const slotsRow = el('div', { class: 'medication-batch-slots' });
    const medRules = medRulesMap.get(m.id) ?? [];
    for (const s of SLOTS) {
      const rule = medRules.find((r) => r.slot === s);
      if (!rule) continue;
      const time = rule.timeLocal || SLOT_DEFAULT_TIME[s];
      const chipEl = el('span', { class: 'medication-slot-chip slot-' + s + (rule.enabled ? '' : ' is-disabled') });
      chipEl.append(icon(SLOT_ICON[s], 'medication-slot-icon'));
      chipEl.append(el('span', { class: 'medication-slot-label', text: SLOT_LABEL[s] }));
      chipEl.append(el('span', { class: 'medication-slot-time', text: time }));
      if (!rule.enabled) chipEl.append(el('span', { class: 'medication-slot-disabled', text: '已禁用' }));
      slotsRow.append(chipEl);
    }
    if (slotsRow.childElementCount === 0) {
      slotsRow.append(el('span', { class: 'medication-batch-no-rules', text: '无提醒规则' }));
    }
    body.append(slotsRow);
    card.append(body);
    grid.append(card);
  }
  content.append(grid);

  const dock = createActionDock();
  dock.classList.add('medication-batch-dock');
  const dockCounter = el('span', { class: 'medication-batch-dock-count', text: '已选 0 种' });
  const enableButton = createButton({ label: '启用', variant: 'secondary', onClick: () => void setRulesForSelected(true) });
  const disableButton = createButton({ label: '禁用', variant: 'secondary', onClick: () => void setRulesForSelected(false) });
  const slotButton = createButton({ label: '修改时段', variant: 'secondary', icon: 'clock', onClick: openSlotMenu });
  const deleteButton = createButton({ label: '删除所选', variant: 'danger', icon: 'trash', onClick: () => void deleteSelected() });
  dock.append(dockCounter, enableButton, disableButton, slotButton, deleteButton);

  renderPage({ root, title: '批量管理', activeTab: 'meds', topRight, content, actionDock: dock });

  function refreshSelectionState(): void {
    for (const [id, cb] of checkboxByMedId) {
      const isSelected = selected.has(id);
      cb.checked = isSelected;
      const row = rowByMedId.get(id);
      row?.classList.toggle('is-selected', isSelected);
      row?.setAttribute('aria-selected', String(isSelected));
    }
    const text = `已选 ${selected.size} 种`;
    selectAllBtn.querySelector('span')!.textContent = selected.size === meds.length ? '取消全选' : '全选';
    counterLabel.textContent = text;
    dockCounter.textContent = text;
  }

  async function setRulesForSelected(enabled: boolean): Promise<void> {
    if (signal?.aborted) return;
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
      toast('选中的这些药还没设过提醒时间');
      return;
    }
    await commitBatchRuleUpdatesForRoute(updates, signal, () => {
      toast(`已${enabled ? '启用' : '禁用'} ${updates.length} 条提醒`);
      return renderMedListPage(root, signal);
    });
  }

  async function deleteSelected(): Promise<void> {
    if (signal?.aborted) return;
    if (selected.size === 0) {
      toast('请先选择药品');
      return;
    }
    const count = selected.size;
    if (!(await confirmDialog(`确定删除已选的 ${count} 种药品及其提醒吗？\n此操作不能恢复。`, '删除所选', true))) {
      return;
    }
    deleteButton.disabled = true;
    try {
      for (const medId of selected) await softDeleteMed(medId);
      await rescheduleMedicationReminders().catch(() => undefined);
      if (signal?.aborted) return;
      toast(`已删除 ${count} 种药品`);
      await renderMedListPage(root, signal);
    } catch {
      toast('删除失败，请稍后重试');
    } finally {
      deleteButton.disabled = false;
    }
  }

  async function setSlotForSelected(slot: Slot, enabled: boolean): Promise<void> {
    if (signal?.aborted) return;
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
    await commitBatchRuleUpdatesForRoute(updates, signal, () => {
      toast(`已${enabled ? '启用' : '禁用'} ${updates.length} 条「${SLOT_LABEL[slot]}」提醒`);
      return renderMedListPage(root, signal);
    });
  }

  function openSlotMenu(): void {
    if (selected.size === 0) {
      toast('请先选择药品');
      return;
    }
    const title = el('h2', { class: 'medication-batch-sheet-title', text: '启用提醒时段' });
    const hint = el('p', { class: 'medication-batch-sheet-hint', text: '仅启用所选药品已经设置的时段和提醒时间。' });
    const options = el('div', { class: 'medication-batch-sheet-options' });
    let sheet: ReturnType<typeof openBottomSheet> | undefined;
    for (const slot of SLOTS) {
      options.append(createButton({
        label: SLOT_LABEL[slot],
        variant: 'secondary',
        onClick: () => {
          sheet?.close();
          void setSlotForSelected(slot, true);
        },
      }));
    }
    sheet = openBottomSheet({ label: '选择要启用的提醒时段', content: [title, hint, options] });
  }
}
