// 按顺序分药向导：一盒一盒弹卡展示「药盒长什么样、放哪些格、每格几粒」。
// 逐盒步骤只做引导，完成页确认后由调用方按具体服药时段预扣库存。
import { SLOT_LABEL, formatMealRels, type MealRel, type Medication, type Slot } from '../db/schema';
import { registerRouteTransitionCleanup, navigate } from '../router';
import { el, icon, banner, SLOT_ICON } from './components';
import { createButton } from './primitives/Button';
import { openBottomSheet } from './primitives/BottomSheet';
import { doseFormLabel } from './MedOnboardWizard';

export interface SortWizardEntry {
  occurrenceId: string;
  slot: Slot;
  timeLocal: string;
  /** 每格放多少：结构化剂量或自由文本，空串显示“按医嘱” */
  doseLabel: string;
  doseQuantity?: number;
  doseUnit?: string;
  mealRels: MealRel[];
}

export interface SortWizardItem {
  med: Medication;
  photoUrl?: string;
  entries: SortWizardEntry[];
  /** 今天为停药期：这盒今天不用分 */
  isRest: boolean;
  expired: boolean;
}

/**
 * 分药向导完成时的摘要。每项对应一种被分装的药品及其总剂量。
 * 调用方（如 ScanSort.ts）可据此调用 recordPreDeduction 预扣库存。
 */
export interface SortWizardSummary {
  items: Array<{
    medId: string;
    medName: string;
    /** 本次可安全预扣的具体时段；剂量未结构化的时段不会进入此数组。 */
    entries: Array<{ occurrenceId: string; quantity: number; unit: string }>;
    totalDose: number;
    doseUnit?: string;
    /** 实际分装的时段数（不含停药/过期项，包含剂量待复核项） */
    entryCount: number;
  }>;
  completedAt: number;
}

export interface SortWizardHandle {
  close: () => void;
}

export function buildSortWizardSummary(
  items: readonly SortWizardItem[],
  completedAt = Date.now(),
): SortWizardSummary {
  return {
    items: items
      .filter((item) => !item.isRest && !item.expired)
      .map((item) => {
        const entries = item.entries.flatMap((entry) =>
          entry.occurrenceId && Number.isFinite(entry.doseQuantity) && (entry.doseQuantity as number) > 0 && entry.doseUnit?.trim()
            ? [{ occurrenceId: entry.occurrenceId, quantity: entry.doseQuantity as number, unit: entry.doseUnit.trim() }]
            : [],
        );
        return {
          medId: item.med.id,
          medName: item.med.name,
          entries,
          totalDose: entries.reduce((sum, entry) => sum + entry.quantity, 0),
          doseUnit: entries[0]?.unit,
          entryCount: item.entries.length,
        };
      }),
    completedAt,
  };
}

const SLOT_ORDER: readonly Slot[] = ['morning', 'noon', 'evening', 'bedtime'];

const activeSortWizards = new Set<() => void>();
registerRouteTransitionCleanup(() => {
  for (const dispose of Array.from(activeSortWizards)) dispose();
});

