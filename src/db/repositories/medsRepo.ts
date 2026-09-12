import { openMedboxDatabase as db, uid } from '../connection';
import { notifyDataChanged } from '../databaseEvents';
import {
  createScheduleRevision,
  toLocalDate,
} from '../../domain/medicationSchedule';
import {
  areDoseUnitsCompatible,
  roundStock,
} from '../../features/inventory';
import {
  defaultEscalate,
  type InventoryOperationLog,
  type Medication,
  type MedicationReminderMode,
  type ReminderRule,
} from '../schema';
import {
  validateMedicationDraft,
  type MedicationCreateDraft,
} from '../../domain/medicationDraft';
import { normalizeMedication } from '../normalization';
import {
  MedicationBatchValidationError,
  MedicationIntakeError,
  MedicationInventoryError,
} from '../errors';
import {
  assertExpectedInventory,
  assertExpectedInventoryMetadata,
  canonicalJson,
  inventoryMetadata,
  nextInventoryOperationTimestamp,
} from '../inventoryHelpers';

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
  const next: Medication & { mealRel?: unknown } = normalizeMedication({ ...med });
  next.updatedAt = Date.now();
  // 清理旧字段，避免 IndexedDB 里残留
  delete next.mealRel;
  await (await db()).put('meds', next);
  notifyDataChanged('meds');
}

export interface MedicationReminderModeUpdateResult {
  medId: string;
  medName: string;
  previousMode: MedicationReminderMode;
  mode: MedicationReminderMode;
  changed: boolean;
}

