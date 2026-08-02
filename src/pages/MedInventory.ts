import '../ui/styles/pages/inventory.css';
import { listMeds, listRules, listRecentInventoryOperations, undoInventoryOperation, batchDeductInventory, updateMedicationInventory } from '../db/local';
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
import { el, emptyState, icon, renderPage, toast, topbarPill } from '../ui/components';
import { openBottomSheet, type BottomSheetHandle } from '../ui/primitives/BottomSheet';
import { createButton } from '../ui/primitives/Button';
import { createIconButton } from '../ui/primitives/IconButton';
import { toLocalDate } from '../domain/medicationSchedule';
import { identifyInventoryByBlob, IdentifyError, parseInventorySpeech, type InventorySpeechItem } from '../ai/identify';
import { setPendingInventoryPrefill } from '../ai/pendingPrefill';
import { createProxyAsrRecognizer, isAsrConfigured, type SpeechRecognitionLike } from '../ai/asr';

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

  const smartBtn = topbarPill({ icon: 'sparkles', label: '智能录入', variant: 'primary', onClick: () => openInventorySmartSheet(root, sorted, rulesByMedId, signal) });

  const topRight = el('div', { class: 'topbar-actions' });
  topRight.append(moreBtn, smartBtn);

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
      void save(packageQuantity, 'add');
    },
  }));
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

/** 智能录入：拍照/相册图片识别库存，或按住说话口述库存。识别后匹配已有药品→更新；未登记→提示去添加。 */
function openInventorySmartSheet(
  root: HTMLElement,
  sorted: Medication[],
  rulesByMedId: Map<string, ReminderRule[]>,
  signal?: AbortSignal,
): void {
  const title = el('h2', { class: 'inventory-sheet-title', text: '智能录入库存' });
  const hint = el('p', {
    class: 'inventory-sheet-hint',
    text: '拍药盒/票据让 AI 数药量，或按住说一句话描述还剩多少。识别完会先让你核对再保存。',
  });
  const actions = el('div', { class: 'inventory-sheet-actions' });

  const cameraInput = el('input', { type: 'file', accept: 'image/*', hidden: true } as any) as HTMLInputElement;
  cameraInput.setAttribute('capture', 'environment');
  const albumInput = el('input', { type: 'file', accept: 'image/*', hidden: true } as any) as HTMLInputElement;

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

  const recognizer = createInventoryRecognizer();
  if (recognizer) {
    actions.append(createButton({
      label: '按住说话',
      variant: 'secondary',
      icon: 'mic',
      onClick: () => startVoiceInventory(recognizer, root, sorted, rulesByMedId, signal, close),
    }));
  } else {
    actions.append(el('p', {
      class: 'inventory-sheet-hint',
      text: '这个浏览器不支持语音输入，可用拍照或相册。',
    } as any));
  }
  actions.append(createButton({ label: '取消', variant: 'text', onClick: close }));

  const onImage = (file: File | undefined) => {
    if (!file) return;
    close();
    void runImageInventory(root, file, sorted, rulesByMedId, signal);
  };
  cameraInput.onchange = () => onImage(cameraInput.files?.[0]);
  albumInput.onchange = () => onImage(albumInput.files?.[0]);
}

function createInventoryRecognizer(): SpeechRecognitionLike | null {
  if (isAsrConfigured()) return createProxyAsrRecognizer();
  const Ctor = (window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  });
  const Recognition = Ctor.SpeechRecognition ?? Ctor.webkitSpeechRecognition;
  if (!Recognition) return null;
  try {
    const r = new Recognition();
    r.lang = 'zh-CN';
    r.continuous = false;
    r.interimResults = false;
    return r;
  } catch {
    return null;
  }
}

