// 同步路由：
//  GET  /api/sync   → 只读云端快照（新设备首次拉取）
//  PUT  /api/sync   → 上传本地全量快照 → 与云端 LWW 合并 → 写回 KV → 返回合并全集
// 合并用前端同款 mergeById（src/sync/merge.ts），保证两端行为一致。
import type { Env, CloudSnapshot, Medication, ReminderRule, IntakeLog } from '../types';
import { json, getHousehold, checkSecret } from '../lib/http';
import { readSnapshot, writeSnapshot } from '../lib/kv';
import { mergeById } from '../../src/sync/merge.ts';

export async function handleSync(req: Request, env: Env): Promise<Response> {
  const household = getHousehold(req);
  if (!household) return json({ error: 'bad household' }, 400);
  if (!checkSecret(req, env)) return json({ error: 'unauthorized' }, 401);

  if (req.method === 'GET') {
    const cloud = await readSnapshot(env, household);
    return json(cloud);
  }

  if (req.method === 'PUT') {
    let body: { meds?: Medication[]; rules?: ReminderRule[]; logs?: IntakeLog[] };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json({ error: 'bad json' }, 400);
    }
    const localMeds = body.meds ?? [];
    const localRules = body.rules ?? [];
    const localLogs = body.logs ?? [];

    const cloud = await readSnapshot(env, household);
    const merged: CloudSnapshot = {
      meds: mergeById(cloud.meds, localMeds),
      rules: mergeById(cloud.rules, localRules),
      logs: mergeById(cloud.logs ?? [], localLogs),
      updatedAt: Date.now(),
    };

    // 仅当合并结果与云端有差异时才写，省 KV 写额度
    if (changed(cloud, merged)) {
      await writeSnapshot(env, household, merged);
    }
    return json(merged);
  }

  return json({ error: 'method not allowed' }, 405);
}

/** 判断合并结果相对云端是否有变化（条数或任一项 updatedAt 不同） */
function changed(a: CloudSnapshot, b: CloudSnapshot): boolean {
  if (a.meds.length !== b.meds.length || a.rules.length !== b.rules.length || (a.logs ?? []).length !== (b.logs ?? []).length) return true;
  const stamp = (arr: { id: string; updatedAt: number }[]) =>
    arr.map((x) => `${x.id}:${x.updatedAt}`).sort().join('|');
  return stamp(a.meds) !== stamp(b.meds) || stamp(a.rules) !== stamp(b.rules) || stamp(a.logs ?? []) !== stamp(b.logs ?? []);
}
