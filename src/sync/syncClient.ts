// 同步客户端：与 Worker /api/sync 单次往返完成双向同步。
// 流程：收集本地全量快照(含软删除) → PUT 给 Worker → Worker 与云端 LWW 合并后写回并返回全集
//       → 本地用返回全集覆盖 → 清空 outbox。
// 设计动机：KV 每天只 1000 次写，单次 PUT 合并整份快照、每次同步只写 1 次，最省写。
import { listMeds, listRules, listLogs, replaceFromSnapshot, getOutbox, clearOutboxItems } from '../db/local';
import type { DataSnapshot } from '../db/schema';
import { CLOUD_SYNC_ENABLED, getSyncConfig } from './config';

export type SyncState = 'idle' | 'syncing' | 'ok' | 'error' | 'offline' | 'unconfigured' | 'disabled';

export interface SyncResult {
  state: SyncState;
  message: string;
  at: number;
  pulledMeds?: number;
  pulledRules?: number;
  pulledLogs?: number;
}

let lastResult: SyncResult = CLOUD_SYNC_ENABLED
  ? { state: 'idle', message: '未同步', at: 0 }
  : { state: 'disabled', message: '云同步已暂停，本机数据照常可用', at: Date.now() };
let inFlight: Promise<SyncResult> | null = null;
const listeners = new Set<(r: SyncResult) => void>();

export function onSync(fn: (r: SyncResult) => void): () => void {
  listeners.add(fn);
  fn(lastResult);
  return () => listeners.delete(fn);
}

function emit(r: SyncResult): void {
  lastResult = r;
  for (const fn of listeners) fn(r);
}

export function getLastSync(): SyncResult {
  return lastResult;
}

/** 是否有待同步变更 */
export async function hasPending(): Promise<boolean> {
  return (await getOutbox()).length > 0;
}

/** 执行一次双向同步；并发调用会复用同一请求 */
export async function syncNow(): Promise<SyncResult> {
  if (!CLOUD_SYNC_ENABLED) {
    const r: SyncResult = { state: 'disabled', message: '云同步已暂停，本机数据照常可用', at: Date.now() };
    emit(r);
    return r;
  }
  if (inFlight) return inFlight;
  inFlight = doSync().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doSync(): Promise<SyncResult> {
  const cfg = getSyncConfig();
  if (!cfg) {
    const r: SyncResult = { state: 'unconfigured', message: '未配置云同步', at: Date.now() };
    emit(r);
    return r;
  }
  if (!navigator.onLine) {
    const r: SyncResult = { state: 'offline', message: '当前离线，待联网后再同步', at: Date.now() };
    emit(r);
    return r;
  }

  emit({ state: 'syncing', message: '同步中…', at: Date.now() });

  // 本地全量（含软删除，删除标记也要传给云端合并）
  const [meds, rules, logs] = await Promise.all([listMeds(true), listRules(true), listLogs()]);
  const outbox = await getOutbox();
  const outboxIds = outbox.map((o) => o.id);

  const url = cfg.workerUrl.replace(/\/+$/, '') + '/api/sync';
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-household': cfg.household,
        'x-secret': cfg.secret,
      },
        body: JSON.stringify({ meds, rules, logs } satisfies { meds: typeof meds; rules: typeof rules; logs: typeof logs }),
    });
  } catch (e) {
    const r: SyncResult = { state: 'error', message: '连接 Worker 失败：' + (e as Error).message, at: Date.now() };
    emit(r);
    return r;
  }

  if (resp.status === 401) {
    const r: SyncResult = { state: 'error', message: '密钥校验失败，请检查共享密钥', at: Date.now() };
    emit(r);
    return r;
  }
  if (!resp.ok) {
    const r: SyncResult = { state: 'error', message: `Worker 返回 ${resp.status}`, at: Date.now() };
    emit(r);
    return r;
  }

  let merged: DataSnapshot;
  try {
    merged = (await resp.json()) as DataSnapshot;
  } catch {
    const r: SyncResult = { state: 'error', message: '返回数据解析失败', at: Date.now() };
    emit(r);
    return r;
  }

  // 用合并后的全集覆盖本地（replaceFromSnapshot 不触发 outbox，避免回环）
  await replaceFromSnapshot(merged.meds ?? [], merged.rules ?? [], merged.logs ?? []);
  // 只清掉本次提交时已存在的 outbox 项；同步期间新增的变更保留待下次
  await clearOutboxItems(outboxIds);

  const r: SyncResult = {
    state: 'ok',
    message: '已同步',
    at: Date.now(),
    pulledMeds: merged.meds?.length ?? 0,
    pulledRules: merged.rules?.length ?? 0,
    pulledLogs: merged.logs?.length ?? 0,
  };
  emit(r);
  return r;
}

/** 启动后台自动同步：联网时、有待同步变更时触发；并周期性拉取对端变更 */
export function startAutoSync(periodMs = 60_000): void {
  if (!CLOUD_SYNC_ENABLED) {
    emit({ state: 'disabled', message: '云同步已暂停，本机数据照常可用', at: Date.now() });
    return;
  }
  // 联网恢复即同步
  window.addEventListener('online', () => void syncNow());
  // 启动时若已配置先同步一次
  if (getSyncConfig()) void syncNow();
  // 周期性拉取（即使本地无变更，也要拉对端的改动）
  window.setInterval(() => {
    if (getSyncConfig() && navigator.onLine) void syncNow();
  }, periodMs);
}
