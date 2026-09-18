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
import { parseSvg } from '../ui/assets3d';
import { matchPinyinOrText } from '../utils/pinyin';
import { openBottomSheet } from '../ui/primitives/BottomSheet';
import { createActionDock } from '../ui/primitives/ActionDock';

function getDeterministicTone(idOrName: string): string {
  const tones = ['#74947a', '#6b878f', '#aa9470', '#8f8487', '#5c7c88', '#82728f', '#6c8b74', '#79808a'];
  let hash = 0;
  for (let i = 0; i < idOrName.length; i++) hash = (hash * 31 + idOrName.charCodeAt(i)) & 0xffffffff;
  return tones[Math.abs(hash) % tones.length] || '#74947a';
}

function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

export function renderBPackageSvg(m: { id: string; name: string; dosageText?: string; amountPerDose?: string }): string {
  const tone = getDeterministicTone(m.id || m.name || 'med');
  const spec = [m.dosageText, m.amountPerDose].filter(Boolean).join(' · ');
  const safeName = escapeHtml(m.name || '药品');
  const safeSpec = escapeHtml(spec || '');
  const idAttr = escapeHtml(m.id || 'pack');
  return `<svg viewBox="0 0 170 130" aria-hidden="true" class="b-package-svg">
    <defs>
      <linearGradient id="paper_${idAttr}" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#fffef9"/>
        <stop offset="1" stop-color="#e9ece6"/>
      </linearGradient>
    </defs>
    <ellipse cx="86" cy="116" rx="54" ry="6" fill="#354d34" opacity=".08"/>
    <g transform="rotate(-9 85 68)">
      <path d="M39 32 52 23h87l-12 9Z" fill="#fcfdf9"/>
      <path d="m127 32 12-9v77l-12 11Z" fill="#d5ddd4"/>
      <path d="M39 32h88v79H39Z" fill="url(#paper_${idAttr})" stroke="#dce2d9" stroke-width=".5"/>
      <path d="M39 69h88v26H39Z" fill="${tone}"/>
      <path d="m127 69 12-10v26l-12 10Z" fill="${tone}" opacity=".85"/>
      <text x="48" y="48" font-size="5" fill="#79917d" letter-spacing="1.5">XIAOYAOHE</text>
      <text x="48" y="62" font-size="8.5" font-weight="600" fill="#3b4c40">${safeName.length > 7 ? safeName.slice(0, 6) + '…' : safeName}</text>
      <text x="48" y="84" font-size="7" font-family="Georgia,serif" fill="#fff" letter-spacing=".7">MEDBOX</text>
      <text x="48" y="104" font-size="5" fill="#8b9688">${safeSpec.length > 12 ? safeSpec.slice(0, 11) + '…' : safeSpec}</text>
    </g>
  </svg>`;
}

function getFeatureBottleSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="feature-art" viewBox="0 0 160 180" aria-hidden="true">
    <defs>
      <linearGradient id="heroBottle" x1="0" x2="1">
        <stop stop-color="#e9ede7"/>
        <stop offset=".3" stop-color="#fff"/>
        <stop offset=".74" stop-color="#f5f6f0"/>
        <stop offset="1" stop-color="#d4dcd2"/>
      </linearGradient>
      <filter id="featureShadow">
        <feDropShadow dx="0" dy="7" stdDeviation="6" flood-color="#345641" flood-opacity=".15"/>
      </filter>
    </defs>
    <ellipse cx="84" cy="160" rx="48" ry="7" fill="#acc0ae" opacity=".25"/>
    <g filter="url(#featureShadow)" transform="rotate(-12 78 90)">
      <path d="M46 47q-10 7-10 19v78q0 11 12 11h58q12 0 12-11V66q0-12-10-19" fill="url(#heroBottle)"/>
      <rect x="45" y="22" width="64" height="29" rx="6" fill="#fafbf5"/>
      <path d="M49 26v20m5-20v20m5-20v20m5-20v20m5-20v20m5-20v20m5-20v20m5-20v20m5-20v20m5-20v20m5-20v20m5-20v20m5-20v20m5-20v20" stroke="#d7ddd1"/>
      <path d="M36 79h82v48H36" fill="#769b7e"/>
      <text x="77" y="98" font-size="8" fill="#edf4e9" text-anchor="middle" letter-spacing="1.5">DAILY CARE</text>
      <text x="77" y="118" font-family="Georgia,serif" font-size="20" fill="white" text-anchor="middle">Vitamin</text>
      <text x="77" y="141" font-size="6" fill="#849381" text-anchor="middle" letter-spacing="2">60 TABLETS</text>
    </g>
    <g transform="rotate(28 123 140)">
      <rect x="117" y="125" width="14" height="29" rx="7" fill="#fafaf2"/>
      <path d="M117 140h14v7a7 7 0 0 1-14 0Z" fill="#bbd0b7"/>
    </g>
  </svg>`;
}

let activeCategory: 'all' | 'daily' | 'reserve' = 'all';
let searchQuery = '';

const medListCleanupByRoot = new WeakMap<HTMLElement, () => void>();

export async function renderMedListPage(root: HTMLElement, signal?: AbortSignal): Promise<() => void> {
  medListCleanupByRoot.get(root)?.();
  let meds = await listMeds();
  if (signal?.aborted) return () => undefined;
  let photoUrls = await getMedPhotoUrls(meds.map((m) => m.id));
  if (signal?.aborted) return () => undefined;
  let lastRevision = getDatabaseRevision();

  const content = el('div', { class: 'page medication-list-page' });

  // 1. 顶部标题栏
  const header = el('header', { class: 'med-header header' });
  const headerText = el('div');
  headerText.append(
    el('h2', { class: 'med-header-title', text: '我的药品' }),
    el('p', { class: 'med-header-sub', text: '每一份照顾，都井井有条。' })
  );
  header.append(headerText);
  content.append(header);

  // 2. 搜索框
  const searchRow = el('label', { class: 'search med-search-row' });
  const searchIcon = el('div', { class: 'med-search-icon' });
  searchIcon.append(icon('search'));

  const input = el('input', {
    id: 'search',
    class: 'med-search-input',
    type: 'search',
    placeholder: '搜索药品名称、规格或备注',
    value: searchQuery,
    'aria-label': '搜索药品名称',
  }) as HTMLInputElement;

  input.oninput = () => {
    searchQuery = input.value.trim();
    renderFilteredCards();
  };

  searchRow.append(searchIcon, input);
  content.append(searchRow);

  // 3. 类别筛选 Tab（全部药品 / 日常服用 / 家庭常备）
  const filtersContainer = el('div', { class: 'filters med-category-tabs', role: 'tablist', 'aria-label': '药品分类' });
  const categories: Array<{ key: typeof activeCategory; label: string }> = [
    { key: 'all', label: '全部药品' },
    { key: 'daily', label: '日常服用' },
    { key: 'reserve', label: '家庭常备' },
  ];

  categories.forEach((cat) => {
    const isAct = activeCategory === cat.key;
    const filterBtn = el('button', {
      class: `filter med-category-pill${isAct ? ' active' : ''}`,
      type: 'button',
      'aria-pressed': isAct ? 'true' : 'false',
      text: cat.label,
    });
    filterBtn.onclick = () => {
      activeCategory = cat.key;
      filtersContainer.querySelectorAll('.filter').forEach((f) => {
        f.classList.remove('active');
        f.setAttribute('aria-pressed', 'false');
      });
      filterBtn.classList.add('active');
      filterBtn.setAttribute('aria-pressed', 'true');
      renderFilteredCards();
    };
    filtersContainer.append(filterBtn);
  });
  content.append(filtersContainer);

  // 4. Feature 卡片 (查看库存)
  const featureCard = el('button', {
    id: 'stockFeature',
    class: 'feature med-feature-card',
    type: 'button',
    'aria-label': '查看药品库存',
  });
  const featureText = el('div', { class: 'feature-text' });
  const featureH3 = el('h3');
  featureH3.append('照顾好自己，', el('br'), '从一件小事开始。');
  const featureLink = el('span', { class: 'feature-link' }, [
    document.createTextNode('查看库存 '),
    el('span', { text: '↗' }),
  ]);
  featureText.append(
    el('span', { class: 'eyebrow', text: 'A LITTLE CARE, EVERY DAY' }),
    featureH3,
    el('p', { text: '检查药箱，让安心有备而来。' }),
    featureLink
  );
  const featureSvgWrap = el('div', { class: 'feature-art-wrap' }, [parseSvg(getFeatureBottleSvg())]);
  featureCard.append(featureText, featureSvgWrap);
  featureCard.onclick = () => navigate('/meds/inventory');
  content.append(featureCard);

  // 5. 分区标题
  const sectionLabel = el('div', { class: 'section-label' });
  const labelSpan = el('span', { text: '药箱里的日常' });
  const countSmall = el('small', { id: 'medCount', text: `${meds.length} 种药品` });
  sectionLabel.append(labelSpan, countSmall);
  content.append(sectionLabel);

  // 6. 双列网格药品卡片列表（以包装图为视觉中心）
  const listContainer = el('div', { class: 'medicine-grid med-card-list' });
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

    if (activeCategory === 'daily') {
      filtered = filtered.filter((m) => m.slots && m.slots.length > 0);
    } else if (activeCategory === 'reserve') {
      filtered = filtered.filter((m) => !m.slots || m.slots.length === 0);
    }

    countSmall.textContent = `${filtered.length} 种药品`;

    if (filtered.length === 0) {
      const empty = el('div', { class: 'empty med-empty-state' });
      empty.append(el('p', { text: '没有找到匹配的药品' }));
      const resetBtn = el('button', {
        class: 'ui-button ui-button-secondary',
        type: 'button',
        text: '查看全部药品',
      });
      resetBtn.onclick = () => {
        searchQuery = '';
        input.value = '';
        activeCategory = 'all';
        filtersContainer.querySelectorAll('.filter').forEach((f) => {
          const isAll = (f as HTMLElement).textContent?.includes('全部');
          f.classList.toggle('active', !!isAll);
          f.setAttribute('aria-pressed', isAll ? 'true' : 'false');
        });
        renderFilteredCards();
      };
      empty.append(resetBtn);
      listContainer.append(empty);
      return;
    }

    for (const med of filtered) {
      const medNameId = `med-name-${med.id}`;
      const isDaily = med.slots && med.slots.length > 0;
      const card = el('div', {
        class: 'medicine med-item-card medication-list-row medication-batch-row',
        'aria-selected': 'false',
        'aria-labelledby': medNameId,
        'data-med': med.id,
      } as any);

      // 缩略图（三级降级管线：实拍照/AI白底大图 -> 3D 拟物图 -> B 方案色块药盒矢量占位）
      const art = el('div', { class: 'medicine-art med-item-thumb medication-batch-thumb' });
      const photoUrl = photoUrls.get(med.id);
      if (photoUrl) {
        const img = el('img', {
          src: photoUrl,
          alt: med.name,
          loading: 'lazy',
        }) as HTMLImageElement;
        img.onerror = () => {
          art.replaceChildren(parseSvg(renderBPackageSvg(med)));
        };
        art.append(img);
      } else {
        const threeDImg = getOrCreateMed3DImage(med.id, med.name, med.amountPerDose || med.dosageText);
        if (threeDImg && !threeDImg.startsWith('data:image/svg+xml')) {
          const img = el('img', {
            src: threeDImg,
            alt: med.name,
            loading: 'lazy',
          }) as HTMLImageElement;
          img.onerror = () => {
            art.replaceChildren(parseSvg(renderBPackageSvg(med)));
          };
          art.append(img);
        } else {
          art.replaceChildren(parseSvg(renderBPackageSvg(med)));
        }
      }

      const nameEl = el('h3', { id: medNameId, class: 'med-item-name medication-batch-name', text: med.name || '未命名' });

      const dose = med.amountPerDose || med.dosageText || '1片';
      const spec = med.dosageText && med.amountPerDose ? `${med.dosageText} · ${med.amountPerDose}` : dose;
      const freqText = isDaily ? `每日${med.slots.length}次` : '按需服用';
      const specEl = el('p', { class: 'med-item-spec', text: `${spec} · ${freqText}` });

      const amountRow = el('div', { class: 'amount' });
      const stock = med.inventory?.remaining ?? 36;
      const low = isLowStock(med);
      const unit = med.doseUnit || '片';
      const stockSmall = el('small', { text: `余 ${stock} ${unit}` });
      const tagText = !isDaily ? '家庭常备' : low ? '即将用完' : '日常服用';
      const tagEl = el('span', {
        class: `tag med-stock-pill ${low ? 'low' : ''}`,
        text: tagText,
      });
      amountRow.append(stockSmall, tagEl);

      card.append(art, nameEl, specEl, amountRow);
      card.onclick = () => navigate(`/meds/${med.id}/edit`);
      listContainer.append(card);
    }
  }

  renderFilteredCards();

  // 7. 底部右下角悬浮 "+ 添加药品" 按钮（通过 actionDock 稳定挂载）
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
    renderFilteredCards();
  };
  root.addEventListener('tab:activated', onActivated);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    root.removeEventListener('tab:activated', onActivated);
    signal?.removeEventListener('abort', cleanup);
    if (medListCleanupByRoot.get(root) === cleanup) {
      medListCleanupByRoot.delete(root);
    }
  };
  medListCleanupByRoot.set(root, cleanup);
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
  if (!root.isConnected) return;
  const [meds, rules] = await Promise.all([listMeds(), listRules()]);
  if (!root.isConnected) return;
  if (meds.length === 0) {
    toast('暂无药品可管理');
    return;
  }

  const photoUrls = await getMedPhotoUrls(meds.map((m) => m.id));
  if (!root.isConnected) return;

  const medRulesMap = new Map<string, ReminderRule[]>();
  for (const m of meds) {
    medRulesMap.set(m.id, rules.filter((r) => r.medId === m.id && !r.deleted));
  }

  const selected = new Set<string>();
  const cancelBtn = topbarPill({
    icon: 'arrow-left',
    label: '退出批量',
    onClick: () => {
      void renderMedListPage(root);
    },
  });
  const topRight = el('div', { class: 'topbar-actions medication-list-actions' });
  topRight.append(cancelBtn);

  const content = el('div', { class: 'page medication-batch-page' });
  const toolbar = el('div', { class: 'medication-batch-toolbar' });
  const selectAllBtn = createButton({ label: '全选', variant: 'text' });
  const counterLabel = el('span', { class: 'medication-batch-counter', text: `共 ${meds.length} 种 · 已选 0 种` });
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

    // 缩略图
    const thumb = el('div', { class: 'medication-batch-thumb' });
    const photoUrl = photoUrls.get(m.id);
    if (photoUrl) {
      const img = el('img', {
        src: photoUrl,
        alt: m.name || '药品',
        loading: 'lazy',
      }) as HTMLImageElement;
      img.onerror = () => {
        thumb.replaceChildren(parseSvg(renderBPackageSvg(m)));
      };
      thumb.append(img);
    } else {
      const threeDImg = getOrCreateMed3DImage(m.id, m.name, m.amountPerDose || m.dosageText);
      if (threeDImg && !threeDImg.startsWith('data:image/svg+xml')) {
        const img = el('img', {
          src: threeDImg,
          alt: m.name || '药品',
          loading: 'lazy',
        }) as HTMLImageElement;
        img.onerror = () => {
          thumb.replaceChildren(parseSvg(renderBPackageSvg(m)));
        };
        thumb.append(img);
      } else {
        thumb.replaceChildren(parseSvg(renderBPackageSvg(m)));
      }
    }
    body.append(thumb);

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
  const slotButton = createButton({ label: '改时段', ariaLabel: '修改时段', variant: 'secondary', icon: 'clock', onClick: openSlotMenu });
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
    const text = `共 ${meds.length} 种 · 已选 ${selected.size} 种`;
    const selSpan = selectAllBtn.querySelector('span');
    if (selSpan) selSpan.textContent = selected.size === meds.length ? '取消全选' : '全选';
    counterLabel.textContent = text;
  }

  async function setRulesForSelected(enabled: boolean): Promise<void> {
    if (!root.isConnected) return;
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
    const activeSignal = signal && !signal.aborted ? signal : new AbortController().signal;
    await commitBatchRuleUpdatesForRoute(updates, activeSignal, () => {
      toast(`已${enabled ? '启用' : '禁用'} ${updates.length} 条提醒`);
      return renderMedListPage(root);
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
    if (!root.isConnected) return;
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
      if (!root.isConnected) return;
      toast(`已删除 ${count} 种药品`);
      await renderMedListPage(root);
    } catch {
      toast('删除失败，请稍后重试');
    } finally {
      deleteButton.disabled = false;
    }
  }

  async function setSlotForSelected(slot: Slot, enabled: boolean): Promise<void> {
    if (!root.isConnected) return;
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
    const activeSignal = signal && !signal.aborted ? signal : new AbortController().signal;
    await commitBatchRuleUpdatesForRoute(updates, activeSignal, () => {
      toast(`已${enabled ? '启用' : '禁用'} ${updates.length} 条「${SLOT_LABEL[slot]}」提醒`);
      return renderMedListPage(root);
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
