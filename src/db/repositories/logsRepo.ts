import type { IDBPTransaction } from 'idb';
import { openMedboxDatabase as db, uid, type MedboxDB } from '../connection';
import { notifyDataChanged } from '../databaseEvents';
import {
  createScheduleRevision,
  getMedicationExpiryLocalDate,
  isMedicationExpiredOn,
  toLocalDate,
} from '../../domain/medicationSchedule';
import {
  areDoseUnitsCompatible,
  deductInventory,
  getConfirmedDose,
  isLowStock,
  roundStock,
} from '../../features/inventory';
import type {
  IntakeLog,
  InventoryOperationLog,
  InventorySource,
  LocalDate,
  Medication,
  MedicationOccurrence,
  MedicationScheduleRevision,
  ReminderRule,
  StructuredDose,
} from '../schema';
import { normalizeMedication } from '../normalization';
import { MedicationIntakeError, type MedicationIntakeErrorCode } from '../errors';
import {
  effectiveInventoryLogs,
  nextInventoryOperationTimestamp,
} from '../inventoryHelpers';

export { MedicationIntakeError, type MedicationIntakeErrorCode };

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
  notifyDataChanged('logs');
}

export type IntakeAction = 'taken' | 'skipped';

export interface IntakeMutationResult {
  med: Medication;
  log?: IntakeLog;
  inventoryChanged: boolean;
  lowStock: boolean;
  lowStockMessage?: string;
}

export interface IntakeInventoryEffectAccess {
  getMedication: (medId: string) => Promise<Medication | undefined>;
  putMedication: (med: Medication) => Promise<unknown>;
  getInventoryLog: (logId: string) => Promise<InventoryOperationLog | undefined>;
  listMedicationInventoryLogs: (medId: string) => Promise<InventoryOperationLog[]>;
  putInventoryLog: (log: InventoryOperationLog) => Promise<unknown>;
}

export interface IntakeInventoryEffectRevertResult {
  restored: boolean;
  conflict?: string;
  med?: Medication;
  auditLog?: InventoryOperationLog;
}

/**
 * Reverts a device-local intake inventory effect only when every durable link
 * and current-state invariant still matches. Legacy deltas without a linked
 * operation are deliberately not restored because their stock baseline cannot
 * be verified.
 */
