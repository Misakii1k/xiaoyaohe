import '../ui/styles/pages/inventory.css';
import { getMed, listMeds, listRules, listRecentInventoryOperations, undoInventoryOperation, batchDeductInventory, updateMedicationInventory } from '../db/local';
import { INVENTORY_SOURCE_LABEL, type Medication, type MedicationInventory, type ReminderRule } from '../db/schema';
import {
  classifyInventoryStatus,
  estimateDaysLeft,
  getLowStockThreshold,
  isLowStock,
  roundStock,
  calculateBatchDeductionPreview,
  type InventoryStatus,
} from '../features/inventory';
import { getMedPhotoUrls } from '../features/medPhotos';
import { navigate } from '../router';
import { el, emptyState, icon, renderPage, toast } from '../ui/components';
import { openBottomSheet, type BottomSheetHandle } from '../ui/primitives/BottomSheet';
import { createButton } from '../ui/primitives/Button';
import { createIconButton } from '../ui/primitives/IconButton';
import { toLocalDate } from '../domain/medicationSchedule';
import { matchPinyinOrText } from '../utils/pinyin';
import {
  createIdentifySession,
  identifyInventoryBatchByBlob,
  IdentifyError,
  mergeInventoryEntryItems,
  type InventoryEntryAction,
  type InventorySpeechItem,
  type PrescriptionItemDraft,
} from '../ai/identify';
import { setPendingMedicationBatch } from '../ai/pendingMedicationBatch';
import { recognizeMedicationImageBatch } from '../features/medicationBatch';
import { processInventoryReviewCommits } from '../features/inventoryReview';

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
    const addBtn = createButton({ label: '去添加药品', icon: 'plus', onClick: () => navigate('/meds/new') });
    const scanBtn = createButton({ label: '扫码添加', icon: 'scan', variant: 'secondary', onClick: () => navigate('/scan') });
    content.append(
      emptyState(
        'box',
        '还没有药品',
        '先添加药品，再记录手头还剩多少。',
        [addBtn, scanBtn],
      ),
    );
    renderPage({ root, title: '库存', activeTab: 'inventory', content });
    return;
  }

  const moreBtn = createIconButton({
    icon: 'dots',
    label: '更多操作',
    onClick: () => {
      let sheet: BottomSheetHandle | undefined;
      const title = el('h2', { class: 'inventory-sheet-title', text: '库存操作' });
      const actions = el('div', { class: 'inventory-sheet-actions' });

      const historyBtn = createButton({
        label: '历史操作',
        icon: 'clock',
        variant: 'secondary',
        onClick: () => { sheet?.close(); openInventoryHistorySheet(root, signal); },
      });
      const batchBtn = createButton({
        label: '批量预扣',
        icon: 'box',
        variant: 'secondary',
        onClick: () => { sheet?.close(); openBatchDeductSheet(root, meds, rules, signal); },
      });
      const shareBtn = createButton({
        label: '分享库存',
        icon: 'share',
        variant: 'secondary',
        onClick: () => { sheet?.close(); openShareSheet(sorted, rulesByMedId); },
      });

      actions.append(historyBtn, batchBtn, shareBtn);
      sheet = openBottomSheet({ label: '库存操作', content: [title, actions] });
    },
  });

  const topRight = el('div', { class: 'topbar-actions' });
  topRight.append(moreBtn);

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

  const quickActions = el('section', { class: 'inventory-quick-actions', 'aria-label': '库存快捷操作' } as any);
  quickActions.append(
    createButton({
      label: '添加库存',
      icon: 'plus',
      onClick: () => openInventoryMedicationPicker(root, sorted, signal),
    }),
    createButton({
      label: '智能录入',
      icon: 'sparkles',
      variant: 'secondary',
      onClick: () => openInventorySmartSheet(root, sorted, rulesByMedId, signal),
    }),
  );

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
      class: `inventory-filter-button${key === 'all' ? ' is-selected' : ''}`,
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
    const keyword = searchInput.value.trim();
    let visibleCount = 0;
    for (const med of sorted) {
      const row = rowByMedId.get(med.id);
      if (!row) continue;
      const medRules = rulesByMedId.get(med.id) ?? [];
      const matchesKeyword = !keyword
        || matchPinyinOrText(med.name, keyword)
        || matchPinyinOrText(med.dosageText, keyword);
      const matchesFilter = matchesInventoryFilter(med, medRules, currentFilter);
      const visible = matchesKeyword && matchesFilter;
      row.hidden = !visible;
      if (visible) visibleCount += 1;
    }
    list.hidden = visibleCount === 0;
    noResults.hidden = visibleCount > 0;
  }

  searchInput.addEventListener('input', applyFilters);
  content.append(summary, quickActions, searchBar, filterRow, list, noResults);
  renderPage({ root, title: '库存', activeTab: 'inventory', topRight, content });
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

