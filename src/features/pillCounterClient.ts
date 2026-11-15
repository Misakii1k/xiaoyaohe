import { hasAiConsent } from '../ai/consent';
import { CLOUD_ORIGIN } from '../sync/lan/apkTransport';
import {
  clusterPillAppearances,
  detectPillsFromImageData,
} from './pillDetection';
import {
  getRegisteredLocalYoloProvider,
  normalizePillPoints,
  type LocalYoloProvider,
  type PillCountResult,
  type PillDetectionMode,
  type PillROI,
} from './pillEngine';

export const DEFAULT_PILL_IMAGE_MAX_DIM = 1024;
export const DEFAULT_CLOUD_COUNT_TIMEOUT_MS = 8000;
const MAX_UPLOAD_DATA_URL_CHARS = 1_400_000;

export interface PreparedPillImage {
  width: number;
  height: number;
  rawImgData: ImageData;
  jpegDataUrl: string;
  canvas?: HTMLCanvasElement;
}

export type PillImageSource =
  | PreparedPillImage
  | Blob
  | File
  | string
  | HTMLImageElement
  | HTMLCanvasElement;

export interface PreparePillImageOptions {
  maxDim?: number;
  quality?: number;
}

export interface PillPipelineOptions {
  source: PillImageSource;
  mode?: PillDetectionMode;
  roi?: PillROI;
  sensitivityOffset?: number;
  allowCloud?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  endpointUrl?: string;
  yoloProvider?: LocalYoloProvider | null;
}

export interface PillPipelineResult extends PillCountResult {
  prepared: PreparedPillImage;
  degradedReason?: string;
}

export function countPillsEndpointUrl(): string {
  return `${CLOUD_ORIGIN}/api/count-pills`;
}

export function fitDimensionsWithin(
  srcW: number,
  srcH: number,
  maxDim: number,
): { width: number; height: number } {
  if (srcW <= 0 || srcH <= 0) return { width: 1, height: 1 };
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  return {
    width: Math.max(1, Math.round(srcW * scale)),
    height: Math.max(1, Math.round(srcH * scale)),
  };
}

export function isPreparedPillImage(source: unknown): source is PreparedPillImage {
  if (!source || typeof source !== 'object') return false;
  const s = source as Record<string, unknown>;
  return (
    typeof s.width === 'number' &&
    typeof s.height === 'number' &&
    typeof s.jpegDataUrl === 'string' &&
    s.rawImgData != null &&
    typeof (s.rawImgData as ImageData).data === 'object'
  );
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

async function resolveDrawable(
  source: Exclude<PillImageSource, PreparedPillImage>,
): Promise<{
  element: HTMLImageElement | HTMLCanvasElement;
  srcW: number;
  srcH: number;
  cleanup?: () => void;
}> {
  if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
    return { element: source, srcW: source.width, srcH: source.height };
  }
  if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
    if (!source.complete || source.naturalWidth === 0) {
      await new Promise<void>((resolve, reject) => {
        source.addEventListener('load', () => resolve(), { once: true });
        source.addEventListener('error', () => reject(new Error('图片加载失败')), { once: true });
      });
    }
    return {
      element: source,
      srcW: source.naturalWidth || source.width,
      srcH: source.naturalHeight || source.height,
    };
  }
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    const objectUrl = URL.createObjectURL(source);
    try {
      const img = await loadImageElement(objectUrl);
      return {
        element: img,
        srcW: img.naturalWidth || img.width,
        srcH: img.naturalHeight || img.height,
        cleanup: () => URL.revokeObjectURL(objectUrl),
      };
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw error;
    }
  }
  if (typeof source === 'string') {
    const img = await loadImageElement(source);
    return {
      element: img,
      srcW: img.naturalWidth || img.width,
      srcH: img.naturalHeight || img.height,
    };
  }
  throw new Error('不支持的图片输入格式');
}

function encodeCanvasJpeg(canvas: HTMLCanvasElement, initialQuality = 0.82): string {
  let q = initialQuality;
  let dataUrl = canvas.toDataURL('image/jpeg', q);
  while (dataUrl.length > MAX_UPLOAD_DATA_URL_CHARS && q > 0.45) {
    q = Math.max(0.42, q - 0.14);
    dataUrl = canvas.toDataURL('image/jpeg', q);
  }
  return dataUrl;
}

