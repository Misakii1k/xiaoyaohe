import { listMeds, listRules, putMed } from '../db/local';
import type { Medication, ReminderRule } from '../db/schema';
import {
  classifyInventoryStatus,
  estimateDaysLeft,
  getLowStockThreshold,
  isLowStock,
  roundStock,
  type InventoryStatus,
} from '../features/inventory';
import { getMedPhotoUrls } from '../features/medPhotos';
import { navigate } from '../router';
import { el, emptyState, icon, renderPage, toast } from '../ui/components';
import { openBottomSheet, type BottomSheetHandle } from '../ui/primitives/BottomSheet';
import { createButton } from '../ui/primitives/Button';
import { createIconButton } from '../ui/primitives/IconButton';

type InventoryFilter = 'all' | 'low' | 'empty' | 'unset' | 'days_low';

const FILTERS: readonly { key: InventoryFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'low', label: '低库存' },
  { key: 'empty', label: '已用完' },
  { key: 'unset', label: '未设置' },
  { key: 'days_low', label: '快见底' },
];

const STATUS_ORDER: Readonly<Record<InventoryStatus, number>> = {
  empty: 0,
  low: 1,
  days_low: 2,
  ok: 3,
  unset: 4,
};

export async function renderMedInventoryPage(root: HTMLElement, signal?: AbortSignal): Promise<void> {
  const [meds, rules] = await Promise.all([listMeds(), listRules()]);
  if (signal?.aborted) return;
  const photoUrls = await getMedPhotoUrls(meds.map((med) => med.id));
  if (signal?.aborted) return;

  const content = el('div', { class: 'page inventory-page' });

  if (meds.length === 0) {
    const add = createButton({ label: '去添加药品', icon: 'plus', onClick: () => navigate('/meds/new') });
    content.append(emptyState('box', '还没有药品', '先添加药品，再记录手头还剩多少。', add));
    renderPage({ root, title: '库存', activeTab: 'inventory', content });
    return;
  }

  const activeRules = rules.filter((rule) => rule.enabled && !rule.deleted);
  const rulesByMedId = groupRulesByMedId(activeRules);
  const sorted = [...meds].sort((left, right) => {
    const statusDifference = STATUS_ORDER[classifyInventoryStatus(left, rulesByMedId.get(left.id) ?? [])]
      - STATUS_ORDER[classifyInventoryStatus(right, rulesByMedId.get(right.id) ?? [])];
    return statusDifference || left.name.localeCompare(right.name, 'zh-Hans-CN');
  });

  const summary = el('section', { class: 'inventory-summary', 'aria-label': '库存摘要' } as any);
  const summaryItems: readonly [string, number, string][] = [
    ['在管药品', meds.length, 'is-managed'],
    ['低库存', meds.filter(isLowStock).length, 'is-low'],
    ['已用完', meds.filter((med) => med.inventory && med.inventory.remaining <= 0).length, 'is-empty'],
    ['未设置', meds.filter((med) => !med.inventory).length, 'is-unset'],
  ];
  for (const [label, value, modifier] of summaryItems) {
    summary.append(
      el('div', { class: `inventory-summary-item ${modifier}` }, [
        el('strong', { text: String(value) }),
        el('span', { text: label }),
      ]),
    );
  }

  const searchInput = el('input', {
    type: 'search',
    class: 'med-search-input',
    placeholder: '搜索药名 / 规格',
    'aria-label': '搜索库存药品',
  } as any) as HTMLInputElement;
  const searchBar = el('div', { class: 'med-search-bar inventory-search' });
  searchBar.append(icon('pill', 'med-search-icon'), searchInput);

  const filterRow = el('div', {
    class: 'med-filter-row medication-filter-row inventory-filter-row',
    role: 'group',
    'aria-label': '库存状态筛选',
  } as any);
  const filterButtons = new Map<InventoryFilter, HTMLButtonElement>();
  let currentFilter: InventoryFilter = 'all';

  const list = el('div', { class: 'inventory-list', role: 'list' } as any);
  const rowByMedId = new Map<string, HTMLElement>();
  for (const med of sorted) {
    const medRules = rulesByMedId.get(med.id) ?? [];
    const row = renderInventoryRow(med, medRules, photoUrls.get(med.id), () => {
      openInventoryActions(root, med, signal);
    });
    rowByMedId.set(med.id, row);
    list.append(row);
  }

  const clearFilters = createButton({
    label: '清除筛选',
    variant: 'secondary',
    onClick: () => {
      searchInput.value = '';
      setFilter('all');
    },
  });
  const noResults = emptyState('box', '没有符合条件的药', '换个关键词或清除筛选后再看。', clearFilters);
  noResults.classList.add('inventory-no-results');
  noResults.hidden = true;

  for (const { key, label } of FILTERS) {
    const button = el('button', {
      class: `medication-filter-button${key === 'all' ? ' is-selected' : ''}`,
      type: 'button',
      text: label,
      'aria-pressed': String(key === 'all'),
    } as any) as HTMLButtonElement;
    button.onclick = () => setFilter(key);
    filterButtons.set(key, button);
    filterRow.append(button);
  }

  function setFilter(filter: InventoryFilter): void {
    currentFilter = filter;
    for (const [key, button] of filterButtons) {
      const selected = key === filter;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    applyFilters();
  }

  function applyFilters(): void {
    const keyword = searchInput.value.trim().toLocaleLowerCase('zh-CN');
    let visibleCount = 0;
    for (const med of sorted) {
      const row = rowByMedId.get(med.id);
      if (!row) continue;
      const medRules = rulesByMedId.get(med.id) ?? [];
      const matchesKeyword = !keyword
        || med.name.toLocaleLowerCase('zh-CN').includes(keyword)
        || med.dosageText.toLocaleLowerCase('zh-CN').includes(keyword);
      const matchesFilter = matchesInventoryFilter(med, medRules, currentFilter);
      const visible = matchesKeyword && matchesFilter;
      row.hidden = !visible;
      if (visible) visibleCount += 1;
    }
    list.hidden = visibleCount === 0;
    noResults.hidden = visibleCount > 0;
  }

  searchInput.addEventListener('input', applyFilters);
  content.append(summary, searchBar, filterRow, list, noResults);
  renderPage({ root, title: '库存', activeTab: 'inventory', content });
}

function groupRulesByMedId(rules: ReminderRule[]): Map<string, ReminderRule[]> {
  const grouped = new Map<string, ReminderRule[]>();
  for (const rule of rules) {
    const group = grouped.get(rule.medId) ?? [];
    group.push(rule);
    grouped.set(rule.medId, group);
  }
  return grouped;
}

function matchesInventoryFilter(
  med: Medication,
  rules: ReminderRule[],
  filter: InventoryFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'low') return isLowStock(med);
  if (filter === 'empty') return !!med.inventory && med.inventory.remaining <= 0;
  if (filter === 'unset') return !med.inventory;
  const daysLeft = estimateDaysLeft(med, rules);
  return daysLeft != null && daysLeft <= 7;
}