async function runImageInventory(
  root: HTMLElement,
  file: File,
  sorted: Medication[],
  rulesByMedId: Map<string, ReminderRule[]>,
  signal?: AbortSignal,
): Promise<void> {
  let busy: BottomSheetHandle | undefined;
  try {
    const status = el('p', { class: 'inventory-sheet-hint', text: '正在数药量…' });
    busy = openBottomSheet({ label: '识别库存中', content: [status] });
    const r = await identifyInventoryByBlob(file);
    if (signal?.aborted) return;
    busy.close();
    busy = undefined;
    applyInventoryMatch(root, { name: r.name, inventory: r.inventory, confidence: r.confidence }, sorted, rulesByMedId, signal);
  } catch (error) {
    busy?.close();
    if (error instanceof IdentifyError) toast(error.message);
    else toast('没认出药量，换个角度或更清楚的图试试');
  }
}

function startVoiceInventory(
  recognizer: SpeechRecognitionLike,
  root: HTMLElement,
  sorted: Medication[],
  rulesByMedId: Map<string, ReminderRule[]>,
  signal: AbortSignal | undefined,
  closeParent: () => void,
): void {
  closeParent();
  const overlay = el('div', { class: 'med-wizard-overlay' });
  overlay.setAttribute('role', 'presentation');
  const sheet = el('section', { class: 'med-wizard voice-entry' });
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', '说一说库存');
  sheet.tabIndex = -1;
  const hint = el('p', { class: 'med-wizard-sub', text: '说一说手头还剩多少药，说完点整理。例如：阿司匹林还剩5片，二甲双胍刚买了一盒20片。' });
  const input = el('textarea', { class: 'voice-entry-text', placeholder: '点话筒说话，或直接打字…' }) as HTMLTextAreaElement;
  const interim = el('div', { class: 'voice-entry-interim' });
  interim.setAttribute('aria-live', 'polite');
  const errorBox = el('div', { class: 'voice-entry-error' });
  const micBtn = createButton({ label: '开始说', variant: 'secondary', icon: 'mic' });
  const submitBtn = createButton({ label: '整理成库存', icon: 'sparkles' });
  const quitBtn = createButton({ label: '取消', variant: 'text' });
  const actions = el('div', { class: 'med-wizard-actions' });
  actions.append(micBtn, submitBtn, quitBtn);
  sheet.append(hint, input, interim, errorBox, actions);
  overlay.append(sheet);
  document.body.append(overlay);
  sheet.focus();

  let listening = false;
  const toggle = () => {
    if (listening) { recognizer.stop(); listening = false; micBtn.querySelector('span')!.textContent = '开始说'; }
    else { try { recognizer.start(); listening = true; micBtn.querySelector('span')!.textContent = '正在听…'; } catch { /* ignore */ } }
  };
  micBtn.onclick = toggle;
  recognizer.onresult = (event) => {
    let finalText = '';
    for (const result of Array.from(event.results)) {
      if (result.isFinal) finalText += String(result[0]?.transcript ?? '');
    }
    if (finalText) input.value = (input.value + ' ' + finalText).trim();
    interim.textContent = '';
  };
  recognizer.onerror = () => { listening = false; micBtn.querySelector('span')!.textContent = '开始说'; };
  recognizer.onend = () => { listening = false; micBtn.querySelector('span')!.textContent = '开始说'; };

  const dispose = () => { overlay.remove(); };
  quitBtn.onclick = dispose;
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dispose(); };
  overlay.addEventListener('keydown', onKey);

  submitBtn.onclick = async () => {
    const text = input.value.trim();
    if (!text) { errorBox.textContent = '先说一说或打几个字'; return; }
    errorBox.textContent = '';
    try { recognizer.abort?.(); } catch { /* ignore */ }
    const busy = openBottomSheet({ label: '解析库存中', content: [el('p', { class: 'inventory-sheet-hint', text: '正在整理…' })] });
    try {
      const result = await parseInventorySpeech(text);
      if (signal?.aborted) return;
      busy.close();
      dispose();
      for (const item of result.items) applyInventoryMatch(root, item, sorted, rulesByMedId, signal);
      if (result.items.length === 0) toast('没听出来有哪些药，补充点信息再试');
    } catch (error) {
      busy.close();
      if (error instanceof IdentifyError) errorBox.textContent = error.message;
      else errorBox.textContent = '没整理出来，换个说法再试';
    }
  };
}

