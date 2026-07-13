// IndexedDB 封装（idb）：离线优先的本地存储 + 待同步队列
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { CLOUD_SYNC_ENABLED } from '../sync/config';
import {
  inflateMed,
  type Medication,
  type ReminderRule,
  type IntakeLog,
  type OutboxItem,
  type PhotoBlob,
  type PushState,
  type Slot,
} from './schema';

export interface ImportBucketResult {
  added: number;
  updated: number;
  skipped: number;
}

export interface MedImportResult {
  meds: ImportBucketResult;
  rules: ImportBucketResult;
  logs: ImportBucketResult;
}

interface MedboxDB extends DBSchema {
  meds: { key: string; value: Medication };
  rules: { key: string; value: ReminderRule; indexes: { byMed: string } };
  logs: { key: string; value: IntakeLog; indexes: { byDue: number } };
  outbox: { key: string; value: OutboxItem };
  photos: { key: string; value: PhotoBlob; indexes: { byMed: string } };
  pushStates: { key: string; value: PushState };
}

let dbp: Promise<IDBPDatabase<MedboxDB>> | null = null;

function db(): Promise<IDBPDatabase<MedboxDB>> {
  if (!dbp) {
    dbp = openDB<MedboxDB>('medbox', 3, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          d.createObjectStore('meds', { keyPath: 'id' });
          const rules = d.createObjectStore('rules', { keyPath: 'id' });
          rules.createIndex('byMed', 'medId');
          const logs = d.createObjectStore('logs', { keyPath: 'id' });
          logs.createIndex('byDue', 'dueAt');
          d.createObjectStore('outbox', { keyPath: 'id' });
          const photos = d.createObjectStore('photos', { keyPath: 'id' });
          photos.createIndex('byMed', 'medId');
        }
        if (oldVersion < 2) {
          d.createObjectStore('pushStates', { keyPath: 'id' });
        }
      },
      blocked() {
        console.warn('IndexedDB 升级被旧页面阻塞，请关闭其他已打开的 medbox 页面后刷新。');
      },
      blocking() {
        console.warn('检测到新版数据库升级请求，当前页面将关闭旧连接。');
      },
    });
  }
  return dbp;
}

export function uid(): string {
  return crypto.randomUUID();
}

async function enqueue(kind: OutboxItem['kind'], refId: string): Promise<void> {
  if (!CLOUD_SYNC_ENABLED) return;
  const d = await db();
  await d.put('outbox', { id: `${kind}:${refId}`, kind, refId, at: Date.now() });
}

// ---- 药品 ----
export async function listMeds(includeDeleted = false): Promise<Medication[]> {
  const all = await (await db()).getAll('meds');
  return all.filter((m) => includeDeleted || !m.deleted).map((m) => inflateMed(m));
}

export async function getMed(id: string): Promise<Medication | undefined> {
  const m = await (await db()).get('meds', id);
  return m ? inflateMed(m) : undefined;
}

export async function putMed(med: Medication): Promise<void> {
  med.updatedAt = Date.now();
  // 清理旧字段，避免 IndexedDB 里残留
  delete (med as any).mealRel;
  await (await db()).put('meds', med);
  await enqueue('med', med.id);
}

export async function softDeleteMed(id: string): Promise<void> {
  const d = await db();
  const med = await d.get('meds', id);
  if (!med) return;
  med.deleted = true;
  med.updatedAt = Date.now();
  await d.put('meds', med);
  await enqueue('med', id);
  // 关联提醒一并软删除
  const rules = await d.getAllFromIndex('rules', 'byMed', id);
  for (const r of rules) {
    r.deleted = true;
    r.updatedAt = Date.now();
    await d.put('rules', r);
    await enqueue('rule', r.id);
  }
}

// ---- 提醒规则 ----
export async function listRules(includeDeleted = false): Promise<ReminderRule[]> {
  const all = await (await db()).getAll('rules');
  return all.filter((r) => includeDeleted || !r.deleted);
}

export async function listRulesByMed(medId: string): Promise<ReminderRule[]> {
  const all = await (await db()).getAllFromIndex('rules', 'byMed', medId);
  return all.filter((r) => !r.deleted);
}

export async function putRule(rule: ReminderRule): Promise<void> {
  rule.updatedAt = Date.now();
  await (await db()).put('rules', rule);
  await enqueue('rule', rule.id);
}

export async function deleteRule(id: string): Promise<void> {
  const d = await db();
  const r = await d.get('rules', id);
  if (!r) return;
  r.deleted = true;
  r.updatedAt = Date.now();
  await d.put('rules', r);
  await enqueue('rule', id);
}

export async function batchUpdateRules(updates: { id: string; enabled?: boolean }[]): Promise<void> {
  const d = await db();
  await Promise.all(
    updates.map(async (u) => {
      const existing = await d.get('rules', u.id);
      if (!existing || existing.deleted) return;
      const merged: ReminderRule = { ...existing };
      if (u.enabled !== undefined) merged.enabled = u.enabled;
      await putRule(merged);
    }),
  );
}

// ---- 服药记录 ----
export async function listLogsByDay(dayStartMs: number, dayEndMs: number): Promise<IntakeLog[]> {
  const d = await db();
  const range = IDBKeyRange.bound(dayStartMs, dayEndMs);
  return d.getAllFromIndex('logs', 'byDue', range);
}

