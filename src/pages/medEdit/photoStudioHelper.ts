import { el, icon, toast } from '../../ui/components';
import { createButton } from '../../ui/primitives/Button';
import { openBottomSheet } from '../../ui/primitives/BottomSheet';
import { openBoxPhotoCropSheet } from '../../ui/BoxPhotoCropSheet';
import { prepareBoxPhoto, getMedPhotoRecord } from '../../features/medPhotos';
import { generateMedPackshot } from '../../features/aiImageStudio';
import { getEffectiveImageGenConfig } from '../../ai/llmConfig';
import { aHash } from '../../features/phash';
import type { Medication } from '../../db/schema';

export interface BoxPhotoStudioOptions {
  med: Medication;
  editing: boolean;
  initialPhoto: Blob | null;
  isActive: () => boolean;
  cleanups: Array<() => void>;
  signal?: AbortSignal;
  getMedName: () => string;
  getDosageText: () => string;
  onPhotoChanged?: (blob: Blob | null, kind: 'original' | 'ai_packshot') => void;
}

export interface BoxPhotoStudioController {
  element: HTMLElement;
  getPendingPhoto: () => Blob | null;
  getPhotoKind: () => 'original' | 'ai_packshot';
  getExistingPhotoBlob: () => Blob | null;
  getOriginalPhoto: () => Blob | null;
  setPendingPhoto: (photo: Blob | null, kind?: 'original' | 'ai_packshot', original?: Blob | null) => void;
}

function setButtonBusy(btn: HTMLButtonElement, text: string): void {
  btn.setAttribute('disabled', 'true');
  btn.replaceChildren();
  btn.append(el('span', { html: text }));
}

function resetIconButton(btn: HTMLButtonElement, iconName: 'sparkles' | 'camera' | 'scan', text: string): void {
  btn.removeAttribute('disabled');
  btn.replaceChildren();
  btn.append(icon(iconName));
  btn.append(el('span', { html: text }));
}

