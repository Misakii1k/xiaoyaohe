import { openMedboxDatabase as db, uid } from '../connection';
import { notifyDataChanged } from '../databaseEvents';
import { areDoseUnitsCompatible, roundStock } from '../../features/inventory';
import type {
  InventoryActionType,
  InventoryOperationLog,
  InventorySource,
  Medication,
} from '../schema';
import { normalizeMedication } from '../normalization';
import {
  MedicationIntakeError,
  MedicationInventoryError,
  type MedicationInventoryErrorCode,
} from '../errors';
import {
  assertExpectedInventory,
  assertExpectedInventoryMetadata,
  effectiveInventoryLogs,
  inventoryMetadata,
  nextInventoryOperationTimestamp,
  type InventoryMetadata,
} from '../inventoryHelpers';
import { revertLinkedIntakeInventoryEffect } from './logsRepo';

export { MedicationInventoryError, type MedicationInventoryErrorCode };

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
  const d = await db();
  const tx = d.transaction('inventoryLogs', 'readwrite');
  const medLogs = await tx.store.index('byMed').getAll(params.medId);
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
    timestamp: nextInventoryOperationTimestamp(medLogs, params.timestamp),
    canUndo: params.canUndo ?? true,
    undoneLogId: params.undoneLogId,
  };
  await tx.store.put(log);
  await tx.done;
  notifyDataChanged('inventory');
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
  const [all, meds, intakes] = await Promise.all([
    d.getAll('inventoryLogs'),
    d.getAll('meds'),
    d.getAll('logs'),
  ]);
  const medById = new Map(meds.map((med) => [med.id, med]));
  const intakeById = new Map(intakes.map((intake) => [intake.id, intake]));
  const latestEffectiveIdByMed = new Map<string, string | undefined>();
  for (const medId of new Set(all.map((log) => log.medId))) {
    latestEffectiveIdByMed.set(
      medId,
      effectiveInventoryLogs(all.filter((log) => log.medId === medId))[0]?.id,
    );
  }
  return all
    .filter((log) => log.timestamp >= cutoff)
    .map((log) => {
      const med = medById.get(log.medId);
      const intake = log.intakeLogId ? intakeById.get(log.intakeLogId) : undefined;
      const intakeLinkValid = log.source !== 'intake' || Boolean(
        log.intakeLogId
        && intake?.status === 'taken'
        && intake.inventoryOperationLogId === log.id
        && Number.isFinite(intake.inventoryDelta)
        && roundStock(intake.inventoryDelta!) === roundStock(-log.delta),
      );
      const currentlyUndoable = Boolean(
        log.canUndo
        && latestEffectiveIdByMed.get(log.medId) === log.id
        && med?.inventory
        && areDoseUnitsCompatible(med.inventory.unit, log.unit)
        && roundStock(med.inventory.remaining) === roundStock(log.newRemaining)
        && intakeLinkValid,
      );
      return { ...log, canUndo: currentlyUndoable };
    })
    .sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id));
}

export interface InventoryCommitResult {
  med: Medication;
  log: InventoryOperationLog;
}

type InventoryMetadataIntent = {
  /** 只有明确修改库存元数据的入口才传；事务内会校验完整旧值，避免陈旧页面覆盖新数据。 */
  metadata?: {
    expected: InventoryMetadata;
    value: InventoryMetadata;
  };
};

export type InventoryUpdateIntent = InventoryMetadataIntent & (
  | {
      action: 'add';
      quantity: number;
      unit: string;
    }
  | {
      action: 'set';
      remaining: number;
      unit: string;
      expectedRemaining: number | undefined;
      expectedUnit: string | undefined;
    }
  | {
      action: 'mark_empty';
      unit?: string;
      expectedRemaining: number | undefined;
      expectedUnit: string | undefined;
    }
);

