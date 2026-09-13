import { openMedboxDatabase as db, type ImportBucketResult, type MedImportResult } from '../connection';
import { notifyDataChanged } from '../databaseEvents';
import { freezeScheduleRevision } from '../../domain/medicationSchedule';
import {
  inflateMed,
  type IntakeLog,
  type Medication,
  type MedicationScheduleRevision,
  type ReminderRule,
  type Slot,
} from '../schema';

export { type ImportBucketResult, type MedImportResult };

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
    delete (incoming as { mealRel?: unknown }).mealRel;
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
    // Backup inventory operation IDs are device-local and can never be trusted
    // on another database. Keep inventoryDelta only as legacy history; clearing
    // such an intake will conservatively avoid restoring unverifiable stock.
    delete incoming.inventoryOperationLogId;
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
  notifyDataChanged('all');
  return result;
}