function renderInventoryRow(
  med: Medication,
  rules: ReminderRule[],
  photoUrl: string | undefined,
  onOpen: () => void,
): HTMLElement {
  const row = el('article', { class: 'inventory-row', role: 'listitem' } as any);
  const main = el('button', {
    class: 'inventory-row-main',
    type: 'button',
    'aria-label': `${med.name || '未命名药品'}库存操作`,
  } as any) as HTMLButtonElement;
  main.onclick = onOpen;

  const thumb = el('span', { class: `inventory-thumb${photoUrl ? '' : ' is-placeholder'}` });
  if (photoUrl) {
    const image = el('img', { alt: '', loading: 'lazy', decoding: 'async' } as any) as HTMLImageElement;
    image.src = photoUrl;
    thumb.append(image);
  } else {
    thumb.append(icon('box'));
  }

  const copy = el('span', { class: 'inventory-row-copy' });
  copy.append(el('strong', { class: 'inventory-row-name', text: med.name || '未命名' }));
  const daysLeft = estimateDaysLeft(med, rules);
  const details = buildInventoryDetails(med, daysLeft);
  if (details) copy.append(el('span', { class: 'inventory-row-details', text: details }));
  copy.append(renderInventoryTags(med, rules, daysLeft));
  main.append(thumb, copy);

  const edit = createIconButton({ icon: 'edit', label: `编辑${med.name || '药品'}库存` });
  edit.onclick = () => navigate(`/meds/${med.id}/edit`);
  row.append(main, edit);
  return row;
}

function buildInventoryDetails(med: Medication, daysLeft: number | null): string {
  const details: string[] = [];
  if (med.inventory) details.push(`剩余 ${formatQuantity(med.inventory.remaining)}${med.inventory.unit}`);
  if (med.doseQuantity != null && med.doseUnit) {
    details.push(`每次 ${formatQuantity(med.doseQuantity)}${med.doseUnit}`);
  } else if (med.amountPerDose.trim()) {
    details.push(`每次 ${med.amountPerDose.trim()}`);
  }
  if (daysLeft != null) details.push(`约还够 ${daysLeft} 天`);
  return details.join(' · ');
}