/** Atomically interprets an inventory intent against the fresh medication and writes its audit log. */
export async function updateMedicationInventory(
  medId: string,
  intent: InventoryUpdateIntent,
  operation: {
    source: Extract<InventorySource, 'manual' | 'ai'>;
    sourceNote?: string;
  },
): Promise<InventoryCommitResult> {
  const d = await db();
  const tx = d.transaction(['meds', 'inventoryLogs'], 'readwrite');
  const medStore = tx.objectStore('meds');
  const logStore = tx.objectStore('inventoryLogs');
  try {
    const raw = await medStore.get(medId);
    if (!raw) throw new MedicationIntakeError('medication-not-found', '找不到对应药品');
    const med = normalizeMedication(raw);
    const previousRemaining = med.inventory?.remaining ?? 0;
    const previousUnit = med.inventory?.unit?.trim();
    let remaining: number;
    let unit: string;

    if (intent.action === 'add') {
      if (!Number.isFinite(intent.quantity) || intent.quantity < 0 || !intent.unit.trim()) {
        throw new MedicationInventoryError('invalid-intent', '补货数量或单位无效');
      }
      if (previousUnit && !areDoseUnitsCompatible(previousUnit, intent.unit)) {
        throw new MedicationInventoryError(
          'unit-conflict',
          `补货单位 ${intent.unit} 与当前库存单位 ${previousUnit} 不一致，请先统一单位`,
        );
      }
      unit = previousUnit || intent.unit.trim();
      remaining = roundStock(previousRemaining + intent.quantity);
    } else {
      assertExpectedInventory(med.inventory, intent.expectedRemaining, intent.expectedUnit);
      remaining = intent.action === 'mark_empty' ? 0 : intent.remaining;
      unit = (intent.unit || previousUnit || '').trim();
      if (!Number.isFinite(remaining) || remaining < 0 || !unit) {
        throw new MedicationInventoryError('invalid-intent', '库存数量或单位无效');
      }
      // 与补货同一套规则：单位不一致时直接拒绝，不能把「20片」悄悄改成「2盒」。
      // mark_empty 只是把剩余清零，单位不参与语义，不拦。
      if (intent.action !== 'mark_empty' && previousUnit && !areDoseUnitsCompatible(previousUnit, unit)) {
        throw new MedicationInventoryError(
          'unit-conflict',
          `单位 ${unit} 与当前库存单位 ${previousUnit} 不一致，请先统一单位再改数量`,
        );
      }
      remaining = roundStock(remaining);
    }

    if (intent.metadata) {
      assertExpectedInventoryMetadata(med.inventory, intent.metadata.expected);
    }
    const metadata = intent.metadata
      ? structuredClone(intent.metadata.value)
      : inventoryMetadata(med.inventory);
    const now = Date.now();
    med.inventory = {
      ...metadata,
      remaining,
      unit,
    };
    med.updatedAt = now;
    const delta = roundStock(remaining - previousRemaining);
    const medLogs = await logStore.index('byMed').getAll(med.id);
    const log: InventoryOperationLog = {
      id: uid(),
      medId: med.id,
      medName: med.name,
      action: intent.action,
      previousRemaining,
      newRemaining: remaining,
      delta,
      unit,
      source: operation.source,
      sourceNote: operation.sourceNote,
      timestamp: nextInventoryOperationTimestamp(medLogs),
      canUndo: delta !== 0 && (!previousUnit || areDoseUnitsCompatible(previousUnit, unit)),
    };
    await medStore.put(med);
    await logStore.put(log);
    await tx.done;
    return { med, log };
  } catch (error) {
    try { tx.abort(); } catch { /* Transaction may already be closed. */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
}

export async function undoInventoryOperation(logId: string): Promise<{ ok: boolean; message: string; log?: InventoryOperationLog }> {
  const d = await db();
  const tx = d.transaction(['meds', 'logs', 'inventoryLogs'], 'readwrite');
  const inventoryLogStore = tx.objectStore('inventoryLogs');
  const reject = async (message: string) => {
    try { tx.abort(); } catch { /* Transaction may already be closed. */ }
    await tx.done.catch(() => undefined);
    return { ok: false as const, message };
  };
  const targetLog = await inventoryLogStore.get(logId);
  if (!targetLog) return reject('找不到对应的修改日志');
  if (!targetLog.canUndo) return reject('该操作已被撤回或不可撤回');
  if (targetLog.source === 'intake' && !targetLog.intakeLogId) {
    return reject('撤回冲突：这条旧服药扣减日志缺少关联记录，不能安全撤回');
  }

  const medLogs = await inventoryLogStore.index('byMed').getAll(targetLog.medId);
  if (effectiveInventoryLogs(medLogs)[0]?.id !== targetLog.id) {
    return reject(`撤回冲突：只能撤回「${targetLog.medName}」最近仍有效的库存操作`);
  }

  if (targetLog.source === 'intake') {
    const linkedIntake = await tx.objectStore('logs').get(targetLog.intakeLogId!);
    if (!linkedIntake) return reject('撤回冲突：关联的服药记录不存在');
    try {
      const reverted = await revertLinkedIntakeInventoryEffect(linkedIntake, {
        getMedication: (medId) => tx.objectStore('meds').get(medId),
        putMedication: (value) => tx.objectStore('meds').put(value),
        getInventoryLog: (id) => inventoryLogStore.get(id),
        listMedicationInventoryLogs: (medId) => inventoryLogStore.index('byMed').getAll(medId),
        putInventoryLog: (value) => inventoryLogStore.put(value),
      }, { conflict: 'throw' });
      if (!reverted.restored || !reverted.med?.inventory || !reverted.auditLog) {
        return reject('撤回冲突：关联的服药库存效果无法恢复');
      }
      await tx.objectStore('logs').put(linkedIntake);
      await tx.done;
      return {
        ok: true,
        message: `已成功撤回「${targetLog.medName}」的库存变动，恢复为 ${reverted.med.inventory.remaining}${reverted.med.inventory.unit}`,
        log: reverted.auditLog,
      };
    } catch (error) {
      return reject(error instanceof Error ? error.message : '撤回冲突：关联的服药库存效果无法恢复');
    }
  }

  const med = await tx.objectStore('meds').get(targetLog.medId);
  if (!med || !med.inventory) {
    return reject(`找不到药品「${targetLog.medName}」或未设置库存`);
  }
  if (!areDoseUnitsCompatible(med.inventory.unit, targetLog.unit)) {
    return reject(`撤回冲突：当前库存单位为 ${med.inventory.unit}，日志单位为 ${targetLog.unit}`);
  }
  if (roundStock(med.inventory.remaining) !== roundStock(targetLog.newRemaining)) {
    return reject(`撤回冲突：当前库存为 ${med.inventory.remaining}${med.inventory.unit}，与日志记录的 ${targetLog.newRemaining}${targetLog.unit} 不一致`);
  }
  const now = Date.now();
  const previousStock = med.inventory.remaining;
  med.inventory.remaining = roundStock(targetLog.previousRemaining);
  med.updatedAt = now;
  await tx.objectStore('meds').put(med);

  targetLog.canUndo = false;
  await inventoryLogStore.put(targetLog);

  const undoLog: InventoryOperationLog = {
    id: uid(),
    medId: med.id,
    medName: med.name,
    action: 'undo',
    previousRemaining: previousStock,
    newRemaining: med.inventory.remaining,
    delta: roundStock(med.inventory.remaining - previousStock),
    unit: med.inventory.unit,
    source: 'undo',
    sourceNote: `撤回操作：还原「${targetLog.medName}」之前的变动 (${targetLog.delta > 0 ? '+' : ''}${targetLog.delta}${targetLog.unit})`,
    timestamp: nextInventoryOperationTimestamp(medLogs),
    canUndo: false,
    undoneLogId: targetLog.id,
    intakeLogId: targetLog.intakeLogId,
  };
  await inventoryLogStore.put(undoLog);
  await tx.done;
  notifyDataChanged('inventory');

  try {
    const { rescheduleMedicationReminders } = await import('../../features/reminderScheduler');
    await rescheduleMedicationReminders();
  } catch { /* ignore */ }
  return {
    ok: true,
    message: `已成功撤回「${targetLog.medName}」的库存变动，恢复为 ${med.inventory.remaining}${med.inventory.unit}`,
    log: undoLog,
  };
}

export interface BatchInventoryCommitItem {
  medId: string;
  medName: string;
  previous: number;
  deducted: number;
  remaining: number;
  unit: string;
}

export async function batchDeductInventory(
  requests: Array<{ medId: string; quantity: number }>,
  source: InventorySource = 'batch',
  sourceNote = '批量库存扣减',
): Promise<{ ok: boolean; items: BatchInventoryCommitItem[] }> {
  const d = await db();
  const tx = d.transaction(['meds', 'inventoryLogs'], 'readwrite');
  const medStore = tx.objectStore('meds');
  const logStore = tx.objectStore('inventoryLogs');
  const now = Date.now();
  const items: BatchInventoryCommitItem[] = [];
  const totalsByMedId = new Map<string, number>();
  for (const request of requests) {
    if (!request.medId || !Number.isFinite(request.quantity) || request.quantity <= 0) continue;
    totalsByMedId.set(
      request.medId,
      roundStock((totalsByMedId.get(request.medId) ?? 0) + request.quantity),
    );
  }

  for (const [medId, quantity] of totalsByMedId) {
    const medRaw = await medStore.get(medId);
    if (!medRaw?.inventory) continue;
    const med = normalizeMedication(medRaw);
    if (!med.inventory) continue;
    const previous = med.inventory.remaining;
    const deducted = roundStock(Math.min(previous, quantity));
    if (deducted <= 0) continue;
    const remaining = roundStock(previous - deducted);
    const unit = med.inventory.unit || '片';
    const medLogs = await logStore.index('byMed').getAll(med.id);

    med.inventory.remaining = remaining;
    med.updatedAt = now;
    await medStore.put(med);
    await logStore.put({
      id: uid(),
      medId: med.id,
      medName: med.name,
      action: 'batch_deduct',
      previousRemaining: previous,
      newRemaining: remaining,
      delta: roundStock(-deducted),
      unit,
      source,
      sourceNote,
      timestamp: nextInventoryOperationTimestamp(medLogs),
      canUndo: true,
    });
    items.push({ medId: med.id, medName: med.name, previous, deducted, remaining, unit });
  }

  await tx.done;
  notifyDataChanged('inventory');
  try {
    const { rescheduleMedicationReminders } = await import('../../features/reminderScheduler');
    await rescheduleMedicationReminders();
  } catch { /* ignore */ }
  return { ok: true, items };
}
