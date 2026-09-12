import '../ui/styles/pages/medications.css';
import {
  listMeds,
  listRules,
  putRule,
  softDeleteMed,
  getDatabaseRevision,
} from '../db/local';
import {
  el,
  renderPage,
  icon,
  toast,
  banner,
  confirmDialog,
  topbarAiPill,
  topbarPill,
  SLOT_ICON,
} from '../ui/components';
import {
  SLOTS,
  SLOT_LABEL,
  SLOT_DEFAULT_TIME,
  type ReminderRule,
  type Slot,
} from '../db/schema';
import { createButton } from '../ui/primitives/Button';
import { rescheduleMedicationReminders } from '../features/reminderScheduler';
import { navigate } from '../router';
import { isLowStock } from '../features/inventory';
import { getMedPhotoUrls } from '../features/medPhotos';
import { getOrCreateMed3DImage } from '../features/aiImageGen';
import {
  purpleBottleImg,
  clockPillImg,
  aidBagImg,
  medBottle3dImg,
  medRecentMortarImg,
  medAidKit3dImg,
  getMedBottle3dSvg,
  getClockPill3dSvg,
  getAidBag3dSvg,
  render3dMedia,
} from '../ui/assets3d';
import { matchPinyinOrText } from '../utils/pinyin';
import { openBottomSheet } from '../ui/primitives/BottomSheet';
import { createActionDock } from '../ui/primitives/ActionDock';

let activeCategory: 'all' | 'rx' | 'health' | 'external' = 'all';
let searchQuery = '';