function renderInventoryTags(med: Medication, rules: ReminderRule[], daysLeft: number | null): HTMLElement {
  const tags = el('span', { class: 'inventory-row-tags' });
  const status = classifyInventoryStatus(med, rules);
  if (status === 'unset') tags.append(inventoryTag('未设置库存', 'muted'));
  if (status === 'empty') tags.append(inventoryTag('已用完', 'danger'));
  if (status === 'low') tags.append(inventoryTag('库存不足', 'warn'));
  if (daysLeft != null) tags.append(inventoryTag(`约还够 ${daysLeft} 天`, daysLeft <= 3 ? 'warn' : 'info'));
  if (med.inventory?.packageQuantity != null) {
    tags.append(inventoryTag(`一盒 ${formatQuantity(med.inventory.packageQuantity)}${med.inventory.unit}`, 'muted'));
  }
  return tags;
}

function inventoryTag(text: string, tone: 'danger' | 'warn' | 'info' | 'muted'): HTMLElement {
  return el('span', { class: `inventory-tag is-${tone}`, text });
}

function openInventoryActions(root: HTMLElement, med: Medication, signal?: AbortSignal): void {
  const title = el('h2', { class: 'inventory-sheet-title', text: med.name || '未命名药品' });
  const hint = el('p', {
    class: 'inventory-sheet-hint',
    text: med.inventory
      ? `现在剩余 ${formatQuantity(med.inventory.remaining)}${med.inventory.unit}，低库存线为 ${formatQuantity(getLowStockThreshold(med))}${med.inventory.unit}。`
      : '还没有记录剩余数量，请先在编辑页完善库存。',
  });
  const actions = el('div', { class: 'inventory-sheet-actions' });
  let sheet: BottomSheetHandle | undefined;

  const editInventory = () => {
    sheet?.close();
    navigate(`/meds/${med.id}/edit`);
  };
  if (!med.inventory) {
    actions.append(createButton({ label: '完善库存', icon: 'edit', onClick: editInventory }));
    actions.append(createButton({ label: '取消', variant: 'text', onClick: () => sheet?.close() }));
    sheet = openBottomSheet({ label: `${med.name}库存操作`, content: [title, hint, actions] });
    return;
  }

  const save = async (nextRemaining: number, successMessage: string): Promise<void> => {
    sheet?.close();
    med.inventory!.remaining = roundStock(Math.max(0, nextRemaining));
    try {
      await putMed(med);
      if (signal?.aborted) return;
      toast(successMessage);
      await renderMedInventoryPage(root, signal);
    } catch {
      toast('库存保存失败，请稍后重试');
    }
  };

  actions.append(createButton({
    label: '补一盒',
    icon: 'plus',
    onClick: () => {
      const packageQuantity = med.inventory?.packageQuantity;
      if (!packageQuantity) {
        sheet?.close();
        toast('先在编辑页填写“一盒有多少”');
        navigate(`/meds/${med.id}/edit`);
        return;
      }
      void save(med.inventory!.remaining + packageQuantity, `已补一盒，剩余 ${formatQuantity(med.inventory!.remaining + packageQuantity)}${med.inventory!.unit}`);
    },
  }));
  if (med.inventory.packageQuantity) {
    actions.append(createButton({
      label: '设为整盒',
      variant: 'secondary',
      onClick: () => void save(med.inventory!.packageQuantity!, `已设为整盒 ${formatQuantity(med.inventory!.packageQuantity!)}${med.inventory!.unit}`),
    }));
  }

  const numberWrap = el('label', { class: 'inventory-sheet-number' });
  numberWrap.append(el('span', { text: `改剩余（${med.inventory.unit}）` }));
  const numberInput = el('input', {
    type: 'number',
    min: '0',
    step: '0.1',
    inputMode: 'decimal',
    value: String(med.inventory.remaining),
  } as any) as HTMLInputElement;
  numberWrap.append(numberInput);
  actions.append(numberWrap);
  actions.append(createButton({
    label: '保存剩余数量',
    variant: 'secondary',
    onClick: () => {
      const next = Number(numberInput.value);
      if (!Number.isFinite(next) || next < 0) {
        toast('请输入不小于 0 的剩余数量');
        numberInput.focus();
        return;
      }
      void save(next, `剩余数量已改为 ${formatQuantity(next)}${med.inventory!.unit}`);
    },
  }));
  if (med.inventory.remaining > 0) {
    actions.append(createButton({
      label: '标记用完',
      variant: 'danger',
      onClick: () => void save(0, '已标记为用完'),
    }));
  }
  actions.append(createButton({ label: '编辑库存详情', variant: 'text', icon: 'edit', onClick: editInventory }));
  actions.append(createButton({ label: '取消', variant: 'text', onClick: () => sheet?.close() }));
  sheet = openBottomSheet({
    label: `${med.name}库存操作`,
    content: [title, hint, actions],
    initialFocus: actions.querySelector<HTMLButtonElement>('button') ?? undefined,
  });
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(roundStock(value));
}
