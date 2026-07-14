// IndexedDB 封装（idb）：离线优先的本地存储 + 待同步队列
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { CLOUD_SYNC_ENABLED } from '../sync/config';
import type { SyncEntityType, SyncMutationOperation } from '../sync/v2/protocol';
import {
  createScheduleRevision,
  freezeScheduleRevision,
  getMedicationExpiryLocalDate,
  isMedicationExpiredOn,
  isLocalDate,
  toLocalDate,
} from '../domain/medicationSchedule';
import {
  deductInventory,
  restoreInventory,
  suggestStructuredDose,
} from '../features/inventory';
import {
  inflateMed,
  type Medication,
  type MedicationOccurrence,
  type MedicationScheduleRevision,
  type ReminderRule,
  type IntakeLog,
  type StructuredDose,
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
  scheduleRevisions: ImportBucketResult;
}

export interface SyncV2EntityMetadata {
  key: string;
  householdId: string;
  entityType: SyncEntityType;
  entityId: string;
  serverRevision: number;
  serverOperation: SyncMutationOperation | null;
  canonicalPayloadHash: string | null;
  pendingMutationId?: string;
  pendingMutationKey?: string;
  pendingOperation?: SyncMutationOperation;
  pendingPayloadHash?: string;
  updatedAt: number;
}

export interface MedboxDB extends DBSchema {
  meds: { key: string; value: Medication };
  rules: { key: string; value: ReminderRule; indexes: { byMed: string } };
  scheduleRevisions: {
    key: string;
    value: MedicationScheduleRevision;
    indexes: { byMed: string; bySourceRule: string };
  };
  logs: { key: string; value: IntakeLog; indexes: { byDue: number } };
  outbox: { key: string; value: OutboxItem };
  photos: { key: string; value: PhotoBlob; indexes: { byMed: string } };
  pushStates: { key: string; value: PushState };
  syncV2Metadata: {
    key: string;
    value: SyncV2EntityMetadata;
    indexes: { byHousehold: string; byPendingMutation: string };
  };
}

let dbp: Promise<IDBPDatabase<MedboxDB>> | null = null;

