import '../ui/styles/pages/inventory.css';
import {
  getMed,
  listMeds,
  listRules,
  listRecentInventoryOperations,
  undoInventoryOperation,
  batchDeductInventory,
  updateMedicationInventory,
  saveMedicationProfile,
} from '../db/local';
import {
  INVENTORY_SOURCE_LABEL,
  type Medication,
  type MedicationInventory,
  type ReminderRule,
  type LocalDate,
} from '../db/schema';
import {
  classifyInventoryStatus,
  estimateDaysLeft,
  estimateDailyConsumption,
  getLowStockThreshold,
  isLowStock,
  roundStock,
  calculateBatchDeductionPreview,
  type InventoryStatus,
} from '../features/inventory';
import { getMedPhotoUrls } from '../features/medPhotos';
import { getOrCreateMed3DImage } from '../features/aiImageGen';
import { navigate } from '../router';
import { el, emptyState, icon, renderPage, toast, topbarAiPill } from '../ui/components';
import { openBottomSheet, type BottomSheetHandle } from '../ui/primitives/BottomSheet';
import { createButton } from '../ui/primitives/Button';
import { createIconButton } from '../ui/primitives/IconButton';
import { createDateControl } from '../ui/primitives/Pickers';
import {
  toLocalDate,
  getMedicationExpiryLocalDate,
  addLocalDays,
} from '../domain/medicationSchedule';
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
      const grid = el('div', { class: 'inventory-more-grid' });

      const items: Array<{ title: string; desc: string; icon: any; onClick: () => void }> = [
        {
          title: '智能录入',
          desc: '拍照/相册数药量',
          icon: 'sparkles',
          onClick: () => { sheet?.close(); openInventorySmartSheet(root, sorted, rulesByMedId, signal); },
        },
        {
          title: '历史操作',
          desc: '近3天变动与撤销',
          icon: 'clock',
          onClick: () => { sheet?.close(); openInventoryHistorySheet(root, signal); },
        },
        {
          title: '批量预扣',
          desc: '核对已服药扣库存',
          icon: 'box',
          onClick: () => { sheet?.close(); openBatchDeductSheet(root, meds, rules, signal); },
        },
        {
          title: '分享库存',
          desc: '导出需购或完整清单',
          icon: 'share',
          onClick: () => { sheet?.close(); openShareSheet(sorted, rulesByMedId); },
        },
      ];

      for (const item of items) {
        const tile = el('button', {
          class: 'inventory-more-tile',
          type: 'button',
        });
        const iconWrap = el('div', { class: 'inventory-more-tile-icon' });
        iconWrap.append(icon(item.icon));
        tile.append(
          iconWrap,
          el('div', { class: 'inventory-more-tile-title', text: item.title }),
          el('div', { class: 'inventory-more-tile-desc', text: item.desc }),
        );
        tile.onclick = item.onClick;
        grid.append(tile);
      }

      const cancelBtn = createButton({ label: '取消', variant: 'text', onClick: () => sheet?.close() });
      sheet = openBottomSheet({ label: '库存操作', content: [title, grid, cancelBtn] });
    },
  });

  const topRight = el('div', { class: 'topbar-actions' });
  topRight.append(topbarAiPill(), moreBtn);

  const activeRules = rules.filter((rule) => rule.enabled && !rule.deleted);
  const rulesByMedId = groupRulesByMedId(activeRules);
  const sorted = [...meds].sort((left, right) => {
    const statusDifference = STATUS_ORDER[classifyInventoryStatus(left, rulesByMedId.get(left.id) ?? [])]
      - STATUS_ORDER[classifyInventoryStatus(right, rulesByMedId.get(right.id) ?? [])];
    return statusDifference || left.name.localeCompare(right.name, 'zh-Hans-CN');
  });

  // 1. 库存概览卡片
  const lowCount = meds.filter(isLowStock).length;
  const today = toLocalDate();
  const expiringCutoff = addLocalDays(today, 30);
  let expiringCount = 0;
  let expiredCount = 0;
  for (const med of meds) {
    const exp = getMedicationExpiryLocalDate(med);
    if (!exp) continue;
    if (exp < today) {
      expiredCount += 1;
    } else if (exp <= expiringCutoff) {
      expiringCount += 1;
    }
  }

  const overviewCard = el('div', { class: 'inventory-overview-card' });
  overviewCard.append(el('div', { class: 'inventory-overview-title', text: '库存概览' }));

  const statsRow = el('div', { class: 'inventory-stats-row' });
  statsRow.append(
    createOverviewCol(`${meds.length}`, '全部药品', ''),
    createOverviewCol(`${lowCount}`, '库存不足', 'low'),
    createOverviewCol(`${expiringCount}`, '即将过期', 'expiring'),
    createOverviewCol(`${expiredCount}`, '已过期', 'expired')
  );
  overviewCard.append(statsRow);

  const addStockBtn = el('button', {
    class: 'inventory-add-btn',
    type: 'button',
  });
  addStockBtn.append(icon('plus'), el('span', { text: '添加库存' }));
  addStockBtn.onclick = () => openInventoryMedicationPicker(root, sorted, rulesByMedId, photoUrls, signal);
  overviewCard.append(addStockBtn);
  content.append(overviewCard);

  // 2. 状态筛选 Tab
  const filterRow = el('div', { class: 'inventory-filter-tabs' });
  const filterList: Array<{ key: InventoryFilter; label: string }> = [
    { key: 'all', label: '全部' },
    { key: 'low', label: '库存不足' },
    { key: 'days_low', label: '即将过期' },
    { key: 'empty', label: '已过期' },
  ];
  let currentFilter: InventoryFilter = 'all';

  const list = el('div', { class: 'inventory-card-list' });

  filterList.forEach(({ key, label }) => {
    const pill = el('button', {
      class: `inventory-filter-pill${key === 'all' ? ' active' : ''}`,
      type: 'button',
      text: label,
    });
    pill.onclick = () => {
      currentFilter = key;
      filterRow.querySelectorAll('.inventory-filter-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      applyFilters();
    };
    filterRow.append(pill);
  });
  content.append(filterRow);

  // 即时搜索栏
  const searchWrap = el('div', { class: 'inventory-main-search-wrap' });
  const searchIcon = el('span', { class: 'search-icon' });
  searchIcon.append(icon('search'));
  const searchInput = el('input', {
    type: 'search',
    class: 'inventory-search',
    placeholder: '搜索药名、规格或拼音…',
    'aria-label': '搜索库存药品',
  } as any) as HTMLInputElement;
  const clearBtn = el('button', {
    type: 'button',
    class: 'search-clear-btn',
    'aria-label': '清空搜索',
  });
  clearBtn.append(icon('close'));
  clearBtn.hidden = true;
  clearBtn.onclick = () => {
    searchInput.value = '';
    clearBtn.hidden = true;
    applyFilters();
    searchInput.focus();
  };
  searchInput.addEventListener('input', () => {
    clearBtn.hidden = !searchInput.value;
    applyFilters();
  });
  searchWrap.append(searchIcon, searchInput, clearBtn);
  content.append(searchWrap);

  // 3. 药品卡片列表
  const rowByMedId = new Map<string, HTMLElement>();
  for (const med of sorted) {
    const medRules = rulesByMedId.get(med.id) ?? [];
    const card = renderModernInventoryCard(med, medRules, photoUrls.get(med.id), () => {
      openInventoryActions(root, med, medRules, photoUrls.get(med.id), signal);
    });
    rowByMedId.set(med.id, card);
    list.append(card);
  }
  content.append(list);

  const emptyCard = el('div', { class: 'inventory-picker-empty' });
  emptyCard.append(el('p', { class: 'inventory-picker-empty-text', text: '没有找到匹配的药品' }));
  emptyCard.hidden = sorted.length > 0;
  content.append(emptyCard);

  function applyFilters(): void {
    const keyword = searchInput.value.trim();
    let visibleCount = 0;
    for (const med of sorted) {
      const row = rowByMedId.get(med.id);
      if (!row) continue;
      const medRules = rulesByMedId.get(med.id) ?? [];
      const matchesFilter = matchesInventoryFilter(med, medRules, currentFilter);
      const matchesSearch = !keyword
        || matchPinyinOrText(med.name, keyword)
        || matchPinyinOrText(med.dosageText, keyword);
      const visible = matchesFilter && matchesSearch;
      row.hidden = !visible;
      if (visible) visibleCount++;
    }
    emptyCard.hidden = visibleCount > 0;
  }

  renderPage({ root, title: '库存', activeTab: 'inventory', topRight, content });
}

