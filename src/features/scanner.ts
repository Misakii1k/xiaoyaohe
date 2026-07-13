// 扫码器封装：优先用安卓 Chrome 原生 BarcodeDetector（ML Kit 硬件加速，支持
// DataMatrix / EAN / Code128 等药盒码），不可用时回退 html5-qrcode。
import { Html5Qrcode } from 'html5-qrcode';

export interface ScanResult {
  /** 原始解码串（可能含 FNC1 \x1d） */
  raw: string;
  format: string;
}

export interface Scanner {
  stop(): Promise<void>;
}

type OnScan = (r: ScanResult) => void;

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

async function nativeFormats(): Promise<string[]> {
  const BD = (window as any).BarcodeDetector;
  if (!BD) return [];
  try {
    const supported: string[] = await BD.getSupportedFormats();
    return FORMATS.filter((f) => supported.includes(f));
  } catch {
    return [];
  }
}

/** 原生 BarcodeDetector 是否可用并支持常见药盒码 */
async function nativeSupported(): Promise<boolean> {
  const formats = await nativeFormats();
  return formats.length > 0;
}

export async function startScan(opts: {
  containerId: string;
  onScan: OnScan;
  onError?: (msg: string) => void;
}): Promise<Scanner> {
  const useNative = await nativeSupported();
  if (useNative) return startNative(opts);
  return startHtml5(opts);
}

/** 从拍照/相册图片中尝试识别码。仅在浏览器支持 BarcodeDetector 时可用。 */
export async function scanCodeFromImage(blob: Blob): Promise<ScanResult | null> {
  const BD = (window as any).BarcodeDetector;
  const formats = await nativeFormats();
  if (!BD || formats.length === 0) return null;
  try {
    const bmp = await createImageBitmap(blob);
    const detector = new BD({ formats });
    const codes = await detector.detect(bmp);
    const first = codes?.[0];
    const raw = first?.rawValue ?? '';
    return raw ? { raw, format: first.format || 'unknown' } : null;
  } catch {
    return null;
  }
}

async function startNative(opts: {
  containerId: string;
  onScan: OnScan;
  onError?: (msg: string) => void;
}): Promise<Scanner> {
  const BD = (window as any).BarcodeDetector;
  const formats = (await nativeFormats()).filter((f) => f !== 'itf');
  const detector = new BD({ formats });
  const container = document.getElementById(opts.containerId)!;
  container.innerHTML = '';
  const video = document.createElement('video');
  video.setAttribute('playsinline', 'true');
  video.style.width = '100%';
  video.style.borderRadius = '16px';
  container.append(video);

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    });
  } catch (e) {
    opts.onError?.('无法打开摄像头，请检查权限');
    throw e;
  }
  video.srcObject = stream;
  await video.play();

  let running = true;
  let lastRaw = '';
  let lastAt = 0;

  const tick = async () => {
    if (!running) return;
    try {
      const codes = await detector.detect(video);
      if (codes && codes.length > 0) {
        const raw: string = codes[0].rawValue ?? '';
        const now = Date.now();
        if (raw && (raw !== lastRaw || now - lastAt > 1500)) {
          lastRaw = raw;
          lastAt = now;
          opts.onScan({ raw, format: codes[0].format || 'unknown' });
        }
      }
    } catch {
      /* 单帧失败忽略 */
    }
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  return {
    async stop() {
      running = false;
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      container.innerHTML = '';
    },
  };
}

async function startHtml5(opts: {
  containerId: string;
  onScan: OnScan;
  onError?: (msg: string) => void;
}): Promise<Scanner> {
  const h5 = new Html5Qrcode(opts.containerId);
  let lastRaw = '';
  let lastAt = 0;
  try {
    await h5.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (decodedText, result) => {
        const now = Date.now();
        if (decodedText && (decodedText !== lastRaw || now - lastAt > 1500)) {
          lastRaw = decodedText;
          lastAt = now;
          const fmt = (result as any)?.result?.format?.formatName || 'unknown';
          opts.onScan({ raw: decodedText, format: String(fmt) });
        }
      },
      () => {
        /* 每帧未识别，忽略 */
      },
    );
  } catch (e) {
    opts.onError?.('无法打开摄像头，请检查权限');
    throw e;
  }
  return {
    async stop() {
      try {
        await h5.stop();
        await h5.clear();
      } catch {
        /* ignore */
      }
    },
  };
}