export function openSortWizard(
  items: readonly SortWizardItem[],
  options: { onComplete?: (summary: SortWizardSummary) => Promise<void> | void } = {},
): SortWizardHandle {
  if (items.length === 0) return { close: () => undefined };

  let step = 0; // 0..items.length-1 为逐盒卡，items.length 为完成卡
  let disposed = false;
  let completing = false;

  // 骨架沿用 .med-wizard（进度点/过渡动画共用认药向导那套样式），
  // 弹层生命周期统一交给 openBottomSheet。
  const sheet = el('section', { class: 'med-wizard' });

  const grabber = el('div', { class: 'med-wizard-grabber', 'aria-hidden': 'true' } as any);
  const progress = el('div', { class: 'med-wizard-progress' });
  progress.setAttribute('aria-live', 'polite');
  const quit = el('button', { class: 'med-wizard-skip', type: 'button', html: '先不分了' } as any);
  const head = el('div', { class: 'med-wizard-head' });
  head.append(progress, quit);
  const dots = el('div', { class: 'med-wizard-dots', 'aria-hidden': 'true' } as any);
  for (let i = 0; i < items.length; i += 1) dots.append(el('span'));
  const stage = el('div', { class: 'med-wizard-stage' });
  const actions = el('div', { class: 'med-wizard-actions' });

  sheet.append(grabber, head, dots, stage, actions);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    sheetHandle.close();
  };

  const sheetHandle = openBottomSheet({
    label: '按顺序分药',
    content: [sheet],
    className: 'med-wizard-host',
    // 逐盒引导中误点遮罩不应整盒放弃；退出走明确的「先不分了」。
    dismissOnOverlay: false,
    initialFocus: sheet,
    onClose: () => {
      activeSortWizards.delete(dispose);
    },
  });

  function buildCard(index: number): HTMLElement {
    const item = items[index];
    if (!item) return el('div', { class: 'med-wizard-card' });
    const card = el('div', { class: 'med-wizard-card' });

    // 药盒照片：认盒不认字；没照片时提示去补拍
    const photoZone = el('div', { class: 'med-wizard-photo' + (item.photoUrl ? ' has-photo' : '') });
    if (item.photoUrl) {
      const img = el('img', { class: 'med-wizard-photo-img', alt: `${item.med.name} 药盒照片` } as any) as HTMLImageElement;
      img.src = item.photoUrl;
      photoZone.append(img);
    } else {
      const empty = el('div', { class: 'med-wizard-photo-empty' });
      empty.append(icon('pill'), el('strong', { html: '还没有药盒照片' }), el('span', { html: '在药品编辑页拍一张，下次照着盒子找' }));
      photoZone.append(empty);
    }

    const name = el('h3', { class: 'med-wizard-name', text: item.med.name });

    const meta = el('div', { class: 'med-wizard-meta' });
    const form = doseFormLabel({ dosageText: item.med.dosageText ?? '', amountPerDose: item.med.amountPerDose ?? '' });
    if (form) meta.append(el('span', { class: 'med-wizard-chip', html: form }));
    if (item.med.dosageText) meta.append(el('span', { class: 'med-wizard-dosage', text: item.med.dosageText }));

    card.append(photoZone, name);
    if (meta.childElementCount > 0) card.append(meta);

    if (item.expired) {
      card.append(banner('warn', '这盒药已经过了有效期，先别分进盒子，尽快换新的。'));
    }

    if (item.isRest) {
      card.append(banner('info', '今天是这味药的停药期，这盒今天不用分。'));
      return card;
    }

    // 时段格：放哪格、几点吃、每格几粒、饭前饭后
    const slots = el('div', { class: 'med-wizard-slots' });
    const entryBySlot = new Map(item.entries.map((entry) => [entry.slot, entry]));
    for (const slot of SLOT_ORDER) {
      const entry = entryBySlot.get(slot);
      const cell = el('div', { class: 'med-wizard-slot' + (entry ? ' is-active' : '') });
      cell.append(icon(SLOT_ICON[slot]));
      cell.append(el('span', { class: 'med-wizard-slot-name', html: SLOT_LABEL[slot] }));
      if (entry) {
        cell.append(el('strong', { class: 'med-wizard-slot-amount', text: entry.doseLabel || '按医嘱' }));
        const extra = [entry.timeLocal, formatMealRels(entry.mealRels)].filter(Boolean).join(' ');
        if (extra) cell.append(el('span', { class: 'med-wizard-slot-meal', text: extra }));
      } else {
        cell.append(el('span', { class: 'med-wizard-slot-amount is-none', html: '—' }));
      }
      slots.append(cell);
    }
    card.append(slots);
    return card;
  }

  function buildSummary(): HTMLElement {
    const view = el('div', { class: 'med-wizard-summary' });
    const check = el('div', { class: 'med-wizard-check', 'aria-hidden': 'true' } as any);
    check.append(icon('check'));
    const sorted = items.filter((item) => !item.isRest && !item.expired).length;
    const title = el('h3', { class: 'med-wizard-name', html: `${sorted} 盒药都分好了` });
    const sub = el('p', { class: 'med-wizard-sub', html: '到点会提醒您吃；吃完记得在「今天」里打个勾。' });
    const list = el('div', { class: 'med-wizard-summary-list' });
    for (const item of items) {
      const row = el('div', { class: 'med-wizard-summary-row' });
      const thumb = el('span', { class: 'med-wizard-summary-thumb' + (item.photoUrl ? '' : ' is-placeholder') });
      if (item.photoUrl) {
        const img = el('img', { alt: '' } as any) as HTMLImageElement;
        img.src = item.photoUrl;
        thumb.append(img);
      } else {
        thumb.append(icon('pill'));
      }
      const copy = el('div', { class: 'med-wizard-summary-copy' });
      copy.append(
        el('strong', { text: item.med.name }),
        el('span', {
          text: item.isRest
            ? '今天停药，没有分'
            : item.expired
              ? '药品已过期，没有分'
              : item.entries.map((entry) => SLOT_LABEL[entry.slot]).join('、') || '时段待补',
        }),
      );
      row.append(thumb, copy);
      list.append(row);
    }
    view.append(check, title, sub, list);
    return view;
  }

  let currentView = buildCard(0);
  stage.append(currentView);

  function showStep(next: number, direction: 1 | -1): void {
    if (disposed || next === step || next < 0) return;
    step = next;
    const old = currentView;
    const view = step >= items.length ? buildSummary() : buildCard(step);
    view.classList.add(direction > 0 ? 'is-enter-forward' : 'is-enter-back');
    old.classList.add(direction > 0 ? 'is-exit-forward' : 'is-exit-back');
    const removeOld = () => old.remove();
    old.addEventListener('animationend', removeOld, { once: true });
    window.setTimeout(removeOld, 420);
    currentView = view;
    stage.append(view);
    updateChrome();
  }

  function complete(navigateToToday: boolean): void {
    if (disposed || completing) return;
    completing = true;
    const summary = buildSortWizardSummary(items);
    dispose();
    void Promise.resolve(options.onComplete?.(summary))
      .catch(() => undefined)
      .finally(() => {
        if (navigateToToday) navigate('/today');
      });
  }

  function updateChrome(): void {
    const onSummary = step >= items.length;
    progress.textContent = onSummary ? '都分好了' : `第 ${step + 1} 盒，共 ${items.length} 盒`;
    Array.from(dots.children).forEach((dot, index) => {
      dot.className = index < step ? 'is-done' : index === step ? 'is-current' : '';
    });
    dots.hidden = onSummary;
    quit.hidden = onSummary;
    actions.replaceChildren();
    if (onSummary) {
      actions.append(
        createButton({
          label: '看今日清单',
          variant: 'secondary',
          icon: 'calendar',
          onClick: () => complete(true),
        }),
        createButton({
          label: '完成',
          icon: 'check',
          onClick: () => complete(false),
        }),
      );
      return;
    }
    const item = items[step];
    if (!item) return;
    if (step > 0) {
      actions.append(createButton({ label: '上一盒', variant: 'secondary', icon: 'arrow-left', onClick: () => showStep(step - 1, -1) }));
    }
    actions.append(
      createButton({
        label: item.isRest ? '知道了，下一盒' : step === items.length - 1 ? '放好了，完成' : '放好了，下一盒',
        icon: step === items.length - 1 ? 'check' : 'chevron-right',
        onClick: () => showStep(step + 1, 1),
      }),
    );
  }

  quit.onclick = dispose;
  activeSortWizards.add(dispose);
  updateChrome();
  return { close: dispose };
}
