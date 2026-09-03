import {
  type Medication,
  type MedicationOccurrence,
  type MedicationScheduleRevision,
  type Slot,
  SLOT_LABEL,
  formatMealRels,
} from '../db/schema';
import { setOccurrenceAction } from '../db/local';
import { registerRouteTransitionCleanup } from '../router';
import { toast, icon, el, makeAppInert, restoreAppAfterLastDialog, trapFocusIn } from '../ui/components';
import { getOrCreateMed3DImage } from '../features/aiImageGen';
import { floatingPillImg, getTakeMedPill3dSvg, render3dMedia } from './assets3d';

export interface TakeMedModalOptions {
  med: Medication;
  revision: MedicationScheduleRevision;
  occurrence: MedicationOccurrence;
  dueAt: number;
  slot: Slot;
  photoUrl?: string;
  onDone?: () => void;
}

const activeTakeMedModals = new Set<() => void>();

registerRouteTransitionCleanup(() => {
  for (const close of Array.from(activeTakeMedModals)) close();
});

export function openTakeMedModal(options: TakeMedModalOptions): void {
  const { med, revision, occurrence, slot, photoUrl, onDone } = options;

  const overlay = document.createElement('div');
  overlay.className = 'take-med-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'take-med-sheet';

  // 顶部操作栏
  const header = document.createElement('div');
  header.className = 'take-med-header';

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'take-med-back-btn';
  backBtn.append(icon('arrow-left'));
  backBtn.onclick = () => close();

  const title = document.createElement('h2');
  title.className = 'take-med-title';
  title.textContent = '服药';

  const skipBtn = document.createElement('button');
  skipBtn.type = 'button';
  skipBtn.className = 'take-med-skip-btn';
  skipBtn.textContent = '跳过';
  skipBtn.onclick = async () => {
    try {
      await setOccurrenceAction(occurrence, 'skipped');
      toast('已记录为跳过');
      close();
      onDone?.();
    } catch {
      toast('操作失败');
    }
  };

  header.append(backBtn, title, skipBtn);

  // 表盘与 3D 浮动药丸展示区
  const heroCard = document.createElement('div');
  heroCard.className = 'take-med-hero-card';

  const timeEl = document.createElement('div');
  timeEl.className = 'take-med-time';
  timeEl.textContent = revision.timeLocal || '08:00';

  const timeSub = document.createElement('div');
  timeSub.className = 'take-med-timesub';
  const mealText = formatMealRels([...(revision.mealRels || [])]);
  const slotName = SLOT_LABEL[slot] || '用药时间';
  timeSub.textContent = `${slotName}${mealText ? ' · ' + mealText : ''}`;

  const visualContainer = document.createElement('div');
  visualContainer.className = 'take-med-3d-visual';
  visualContainer.append(render3dMedia(floatingPillImg, getTakeMedPill3dSvg, '服药药丸', 'take-med-pill-img'));

  heroCard.append(timeEl, timeSub, visualContainer);

  // 药品信息卡片
  const medCard = document.createElement('div');
  medCard.className = 'take-med-card';

  const photoThumb = document.createElement('div');
  photoThumb.className = 'take-med-thumb';
  if (photoUrl) {
    const img = document.createElement('img');
    img.src = photoUrl;
    img.alt = med.name;
    photoThumb.append(img);
  } else {
    const img3d = document.createElement('img');
    img3d.src = getOrCreateMed3DImage(med.id, med.name, med.amountPerDose || med.dosageText);
    img3d.alt = med.name;
    photoThumb.append(img3d);
  }

  const medInfo = document.createElement('div');
  medInfo.className = 'take-med-info';

  const medName = document.createElement('div');
  medName.className = 'take-med-name';
  medName.textContent = med.name;

  const medMeta = document.createElement('div');
  medMeta.className = 'take-med-meta';
  const dose = med.amountPerDose || med.dosageText || '1片';
  medMeta.textContent = dose;

  const medFreqBadge = document.createElement('span');
  medFreqBadge.className = 'take-med-badge';
  medFreqBadge.textContent = '每日1次';

  medInfo.append(medName, medMeta, medFreqBadge);
  medCard.append(photoThumb, medInfo);

  // 底部行动按钮
  const footer = document.createElement('div');
  footer.className = 'take-med-footer';

  const takeBtn = document.createElement('button');
  takeBtn.type = 'button';
  takeBtn.className = 'take-med-primary-btn';
  takeBtn.append(el('span', { text: '✓ 已服用' }));
  takeBtn.onclick = async () => {
    try {
      takeBtn.disabled = true;
      await setOccurrenceAction(occurrence, 'taken');
      toast('🎉 服药打卡成功！');
      close();
      onDone?.();
    } catch {
      takeBtn.disabled = false;
      toast('打卡失败，请重试');
    }
  };

  footer.append(takeBtn);
  sheet.append(header, heroCard, medCard, footer);
  overlay.append(sheet);

  let closed = false;
  let removeTrap: (() => void) | null = null;
  const close = () => {
    if (closed) return;
    closed = true;
    activeTakeMedModals.delete(close);
    removeTrap?.();
    overlay.classList.add('closing');
    setTimeout(() => {
      overlay.remove();
      restoreAppAfterLastDialog();
    }, 250);
  };
  activeTakeMedModals.add(close);
  makeAppInert();
  removeTrap = trapFocusIn(sheet, close);

  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };

  document.body.append(overlay);
  requestAnimationFrame(() => takeBtn.focus());
}
