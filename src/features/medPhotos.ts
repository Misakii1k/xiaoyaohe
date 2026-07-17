// 药盒照片：压缩存储 + 会话级 object URL 缓存。
// 照片只存本地 IndexedDB（photos 表），不参与云同步。
// 手机拍照原图常 3–8MB；若不先压小，保存/解码时容易把 WebView 内存打爆导致闪退。
// 旧版本可能已把大图写进库：读取时懒压缩回写，列表加载限并发，避免一进页就 OOM。
import { deletePhotosByMed, getPhotosByMed, putPhoto, uid } from '../db/local';

/** 展示图最长边；手机屏幕看图够用，再大只增加内存压力 */
const MAX_EDGE = 720;
/** 目标体积上限（约 220KB） */
const TARGET_BYTES = 220_000;
/** 超过这个体积的旧图，读取时立刻再压一次 */
const RECOMPRESS_THRESHOLD = 280_000;
/** 列表页一次最多并行解码几张，防止 WebView 内存尖峰 */
const LIST_CONCURRENCY = 2;
const JPEG_QUALITIES = [0.72, 0.6, 0.48, 0.36] as const;

/** medId -> 最新照片的 object URL；同一张照片整个会话只创建一次 URL */
const urlCache = new Map<string, { at: number; url: string }>();

/** 取某药最新药盒照片的 object URL；没有照片时返回 null */
export async function getMedPhotoUrl(medId: string): Promise<string | null> {
  try {
    const photos = await getPhotosByMed(medId);
    if (photos.length === 0) return null;
    let latest = photos.reduce((a, b) => (b.at > a.at ? b : a));

    // 旧版大图：读到就懒压缩回写，下次列表不再扛几 MB
    if (latest.blob.size > RECOMPRESS_THRESHOLD) {
      try {
        const compressed = await compressBoxPhoto(latest.blob);
        if (compressed.size > 0 && compressed.size < latest.blob.size) {
          await deletePhotosByMed(medId);
          invalidateMedPhotoCache(medId);
          const next = { id: uid(), medId, blob: compressed, at: Date.now() };
          await putPhoto(next);
          latest = next;
        }
      } catch {
        /* 压不动就尽量用原图展示；单张失败不拖垮整页 */
      }
    }

    const cached = urlCache.get(medId);
    if (cached && cached.at === latest.at) return cached.url;
    if (cached) URL.revokeObjectURL(cached.url);
    const url = URL.createObjectURL(latest.blob);
    urlCache.set(medId, { at: latest.at, url });
    return url;
  } catch {
    return null;
  }
}

/** 批量取多个药的照片 URL，列表页/今日页一次拿全（限并发） */
export async function getMedPhotoUrls(medIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(medIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += LIST_CONCURRENCY) {
    const batch = ids.slice(i, i + LIST_CONCURRENCY);
    await Promise.all(
      batch.map(async (id) => {
        try {
          const url = await getMedPhotoUrl(id);
          if (url) out.set(id, url);
        } catch {
          /* 单张失败不影响整页 */
        }
      }),
    );
  }
  return out;
}

/** 取某药最新药盒照片的 Blob（AI 精修等需要原始数据的场景）；没有照片返回 null */
export async function getLatestMedPhotoBlob(medId: string): Promise<Blob | null> {
  try {
    const photos = await getPhotosByMed(medId);
    if (photos.length === 0) return null;
    const latest = photos.reduce((a, b) => (b.at > a.at ? b : a));
    if (latest.blob.size > RECOMPRESS_THRESHOLD) {
      try {
        return await compressBoxPhoto(latest.blob);
      } catch {
        return latest.blob;
      }
    }
    return latest.blob;
  } catch {
    return null;
  }
}

/**
 * 保存药盒照片（压缩后入库，并只保留最新一张）。
 * 覆盖旧图时清掉同药历史记录和会话 URL 缓存，避免库和内存无限涨。
 */
