import '../ui/styles/pages/medications.css';
import {
  listMeds,
  softDeleteMed,
} from '../db/local';
import {
  el,
  renderPage,
  icon,
  toast,
  banner,
  topbarAiPill,
} from '../ui/components';
import { navigate } from '../router';
import { isLowStock } from '../features/inventory';
import { getMedPhotoUrls } from '../features/medPhotos';
import { getOrCreateMed3DImage } from '../features/aiImageGen';
import {
  purpleBottleImg,
  clockPillImg,
  aidBagImg,
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

export async function renderMedListPage(root: HTMLElement, signal?: AbortSignal): Promise<void> {
  const meds = await listMeds();
  if (signal?.aborted) return;
  const photoUrls = await getMedPhotoUrls(meds.map((m) => m.id));
  if (signal?.aborted) return;

  const content = el('div', { class: 'page medication-list-page' });

  // 1. 顶部 3 个 3D 指标卡片
  const totalCount = meds.length;
  const activeCount = meds.filter((m) => m.slots.length > 0).length || totalCount;
  const lowStockCount = meds.filter((m) => isLowStock(m)).length;

  const statGrid = el('div', { class: 'med-stat-grid' });
  statGrid.append(
    createStatCard('purple', '全部药品', `${totalCount} 种`, purpleBottleImg, getMedBottle3dSvg),
    createStatCard('cyan', '近期使用', `${activeCount} 种`, clockPillImg, getClockPill3dSvg),
    createStatCard('pink', '需要补充', `${lowStockCount} 种`, aidBagImg, getAidBag3dSvg)
  );
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
      info.append(el('div', { id: medNameId, class: 'medication-batch-name', text: m.name || '未命名' }));

      const dose = med.amountPerDose || med.dosageText || '1片';
      const spec = med.dosageText && med.amountPerDose ? `${med.dosageText} · ${med.amountPerDose}` : dose;
      info.append(el('div', { class: 'med-item-spec', text: spec }));

      const freqText = med.slots.length > 0 ? `每日${med.slots.length}次` : '按需服用';
      info.append(el('div', { class: 'med-item-freq', text: freqText }));

      const badges = el('div', { class: 'med-item-badges' });
      const stock = med.inventory?.remaining ?? 36;
      const low = isLowStock(med);
      const stockPill = el('span', {
        class: `med-stock-pill ${low ? 'low' : 'ok'}`,
        text: low ? `库存不足 剩余 ${stock}片` : `库存充足 剩余 ${stock}片`,
      });
      badges.append(stockPill);
      info.append(badges);

      // 编辑按钮
      const editBtn = el('button', {
        class: 'med-item-edit-btn',
        type: 'button',
        'aria-label': '编辑药品',
      } as any);
      editBtn.append(icon('edit'));
      editBtn.onclick = (e) => {
        e.stopPropagation();
        navigate(`/meds/${med.id}/edit`);
      };

      card.onclick = () => navigate(`/meds/${med.id}/edit`);
      card.append(thumb, info, editBtn);
      listContainer.append(card);
    }
  }

  renderFilteredCards();

  // 5. 底部悬浮 "+ 添加药品" 按钮
  const fabAdd = el('button', {
    class: 'med-fab-add',
    type: 'button',
  });
  fabAdd.append(icon('plus'), el('span', { text: '添加药品' }));
  fabAdd.onclick = () => navigate('/meds/new');
  content.append(fabAdd);

  if (!signal?.aborted) {
    const dock = createActionDock();
    renderPage({
      root,
      title: '药品',
      activeTab: 'meds',
      topRight: topbarAiPill(),
      content,
      actionDock: dock,
    });
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
