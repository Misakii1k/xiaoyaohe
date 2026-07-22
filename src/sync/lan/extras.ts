// 同步可选内容：药品照片 + API 配置。
// 独立于 CRDT snapshot，作为 extras 字段附在 join/result 消息里。
// 照片 per-medId last-write-wins；API 配置接收方直接覆盖。
import { z } from 'zod';
import { listAllPhotos, putPhoto, deletePhotosByMed, uid } from '../../db/local';
import { getLlmConfig, setLlmConfig } from '../../ai/llmConfig';

// ---- 常量 ----

/** 单次同步最多传输的照片数量 */
export const SYNC_MAX_PHOTOS = 30;
/** 单张照片 base64 最大长度（约 400KB 原始 → 533KB base64） */
const MAX_PHOTO_BASE64_LENGTH = 600_000;

// ---- 类型 & Schema ----

const syncPhotoEntry = z.object({
  medId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/),
  base64: z.string().max(MAX_PHOTO_BASE64_LENGTH),
  at: z.number().finite().nonnegative(),
}).strict();

const syncApiConfig = z.object({
  llm: z.object({
    baseUrl: z.string().max(2048),
    apiKey: z.string().max(512),
    model: z.string().max(256),
  }).strict().optional(),
  agnes: z.object({
    apiKey: z.string().max(512),
    apiBase: z.string().max(2048),
  }).strict().optional(),
}).strict();

export const syncExtrasSchema = z.object({
  photos: z.array(syncPhotoEntry).max(SYNC_MAX_PHOTOS).optional(),
  apiConfig: syncApiConfig.optional(),
}).strict();

export type SyncPhotoEntry = z.infer<typeof syncPhotoEntry>;
export type SyncApiConfig = z.infer<typeof syncApiConfig>;
export type SyncExtras = z.infer<typeof syncExtrasSchema>;

// ---- 用户勾选选项 ----

export interface LanSyncContentOptions {
  /** 同步药品照片（含缩略图） */
  photos?: boolean;
  /** 同步 AI 接口配置 */
  apiConfig?: boolean;
}

// ---- 照片收集 & 应用 ----

/**
 * 从 IndexedDB 收集所有药品照片，转为 base64 条目。
 * 每种药只取最新一张；总数上限 SYNC_MAX_PHOTOS。
 */
export async function collectSyncPhotos(): Promise<SyncPhotoEntry[]> {
  const allPhotos = await listAllPhotos();
  // 按 medId 分组，每组取最新
  const byMed = new Map<string, { blob: Blob; at: number }>();
  for (const photo of allPhotos) {
    const existing = byMed.get(photo.medId);
    if (!existing || photo.at > existing.at) {
      byMed.set(photo.medId, { blob: photo.blob, at: photo.at });
    }
  }
  // 按时间倒序取前 N 张
  const entries = [...byMed.entries()]
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, SYNC_MAX_PHOTOS);

  const result: SyncPhotoEntry[] = [];
  for (const [medId, { blob, at }] of entries) {
    try {
      const base64 = await blobToBase64(blob);
      if (base64.length <= MAX_PHOTO_BASE64_LENGTH) {
        result.push({ medId, base64, at });
      }
    } catch {
      // 单张失败不阻塞整体
    }
  }
  return result;
}

/**
 * 将收到的照片条目写入本地 IndexedDB。
 * per-medId last-write-wins：只覆盖比本地图更旧的。
 * 返回实际写入的数量。
 */
export async function applySyncPhotos(photos: SyncPhotoEntry[]): Promise<number> {
  let applied = 0;
  for (const entry of photos) {
    try {
      const blob = base64ToBlob(entry.base64, 'image/jpeg');
      // 检查本地是否已有更新的照片
      const { getPhotosByMed } = await import('../../db/local');
      const existing = await getPhotosByMed(entry.medId);
      if (existing.length > 0) {
        const latestAt = Math.max(...existing.map((p) => p.at));
        if (latestAt >= entry.at) continue; // 本地更新，跳过
      }
      await deletePhotosByMed(entry.medId);
      await putPhoto({ id: uid(), medId: entry.medId, blob, at: entry.at });
      applied += 1;
    } catch {
      // 单张失败继续
    }
  }
  return applied;
}

// ---- API 配置收集 & 应用 ----

/**
 * 收集本机的 API 配置（LLM + 内置 Agnes）。
 */
export function collectSyncApiConfig(): SyncApiConfig {
  const config: SyncApiConfig = {};

  // 用户自定义 LLM 配置
  const llm = getLlmConfig();
  if (llm.baseUrl && llm.apiKey) {
    config.llm = { baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model };
  }

  // 内置 Agnes API（编译时环境变量）
  const agnesKey = import.meta.env.VITE_AGNES_API_KEY || import.meta.env.AGNES_API_KEY || '';
  const agnesBase = import.meta.env.VITE_AGNES_API_BASE || import.meta.env.AGNES_API_BASE || '';
  if (agnesKey && agnesBase) {
    config.agnes = { apiKey: agnesKey, apiBase: agnesBase };
  }

  return config;
}

/**
 * 将收到的 API 配置写入本机。
 * LLM 配置完整覆盖；Agnes 配置存入 localStorage 供运行时读取。
 */
export async function applySyncApiConfig(config: SyncApiConfig): Promise<void> {
  if (config.llm && config.llm.baseUrl && config.llm.apiKey) {
    await setLlmConfig({
      baseUrl: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
      model: config.llm.model || 'gpt-4o-mini',
    });
  }
  if (config.agnes && config.agnes.apiKey && config.agnes.apiBase) {
    try {
      localStorage.setItem('medbox.agnesApi.v1', JSON.stringify({
        apiKey: config.agnes.apiKey,
        apiBase: config.agnes.apiBase,
      }));
    } catch {
      // localStorage 满了不阻塞同步
    }
  }
}

// ---- 统一入口 ----

/**
 * 根据用户勾选收集 extras。
 */
export async function collectSyncExtras(options: LanSyncContentOptions): Promise<SyncExtras | undefined> {
  const extras: SyncExtras = {};
  if (options.photos) {
    extras.photos = await collectSyncPhotos();
  }
  if (options.apiConfig) {
    extras.apiConfig = collectSyncApiConfig();
  }
  if (!extras.photos?.length && !extras.apiConfig) return undefined;
  return extras;
}

/**
 * 应用收到的 extras。返回描述性统计。
 */
export async function applySyncExtras(extras: SyncExtras | undefined): Promise<{ photos: number; apiConfig: boolean }> {
  if (!extras) return { photos: 0, apiConfig: false };
  let photos = 0;
  let apiConfig = false;
  if (extras.photos?.length) {
    photos = await applySyncPhotos(extras.photos);
  }
  if (extras.apiConfig) {
    await applySyncApiConfig(extras.apiConfig);
    apiConfig = true;
  }
  return { photos, apiConfig };
}

// ---- 工具函数 ----

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // 去掉 data:image/jpeg;base64, 前缀
      const index = dataUrl.indexOf(',');
      resolve(index >= 0 ? dataUrl.slice(index + 1) : dataUrl);
    };
    reader.onerror = () => reject(new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type });
}