export function buildBoxPhotoStudio(options: BoxPhotoStudioOptions): BoxPhotoStudioController {
  const {
    med,
    editing,
    isActive,
    cleanups,
    signal,
    getMedName,
    getDosageText,
    onPhotoChanged,
  } = options;

  let pendingPhoto: Blob | null = options.initialPhoto;
  let originalPhoto: Blob | null = null;
  let existingPhotoBlob: Blob | null = null;
  let photoKind: 'original' | 'ai_packshot' = 'original';

  const wrap = el('div', { class: 'box-photo-block' });
  const preview = el('button', {
    class: 'box-photo-preview is-empty',
    type: 'button',
    'aria-label': '药盒照片',
  } as any) as HTMLButtonElement;
  const img = el('img', { alt: '药盒照片', hidden: true } as any) as HTMLImageElement;
  const placeholder = el('div', { class: 'box-photo-placeholder' });
  placeholder.append(icon('camera'));
  placeholder.append(el('span', { html: '拍一张药盒正面，之后找药看图就行' }));

  const statusBadge = el('div', { class: 'box-photo-ai-badge', hidden: true });
  preview.append(img, placeholder, statusBadge);

  let localPreviewUrl: string | null = null;
  let hasPhoto = Boolean(pendingPhoto);
  let cropBusy = false;
  let silentGenAbort: AbortController | null = null;
  let isSilentGenBusy = false;

  const showPhoto = (url: string, showOptions: { local?: boolean; isPackshot?: boolean } = {}) => {
    if (localPreviewUrl) {
      URL.revokeObjectURL(localPreviewUrl);
      localPreviewUrl = null;
    }
    if (showOptions.local) localPreviewUrl = url;
    img.src = url;
    img.hidden = false;
    if (showOptions.isPackshot) {
      img.classList.remove('packshot-fade-in');
      void img.offsetWidth;
      img.classList.add('packshot-fade-in');
    }
    preview.classList.remove('is-empty');
    preview.setAttribute('aria-label', '查看药盒照片操作');
    placeholder.hidden = true;
    hasPhoto = true;
    updatePhotoStatusBadges();
    onPhotoChanged?.(pendingPhoto, photoKind);
  };

  cleanups.push(() => {
    if (localPreviewUrl) {
      URL.revokeObjectURL(localPreviewUrl);
      localPreviewUrl = null;
    }
    silentGenAbort?.abort();
  });

  function updatePhotoStatusBadges(): void {
    shootBtn.querySelector('span')!.textContent = hasPhoto ? '重拍药盒' : '拍照/选图';
    if (photoKind === 'ai_packshot') {
      statusBadge.hidden = false;
      statusBadge.className = 'box-photo-ai-badge is-done';
      statusBadge.textContent = '✨ AI 展台大图';
      restoreBtn.hidden = !originalPhoto;
      cropBtn.hidden = false;
      aiGenBtn.querySelector('span')!.textContent = '重新生成大图';
    } else if (hasPhoto) {
      if (originalPhoto && photoKind === 'original') {
        statusBadge.hidden = false;
        statusBadge.className = 'box-photo-ai-badge is-original';
        statusBadge.textContent = '原拍摄照';
      } else {
        statusBadge.hidden = true;
      }
      restoreBtn.hidden = true;
      cropBtn.hidden = false;
      aiGenBtn.querySelector('span')!.textContent = 'AI 生成大图';
    } else {
      statusBadge.hidden = true;
      restoreBtn.hidden = true;
      cropBtn.hidden = true;
      aiGenBtn.querySelector('span')!.textContent = 'AI 生成大图';
    }
  }

  // 编辑已有药或带预填照片时，异步载入当前照片与原图
  if (pendingPhoto) {
    void (async () => {
      try {
        const prepared = await prepareBoxPhoto(pendingPhoto!);
        if (!isActive()) return;
        pendingPhoto = prepared;
        originalPhoto = prepared;
        existingPhotoBlob = prepared;
        showPhoto(URL.createObjectURL(prepared), { local: true });
      } catch {
        if (isActive() && pendingPhoto) showPhoto(URL.createObjectURL(pendingPhoto), { local: true });
      }
    })();
  } else if (editing) {
    void getMedPhotoRecord(med.id).then((record) => {
      if (record && isActive() && !pendingPhoto) {
        photoKind = record.kind || 'original';
        originalPhoto = record.originalBlob || (photoKind === 'original' ? record.blob : null);
        existingPhotoBlob = record.blob;
        showPhoto(URL.createObjectURL(record.blob), { local: true });
        updatePhotoStatusBadges();
      }
    });
  }

  async function getAvailablePhotoBlob(): Promise<Blob | null> {
    if (originalPhoto) return originalPhoto;
    if (pendingPhoto) return pendingPhoto;
    if (existingPhotoBlob) return existingPhotoBlob;
    if (editing) {
      const record = await getMedPhotoRecord(med.id);
      if (record) {
        existingPhotoBlob = record.blob;
        if (!originalPhoto) {
          originalPhoto = record.originalBlob || (record.kind === 'ai_packshot' ? null : record.blob);
        }
        return record.originalBlob || record.blob;
      }
    }
    return null;
  }

  const file = el('input', {
    type: 'file',
    accept: 'image/*',
    style: 'display:none',
  } as any) as HTMLInputElement;
  file.setAttribute('capture', 'environment');

  const shootBtn = el('button', { class: 'btn sm tonal box-photo-btn', type: 'button' } as any);
  shootBtn.append(icon('camera'));
  shootBtn.append(el('span', { html: '拍照/选图' }));
  shootBtn.onclick = () => file.click();

  const restoreBtn = el('button', {
    class: 'btn sm tonal box-photo-btn',
    type: 'button',
    hidden: true,
  } as any) as HTMLButtonElement;
  restoreBtn.append(icon('undo'));
  restoreBtn.append(el('span', { html: '恢复原图' }));
  restoreBtn.onclick = () => {
    if (originalPhoto) {
      pendingPhoto = originalPhoto;
      existingPhotoBlob = originalPhoto;
      photoKind = 'original';
      showPhoto(URL.createObjectURL(originalPhoto), { local: true });
      toast('已恢复为原拍摄照片');
    }
  };

  const aiGenBtn = el('button', {
    class: 'btn sm outlined box-photo-btn',
    type: 'button',
  } as any) as HTMLButtonElement;
  aiGenBtn.append(icon('sparkles'));
  aiGenBtn.append(el('span', { html: 'AI 生成大图' }));
  aiGenBtn.onclick = async () => {
    const photoSource = await getAvailablePhotoBlob();
    const medName = getMedName().trim();
    if (!photoSource && !medName) {
      toast('请先输入药品名称，或拍一张药盒照片');
      file.click();
      return;
    }
    void triggerSilentPackshot(photoSource);
  };

  const cropBtn = el('button', {
    class: 'btn sm outlined box-photo-btn',
    type: 'button',
    hidden: true,
  } as any) as HTMLButtonElement;
  cropBtn.append(icon('scan'));
  cropBtn.append(el('span', { html: '重新裁切' }));
  cropBtn.onclick = () => void cropExistingPhoto();

  async function cropExistingPhoto(): Promise<void> {
    if (cropBusy || !isActive()) return;
    cropBusy = true;
    setButtonBusy(cropBtn, '正在打开…');
    try {
      const source = await getAvailablePhotoBlob();
      if (!isActive()) return;
      if (!source) {
        toast('先拍一张药盒照片');
        return;
      }
      const cropped = await openBoxPhotoCropSheet(source, { signal });
      if (!cropped || !isActive()) return;
      await usePhoto(cropped);
      originalPhoto = cropped;
      existingPhotoBlob = cropped;
      photoKind = 'original';
      updatePhotoStatusBadges();
      toast('已更新裁切照片');
      const imgCfg = getEffectiveImageGenConfig();
      if (imgCfg.isConfigured) {
        void triggerSilentPackshot(cropped);
      }
    } catch (error) {
      if (!isActive()) return;
      console.error('crop box photo failed', error);
      toast('裁切失败，请重试');
    } finally {
      cropBusy = false;
      if (isActive()) resetIconButton(cropBtn, 'scan', '重新裁切');
    }
  }

  async function triggerSilentPackshot(sourceBlob: Blob | null): Promise<void> {
    if (isSilentGenBusy) {
      silentGenAbort?.abort();
    }
    const abort = new AbortController();
    silentGenAbort = abort;
    isSilentGenBusy = true;
    statusBadge.hidden = false;
    statusBadge.className = 'box-photo-ai-badge is-loading';
    statusBadge.textContent = '✨ AI 药盒生成中…';

    try {
      const packshot = await generateMedPackshot({
        photoBlob: sourceBlob || undefined,
        name: getMedName().trim(),
        dosageText: getDosageText().trim(),
        signal: abort.signal,
        onProgress: (step) => {
          if (!isActive() || abort.signal.aborted) return;
          statusBadge.textContent = `✨ ${step}`;
        },
      });
      if (!isActive() || abort.signal.aborted) return;
      pendingPhoto = packshot;
      photoKind = 'ai_packshot';
      if (sourceBlob) originalPhoto = sourceBlob;
      existingPhotoBlob = packshot;
      showPhoto(URL.createObjectURL(packshot), { local: true, isPackshot: true });
      toast('已生成药盒大图，保存后生效');
    } catch (error) {
      if (abort.signal.aborted || !isActive()) return;
      console.error('silent packshot gen failed', error);
      statusBadge.className = 'box-photo-ai-badge is-error';
      statusBadge.textContent = '⚠️ 生成未完成 (已保留原图)';
      updatePhotoStatusBadges();
      const msg = error instanceof Error ? error.message : String(error);
      toast(`药盒生图未完成：${msg}`);
    } finally {
      isSilentGenBusy = false;
    }
  }

  function openPhotoActions(): void {
    if (!hasPhoto) {
      file.click();
      return;
    }
    const buttons: HTMLElement[] = [];

    if (originalPhoto && photoKind === 'ai_packshot') {
      const restore = createButton({
        label: '恢复为原始拍摄照片',
        variant: 'secondary',
        icon: 'undo',
        onClick: () => {
          sheet.close();
          pendingPhoto = originalPhoto;
          existingPhotoBlob = originalPhoto;
          photoKind = 'original';
          showPhoto(URL.createObjectURL(originalPhoto!), { local: true });
          toast('已恢复为原拍摄照片');
        },
      });
      buttons.push(restore);
    }

    const regen = createButton({
      label: '重新增强药盒照片',
      icon: 'sparkles',
      onClick: async () => {
        sheet.close();
        const photoSource = await getAvailablePhotoBlob();
        if (!photoSource) {
          toast('没有可用的原始照片');
          return;
        }
        void triggerSilentPackshot(photoSource);
      },
    });
    buttons.push(regen);

    const retake = createButton({
      label: '重拍/换一张',
      variant: 'secondary',
      icon: 'camera',
      onClick: () => {
        sheet.close();
        file.click();
      },
    });
    buttons.push(retake);

    const recrop = createButton({
      label: '重新裁切原图',
      variant: 'secondary',
      icon: 'scan',
      onClick: () => {
        sheet.close();
        void cropExistingPhoto();
      },
    });
    buttons.push(recrop);

    const cancel = createButton({
      label: '取消',
      variant: 'text',
      onClick: () => sheet.close(),
    });
    buttons.push(cancel);

    const title = el('div', { class: 'big', html: '药盒照片与展台大图' });
    const hint = el('div', {
      class: 'muted',
      html: photoKind === 'ai_packshot'
        ? '当前呈现为纯白底 AI 商业展台大图。可以随时恢复为原始拍摄照片，或再次生成。'
        : '当前呈现为原拍摄照片。可以点击生成 AI 展台大图，或重新拍照/裁切。',
    });
    const actions = el('div', { class: 'box-photo-sheet-actions' }, buttons);
    const sheet = openBottomSheet({
      label: '药盒照片操作',
      content: [title, hint, actions],
      initialFocus: buttons[0] || cancel,
    });
  }

  file.onchange = async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f || !isActive()) return;
    shootBtn.setAttribute('disabled', 'true');
    try {
      await usePhoto(f, true);
      originalPhoto = pendingPhoto;
      existingPhotoBlob = pendingPhoto;
      photoKind = 'original';
      updatePhotoStatusBadges();

      const imgCfg = getEffectiveImageGenConfig();
      if (imgCfg.isConfigured && pendingPhoto) {
        void triggerSilentPackshot(pendingPhoto);
      }
    } catch (error) {
      if (!isActive()) return;
      console.error('prepare photo failed', error);
      toast('照片处理失败，请重拍或用整张图');
    } finally {
      if (isActive()) shootBtn.removeAttribute('disabled');
    }
  };

  async function usePhoto(source: Blob, addIdentityHash = false): Promise<void> {
    const prepared = await prepareBoxPhoto(source);
    if (!isActive()) return;
    pendingPhoto = prepared;
    showPhoto(URL.createObjectURL(prepared), { local: true });
    if (!addIdentityHash) return;
    try {
      const h = await aHash(prepared);
      if (h && isActive() && !med.identity.photoHashes.includes(h)) med.identity.photoHashes.push(h);
    } catch {
      /* ignore */
    }
  }

  preview.onclick = () => openPhotoActions();

  const btnRow = el('div', { class: 'box-photo-actions' });
  btnRow.append(shootBtn, restoreBtn, aiGenBtn, cropBtn);
  wrap.append(preview, btnRow, file);

  return {
    element: wrap,
    getPendingPhoto: () => pendingPhoto,
    getPhotoKind: () => photoKind,
    getExistingPhotoBlob: () => existingPhotoBlob,
    getOriginalPhoto: () => originalPhoto,
    setPendingPhoto: (photo: Blob | null, kind: 'original' | 'ai_packshot' = 'original', original?: Blob | null) => {
      pendingPhoto = photo;
      photoKind = kind;
      if (kind === 'original' && photo) {
        originalPhoto = original || photo;
        existingPhotoBlob = photo;
      } else if (original) {
        originalPhoto = original;
      }
      if (photo) {
        showPhoto(URL.createObjectURL(photo), { local: true, isPackshot: kind === 'ai_packshot' });
      } else {
        if (localPreviewUrl) {
          URL.revokeObjectURL(localPreviewUrl);
          localPreviewUrl = null;
        }
        img.removeAttribute('src');
        img.hidden = true;
        preview.classList.add('is-empty');
        preview.setAttribute('aria-label', '药盒照片');
        placeholder.hidden = false;
        hasPhoto = false;
        updatePhotoStatusBadges();
        onPhotoChanged?.(null, photoKind);
      }
    },
  };
}