export async function revertLinkedIntakeInventoryEffect(
  intake: IntakeLog,
  access: IntakeInventoryEffectAccess,
  options: { conflict: 'throw' | 'detach'; now?: number } = { conflict: 'throw' },
): Promise<IntakeInventoryEffectRevertResult> {
  if (intake.status !== 'taken' || intake.preDeducted) return { restored: false };
  const hasDelta = Number.isFinite(intake.inventoryDelta) && (intake.inventoryDelta ?? 0) > 0;
  const linkedLogId = intake.inventoryOperationLogId;
  if (!hasDelta && !linkedLogId) return { restored: false };

  const linkedLog = linkedLogId ? await access.getInventoryLog(linkedLogId) : undefined;
  const med = await access.getMedication(intake.medId);
  const medLogs = linkedLog ? await access.listMedicationInventoryLogs(intake.medId) : [];
  let conflict: string | undefined;
  if (!hasDelta || !linkedLogId || !linkedLog) {
    conflict = '关联的库存日志不存在，无法确认当前库存状态';
  } else if (!linkedLog.canUndo) {
    conflict = '关联的库存操作已失效或已撤回';
  } else if (
    linkedLog.intakeLogId !== intake.id
    || linkedLog.medId !== intake.medId
    || linkedLog.action !== 'deduct'
    || roundStock(-linkedLog.delta) !== roundStock(intake.inventoryDelta!)
    || roundStock(linkedLog.previousRemaining - linkedLog.newRemaining) !== roundStock(intake.inventoryDelta!)
  ) {
    conflict = '服药记录与库存日志的双向关联不一致';
  } else if (effectiveInventoryLogs(medLogs)[0]?.id !== linkedLog.id) {
    conflict = '关联的库存扣减不是该药最近仍有效的库存操作';
  } else if (!med?.inventory) {
    conflict = '药品当前未设置库存';
  } else if (!areDoseUnitsCompatible(med.inventory.unit, linkedLog.unit)) {
    conflict = `当前库存单位为 ${med.inventory.unit}，日志单位为 ${linkedLog.unit}`;
  } else if (roundStock(med.inventory.remaining) !== roundStock(linkedLog.newRemaining)) {
    conflict = `当前库存为 ${med.inventory.remaining}${med.inventory.unit}，与日志记录的 ${linkedLog.newRemaining}${linkedLog.unit} 不一致`;
  }

  if (conflict) {
    if (options.conflict === 'throw') {
      throw new MedicationIntakeError('inventory-effect-conflict', `库存恢复冲突：${conflict}`);
    }
    // A LAN status still wins, but this phone must drop the unverifiable local
    // effect and make any surviving linked operation non-undoable.
    delete intake.inventoryDelta;
    delete intake.inventoryOperationLogId;
    if (linkedLog?.canUndo) {
      linkedLog.canUndo = false;
      await access.putInventoryLog(linkedLog);
    }
    return { restored: false, conflict };
  }

  const currentMed = med!;
  const currentInventory = currentMed.inventory!;
  const previousRemaining = currentInventory.remaining;
  currentInventory.remaining = roundStock(linkedLog!.previousRemaining);
  currentMed.updatedAt = options.now ?? Date.now();
  linkedLog!.canUndo = false;
  const auditLog: InventoryOperationLog = {
    id: uid(),
    medId: currentMed.id,
    medName: currentMed.name,
    action: 'undo',
    previousRemaining,
    newRemaining: currentInventory.remaining,
    delta: roundStock(currentInventory.remaining - previousRemaining),
    unit: currentInventory.unit,
    source: 'undo',
    sourceNote: '取消服药记录，恢复对应库存扣减',
    timestamp: nextInventoryOperationTimestamp(medLogs, options.now),
    canUndo: false,
    undoneLogId: linkedLog!.id,
    intakeLogId: intake.id,
  };
  delete intake.inventoryDelta;
  delete intake.inventoryOperationLogId;
  await access.putMedication(currentMed);
  await access.putInventoryLog(linkedLog!);
  await access.putInventoryLog(auditLog);
  return { restored: true, med: currentMed, auditLog };
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
  try {
    const result = await applyOccurrenceAction(buildOccurrenceActionAccess(tx), occurrence, action, options);
    await tx.done;
    notifyDataChanged('logs');
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* Transaction may already be closed. */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
}

/**
 * 批量版本：同一事务内逐条应用（供“全部已服用”等场景），任一条失败则整批回滚。
 * 同一药品的多条 occurrence 在事务内共享同一条最新药品记录（库存/剂量逐条生效）。
 */
export async function setOccurrenceActions(
  occurrences: readonly MedicationOccurrence[],
  action: IntakeAction | undefined,
  options: { ackAt?: number; confirmedDose?: StructuredDose; source?: InventorySource } = {},
): Promise<IntakeMutationResult[]> {
  if (occurrences.length === 0) return [];
  const d = await db();
  const tx = d.transaction(['meds', 'rules', 'scheduleRevisions', 'logs', 'inventoryLogs'], 'readwrite');
  try {
    const access = buildOccurrenceActionAccess(tx);
    const results: IntakeMutationResult[] = [];
    for (const occurrence of occurrences) {
      results.push(await applyOccurrenceAction(access, occurrence, action, options));
    }
    await tx.done;
    notifyDataChanged('logs');
    return results;
  } catch (error) {
    try { tx.abort(); } catch { /* Transaction may already be closed. */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
}

/** 单个事务内对药品/日志/库存等 store 的访问器（单条与批量动作共用）。 */
interface OccurrenceActionAccess {
  getMedication(medId: string): Promise<Medication | undefined>;
  putMedication(value: Medication): Promise<void>;
  getLog(logId: string): Promise<IntakeLog | undefined>;
  putLog(value: IntakeLog): Promise<void>;
  deleteLog(logId: string): Promise<void>;
  getInventoryLog(logId: string): Promise<InventoryOperationLog | undefined>;
  listMedicationInventoryLogs(medId: string): Promise<InventoryOperationLog[]>;
  putInventoryLog(value: InventoryOperationLog): Promise<void>;
  listRulesByMed(medId: string): Promise<ReminderRule[]>;
  putScheduleRevision(value: MedicationScheduleRevision): Promise<void>;
  abort(): void;
}

function buildOccurrenceActionAccess(
  tx: IDBPTransaction<MedboxDB, ['meds', 'rules', 'scheduleRevisions', 'logs', 'inventoryLogs'], 'readwrite'>,
): OccurrenceActionAccess {
  const medStore = tx.objectStore('meds');
  const logStore = tx.objectStore('logs');
  const inventoryLogStore = tx.objectStore('inventoryLogs');
  const rulesStore = tx.objectStore('rules');
  const revisionsStore = tx.objectStore('scheduleRevisions');
  return {
    getMedication: async (medId) => {
      const value = await medStore.get(medId);
      return value ? normalizeMedication(value) : undefined;
    },
    putMedication: async (value) => { await medStore.put(value); },
    getLog: (logId) => logStore.get(logId),
    putLog: async (value) => { await logStore.put(value); },
    deleteLog: (logId) => logStore.delete(logId),
    getInventoryLog: (logId) => inventoryLogStore.get(logId),
    listMedicationInventoryLogs: (medId) => inventoryLogStore.index('byMed').getAll(medId),
    putInventoryLog: async (value) => { await inventoryLogStore.put(value); },
    listRulesByMed: (medId) => rulesStore.index('byMed').getAll(medId),
    putScheduleRevision: async (value) => { await revisionsStore.put(value); },
    abort: () => { try { tx.abort(); } catch { /* Transaction may already be closed. */ } },
  };
}

/** 单条 occurrence 动作的事务内实现（单条与批量共用）。失败时回滚整个事务并抛出。 */
async function applyOccurrenceAction(
  access: OccurrenceActionAccess,
  occurrence: MedicationOccurrence,
  action: IntakeAction | undefined,
  options: { ackAt?: number; confirmedDose?: StructuredDose; source?: InventorySource } = {},
): Promise<IntakeMutationResult> {
  const med = await access.getMedication(occurrence.medId);
  if (!med) {
    access.abort();
    throw new MedicationIntakeError('medication-not-found', '找不到对应药品');
  }
  const [currentLog, legacyLog] = await Promise.all([
    access.getLog(occurrence.id),
    access.getLog(occurrence.legacyLogId),
  ]);
  const previous = currentLog && legacyLog
    ? currentLog.updatedAt >= legacyLog.updatedAt
      ? currentLog
      : legacyLog
    : currentLog ?? legacyLog;
  const now = options.ackAt ?? Date.now();
  let inventoryChanged = false;
  let inventoryDelta: number | undefined;
  let inventoryOperationLogId: string | undefined;
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
      access.abort();
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
          access.abort();
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
    // 预扣标记的记录撤销时不回滚库存（药仍分装在药盒格中）。
    if (!previous.preDeducted && (previous.inventoryDelta != null || previous.inventoryOperationLogId)) {
      try {
        const reverted = await revertLinkedIntakeInventoryEffect(previous, {
          getMedication: access.getMedication,
          putMedication: access.putMedication,
          getInventoryLog: access.getInventoryLog,
          listMedicationInventoryLogs: access.listMedicationInventoryLogs,
          putInventoryLog: access.putInventoryLog,
        }, { conflict: 'throw', now });
        inventoryChanged = reverted.restored;
        // revert 已把恢复后的库存写入 store；同步本地快照，避免下面
        // 统一 putMedication(med) 把撤销前的旧剩余量回写回去。
        if (inventoryChanged) {
          const fresh = await access.getMedication(med.id);
          if (fresh?.inventory) med.inventory = fresh.inventory;
        }
      } catch (error) {
        access.abort();
        throw error;
      }
    }
  }

  if (inventoryChanged || options.confirmedDose) {
    const prevStock = roundStock((med.inventory?.remaining ?? 0) + (action === 'taken' ? (inventoryDelta ?? 0) : 0));
    med.updatedAt = now;
    await access.putMedication(med);
    if (inventoryChanged && med.inventory && action === 'taken') {
      const medLogs = await access.listMedicationInventoryLogs(med.id);
      const operationId = uid();
      await access.putInventoryLog({
        id: operationId,
        medId: med.id,
        medName: med.name,
        action: 'deduct',
        previousRemaining: prevStock,
        newRemaining: med.inventory.remaining,
        delta: roundStock(-(inventoryDelta ?? 0)),
        unit: med.inventory.unit || '片',
        source: options.source ?? 'intake',
        sourceNote: `服药打卡减掉 (${occurrence.localDate} ${occurrence.timeLocal})`,
        timestamp: nextInventoryOperationTimestamp(medLogs),
        canUndo: true,
        intakeLogId: occurrence.id,
      });
      inventoryOperationLogId = operationId;
    }
    if (options.confirmedDose) {
      const rules = await access.listRulesByMed(med.id);
      for (const rule of rules) {
        await access.putScheduleRevision(
          createScheduleRevision(med, rule, {
            effectiveDate: occurrence.localDate,
            createdAt: now,
          }),
        );
      }
    }
  }

  if (currentLog) await access.deleteLog(currentLog.id);
  if (legacyLog && legacyLog.id !== currentLog?.id) await access.deleteLog(legacyLog.id);

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
      inventoryOperationLogId:
        action === 'taken'
          ? previous?.status === 'taken'
            ? previous.inventoryOperationLogId
            : inventoryOperationLogId
          : undefined,
      // 若该具体时段已通过分药向导预扣，撤销时不回滚库存。
      preDeducted: action === 'taken' ? occurrencePreDeducted : undefined,
      updatedAt: now,
    };
    await access.putLog(nextLog);
  }
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
  const tx = d.transaction(['meds', 'inventoryLogs'], 'readwrite');
  const medStore = tx.objectStore('meds');
  const inventoryLogStore = tx.objectStore('inventoryLogs');
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
  const inventoryUnit = latest.inventory.unit?.trim();
  let baselineUnit = inventoryUnit || '';
  const pending = entries.filter((entry) => {
    const unit = entry.unit.trim();
    if (!entry.occurrenceId || existingIds.has(entry.occurrenceId) || seenIds.has(entry.occurrenceId)) return false;
    seenIds.add(entry.occurrenceId);
    if (!Number.isFinite(entry.quantity) || entry.quantity <= 0 || !unit) return false;
    if (!baselineUnit) baselineUnit = unit;
    return areDoseUnitsCompatible(baselineUnit, unit);
  });
  if (pending.length === 0) {
    await tx.done;
    return skippedResult(latest);
  }

  const totalDose = roundStock(pending.reduce((sum, entry) => sum + entry.quantity, 0));
  const skippedOccurrences = entries.length - pending.length;
  const firstPending = pending[0];
  if (!firstPending) return skippedResult(latest);
  const doseUnit = baselineUnit || firstPending.unit.trim();
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
  const previousRemaining = latest.inventory.remaining;
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
  const medLogs = await inventoryLogStore.index('byMed').getAll(latest.id);
  await inventoryLogStore.put({
    id: uid(),
    medId: latest.id,
    medName: latest.name,
    action: 'deduct',
    previousRemaining,
    newRemaining: latest.inventory.remaining,
    delta: roundStock(-totalDose),
    unit: doseUnit,
    source: 'wizard',
    sourceNote: `分药向导预扣 ${localDate}（${pending.length} 个时段）`,
    timestamp: nextInventoryOperationTimestamp(medLogs),
    // 已取出的药仍在药盒格中，不能通过库存历史撤回后再由打卡恢复。
    canUndo: false,
  });
  await tx.done;
  notifyDataChanged('inventory');

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
