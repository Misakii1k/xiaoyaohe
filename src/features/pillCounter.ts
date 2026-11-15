/**
 * 快速数药片 4.0（云端视觉定位 + 本地样本校准 + 整板网格 + 交互式微调抽屉）
 */

import '../ui/styles/pages/pill-counter.css';
import { CLOUD_ORIGIN } from '../sync/lan/apkTransport';
import { grantAiConsentForOrigins } from '../ai/consent';
import { el, toast } from '../ui/components';
import { openBottomSheet, type BottomSheetHandle } from '../ui/primitives/BottomSheet';
import { createButton } from '../ui/primitives/Button';
import { createSegmentedControl } from '../ui/primitives/SegmentedControl';
import { createStepper } from '../ui/primitives/Stepper';
import {
  clusterPillAppearances,
  detectPillsFromImageData,
  detectPillsFromSample,
  evaluateBlisterGrid,
  type PillDetectOptions,
} from './pillDetection';
import {
  DEFAULT_PILL_IMAGE_MAX_DIM,
  fitDimensionsWithin,
  preparePillImage,
  runPillDetectionPipeline,
  type PillImageSource,
  type PreparedPillImage,
} from './pillCounterClient';
import type {
  PillAppearanceCluster,
  PillDetectionEngineKind,
  PillDetectionMode,
  PillGridConfig,
  PillPoint,
  PillROI,
} from './pillEngine';

export { detectPillsFromImageData };
export type { PillDetectOptions, PillPoint };

export interface PillCountResult {
  count: number;
  points: PillPoint[];
  width: number;
  height: number;
  elapsedMs: number;
  annotatedDataUrl: string;
  mode?: PillDetectionMode;
  engine?: PillDetectionEngineKind;
  clusters?: PillAppearanceCluster[];
}

export interface PillCounterSheetOptions {
  image: PillImageSource;
  initialPoints?: PillPoint[];
  mode?: PillDetectionMode;
  allowCloud?: boolean;
  onConfirm?: (result: PillCountResult) => void | Promise<void>;
  onRetake?: () => void;
  onCancel?: () => void;
}

type ToolMode = 'tap' | 'sample' | 'roi' | 'grid';

interface CounterSnapshot {
  points: PillPoint[];
  sampleSeeds: Array<{ x: number; y: number }>;
  roi: PillROI | null;
  grid: PillGridConfig | null;
  engine: PillDetectionEngineKind;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function clonePoints(points: readonly PillPoint[]): PillPoint[] {
  return points.map((p) => ({
    ...p,
    box: p.box ? { ...p.box } : undefined,
  }));
}

function cloneGrid(grid: PillGridConfig | null): PillGridConfig | null {
  if (!grid) return null;
  return {
    rows: grid.rows,
    cols: grid.cols,
    corners: [
      { ...grid.corners[0] },
      { ...grid.corners[1] },
      { ...grid.corners[2] },
      { ...grid.corners[3] },
    ],
    cells: [...grid.cells],
  };
}

function gridCellCenters(grid: PillGridConfig): Array<{ r: number; c: number; x: number; y: number }> {
  const [tl, tr, br, bl] = grid.corners;
  const out: Array<{ r: number; c: number; x: number; y: number }> = [];
  for (let r = 0; r < grid.rows; r += 1) {
    const v = (r + 0.5) / grid.rows;
    for (let c = 0; c < grid.cols; c += 1) {
      const u = (c + 0.5) / grid.cols;
      const wTL = (1 - u) * (1 - v);
      const wTR = u * (1 - v);
      const wBR = u * v;
      const wBL = (1 - u) * v;
      out.push({
        r,
        c,
        x: Math.round(tl.x * wTL + tr.x * wTR + br.x * wBR + bl.x * wBL),
        y: Math.round(tl.y * wTL + tr.y * wTR + br.y * wBR + bl.y * wBL),
      });
    }
  }
  return out;
}

function pointsFromGrid(grid: PillGridConfig): PillPoint[] {
  const centers = gridCellCenters(grid);
  const pts: PillPoint[] = [];
  let idCounter = 1;
  for (let i = 0; i < centers.length; i += 1) {
    if (!grid.cells[i]) continue;
    const cell = centers[i]!;
    pts.push({ id: idCounter++, x: cell.x, y: cell.y, isManual: false });
  }
  return pts;
}

/**
 * 图像解析辅助函数：将图片源加载至 Canvas 并执行本地轻量检测（供测试与无交互快速调用）
 */
export async function countPillsFromImage(
  source: PillImageSource,
  options: PillDetectOptions = {},
): Promise<PillCountResult> {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const prepared = await preparePillImage(source, { maxDim: 720 });
  const { width, height } = fitDimensionsWithin(prepared.width, prepared.height, 720);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('无法创建 Canvas 上下文');
  }

