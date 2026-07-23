import type { LanSyncSnapshot } from './entities';
import { listMeds } from '../../db/local';

export type LanSyncPolicy = 'merge' | 'overwrite-local' | 'overwrite-remote';

export interface LanDeviceSummary {
  deviceId: string;
  deviceName: string;
  entryCount: number;
  medicationCount: number;
  withInventoryCount: number;
  /** Max hybrid clock across snapshot entries (vector-ish recency). */
  maxClock: number;
  /** Max medication.updatedAt for local device inventory awareness. */
  dataUpdatedAt: number;
  inventoryHint: string;
}

export function summarizeLanSnapshot(
  snapshot: LanSyncSnapshot,
  device: { id: string; name: string },
  dataUpdatedAt: number,
  inventoryHint: string,
): LanDeviceSummary {
  let maxClock = 0;
  let medicationCount = 0;
  for (const entry of snapshot.entries) {
    if (entry.clock > maxClock) maxClock = entry.clock;
    if (entry.entityType === 'medication' && !entry.tombstone) medicationCount += 1;
  }
  return {
    deviceId: device.id,
    deviceName: device.name,
    entryCount: snapshot.entries.length,
    medicationCount,
    withInventoryCount: 0,
    maxClock,
    dataUpdatedAt,
    inventoryHint,
  };
}

export async function buildLocalLanSummary(
  snapshot: LanSyncSnapshot,
  device: { id: string; name: string },
): Promise<LanDeviceSummary> {
  const meds = await listMeds(true);
  let dataUpdatedAt = 0;
  let withInventory = 0;
  const inventoryBits: string[] = [];
  for (const med of meds) {
    if (med.deleted) continue;
    if (med.updatedAt > dataUpdatedAt) dataUpdatedAt = med.updatedAt;
    if (med.inventory) {
      withInventory += 1;
      if (inventoryBits.length < 3) {
        inventoryBits.push(`${med.name} ${med.inventory.remaining}${med.inventory.unit}`);
      }
    }
  }
  const base = summarizeLanSnapshot(snapshot, device, dataUpdatedAt, inventoryBits.join(' · ') || '未填写库存');
  base.withInventoryCount = withInventory;
  return base;
}

/** Prefer the side that is more recent by max(clock, dataUpdatedAt). Ties keep local. */
export function recommendLanPolicy(
  local: LanDeviceSummary,
  remote: LanDeviceSummary,
): LanSyncPolicy {
  const localScore = Math.max(local.maxClock * 1_000, local.dataUpdatedAt);
  const remoteScore = Math.max(remote.maxClock * 1_000, remote.dataUpdatedAt);
  if (remoteScore > localScore + 60_000) return 'overwrite-remote';
  if (localScore > remoteScore + 60_000) return 'overwrite-local';
  // Same ballpark: if remote has more inventory rows and newer clock, lean remote
  if (remote.withInventoryCount > local.withInventoryCount && remote.maxClock >= local.maxClock) {
    return 'overwrite-remote';
  }
  if (local.withInventoryCount > remote.withInventoryCount) return 'overwrite-local';
  return 'merge';
}

export function policyLabel(policy: LanSyncPolicy): string {
  if (policy === 'overwrite-local') return '使用本机数据覆盖';
  if (policy === 'overwrite-remote') return '使用对方数据覆盖';
  return '智能合并';
}

const MULTI_KEY = 'medbox.lan-sync.allow-overwrite.v1';

export function isLanAllowRemoteOverwrite(): boolean {
  try {
    return localStorage.getItem(MULTI_KEY) === '1';
  } catch {
    return false;
  }
}

export function setLanAllowRemoteOverwrite(enabled: boolean): void {
  try {
    localStorage.setItem(MULTI_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function formatLanTime(ms: number): string {
  if (!ms) return '未知';
  try {
    return new Date(ms).toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '未知';
  }
}