/** 识别结果匹配已有药品→弹确认更新库存；未登记→提示跳添加药品页预填。 */
function applyInventoryMatch(
  root: HTMLElement,
  item: InventorySpeechItem,
  sorted: Medication[],
  _rulesByMedId: Map<string, ReminderRule[]>,
  signal?: AbortSignal,
): void {
  const name = item.name.trim();
  const med = matchMedByName(name, sorted);
  if (med) {
    confirmUpdateInventory(root, med, item, signal);
  } else {
    promptAddNewMed(item);
  }
}

function matchMedByName(name: string, meds: Medication[]): Medication | undefined {
  const kw = name.trim().toLowerCase();
  if (!kw) return undefined;
  return meds.find((m) => m.name.toLowerCase() === kw)
    ?? meds.find((m) => m.name.toLowerCase().includes(kw) || kw.includes(m.name.toLowerCase()));
}

function confirmUpdateInventory(
  root: HTMLElement,
  med: Medication,
  item: InventorySpeechItem,
  signal?: AbortSignal,
): void {
  const inv = mergeInventory(med.inventory, item.inventory);
  const title = el('h2', { class: 'inventory-sheet-title', text: med.name || '未命名药品' });
  const hint = el('p', {
    class: 'inventory-sheet-hint',
    text: `识别到「${item.name || med.name}」剩余 ${formatQuantity(inv.remaining)}${inv.unit}，是否更新库存？`,
  });
  const actions = el('div', { class: 'inventory-sheet-actions' });
  let sheet: BottomSheetHandle | undefined = openBottomSheet({ label: '更新库存', content: [title, hint, actions] });
  actions.append(createButton({
    label: '更新库存',
    icon: 'check',
    onClick: async () => {
      sheet?.close();
      sheet = undefined;
      try {
        const { remaining, unit, ...metadata } = inv;
        const {
          remaining: expectedRemaining,
          unit: expectedUnit,
          ...expectedMetadata
        } = med.inventory ?? { remaining: undefined, unit: undefined };
        const committed = await updateMedicationInventory(med.id, {
          action: 'set',
          remaining,
          unit,
          expectedRemaining,
          expectedUnit,
          metadata: { expected: expectedMetadata, value: metadata },
        }, {
          source: 'manual',
          sourceNote: `智能录入库存为 ${formatQuantity(remaining)}${unit}`,
        });
        if (signal?.aborted) return;
        const inventory = committed.med.inventory!;
        toast(`已更新「${committed.med.name}」剩余 ${formatQuantity(inventory.remaining)}${inventory.unit}`);
        await renderMedInventoryPage(root, signal);
      } catch {
        toast('库存保存失败，请稍后重试');
      }
    },
  }));
  actions.append(createButton({ label: '取消', variant: 'text', onClick: () => { sheet?.close(); sheet = undefined; } }));
}

function promptAddNewMed(item: InventorySpeechItem): void {
  const title = el('h2', { class: 'inventory-sheet-title', text: '没找到这个药' });
  const hint = el('p', {
    class: 'inventory-sheet-hint',
    text: `没找到叫「${item.name}」的药。要不要去添加？会帮你带上识别到的库存。`,
  });
  const actions = el('div', { class: 'inventory-sheet-actions' });
  let sheet: BottomSheetHandle | undefined = openBottomSheet({ label: '添加新药', content: [title, hint, actions] });
  actions.append(createButton({
    label: '去添加',
    icon: 'plus',
    onClick: () => {
      sheet?.close();
      sheet = undefined;
      setPendingInventoryPrefill({ name: item.name, inventory: item.inventory });
      navigate('/meds/new');
    },
  }));
  actions.append(createButton({ label: '取消', variant: 'text', onClick: () => { sheet?.close(); sheet = undefined; } }));
}

/** 保留原库存的 lastReminderAt/dailyConsumption，识别结果覆盖其余字段。 */
function mergeInventory(current: MedicationInventory | undefined, identified: MedicationInventory): MedicationInventory {
  return {
    remaining: identified.remaining > 0 ? identified.remaining : current?.remaining ?? identified.remaining,
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