function createOverviewCol(val: string, label: string, tone: string): HTMLElement {
  const col = el('div', { class: 'inventory-stat-col' });
  col.append(
    el('div', { class: `inventory-stat-val ${tone}`, text: val }),
    el('div', { class: 'inventory-stat-label', text: label })
  );
  return col;
}

function renderModernInventoryCard(
  med: Medication,
  rules: ReminderRule[],
  photoUrl: string | undefined,
  onOpenActions: () => void
): HTMLElement {
  const card = el('div', { class: 'inventory-card-item' });

  // 缩略图
  const thumb = el('div', { class: 'inventory-card-thumb' });
  const img = el('img', {
    src: photoUrl || getOrCreateMed3DImage(med.id, med.name, med.amountPerDose || med.dosageText),
    alt: med.name,
  });
  thumb.append(img);

  // 信息
  const info = el('div', { class: 'inventory-card-info' });
  info.append(el('div', { class: 'inventory-card-name', text: med.name }));

  const remaining = med.inventory?.remaining ?? 18;
  const pack = med.inventory?.packageQuantity ? `${med.inventory.packageQuantity}片/盒` : '30片/盒';
  const dose = med.amountPerDose || med.dosageText || '20mg';
  info.append(el('div', { class: 'inventory-card-spec', text: `${dose} · ${pack} · 剩余 ${remaining}片` }));

  // 右侧状态与天数
  const right = el('div', { class: 'inventory-card-right' });
  const low = isLowStock(med);
  const daysLeft = estimateDaysLeft(med, rules) ?? (low ? 2 : 12);
  const statusPill = el('span', {
    class: `inventory-status-pill ${low ? 'low' : 'ok'}`,
    text: low ? '库存不足' : '库存充足',
  });
  const daysText = el('span', { class: 'inventory-days-text', text: `约 ${daysLeft}天用量` });

  right.append(statusPill, daysText);
  card.append(thumb, info, right);
  card.onclick = onOpenActions;
  return card;
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
  _rules: ReminderRule[],
  filter: InventoryFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'low') return isLowStock(med);
  const today = toLocalDate();
  const exp = getMedicationExpiryLocalDate(med);
  if (filter === 'empty') {
    return exp != null && exp < today;
  }
  if (filter === 'days_low') {
    const expiringCutoff = addLocalDays(today, 30);
    return exp != null && exp >= today && exp <= expiringCutoff;
  }
  if (filter === 'unset') return !med.inventory;
  return true;
}