/**
 * Downscale source photo to max 1024px edge once, producing both exact Canvas pixels
 * for local analysis/display and a compact JPEG data URL for cloud inference.
 */
export async function preparePillImage(
  source: PillImageSource,
  options: PreparePillImageOptions = {},
): Promise<PreparedPillImage> {
  if (isPreparedPillImage(source)) return source;

  const maxDim = options.maxDim ?? DEFAULT_PILL_IMAGE_MAX_DIM;
  const quality = options.quality ?? 0.82;
  const { element, srcW, srcH, cleanup } = await resolveDrawable(source);

  try {
    const { width, height } = fitDimensionsWithin(srcW, srcH, maxDim);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('画布上下文不可用');
    ctx.drawImage(element, 0, 0, width, height);
    const rawImgData = ctx.getImageData(0, 0, width, height);
    const jpegDataUrl = encodeCanvasJpeg(canvas, quality);
    return { width, height, rawImgData, jpegDataUrl, canvas };
  } finally {
    cleanup?.();
  }
}

interface ExtractedRoiTarget {
  imgData: ImageData;
  jpegDataUrl: string;
  offsetX: number;
  offsetY: number;
}

function extractRoiTarget(prepared: PreparedPillImage, roi?: PillROI): ExtractedRoiTarget {
  if (!roi) {
    return {
      imgData: prepared.rawImgData,
      jpegDataUrl: prepared.jpegDataUrl,
      offsetX: 0,
      offsetY: 0,
    };
  }

  const x0 = Math.max(0, Math.min(prepared.width, Math.floor(roi.x)));
  const y0 = Math.max(0, Math.min(prepared.height, Math.floor(roi.y)));
  const x1 = Math.max(x0, Math.min(prepared.width, Math.ceil(roi.x + roi.width)));
  const y1 = Math.max(y0, Math.min(prepared.height, Math.ceil(roi.y + roi.height)));
  const cw = x1 - x0;
  const ch = y1 - y0;

  if (
    cw < 8 ||
    ch < 8 ||
    (x0 === 0 && y0 === 0 && cw === prepared.width && ch === prepared.height)
  ) {
    return {
      imgData: prepared.rawImgData,
      jpegDataUrl: prepared.jpegDataUrl,
      offsetX: 0,
      offsetY: 0,
    };
  }

  const src = prepared.rawImgData.data;
  const cropData = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y += 1) {
    const start = ((y0 + y) * prepared.width + x0) * 4;
    cropData.set(src.subarray(start, start + cw * 4), y * cw * 4);
  }
  const imgData = {
    width: cw,
    height: ch,
    data: cropData,
    colorSpace: prepared.rawImgData.colorSpace,
  } as ImageData;

  let jpegDataUrl = prepared.jpegDataUrl;
  if (typeof document !== 'undefined') {
    const tmp = document.createElement('canvas');
    tmp.width = cw;
    tmp.height = ch;
    const tctx = tmp.getContext('2d');
    if (tctx && prepared.canvas) {
      tctx.drawImage(prepared.canvas, x0, y0, cw, ch, 0, 0, cw, ch);
      jpegDataUrl = encodeCanvasJpeg(tmp, 0.85);
    }
  }

  return { imgData, jpegDataUrl, offsetX: x0, offsetY: y0 };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === 'AbortError'
    : err instanceof Error && err.name === 'AbortError';
}

function originFromUrl(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return CLOUD_ORIGIN;
  }
}

function mapHttpFallbackReason(status: number): string {
  if (status === 429) return '云端识别繁忙，已自动改用本地计算';
  if (status === 503) return '云端识别暂未启用，已自动改用本地计算';
  return `云端识别暂不可用（${status}），已自动改用本地计算`;
}

/**
 * Orchestrate pill counting across cloud inference, optional phase-2 local YOLO,
 * and client-side heuristic fallback without blocking first-screen usability.
 */
