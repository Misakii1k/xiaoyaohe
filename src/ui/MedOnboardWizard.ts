// AirPods 连接式「逐个认药」向导：药单识别完成后底部弹卡，
// 逐个展示药名 / 剂型 / 早中晚用量，并顺手拍下药盒照片。
// 照片只在内存中随批次传递，落库发生在批量核对页保存时。
import type { PrescriptionItemDraft } from '../ai/identify';
import { SLOT_LABEL, type MealRel, type Slot } from '../db/schema';
import { compressBoxPhoto } from '../features/medPhotos';
import { registerRouteTransitionCleanup } from '../router';
import { el, icon, SLOT_ICON } from './components';
import { createButton } from './primitives/Button';

export interface MedOnboardWizardOptions {
  /** 走完（或跳过）拍照流程后回调；photos 下标与 items 一一对应 */
  onFinish: (photos: (Blob | undefined)[]) => void;
}

export interface MedOnboardWizardHandle {
  close: () => void;
}

const SLOT_ORDER: readonly Slot[] = ['morning', 'noon', 'evening', 'bedtime'];
const MEAL_LABEL: Record<MealRel, string> = { before: '饭前', with: '随餐', after: '饭后' };
const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const activeWizards = new Set<() => void>();
registerRouteTransitionCleanup(() => {
  for (const dispose of Array.from(activeWizards)) dispose();
});

/** 从规格/用量文案里猜剂型；认不出返回 null（不显示胶囊标签） */
export function doseFormLabel(item: Pick<PrescriptionItemDraft, 'dosageText' | 'amountPerDose'>): string | null {
  const text = `${item.dosageText} ${item.amountPerDose}`;
  if (/胶囊/.test(text)) return '胶囊';
  if (/颗粒|冲剂/.test(text)) return '冲剂';
  if (/片/.test(text)) return '片剂';
  if (/丸/.test(text)) return '丸剂';
  if (/滴/.test(text)) return '滴剂';
  if (/喷/.test(text)) return '喷剂';
  if (/口服液|糖浆|毫升|ml/i.test(text)) return '口服液';
  if (/贴/.test(text)) return '贴剂';
  if (/支|针/.test(text)) return '针剂';
  if (/袋/.test(text)) return '袋装';
  if (/粒/.test(text)) return '胶囊';
  return null;
}

