// 扫码器封装：优先使用原生 BarcodeDetector，不可用时回退 html5-qrcode。
import { Html5Qrcode } from 'html5-qrcode';

export interface ScanResult {
  /** 原始解码串（可能含 FNC1 \x1d） */
  raw: string;
  format: string;
}

export type ScannerState = 'running' | 'paused' | 'stopped';

export interface Scanner {
  readonly state: ScannerState;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
}

type OnScan = (result: ScanResult) => void;

const FORMATS = [
  'data_matrix',
  'qr_code',
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'itf',
];

interface ResultGate {
  readonly state: ScannerState;
  accept(result: ScanResult, beforeDeliver?: () => void): boolean;
  pause(): void;
  resume(): void;
  stop(): void;
}

/**
 * A camera session emits each decoded value at most once. The first new value
 * pauses delivery before the page callback runs; the page must explicitly
 * resume the session after the user has reviewed the result.
 */
export function createResultGate(onScan: OnScan): ResultGate {
  let state: ScannerState = 'running';
  const seen = new Set<string>();

  return {
    get state() {
      return state;
    },
    accept(result, beforeDeliver) {
      const raw = result.raw.trim();
      if (state !== 'running' || !raw || seen.has(raw)) return false;
      seen.add(raw);
      state = 'paused';
      try {
        beforeDeliver?.();
      } catch {
        /* Delivery remains paused even if a camera backend cannot pause video. */
      }
      onScan({ ...result, raw });
      return true;
    },
    pause() {
      if (state === 'running') state = 'paused';
    },
    resume() {
      if (state === 'paused') state = 'running';
    },
    stop() {
      state = 'stopped';
    },
  };
}

async function nativeFormats(): Promise<string[]> {
  const BarcodeDetector = (window as any).BarcodeDetector;
  if (!BarcodeDetector) return [];
  try {
    const supported: string[] = await BarcodeDetector.getSupportedFormats();
    return FORMATS.filter((format) => supported.includes(format));
  } catch {
    return [];
  }
}

async function nativeSupported(): Promise<boolean> {
  return (await nativeFormats()).length > 0;
}

export async function startScan(opts: {
  containerId: string;
  onScan: OnScan;
  onError?: (message: string) => void;
}): Promise<Scanner> {
  if (await nativeSupported()) return startNative(opts);
  return startHtml5(opts);
}

/** 从拍照/相册图片中尝试识别码，并在原生 API 缺失时回退 html5-qrcode。 */
export async function scanCodeFromImage(blob: Blob): Promise<ScanResult | null> {
  const nativeResult = await scanImageWithNativeDetector(blob);
  if (nativeResult) return nativeResult;
  return scanImageWithHtml5(blob);
}

async function scanImageWithNativeDetector(blob: Blob): Promise<ScanResult | null> {
  const BarcodeDetector = (window as any).BarcodeDetector;
  const formats = await nativeFormats();
  if (!BarcodeDetector || formats.length === 0) return null;
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      const detector = new BarcodeDetector({ formats });
      const codes = await detector.detect(bitmap);
      const first = codes?.[0];
      const raw = String(first?.rawValue ?? '').trim();
      return raw ? { raw, format: first.format || 'unknown' } : null;
    } finally {
      bitmap.close?.();
    }
  } catch {
    return null;
  }
}

