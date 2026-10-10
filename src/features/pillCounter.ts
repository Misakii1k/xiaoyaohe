/**
 * 快速数药片（视觉点选计数 2.0 算法与交互组件）
 *
 * 采用自适应色差/灰度双极性阈值 + 欧氏距离变换 (Chamfer Distance Transform) + 局部极值点寻峰 (Peak Finding & NMS)。
 * 纯前端毫秒级执行，不依赖任何第三方重量级 AI 库，零网络与安装包体积负担。
 */

import { openBottomSheet, type BottomSheetHandle } from '../ui/primitives/BottomSheet';
import { createButton } from '../ui/primitives/Button';
import { el } from '../ui/components';

export interface PillPoint {
  x: number;
  y: number;
  id: number;
  isManual?: boolean;
}

export interface PillDetectOptions {
  /** 手动敏感度偏移（-50 ~ 50，默认 0） */
  sensitivityOffset?: number;
  /** 最小药片中心间距（像素，默认 8.5） */
  minSpacing?: number;
}

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
 * 核心算法 2.0：从 ImageData 中自适应检测药片中心坐标
 */
export function detectPillsFromImageData(
  imgData: ImageData,
  options: PillDetectOptions = {},
): { points: PillPoint[]; elapsedMs: number; detectedThresh: number } {
  const t0 = performance.now();
  const data = imgData.data;
  const w = imgData.width;
  const h = imgData.height;
  const minSpacing = options.minSpacing ?? 8.5;
  const userOffset = options.sensitivityOffset ?? 0;

  // 1. 直方图统计与背景极性分析
  const lumHist = new Int32Array(256);
  let totalValid = 0;
  let totalLum = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    // 忽略近乎纯黑的边界（信箱黑边）
    if (r < 18 && g < 22 && b < 35) continue;
    const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    lumHist[lum]! += 1;
    totalValid += 1;
    totalLum += lum;
  }

  const avgLum = totalValid > 0 ? totalLum / totalValid : 128;
  const isLightBackground = avgLum > 200; // 纯白纸/白背景上倒深色药片

  let finalThresh = 175;
  if (isLightBackground) {
    // 浅色背景检测深色药片：寻找低亮度分位数
    let cum = 0;
    for (let l = 0; l <= 200; l++) {
      cum += lumHist[l]!;
      if (cum / (totalValid || 1) >= 0.08) {
        finalThresh = Math.min(185, l);
        break;
      }
    }
    finalThresh = Math.max(30, Math.min(220, finalThresh + userOffset));
  } else {
    // 常见场景：暗色/纸板/桌面背景检测亮色药片，寻找高亮度分位数
    let cum = 0;
    for (let l = 255; l >= 100; l--) {
      cum += lumHist[l]!;
      if (cum / (totalValid || 1) >= 0.08) {
        finalThresh = Math.max(160, l);
        break;
      }
    }
    finalThresh = Math.max(60, Math.min(240, finalThresh + userOffset));
  }

  // 2. 生成二值化掩膜 (边缘安全内缩 6px 防边框光晕)
  const binary = new Uint8Array(w * h);
  for (let y = 6; y < h - 6; y++) {
    for (let x = 6; x < w - 6; x++) {
      const i = (y * w + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      if (r < 18 && g < 22 && b < 35) continue;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const isForeground = isLightBackground ? lum <= finalThresh : lum >= finalThresh;
      if (isForeground) {
        binary[y * w + x] = 1;
      }
    }
  }

  // 3. 欧氏距离变换 (Chamfer 近似算法，2-Pass 扫描)
  const dist = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (binary[idx] === 0) {
        dist[idx] = 0;
      } else {
        let d = 9999;
        if (x > 0) d = Math.min(d, dist[idx - 1]! + 1);
        if (y > 0) d = Math.min(d, dist[idx - w]! + 1);
        if (x > 0 && y > 0) d = Math.min(d, dist[idx - w - 1]! + 1.414);
        if (x < w - 1 && y > 0) d = Math.min(d, dist[idx - w + 1]! + 1.414);
        dist[idx] = Math.min(d, 9999);
      }
    }
  }

  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const idx = y * w + x;
      if (binary[idx] !== 0) {
        let d = dist[idx]!;
        if (x < w - 1) d = Math.min(d, dist[idx + 1]! + 1);
        if (y < h - 1) d = Math.min(d, dist[idx + w]! + 1);
        if (x < w - 1 && y < h - 1) d = Math.min(d, dist[idx + w + 1]! + 1.414);
        if (x > 0 && y < h - 1) d = Math.min(d, dist[idx + w - 1]! + 1.414);
        dist[idx] = d;
      }
    }
  }

  // 4. 局部极值点搜索 (Peak Finding)
  const peaks: Array<{ x: number; y: number; d: number }> = [];
  const R = 4;
  for (let y = R; y < h - R; y++) {
    for (let x = R; x < w - R; x++) {
      const idx = y * w + x;
      const d = dist[idx]!;
      if (d >= 2.8) {
        let isPeak = true;
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (dist[(y + dy) * w + (x + dx)]! > d) {
              isPeak = false;
              break;
            }
          }
          if (!isPeak) break;
        }
        if (isPeak) peaks.push({ x, y, d });
      }
    }
  }

  // 5. 非极大值抑制 (NMS 最小药片中心间距)
  const points: PillPoint[] = [];
  peaks.sort((a, b) => b.d - a.d);
  for (const p of peaks) {
    if (!points.some((fp) => Math.hypot(fp.x - p.x, fp.y - p.y) < minSpacing)) {
      points.push({
        x: p.x,
        y: p.y,
        id: points.length + 1,
        isManual: false,
      });
    }
  }

  const elapsedMs = performance.now() - t0;
  return { points, elapsedMs, detectedThresh: finalThresh };
}

