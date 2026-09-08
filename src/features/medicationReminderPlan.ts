import {
  SLOT_LABEL,
  deriveReminderPeriodSettings,
  formatMealRels,
  type DerivedReminderPeriodSetting,
  type IntakeLog,
  type LocalDate,
  type Medication,
  type MedicationOccurrence,
  type MedicationScheduleRevision,
  type ReminderPeriodSetting,
  type ReminderRule,
  type Slot,
} from '../db/schema';
import {
  addLocalDays,
  generateOccurrences,
  isMedicationExpiredOn,
  localDateAtTime,
  toLocalDate,
} from '../domain/medicationSchedule';
import type { ScheduledReminderNotification } from './reminderTransport';

// 真机 Android 闹钟上限约 500；预排窗口与重复次数必须压在安全范围内
const DEFAULT_HORIZON_DAYS = 7;
const MAX_REPEATS_PER_GROUP = 4;

export interface MedicationReminderPlanInput {
  meds: readonly Medication[];
  rules: readonly ReminderRule[];
  revisions: readonly MedicationScheduleRevision[];
  logs: readonly IntakeLog[];
  now?: number;
  horizonDays?: number;
  /** 时段级整体提醒设置；缺省时按 meds/rules 派生（纯函数，无 IO） */
  periodSettings?: readonly ReminderPeriodSetting[];
  /**
   * 网页端前台轮询视图：保留已过点（at <= now）的阶段。
   * 调度视图（原生闹钟 / SW 补发）必须过滤已过点，否则会重复响；
   * 但前台 tick 需要看到「当前该发的这一跳」——即使它的时刻已过。
   */
  keepPastPhases?: boolean;
}

/** 组载荷中的一个药物明细 */
export interface ReminderGroupOccurrence {
  occurrenceId: string;
  legacyLogId: string;
  medId: string;
  medName: string;
  dose: string;
  /** 该药已绑定的所有条形码与二维码（GTIN、监管码、自定义条码等） */
  barcodes?: string[];
}

interface GroupMember {
  occurrence: MedicationOccurrence;
  med: Medication;
  revision: MedicationScheduleRevision;
}

