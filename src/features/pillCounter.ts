/**
 * 快速数药片（视觉点选计数 3.0 算法与交互组件）
 *
 * 检测核心在 `pillDetection.ts`：分块中值背景建模 + 感知色距前景 + 封闭孔洞填充 +
 * 连通域距离变换 + 平台峰值合并 + 鞍点校验。纯前端毫秒级执行，
 * 不依赖任何第三方重量级 AI 库，零网络与安装包体积负担。
 */

import { openBottomSheet, type BottomSheetHandle } from '../ui/primitives/BottomSheet';
import { createButton } from '../ui/primitives/Button';
import { el } from '../ui/components';
import {
  detectPillsFromImageData,
  type PillDetectOptions,
  type PillPoint,
} from './pillDetection';

export { detectPillsFromImageData };
export type { PillDetectOptions, PillPoint };

export interface PillCountResult {
  count: number;
  points: PillPoint[];
  width: number;
  height: number;
  elapsedMs: number;
  annotatedDataUrl: string;
}

export interface PillCounterSheetOptions {
  image: Blob | File | string;
  initialPoints?: PillPoint[];
  onConfirm?: (result: PillCountResult) => void | Promise<void>;
  onRetake?: () => void;
  onCancel?: () => void;
}

/**
 * 图像解析辅助函数：将图片源加载至 Canvas 并执行药片检测
 */
export async function countPillsFromImage(
  source: Blob | File | string | HTMLImageElement,
  options: PillDetectOptions = {},
): Promise<PillCountResult> {
  const img = await loadImageElement(source);
  const { width, height } = fitWithin(img, 720);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('无法创建 Canvas 上下文');
  }

  ctx.drawImage(img, 0, 0, width, height);
  const imgData = ctx.getImageData(0, 0, width, height);
  const { points, elapsedMs } = detectPillsFromImageData(imgData, options);

  // 绘制标点图层
  renderPillDotsOnCanvas(ctx, points);
  const annotatedDataUrl = canvas.toDataURL('image/jpeg', 0.85);

  return {
    count: points.length,
    points,
    width,
    height,
    elapsedMs,
    annotatedDataUrl,
  };
}

/**
 * 辅助：在 Canvas 上绘制翠绿打点与序号标注
 */
export function renderPillDotsOnCanvas(
  ctx: CanvasRenderingContext2D,
  points: PillPoint[],
): void {
  points.forEach((pt, index) => {
    const num = index + 1;
    ctx.save();

    // 外层柔和微光晕
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = pt.isManual ? 'rgba(239, 68, 68, 0.35)' : 'rgba(16, 185, 129, 0.35)';
    ctx.fill();

    // 核心圆点
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = pt.isManual ? '#ef4444' : '#10b981';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // 序号
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 8px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(num), pt.x, pt.y);
    ctx.restore();
  });
}

/**
 * 打开交互式数药片底抽屉弹层 (BottomSheet)，支持人机协同增删微调
 */
