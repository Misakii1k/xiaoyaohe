// 同步合并：按 id 归并、updatedAt 大者胜（last-write-wins）。
// 纯函数，前端与 Worker 共用同一份，保证两端合并行为一致。
import type { Medication, ReminderRule, IntakeLog, DataSnapshot } from '../db/schema';

/** 含软删除标记的快照（同步用，故含 deleted 项） */
export interface SyncSnapshot {
  meds: Medication[];
  rules: ReminderRule[];
  logs?: IntakeLog[];
}

/** 按 id 归并两组记录，updatedAt 较大者保留（并列时取 b） */
export function mergeById<T extends { id: string; updatedAt: number }>(a: T[], b: T[]): T[] {
  const map = new Map<string, T>();
  for (const x of a) map.set(x.id, x);
  for (const x of b) {
    const cur = map.get(x.id);
    if (!cur || x.updatedAt >= cur.updatedAt) map.set(x.id, x);
  }
  return [...map.values()];
}

/** 合并云端快照与本地快照，返回新的全量快照（含软删除项） */
export function mergeSnapshots(cloud: SyncSnapshot, local: SyncSnapshot): DataSnapshot {
  return {
    meds: mergeById(cloud.meds, local.meds),
    rules: mergeById(cloud.rules, local.rules),
    logs: mergeById(cloud.logs ?? [], local.logs ?? []),
    updatedAt: Date.now(),
  };
}