function openInventoryMedicationPicker(root: HTMLElement, meds: Medication[], signal?: AbortSignal): void {
  const title = el('h2', { class: 'inventory-sheet-title', text: '选择要入库的药品' });
  const search = el('input', {
    type: 'search',
    class: 'inventory-picker-search',
    placeholder: '搜索药名或规格',
    'aria-label': '搜索要入库的药品',
  } as any) as HTMLInputElement;
  const list = el('div', { class: 'inventory-picker-list' });
  const empty = el('p', { class: 'inventory-sheet-hint', text: '没有匹配的药品' });
  empty.hidden = true;
  let sheet: BottomSheetHandle | undefined;

  const render = () => {
    const keyword = search.value.trim();
    const visible = meds.filter((med) => !keyword
      || matchPinyinOrText(med.name, keyword)
      || matchPinyinOrText(med.dosageText, keyword));
    list.replaceChildren(...visible.map((med) => {
      const button = el('button', {
        class: 'inventory-picker-item',
        type: 'button',
        'aria-label': `给${med.name}添加库存`,
      } as any) as HTMLButtonElement;
      const current = med.inventory
        ? `当前 ${formatQuantity(med.inventory.remaining)}${med.inventory.unit}`
        : '尚未设置库存';
      button.append(
        el('strong', { text: med.name || '未命名药品' }),
        el('span', { text: [med.dosageText, current].filter(Boolean).join(' · ') }),
        icon('chevron-right'),
      );
      button.onclick = () => {
        sheet?.close();
        openInventoryAddSheet(root, med, signal);
      };
      return button;
    }));
    empty.hidden = visible.length > 0;
  };

  search.addEventListener('input', render);
  render();
  sheet = openBottomSheet({
    label: '选择要入库的药品',
    className: 'inventory-picker-sheet',
    content: [title, search, list, empty],
    initialFocus: search,
  });
}