export async function openPillCounterSheet(
  options: PillCounterSheetOptions,
): Promise<PillCountResult | null> {
  const img = await loadImageElement(options.image);
  const { width: targetW, height: targetH } = fitWithin(img, 640);

  // 底层离屏原始图像
  const rawCanvas = document.createElement('canvas');
  rawCanvas.width = targetW;
  rawCanvas.height = targetH;
  const rawCtx = rawCanvas.getContext('2d')!;
  rawCtx.drawImage(img, 0, 0, targetW, targetH);
  const rawImgData = rawCtx.getImageData(0, 0, targetW, targetH);

  // 初始自动检测
  const detection = options.initialPoints
    ? { points: [...options.initialPoints], elapsedMs: 0 }
    : detectPillsFromImageData(rawImgData);

  let currentPoints: PillPoint[] = detection.points;

  // 界面构建
  const container = el('div', { class: 'pill-counter-sheet space-y-3' });

  // 顶部标题与计数徽标
  const header = el('div', { class: 'flex items-center justify-between pb-2 border-b border-[var(--color-border,#e2e8f0)]' });
  const titleWrap = el('div', {});
  const title = el('h3', { class: 'font-bold text-sm text-[var(--color-text,#0f172a)]', text: '快速数药片' });
  const sub = el('p', { class: 'text-xs text-[var(--color-text-muted,#64748b)] mt-0.5', text: `算法用时 ${(detection.elapsedMs).toFixed(1)}ms · 点击空白处补点，点击圆点删除` });
  titleWrap.append(title, sub);

  const countBadge = el('div', {
    class: 'px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-black text-sm border border-emerald-200 dark:border-emerald-800',
    text: `共 ${currentPoints.length} 粒`,
  });
  header.append(titleWrap, countBadge);

  // 画布容器
  const canvasWrap = el('div', {
    class: 'relative overflow-hidden rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center',
    style: 'max-height: 52dvh;',
  });

  const displayCanvas = el('canvas', {
    class: 'max-w-full block select-none cursor-crosshair',
    style: 'touch-action: none;',
  }) as HTMLCanvasElement;
  displayCanvas.width = targetW;
  displayCanvas.height = targetH;
  const displayCtx = displayCanvas.getContext('2d')!;
  canvasWrap.append(displayCanvas);

  const emptyHint = el('div', {
    class: 'text-xs leading-relaxed text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2',
    text: '没有自动认到药片：把药片摊开、让桌面和药片颜色差别大一点，或直接点画面手动补点。',
  });
  emptyHint.hidden = currentPoints.length > 0;

  const redraw = () => {
    displayCtx.putImageData(rawImgData, 0, 0);
    renderPillDotsOnCanvas(displayCtx, currentPoints);
    countBadge.textContent = `共 ${currentPoints.length} 粒`;
    emptyHint.hidden = currentPoints.length > 0;
    confirmBtn.querySelector('span')!.textContent = `确认数量 (${currentPoints.length}片)`;
  };

  // 画布交互：点击补点 / 删点
  displayCanvas.addEventListener('click', (e) => {
    const rect = displayCanvas.getBoundingClientRect();
    const scaleX = displayCanvas.width / rect.width;
    const scaleY = displayCanvas.height / rect.height;
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;
    // 命中半径按显示比例换算，保证小屏上也有约 14px 的手指热区。
    const hitRadius = Math.max(13, scaleX * 14);

    const hitIndex = currentPoints.findIndex(
      (pt) => Math.hypot(pt.x - clickX, pt.y - clickY) <= hitRadius,
    );

    if (hitIndex >= 0) {
      currentPoints.splice(hitIndex, 1);
    } else {
      currentPoints.push({
        x: Math.round(clickX),
        y: Math.round(clickY),
        id: Date.now(),
        isManual: true,
      });
    }
    redraw();
  });

  // 操作按钮坞
  const actions = el('div', { class: 'grid grid-cols-2 gap-2 pt-1' });

  let sheetHandle: BottomSheetHandle | undefined;

  const confirmBtn = createButton({
    label: `确认数量 (${currentPoints.length}片)`,
    variant: 'primary',
    onClick: async () => {
      sheetHandle?.close();
      const finalResult: PillCountResult = {
        count: currentPoints.length,
        points: currentPoints,
        width: targetW,
        height: targetH,
        elapsedMs: detection.elapsedMs,
        annotatedDataUrl: displayCanvas.toDataURL('image/jpeg', 0.85),
      };
      if (options.onConfirm) {
        await options.onConfirm(finalResult);
      }
    },
  });

  const retakeBtn = createButton({
    label: '重拍/换图',
    variant: 'secondary',
    onClick: () => {
      sheetHandle?.close();
      options.onRetake?.();
    },
  });

  actions.append(retakeBtn, confirmBtn);
  container.append(header, canvasWrap, emptyHint, actions);

  redraw();

  return new Promise<PillCountResult | null>((resolve) => {
    sheetHandle = openBottomSheet({
      label: '快速数药片',
      content: container,
      dismissOnOverlay: true,
      onClose: () => {
        options.onCancel?.();
        resolve(null);
      },
    });
  });
}

function fitWithin(img: HTMLImageElement, maxDim: number): { width: number; height: number } {
  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;
  if (width > maxDim || height > maxDim) {
    if (width >= height) {
      height = Math.round((height * maxDim) / width);
      width = maxDim;
    } else {
      width = Math.round((width * maxDim) / height);
      height = maxDim;
    }
  }
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

function loadImageElement(source: Blob | File | string | HTMLImageElement): Promise<HTMLImageElement> {
  if (source instanceof HTMLImageElement) {
    if (source.complete) return Promise.resolve(source);
    return new Promise((resolve, reject) => {
      source.onload = () => resolve(source);
      source.onerror = reject;
    });
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;

    if (typeof source === 'string') {
      img.src = source;
    } else if (source instanceof Blob) {
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(source);
    }
  });
}
