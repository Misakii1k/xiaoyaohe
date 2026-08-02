// IndexedDB 封装（idb）：离线优先的本地存储 + 局域网同步元数据
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  createScheduleRevision,
  freezeScheduleRevision,
  getMedicationExpiryLocalDate,
  isMedicationExpiredOn,
  isLocalDate,
  toLocalDate,
} from '../domain/medicationSchedule';
import {
  areDoseUnitsCompatible,
  deductInventory,
  getConfirmedDose,
  isLowStock,
  restoreInventory,
  roundStock,
  suggestStructuredDose,
} from '../features/inventory';
import {
  inflateMed,
  type LocalDate,
  type Medication,
  type MedicationOccurrence,
  type MedicationScheduleRevision,
  type ReminderRule,
  defaultEscalate,
  type IntakeLog,
  type StructuredDose,
  type PhotoBlob,
  type PushState,
  type Slot,
  type InventoryOperationLog,
  type InventorySource,
  type InventoryActionType,
} from './schema';
import {
  validateMedicationDraft,
  type MedicationCreateDraft,
} from '../domain/medicationDraft';

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

export type SyncLanEntityType = 'medication' | 'reminderRule' | 'schedule' | 'intake';

export interface SyncLanEntityMetadata {
  key: string;
  kind: 'entity';
  entityType: SyncLanEntityType;
  entityId: string;
  operation: 'upsert' | 'delete';
  clock: number;
  deviceId: string;
  payloadHash: string;
  tombstone: boolean;
}

export interface SyncLanCounterMetadata {
  key: 'counter';
  kind: 'counter';
  deviceId: string;
  clock: number;
}

export type SyncLanMetadata = SyncLanEntityMetadata | SyncLanCounterMetadata;

export interface MedboxDB extends DBSchema {
  meds: { key: string; value: Medication };
  rules: { key: string; value: ReminderRule; indexes: { byMed: string } };
  scheduleRevisions: {
    key: string;
    value: MedicationScheduleRevision;
    indexes: { byMed: string; bySourceRule: string };
  };
  logs: { key: string; value: IntakeLog; indexes: { byDue: number } };
  photos: { key: string; value: PhotoBlob; indexes: { byMed: string } };
  pushStates: { key: string; value: PushState };
  syncLanMetadata: { key: string; value: SyncLanMetadata };
  inventoryLogs: { key: string; value: InventoryOperationLog; indexes: { byMed: string; byTimestamp: number } };
}

let dbp: Promise<IDBPDatabase<MedboxDB>> | null = null;