export async function listLogsByRange(start: number, end: number): Promise<IntakeLog[]> {
  const d = await db();
  const range = IDBKeyRange.bound(start, end);
  const all = await d.getAllFromIndex('logs', 'byDue', range);
  return all
    .filter((l) => !(l as { deleted?: boolean }).deleted)
    .sort((a, b) => a.dueAt - b.dueAt);
}

export async function listLogs(): Promise<IntakeLog[]> {
  return (await db()).getAll('logs');
}

export async function getLog(id: string): Promise<IntakeLog | undefined> {
  return (await db()).get('logs', id);
}

export async function putLog(log: IntakeLog): Promise<void> {
  log.updatedAt = Date.now();
  await (await db()).put('logs', log);
  await enqueue('log', log.id);
}

// ---- 药盒原图（仅本地） ----
export async function putPhoto(photo: PhotoBlob): Promise<void> {
  await (await db()).put('photos', photo);
}

export async function getPhotosByMed(medId: string): Promise<PhotoBlob[]> {
  return (await db()).getAllFromIndex('photos', 'byMed', medId);
}

// ---- 待同步队列 ----
export async function getOutbox(): Promise<OutboxItem[]> {
  return (await db()).getAll('outbox');
}

export async function clearOutboxItems(ids: string[]): Promise<void> {
  const d = await db();
  const tx = d.transaction('outbox', 'readwrite');
  await Promise.all(ids.map((id) => tx.store.delete(id)));
  await tx.done;
}

/** 用云端快照覆盖本地（同步拉取后调用）。不触发 outbox，避免回环。 */
export async function replaceFromSnapshot(
  meds: Medication[],
  rules: ReminderRule[],
  logs: IntakeLog[] = [],
): Promise<void> {
  const d = await db();
  const tx = d.transaction(['meds', 'rules', 'logs'], 'readwrite');
  // 收到快照时也立刻迁移老字段并补齐时段
  for (const m of meds) {
    const inflated = inflateMed({ ...m });
    delete (inflated as any).mealRel;
    // 把不在新 SLOTS 集合内的旧 slot 过滤掉
    inflated.slots = (inflated.slots || []).filter((s) =>
      (['morning', 'noon', 'evening', 'bedtime'] as Slot[]).includes(s as Slot),
    );
    await tx.objectStore('meds').put(inflated as Medication);
  }
  for (const r of rules) await tx.objectStore('rules').put(r);
  for (const l of logs) {
    if (l && typeof l.id === 'string' && typeof l.dueAt === 'number') {
      await tx.objectStore('logs').put(l);
    }
  }
  await tx.done;
}

/** 本地备份导入：按 id + updatedAt 合并，不清空现有数据，也不刷新 updatedAt。 */
export async function importMedsAndRules(
  meds: Medication[],
  rules: ReminderRule[],
  logs: IntakeLog[] = [],
): Promise<MedImportResult> {
  const result: MedImportResult = {
    meds: { added: 0, updated: 0, skipped: 0 },
    rules: { added: 0, updated: 0, skipped: 0 },
    logs: { added: 0, updated: 0, skipped: 0 },
  };
  const d = await db();
  const tx = d.transaction(['meds', 'rules', 'logs'], 'readwrite');
  const medStore = tx.objectStore('meds');
  const ruleStore = tx.objectStore('rules');
  const logStore = tx.objectStore('logs');

  for (const raw of meds) {
    if (!raw || typeof raw.id !== 'string') {
      result.meds.skipped += 1;
      continue;
    }
    const incoming = inflateMed({ ...raw });
    delete (incoming as any).mealRel;
    incoming.slots = (incoming.slots || []).filter((s) =>
      (['morning', 'noon', 'evening', 'bedtime'] as Slot[]).includes(s as Slot),
    );
    const existing = await medStore.get(incoming.id);
    if (!existing) {
      await medStore.put(incoming as Medication);
      result.meds.added += 1;
    } else if ((incoming.updatedAt || 0) > (existing.updatedAt || 0)) {
      await medStore.put(incoming as Medication);
      result.meds.updated += 1;
    } else {
      result.meds.skipped += 1;
    }
  }

  for (const raw of rules) {
    if (!raw || typeof raw.id !== 'string') {
      result.rules.skipped += 1;
      continue;
    }
    const incoming = { ...raw };
    const existing = await ruleStore.get(incoming.id);
    if (!existing) {
      await ruleStore.put(incoming);
      result.rules.added += 1;
    } else if ((incoming.updatedAt || 0) > (existing.updatedAt || 0)) {
      await ruleStore.put(incoming);
      result.rules.updated += 1;
    } else {
      result.rules.skipped += 1;
    }
  }

  for (const raw of logs) {
    if (!raw || typeof raw.id !== 'string' || typeof raw.dueAt !== 'number') {
      result.logs.skipped += 1;
      continue;
    }
    const incoming = { ...raw };
    const existing = await logStore.get(incoming.id);
    if (!existing) {
      await logStore.put(incoming);
      result.logs.added += 1;
    } else if ((incoming.updatedAt || 0) > (existing.updatedAt || 0)) {
      await logStore.put(incoming);
      result.logs.updated += 1;
    } else {
      result.logs.skipped += 1;
    }
  }

  await tx.done;
  return result;
}

// ---- 提醒推送状态（M3，本地用） ----
export async function getPushState(id: string): Promise<PushState | undefined> {
  return (await db()).get('pushStates', id);
}

export async function putPushState(s: PushState): Promise<void> {
  await (await db()).put('pushStates', s);
}

export async function deletePushState(id: string): Promise<void> {
  await (await db()).delete('pushStates', id);
}
