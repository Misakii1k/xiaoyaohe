import {
  createDefaultCropCorners,
  detectBoxPhotoCorners,
  isUsableQuad,
  warpPerspectiveQuad,
  type CropCorners,
  type CropPoint,
} from '../features/boxPhotoCrop';
import { createButton } from './primitives/Button';
import { openBottomSheet } from './primitives/BottomSheet';

export interface BoxPhotoCropSheetOptions {
  signal?: AbortSignal;
}

const CORNER_LABELS = ['左上角', '右上角', '右下角', '左下角'] as const;

export function openBoxPhotoCropSheet(
  blob: Blob,
  options: BoxPhotoCropSheetOptions = {},
): Promise<Blob | null> {
  if (options.signal?.aborted) return Promise.resolve(null);

  return new Promise((resolve) => {
    let corners = createDefaultCropCorners();
    let settled = false;
    const objectUrl = URL.createObjectURL(blob);
    const content = document.createElement('div');
    content.className = 'box-photo-crop-editor';

    const header = document.createElement('div');
    header.className = 'box-photo-crop-header';
    const title = document.createElement('strong');
    title.textContent = '裁切药盒图';
    const status = document.createElement('span');
    status.className = 'box-photo-crop-status';
    status.setAttribute('aria-live', 'polite');
    status.textContent = '正在自动找药盒边缘…';
    header.append(title, status);

    const stage = document.createElement('div');
    stage.className = 'box-photo-crop-stage';
    stage.style.setProperty('--box-photo-aspect', '4 / 3');
    const image = document.createElement('img');
    image.alt = '待裁切的药盒照片';
    image.draggable = false;

    const guide = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    guide.classList.add('box-photo-crop-guide');
    guide.setAttribute('viewBox', '0 0 100 100');
    guide.setAttribute('preserveAspectRatio', 'none');
    guide.setAttribute('aria-hidden', 'true');
    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    guide.append(polygon);
    const handles = CORNER_LABELS.map((label, index) => {
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'box-photo-crop-handle';
      handle.setAttribute('aria-label', `调整${label}`);
      handle.title = `拖动或用方向键调整${label}`;
      handle.dataset.corner = String(index);
      handle.addEventListener('pointerdown', (event) => beginDrag(event, index, handle));
      handle.addEventListener('keydown', (event) => moveWithKeyboard(event, index));
      stage.append(handle);
      return handle;
    });
    stage.prepend(image, guide);

    const confirm = createButton({ label: '确认裁切', icon: 'scan' });
    const useWhole = createButton({ label: '用整张图', variant: 'secondary', icon: 'image' });
    const cancel = createButton({ label: '取消', variant: 'text' });
    const actions = document.createElement('div');
    actions.className = 'box-photo-crop-actions';
    actions.append(confirm, useWhole, cancel);
    content.append(header, stage, actions);

    const sheet = openBottomSheet({
      label: '裁切药盒图',
      content,
      initialFocus: confirm,
      onClose: () => finish(null, false),
    });
    sheet.overlay.classList.add('box-photo-crop-overlay');

    const onAbort = () => sheet.close();
    let imageAspect = 4 / 3;
    const syncStageBounds = () => {
      stage.style.maxInlineSize = `${Math.max(1, Math.round(window.innerHeight * 0.62 * imageAspect))}px`;
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    window.addEventListener('resize', syncStageBounds);
    syncStageBounds();
    image.addEventListener('load', () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        imageAspect = image.naturalWidth / image.naturalHeight;
        stage.style.setProperty('--box-photo-aspect', `${image.naturalWidth} / ${image.naturalHeight}`);
        syncStageBounds();
      }
    });
    image.src = objectUrl;

    confirm.addEventListener('click', async () => {
      if (settled) return;
      confirm.disabled = true;
      useWhole.disabled = true;
      const label = confirm.querySelector('span');
      if (label) label.textContent = '正在裁切…';
      status.textContent = '正在生成裁切图…';
      try {
        const cropped = await warpPerspectiveQuad(blob, corners);
        finish(cropped);
      } catch (error) {
        if (settled) return;
        status.textContent = error instanceof Error ? error.message : '裁切失败，请调整四角后重试';
        confirm.disabled = false;
        useWhole.disabled = false;
        if (label) label.textContent = '确认裁切';
      }
    });
    useWhole.addEventListener('click', () => finish(blob));
    cancel.addEventListener('click', () => sheet.close());
    renderCorners();

    void detectBoxPhotoCorners(blob).then((detected) => {
      if (settled) return;
      if (detected) {
        corners = detected;
        status.textContent = '已找到药盒边缘，可拖动四角微调';
      } else {
        status.textContent = '没找准边缘，请拖动四角，或直接用整张图';
      }
      renderCorners();
    }).catch(() => {
      if (!settled) status.textContent = '没找准边缘，请拖动四角，或直接用整张图';
    });

    function finish(result: Blob | null, close = true): void {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', onAbort);
      window.removeEventListener('resize', syncStageBounds);
      URL.revokeObjectURL(objectUrl);
      resolve(result);
      if (close) sheet.close();
    }

    function renderCorners(): void {
      polygon.setAttribute('points', corners.map((point) => `${point.x * 100},${point.y * 100}`).join(' '));
      handles.forEach((handle, index) => {
        handle.style.left = `${corners[index].x * 100}%`;
        handle.style.top = `${corners[index].y * 100}%`;
      });
    }

    function beginDrag(event: PointerEvent, index: number, handle: HTMLButtonElement): void {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const move = (moveEvent: PointerEvent) => {
        const rect = stage.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        updateCorner(index, {
          x: clamp((moveEvent.clientX - rect.left) / rect.width, 0.015, 0.985),
          y: clamp((moveEvent.clientY - rect.top) / rect.height, 0.015, 0.985),
        });
      };
      const stop = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', stop);
        handle.removeEventListener('pointercancel', stop);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', stop);
      handle.addEventListener('pointercancel', stop);
    }

    function moveWithKeyboard(event: KeyboardEvent, index: number): void {
      const direction: Record<string, CropPoint> = {
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
      };
      const delta = direction[event.key];
      if (!delta) return;
      event.preventDefault();
      const step = event.shiftKey ? 0.025 : 0.008;
      updateCorner(index, {
        x: clamp(corners[index].x + delta.x * step, 0.015, 0.985),
        y: clamp(corners[index].y + delta.y * step, 0.015, 0.985),
      });
    }

    function updateCorner(index: number, point: CropPoint): void {
      const next = corners.map((corner) => ({ ...corner })) as CropCorners;
      next[index] = point;
      if (!isUsableQuad(next)) return;
      corners = next;
      status.textContent = '已手动调整裁切范围';
      renderCorners();
    }
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
