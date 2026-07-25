// ScanSort → MedEdit 的页间临时握手：在内存里暂存一次"识药结果 + 原图 + 感知哈希"。
// 不进 IndexedDB，下次导航后丢弃。比 sessionStorage 简单（不用序列化 Blob）。
import type { IdentifyResult } from './identify';
import type { MedicationInventory } from '../db/schema';

export interface PendingPrefill {
  result: IdentifyResult;
  photoBlob: Blob;
  aHash: string;
}

let pending: PendingPrefill | null = null;

export function setPendingPrefill(p: PendingPrefill): void {
  pending = p;
}

/** 读取并清空（一次性） */
export function takePendingPrefill(): PendingPrefill | null {
  const p = pending;
  pending = null;
  return p;
}

// 库存识别 → MedEdit 的页间临时握手：在内存里暂存一次"药名 + 库存草稿"，
// 让"库存页识别不到该药 → 跳添加药品页"时能预填。同样不落盘。
export interface PendingInventoryPrefill {
  name: string;
  inventory: MedicationInventory;
}

let pendingInventory: PendingInventoryPrefill | null = null;

export function setPendingInventoryPrefill(p: PendingInventoryPrefill): void {
  pendingInventory = p;
}

export function takePendingInventoryPrefill(): PendingInventoryPrefill | null {
  const p = pendingInventory;
  pendingInventory = null;
  return p;
}