function openInventoryAddSheet(root: HTMLElement, med: Medication, signal?: AbortSignal): void {
  const current = med.inventory?.remaining ?? 0;
  const title = el('h2', { class: 'inventory-sheet-title', text: `给「${med.name}」添加库存` });
  const hint = el('p', {
    class: 'inventory-sheet-hint',
    text: med.inventory
      ? `当前剩余 ${formatQuantity(current)}${med.inventory.unit}，本次数量会加到现有库存上。`
      : '这是第一次记录库存，请填写本次入库数量和单位。',
  });
  const form = el('div', { class: 'inventory-add-form' });
  const quantityLabel = el('label', { class: 'inventory-sheet-number' });
  quantityLabel.append(el('span', { text: '本次新增数量' }));
  const quantity = el('input', {
    type: 'number',
    min: '0',
    step: '0.1',
    inputMode: 'decimal',
    value: med.inventory?.packageQuantity ? String(med.inventory.packageQuantity) : '',
    placeholder: '例如 20',
  } as any) as HTMLInputElement;
  quantityLabel.append(quantity);

  const unitLabel = el('label', { class: 'inventory-sheet-number' });
  unitLabel.append(el('span', { text: '单位' }));
  const unit = el('input', {
    type: 'text',
    value: med.inventory?.unit ?? '片',
    placeholder: '片 / 粒 / 袋 / mL',
    readOnly: Boolean(med.inventory?.unit),
  } as any) as HTMLInputElement;
  unitLabel.append(unit);

  const preview = el('p', { class: 'inventory-add-preview', 'aria-live': 'polite' } as any);
  const updatePreview = () => {
    const amount = Number(quantity.value);
    const safeAmount = Number.isFinite(amount) && amount >= 0 ? amount : 0;
    const displayUnit = unit.value.trim() || med.inventory?.unit || '单位';
    preview.textContent = `${formatQuantity(current)}${displayUnit} + ${formatQuantity(safeAmount)}${displayUnit} = ${formatQuantity(current + safeAmount)}${displayUnit}`;
  };
  quantity.addEventListener('input', updatePreview);
  unit.addEventListener('input', updatePreview);
  updatePreview();
  form.append(quantityLabel, unitLabel, preview);

  const actions = el('div', { class: 'inventory-sheet-actions' });
  let sheet: BottomSheetHandle | undefined;
  const save = createButton({
    label: '确认添加库存',
    icon: 'plus',
    onClick: async () => {
      const amount = Number(quantity.value);
      const displayUnit = unit.value.trim();
      if (!Number.isFinite(amount) || amount <= 0) {
        toast('请输入大于 0 的入库数量');
        quantity.focus();
        return;
      }
      if (!displayUnit) {
        toast('请填写库存单位');
        unit.focus();
        return;
      }
      save.disabled = true;
      try {
        const committed = await updateMedicationInventory(
          med.id,
          { action: 'add', quantity: roundStock(amount), unit: displayUnit },
          { source: 'manual', sourceNote: `手动入库 +${formatQuantity(amount)}${displayUnit}` },
        );
        sheet?.close();
        if (signal?.aborted) return;
        toast(`已入库，现剩 ${formatQuantity(committed.med.inventory!.remaining)}${committed.med.inventory!.unit}`);
        await renderMedInventoryPage(root, signal);
      } catch (error) {
        save.disabled = false;
        toast(error instanceof Error ? error.message : '库存保存失败，请稍后重试');
      }
    },
  });
  actions.append(save, createButton({ label: '取消', variant: 'text', onClick: () => sheet?.close() }));
  sheet = openBottomSheet({
    label: `给${med.name}添加库存`,
    className: 'inventory-add-sheet',
    content: [title, hint, form, actions],
    initialFocus: quantity,
  });
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
    actions.append(createButton({
      label: '添加库存',
      icon: 'plus',
      onClick: () => {
        sheet?.close();
        openInventoryAddSheet(root, med, signal);
      },
    }));
    actions.append(createButton({ label: '编辑药品详情', icon: 'edit', variant: 'secondary', onClick: editInventory }));
    actions.append(createButton({ label: '取消', variant: 'text', onClick: () => sheet?.close() }));
    sheet = openBottomSheet({ label: `${med.name}库存操作`, content: [title, hint, actions] });
    return;
  }

  const save = async (
    quantity: number,
    action: 'set' | 'add' | 'mark_empty' = 'set',
  ): Promise<void> => {
    sheet?.close();
    try {
      const { remaining: expectedRemaining, unit } = med.inventory!;
      const committed = await updateMedicationInventory(
        med.id,
        action === 'add'
          ? { action, quantity, unit }
          : action === 'mark_empty'
            ? { action, unit, expectedRemaining, expectedUnit: unit }
            : { action, remaining: roundStock(Math.max(0, quantity)), unit, expectedRemaining, expectedUnit: unit },
        {
          source: 'manual',
          sourceNote: action === 'add' ? `手动补货 +${quantity}${unit}` : action === 'mark_empty' ? '手动标记用完' : `手动设置库存为 ${quantity}${unit}`,
        },
      );
      if (signal?.aborted) return;
      const inventory = committed.med.inventory!;
      toast(`库存已更新，剩余 ${formatQuantity(inventory.remaining)}${inventory.unit}`);
      await renderMedInventoryPage(root, signal);
    } catch (error) {
      toast(error instanceof Error ? error.message : '库存保存失败，请稍后重试');
    }
  };

  actions.append(createButton({
    label: '添加库存',
    icon: 'plus',
    onClick: () => {
      sheet?.close();
      openInventoryAddSheet(root, med, signal);
    },
  }));
  if (med.inventory.packageQuantity) {
    actions.append(createButton({
      label: `补一盒（+${formatQuantity(med.inventory.packageQuantity)}${med.inventory.unit}）`,
      variant: 'secondary',
      icon: 'box',
      onClick: () => void save(med.inventory!.packageQuantity!, 'add'),
    }));
  }
  if (med.inventory.packageQuantity) {
    actions.append(createButton({
      label: '设为整盒',
      variant: 'secondary',
      onClick: () => void save(med.inventory!.packageQuantity!),
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
      void save(next);
    },
  }));
  if (med.inventory.remaining > 0) {
    actions.append(createButton({
      label: '标记用完',
      variant: 'danger',
      onClick: () => void save(0, 'mark_empty'),
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

/** 把库存按"需购买 / 全部"两种范围整理成可分享的纯文本清单。 */
function buildShareText(
  scope: 'low' | 'all',
  sorted: Medication[],
  rulesByMedId: Map<string, ReminderRule[]>,
): string {
  const today = toLocalDate();
  const title = scope === 'low' ? '【小药盒·需购买清单】' : '【小药盒·库存清单】';
  const rows: string[] = [];
  for (const med of sorted) {
    const medRules = rulesByMedId.get(med.id) ?? [];
    const status = classifyInventoryStatus(med, medRules);
    if (scope === 'low' && status !== 'empty' && status !== 'low' && status !== 'days_low') continue;
    if (med.inventory) {
      const daysLeft = estimateDaysLeft(med, medRules);
      if (med.inventory.remaining <= 0) {
        rows.push(`- ${med.name}：已用完`);
      } else {
        const days = daysLeft != null ? `（约 ${daysLeft} 天）` : '';
        rows.push(`- ${med.name}：剩余 ${formatQuantity(med.inventory.remaining)}${med.inventory.unit}${days}`);
      }
    } else {
      rows.push(`- ${med.name}：未设置库存`);
    }
  }
  if (rows.length === 0) {
    return scope === 'low' ? `${title} ${today}\n\n目前没有需要补充的药品，库存都很充足。` : `${title} ${today}\n\n还没有记录库存的药品。`;
  }
  return `${title} ${today}\n\n${rows.join('\n')}`;
}

/** 调系统分享，不支持时复制到剪贴板兜底。用户取消分享静默处理。 */
async function shareInventory(text: string): Promise<void> {
  const nav = navigator as Navigator & { share?: (data: { title?: string; text: string }) => Promise<void> };
  if (nav.share) {
    try {
      await nav.share({ title: '小药盒·库存清单', text });
      return;
    } catch {
      // 用户取消或分享失败 → 走剪贴板兜底
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('清单已复制，可粘贴到微信发送');
  } catch {
    toast('分享不可用，请长按复制');
  }
}

/** 分享前选范围：需购买清单 / 全部库存。 */
function openShareSheet(sorted: Medication[], rulesByMedId: Map<string, ReminderRule[]>): void {
  const title = el('h2', { class: 'inventory-sheet-title', text: '分享库存清单' });
  const hint = el('p', { class: 'inventory-sheet-hint', text: '选要分享的范围，会调用系统分享（微信、短信等），不支持则复制到剪贴板。' });
  const actions = el('div', { class: 'inventory-sheet-actions' });
  let sheet: BottomSheetHandle | undefined;
  actions.append(createButton({
    label: '需购买清单',
    icon: 'warn',
    onClick: async () => {
      sheet?.close();
      await shareInventory(buildShareText('low', sorted, rulesByMedId));
    },
  }));
  actions.append(createButton({
    label: '全部库存',
    variant: 'secondary',
    icon: 'box',
    onClick: async () => {
      sheet?.close();
      await shareInventory(buildShareText('all', sorted, rulesByMedId));
    },
  }));
  actions.append(createButton({ label: '取消', variant: 'text', onClick: () => sheet?.close() }));
  sheet = openBottomSheet({ label: '分享库存清单', content: [title, hint, actions] });
}

/** 智能录入：拍照/相册图片识别库存。识别后匹配已有药品→更新；未登记→提示去添加。 */
function openInventorySmartSheet(
  root: HTMLElement,
  sorted: Medication[],
  rulesByMedId: Map<string, ReminderRule[]>,
  signal?: AbortSignal,
): void {
  const title = el('h2', { class: 'inventory-sheet-title', text: '智能录入库存' });
  const hint = el('p', {
    class: 'inventory-sheet-hint',
    text: '拍药盒/票据让 AI 数药量。识别完会先让你核对再保存。',
  });
  const actions = el('div', { class: 'inventory-sheet-actions' });

  const cameraInput = el('input', { type: 'file', accept: 'image/*', hidden: true } as any) as HTMLInputElement;
  cameraInput.setAttribute('capture', 'environment');
  const albumInput = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true } as any) as HTMLInputElement;

  let sheet: BottomSheetHandle | undefined = openBottomSheet({ label: '智能录入库存', content: [title, hint, actions, cameraInput, albumInput] });

  const close = () => { sheet?.close(); sheet = undefined; };

  actions.append(createButton({
    label: '拍药盒/票据',
    icon: 'camera',
    onClick: () => { cameraInput.value = ''; cameraInput.click(); },
  }));
  actions.append(createButton({
    label: '从相册选图',
    variant: 'secondary',
    icon: 'image',
    onClick: () => { albumInput.value = ''; albumInput.click(); },
  }));

  actions.append(createButton({ label: '取消', variant: 'text', onClick: close }));

  const onImages = (files: File[]) => {
    if (files.length === 0) return;
    close();
    void runImageInventory(root, files, sorted, rulesByMedId, signal);
  };
  cameraInput.onchange = () => onImages(Array.from(cameraInput.files ?? []));
  albumInput.onchange = () => onImages(Array.from(albumInput.files ?? []));
}

async function runImageInventory(
  root: HTMLElement,
  files: File[],
  sorted: Medication[],
  rulesByMedId: Map<string, ReminderRule[]>,
  signal?: AbortSignal,
): Promise<void> {
  let busy: BottomSheetHandle | undefined;
  try {
    const status = el('p', { class: 'inventory-sheet-hint', text: `正在识别 ${files.length} 张图片里的药品…` });
    busy = openBottomSheet({ label: '识别库存中', content: [status] });
    const session = await createIdentifySession('inventory_batch', 'medicine-photo');
    const result = await recognizeMedicationImageBatch(
      files,
      async (file) => (await identifyInventoryBatchByBlob(file, undefined, { session, signal })).items,
      { signal },
    );
    if (signal?.aborted) return;
    busy.close();
    busy = undefined;
    const items = mergeInventoryEntryItems(result.items);
    if (items.length === 0) {
      toast(result.failures.length > 0 ? '这些图片都没能识别，请换清楚的图片重试' : '没认出药品和数量，换个角度试试');
      return;
    }
    openInventoryReviewSheet(root, items, sorted, rulesByMedId, signal, result.failures.length);
  } catch (error) {
    busy?.close();
    if (signal?.aborted) return;
    if (error instanceof IdentifyError) toast(error.message);
    else toast(error instanceof Error ? error.message : '没认出药量，换个角度或更清楚的图试试');
  }
}

type InventoryReviewTarget = string | 'new' | '';

interface InventoryReviewEntry {
  item: InventorySpeechItem;
  action: InventoryEntryAction;
  target: InventoryReviewTarget;
  selected: boolean;
  saved: boolean;
  error?: string;
}

function openInventoryReviewSheet(
  root: HTMLElement,
  items: readonly InventorySpeechItem[],
  sorted: Medication[],
  _rulesByMedId: Map<string, ReminderRule[]>,
  signal?: AbortSignal,
  failedImages = 0,
): void {
  const entries: InventoryReviewEntry[] = items.map((source) => ({
    item: { ...source, inventory: { ...source.inventory } },
    action: source.action,
    target: initialInventoryTarget(source.name, sorted),
    selected: true,
    saved: false,
  }));
  const title = el('h2', { class: 'inventory-sheet-title', text: `核对 ${entries.length} 条库存` });
  const hint = el('p', {
    class: 'inventory-sheet-hint',
    text: `逐条确认药品和处理方式后再保存。${failedImages > 0 ? `另有 ${failedImages} 张图片识别失败，成功结果已保留。` : ''}`,
  });
  const list = el('div', { class: 'inventory-review-list' });
  const summary = el('p', { class: 'inventory-review-summary', 'aria-live': 'polite' } as any);
  const actions = el('div', { class: 'inventory-review-actions' });
  let sheet: BottomSheetHandle | undefined;

  const render = () => {
    list.replaceChildren(...entries.map((entry, index) => renderInventoryReviewEntry(entry, index, sorted, render)));
    const selected = entries.filter((entry) => entry.selected && !entry.saved).length;
    const saved = entries.filter((entry) => entry.saved).length;
    summary.textContent = [selected ? `待处理 ${selected} 条` : '没有待处理条目', saved ? `已保存 ${saved} 条` : ''].filter(Boolean).join(' · ');
    saveButton.disabled = selected === 0;
  };

  const saveButton = createButton({
    label: '确认处理全部',
    icon: 'check',
    onClick: async () => {
      const pending = entries.filter((entry) => entry.selected && !entry.saved);
      if (pending.length === 0) return;
      const unresolved = pending.find((entry) => !entry.target);
      if (unresolved) {
        unresolved.error = '找到多个相近药名，请选择对应药品或作为新药添加';
        render();
        toast('还有药品需要确认匹配关系');
        return;
      }
      const invalid = pending.find((entry) => !Number.isFinite(entry.item.inventory.remaining)
        || entry.item.inventory.remaining < 0
        || (entry.action === 'add' && entry.item.inventory.remaining <= 0)
        || !entry.item.inventory.unit.trim());
      if (invalid) {
        invalid.error = invalid.action === 'add' ? '入库数量必须大于 0，并填写单位' : '库存数量不能小于 0，并填写单位';
        render();
        toast('请先修正数量或单位');
        return;
      }
      saveButton.disabled = true;
      const newEntries: InventoryReviewEntry[] = [];
      const existingEntries: { targetId: string; payload: InventoryReviewEntry }[] = [];
      for (const entry of pending) {
        entry.error = undefined;
        if (entry.target === 'new') {
          newEntries.push(entry);
        } else {
          existingEntries.push({ targetId: entry.target, payload: entry });
        }
      }
      const commitResults = await processInventoryReviewCommits(
        existingEntries,
        getMed,
        commitInventoryReviewEntry,
      );
      let failed = 0;
      for (const result of commitResults) {
        const entry = result.task.payload;
        if (result.status === 'saved') {
          entry.saved = true;
          entry.selected = false;
        } else {
          entry.error = result.error;
          failed += 1;
        }
      }
      if (signal?.aborted) return;
      if (failed > 0) {
        render();
        toast(`有 ${failed} 条未保存，请按提示修正后重试`);
        return;
      }
      if (newEntries.length > 0) {
        const drafts = newEntries.map(inventoryEntryToMedicationDraft);
        setPendingMedicationBatch(drafts);
        sheet?.close();
        toast(`已有库存已保存，继续核对 ${drafts.length} 种新药`);
        navigate('/meds/new');
        return;
      }
      sheet?.close();
      toast(`已处理 ${pending.length} 条库存`);
      await renderMedInventoryPage(root, signal);
    },
  });
  actions.append(saveButton, createButton({ label: '取消', variant: 'text', onClick: () => sheet?.close() }));
  render();
  sheet = openBottomSheet({
    label: '核对库存识别结果',
    className: 'inventory-review-sheet',
    content: [title, hint, list, summary, actions],
  });
}

function renderInventoryReviewEntry(
  entry: InventoryReviewEntry,
  index: number,
  meds: readonly Medication[],
  onChange: () => void,
): HTMLElement {
  const row = el('article', { class: `inventory-review-item${entry.error ? ' has-error' : ''}` });
  const head = el('div', { class: 'inventory-review-head' });
  const selected = el('input', {
    type: 'checkbox',
    checked: entry.selected,
    disabled: entry.saved,
    'aria-label': `处理第 ${index + 1} 条 ${entry.item.name}`,
  } as any) as HTMLInputElement;
  selected.onchange = () => { entry.selected = selected.checked; entry.error = undefined; onChange(); };
  head.append(
    selected,
    el('strong', { text: entry.item.name || `药品 ${index + 1}` }),
    el('span', { class: 'inventory-review-confidence', text: `${Math.round(entry.item.confidence * 100)}%` }),
  );

  const targetLabel = el('label', { class: 'inventory-review-field' });
  targetLabel.append(el('span', { text: '对应药品' }));
  const target = el('select', { disabled: entry.saved } as any) as HTMLSelectElement;
  if (!entry.target) target.append(el('option', { value: '', text: '请选择相近药品' }));
  for (const med of meds) {
    const option = el('option', { value: med.id, text: med.name }) as HTMLOptionElement;
    option.selected = entry.target === med.id;
    target.append(option);
  }
  const newOption = el('option', { value: 'new', text: '作为新药添加' }) as HTMLOptionElement;
  newOption.selected = entry.target === 'new';
  target.append(newOption);
  target.onchange = () => { entry.target = target.value as InventoryReviewTarget; entry.error = undefined; onChange(); };
  targetLabel.append(target);

  const amountRow = el('div', { class: 'inventory-review-amount' });
  const quantity = el('input', {
    type: 'number',
    min: '0',
    step: '0.1',
    inputMode: 'decimal',
    value: String(entry.item.inventory.remaining),
    disabled: entry.saved,
    'aria-label': `${entry.item.name}识别数量`,
  } as any) as HTMLInputElement;
  quantity.oninput = () => { entry.item.inventory.remaining = Number(quantity.value); entry.error = undefined; };
  const unit = el('input', {
    type: 'text',
    value: entry.item.inventory.unit,
    disabled: entry.saved,
    'aria-label': `${entry.item.name}库存单位`,
  } as any) as HTMLInputElement;
  unit.oninput = () => { entry.item.inventory.unit = unit.value; entry.error = undefined; };
  amountRow.append(quantity, unit);

  const mode = el('div', { class: 'inventory-review-mode', role: 'group', 'aria-label': `${entry.item.name}处理方式` } as any);
  for (const action of ['add', 'set'] as const) {
    const button = el('button', {
      type: 'button',
      class: entry.action === action ? 'is-selected' : '',
      text: action === 'add' ? '加到现有库存' : '设为当前剩余',
      disabled: entry.saved,
      'aria-pressed': String(entry.action === action),
    } as any) as HTMLButtonElement;
    button.onclick = () => { entry.action = action; entry.error = undefined; onChange(); };
    mode.append(button);
  }
  row.append(head, targetLabel, amountRow, mode);
  const source = entry.item.evidence?.rawText || entry.item.inventory.sourceNote;
  if (source) row.append(el('p', { class: 'inventory-review-evidence', text: `识别依据：${source}` }));
  if (entry.saved) row.append(el('p', { class: 'inventory-review-success', text: '已保存' }));
  if (entry.error) row.append(el('p', { class: 'inventory-review-error', text: entry.error }));
  return row;
}

function initialInventoryTarget(name: string, meds: readonly Medication[]): InventoryReviewTarget {
  const keyword = normalizeMedName(name);
  if (!keyword) return 'new';
  const exact = meds.filter((med) => normalizeMedName(med.name) === keyword);
  if (exact.length === 1) return exact[0]!.id;
  if (exact.length > 1) return '';
  const fuzzy = meds.filter((med) => {
    const candidate = normalizeMedName(med.name);
    return candidate.includes(keyword) || keyword.includes(candidate);
  });
  if (fuzzy.length === 1) return fuzzy[0]!.id;
  return fuzzy.length === 0 ? 'new' : '';
}

function normalizeMedName(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN').replace(/[\s\-_]/gu, '');
}

async function commitInventoryReviewEntry(med: Medication, entry: InventoryReviewEntry): Promise<Medication> {
  const identified = mergeInventory(med.inventory, entry.item.inventory);
  const { remaining, unit, ...valueMetadata } = identified;
  const {
    remaining: expectedRemaining,
    unit: expectedUnit,
    ...expectedMetadata
  } = med.inventory ?? { remaining: undefined, unit: undefined };
  const committed = await updateMedicationInventory(
    med.id,
    entry.action === 'add'
      ? {
          action: 'add',
          quantity: roundStock(entry.item.inventory.remaining),
          unit: entry.item.inventory.unit,
          metadata: { expected: expectedMetadata, value: valueMetadata },
        }
      : {
          action: 'set',
          remaining: roundStock(remaining),
          unit,
          expectedRemaining,
          expectedUnit,
          metadata: { expected: expectedMetadata, value: valueMetadata },
        },
    {
      source: 'ai',
      sourceNote: entry.action === 'add'
        ? `智能入库 +${formatQuantity(entry.item.inventory.remaining)}${entry.item.inventory.unit}`
        : `智能盘点为 ${formatQuantity(remaining)}${unit}`,
    },
  );
  return committed.med;
}

function inventoryEntryToMedicationDraft(entry: InventoryReviewEntry): PrescriptionItemDraft {
  return {
    name: entry.item.name,
    dosageText: '',
    amountPerDose: '',
    slots: [],
    mealRels: [],
    mealRelsBySlot: {},
    notes: entry.item.inventory.sourceNote ?? '',
    confidence: entry.item.confidence,
    inventory: { ...entry.item.inventory },
  };
}

/** 保留原库存的提醒/消耗信息，识别结果只覆盖明确识别到的库存详情。 */
function mergeInventory(current: MedicationInventory | undefined, identified: MedicationInventory): MedicationInventory {
  return {
    remaining: identified.remaining,
    unit: identified.unit || current?.unit || '片',
    packageQuantity: identified.packageQuantity ?? current?.packageQuantity,
    lowThreshold: identified.lowThreshold ?? current?.lowThreshold,
    sourceNote: identified.sourceNote ?? current?.sourceNote,
    lastReminderAt: current?.lastReminderAt,
    dailyConsumption: current?.dailyConsumption,
  };
}

async function openInventoryHistorySheet(root: HTMLElement, signal?: AbortSignal): Promise<void> {
  const logs = await listRecentInventoryOperations(3);
  let sheetHandle: BottomSheetHandle | undefined;

  const content = el('div', { class: 'inventory-history-sheet-content' });
  const title = el('h3', { text: '近三天历史操作记录', class: 'sheet-title' });
  const subtitle = el('p', { text: '显示近 3 天的所有库存变动与服药扣减，每项标注明确的操作来源。', class: 'sheet-subtitle' });

  content.append(title, subtitle);

  if (logs.length === 0) {
    content.append(emptyState('clock', '暂无操作历史', '近三天内没有发生任何库存调整或扣减记录。'));
  } else {
    const listEl = el('div', { class: 'inventory-history-list' });
    for (const logItem of logs) {
      const sourceLabel = INVENTORY_SOURCE_LABEL[logItem.source] || logItem.source;
      const deltaStr = logItem.delta > 0 ? `+${logItem.delta}` : `${logItem.delta}`;
      const timeStr = new Date(logItem.timestamp).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      const sourceBadge = el('span', {
        class: `inventory-source-badge source-${logItem.source}`,
        text: sourceLabel,
      });

      const itemEl = el('div', { class: 'inventory-history-item' }, [
        el('div', { class: 'history-item-header' }, [
          el('strong', { text: logItem.medName, class: 'history-med-name' }),
          sourceBadge,
        ]),
        el('div', { class: 'history-item-body' }, [
          el('span', { text: `变动: ${deltaStr}${logItem.unit} (现余: ${logItem.newRemaining}${logItem.unit})`, class: 'history-delta' }),
          el('span', { text: timeStr, class: 'history-time' }),
        ]),
        logItem.sourceNote ? el('div', { text: logItem.sourceNote, class: 'history-note' }) : null,
      ].filter(Boolean) as HTMLElement[]);

      if (logItem.canUndo) {
        const undoBtn = createButton({
          label: '撤回',
          variant: 'secondary',
          onClick: async () => {
            sheetHandle?.close();
            const res = await undoInventoryOperation(logItem.id);
            if (res.ok) {
              toast(res.message);
              await renderMedInventoryPage(root, signal);
            } else {
              toast(res.message);
            }
          },
        });
        undoBtn.classList.add('history-undo-btn');
        itemEl.append(undoBtn);
      }

      listEl.append(itemEl);
    }
    content.append(listEl);
  }

  sheetHandle = openBottomSheet({ label: '历史操作（近3天）', content: [content] });
}

async function openBatchDeductSheet(root: HTMLElement, meds: Medication[], rules: ReminderRule[], signal?: AbortSignal): Promise<void> {
  let days = 7;
  let sheetHandle: BottomSheetHandle | undefined;

  const content = el('div', { class: 'batch-deduct-sheet-content' });
  const title = el('h3', { text: '一次性预扣库存与变动对比', class: 'sheet-title' });
  const subtitle = el('p', { text: '在确认扣减前，查看本次预扣与当前库存的具体变动区别。', class: 'sheet-subtitle' });

  const daysRow = el('div', { class: 'days-select-row' });
  const daysOptions = [3, 7, 14, 30];
  const optionButtons: HTMLButtonElement[] = [];

  const previewContainer = el('div', { class: 'batch-preview-container' });

  function renderPreview() {
    previewContainer.replaceChildren();
    const preview = calculateBatchDeductionPreview(meds, rules, days);
    const summary = el('div', { class: 'preview-summary-badge', text: preview.summaryText });

    const diffList = el('div', { class: 'preview-diff-list' });
    for (const item of preview.items) {
      const diffItem = el('div', { class: `preview-diff-item ${item.willBeEmpty ? 'is-empty' : item.willBeLow ? 'is-low' : ''}` }, [
        el('div', { class: 'diff-med-header' }, [
          el('strong', { text: item.medName }),
          item.willBeEmpty
            ? el('span', { class: 'diff-tag tag-empty', text: '扣后用完' })
            : item.willBeLow
              ? el('span', { class: 'diff-tag tag-low', text: '扣后偏低' })
              : el('span', { class: 'diff-tag tag-ok', text: '库存充足' }),
        ]),
        el('div', { class: 'diff-values-grid' }, [
          el('div', {}, [el('span', { text: '当前剩余: ' }), el('strong', { text: `${item.currentStock}${item.unit}` })]),
          el('div', {}, [el('span', { text: '本次需扣: ' }), el('strong', { text: `-${item.deductQuantity}${item.unit}` })]),
          el('div', {}, [el('span', { text: '预计剩余: ' }), el('strong', { text: `${item.expectedRemaining}${item.unit}`, class: 'highlight-remaining' })]),
        ]),
      ]);
      diffList.append(diffItem);
    }
    previewContainer.append(summary, diffList);
  }

  for (const d of daysOptions) {
    const btn = createButton({
      label: `${d} 天${d === 7 ? ' (一周)' : ''}`,
      variant: d === days ? 'primary' : 'secondary',
      onClick: () => {
        days = d;
        for (const b of optionButtons) b.classList.remove('is-active');
        btn.classList.add('is-active');
        renderPreview();
      },
    });
    optionButtons.push(btn as HTMLButtonElement);
    daysRow.append(btn);
  }

  renderPreview();

  const confirmBtn = createButton({
    label: '确认扣减',
    variant: 'primary',
    onClick: async () => {
      sheetHandle?.close();
      const preview = calculateBatchDeductionPreview(meds, rules, days);
      const deductItems = preview.items
        .filter((i) => i.deductQuantity > 0)
        .map((i) => ({ medId: i.medId, quantity: i.deductQuantity }));

      if (deductItems.length === 0) {
        toast('没有需要扣减的药品');
        return;
      }

      const res = await batchDeductInventory(deductItems, 'batch', `手动一次性扣除 ${days} 天库存`);
      if (res.ok) {
        toast(`已完成 ${res.items.length} 种药品的批量扣减`);
        await renderMedInventoryPage(root, signal);
      }
    },
  });

  content.append(title, subtitle, daysRow, previewContainer, confirmBtn);
  sheetHandle = openBottomSheet({ label: '批量处理预扣', content: [content] });
}
