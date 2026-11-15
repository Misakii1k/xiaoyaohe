/**
 * Unified contracts, normalization helpers, and phase-2 local YOLO hook
 * shared across cloud and local pill counting engines.
 */

export type PillDetectionMode = 'loose' | 'blister';

export type PillDetectionEngineKind =
  | 'cloud'
  | 'yolo_local'
  | 'sample_local'
  | 'blister_grid'
  | 'heuristic_local';

export interface PillBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export interface PillPoint {
  id: number;
  x: number;
  y: number;
  isManual?: boolean;
  group?: string;
  confidence?: number;
  box?: PillBox;
}

export interface PillAppearanceCluster {
  label: string;
  count: number;
  swatch: string;
  pointIds: number[];
}

export interface PillGridCorner {
  x: number;
  y: number;
}

export interface PillGridConfig {
  rows: number;
  cols: number;
  /** Four corners in clockwise order: TL, TR, BR, BL (pixel coords on source image). */
  corners: [PillGridCorner, PillGridCorner, PillGridCorner, PillGridCorner];
  /** Row-major occupancy flags (`rows * cols`). */
  cells: boolean[];
}

export interface PillROI {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PillCountResult {
  points: PillPoint[];
  count: number;
  engine: PillDetectionEngineKind;
  mode: PillDetectionMode;
  imageWidth: number;
  imageHeight: number;
  clusters?: PillAppearanceCluster[];
  grid?: PillGridConfig;
  consentNeeded?: boolean;
  fallbackReason?: string;
}

export interface LocalYoloDetectOptions {
  mode: PillDetectionMode;
  signal?: AbortSignal;
  roi?: PillROI;
}

export interface LocalYoloProvider {
  readonly id: string;
  readonly label: string;
  isReady(): Promise<boolean> | boolean;
  detect(
    image: ImageData,
    options: LocalYoloDetectOptions,
  ): Promise<{
    points: PillPoint[];
    clusters?: PillAppearanceCluster[];
  }>;
}

let registeredLocalYoloProvider: LocalYoloProvider | null = null;

/** Register or clear the optional phase-2 offline YOLO inference provider. */
export function registerLocalYoloProvider(provider: LocalYoloProvider | null): void {
  registeredLocalYoloProvider = provider;
}

/** Return the active optional phase-2 offline YOLO provider, if registered. */
export function getRegisteredLocalYoloProvider(): LocalYoloProvider | null {
  return registeredLocalYoloProvider;
}

export interface RawPillPointInput {
  x: number;
  y: number;
  confidence?: number;
  group?: string;
  box?: {
    xMin?: number;
    yMin?: number;
    xMax?: number;
    yMax?: number;
    x_min?: number;
    y_min?: number;
    x_max?: number;
    y_max?: number;
  };
}

export interface NormalizePillPointsOptions {
  mode?: PillDetectionMode;
  /** Force coordinate interpretation; if omitted, auto-detects normalized [0..1] vs pixel space. */
  normalized?: boolean;
  /** Minimum center distance as fraction of min(width, height). Default 0.012. */
  minDistRatio?: number;
  /** Minimum center distance floor in pixels. Default 6. */
  minDistPx?: number;
  startId?: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function normalizeBox(
  rawBox: RawPillPointInput['box'],
  scaleX: number,
  scaleY: number,
  width: number,
  height: number,
): PillBox | undefined {
  if (!rawBox) return undefined;
  const xMinRaw = rawBox.xMin ?? rawBox.x_min;
  const yMinRaw = rawBox.yMin ?? rawBox.y_min;
  const xMaxRaw = rawBox.xMax ?? rawBox.x_max;
  const yMaxRaw = rawBox.yMax ?? rawBox.y_max;
  if (
    typeof xMinRaw !== 'number' ||
    typeof yMinRaw !== 'number' ||
    typeof xMaxRaw !== 'number' ||
    typeof yMaxRaw !== 'number' ||
    !Number.isFinite(xMinRaw) ||
    !Number.isFinite(yMinRaw) ||
    !Number.isFinite(xMaxRaw) ||
    !Number.isFinite(yMaxRaw)
  ) {
    return undefined;
  }
  const xMin = Math.round(clamp(xMinRaw * scaleX, 0, width));
  const yMin = Math.round(clamp(yMinRaw * scaleY, 0, height));
  const xMax = Math.round(clamp(xMaxRaw * scaleX, 0, width));
  const yMax = Math.round(clamp(yMaxRaw * scaleY, 0, height));
  if (xMax <= xMin || yMax <= yMin) return undefined;
  return { xMin, yMin, xMax, yMax };
}

/**
 * Convert raw cloud/model points (either normalized [0..1] or pixel coordinates)
 * into deduplicated pixel-space `PillPoint[]`.
 */
export function normalizePillPoints(
  rawPoints: readonly RawPillPointInput[],
  width: number,
  height: number,
  options: NormalizePillPointsOptions = {},
): PillPoint[] {
  if (!Array.isArray(rawPoints) || rawPoints.length === 0 || width <= 0 || height <= 0) {
    return [];
  }

  const validRaw = rawPoints.filter(
    (p) =>
      p != null &&
      typeof p.x === 'number' &&
      typeof p.y === 'number' &&
      Number.isFinite(p.x) &&
      Number.isFinite(p.y) &&
      p.x >= 0 &&
      p.y >= 0,
  );
  if (validRaw.length === 0) return [];

  const isNormalized =
    options.normalized ??
    validRaw.every((p) => p.x <= 1.0001 && p.y <= 1.0001);

  const scaleX = isNormalized ? width : 1;
  const scaleY = isNormalized ? height : 1;
  const minDim = Math.min(width, height);
  const minDist = Math.max(options.minDistPx ?? 6, minDim * (options.minDistRatio ?? 0.012));
  const minDistSq = minDist * minDist;

  const out: PillPoint[] = [];
  let nextId = options.startId ?? 1;

  for (const item of validRaw) {
    const px = Math.round(clamp(item.x * scaleX, 0, Math.max(0, width - 1)));
    const py = Math.round(clamp(item.y * scaleY, 0, Math.max(0, height - 1)));

    let duplicate = false;
    for (const existing of out) {
      const dx = existing.x - px;
      const dy = existing.y - py;
      if (dx * dx + dy * dy < minDistSq) {
        duplicate = true;
        break;
      }
    }
    if (duplicate) continue;

    const pt: PillPoint = {
      id: nextId++,
      x: px,
      y: py,
      isManual: false,
    };
    if (typeof item.confidence === 'number' && Number.isFinite(item.confidence)) {
      pt.confidence = item.confidence;
    }
    if (typeof item.group === 'string' && item.group.trim()) {
      pt.group = item.group.trim();
    }
    const box = normalizeBox(item.box, scaleX, scaleY, width, height);
    if (box) pt.box = box;

    out.push(pt);
  }

  return out;
}

export function pillEngineLabel(engine: PillDetectionEngineKind): string {
  switch (engine) {
    case 'cloud':
      return '云端识别';
    case 'yolo_local':
      return '本地模型';
    case 'sample_local':
      return '样本校准';
    case 'blister_grid':
      return '药板网格';
    case 'heuristic_local':
    default:
      return '本地快速识别';
  }
}