/**
 * 图像解析辅助函数：将图片源加载至 Canvas 并执行药片检测
 */
export async function countPillsFromImage(
  source: Blob | File | string | HTMLImageElement,
  options: PillDetectOptions = {},
): Promise<PillCountResult> {
  const img = await loadImageElement(source);
  // 约束最长边至 720px，保证算法距离参数的稳定与毫秒级速度
  const maxDim = 720;
  let targetW = img.naturalWidth || img.width;
  let targetH = img.naturalHeight || img.height;
  if (targetW > maxDim || targetH > maxDim) {
    if (targetW >= targetH) {
      targetH = Math.round((targetH * maxDim) / targetW);
      targetW = maxDim;
    } else {
      targetW = Math.round((targetW * maxDim) / targetH);
      targetH = maxDim;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('无法创建 Canvas 上下文');
  }

  ctx.drawImage(img, 0, 0, targetW, targetH);
  const imgData = ctx.getImageData(0, 0, targetW, targetH);
  const { points, elapsedMs } = detectPillsFromImageData(imgData, options);

  // 绘制标点图层
  renderPillDotsOnCanvas(ctx, points);
  const annotatedDataUrl = canvas.toDataURL('image/jpeg', 0.85);

  return {
    count: points.length,
    points,
    width: targetW,
    height: targetH,
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
  const maxDim = 640;
  let targetW = img.naturalWidth || img.width;
  let targetH = img.naturalHeight || img.height;
  if (targetW > maxDim || targetH > maxDim) {
    if (targetW >= targetH) {
      targetH = Math.round((targetH * maxDim) / targetW);
      targetW = maxDim;
    } else {
      targetW = Math.round((targetW * maxDim) / targetH);
      targetH = maxDim;
    }
  }

  // 底层离屏原始图像
  const rawCanvas = document.createElement('canvas');
  rawCanvas.width = targetW;
  rawCanvas.height = targetH;
  const rawCtx = rawCanvas.getContext('2d')!;
  rawCtx.drawImage(img, 0, 0, targetW, targetH);
  const rawImgData = rawCtx.getImageData(0, 0, targetW, targetH);

  // 初始自动检测
  const { points: autoPoints, elapsedMs } = options.initialPoints
    ? { points: [...options.initialPoints], elapsedMs: 0 }
    : detectPillsFromImageData(rawImgData);

  let currentPoints: PillPoint[] = autoPoints;

  // 界面构建
  const container = el('div', { class: 'pill-counter-sheet space-y-3' });

  // 顶部标题与计数徽标
  const header = el('div', { class: 'flex items-center justify-between pb-2 border-b border-[var(--color-border,#e2e8f0)]' });
  const titleWrap = el('div', {});
  const title = el('h3', { class: 'font-bold text-sm text-[var(--color-text,#0f172a)]', text: '快速数药片' });
  const sub = el('p', { class: 'text-xs text-[var(--color-text-muted,#64748b)] mt-0.5', text: `算法用时 ${(elapsedMs).toFixed(1)}ms · 点击空白处补点，点击圆点删除` });
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

  const redraw = () => {
    displayCtx.putImageData(rawImgData, 0, 0);
    renderPillDotsOnCanvas(displayCtx, currentPoints);
    countBadge.textContent = `共 ${currentPoints.length} 粒`;
    confirmBtn.querySelector('span')!.textContent = `确认数量 (${currentPoints.length}片)`;
  };

  // 画布交互：点击补点 / 删点
  displayCanvas.addEventListener('click', (e) => {
    const rect = displayCanvas.getBoundingClientRect();
    const scaleX = displayCanvas.width / rect.width;
    const scaleY = displayCanvas.height / rect.height;
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    const hitIndex = currentPoints.findIndex(
      (pt) => Math.hypot(pt.x - clickX, pt.y - clickY) <= 13,
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
        elapsedMs,
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
  container.append(header, canvasWrap, actions);

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