/** 只覆盖提醒方式；任一目标不存在或已删除时整批事务回滚。 */
export async function updateMedicationReminderModes(
  medIds: readonly string[],
  mode: MedicationReminderMode,
): Promise<MedicationReminderModeUpdateResult[]> {
  const uniqueIds = [...new Set(medIds.filter(Boolean))];
  if (uniqueIds.length === 0) return [];
  const d = await db();
  const tx = d.transaction('meds', 'readwrite');
  const store = tx.objectStore('meds');
  const results: MedicationReminderModeUpdateResult[] = [];
  try {
    const records = await Promise.all(uniqueIds.map((id) => store.get(id)));
    const missingIndex = records.findIndex((record) => !record || record.deleted);
    if (missingIndex >= 0) {
      throw new Error(`找不到要修改的药品（${uniqueIds[missingIndex]}），本次未更改任何提醒方式`);
    }
    const now = Date.now();
    for (const record of records) {
      const med = normalizeMedication(record!);
      const previousMode = med.reminderMode;
      const changed = previousMode !== mode;
      if (changed) {
        med.reminderMode = mode;
        med.updatedAt = now;
        await store.put(med);
      }
      results.push({ medId: med.id, medName: med.name, previousMode, mode, changed });
    }
    await tx.done;
    notifyDataChanged('meds');
    return results;
  } catch (error) {
    try { tx.abort(); } catch { /* Transaction may already be closed. */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
}

function inventoriesEqual(left: Medication['inventory'], right: Medication['inventory']): boolean {
  if (!left || !right) return left === right;
  return left.remaining === right.remaining
    && left.unit === right.unit
    && left.packageQuantity === right.packageQuantity
    && left.lowThreshold === right.lowThreshold
    && left.sourceNote === right.sourceNote
    && left.lastReminderAt === right.lastReminderAt
    && left.dailyConsumption === right.dailyConsumption;
}

export interface MedicationProfileCommitResult {
  med: Medication;
  inventoryLog?: InventoryOperationLog;
}

function medicationProfileSnapshot(med: Medication): unknown {
  return {
    id: med.id,
    name: med.name,
    dosageText: med.dosageText,
    amountPerDose: med.amountPerDose,
    doseQuantity: med.doseQuantity,
    doseUnit: med.doseUnit,
    doseSourceText: med.doseSourceText,
    doseMigrationSuggestion: med.doseMigrationSuggestion,
    doseReviewRequired: med.doseReviewRequired,
    slots: med.slots,
    mealRels: med.mealRels,
    mealRelsBySlot: med.mealRelsBySlot,
    daysOfWeek: med.daysOfWeek,
    reminderMode: med.reminderMode,
    notes: med.notes,
    expiryDate: med.expiryDate,
    expiryLocalDate: med.expiryLocalDate,
    expirySourceTimestamp: med.expirySourceTimestamp,
    identity: med.identity,
    createdAt: med.createdAt,
    deleted: med.deleted,
  };
}

function assertExpectedMedicationProfile(current: Medication, expected: Medication): void {
  if (canonicalJson(medicationProfileSnapshot(current)) !== canonicalJson(medicationProfileSnapshot(expected))) {
    throw new MedicationInventoryError(
      'profile-conflict',
      '药品资料已被其他操作更新，请刷新后重新编辑',
    );
  }
}

/**
 * Saves the editable medication profile against a fresh record. Unchanged stale
 * inventory is preserved; an intentional inventory edit uses an optimistic
 * baseline check and writes its manual audit log in the same transaction.
 */
export async function saveMedicationProfile(
  draft: Medication,
  options:
    | { isNew: true }
    | { isNew: false; expectedInventory?: Medication['inventory']; expectedProfile: Medication },
): Promise<MedicationProfileCommitResult> {
  const d = await db();
  const tx = d.transaction(['meds', 'inventoryLogs'], 'readwrite');
  const medStore = tx.objectStore('meds');
  const inventoryLogStore = tx.objectStore('inventoryLogs');
  try {
    const stored = await medStore.get(draft.id);
    if (options.isNew) {
      if (stored) throw new MedicationInventoryError('inventory-conflict', '该药品已存在，请刷新后重试');
      const created = normalizeMedication(structuredClone(draft));
      created.updatedAt = Date.now();
      delete (created as Medication & { mealRel?: unknown }).mealRel;
      await medStore.put(created);
      await tx.done;
      return { med: created };
    }
    if (!stored) throw new MedicationIntakeError('medication-not-found', '找不到对应药品');

    const fresh = normalizeMedication(stored);
    assertExpectedMedicationProfile(fresh, options.expectedProfile);
    const inventoryEdited = !inventoriesEqual(draft.inventory, options.expectedInventory);
    let committedInventory = fresh.inventory ? structuredClone(fresh.inventory) : undefined;
    let inventoryLog: InventoryOperationLog | undefined;
    if (inventoryEdited) {
      assertExpectedInventory(
        fresh.inventory,
        options.expectedInventory?.remaining,
        options.expectedInventory?.unit,
      );
      assertExpectedInventoryMetadata(fresh.inventory, inventoryMetadata(options.expectedInventory));
      if (draft.inventory && (
        !Number.isFinite(draft.inventory.remaining)
        || draft.inventory.remaining < 0
        || !draft.inventory.unit.trim()
      )) {
        throw new MedicationInventoryError('invalid-intent', '库存数量或单位无效');
      }
      committedInventory = draft.inventory
        ? { ...structuredClone(draft.inventory), remaining: roundStock(draft.inventory.remaining), unit: draft.inventory.unit.trim() }
        : undefined;
      const previousRemaining = fresh.inventory?.remaining ?? 0;
      const nextRemaining = committedInventory?.remaining ?? 0;
      const delta = roundStock(nextRemaining - previousRemaining);
      const medLogs = await inventoryLogStore.index('byMed').getAll(fresh.id);
      inventoryLog = {
        id: uid(),
        medId: fresh.id,
        medName: draft.name,
        action: nextRemaining === 0 && previousRemaining > 0 ? 'mark_empty' : delta > 0 ? 'add' : 'set',
        previousRemaining,
        newRemaining: nextRemaining,
        delta,
        unit: committedInventory?.unit || fresh.inventory?.unit || '片',
        source: 'manual',
        sourceNote: '编辑药品时修改库存',
        timestamp: nextInventoryOperationTimestamp(medLogs),
        canUndo: delta !== 0 && Boolean(
          fresh.inventory
          && committedInventory
          && areDoseUnitsCompatible(fresh.inventory.unit, committedInventory.unit),
        ),
      };
    }

    const committed = normalizeMedication({
      ...fresh,
      ...structuredClone(draft),
      // 分药预扣由库存事务维护，不属于编辑页草稿；保存资料时始终保留数据库新值。
      preDeduction: fresh.preDeduction ? structuredClone(fresh.preDeduction) : undefined,
      lastPreDeductedAt: fresh.lastPreDeductedAt,
      inventory: committedInventory,
      updatedAt: Date.now(),
    });
    delete (committed as Medication & { mealRel?: unknown }).mealRel;
    await medStore.put(committed);
    if (inventoryLog) await inventoryLogStore.put(inventoryLog);
    await tx.done;
    return { med: committed, inventoryLog };
  } catch (error) {
    try { tx.abort(); } catch { /* Transaction may already be closed. */ }
    await tx.done.catch(() => undefined);
    throw error;
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
  notifyDataChanged('meds');
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
  notifyDataChanged('meds');
}
