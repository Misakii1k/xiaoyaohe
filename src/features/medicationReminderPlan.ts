import {
  SLOT_LABEL,
  formatMealRels,
  type IntakeLog,
  type Medication,
  type MedicationScheduleRevision,
  type ReminderRule,
  type Slot,
} from '../db/schema';
import {
  addLocalDays,
  findLogForOccurrence,
  generateOccurrences,
  isMedicationExpiredOn,
  toLocalDate,
} from '../domain/medicationSchedule';
import type { ScheduledReminderNotification } from './reminderTransport';

// 真机 Android 闹钟上限约 500；预排窗口与重复次数必须压在安全范围内
const DEFAULT_HORIZON_DAYS = 7;
const MAX_REPEATS_PER_OCCURRENCE = 3;

export interface MedicationReminderPlanInput {
  meds: readonly Medication[];
  rules: readonly ReminderRule[];
  revisions: readonly MedicationScheduleRevision[];
  logs: readonly IntakeLog[];
  now?: number;
  horizonDays?: number;
  role?: 'patient' | 'caregiver';
}

/** Build a deterministic OS schedule. No database or plugin calls occur here. */
export function buildMedicationReminderPlan({
  meds,
  rules,
  revisions,
  logs,
  now = Date.now(),
  horizonDays = DEFAULT_HORIZON_DAYS,
  role,
}: MedicationReminderPlanInput): ScheduledReminderNotification[] {
  const startDate = toLocalDate(now);
  const days = Math.max(1, Math.min(60, Math.floor(horizonDays)));
  const endDate = addLocalDays(startDate, days - 1);
  const medById = new Map(meds.map((med) => [med.id, med]));
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
  const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
  const notifications: ScheduledReminderNotification[] = [];

  for (const occurrence of generateOccurrences(revisions, startDate, endDate)) {
    const med = medById.get(occurrence.medId);
    const rule = ruleById.get(occurrence.sourceRuleId);
    const revision = revisionById.get(occurrence.scheduleRevisionId);
    if (!med || !rule || !revision || isMedicationExpiredOn(med, occurrence.localDate)) continue;
    const log = findLogForOccurrence(occurrence, logs);
    if (log?.status === 'taken' || log?.status === 'skipped') continue;

    if (role === 'caregiver') {
      const at = occurrence.dueAt + safeMinutes(rule.escalate.notifyCaregiverAfterMin) * 60_000;
      if (at <= now) continue;
      notifications.push({
        at,
        title: '⚠️ 患者未确认服药',
        body: `${med.name}（${SLOT_LABEL[rule.slot]}）已超 ${safeMinutes(rule.escalate.notifyCaregiverAfterMin)} 分钟未确认`,
        tag: occurrence.id + '_care',
        key: 'care',
        data: {
          kind: 'escalate',
          logId: occurrence.id,
          occurrenceId: occurrence.id,
          medId: med.id,
        },
      });
      continue;
    }

    const repeatEveryMin = Math.max(1, safeMinutes(rule.escalate.repeatEveryMin));
    const repeatCount = Math.min(
      MAX_REPEATS_PER_OCCURRENCE,
      Math.max(0, Math.floor(rule.escalate.maxRepeats)),
    );
    for (let index = 0; index <= repeatCount; index += 1) {
      const count = index + 1;
      const at = occurrence.dueAt + index * repeatEveryMin * 60_000;
      if (at <= now) continue;
      notifications.push({
        at,
        title: buildReminderTitle(med, count),
        body: buildReminderBody(med, revision, index * repeatEveryMin),
        tag: occurrence.id,
        key: count === 1 ? 'dose' : `repeat-${count}`,
        data: {
          kind: 'reminder',
          logId: occurrence.id,
          occurrenceId: occurrence.id,
          medId: med.id,
          reminderCount: count,
        },
      });
    }
  }

  return notifications.sort((left, right) => left.at - right.at || left.tag.localeCompare(right.tag));
}

export function buildReminderTitle(med: Medication, count: number): string {
  const icon = count === 1 ? '🔔' : count === 2 ? '⚠️' : '‼️';
  const prefix = count >= 3 ? `第 ${count} 次提醒` : '';
  return `${icon} ${prefix ? prefix + ' · ' : ''}该吃 ${med.name} 了`;
}

export function buildReminderBody(
  med: Medication,
  revision: MedicationScheduleRevision,
  minsLate: number,
): string {
  const parts: string[] = [];
  if (revision.doseQuantity && revision.doseUnit) {
    parts.push(`每次 ${revision.doseQuantity}${revision.doseUnit}`);
  } else if (med.amountPerDose) parts.push('每次 ' + med.amountPerDose);
  else if (med.dosageText) parts.push(med.dosageText);
  const meal = formatMealRels([...revision.mealRels]);
  if (meal) parts.push(meal);
  parts.push(SLOT_LABEL[revision.slot as Slot]);
  if (minsLate >= 2) parts.push(`已迟 ${minsLate} 分钟`);
  return parts.join(' · ');
}

function safeMinutes(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