export async function saveMedPhoto(medId: string, blob: Blob): Promise<void> {
  const compressed = await compressBoxPhoto(blob);
  await deletePhotosByMed(medId);
  invalidateMedPhotoCache(medId);
  await putPhoto({ id: uid(), medId, blob: compressed, at: Date.now() });
}

/** 拍照/选图后立刻压一版再挂到页面上，避免会话里一直挂着几 MB 原图 */
export async function prepareBoxPhoto(blob: Blob): Promise<Blob> {
  return compressBoxPhoto(blob);
}

/**
 * 启动或进入药品相关页时调用：把库里偏大的药盒照批量压小。
 * 失败静默，绝不抛到 UI。
 */
export async function migrateOversizedMedPhotos(limit = 12): Promise<number> {
  try {
    const { listMeds } = await import('../db/local');
    const meds = await listMeds();
    let fixed = 0;
    for (const med of meds.slice(0, 80)) {
      if (fixed >= limit) break;
      try {
        const photos = await getPhotosByMed(med.id);
        if (photos.length === 0) continue;
        const latest = photos.reduce((a, b) => (b.at > a.at ? b : a));
        if (latest.blob.size <= RECOMPRESS_THRESHOLD) continue;
        const compressed = await compressBoxPhoto(latest.blob);
        if (compressed.size > 0 && compressed.size < latest.blob.size) {
          await deletePhotosByMed(med.id);
          invalidateMedPhotoCache(med.id);
          await putPhoto({ id: uid(), medId: med.id, blob: compressed, at: Date.now() });
          fixed += 1;
        }
      } catch {
        /* 单药失败继续 */
      }
    }
    return fixed;
  } catch {
    return 0;
  }
}

/** 压缩到最长边 720px 的 JPEG；多档质量；解码失败时尽量别把超大原图再交回去 */
export async function compressBoxPhoto(blob: Blob): Promise<Blob> {
  if (blob.size > 0 && blob.size <= TARGET_BYTES && blob.type === 'image/jpeg') {
    try {
      const probe = await decodeImage(blob);
      if (Math.max(probe.width, probe.height) <= MAX_EDGE) {
        probe.close();
        return blob;
      }
      probe.close();
    } catch {
      /* 下面走完整压缩 */
    }
  }

  try {
    const bitmap = await decodeImage(blob);
    try {
      const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return preferSmaller(blob, null);
      ctx.drawImage(bitmap, 0, 0, width, height);

      let best: Blob | null = null;
      for (const quality of JPEG_QUALITIES) {
        const out = await canvasToJpeg(canvas, quality);
        if (!out || out.size === 0) continue;
        best = out;
        if (out.size <= TARGET_BYTES) break;
      }
      // 画布结果必须明显更小，或原图已经过大
      if (best && best.size > 0 && (best.size < blob.size || blob.size > TARGET_BYTES)) {
        return best;
      }
      return preferSmaller(blob, best);
    } finally {
      bitmap.close();
    }
  } catch {
    // 解码失败时：超大原图再交出去会在下一页 OOM，宁可丢图
    if (blob.size > RECOMPRESS_THRESHOLD) {
      throw new Error('照片太大且无法压缩，请重拍一张近一点的');
    }
    return blob;
  }
}

function preferSmaller(original: Blob, candidate: Blob | null): Blob {
  if (candidate && candidate.size > 0 && candidate.size < original.size) return candidate;
  if (original.size > RECOMPRESS_THRESHOLD && candidate && candidate.size > 0) return candidate;
  return original;
}

function invalidateMedPhotoCache(medId: string): void {
  const cached = urlCache.get(medId);
  if (cached) {
    URL.revokeObjectURL(cached.url);
    urlCache.delete(medId);
  }
}

async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  // 优先让浏览器在解码时就缩边，显著降低峰值内存
  try {
    return await createImageBitmap(blob, {
      resizeWidth: MAX_EDGE,
      resizeHeight: MAX_EDGE,
      resizeQuality: 'low',
    } as ImageBitmapOptions);
  } catch {
    return createImageBitmap(blob);
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
    } catch {
      resolve(null);
    }
  });
}