/** Build a deterministic OS schedule. No database or plugin calls occur here. */
export function buildMedicationReminderPlan({
  meds,
  rules,
  revisions,
  logs,
  now = Date.now(),
  horizonDays = DEFAULT_HORIZON_DAYS,
  periodSettings,
  keepPastPhases = false,
}: MedicationReminderPlanInput): ScheduledReminderNotification[] {
  const startDate = toLocalDate(now);
  const days = Math.max(1, Math.min(60, Math.floor(horizonDays)));
  const endDate = addLocalDays(startDate, days - 1);
  const medById = new Map(meds.map((med) => [med.id, med]));
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
  const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
  const logByOccurrenceId = new Map<string, IntakeLog>();
  const logById = new Map<string, IntakeLog>();
  for (const log of logs) {
    if (log.id) {
      const previous = logById.get(log.id);
      if (!previous || log.updatedAt > previous.updatedAt) logById.set(log.id, log);
    }
    if (log.occurrenceId) {
      const previous = logByOccurrenceId.get(log.occurrenceId);
      if (!previous || log.updatedAt > previous.updatedAt) logByOccurrenceId.set(log.occurrenceId, log);
    }
  }

  // 按 (localDate, slot) 聚合未完成的服药项：同一时段的多药共享一条整体提醒，
  // 组 tag 与载荷身份基于组，不再按单药逐条触发。
  const groups = new Map<string, GroupMember[]>();
  for (const occurrence of generateOccurrences(revisions, startDate, endDate)) {
    const med = medById.get(occurrence.medId);
    const rule = ruleById.get(occurrence.sourceRuleId);
    const revision = revisionById.get(occurrence.scheduleRevisionId);
    if (!med || !rule || !revision || isMedicationExpiredOn(med, occurrence.localDate)) continue;
    const log = findLogForOccurrenceCached(occurrence, logByOccurrenceId, logById);
    if (log?.status === 'taken' || log?.status === 'skipped') continue;
    const key = `${occurrence.localDate}:${occurrence.slot}`;
    const members = groups.get(key);
    if (members) members.push({ occurrence, med, revision });
    else groups.set(key, [{ occurrence, med, revision }]);
  }

  // 时段设置：调用方传入已保存设置，未覆盖的时段回退到派生结果
  // （派生恒为 4 个时段，空时段回退 SLOT_DEFAULT_TIME / strong / defaultEscalate）。
  const settingsBySlot = new Map<Slot, DerivedReminderPeriodSetting>();
  if (periodSettings) {
    for (const setting of periodSettings) settingsBySlot.set(setting.slot, setting);
  }
  for (const setting of deriveReminderPeriodSettings(meds, rules)) {
    if (!settingsBySlot.has(setting.slot)) settingsBySlot.set(setting.slot, setting);
  }

  const notifications: ScheduledReminderNotification[] = [];
  for (const [key, members] of groups) {
    const parts = key.split(':');
    const date = parts[0]! as LocalDate;
    const slot = parts[1] as Slot;
    const setting = settingsBySlot.get(slot)!;
    const groupId = `reminder-group:${date}:${slot}`;
    // 组触发时间 = 时段设置 timeLocal 当日的本地时间戳（组内各药的精确时间仅用于记录）
    const dueAt = localDateAtTime(date, setting.timeLocal);
    const sortedMembers = [...members].sort((left, right) =>
      left.occurrence.id < right.occurrence.id ? -1 : left.occurrence.id > right.occurrence.id ? 1 : 0,
    );
    const occurrences: ReminderGroupOccurrence[] = sortedMembers.map(({ occurrence, med, revision }) => {
      const rawBarcodes = [
        ...(med.identity?.gtins ?? []),
        ...(med.identity?.rawCodes ?? []),
      ].map((b) => (typeof b === 'string' ? b.trim() : '')).filter(Boolean);
      const uniqueBarcodes = Array.from(new Set(rawBarcodes));
      return {
        occurrenceId: occurrence.id,
        legacyLogId: occurrence.legacyLogId,
        medId: med.id,
        medName: med.name,
        dose:
          revision.doseQuantity && revision.doseUnit
            ? `${revision.doseQuantity}${revision.doseUnit}`
            : med.amountPerDose || med.dosageText || '',
        ...(uniqueBarcodes.length > 0 ? { barcodes: uniqueBarcodes } : {}),
      };
    });

    // 重复策略按组（dose / repeat-N），由时段设置的 escalate 决定
    const repeatEveryMin = Math.max(1, safeMinutes(setting.escalate.repeatEveryMin));
    const repeatCount = Math.min(
      MAX_REPEATS_PER_GROUP,
      Math.max(0, Math.floor(setting.escalate.maxRepeats)),
    );
    for (let index = 0; index <= repeatCount; index += 1) {
      const count = index + 1;
      const at = dueAt + index * repeatEveryMin * 60_000;
      if (!keepPastPhases && at <= now) continue;
      notifications.push({
        at,
        title: buildReminderGroupTitle(slot, count),
        body: buildReminderGroupBody(occurrences, index * repeatEveryMin),
        tag: groupId,
        key: count === 1 ? 'dose' : `repeat-${count}`,
        data: {
          kind: 'reminder-group',
          groupId,
          date,
          slot,
          dueAt,
          mode: setting.mode,
          reminderCount: count,
          occurrences,
        },
      });
    }
  }

  return notifications.sort(
    (left, right) =>
      left.at - right.at ||
      left.tag.localeCompare(right.tag) ||
      (left.key ?? '').localeCompare(right.key ?? ''),
  );
}

/** 时段整体提醒标题，如「🔔 早上服药时间到了」 */
export function buildReminderGroupTitle(slot: Slot, count: number): string {
  const icon = count === 1 ? '🔔' : count === 2 ? '⚠️' : '‼️';
  const prefix = count >= 3 ? `第 ${count} 次提醒 · ` : '';
  return `${icon} ${prefix}${SLOT_LABEL[slot]}服药时间到了`;
}

/** 时段整体提醒正文：每个药物一行「二甲双胍 1片」，迟到 ≥2 分钟追加提示行 */
export function buildReminderGroupBody(
  occurrences: readonly ReminderGroupOccurrence[],
  minsLate: number,
): string {
  const lines = occurrences.map((occurrence) =>
    occurrence.dose ? `${occurrence.medName} ${occurrence.dose}` : occurrence.medName,
  );
  if (minsLate >= 2) lines.push(`已迟 ${minsLate} 分钟`);
  return lines.join('\n');
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

/** 与 medicationSchedule.findLogForOccurrence 语义一致，但用预构建索引 O(1) 查表 */
function findLogForOccurrenceCached(
  occurrence: MedicationOccurrence,
  byOccurrenceId: ReadonlyMap<string, IntakeLog>,
  byId: ReadonlyMap<string, IntakeLog>,
): IntakeLog | undefined {
  const candidates: IntakeLog[] = [];
  const byOccurrence = byOccurrenceId.get(occurrence.id);
  const byIdMatch = byId.get(occurrence.id);
  const legacy = byId.get(occurrence.legacyLogId);
  if (byOccurrence) candidates.push(byOccurrence);
  if (byIdMatch) candidates.push(byIdMatch);
  if (legacy && !legacy.occurrenceId) candidates.push(legacy);
  candidates.sort((left, right) => right.updatedAt - left.updatedAt);
  return candidates[0];
}
