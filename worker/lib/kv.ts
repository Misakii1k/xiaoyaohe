// KV 读写封装：快照的读取与保存，带 JSON 容错。
import type { Env, CloudSnapshot } from '../types';
import { kvKey } from '../types';

export async function readSnapshot(env: Env, household: string): Promise<CloudSnapshot> {
  const raw = await env.MEDBOX.get(kvKey.data(household));
  if (!raw) return { meds: [], rules: [], logs: [], updatedAt: 0 };
  try {
    const s = JSON.parse(raw) as CloudSnapshot;
    return { meds: s.meds ?? [], rules: s.rules ?? [], logs: s.logs ?? [], updatedAt: s.updatedAt ?? 0 };
  } catch {
    return { meds: [], rules: [], logs: [], updatedAt: 0 };
  }
}

export async function writeSnapshot(env: Env, household: string, snap: CloudSnapshot): Promise<void> {
  await env.MEDBOX.put(kvKey.data(household), JSON.stringify(snap));
}
