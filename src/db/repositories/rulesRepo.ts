import { openMedboxDatabase as db } from '../connection';
import {
  createScheduleRevision,
  freezeScheduleRevision,
  isLocalDate,
  toLocalDate,
} from '../../domain/medicationSchedule';
import type {
  MedicationScheduleRevision,
  ReminderRule,
} from '../schema';
import { normalizeMedication } from '../normalization';

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