async function scanImageWithHtml5(blob: Blob): Promise<ScanResult | null> {
  const host = document.createElement('div');
  host.id = `scan-file-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
  host.hidden = true;
  document.body.append(host);
  const reader = new Html5Qrcode(host.id);
  const file = blob instanceof File
    ? blob
    : new File([blob], 'barcode-image', { type: blob.type || 'application/octet-stream' });

  try {
    const result = await reader.scanFileV2(file, false);
    const raw = String(result.decodedText ?? '').trim();
    const format = (result as any)?.result?.format?.formatName || 'unknown';
    return raw ? { raw, format: String(format) } : null;
  } catch {
    return null;
  } finally {
    try {
      reader.clear();
    } catch {
      /* The file scanner may already have cleared its temporary canvas. */
    }
    host.remove();
  }
}

async function startNative(opts: {
  containerId: string;
  onScan: OnScan;
  onError?: (message: string) => void;
}): Promise<Scanner> {
  const BarcodeDetector = (window as any).BarcodeDetector;
  const formats = (await nativeFormats()).filter((format) => format !== 'itf');
  const detector = new BarcodeDetector({ formats });
  const container = document.getElementById(opts.containerId);
  if (!container) throw new Error('找不到扫码取景框');
  container.replaceChildren();

  const video = document.createElement('video');
  video.setAttribute('playsinline', 'true');
  video.style.width = '100%';
  video.style.borderRadius = '16px';
  container.append(video);

  let stream: MediaStream;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('Camera API unavailable', 'NotSupportedError');
    // 明确要一帧高一些的分辨率：默认 640x360 对小条码（药盒 EAN）解码成功率明显更低。
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (error) {
    container.replaceChildren();
    opts.onError?.(cameraErrorMessage(error));
    throw error;
  }

  video.srcObject = stream;
  try {
    await video.play();
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    container.replaceChildren();
    opts.onError?.(cameraErrorMessage(error));
    throw error;
  }

  const gate = createResultGate(opts.onScan);
  let frameId = 0;
  let detecting = false;
  // detect 是同步占 CPU 的重操作：按时间门限节流（约 8 次/秒）而不是每 rAF 全速跑，
  // 省下的算力让相机流水线出帧更稳，整体识别反而更快。
  const DETECT_INTERVAL_MS = 120;
  let lastDetectAt = 0;
  // 只有 running 状态才维持 rAF 循环；paused 由 resume 显式重启，避免空转耗电
  const shouldContinue = () => gate.state === 'running';

  const tick = async () => {
    if (!shouldContinue()) return;
    const now = performance.now();
    if (gate.state === 'running' && !detecting && now - lastDetectAt >= DETECT_INTERVAL_MS) {
      lastDetectAt = now;
      detecting = true;
      try {
        const codes = await detector.detect(video);
        const first = codes?.[0];
        const raw = String(first?.rawValue ?? '');
        if (raw) gate.accept({ raw, format: first.format || 'unknown' });
      } catch {
        /* A single failed video frame should not end the camera session. */
      } finally {
        detecting = false;
      }
    }
    if (shouldContinue()) frameId = requestAnimationFrame(tick);
  };
  frameId = requestAnimationFrame(tick);

  return {
    get state() {
      return gate.state;
    },
    async pause() {
      gate.pause();
      cancelAnimationFrame(frameId);
    },
    async resume() {
      if (gate.state !== 'paused') return;
      gate.resume();
      frameId = requestAnimationFrame(tick);
    },
    async stop() {
      if (gate.state === 'stopped') return;
      gate.stop();
      cancelAnimationFrame(frameId);
      stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
      container.replaceChildren();
    },
  };
}

async function startHtml5(opts: {
  containerId: string;
  onScan: OnScan;
  onError?: (message: string) => void;
}): Promise<Scanner> {
  const reader = new Html5Qrcode(opts.containerId);
  const gate = createResultGate(opts.onScan);
  // 取景框取视口短边 60%（收敛到 200-320px）：框太小会漏掉画面边缘的码，识别变慢。
  const qrSize = Math.max(200, Math.min(320, Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.6)));
  try {
    await reader.start(
      { facingMode: 'environment' },
      { fps: 12, qrbox: { width: qrSize, height: qrSize } },
      (decodedText, result) => {
        const format = (result as any)?.result?.format?.formatName || 'unknown';
        gate.accept(
          { raw: decodedText, format: String(format) },
          () => reader.pause(true),
        );
      },
      () => {
        /* An undecodable frame is expected while the camera is moving. */
      },
    );
  } catch (error) {
    gate.stop();
    try {
      reader.clear();
    } catch {
      /* ignore cleanup failure after start failure */
    }
    opts.onError?.(cameraErrorMessage(error));
    throw error;
  }

  return {
    get state() {
      return gate.state;
    },
    async pause() {
      if (gate.state !== 'running') return;
      gate.pause();
      reader.pause(true);
    },
    async resume() {
      if (gate.state !== 'paused') return;
      reader.resume();
      gate.resume();
    },
    async stop() {
      if (gate.state === 'stopped') return;
      gate.stop();
      try {
        if (reader.isScanning) await reader.stop();
        reader.clear();
      } catch {
        /* Stop is idempotent and must not block route cleanup. */
      }
    },
  };
}

function cameraErrorMessage(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '相机权限被拒绝。请在系统或浏览器设置中允许相机权限，然后重试。';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return '没有找到可用摄像头。可以改用相册中的药盒照片。';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return '摄像头正被其他应用占用。关闭其他相机应用后重试，或改用相册。';
  }
  return '无法打开摄像头。请检查相机权限后重试，或改用相册上传。';
}