export async function runPillDetectionPipeline(
  options: PillPipelineOptions,
): Promise<PillPipelineResult> {
  throwIfAborted(options.signal);
  const mode: PillDetectionMode = options.mode ?? 'loose';
  const prepared = await preparePillImage(options.source, {
    maxDim: DEFAULT_PILL_IMAGE_MAX_DIM,
  });
  throwIfAborted(options.signal);

  const target = extractRoiTarget(prepared, options.roi);
  const endpoint = options.endpointUrl ?? countPillsEndpointUrl();
  const consentOrigin = originFromUrl(endpoint);

  let consentNeeded = false;
  let degradedReason: string | undefined;

  if (options.allowCloud !== false) {
    if (!hasAiConsent('pill-photo', consentOrigin)) {
      consentNeeded = true;
    } else if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      degradedReason = '当前处于离线状态，已使用本地识别';
    } else {
      const fetcher = options.fetcher ?? globalThis.fetch;
      if (typeof fetcher === 'function') {
        const timeoutMs = options.timeoutMs ?? DEFAULT_CLOUD_COUNT_TIMEOUT_MS;
        const controller = new AbortController();
        let timedOut = false;

        const onOuterAbort = () => controller.abort(options.signal?.reason);
        options.signal?.addEventListener('abort', onOuterAbort, { once: true });
        const timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);

        try {
          const response = await fetcher(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ image: target.jpegDataUrl, mode }),
            signal: controller.signal,
          });

          if (response.ok) {
            const payload = (await response.json()) as {
              ok?: boolean;
              points?: Array<{ x: number; y: number; confidence?: number; group?: string }>;
            };
            if (payload && Array.isArray(payload.points)) {
              const localPts = normalizePillPoints(
                payload.points,
                target.imgData.width,
                target.imgData.height,
                { mode },
              );
              const points = localPts.map((pt) => ({
                ...pt,
                x: pt.x + target.offsetX,
                y: pt.y + target.offsetY,
              }));
              const clusters = clusterPillAppearances(prepared.rawImgData, points);
              return {
                points,
                count: points.length,
                engine: 'cloud',
                mode,
                imageWidth: prepared.width,
                imageHeight: prepared.height,
                clusters,
                prepared,
              };
            }
            degradedReason = '云端返回格式异常，已使用本地识别';
          } else {
            degradedReason = mapHttpFallbackReason(response.status);
          }
        } catch (err) {
          if (options.signal?.aborted) {
            throw err;
          }
          if (timedOut || isAbortError(err)) {
            degradedReason = '云端识别超时，已自动改用本地计算';
          } else {
            degradedReason = '网络连接失败，已使用本地识别';
          }
        } finally {
          clearTimeout(timer);
          options.signal?.removeEventListener('abort', onOuterAbort);
        }
      }
    }
  }

  throwIfAborted(options.signal);

  const yolo = options.yoloProvider !== undefined
    ? options.yoloProvider
    : getRegisteredLocalYoloProvider();

  if (yolo) {
    try {
      const ready = await yolo.isReady();
      if (ready) {
        const yoloRes = await yolo.detect(target.imgData, {
          mode,
          signal: options.signal,
        });
        const shiftedPoints = yoloRes.points.map((pt, idx) => ({
          ...pt,
          id: idx + 1,
          x: pt.x + target.offsetX,
          y: pt.y + target.offsetY,
        }));
        const clusters =
          yoloRes.clusters ?? clusterPillAppearances(prepared.rawImgData, shiftedPoints);
        return {
          points: shiftedPoints,
          count: shiftedPoints.length,
          engine: 'yolo_local',
          mode,
          imageWidth: prepared.width,
          imageHeight: prepared.height,
          clusters,
          consentNeeded: consentNeeded || undefined,
          degradedReason,
          fallbackReason: degradedReason,
          prepared,
        };
      }
    } catch (err) {
      if (options.signal?.aborted) throw err;
    }
  }

  const localRes = detectPillsFromImageData(target.imgData, {
    sensitivityOffset: options.sensitivityOffset,
  });
  const shiftedPoints = localRes.points.map((pt) => ({
    ...pt,
    x: pt.x + target.offsetX,
    y: pt.y + target.offsetY,
  }));
  const clusters = clusterPillAppearances(prepared.rawImgData, shiftedPoints);

  return {
    points: shiftedPoints,
    count: shiftedPoints.length,
    engine: 'heuristic_local',
    mode,
    imageWidth: prepared.width,
    imageHeight: prepared.height,
    clusters,
    consentNeeded: consentNeeded || undefined,
    degradedReason,
    fallbackReason: degradedReason,
    prepared,
  };
}