  if (prepared.canvas) {
    ctx.drawImage(prepared.canvas, 0, 0, width, height);
  } else {
    ctx.putImageData(prepared.rawImgData, 0, 0);
  }
  const imgData =
    width === prepared.width && height === prepared.height
      ? prepared.rawImgData
      : ctx.getImageData(0, 0, width, height);

  const { points, elapsedMs } = detectPillsFromImageData(imgData, options);
  renderPillDotsOnCanvas(ctx, points);
  const annotatedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
  const totalElapsed =
    elapsedMs || (typeof performance !== 'undefined' ? performance.now() - started : 0);

  return {
    count: points.length,
    points,
    width,
    height,
    elapsedMs: totalElapsed,
    annotatedDataUrl,
  };
}

/**
 * 在 Canvas 上绘制自适应大小的标点与序号，点数密集时自动收缩半径以免遮挡邻近药片
 */
export function renderPillDotsOnCanvas(
  ctx: CanvasRenderingContext2D,
  points: readonly PillPoint[],
): void {
  const dense = points.length > 25;
  const canvasWidth = ctx.canvas?.width || 640;
  const resScale = clamp(canvasWidth / 640, 0.85, 1.35);
  const haloR = (dense ? 7.5 : 10) * resScale;
  const dotR = (dense ? 5 : 6.5) * resScale;
  const fontSize = Math.round((dense ? 7 : 8.5) * resScale);

  points.forEach((pt, index) => {
    const num = index + 1;
    ctx.save();

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, haloR, 0, Math.PI * 2);
    ctx.fillStyle = pt.isManual ? 'rgba(239, 68, 68, 0.32)' : 'rgba(16, 185, 129, 0.32)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, dotR, 0, Math.PI * 2);
    ctx.fillStyle = pt.isManual ? '#ef4444' : '#10b981';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(num), pt.x, pt.y);
    ctx.restore();
  });
}