export function openMedOnboardWizard(
  items: readonly PrescriptionItemDraft[],
  options: MedOnboardWizardOptions,
): MedOnboardWizardHandle {
  if (items.length === 0) {
    options.onFinish([]);
    return { close: () => undefined };
  }

  const photos: (Blob | undefined)[] = new Array(items.length).fill(undefined);
  const photoUrls: (string | undefined)[] = new Array(items.length).fill(undefined);
  let step = 0; // 0..items.length-1 为逐药卡，items.length 为总结卡
  let busy = false;
  let disposed = false;

  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;

  const overlay = el('div', { class: 'med-wizard-overlay' });
  overlay.setAttribute('role', 'presentation');
  const sheet = el('section', { class: 'med-wizard' });
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', '逐个认药');
  sheet.tabIndex = -1;

  const grabber = el('div', { class: 'med-wizard-grabber', 'aria-hidden': 'true' } as any);
  const progress = el('div', { class: 'med-wizard-progress' });
  progress.setAttribute('aria-live', 'polite');
  const skipAll = el('button', { class: 'med-wizard-skip', type: 'button', html: '跳过拍照' } as any);
  const head = el('div', { class: 'med-wizard-head' });
  head.append(progress, skipAll);
  const dots = el('div', { class: 'med-wizard-dots', 'aria-hidden': 'true' } as any);
  for (let i = 0; i < items.length; i += 1) dots.append(el('span'));
  const stage = el('div', { class: 'med-wizard-stage' });
  const actions = el('div', { class: 'med-wizard-actions' });

  const fileInput = el('input', { type: 'file', hidden: true } as any) as HTMLInputElement;
  fileInput.accept = 'image/*';
  fileInput.setAttribute('capture', 'environment');

  sheet.append(grabber, head, dots, stage, actions, fileInput);
  overlay.append(sheet);
  document.body.append(overlay);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    activeWizards.delete(dispose);
    document.removeEventListener('keydown', onKeyDown);
    for (const url of photoUrls) if (url) URL.revokeObjectURL(url);
    overlay.remove();
    previouslyFocused?.focus({ preventScroll: true });
  };

  const finish = () => {
    if (disposed) return;
    const result = [...photos];
    dispose();
    options.onFinish(result);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish();
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
    if (event.shiftKey && first && last && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && first && last && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  function renderPhotoZone(zone: HTMLElement, index: number, animate: boolean): void {
    const url = photoUrls[index];
    const item = items[index];
    if (!item) return;
    zone.classList.toggle('has-photo', Boolean(url));
    zone.setAttribute('aria-label', url ? '重拍药盒照片' : '拍摄药盒照片');
    zone.replaceChildren();
    if (url) {
      const img = el('img', { class: 'med-wizard-photo-img' + (animate ? ' is-pop' : ''), alt: `${item.name || '药品'} 药盒照片` });
      img.src = url;
      zone.append(img);
    } else {
      const empty = el('div', { class: 'med-wizard-photo-empty' });
      empty.append(icon('camera'), el('strong', { html: '拍下药盒正面' }), el('span', { html: '下次照着盒子找药更快' }));
      zone.append(empty);
    }
  }

  function buildCard(index: number): HTMLElement {
    const item = items[index];
    if (!item) return el('div', { class: 'med-wizard-card' });
    const card = el('div', { class: 'med-wizard-card' });

    const photoZone = el('button', { class: 'med-wizard-photo', type: 'button' } as any);
    photoZone.onclick = () => fileInput.click();
    renderPhotoZone(photoZone, index, false);

    const name = el('h3', { class: 'med-wizard-name', html: item.name || '未识别药名' });

    const meta = el('div', { class: 'med-wizard-meta' });
    const form = doseFormLabel(item);
    if (form) meta.append(el('span', { class: 'med-wizard-chip', html: form }));
    if (item.dosageText) meta.append(el('span', { class: 'med-wizard-dosage', html: item.dosageText }));

    const slots = el('div', { class: 'med-wizard-slots' });
    for (const slot of SLOT_ORDER) {
      const active = item.slots.includes(slot);
      const cell = el('div', { class: 'med-wizard-slot' + (active ? ' is-active' : '') });
      cell.append(icon(SLOT_ICON[slot]));
      cell.append(el('span', { class: 'med-wizard-slot-name', html: SLOT_LABEL[slot] }));
      if (active) {
        cell.append(el('strong', { class: 'med-wizard-slot-amount', html: item.amountPerDose || '按医嘱' }));
        const meals = (item.mealRelsBySlot[slot] ?? item.mealRels).map((rel) => MEAL_LABEL[rel]).join('·');
        if (meals) cell.append(el('span', { class: 'med-wizard-slot-meal', html: meals }));
      } else {
        cell.append(el('span', { class: 'med-wizard-slot-amount is-none', html: '—' }));
      }
      slots.append(cell);
    }

    card.append(photoZone, name);
    if (meta.childElementCount > 0) card.append(meta);
    card.append(slots);
    if (item.slots.length === 0) {
      card.append(el('p', { class: 'med-wizard-note', html: '药单上没读出服药时间，稍后在核对页补上' }));
    } else if (item.notes) {
      card.append(el('p', { class: 'med-wizard-note', html: item.notes }));
    }
    return card;
  }

  function buildSummary(): HTMLElement {
    const view = el('div', { class: 'med-wizard-summary' });
    const check = el('div', { class: 'med-wizard-check', 'aria-hidden': 'true' } as any);
    check.append(icon('check'));
    const shot = photos.filter(Boolean).length;
    const title = el('h3', { class: 'med-wizard-name', html: `${items.length} 种药都认好了` });
    const sub = el('p', {
      class: 'med-wizard-sub',
      html: shot > 0 ? `已拍 ${shot} 个药盒照片，接下来核对用量并一次保存` : '接下来核对用量并一次保存',
    });
    const list = el('div', { class: 'med-wizard-summary-list' });
    items.forEach((item, index) => {
      const row = el('div', { class: 'med-wizard-summary-row' });
      const thumb = el('span', { class: 'med-wizard-summary-thumb' + (photoUrls[index] ? '' : ' is-placeholder') });
      if (photoUrls[index]) {
        const img = el('img', { alt: '' } as any) as HTMLImageElement;
        img.src = photoUrls[index]!;
        thumb.append(img);
      } else {
        thumb.append(icon('pill'));
      }
      const copy = el('div', { class: 'med-wizard-summary-copy' });
      copy.append(
        el('strong', { html: item.name || '未识别药名' }),
        el('span', { html: item.slots.map((slot) => SLOT_LABEL[slot]).join('、') || '服药时间待补' }),
      );
      row.append(thumb, copy);
      list.append(row);
    });
    view.append(check, title, sub, list);
    return view;
  }

  let currentView = buildCard(0);
  stage.append(currentView);

  function showStep(next: number, direction: 1 | -1): void {
    if (busy || disposed || next === step) return;
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
    progress.textContent = onSummary ? '都认好了' : `第 ${step + 1} 个，共 ${items.length} 个`;
    Array.from(dots.children).forEach((dot, index) => {
      dot.className = index < step ? 'is-done' : index === step ? 'is-current' : '';
    });
    dots.hidden = onSummary;
    skipAll.hidden = onSummary;
    actions.replaceChildren();
    if (onSummary) {
      actions.append(
        createButton({ label: '返回重拍', variant: 'secondary', icon: 'arrow-left', onClick: () => showStep(items.length - 1, -1) }),
        createButton({ label: '去核对保存', icon: 'check', onClick: finish }),
      );
    } else {
      actions.append(
        createButton({
          label: photos[step] ? '重拍一张' : '拍药盒',
          variant: 'secondary',
          icon: 'camera',
          onClick: () => fileInput.click(),
        }),
        createButton({
          label: step === items.length - 1 ? '认完了' : '下一个',
          icon: step === items.length - 1 ? 'check' : 'chevron-right',
          onClick: () => showStep(step + 1, 1),
        }),
      );
    }
  }

  async function acceptPhoto(index: number, file: File): Promise<void> {
    busy = true;
    for (const button of actions.querySelectorAll('button')) button.disabled = true;
    try {
      const blob = await compressBoxPhoto(file);
      if (disposed) return;
      photos[index] = blob;
      const previous = photoUrls[index];
      if (previous) URL.revokeObjectURL(previous);
      photoUrls[index] = URL.createObjectURL(blob);
      if (index === step && currentView.isConnected) {
        const zone = currentView.querySelector<HTMLElement>('.med-wizard-photo');
        if (zone) renderPhotoZone(zone, index, true);
      }
    } finally {
      busy = false;
      if (!disposed) updateChrome();
    }
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file || disposed || step >= items.length) return;
    void acceptPhoto(step, file);
  });

  skipAll.onclick = finish;
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) finish();
  });
  document.addEventListener('keydown', onKeyDown);
  activeWizards.add(dispose);
  updateChrome();
  sheet.focus({ preventScroll: true });
  return { close: dispose };
}