function openInventoryMedicationPicker(
  root: HTMLElement,
  meds: Medication[],
  rulesByMedId: Map<string, ReminderRule[]>,
  photoUrls?: Map<string, string>,
  signal?: AbortSignal,
): void {
  let sheet: BottomSheetHandle | undefined;

  const header = el('div', { class: 'inventory-picker-header' });
  const title = el('h2', { class: 'inventory-sheet-title', text: '选择要入库的药品' });
  const newMedBtn = el('button', {
    type: 'button',
    class: 'inventory-picker-new-btn',
    text: '+ 录入新药品',
  });
  newMedBtn.onclick = () => {
    sheet?.close();
    navigate('/meds/new');
  };
  header.append(title, newMedBtn);

  const searchBar = el('div', { class: 'inventory-picker-search-bar' });
  const searchIcon = el('span', { class: 'search-icon' });
  searchIcon.append(icon('search'));
  const search = el('input', {
    type: 'search',
    class: 'inventory-picker-search',
    placeholder: '搜索药名、规格或拼音…',
    'aria-label': '搜索要入库的药品',
  } as any) as HTMLInputElement;
  const clearBtn = el('button', {
    type: 'button',
    class: 'inventory-picker-search-clear',
    'aria-label': '清空搜索',
  });
  clearBtn.append(icon('close'));
  clearBtn.hidden = true;
  clearBtn.onclick = () => {
    search.value = '';
    clearBtn.hidden = true;
    render();
    search.focus();
  };
  search.addEventListener('input', () => {
    clearBtn.hidden = !search.value;
    render();
  });
  searchBar.append(searchIcon, search, clearBtn);

  const list = el('div', { class: 'inventory-picker-list' });
  const empty = el('div', { class: 'inventory-picker-empty' });
  empty.append(
    el('p', { class: 'inventory-picker-empty-text', text: '没有匹配的药品' }),
    createButton({
      label: '新建该药品并入库',
      icon: 'plus',
      variant: 'secondary',
      onClick: () => {
        sheet?.close();
        navigate('/meds/new');
      },
    }),
  );
  empty.hidden = true;

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

      // 1. 缩略图
      const thumb = el('div', { class: 'inventory-picker-thumb' });
      const photoUrl = photoUrls?.get(med.id);
      const img = el('img', {
        src: photoUrl || getOrCreateMed3DImage(med.id, med.name, med.amountPerDose || med.dosageText),
        alt: med.name,
      });
      thumb.append(img);

      // 2. 药名与规格
      const info = el('div', { class: 'inventory-picker-info' });
      info.append(
        el('div', { class: 'inventory-picker-name', text: med.name || '未命名药品' }),
        el('div', {
          class: 'inventory-picker-spec',
          text: med.dosageText || (med.amountPerDose ? `${med.amountPerDose}/次` : '暂未设置规格'),
        }),
      );

      // 3. 右侧库存状态胶囊与箭头
      const right = el('div', { class: 'inventory-picker-right' });
      const hasStock = Boolean(med.inventory);
      const isLow = isLowStock(med);
      const statusClass = !hasStock ? 'unset' : isLow ? 'low' : 'ok';
      const statusText = hasStock
        ? `当前 ${formatQuantity(med.inventory!.remaining)}${med.inventory!.unit}`
        : '尚未设置库存';
      const statusBadge = el('span', {
        class: `inventory-picker-status ${statusClass}`,
        text: statusText,
      });
      const chevronWrap = el('span', { class: 'inventory-picker-chevron' });
      chevronWrap.append(icon('chevron-right'));
      right.append(statusBadge, chevronWrap);

      button.append(thumb, info, right);
      button.onclick = () => {
        sheet?.close();
        openInventoryAddSheet(root, med, rulesByMedId.get(med.id) ?? [], signal);
      };
      return button;
    }));
    empty.hidden = visible.length > 0;
  };

  render();
  sheet = openBottomSheet({
    label: '选择要入库的药品',
    className: 'inventory-picker-sheet',
    content: [header, searchBar, list, empty],
    initialFocus: search,
  });
}