function renderBlisterGridOverlay(
  ctx: CanvasRenderingContext2D,
  grid: PillGridConfig,
): void {
  const [tl, tr, br, bl] = grid.corners;
  const interp = (u: number, v: number) => ({
    x:
      tl.x * (1 - u) * (1 - v) +
      tr.x * u * (1 - v) +
      br.x * u * v +
      bl.x * (1 - u) * v,
    y:
      tl.y * (1 - u) * (1 - v) +
      tr.y * u * (1 - v) +
      br.y * u * v +
      bl.y * (1 - u) * v,
  });

  ctx.save();
  ctx.strokeStyle = 'rgba(124, 58, 237, 0.85)';
  ctx.lineWidth = 1.6;
  for (let r = 0; r <= grid.rows; r += 1) {
    const a = interp(0, r / grid.rows);
    const b = interp(1, r / grid.rows);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (let c = 0; c <= grid.cols; c += 1) {
    const a = interp(c / grid.cols, 0);
    const b = interp(c / grid.cols, 1);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // Empty pockets show subtle dashed markers so users can tap to toggle
  const centers = gridCellCenters(grid);
  centers.forEach((cell, idx) => {
    if (grid.cells[idx]) return;
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cell.x, cell.y, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });

  // Draggable corner handles
  for (const corner of grid.corners) {
    ctx.beginPath();
    ctx.arc(corner.x, corner.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#7c3aed';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}

function renderRoiOverlay(
  ctx: CanvasRenderingContext2D,
  roi: PillROI,
): void {
  ctx.save();
  ctx.strokeStyle = '#7c3aed';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(roi.x, roi.y, roi.width, roi.height);
  ctx.fillStyle = 'rgba(124, 58, 237, 0.08)';
  ctx.fillRect(roi.x, roi.y, roi.width, roi.height);
  ctx.restore();
}

/**
 * 打开交互式数药片底抽屉弹层，支持云端定位 / 离线点样本校准 / 药板透视网格 / 双指缩放 / 框选重数
 */
export async function openPillCounterSheet(
  options: PillCounterSheetOptions,
): Promise<PillCountResult | null> {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const prepared: PreparedPillImage = await preparePillImage(options.image, {
    maxDim: DEFAULT_PILL_IMAGE_MAX_DIM,
  });

  let mode: PillDetectionMode = options.mode ?? 'loose';
  let currentPoints: PillPoint[];
  let currentEngine: PillDetectionEngineKind = 'heuristic_local';
  let currentClusters: PillAppearanceCluster[] = [];
  let consentNeeded = false;
  let statusNote: string | undefined;

  if (options.initialPoints) {
    currentPoints = clonePoints(options.initialPoints);
    currentClusters = clusterPillAppearances(prepared.rawImgData, currentPoints);
  } else {
    const initial = await runPillDetectionPipeline({
      source: prepared,
      mode,
      allowCloud: options.allowCloud,
    });
    currentPoints = clonePoints(initial.points);
    currentEngine = initial.engine;
    currentClusters = initial.clusters ?? [];
    consentNeeded = Boolean(initial.consentNeeded);
    statusNote = initial.degradedReason;
  }

  let tool: ToolMode = 'tap';
  let sampleSeeds: Array<{ x: number; y: number }> = [];
  let roiRect: PillROI | null = null;
  let draftRoi: PillROI | null = null;
  let gridConfig: PillGridConfig | null = null;
  let gridEnabled = false;
  let hideOverlay = false;
  let isBusy = false;

  const undoStack: CounterSnapshot[] = [];
  const pushUndo = () => {
    undoStack.push({
      points: clonePoints(currentPoints),
      sampleSeeds: sampleSeeds.map((s) => ({ ...s })),
      roi: roiRect ? { ...roiRect } : null,
      grid: cloneGrid(gridConfig),
      engine: currentEngine,
    });
    if (undoStack.length > 30) undoStack.shift();
  };

  let zoom = 1;
  let panX = 0;
  let panY = 0;

  const container = el('div', { class: 'pill-counter-sheet' });

  // 1. 顶部标题与状态提示
  const header = el('div', { class: 'pill-counter-header' });
  const titleWrap = el('div', { class: 'pill-counter-title-wrap' });
  const title = el('h3', { class: 'pill-counter-title', text: '数药片清点' });
  const sub = el('p', { class: 'pill-counter-sub' });
  titleWrap.append(title, sub);

  const countBadge = el('div', {
    class: 'pill-counter-count',
    text: `共 ${currentPoints.length} 粒`,
  });
  header.append(titleWrap, countBadge);

  // 2. 模式切换 + 视图还原
  const modeRow = el('div', { class: 'pill-counter-mode-row' });
  const resetZoomBtn = el('button', {
    type: 'button',
    class: 'pill-tool-btn pill-reset-zoom-btn',
    text: '还原视图',
  }) as HTMLButtonElement;
  resetZoomBtn.hidden = true;

  // 3. 非阻塞云端授权引导条
  const consentBanner = el('div', { class: 'pill-counter-consent-banner' });
  const consentText = el('span', {
    class: 'pill-counter-consent-text',
    text: '开启云端识别可显著提高散落混装与整板准确率',
  });
  const enableCloudBtn = el('button', {
    type: 'button',
    class: 'pill-counter-consent-btn',
    text: '开启云端识别',
  }) as HTMLButtonElement;
  consentBanner.append(consentText, enableCloudBtn);
  consentBanner.hidden = !consentNeeded;

  // 4. 混装外观汇总条
  const clusterStrip = el('div', { class: 'pill-counter-clusters' });

  // 5. 可缩放画布区域
  const canvasWrap = el('div', { class: 'pill-counter-canvas-wrap' });
  const stage = el('div', { class: 'pill-counter-stage' });
  const displayCanvas = el('canvas', {
    class: 'pill-counter-canvas',
  }) as HTMLCanvasElement;
  displayCanvas.width = prepared.width;
  displayCanvas.height = prepared.height;
  const displayCtx = displayCanvas.getContext('2d');
  if (!displayCtx) {
    throw new Error('无法创建 Canvas 上下文');
  }
  stage.append(displayCanvas);
  canvasWrap.append(stage);

  // 6. 工具模式栏 + 辅助子条
  const toolBar = el('div', { class: 'pill-counter-tools' });
  const tapToolBtn = el('button', {
    type: 'button',
    class: 'pill-tool-btn is-active',
    text: '点选增删',
  }) as HTMLButtonElement;
  const sampleToolBtn = el('button', {
    type: 'button',
    class: 'pill-tool-btn',
    text: '点样本校准',
  }) as HTMLButtonElement;
  const roiToolBtn = el('button', {
    type: 'button',
    class: 'pill-tool-btn',
    text: '框选范围',
  }) as HTMLButtonElement;
  const gridToolBtn = el('button', {
    type: 'button',
    class: 'pill-tool-btn',
    text: '药板网格',
  }) as HTMLButtonElement;
  gridToolBtn.hidden = mode !== 'blister';

  const holdPreviewBtn = el('button', {
    type: 'button',
    class: 'pill-tool-btn',
    text: '长按看原图',
  }) as HTMLButtonElement;

  const undoBtn = el('button', {
    type: 'button',
    class: 'pill-tool-btn',
    text: '撤销',
  }) as HTMLButtonElement;
  undoBtn.disabled = true;

  toolBar.append(
    tapToolBtn,
    sampleToolBtn,
    roiToolBtn,
    gridToolBtn,
    holdPreviewBtn,
    undoBtn,
  );

  // 子控制区：ROI 框选重算操作 / 药板行列步进器
  const roiSubBar = el('div', { class: 'pill-sub-controls' });
  const roiRecountBtn = el('button', {
    type: 'button',
    class: 'pill-tool-btn is-primary',
    text: '仅数框内',
  }) as HTMLButtonElement;
  const roiClearBtn = el('button', {
    type: 'button',
    class: 'pill-tool-btn',
    text: '清除框选',
  }) as HTMLButtonElement;
  roiSubBar.append(
    el('span', { class: 'pill-sub-hint', text: '在图上拖出方框后点击仅数框内' }),
    roiRecountBtn,
    roiClearBtn,
  );
  roiSubBar.hidden = true;

  const gridSubBar = el('div', { class: 'pill-sub-controls pill-grid-controls' });
  const rowStepper = createStepper({ value: 2, min: 1, max: 15, ariaLabel: '药板行数' });
  const colStepper = createStepper({ value: 5, min: 1, max: 15, ariaLabel: '药板列数' });
  rowStepper.root.dataset.gridRows = '1';
  colStepper.root.dataset.gridCols = '1';
  gridSubBar.append(
    el('span', { class: 'pill-sub-label', text: '行' }),
    rowStepper.root,
    el('span', { class: 'pill-sub-label', text: '列' }),
    colStepper.root,
  );
  gridSubBar.hidden = true;

  const emptyHint = el('div', {
    class: 'pill-counter-empty',
    text: '暂无标记：可轻触药片补点，或点一下「点样本校准」点中一颗同类药片。',
  });

  // 7. 底部确认与重拍
  const actions = el('div', { class: 'pill-counter-actions' });
  let sheetHandle: BottomSheetHandle | undefined;
  let settledByAction = false;

  const confirmBtn = createButton({
    label: `确认 ${currentPoints.length} 片`,
    variant: 'primary',
    onClick: async () => {
      settledByAction = true;
      // Draw clean final dots without temporary overlays before snapshot
      hideOverlay = false;
      displayCtx.putImageData(prepared.rawImgData, 0, 0);
      renderPillDotsOnCanvas(displayCtx, currentPoints);
      const annotatedDataUrl = displayCanvas.toDataURL('image/jpeg', 0.85);
      const elapsed =
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
      const finalResult: PillCountResult = {
        count: currentPoints.length,
        points: clonePoints(currentPoints),
        width: prepared.width,
        height: prepared.height,
        elapsedMs: elapsed,
        annotatedDataUrl,
        mode,
        engine: currentEngine,
        clusters: currentClusters,
      };
      sheetHandle?.close();
      if (options.onConfirm) {
        await options.onConfirm(finalResult);
      }
      resolvePromise?.(finalResult);
    },
  });

  const retakeBtn = createButton({
    label: '重拍/换图',
    variant: 'secondary',
    onClick: () => {
      settledByAction = true;
      sheetHandle?.close();
      options.onRetake?.();
      resolvePromise?.(null);
    },
  });

  actions.append(retakeBtn, confirmBtn);

  // 状态刷新函数
  const updateViewportTransform = () => {
    stage.style.transform = `translate3d(${Math.round(panX)}px, ${Math.round(panY)}px, 0) scale(${zoom.toFixed(3)})`;
    resetZoomBtn.hidden = zoom <= 1.02;
  };

  const describeStatus = (): string => {
    if (isBusy) return '正在识别分析…';
    if (tool === 'sample') return '点一下你想数的那种药片，系统会圈出同类；点多颗可兼顾混装';
    if (tool === 'roi') return '在图上拖出需要清点的方框区域，再点下方「仅数框内」';
    if (tool === 'grid' && gridEnabled) return '拖动四角对齐药板边缘，轻触单元格可切换有药/空泡';
    if (currentEngine === 'cloud') return '云端高清识别 · 点空白补点，点标记删除，双指可缩放';
    if (currentEngine === 'sample_local') return '已按样本颜色重算 · 可继续补点或微调';
    if (currentEngine === 'blister_grid') return '已按药板网格统计 · 点网格可单独切换有药或空泡';
    if (statusNote) return `${statusNote} · 点画面可补点或删点`;
    return '点空白补点，点圆点删除 · 双指捏合可放大细看';
  };

  const syncToolButtons = () => {
    tapToolBtn.classList.toggle('is-active', tool === 'tap');
    sampleToolBtn.classList.toggle('is-active', tool === 'sample');
    roiToolBtn.classList.toggle('is-active', tool === 'roi');
    gridToolBtn.classList.toggle('is-active', tool === 'grid' && gridEnabled);
    gridToolBtn.hidden = mode !== 'blister';
    roiSubBar.hidden = tool !== 'roi' && roiRect === null;
    roiRecountBtn.disabled = !roiRect;
    roiClearBtn.hidden = !roiRect;
    gridSubBar.hidden = !(mode === 'blister' && gridEnabled);
    undoBtn.disabled = undoStack.length === 0;
  };

  const renderClusters = () => {
    clusterStrip.replaceChildren();
    if (currentClusters.length < 2) {
      clusterStrip.hidden = true;
      return;
    }
    clusterStrip.hidden = false;
    for (const c of currentClusters) {
      const chip = el('span', { class: 'pill-cluster-chip' });
      const dot = el('span', { class: 'pill-cluster-swatch' });
      dot.style.backgroundColor = c.swatch;
      chip.append(dot, el('span', { text: `${c.label} ${c.count}` }));
      clusterStrip.append(chip);
    }
  };

  const redraw = () => {
    displayCtx.putImageData(prepared.rawImgData, 0, 0);
    if (!hideOverlay) {
      if (draftRoi || roiRect) {
        renderRoiOverlay(displayCtx, draftRoi ?? roiRect!);
      }
      if (mode === 'blister' && gridEnabled && gridConfig) {
        renderBlisterGridOverlay(displayCtx, gridConfig);
      }
      renderPillDotsOnCanvas(displayCtx, currentPoints);
    }
    countBadge.textContent = `共 ${currentPoints.length} 粒`;
    sub.textContent = describeStatus();
    emptyHint.hidden = currentPoints.length > 0;
    const labelSpan = confirmBtn.querySelector('span');
    if (labelSpan) labelSpan.textContent = `确认 ${currentPoints.length} 片`;
    renderClusters();
    syncToolButtons();
  };

  const applyBlisterGridEvaluation = (saveUndo = false) => {
    const rows = clamp(Number(rowStepper.input.value) || 2, 1, 15);
    const cols = clamp(Number(colStepper.input.value) || 5, 1, 15);
    if (saveUndo) pushUndo();
    const res = evaluateBlisterGrid(prepared.rawImgData, {
      rows,
      cols,
      corners: gridConfig?.corners,
    });
    gridConfig = res.grid;
    currentPoints = res.points;
    currentEngine = 'blister_grid';
    currentClusters = clusterPillAppearances(prepared.rawImgData, currentPoints);
    redraw();
  };

  const runCloudOrModePipeline = async (opts: { roi?: PillROI; pushHistory?: boolean } = {}) => {
    isBusy = true;
    sub.textContent = describeStatus();
    try {
      const res = await runPillDetectionPipeline({
        source: prepared,
        mode,
        roi: opts.roi,
        allowCloud: options.allowCloud,
      });
      if (opts.pushHistory) pushUndo();
      currentPoints = clonePoints(res.points);
      currentEngine = res.engine;
      currentClusters = res.clusters ?? [];
      consentNeeded = Boolean(res.consentNeeded);
      consentBanner.hidden = !consentNeeded;
      statusNote = res.degradedReason;
    } catch {
      toast('重新识别失败，可先手动补点或调整');
    } finally {
      isBusy = false;
      redraw();
    }
  };

  const modeControl = createSegmentedControl<PillDetectionMode>(
    '清点模式',
    [
      { value: 'loose', label: '散落药片' },
      { value: 'blister', label: '整板药片' },
    ],
    mode,
    (next) => {
      if (next === mode) return;
      mode = next;
      if (mode !== 'blister') {
        gridEnabled = false;
        if (tool === 'grid') tool = 'tap';
      }
      gridToolBtn.hidden = mode !== 'blister';
      void runCloudOrModePipeline({ roi: roiRect ?? undefined, pushHistory: true });
    },
  );
  modeRow.append(modeControl, resetZoomBtn);

  resetZoomBtn.onclick = () => {
    zoom = 1;
    panX = 0;
    panY = 0;
    updateViewportTransform();
  };

  enableCloudBtn.onclick = async () => {
    const granted = await grantAiConsentForOrigins(
      [CLOUD_ORIGIN],
      '将把当前压缩后的药片照片发送至小药盒云端识别接口，仅用于数药片定位，不保留原图。',
    );
    if (!granted) return;
    consentNeeded = false;
    consentBanner.hidden = true;
    await runCloudOrModePipeline({ roi: roiRect ?? undefined, pushHistory: true });
  };

  // 工具切换事件
  tapToolBtn.onclick = () => {
    tool = 'tap';
    redraw();
  };
  sampleToolBtn.onclick = () => {
    tool = tool === 'sample' ? 'tap' : 'sample';
    if (tool === 'sample') sampleSeeds = [];
    redraw();
  };
  roiToolBtn.onclick = () => {
    tool = tool === 'roi' ? 'tap' : 'roi';
    redraw();
  };
  gridToolBtn.onclick = () => {
    if (mode !== 'blister') return;
    gridEnabled = !gridEnabled;
    if (gridEnabled) {
      tool = 'grid';
      applyBlisterGridEvaluation(true);
    } else {
      tool = 'tap';
      redraw();
    }
  };

  rowStepper.input.addEventListener('change', () => {
    if (gridEnabled && mode === 'blister') applyBlisterGridEvaluation(true);
  });
  colStepper.input.addEventListener('change', () => {
    if (gridEnabled && mode === 'blister') applyBlisterGridEvaluation(true);
  });

  roiRecountBtn.onclick = () => {
    if (!roiRect) return;
    void runCloudOrModePipeline({ roi: roiRect, pushHistory: true });
  };
  roiClearBtn.onclick = () => {
    roiRect = null;
    draftRoi = null;
    tool = 'tap';
    redraw();
  };

  undoBtn.onclick = () => {
    const snap = undoStack.pop();
    if (!snap) return;
    currentPoints = clonePoints(snap.points);
    sampleSeeds = snap.sampleSeeds.map((s) => ({ ...s }));
    roiRect = snap.roi ? { ...snap.roi } : null;
    gridConfig = cloneGrid(snap.grid);
    currentEngine = snap.engine;
    currentClusters = clusterPillAppearances(prepared.rawImgData, currentPoints);
    if (gridConfig) {
      rowStepper.input.value = String(gridConfig.rows);
      colStepper.input.value = String(gridConfig.cols);
    }
    redraw();
  };

  const setHideOverlay = (hidden: boolean) => {
    if (hideOverlay === hidden) return;
    hideOverlay = hidden;
    redraw();
  };
  holdPreviewBtn.addEventListener('pointerdown', () => setHideOverlay(true));
  holdPreviewBtn.addEventListener('pointerup', () => setHideOverlay(false));
  holdPreviewBtn.addEventListener('pointerleave', () => setHideOverlay(false));
  holdPreviewBtn.addEventListener('pointercancel', () => setHideOverlay(false));

  // 画布坐标换算与点按/双指手势处理
  const toCanvasPoint = (clientX: number, clientY: number) => {
    const rect = displayCanvas.getBoundingClientRect();
    const scaleX = displayCanvas.width / Math.max(1, rect.width);
    const scaleY = displayCanvas.height / Math.max(1, rect.height);
    return {
      x: clamp((clientX - rect.left) * scaleX, 0, displayCanvas.width),
      y: clamp((clientY - rect.top) * scaleY, 0, displayCanvas.height),
      scaleX,
    };
  };

  const handleCanvasTap = (cx: number, cy: number, scaleX: number) => {
    if (tool === 'sample') {
      pushUndo();
      sampleSeeds.push({ x: Math.round(cx), y: Math.round(cy) });
      const sampleRes = detectPillsFromSample(prepared.rawImgData, sampleSeeds, {
        roi: roiRect ?? undefined,
      });
      currentPoints = clonePoints(sampleRes.points);
      currentEngine = 'sample_local';
      currentClusters = clusterPillAppearances(prepared.rawImgData, currentPoints);
      redraw();
      return;
    }

    if (tool === 'grid' && mode === 'blister' && gridEnabled && gridConfig) {
      const centers = gridCellCenters(gridConfig);
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < centers.length; i += 1) {
        const d = Math.hypot(centers[i]!.x - cx, centers[i]!.y - cy);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        pushUndo();
        gridConfig.cells[bestIdx] = !gridConfig.cells[bestIdx];
        currentPoints = pointsFromGrid(gridConfig);
        currentClusters = clusterPillAppearances(prepared.rawImgData, currentPoints);
        redraw();
      }
      return;
    }

    // 默认点选：命中圆点删除，否则手动补点
    const hitRadius = Math.max(13, scaleX * 14);
    const hitIndex = currentPoints.findIndex(
      (pt) => Math.hypot(pt.x - cx, pt.y - cy) <= hitRadius,
    );
    pushUndo();
    if (hitIndex >= 0) {
      currentPoints.splice(hitIndex, 1);
    } else {
      currentPoints.push({
        x: Math.round(cx),
        y: Math.round(cy),
        id: Date.now(),
        isManual: true,
      });
    }
    currentClusters = clusterPillAppearances(prepared.rawImgData, currentPoints);
    redraw();
  };

  const activePointers = new Map<number, { x: number; y: number }>();
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  let pinchOriginPanX = 0;
  let pinchOriginPanY = 0;
  let isPinchSession = false;
  let panStartX = 0;
  let panStartY = 0;
  let panBaseX = 0;
  let panBaseY = 0;
  let gestureStartClientX = 0;
  let gestureStartClientY = 0;
  let gestureDownCanvas = { x: 0, y: 0, scaleX: 1 };
  let gestureMoved = false;
  let draggingCornerIndex = -1;
  let drawingRoiOrigin: { x: number; y: number } | null = null;
  let suppressNextClick = false;

  displayCanvas.addEventListener('pointerdown', (e) => {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (typeof displayCanvas.setPointerCapture === 'function') {
      try {
        displayCanvas.setPointerCapture(e.pointerId);
      } catch {
        // Ignore in synthetic DOM environments
      }
    }

    if (activePointers.size === 2) {
      isPinchSession = true;
      drawingRoiOrigin = null;
      draggingCornerIndex = -1;
      const pts = [...activePointers.values()];
      pinchStartDist = Math.max(
        10,
        Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y),
      );
      pinchStartZoom = zoom;
      pinchOriginPanX = panX;
      pinchOriginPanY = panY;
      return;
    }

    if (activePointers.size === 1) {
      isPinchSession = false;
      gestureMoved = false;
      gestureStartClientX = e.clientX;
      gestureStartClientY = e.clientY;
      gestureDownCanvas = toCanvasPoint(e.clientX, e.clientY);
      panStartX = e.clientX;
      panStartY = e.clientY;
      panBaseX = panX;
      panBaseY = panY;

      if (tool === 'grid' && mode === 'blister' && gridEnabled && gridConfig) {
        const hitCorner = Math.max(18, gestureDownCanvas.scaleX * 18);
        draggingCornerIndex = gridConfig.corners.findIndex(
          (c) => Math.hypot(c.x - gestureDownCanvas.x, c.y - gestureDownCanvas.y) <= hitCorner,
        );
      } else if (tool === 'roi') {
        drawingRoiOrigin = { x: gestureDownCanvas.x, y: gestureDownCanvas.y };
        draftRoi = null;
      }
    }
  });

  displayCanvas.addEventListener('pointermove', (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 2 && pinchStartDist > 0) {
      const pts = [...activePointers.values()];
      const dist = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
      zoom = clamp(pinchStartZoom * (dist / pinchStartDist), 1, 4);
      if (zoom <= 1.02) {
        zoom = 1;
        panX = 0;
        panY = 0;
      } else {
        const wrapRect = canvasWrap.getBoundingClientRect();
        const maxPanX = wrapRect.width * (zoom - 1);
        const maxPanY = wrapRect.height * (zoom - 1);
        panX = clamp(pinchOriginPanX, -maxPanX, 0);
        panY = clamp(pinchOriginPanY, -maxPanY, 0);
      }
      gestureMoved = true;
      updateViewportTransform();
      return;
    }

    if (activePointers.size === 1) {
      const moveDist = Math.hypot(e.clientX - gestureStartClientX, e.clientY - gestureStartClientY);
      if (moveDist > 6) gestureMoved = true;

      if (draggingCornerIndex >= 0 && gridConfig) {
        const pt = toCanvasPoint(e.clientX, e.clientY);
        gridConfig.corners[draggingCornerIndex] = { x: Math.round(pt.x), y: Math.round(pt.y) };
        redraw();
        return;
      }

      if (drawingRoiOrigin && gestureMoved) {
        const pt = toCanvasPoint(e.clientX, e.clientY);
        const x = Math.min(drawingRoiOrigin.x, pt.x);
        const y = Math.min(drawingRoiOrigin.y, pt.y);
        const w = Math.abs(pt.x - drawingRoiOrigin.x);
        const h = Math.abs(pt.y - drawingRoiOrigin.y);
        draftRoi = { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
        redraw();
        return;
      }

      if (zoom > 1 && gestureMoved) {
        const wrapRect = canvasWrap.getBoundingClientRect();
        const maxPanX = Math.max(0, wrapRect.width * (zoom - 1));
        const maxPanY = Math.max(0, wrapRect.height * (zoom - 1));
        panX = clamp(panBaseX + (e.clientX - panStartX), -maxPanX, 0);
        panY = clamp(panBaseY + (e.clientY - panStartY), -maxPanY, 0);
        updateViewportTransform();
      }
    }
  });

  const endPointer = (e: PointerEvent) => {
    activePointers.delete(e.pointerId);

    if (draggingCornerIndex >= 0) {
      draggingCornerIndex = -1;
      applyBlisterGridEvaluation(true);
    } else if (drawingRoiOrigin) {
      drawingRoiOrigin = null;
      if (draftRoi && draftRoi.width >= 20 && draftRoi.height >= 20) {
        roiRect = draftRoi;
      }
      draftRoi = null;
      redraw();
    } else if (
      e.type === 'pointerup' &&
      !isPinchSession &&
      !gestureMoved &&
      activePointers.size === 0
    ) {
      suppressNextClick = true;
      setTimeout(() => {
        suppressNextClick = false;
      }, 0);
      const pt = toCanvasPoint(e.clientX, e.clientY);
      handleCanvasTap(pt.x, pt.y, pt.scaleX);
    }

    if (activePointers.size === 0) {
      isPinchSession = false;
      pinchStartDist = 0;
    }
  };

  displayCanvas.addEventListener('pointerup', endPointer);
  displayCanvas.addEventListener('pointercancel', endPointer);

  // Fallback for synthetic DOM / keyboard clicks where pointerup wasn't dispatched
  displayCanvas.addEventListener('click', (e) => {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    const pt = toCanvasPoint(e.clientX, e.clientY);
    handleCanvasTap(pt.x, pt.y, pt.scaleX);
  });

  container.append(
    header,
    modeRow,
    consentBanner,
    clusterStrip,
    canvasWrap,
    toolBar,
    roiSubBar,
    gridSubBar,
    emptyHint,
    actions,
  );

  redraw();

  let resolvePromise: ((value: PillCountResult | null) => void) | null = null;
  return new Promise<PillCountResult | null>((resolve) => {
    resolvePromise = resolve;
    sheetHandle = openBottomSheet({
      label: '数药片清点',
      content: container,
      dismissOnOverlay: true,
      onClose: () => {
        if (!settledByAction) {
          options.onCancel?.();
          resolve(null);
        }
      },
    });
  });
}