export function openMedboxDatabase(): Promise<IDBPDatabase<MedboxDB>> {
  if (!dbp) {
    dbp = openDB<MedboxDB>('medbox', 5, {
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
        if (oldVersion < 4) {
          const revisions = d.createObjectStore('scheduleRevisions', { keyPath: 'id' });
          revisions.createIndex('byMed', 'medId');
          revisions.createIndex('bySourceRule', 'sourceRuleId');
        }
        if (oldVersion < 5) {
          const metadata = d.createObjectStore('syncV2Metadata', { keyPath: 'key' });
          metadata.createIndex('byHousehold', 'householdId');
          metadata.createIndex('byPendingMutation', 'pendingMutationKey');
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

const db = openMedboxDatabase;

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
  return all.filter((m) => includeDeleted || !m.deleted).map((m) => normalizeMedication(m));
}

export async function getMed(id: string): Promise<Medication | undefined> {
  const m = await (await db()).get('meds', id);
  return m ? normalizeMedication(m) : undefined;
}

export async function putMed(med: Medication): Promise<void> {
  normalizeMedication(med);
  med.updatedAt = Date.now();
  // 清理旧字段，避免 IndexedDB 里残留
  delete (med as any).mealRel;
  await (await db()).put('meds', med);
  await enqueue('med', med.id);
}

export async function softDeleteMed(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['meds', 'rules', 'scheduleRevisions', 'outbox'], 'readwrite');
  const med = await tx.objectStore('meds').get(id);
  if (!med) {
    tx.abort();
    void tx.done.catch(() => undefined);
    return;
  }
  const now = Date.now();
  med.deleted = true;
  med.updatedAt = now;
  await tx.objectStore('meds').put(med);
  if (CLOUD_SYNC_ENABLED) {
    await tx.objectStore('outbox').put({ id: `med:${id}`, kind: 'med', refId: id, at: now });
  }
  // 关联提醒一并软删除
  const rules = await tx.objectStore('rules').index('byMed').getAll(id);
  for (const r of rules) {
    r.deleted = true;
    r.updatedAt = now;
    await tx.objectStore('rules').put(r);
    await tx.objectStore('scheduleRevisions').put(
      createScheduleRevision(med, r, { effectiveDate: toLocalDate(now), createdAt: now, enabled: false }),
    );
    if (CLOUD_SYNC_ENABLED) {
      await tx.objectStore('outbox').put({ id: `rule:${r.id}`, kind: 'rule', refId: r.id, at: now });
    }
  }
  await tx.done;
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
  const d = await db();
  const now = Date.now();
  const existingRule = await d.get('rules', rule.id);
  if (!rule.cycle) {
    delete rule.cycleStartDate;
    delete rule.cycleStartNeedsReview;
  } else if (!isLocalDate(rule.cycleStartDate) && !existingRule?.cycle) {
    // Enabling a cycle is an explicit action, so its first local calendar day
    // is today. Legacy rules that already had a cycle retain review semantics.
    rule.cycleStartDate = toLocalDate(now);
    delete rule.cycleStartNeedsReview;
  }
  rule.updatedAt = now;
  const med = await d.get('meds', rule.medId);
  const tx = d.transaction(['rules', 'scheduleRevisions', 'outbox'], 'readwrite');
  await tx.objectStore('rules').put(rule);
  if (med) {
    await tx.objectStore('scheduleRevisions').put(
      createScheduleRevision(normalizeMedication(med), rule, {
        effectiveDate: toLocalDate(now),
        createdAt: now,
      }),
    );
  }
  if (CLOUD_SYNC_ENABLED) {
    await tx.objectStore('outbox').put({ id: `rule:${rule.id}`, kind: 'rule', refId: rule.id, at: now });
  }
  await tx.done;
}

export async function deleteRule(id: string): Promise<void> {
  const d = await db();
  const r = await d.get('rules', id);
  if (!r) return;
  const now = Date.now();
  r.deleted = true;
  r.updatedAt = now;
  const med = await d.get('meds', r.medId);
  const tx = d.transaction(['rules', 'scheduleRevisions', 'outbox'], 'readwrite');
  await tx.objectStore('rules').put(r);
  if (med) {
    await tx.objectStore('scheduleRevisions').put(
      createScheduleRevision(normalizeMedication(med), r, {
        effectiveDate: toLocalDate(now),
        createdAt: now,
        enabled: false,
      }),
    );
  }
  if (CLOUD_SYNC_ENABLED) {
    await tx.objectStore('outbox').put({ id: `rule:${id}`, kind: 'rule', refId: id, at: now });
  }
  await tx.done;
}

/**
 * Returns all immutable schedule history. Existing v3 databases are migrated
 * lazily so the first read can combine each legacy medication/rule pair into a
 * deterministic baseline without rewriting either legacy record.
 */
export async function listScheduleRevisions(): Promise<MedicationScheduleRevision[]> {
  const d = await db();
  const [meds, rules, existing] = await Promise.all([
    d.getAll('meds'),
    d.getAll('rules'),
    d.getAll('scheduleRevisions'),
  ]);
  const medById = new Map(meds.map((med) => [med.id, normalizeMedication(med)]));
  const ids = new Set(existing.map((revision) => revision.id));
  const countByRule = new Map<string, number>();
  const createdAtByRule = new Map<string, Set<number>>();
  for (const revision of existing) {
    countByRule.set(revision.sourceRuleId, (countByRule.get(revision.sourceRuleId) ?? 0) + 1);
    const timestamps = createdAtByRule.get(revision.sourceRuleId) ?? new Set<number>();
    timestamps.add(revision.createdAt);
    createdAtByRule.set(revision.sourceRuleId, timestamps);
  }
  const additions: MedicationScheduleRevision[] = [];
  for (const rule of rules) {
    const med = medById.get(rule.medId);
    if (!med) continue;
    const hasHistory = (countByRule.get(rule.id) ?? 0) > 0;
    const sourceCreatedAt = rule.updatedAt || med.createdAt;
    // Completely undated legacy records get one baseline at first migration;
    // reuse it on later reads instead of appending a new Date.now revision.
    if (!sourceCreatedAt && hasHistory) continue;
    const createdAt = sourceCreatedAt || Date.now();
    if (createdAtByRule.get(rule.id)?.has(createdAt)) continue;
    const revision = createScheduleRevision(med, rule, {
      effectiveDate: hasHistory ? toLocalDate(createdAt) : undefined,
      createdAt,
    });
    if (!ids.has(revision.id)) {
      additions.push(revision);
      ids.add(revision.id);
    }
  }
  if (additions.length > 0) {
    const tx = d.transaction('scheduleRevisions', 'readwrite');
    await Promise.all(additions.map((revision) => tx.store.put(revision)));
    await tx.done;
  }
  return [...existing, ...additions].map(freezeScheduleRevision).sort(
    (a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.createdAt - b.createdAt,
  );
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

export async function getLogForOccurrence(
  occurrence: MedicationOccurrence,
): Promise<IntakeLog | undefined> {
  const d = await db();
  const [current, legacy] = await Promise.all([
    d.get('logs', occurrence.id),
    d.get('logs', occurrence.legacyLogId),
  ]);
  if (!current) return legacy;
  if (!legacy) return current;
  return current.updatedAt >= legacy.updatedAt ? current : legacy;
}

export async function putLog(log: IntakeLog): Promise<void> {
  log.updatedAt = Date.now();
  await (await db()).put('logs', log);
  await enqueue('log', log.id);
}

export type IntakeAction = 'taken' | 'skipped';

export type MedicationIntakeErrorCode =
  | 'medication-not-found'
  | 'expired'
  | 'dose-review-required'
  | 'insufficient-inventory';

export class MedicationIntakeError extends Error {
  constructor(
    readonly code: MedicationIntakeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MedicationIntakeError';
  }
}

export interface IntakeMutationResult {
  med: Medication;
  log?: IntakeLog;
  inventoryChanged: boolean;
  lowStock: boolean;
  lowStockMessage?: string;
}

/**
 * Applies one occurrence action and its inventory delta in the same IndexedDB
 * transaction. Passing undefined removes the action (derived pending state).
 */
export async function setOccurrenceAction(
  occurrence: MedicationOccurrence,
  action: IntakeAction | undefined,
  options: { ackAt?: number; confirmedDose?: StructuredDose } = {},
): Promise<IntakeMutationResult> {
  const d = await db();
  const tx = d.transaction(['meds', 'rules', 'scheduleRevisions', 'logs', 'outbox'], 'readwrite');
  const medStore = tx.objectStore('meds');
  const logStore = tx.objectStore('logs');
  const medRaw = await medStore.get(occurrence.medId);
  if (!medRaw) {
    tx.abort();
    void tx.done.catch(() => undefined);
    throw new MedicationIntakeError('medication-not-found', '找不到对应药品');
  }
  const med = normalizeMedication(medRaw);
  const [currentLog, legacyLog] = await Promise.all([
    logStore.get(occurrence.id),
    logStore.get(occurrence.legacyLogId),
  ]);
  const previous = currentLog && legacyLog
    ? currentLog.updatedAt >= legacyLog.updatedAt
      ? currentLog
      : legacyLog
    : currentLog ?? legacyLog;
  const now = options.ackAt ?? Date.now();
  let inventoryChanged = false;
  let lowStock = false;
  let lowStockMessage: string | undefined;

  if (options.confirmedDose) {
    const quantity = options.confirmedDose.quantity;
    const unit = options.confirmedDose.unit.trim();
    if (Number.isFinite(quantity) && quantity > 0 && unit) {
      med.doseQuantity = quantity;
      med.doseUnit = unit;
      med.doseSourceText = med.amountPerDose;
      med.doseReviewRequired = false;
      delete med.doseMigrationSuggestion;
    }
  }

  if (action === 'taken' && previous?.status !== 'taken') {
    if (isMedicationExpiredOn(med, occurrence.localDate)) {
      tx.abort();
      void tx.done.catch(() => undefined);
      throw new MedicationIntakeError(
        'expired',
        `${med.name} 已于 ${getMedicationExpiryLocalDate(med) ?? '此前'} 过期，不能记录服用`,
      );
    }
    if (med.inventory) {
      const inventoryResult = deductInventory(med);
      if (inventoryResult.reviewRequired) {
        tx.abort();
        void tx.done.catch(() => undefined);
        throw new MedicationIntakeError(
          'dose-review-required',
          inventoryResult.message ?? `${med.name} 的每次用量需要确认`,
        );
      }
      if (inventoryResult.insufficient) {
        tx.abort();
        void tx.done.catch(() => undefined);
        throw new MedicationIntakeError(
          'insufficient-inventory',
          inventoryResult.message ?? `${med.name} 库存不足`,
        );
      }
      inventoryChanged = inventoryResult.changed;
      lowStock = inventoryResult.low;
      lowStockMessage = inventoryResult.message;
    }
  } else if (previous?.status === 'taken' && action !== 'taken') {
    // Legacy logs without an explicit delta are intentionally not restored.
    if (previous.inventoryDelta != null) {
      inventoryChanged = restoreInventory(med, previous.inventoryDelta);
    }
  }

  if (inventoryChanged || options.confirmedDose) {
    med.updatedAt = now;
    await medStore.put(med);
    if (CLOUD_SYNC_ENABLED) {
      await tx.objectStore('outbox').put({
        id: `med:${med.id}`,
        kind: 'med',
        refId: med.id,
        at: now,
      });
    }
    if (options.confirmedDose) {
      const rules = await tx.objectStore('rules').index('byMed').getAll(med.id);
      for (const rule of rules) {
        await tx.objectStore('scheduleRevisions').put(
          createScheduleRevision(med, rule, {
            effectiveDate: occurrence.localDate,
            createdAt: now,
          }),
        );
      }
    }
  }

  if (currentLog) await logStore.delete(currentLog.id);
  if (legacyLog && legacyLog.id !== currentLog?.id) await logStore.delete(legacyLog.id);

  let nextLog: IntakeLog | undefined;
  if (action) {
    nextLog = {
      id: occurrence.id,
      occurrenceId: occurrence.id,
      scheduleRevisionId: occurrence.scheduleRevisionId,
      sourceRuleId: occurrence.sourceRuleId,
      medId: occurrence.medId,
      slot: occurrence.slot,
      dueAt: occurrence.dueAt,
      status: action,
      ackAt: now,
      inventoryDelta:
        action === 'taken'
          ? previous?.status === 'taken'
            ? previous.inventoryDelta
            : med.inventory
              ? med.doseQuantity
              : undefined
          : undefined,
      updatedAt: now,
    };
    await logStore.put(nextLog);
    if (CLOUD_SYNC_ENABLED) {
      await tx.objectStore('outbox').put({
        id: `log:${nextLog.id}`,
        kind: 'log',
        refId: nextLog.id,
        at: now,
      });
    }
  }
  await tx.done;
  return { med, log: nextLog, inventoryChanged, lowStock, lowStockMessage };
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
  scheduleRevisions: MedicationScheduleRevision[] = [],
): Promise<MedImportResult> {
  const result: MedImportResult = {
    meds: { added: 0, updated: 0, skipped: 0 },
    rules: { added: 0, updated: 0, skipped: 0 },
    logs: { added: 0, updated: 0, skipped: 0 },
    scheduleRevisions: { added: 0, updated: 0, skipped: 0 },
  };
  const d = await db();
  const tx = d.transaction(['meds', 'rules', 'logs', 'scheduleRevisions'], 'readwrite');
  const medStore = tx.objectStore('meds');
  const ruleStore = tx.objectStore('rules');
  const logStore = tx.objectStore('logs');
  const revisionStore = tx.objectStore('scheduleRevisions');

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

  // Schedule history is immutable. Existing IDs are never overwritten;
  // imported revisions have already passed the backup runtime schema.
  for (const raw of scheduleRevisions) {
    if (!raw || typeof raw.id !== 'string' || typeof raw.sourceRuleId !== 'string') {
      result.scheduleRevisions.skipped += 1;
      continue;
    }
    const existing = await revisionStore.get(raw.id);
    if (existing) {
      result.scheduleRevisions.skipped += 1;
      continue;
    }
    await revisionStore.put(freezeScheduleRevision({ ...raw }));
    result.scheduleRevisions.added += 1;
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

function normalizeMedication(med: Medication): Medication {
  const inflated = inflateMed(med) as Medication;
  if (Number.isFinite(inflated.expiryDate)) {
    if (
      !isLocalDate(inflated.expiryLocalDate) ||
      inflated.expirySourceTimestamp !== inflated.expiryDate
    ) {
      const expiryLocalDate = getMedicationExpiryLocalDate({
        ...inflated,
        expiryLocalDate: undefined,
      });
      if (expiryLocalDate) inflated.expiryLocalDate = expiryLocalDate;
    }
    inflated.expirySourceTimestamp = inflated.expiryDate;
  } else if (inflated.expirySourceTimestamp != null) {
    delete inflated.expiryLocalDate;
    delete inflated.expirySourceTimestamp;
  } else if (!isLocalDate(inflated.expiryLocalDate)) {
    const expiryLocalDate = getMedicationExpiryLocalDate(inflated);
    if (expiryLocalDate) inflated.expiryLocalDate = expiryLocalDate;
    else delete inflated.expiryLocalDate;
  }

  const sourceChanged =
    inflated.doseSourceText != null && inflated.doseSourceText !== inflated.amountPerDose;
  const hasConfirmedDose =
    !sourceChanged &&
    Number.isFinite(inflated.doseQuantity) &&
    (inflated.doseQuantity as number) > 0 &&
    !!inflated.doseUnit?.trim();
  if (hasConfirmedDose) {
    inflated.doseQuantity = Number(inflated.doseQuantity);
    inflated.doseUnit = inflated.doseUnit!.trim();
    inflated.doseReviewRequired = false;
    delete inflated.doseMigrationSuggestion;
  } else {
    delete inflated.doseQuantity;
    delete inflated.doseUnit;
    delete inflated.doseSourceText;
    const suggestion = suggestStructuredDose(inflated.amountPerDose, inflated.inventory?.unit);
    if (suggestion) inflated.doseMigrationSuggestion = suggestion;
    else delete inflated.doseMigrationSuggestion;
    inflated.doseReviewRequired = !!inflated.amountPerDose.trim();
  }
  return inflated;
}