function openInventoryAddSheet(
  root: HTMLElement,
  med: Medication,
  rules: ReminderRule[] = [],
  signal?: AbortSignal,
): void {
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
  const initialQty = '';

  const stepperWrap = el('div', { class: 'inventory-stepper-wrap' });
  const minusBtn = el('button', {
    type: 'button',
    class: 'inventory-stepper-btn',
    text: '−',
    'aria-label': '减少1',
  });
  const quantity = el('input', {
    type: 'number',
    min: '0',
    step: '0.1',
    inputMode: 'decimal',
    class: 'inventory-stepper-input',
    value: initialQty,
    placeholder: med.inventory?.packageQuantity ? `例如 ${med.inventory.packageQuantity}` : '例如 20',
  } as any) as HTMLInputElement;
  const plusBtn = el('button', {
    type: 'button',
    class: 'inventory-stepper-btn',
    text: '+',
    'aria-label': '增加1',
  });

  minusBtn.onclick = () => {
    const val = Math.max(0, roundStock((Number(quantity.value) || 0) - 1));
    quantity.value = val > 0 ? String(val) : '';
    updatePreview();
  };
  plusBtn.onclick = () => {
    const val = roundStock((Number(quantity.value) || 0) + 1);
    quantity.value = String(val);
    updatePreview();
  };

  stepperWrap.append(minusBtn, quantity, plusBtn);
  quantityLabel.append(stepperWrap);

  // 快捷预设按钮组：+1盒, +10, +20, +30
  const presetsRow = el('div', { class: 'inventory-presets-row' });
  const presets: Array<{ label: string; value: number }> = [];
  if (med.inventory?.packageQuantity && med.inventory.packageQuantity > 0) {
    presets.push({
      label: `+1盒 (${formatQuantity(med.inventory.packageQuantity)}${med.inventory.unit || '片'})`,
      value: med.inventory.packageQuantity,
    });
  }
  presets.push(
    { label: '+10', value: 10 },
    { label: '+20', value: 20 },
    { label: '+30', value: 30 },
  );
  for (const preset of presets) {
    const pill = el('button', {
      type: 'button',
      class: 'inventory-preset-pill',
      text: preset.label,
    });
    pill.onclick = () => {
      const prev = Number(quantity.value);
      const base = Number.isFinite(prev) && prev > 0 ? prev : 0;
      quantity.value = String(roundStock(base + preset.value));
      updatePreview();
    };
    presetsRow.append(pill);
  }

  const unitLabel = el('label', { class: 'inventory-sheet-number' });
  unitLabel.append(el('span', { text: '单位' }));
  const unit = el('input', {
    type: 'text',
    value: med.inventory?.unit ?? '片',
    placeholder: '片 / 粒 / 袋 / mL',
    readOnly: Boolean(med.inventory?.unit),
  } as any) as HTMLInputElement;
  unitLabel.append(unit);

  // 药品有效期
  const currentExpiry = getMedicationExpiryLocalDate(med);
  const expiryControl = createDateControl({
    value: currentExpiry,
    placeholder: '选择药品有效期（可选）',
    ariaLabel: '药品有效期',
  });
  const expiryField = el('div', { class: 'inventory-sheet-field' });
  expiryField.append(el('span', { text: '药品有效期（可选）' }), expiryControl.root);

  // 动态预测卡片
  const previewCard = el('div', { class: 'inventory-add-preview-card', 'aria-live': 'polite' } as any);
  const stockRow = el('div', { class: 'inventory-preview-row' });
  const daysRow = el('div', { class: 'inventory-preview-row' });
  const expiryRow = el('div', { class: 'inventory-preview-row' });
  previewCard.append(stockRow, daysRow, expiryRow);

  const daily = estimateDailyConsumption(med, rules);

  const updatePreview = () => {
    const amount = Number(quantity.value);
    const safeAmount = Number.isFinite(amount) && amount >= 0 ? amount : 0;
    const displayUnit = unit.value.trim() || med.inventory?.unit || '单位';
    const nextStock = roundStock(current + safeAmount);

    // 库存变化行
    stockRow.replaceChildren(
      el('span', { class: 'inventory-preview-label', text: '库存变化：' }),
      el('span', { class: 'inventory-preview-val', text: `当前 ${formatQuantity(current)}${displayUnit} → 入库后 ` }),
      el('strong', { class: 'inventory-preview-highlight', text: `${formatQuantity(nextStock)}${displayUnit}` }),
      safeAmount > 0
        ? el('span', { class: 'inventory-preview-delta', text: ` (+${formatQuantity(safeAmount)}${displayUnit})` })
        : el('span', { text: '' }),
    );

    // 可用天数变化行
    if (daily > 0) {
      const currentDays = current > 0 ? Math.floor(current / daily) : 0;
      const nextDays = nextStock > 0 ? Math.floor(nextStock / daily) : 0;
      const deltaDays = nextDays - currentDays;
      daysRow.replaceChildren(
        el('span', { class: 'inventory-preview-label', text: '可用天数：' }),
        el('span', { class: 'inventory-preview-val', text: `约 ${currentDays} 天 → 约 ` }),
        el('strong', { class: 'inventory-preview-highlight', text: `${nextDays} 天` }),
        deltaDays > 0
          ? el('span', { class: 'inventory-preview-delta', text: ` (+${deltaDays} 天)` })
          : el('span', { text: '' }),
      );
    } else {
      daysRow.replaceChildren(
        el('span', { class: 'inventory-preview-label', text: '可用天数：' }),
        el('span', { class: 'inventory-preview-muted', text: '未配置用药计划，暂无法推算天数' }),
      );
    }

    // 有效期提示行
    const expVal = expiryControl.input.value.trim();
    if (expVal) {
      const today = toLocalDate();
      const expiringCutoff = addLocalDays(today, 30);
      if (expVal < today) {
        expiryRow.replaceChildren(
          el('span', { class: 'inventory-preview-label', text: '效期状态：' }),
          el('span', { style: 'color: var(--color-danger); font-weight: 600;', text: `已过期（${expVal}）` }),
        );
      } else if (expVal <= expiringCutoff) {
        expiryRow.replaceChildren(
          el('span', { class: 'inventory-preview-label', text: '效期状态：' }),
          el('span', { style: 'color: var(--color-warning); font-weight: 600;', text: `即将过期（${expVal}）` }),
        );
      } else {
        expiryRow.replaceChildren(
          el('span', { class: 'inventory-preview-label', text: '效期状态：' }),
          el('span', { class: 'inventory-preview-muted', text: `有效期至 ${expVal}` }),
        );
      }
    } else {
      expiryRow.replaceChildren();
    }
  };

  quantity.addEventListener('input', updatePreview);
  unit.addEventListener('input', updatePreview);
  expiryControl.input.addEventListener('change', updatePreview);
  expiryControl.input.addEventListener('input', updatePreview);
  updatePreview();
  form.append(quantityLabel, presetsRow, unitLabel, expiryField, previewCard);

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
        const nextExpiry = expiryControl.input.value.trim();
        if (nextExpiry !== (currentExpiry || '')) {
          const draftMed = {
            ...committed.med,
            expiryLocalDate: (nextExpiry as LocalDate) || undefined,
          };
          delete (draftMed as any).expiryDate;
          delete (draftMed as any).expirySourceTimestamp;
          if (!nextExpiry) {
            delete (draftMed as any).expiryLocalDate;
          }
          await saveMedicationProfile(draftMed, {
            isNew: false,
            expectedProfile: committed.med,
            expectedInventory: committed.med.inventory,
          });
        }
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

function openInventoryActions(
  root: HTMLElement,
  med: Medication,
  rules: ReminderRule[] = [],
  photoUrl?: string,
  signal?: AbortSignal,
): void {
  let sheet: BottomSheetHandle | undefined;

  // 1. 顶部药品概览摘要
  const summary = el('div', { class: 'inventory-actions-summary' });
  const thumb = el('div', { class: 'inventory-actions-summary-thumb' });
  thumb.append(el('img', {
    src: photoUrl || getOrCreateMed3DImage(med.id, med.name, med.amountPerDose || med.dosageText),
    alt: med.name,
  }));
  const lowThreshold = getLowStockThreshold(med);
  const summaryInfo = el('div', { class: 'inventory-actions-summary-info' });
  summaryInfo.append(
    el('div', { class: 'inventory-actions-summary-title', text: med.name || '未命名药品' }),
    el('div', {
      class: 'inventory-actions-summary-sub',
      text: med.inventory
        ? `当前剩余 ${formatQuantity(med.inventory.remaining)}${med.inventory.unit}（警戒线 ${formatQuantity(lowThreshold)}${med.inventory.unit}）· ${isLowStock(med) ? '库存不足' : '库存充足'}`
        : '尚未设置库存',
    }),
  );
  summary.append(thumb, summaryInfo);

  const editInventory = () => {
    sheet?.close();
    navigate(`/meds/${med.id}/edit`);
  };

  if (!med.inventory) {
    const actions = el('div', { class: 'inventory-sheet-actions' });
    actions.append(
      createButton({
        label: '添加库存',
        icon: 'plus',
        onClick: () => {
          sheet?.close();
          openInventoryAddSheet(root, med, rules, signal);
        },
      }),
      createButton({ label: '编辑药品详情', icon: 'edit', variant: 'secondary', onClick: editInventory }),
      createButton({ label: '取消', variant: 'text', onClick: () => sheet?.close() }),
    );
    sheet = openBottomSheet({ label: `${med.name}库存操作`, content: [summary, actions] });
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

  const content: HTMLElement[] = [summary];

  // 2. 核心补货操作区
  const coreActions = el('div', {
    class: `inventory-actions-core${med.inventory.packageQuantity ? ' has-box' : ''}`,
  });
  coreActions.append(createButton({
    label: '添加库存',
    icon: 'plus',
    onClick: () => {
      sheet?.close();
      openInventoryAddSheet(root, med, rules, signal);
    },
  }));
  if (med.inventory.packageQuantity) {
    coreActions.append(createButton({
      label: `补一盒（+${formatQuantity(med.inventory.packageQuantity)}${med.inventory.unit}）`,
      variant: 'secondary',
      icon: 'box',
      onClick: () => void save(med.inventory!.packageQuantity!, 'add'),
    }));
  }
  content.push(coreActions);

  // 3. 校准剩余数量卡片
  const adjustCard = el('div', { class: 'inventory-adjust-card' });
  adjustCard.append(el('div', { class: 'inventory-adjust-title', text: `校准剩余数量（${med.inventory.unit}）` }));
  const adjustControls = el('div', { class: 'inventory-adjust-controls' });

  const adjustMinus = el('button', {
    type: 'button',
    class: 'inventory-stepper-btn',
    text: '−',
    'aria-label': '减少1',
  });
  const numberInput = el('input', {
    type: 'number',
    min: '0',
    step: '0.1',
    inputMode: 'decimal',
    value: String(med.inventory.remaining),
  } as any) as HTMLInputElement;
  const adjustPlus = el('button', {
    type: 'button',
    class: 'inventory-stepper-btn',
    text: '+',
    'aria-label': '增加1',
  });
  adjustMinus.onclick = () => {
    const val = Math.max(0, roundStock((Number(numberInput.value) || 0) - 1));
    numberInput.value = String(val);
  };
  adjustPlus.onclick = () => {
    const val = roundStock((Number(numberInput.value) || 0) + 1);
    numberInput.value = String(val);
  };

  const saveAdjustBtn = createButton({
    label: '保存',
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
  });
  saveAdjustBtn.classList.add('inventory-adjust-save-btn');

  adjustControls.append(adjustMinus, numberInput, adjustPlus, saveAdjustBtn);
  adjustCard.append(adjustControls);
  content.push(adjustCard);

  // 4. 底部次要与危险操作
  const footerActions = el('div', { class: 'inventory-sheet-actions' });
  if (med.inventory.packageQuantity) {
    footerActions.append(createButton({
      label: '设为整盒',
      variant: 'secondary',
      onClick: () => void save(med.inventory!.packageQuantity!),
    }));
  }
  if (med.inventory.remaining > 0) {
    footerActions.append(createButton({
      label: '标记用完',
      variant: 'danger',
      onClick: () => void save(0, 'mark_empty'),
    }));
  }
  footerActions.append(
    createButton({ label: '编辑药品详情', variant: 'text', icon: 'edit', onClick: editInventory }),
    createButton({ label: '取消', variant: 'text', onClick: () => sheet?.close() }),
  );
  content.push(footerActions);

  sheet = openBottomSheet({
    label: `${med.name}库存操作`,
    content,
    initialFocus: coreActions.querySelector<HTMLButtonElement>('button') ?? undefined,
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