export async function renderMedListPage(root: HTMLElement, signal?: AbortSignal): Promise<() => void> {
  let meds = await listMeds();
  if (signal?.aborted) return () => undefined;
  let photoUrls = await getMedPhotoUrls(meds.map((m) => m.id));
  if (signal?.aborted) return () => undefined;
  let lastRevision = getDatabaseRevision();

  const content = el('div', { class: 'page medication-list-page' });

  // 1. 顶部 3 个 3D 指标卡片
  const statGrid = el('div', { class: 'med-stat-grid' });
  function updateStatCards() {
    const totalCount = meds.length;
    const activeCount = meds.filter((m) => m.slots.length > 0).length || totalCount;
    const lowStockCount = meds.filter((m) => isLowStock(m)).length;
    statGrid.replaceChildren(
      createStatCard('blue', '全部药品', `${totalCount} 种`, medBottle3dImg || purpleBottleImg, getMedBottle3dSvg),
      createStatCard('green', '近期使用', `${activeCount} 种`, medRecentMortarImg || clockPillImg, getClockPill3dSvg),
      createStatCard('pink', '需补充', `${lowStockCount} 种`, medAidKit3dImg || aidBagImg, getAidBag3dSvg),
    );
  }
  updateStatCards();
  content.append(statGrid);

  // 2. 搜索框与漏斗
  const searchRow = el('div', { class: 'med-search-row' });
  const inputWrap = el('div', { class: 'med-search-input-wrap' });
  const searchIcon = el('div', { class: 'med-search-icon' });
  searchIcon.append(icon('search'));

  const input = el('input', {
    class: 'med-search-input',
    type: 'search',
    placeholder: '搜索药品名称、规格或备注',
    value: searchQuery,
  }) as HTMLInputElement;

  input.oninput = () => {
    searchQuery = input.value.trim();
    renderFilteredCards();
  };

  inputWrap.append(searchIcon, input);

  const filterBtn = el('button', {
    class: 'med-filter-btn',
    type: 'button',
    'aria-label': '筛选',
  } as any);
  filterBtn.append(icon('filter'));
  filterBtn.onclick = () => {
    toast('已按分类与库存状态过滤');
  };

  searchRow.append(inputWrap, filterBtn);
  content.append(searchRow);

  // 3. 类别 Tab
  const categoryTabs = el('div', { class: 'med-category-tabs' });
  const categories: Array<{ key: typeof activeCategory; label: string }> = [
    { key: 'all', label: '全部' },
    { key: 'rx', label: '处方药' },
    { key: 'health', label: '保健品' },
    { key: 'external', label: '外用药' },
  ];

  categories.forEach((cat) => {
    const pill = el('button', {
      class: `med-category-pill${activeCategory === cat.key ? ' active' : ''}`,
      type: 'button',
      text: cat.label,
    });
    pill.onclick = () => {
      activeCategory = cat.key;
      categoryTabs.querySelectorAll('.med-category-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      renderFilteredCards();
    };
    categoryTabs.append(pill);
  });
  content.append(categoryTabs);

  // 4. 药品列表容器
  const listContainer = el('div', { class: 'med-card-list' });
  content.append(listContainer);

  function renderFilteredCards() {
    listContainer.replaceChildren();

    let filtered = meds;
    if (searchQuery) {
      filtered = filtered.filter((m) =>
        matchPinyinOrText(searchQuery, m.name) ||
        (m.dosageText && matchPinyinOrText(searchQuery, m.dosageText))
      );
    }

    if (activeCategory === 'rx') {
      filtered = filtered.filter((m) => !m.name.includes('维生素') && !m.name.includes('钙'));
    } else if (activeCategory === 'health') {
      filtered = filtered.filter((m) => m.name.includes('维生素') || m.name.includes('钙') || m.name.includes('油'));
    } else if (activeCategory === 'external') {
      filtered = filtered.filter((m) => m.name.includes('膏') || m.name.includes('水') || m.name.includes('贴'));
    }

    if (filtered.length === 0) {
      listContainer.append(banner('info', '未找到匹配的药品'));
      return;
    }

    for (const m of filtered) {
      const med = m;
      const medNameId = `med-name-${med.id}`;
      const card = el('div', {
        class: 'med-item-card medication-list-row medication-batch-row',
        'aria-selected': 'false',
        'aria-labelledby': medNameId,
      } as any);

      // 缩略图
      const thumb = el('div', { class: 'med-item-thumb' });
      const img = el('img', {
        src: photoUrls.get(med.id) || getOrCreateMed3DImage(med.id, med.name, med.amountPerDose || med.dosageText),
        alt: med.name,
      });
      thumb.append(img);

      // 信息
      const info = el('div', { class: 'med-item-info' });
      info.append(el('div', { id: medNameId, class: 'med-item-name medication-batch-name', text: m.name || '未命名' }));

      const dose = med.amountPerDose || med.dosageText || '1片';
      const spec = med.dosageText && med.amountPerDose ? `${med.dosageText} · ${med.amountPerDose}` : dose;
      const freqText = med.slots.length > 0 ? `每日${med.slots.length}次` : '按需服用';
      info.append(el('div', { class: 'med-item-spec', text: `${spec} · ${freqText}` }));

      const badges = el('div', { class: 'med-item-badges' });
      const stock = med.inventory?.remaining ?? 36;
      const low = isLowStock(med);
      const unit = med.doseUnit || '片';
      const stockPill = el('span', {
        class: `med-stock-pill ${low ? 'low' : 'ok'}`,
        text: low ? `库存不足 剩余${stock}${unit}` : `库存充足 剩余${stock}${unit}`,
      });
      badges.append(stockPill);
      info.append(badges);

      // 右侧引导箭头
      const chevron = el('div', { class: 'med-item-chevron' });
      chevron.append(icon('chevron-right'));

      card.onclick = () => navigate(`/meds/${med.id}/edit`);
      card.append(thumb, info, chevron);
      listContainer.append(card);
    }
  }

  renderFilteredCards();

  // 5. 底部右下角悬浮 "+ 添加药品" 按钮（通过 actionDock 稳定挂载）
  const fabAdd = el('button', {
    class: 'med-fab-add',
    type: 'button',
    'aria-label': '添加药品',
  } as any);
  fabAdd.append(icon('plus'), el('span', { text: '添加药品' }));
  fabAdd.onclick = () => navigate('/meds/create');

  const onActivated = async () => {
    if (getDatabaseRevision() <= lastRevision) return;
    lastRevision = getDatabaseRevision();
    meds = await listMeds();
    photoUrls = await getMedPhotoUrls(meds.map((m) => m.id));
    updateStatCards();
    renderFilteredCards();
  };
  root.addEventListener('tab:activated', onActivated);

  const cleanup = () => {
    root.removeEventListener('tab:activated', onActivated);
  };
  signal?.addEventListener('abort', cleanup, { once: true });

  if (!signal?.aborted) {
    const dock = createActionDock([fabAdd]);
    const topRight = el('div', { class: 'topbar-actions medication-list-actions' });
    const batchBtn = topbarPill({
      icon: 'list',
      label: '批量管理',
      onClick: () => {
        void enterBatchMode(root, signal);
      },
    });
    topRight.append(batchBtn, topbarAiPill());

    renderPage({
      root,
      title: '药品',
      activeTab: 'meds',
      topRight,
      content,
      actionDock: dock,
    });
  }

  return cleanup;
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
    card.onclick = (e) => {
      if ((e.target as HTMLElement).closest('.medication-batch-checkbox-wrap')) return;
      if (selected.has(m.id)) selected.delete(m.id);
      else selected.add(m.id);
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
  const enableButton = createButton({ label: '启用', variant: 'secondary', onClick: () => void setRulesForSelected(true) });
  const disableButton = createButton({ label: '禁用', variant: 'secondary', onClick: () => void setRulesForSelected(false) });
  const slotButton = createButton({ label: '改时段', variant: 'secondary', icon: 'clock', onClick: openSlotMenu });
  const deleteButton = createButton({ label: '删除', variant: 'danger', icon: 'trash', onClick: () => void deleteSelected() });
  dock.append(enableButton, disableButton, slotButton, deleteButton);

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
    const selSpan = selectAllBtn.querySelector('span');
    if (selSpan) selSpan.textContent = selected.size === meds.length ? '取消全选' : '全选';
    counterLabel.textContent = text;
  }

  async function setRulesForSelected(enabled: boolean): Promise<void> {
    if (signal?.aborted) return;
    if (selected.size === 0) {
      toast('请先选择药品');
      return;
    }
    const updates: Array<{ id: string; enabled: boolean }> = [];
    for (const medId of selected) {
      const rs = medRulesMap.get(medId) ?? [];
      for (const r of rs) updates.push({ id: r.id, enabled });
    }
    if (updates.length === 0) {
      toast('选中的这些药还没设过提醒时间');
      return;
    }
    await commitBatchRuleUpdatesForRoute(updates, signal!, () => {
      toast(`已${enabled ? '启用' : '禁用'} ${updates.length} 条提醒`);
      return renderMedListPage(root, signal);
    }, {
      updateRules: async (ups) => {
        for (const u of ups) {
          const rule = rules.find((r) => r.id === u.id);
          if (rule) {
            rule.enabled = u.enabled;
            await putRule(rule);
          }
        }
      },
      reschedule: async () => {
        await rescheduleMedicationReminders();
      },
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
    const updates: Array<{ id: string; enabled: boolean }> = [];
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
    await commitBatchRuleUpdatesForRoute(updates, signal!, () => {
      toast(`已${enabled ? '启用' : '禁用'} ${updates.length} 条「${SLOT_LABEL[slot]}」提醒`);
      return renderMedListPage(root, signal);
    }, {
      updateRules: async (ups) => {
        for (const u of ups) {
          const rule = rules.find((r) => r.id === u.id);
          if (rule) {
            rule.enabled = u.enabled;
            await putRule(rule);
          }
        }
      },
      reschedule: async () => {
        await rescheduleMedicationReminders();
      },
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

export async function deleteSelected(selectedIds: string[]): Promise<void> {
  void openBottomSheet;
  for (const id of selectedIds) {
    await softDeleteMed(id);
  }
}

export async function commitBatchRuleUpdatesForRoute(
  updates: Array<{ id: string; enabled: boolean }>,
  signal: AbortSignal,
  complete: () => void,
  operations: {
    updateRules: (updates: Array<{ id: string; enabled: boolean }>) => Promise<void>;
    reschedule: () => Promise<void>;
  },
): Promise<void> {
  await operations.updateRules(updates);
  await operations.reschedule();
  if (!signal.aborted) {
    complete();
  }
}

function createStatCard(colorCls: string, label: string, val: string, img: string, svgFn: () => string): HTMLElement {
  const card = el('div', { class: `med-stat-card ${colorCls}` });
  card.append(el('div', { class: 'med-stat-label', text: label }));
  card.append(el('div', { class: 'med-stat-val', text: val }));
  const iconWrap = el('div', { class: 'med-stat-icon-wrap' });
  iconWrap.append(render3dMedia(img, svgFn, label, 'med-stat-icon-img'));
  card.append(iconWrap);
  return card;
}