export function upgradeMedboxDatabase(d: IDBPDatabase<MedboxDB>, oldVersion: number): void {
  if (oldVersion < 1) {
    d.createObjectStore('meds', { keyPath: 'id' });
    const rules = d.createObjectStore('rules', { keyPath: 'id' });
    rules.createIndex('byMed', 'medId');
    const logs = d.createObjectStore('logs', { keyPath: 'id' });
    logs.createIndex('byDue', 'dueAt');
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
  if (oldVersion < 6) {
    const migrationDatabase = d as unknown as IDBDatabase;
    if (migrationDatabase.objectStoreNames.contains('outbox')) {
      migrationDatabase.deleteObjectStore('outbox');
    }
    if (migrationDatabase.objectStoreNames.contains('syncV2Metadata')) {
      migrationDatabase.deleteObjectStore('syncV2Metadata');
    }
    if (!d.objectStoreNames.contains('syncLanMetadata')) {
      d.createObjectStore('syncLanMetadata', { keyPath: 'key' });
    }
  }
  if (oldVersion < 7) {
    // no-op; 字段为可选，旧记录读取时为 undefined
  }
  if (oldVersion < 8) {
    if (!d.objectStoreNames.contains('inventoryLogs')) {
      const invLogs = d.createObjectStore('inventoryLogs', { keyPath: 'id' });
      invLogs.createIndex('byMed', 'medId');
      invLogs.createIndex('byTimestamp', 'timestamp');
    }
  }
}

export function openMedboxDatabase(): Promise<IDBPDatabase<MedboxDB>> {
  if (!dbp) {
    dbp = openDB<MedboxDB>('medbox', 8, {
      upgrade: upgradeMedboxDatabase,
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
  const next = normalizeMedication({ ...med });
  next.updatedAt = Date.now();
  // 清理旧字段，避免 IndexedDB 里残留
  delete (next as any).mealRel;
  await (await db()).put('meds', next);
}

export class MedicationBatchValidationError extends Error {
  constructor(readonly draftErrors: ReadonlyMap<string, ReturnType<typeof validateMedicationDraft>>) {
    super('批量药品中存在需要修正的项目');
    this.name = 'MedicationBatchValidationError';
  }
}

export interface MedicationBatchResult {
  medIds: string[];
  reminderRescheduleRequired: boolean;
}

/**
 * Persists a reviewed medication batch as one all-or-nothing local change.
 * Reminder delivery is intentionally outside this transaction and is retried
 * by its scheduler after the durable medication state is committed.
 */
export async function createMedicationBatch(
  drafts: readonly MedicationCreateDraft[],
): Promise<MedicationBatchResult> {
  const selected = drafts.filter((draft) => draft.selected && draft.duplicateResolution !== 'skip');
  if (selected.length === 0) {
    throw new MedicationBatchValidationError(new Map([['batch', [{ field: 'selected', code: 'none-selected', message: '请至少选择一项药品' }]]]));
  }
  const draftErrors = new Map<string, ReturnType<typeof validateMedicationDraft>>();
  for (const draft of selected) {
    const errors = validateMedicationDraft(draft);
    if (errors.length > 0) draftErrors.set(draft.id, errors);
  }
  if (draftErrors.size > 0) throw new MedicationBatchValidationError(draftErrors);

  const d = await db();
  const tx = d.transaction(['meds', 'rules', 'scheduleRevisions', 'photos'], 'readwrite');
  const now = Date.now();
  const effectiveDate = toLocalDate(now);
  try {
    for (const draft of selected) {
      const med = normalizeMedication({
        ...draft.medication,
        id: draft.id,
        createdAt: draft.medication.createdAt ?? now,
        updatedAt: now,
        identity: { ...draft.medication.identity },
      });
      delete (med as { mealRel?: unknown }).mealRel;
      await tx.objectStore('meds').put(med);
      for (const draftRule of draft.rules.filter((rule) => med.slots.includes(rule.slot))) {
        const rule: ReminderRule = {
          id: draftRule.id,
          medId: med.id,
          slot: draftRule.slot,
          timeLocal: draftRule.timeLocal,
          enabled: draftRule.enabled,
          cycle: draftRule.cycle ? { ...draftRule.cycle } : undefined,
          cycleStartDate: draftRule.cycleStartDate,
          escalate: defaultEscalate(),
          updatedAt: now,
        };
        if (!rule.cycle) {
          delete rule.cycleStartDate;
        }
        await tx.objectStore('rules').put(rule);
        await tx.objectStore('scheduleRevisions').put(
          createScheduleRevision(med, rule, { effectiveDate, createdAt: now }),
        );
      }

      if (draft.sourceKind === 'medicine-box' && draft.sourceImage) {
        // 事务里不能 await 画布压缩；调用方应先 prepareBoxPhoto。
        // 若误传超大原图，仍写入但靠 saveMedPhoto 主路径做强压缩；这里只做单张覆盖。
        await tx.objectStore('photos').put({ id: `photo:${draft.id}`, medId: med.id, blob: draft.sourceImage, at: now });
      }
    }
    await tx.done;
  } catch (error) {
    try { tx.abort(); } catch { /* Transaction may already be closed. */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
  return { medIds: selected.map((draft) => draft.id), reminderRescheduleRequired: selected.some((draft) => draft.rules.length > 0) };
}

export async function softDeleteMed(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['meds', 'rules', 'scheduleRevisions'], 'readwrite');
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
  // 关联提醒一并软删除
  const rules = await tx.objectStore('rules').index('byMed').getAll(id);
  for (const r of rules) {
    r.deleted = true;
    r.updatedAt = now;
    await tx.objectStore('rules').put(r);
    await tx.objectStore('scheduleRevisions').put(
      createScheduleRevision(med, r, { effectiveDate: toLocalDate(now), createdAt: now, enabled: false }),
    );
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
  const next: ReminderRule = { ...rule };
  if (!next.cycle) {
    delete next.cycleStartDate;
    delete next.cycleStartNeedsReview;
  } else if (!isLocalDate(next.cycleStartDate) && !existingRule?.cycle) {
    // Enabling a cycle is an explicit action, so its first local calendar day
    // is today. Legacy rules that already had a cycle retain review semantics.
    next.cycleStartDate = toLocalDate(now);
    delete next.cycleStartNeedsReview;
  }
  next.updatedAt = now;
  const tx = d.transaction(['meds', 'rules', 'scheduleRevisions'], 'readwrite');
  const med = await tx.objectStore('meds').get(next.medId);
  await tx.objectStore('rules').put(next);
  if (med) {
    await tx.objectStore('scheduleRevisions').put(
      createScheduleRevision(normalizeMedication(med), next, {
        effectiveDate: toLocalDate(now),
        createdAt: now,
      }),
    );
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
  const tx = d.transaction(['rules', 'scheduleRevisions'], 'readwrite');
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
  const now = Date.now();
  const tx = d.transaction(['meds', 'rules', 'scheduleRevisions'], 'readwrite');
  const ruleStore = tx.objectStore('rules');
  const medStore = tx.objectStore('meds');
  const revisionStore = tx.objectStore('scheduleRevisions');
  for (const u of updates) {
    const existing = await ruleStore.get(u.id);
    if (!existing || existing.deleted) continue;
    const merged: ReminderRule = { ...existing };
    if (u.enabled !== undefined) merged.enabled = u.enabled;
    if (!merged.cycle) {
      delete merged.cycleStartDate;
      delete merged.cycleStartNeedsReview;
    } else if (!isLocalDate(merged.cycleStartDate) && !existing.cycle) {
      merged.cycleStartDate = toLocalDate(now);
      delete merged.cycleStartNeedsReview;
    }
    merged.updatedAt = now;
    await ruleStore.put(merged);
    const med = await medStore.get(merged.medId);
    if (med) {
      await revisionStore.put(createScheduleRevision(normalizeMedication(med), merged, {
        effectiveDate: toLocalDate(now),
        createdAt: now,
      }));
    }
  }
  await tx.done;
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
  options: { ackAt?: number; confirmedDose?: StructuredDose; source?: InventorySource } = {},
): Promise<IntakeMutationResult> {
  const d = await db();
  const tx = d.transaction(['meds', 'rules', 'scheduleRevisions', 'logs', 'inventoryLogs'], 'readwrite');
  const medStore = tx.objectStore('meds');
  const logStore = tx.objectStore('logs');
  const inventoryLogStore = tx.objectStore('inventoryLogs');
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
  let inventoryDelta: number | undefined;
  let lowStock = false;
  let lowStockMessage: string | undefined;
  // 只对分药向导实际包含的服药时段跳过扣减；同日后补的新时段仍会正常扣库存。
  const occurrencePreDeducted = isOccurrencePreDeducted(med, occurrence);

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

  const occurrenceDose =
    Number.isFinite(options.confirmedDose?.quantity) && (options.confirmedDose?.quantity ?? 0) > 0 && options.confirmedDose?.unit.trim()
      ? { quantity: options.confirmedDose!.quantity, unit: options.confirmedDose!.unit.trim() }
      : Number.isFinite(occurrence.doseQuantity) && (occurrence.doseQuantity ?? 0) > 0 && occurrence.doseUnit?.trim()
        ? { quantity: occurrence.doseQuantity as number, unit: occurrence.doseUnit.trim() }
        : getConfirmedDose(med);

  if (action === 'taken' && previous?.status !== 'taken') {
    if (isMedicationExpiredOn(med, occurrence.localDate)) {
      tx.abort();
      void tx.done.catch(() => undefined);
      throw new MedicationIntakeError(
        'expired',
        `${med.name} 已于 ${getMedicationExpiryLocalDate(med) ?? '此前'} 过期，不能记录服用`,
      );
    }
    if (med.inventory && !occurrencePreDeducted) {
      // A legacy free-text dose must never block an intake record or be used
      // to guess an inventory delta. Structured but incompatible doses still
      // fail atomically so inventory cannot become inconsistent.
      if (occurrenceDose) {
        const inventoryResult = deductInventory(med, occurrenceDose, { allowPartial: true });
        if (inventoryResult.reviewRequired) {
          tx.abort();
          void tx.done.catch(() => undefined);
          throw new MedicationIntakeError(
            'dose-review-required',
            inventoryResult.message ?? `${med.name} 的剂量需要复核`,
          );
        }
        // 库存不足时不再阻塞：allowPartial 已将库存扣至 0，继续记录服药。
        inventoryChanged = inventoryResult.changed;
        inventoryDelta = inventoryResult.changed
          ? (inventoryResult.deductedQuantity ?? occurrenceDose.quantity)
          : undefined;
        lowStock = inventoryResult.low;
        lowStockMessage = inventoryResult.message;
      }
    }
  } else if (previous?.status === 'taken' && action !== 'taken') {
    // Legacy logs without an explicit delta are intentionally not restored.
    // 预扣标记的记录撤销时不回滚库存（药仍分装在药盒格中）。
    if (previous.inventoryDelta != null && !previous.preDeducted) {
      inventoryChanged = restoreInventory(med, previous.inventoryDelta);
    }
  }

  if (inventoryChanged || options.confirmedDose) {
    const prevStock = (med.inventory?.remaining ?? 0) + (action === 'taken' ? (inventoryDelta ?? 0) : -(previous?.inventoryDelta ?? 0));
    med.updatedAt = now;
    await medStore.put(med);
    if (inventoryChanged && med.inventory) {
      const deltaVal = action === 'taken' ? -(inventoryDelta ?? 0) : (previous?.inventoryDelta ?? 0);
      await inventoryLogStore.put({
        id: uid(),
        medId: med.id,
        medName: med.name,
        action: 'deduct',
        previousRemaining: roundStock(prevStock),
        newRemaining: med.inventory.remaining,
        delta: roundStock(deltaVal),
        unit: med.inventory.unit || '片',
        source: options.source ?? 'intake',
        sourceNote: action === 'taken' ? `服药打卡减掉 (${occurrence.localDate} ${occurrence.timeLocal})` : `取消服药打卡恢复库存`,
        timestamp: now,
        canUndo: true,
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
            : inventoryDelta
          : undefined,
      // 若该具体时段已通过分药向导预扣，撤销时不回滚库存。
      preDeducted: action === 'taken' ? occurrencePreDeducted : undefined,
      updatedAt: now,
    };
    await logStore.put(nextLog);
  }
  await tx.done;
  return { med, log: nextLog, inventoryChanged, lowStock, lowStockMessage };
}

/**
 * 判断药品是否在指定日期存在成功的分药预扣。
 * preDeduction 是新版按时段记录；lastPreDeductedAt 仅兼容旧版整日标记。
 */
export function isPreDeductedToday(med: Medication, localDate: LocalDate): boolean {
  if (med.preDeduction?.localDate === localDate && med.preDeduction.occurrenceIds.length > 0) return true;
  return !!med.lastPreDeductedAt && toLocalDate(new Date(med.lastPreDeductedAt)) === localDate;
}

export function isOccurrencePreDeducted(
  med: Medication,
  occurrence: Pick<MedicationOccurrence, 'id' | 'localDate'>,
): boolean {
  if (med.preDeduction?.localDate === occurrence.localDate) {
    return med.preDeduction.occurrenceIds.includes(occurrence.id);
  }
  // 兼容 0.9.1 当天已经产生的整日预扣，避免升级后重复扣一次。
  return !med.preDeduction && isPreDeductedToday(med, occurrence.localDate);
}

export interface PreDeductionEntry {
  occurrenceId: string;
  quantity: number;
  unit: string;
}

export interface PreDeductionResult {
  med: Medication;
  deducted: number;
  deductedOccurrences: number;
  skippedOccurrences: number;
  remaining: number;
  skipped: boolean;
  lowStock: boolean;
  lowStockMessage?: string;
}

/**
 * 按具体服药时段预扣库存。重复运行时只扣新增时段，不恢复已经从原包装取出的药。
 * 有效时段在同一个 IndexedDB 事务中一次性扣减，库存不足时整批不扣。
 */
export async function recordPreDeduction(
  med: Medication,
  entries: readonly PreDeductionEntry[],
  localDate: LocalDate,
): Promise<PreDeductionResult> {
  const skippedResult = (current: Medication, skippedOccurrences = entries.length, lowStockMessage?: string): PreDeductionResult => ({
    med: current,
    deducted: 0,
    deductedOccurrences: 0,
    skippedOccurrences,
    remaining: current.inventory?.remaining ?? 0,
    skipped: true,
    lowStock: lowStockMessage ? true : isLowStock(current),
    lowStockMessage,
  });
  if (!med.inventory || entries.length === 0) return skippedResult(med);

  const d = await db();
  const tx = d.transaction('meds', 'readwrite');
  const medStore = tx.objectStore('meds');
  const fresh = await medStore.get(med.id);
  if (!fresh) {
    tx.abort();
    void tx.done.catch(() => undefined);
    throw new MedicationIntakeError('medication-not-found', '找不到对应药品');
  }
  const latest = normalizeMedication(fresh);
  if (!latest.inventory) {
    tx.abort();
    void tx.done.catch(() => undefined);
    return skippedResult(latest);
  }

  const state = latest.preDeduction?.localDate === localDate ? latest.preDeduction : undefined;
  // 兼容旧版只有整日时间戳的数据；仅影响升级当天。
  if (!state && latest.lastPreDeductedAt && toLocalDate(new Date(latest.lastPreDeductedAt)) === localDate) {
    await tx.done;
    return skippedResult(latest);
  }

  const existingIds = new Set(state?.occurrenceIds ?? []);
  const seenIds = new Set<string>();
  const pending = entries.filter((entry) => {
    const unit = entry.unit.trim();
    if (!entry.occurrenceId || existingIds.has(entry.occurrenceId) || seenIds.has(entry.occurrenceId)) return false;
    seenIds.add(entry.occurrenceId);
    if (!Number.isFinite(entry.quantity) || entry.quantity <= 0 || !unit) return false;
    if (latest.inventory!.unit && !areDoseUnitsCompatible(latest.inventory!.unit, unit)) return false;
    return true;
  });
  if (pending.length === 0) {
    await tx.done;
    return skippedResult(latest);
  }

  const totalDose = roundStock(pending.reduce((sum, entry) => sum + entry.quantity, 0));
  const skippedOccurrences = entries.length - pending.length;
  const doseUnit = latest.inventory.unit?.trim() || pending[0].unit.trim();
  if (latest.inventory.remaining < totalDose) {
    tx.abort();
    void tx.done.catch(() => undefined);
    return skippedResult(
      latest,
      entries.length,
      `${latest.name} 库存不足（本次需 ${totalDose}${doseUnit}，剩余 ${latest.inventory.remaining}${doseUnit}），未执行预扣`,
    );
  }

  const now = Date.now();
  latest.inventory.remaining = roundStock(latest.inventory.remaining - totalDose);
  if (!latest.inventory.unit) latest.inventory.unit = doseUnit;
  latest.preDeduction = {
    localDate,
    occurrenceIds: [...existingIds, ...pending.map((entry) => entry.occurrenceId)],
    totalDose: roundStock((state?.totalDose ?? 0) + totalDose),
    doseUnit,
    updatedAt: now,
  };
  latest.lastPreDeductedAt = now;
  latest.updatedAt = now;
  await medStore.put(latest);
  await tx.done;

  const lowStock = isLowStock(latest);
  return {
    med: latest,
    deducted: totalDose,
    deductedOccurrences: pending.length,
    skippedOccurrences,
    remaining: latest.inventory.remaining,
    skipped: false,
    lowStock,
    lowStockMessage: lowStock
      ? latest.inventory.remaining <= 0
        ? `${latest.name} 已无库存`
        : `${latest.name} 仅剩 ${latest.inventory.remaining}${doseUnit}`
      : undefined,
  };
}

// ---- 药盒原图（仅本地） ----
export async function putPhoto(photo: PhotoBlob): Promise<void> {
  await (await db()).put('photos', photo);
}

export async function getPhotosByMed(medId: string): Promise<PhotoBlob[]> {
  return (await db()).getAllFromIndex('photos', 'byMed', medId);
}

/** 删除某药的全部本地药盒照片（换图/覆盖时调用，避免历史大图占满磁盘和内存） */
export async function deletePhotosByMed(medId: string): Promise<void> {
  const d = await db();
  const photos = await d.getAllFromIndex('photos', 'byMed', medId);
  if (photos.length === 0) return;
  const tx = d.transaction('photos', 'readwrite');
  await Promise.all(photos.map((photo) => tx.store.delete(photo.id)));
  await tx.done;
}

/** 取全部药盒照片（局域网同步可选传输用） */
export async function listAllPhotos(): Promise<PhotoBlob[]> {
  return (await db()).getAll('photos');
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

// ---- 药物库存修改日志与撤回操作 ----
export async function logInventoryOperation(params: {
  medId: string;
  medName: string;
  action: InventoryActionType;
  previousRemaining: number;
  newRemaining: number;
  delta: number;
  unit: string;
  source: InventorySource;
  sourceNote?: string;
  canUndo?: boolean;
  undoneLogId?: string;
  timestamp?: number;
}): Promise<InventoryOperationLog> {
  const log: InventoryOperationLog = {
    id: uid(),
    medId: params.medId,
    medName: params.medName,
    action: params.action,
    previousRemaining: roundStock(params.previousRemaining),
    newRemaining: roundStock(params.newRemaining),
    delta: roundStock(params.delta),
    unit: params.unit || '片',
    source: params.source,
    sourceNote: params.sourceNote,
    timestamp: params.timestamp ?? Date.now(),
    canUndo: params.canUndo ?? true,
    undoneLogId: params.undoneLogId,
  };
  const d = await db();
  await d.put('inventoryLogs', log);
  return log;
}

export async function listInventoryLogs(medId?: string, limit = 100): Promise<InventoryOperationLog[]> {
  const d = await db();
  let logs: InventoryOperationLog[];
  if (medId) {
    logs = await d.getAllFromIndex('inventoryLogs', 'byMed', medId);
  } else {
    logs = await d.getAll('inventoryLogs');
  }
  return logs
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

export async function listRecentInventoryOperations(days = 3): Promise<InventoryOperationLog[]> {
  const d = await db();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const all = await d.getAll('inventoryLogs');
  return all
    .filter((l) => l.timestamp >= cutoff)
    .sort((a, b) => b.timestamp - a.timestamp);
}

export async function undoInventoryOperation(logId: string): Promise<{ ok: boolean; message: string; log?: InventoryOperationLog }> {
  const d = await db();
  const tx = d.transaction(['meds', 'inventoryLogs'], 'readwrite');
  const targetLog = await tx.objectStore('inventoryLogs').get(logId);
  if (!targetLog) {
    tx.abort();
    return { ok: false, message: '找不到对应的修改日志' };
  }
  if (!targetLog.canUndo) {
    tx.abort();
    return { ok: false, message: '该操作已被撤回或不可撤回' };
  }
  const med = await tx.objectStore('meds').get(targetLog.medId);
  if (!med || !med.inventory) {
    tx.abort();
    return { ok: false, message: `找不到药品「${targetLog.medName}」或未设置库存` };
  }

  const previousStock = med.inventory.remaining;
  const restoredStock = roundStock(previousStock - targetLog.delta);
  med.inventory.remaining = restoredStock >= 0 ? restoredStock : 0;
  med.updatedAt = Date.now();
  await tx.objectStore('meds').put(med);

  targetLog.canUndo = false;
  await tx.objectStore('inventoryLogs').put(targetLog);

  const undoLog: InventoryOperationLog = {
    id: uid(),
    medId: med.id,
    medName: med.name,
    action: 'undo',
    previousRemaining: previousStock,
    newRemaining: med.inventory.remaining,
    delta: roundStock(med.inventory.remaining - previousStock),
    unit: med.inventory.unit || targetLog.unit,
    source: 'undo',
    sourceNote: `撤回操作：还原「${targetLog.medName}」之前的变动 (${targetLog.delta > 0 ? '+' : ''}${targetLog.delta}${targetLog.unit})`,
    timestamp: Date.now(),
    canUndo: false,
    undoneLogId: targetLog.id,
  };
  await tx.objectStore('inventoryLogs').put(undoLog);
  await tx.done;

  try {
    const { rescheduleMedicationReminders } = await import('../features/reminderScheduler');
    await rescheduleMedicationReminders();
  } catch { /* ignore */ }
  return {
    ok: true,
    message: `已成功撤回「${targetLog.medName}」的库存变动，恢复为 ${med.inventory.remaining}${med.inventory.unit || ''}`,
    log: undoLog,
  };
}

export async function batchDeductInventory(
  items: Array<{ medId: string; quantity: number }>,
  source: InventorySource = 'batch',
  sourceNote = '批量库存扣减',
): Promise<{ ok: boolean; results: Array<{ medName: string; previous: number; deducted: number; remaining: number; unit: string }> }> {
  const d = await db();
  const tx = d.transaction(['meds', 'inventoryLogs'], 'readwrite');
  const medStore = tx.objectStore('meds');
  const logStore = tx.objectStore('inventoryLogs');
  const now = Date.now();
  const results: Array<{ medName: string; previous: number; deducted: number; remaining: number; unit: string }> = [];

  for (const item of items) {
    if (item.quantity <= 0) continue;
    const medRaw = await medStore.get(item.medId);
    if (!medRaw || !medRaw.inventory) continue;
    const med = normalizeMedication(medRaw);
    if (!med.inventory) continue;
    const prev = med.inventory.remaining;
    const actualDeduct = Math.min(prev, item.quantity);
    const next = roundStock(prev - actualDeduct);
    const unit = med.inventory.unit || '片';

    med.inventory.remaining = next;
    med.updatedAt = now;
    await medStore.put(med);

    const log: InventoryOperationLog = {
      id: uid(),
      medId: med.id,
      medName: med.name,
      action: 'batch_deduct',
      previousRemaining: prev,
      newRemaining: next,
      delta: -actualDeduct,
      unit,
      source,
      sourceNote,
      timestamp: now,
      canUndo: true,
    };
    await logStore.put(log);
    results.push({ medName: med.name, previous: prev, deducted: actualDeduct, remaining: next, unit });
  }

  await tx.done;
  try {
    const { rescheduleMedicationReminders } = await import('../features/reminderScheduler');
    await rescheduleMedicationReminders();
  } catch { /* ignore */ }
  return { ok: true, results };
}
