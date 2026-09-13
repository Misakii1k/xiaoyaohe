import { openMedboxDatabase as db } from '../connection';
import type { PushState } from '../schema';

export async function getPushState(id: string): Promise<PushState | undefined> {
  return (await db()).get('pushStates', id);
}

export async function listPushStates(ids: readonly string[]): Promise<PushState[]> {
  if (ids.length === 0) return [];
  const requestedIds = new Set(ids);
  const states = await (await db()).getAll('pushStates');
  return states.filter((state) => requestedIds.has(state.id));
}

export async function putPushState(s: PushState): Promise<void> {
  await (await db()).put('pushStates', s);
}

/** 清理超过指定天数的旧推送状态，避免 pushStates 无限增长。返回删除条数。 */
export async function prunePushStates(olderThanDays: number): Promise<number> {
  const d = await db();
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const all = await d.getAll('pushStates');
  const stale = all.filter((state) => state.lastSentAt < cutoff);
  if (stale.length === 0) return 0;
  const tx = d.transaction('pushStates', 'readwrite');
  await Promise.all(stale.map((state) => tx.store.delete(state.id)));
  await tx.done;
  return stale.length;
}
