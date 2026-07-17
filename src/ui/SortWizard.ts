// 按顺序分药向导：一盒一盒弹卡展示「药盒长什么样、放哪些格、每格几粒」，
// 长辈照着做即可；不改任何数据，纯引导。复用 med-wizard 的底部弹卡样式。
import { SLOT_LABEL, formatMealRels, type MealRel, type Medication, type Slot } from '../db/schema';
import { registerRouteTransitionCleanup, navigate } from '../router';
import { el, icon, banner, SLOT_ICON } from './components';
import { createButton } from './primitives/Button';
import { doseFormLabel } from './MedOnboardWizard';

export interface SortWizardEntry {
  slot: Slot;
  timeLocal: string;
  /** 每格放多少：结构化剂量或自由文本，空串显示“按医嘱” */
  doseLabel: string;
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

export interface SortWizardHandle {
  close: () => void;
}

const SLOT_ORDER: readonly Slot[] = ['morning', 'noon', 'evening', 'bedtime'];
const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const activeSortWizards = new Set<() => void>();
registerRouteTransitionCleanup(() => {
  for (const dispose of Array.from(activeSortWizards)) dispose();
});

export function openSortWizard(items: readonly SortWizardItem[]): SortWizardHandle {
  if (items.length === 0) return { close: () => undefined };

  let step = 0; // 0..items.length-1 为逐盒卡，items.length 为完成卡
  let disposed = false;
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;

  const overlay = el('div', { class: 'med-wizard-overlay' });
  overlay.setAttribute('role', 'presentation');
  const sheet = el('section', { class: 'med-wizard' });
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', '按顺序分药');
  sheet.tabIndex = -1;

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
  overlay.append(sheet);
  document.body.append(overlay);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    activeSortWizards.delete(dispose);
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
    previouslyFocused?.focus({ preventScroll: true });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dispose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(sheet.querySelectorAll<HTMLElement>(focusableSelector))
      .filter((element) => !element.hasAttribute('disabled') && !element.hidden);
    if (focusable.length === 0) {
      event.preventDefault();
      sheet.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  function buildCard(index: number): HTMLElement {
    const item = items[index];
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
    const sorted = items.filter((item) => !item.isRest).length;
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
          onClick: () => {
            dispose();
            navigate('/today');
          },
        }),
        createButton({ label: '完成', icon: 'check', onClick: dispose }),
      );
      return;
    }
    const item = items[step];
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
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) dispose();
  });
  document.addEventListener('keydown', onKeyDown);
  activeSortWizards.add(dispose);
  updateChrome();
  sheet.focus({ preventScroll: true });
  return { close: dispose };
}
