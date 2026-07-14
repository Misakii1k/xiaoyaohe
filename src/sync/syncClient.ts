// Compatibility facade for existing status icons. The unsafe v1 snapshot
// writer has been removed; v2 is invoked explicitly through its encrypted client.
import { clearSyncConfig } from './config';

export type SyncState = 'idle' | 'syncing' | 'ok' | 'error' | 'offline' | 'unconfigured' | 'disabled';

export interface SyncResult {
  state: SyncState;
  message: string;
  at: number;
  pulledMeds?: number;
  pulledRules?: number;
  pulledLogs?: number;
}

const DISABLED_MESSAGE = '旧版云同步已移除；加密家庭同步仍处于灰度阶段';
let lastResult: SyncResult = { state: 'disabled', message: DISABLED_MESSAGE, at: Date.now() };
const listeners = new Set<(result: SyncResult) => void>();

export function onSync(listener: (result: SyncResult) => void): () => void {
  listeners.add(listener);
  listener(lastResult);
  return () => listeners.delete(listener);
}

function emit(result: SyncResult): void {
  lastResult = result;
  for (const listener of listeners) listener(result);
}

export function getLastSync(): SyncResult {
  return lastResult;
}

export async function hasPending(): Promise<boolean> {
  return false;
}

export async function syncNow(): Promise<SyncResult> {
  const result: SyncResult = { state: 'disabled', message: DISABLED_MESSAGE, at: Date.now() };
  emit(result);
  return result;
}

/** Clears legacy localStorage secrets; v2 lifecycle is owned by its settings panel. */
export function startAutoSync(): void {
  clearSyncConfig();
  emit({ state: 'disabled', message: DISABLED_MESSAGE, at: Date.now() });
}
