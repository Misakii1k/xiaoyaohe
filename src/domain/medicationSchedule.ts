import {
  normalizeMealRels,
  type IntakeLog,
  type LocalDate,
  type Medication,
  type MedicationOccurrence,
  type MedicationScheduleRevision,
  type ReminderRule,
} from '../db/schema';

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface ScheduleDayProjection {
  revision: MedicationScheduleRevision;
  dueAt: number;
  isRest: boolean;
  occurrence?: MedicationOccurrence;
}

export interface AdherenceSummary {
  due: number;
  taken: number;
  skipped: number;
  missed: number;
  handled: number;
  adherenceRate: number;
  handledRate: number;
}

export function toLocalDate(value: number | Date = Date.now()): LocalDate {
  const date = typeof value === 'number' ? new Date(value) : value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}` as LocalDate;
}

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  const match = LOCAL_DATE_RE.exec(value);
  if (!match) return false;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return toLocalDate(parsed) === value;
}

export function addLocalDays(date: LocalDate, days: number): LocalDate {
  const parsed = parseLocalDate(date);
  parsed.setDate(parsed.getDate() + days);
  return toLocalDate(parsed);
}

export function localDayBounds(date: LocalDate): { start: number; end: number } {
  const startDate = parseLocalDate(date);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 1);
  return { start: startDate.getTime(), end: endDate.getTime() - 1 };
}

export function localDateAtTime(date: LocalDate, timeLocal: string): number {
  const [hours, minutes] = parseTime(timeLocal);
  const parsed = parseLocalDate(date);
  parsed.setHours(hours, minutes, 0, 0);
  return parsed.getTime();
}

export function localDateDayOfWeek(date: LocalDate): number {
  return parseLocalDate(date).getDay();
}

export function createScheduleRevision(
  med: Medication,
  rule: ReminderRule,
  options: { effectiveDate?: LocalDate; createdAt?: number; enabled?: boolean } = {},
): MedicationScheduleRevision {
  const createdAt = (options.createdAt ?? rule.updatedAt) || Date.now();
  const effectiveDate = options.effectiveDate ?? toLocalDate(med.createdAt ?? rule.updatedAt ?? createdAt);
  const cycleStartDate = rule.cycle
    ? (isLocalDate(rule.cycleStartDate) ? rule.cycleStartDate : med.createdAt ? toLocalDate(med.createdAt) : undefined)
    : undefined;
  const reviewFlags: MedicationScheduleRevision['reviewFlags'][number][] = [];
  if (rule.cycle && (!cycleStartDate || rule.cycleStartNeedsReview)) reviewFlags.push('cycle-start-missing');
  if (!validDoseQuantity(med.doseQuantity) || !med.doseUnit?.trim()) reviewFlags.push('dose-unstructured');

  const snapshot = {
    medId: med.id,
    sourceRuleId: rule.id,
    effectiveDate,
    createdAt,
    enabled: options.enabled ?? (rule.enabled && !rule.deleted && !med.deleted),
    slot: rule.slot,
    timeLocal: normalizeTime(rule.timeLocal),
    daysOfWeek: [...new Set(med.daysOfWeek ?? [])]
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
      .sort((a, b) => a - b),
    cycle: normalizeCycle(rule.cycle),
    cycleStartDate,
    mealRels: normalizeMealRels(med.mealRelsBySlot?.[rule.slot]),
    doseQuantity: validDoseQuantity(med.doseQuantity) ? med.doseQuantity : undefined,
    doseUnit: validDoseQuantity(med.doseQuantity) && med.doseUnit?.trim() ? med.doseUnit.trim() : undefined,
    reviewFlags,
  } satisfies Omit<MedicationScheduleRevision, 'id'>;

  return freezeScheduleRevision({
    id: `schedule:${rule.id}:${createdAt}:${stableHash(JSON.stringify(snapshot))}`,
    ...snapshot,
  });
}

export function freezeScheduleRevision(
  revision: MedicationScheduleRevision,
): MedicationScheduleRevision {
  return Object.freeze({
    ...revision,
    daysOfWeek: Object.freeze([...revision.daysOfWeek]),
    cycle: revision.cycle ? Object.freeze({ ...revision.cycle }) : undefined,
    mealRels: Object.freeze([...revision.mealRels]),
    reviewFlags: Object.freeze([...revision.reviewFlags]),
  });
}

export function scheduleRevisionMatches(
  revision: MedicationScheduleRevision,
  med: Medication,
  rule: ReminderRule,
): boolean {
  const candidate = createScheduleRevision(med, rule, {
    effectiveDate: revision.effectiveDate,
    createdAt: revision.createdAt,
    enabled: rule.enabled && !rule.deleted && !med.deleted,
  });
  return candidate.id === revision.id;
}

export function projectScheduleDate(
  revisions: readonly MedicationScheduleRevision[],
  date: LocalDate,
): ScheduleDayProjection[] {
  const groups = groupBySourceRule(revisions);
  const result: ScheduleDayProjection[] = [];
  for (const group of groups.values()) {
    const revision = selectRevisionForDate(group, date);
    if (!revision?.enabled) continue;
    if (revision.daysOfWeek.length > 0 && !revision.daysOfWeek.includes(localDateDayOfWeek(date))) continue;
    const dueAt = localDateAtTime(date, revision.timeLocal);
    const isRest = isScheduleRestDay(revision, date);
    result.push({
      revision,
      dueAt,
      isRest,
      occurrence: isRest ? undefined : createOccurrence(revision, date, dueAt),
    });
  }
  return result.sort((a, b) => a.dueAt - b.dueAt || a.revision.id.localeCompare(b.revision.id));
}

export function generateOccurrences(
  revisions: readonly MedicationScheduleRevision[],
  startDate: LocalDate,
  endDate: LocalDate,
): MedicationOccurrence[] {
  if (startDate > endDate) return [];
  const occurrences: MedicationOccurrence[] = [];
  let cursor = startDate;
  for (let guard = 0; cursor <= endDate && guard < 36600; guard += 1) {
    for (const entry of projectScheduleDate(revisions, cursor)) {
      if (entry.occurrence) occurrences.push(entry.occurrence);
    }
    cursor = addLocalDays(cursor, 1);
  }
  return occurrences;
}

export function createOccurrence(
  revision: MedicationScheduleRevision,
  date: LocalDate,
  dueAt = localDateAtTime(date, revision.timeLocal),
): MedicationOccurrence {
  return Object.freeze({
    // One legacy rule can yield at most one occurrence per local date. Keeping
    // the id independent of revision content lets an action survive a same-day
    // schedule correction while scheduleRevisionId retains its exact source.
    id: `occurrence:${revision.sourceRuleId}:${date}`,
    medId: revision.medId,
    sourceRuleId: revision.sourceRuleId,
    scheduleRevisionId: revision.id,
    localDate: date,
    slot: revision.slot,
    dueAt,
    timeLocal: revision.timeLocal,
    mealRels: revision.mealRels,
    doseQuantity: revision.doseQuantity,
    doseUnit: revision.doseUnit,
    legacyLogId: `${revision.sourceRuleId}_${date.replaceAll('-', '')}`,
  });
}

export function isOccurrenceEligible(
  occurrence: MedicationOccurrence,
  now: number,
  earlyWindowMs = 20 * 60 * 1000,
): boolean {
  return now >= occurrence.dueAt - Math.max(0, earlyWindowMs);
}

export function isScheduleRestDay(revision: MedicationScheduleRevision, date: LocalDate): boolean {
  const cycle = revision.cycle;
  if (!cycle || cycle.restDays <= 0 || !revision.cycleStartDate) return false;
  const daysSinceStart = calendarDaysBetween(revision.cycleStartDate, date);
  if (daysSinceStart < 0) return false;
  const length = cycle.activeDays + cycle.restDays;
  return length > 0 && daysSinceStart % length >= cycle.activeDays;
}

export function findLogForOccurrence(
  occurrence: MedicationOccurrence,
  logs: readonly IntakeLog[],
): IntakeLog | undefined {
  return logs
    .filter(
      (log) =>
        log.occurrenceId === occurrence.id ||
        log.id === occurrence.id ||
        (!log.occurrenceId && log.id === occurrence.legacyLogId),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export function calculateAdherence(
  occurrences: readonly MedicationOccurrence[],
  logs: readonly IntakeLog[],
  now = Date.now(),
): AdherenceSummary {
  let taken = 0;
  let skipped = 0;
  let missed = 0;
  for (const occurrence of occurrences) {
    if (occurrence.dueAt > now) continue;
    const log = findLogForOccurrence(occurrence, logs);
    if (log?.status === 'taken') taken += 1;
    else if (log?.status === 'skipped') skipped += 1;
    else missed += 1;
  }
  const due = taken + skipped + missed;
  const handled = taken + skipped;
  return {
    due,
    taken,
    skipped,
    missed,
    handled,
    adherenceRate: due > 0 ? taken / due : 0,
    handledRate: due > 0 ? handled / due : 0,
  };
}

export function getMedicationExpiryLocalDate(med: Medication): LocalDate | undefined {
  if (isLocalDate(med.expiryLocalDate)) return med.expiryLocalDate;
  if (!Number.isFinite(med.expiryDate)) return undefined;
  // Legacy editor stored input[type=date] as UTC midnight, so UTC components
  // preserve the date the user selected regardless of the current timezone.
  const legacyDate = new Date(med.expiryDate as number);
  // 有限但超出 Date 范围的旧数据会让 toISOString() 抛 RangeError，直接拖垮整页渲染。
  if (Number.isNaN(legacyDate.getTime())) return undefined;
  return legacyDate.toISOString().slice(0, 10) as LocalDate;
}

export function isMedicationExpiredOn(med: Medication, date: LocalDate): boolean {
  const expiryDate = getMedicationExpiryLocalDate(med);
  return expiryDate != null && expiryDate < date;
}

function selectRevisionForDate(
  revisions: readonly MedicationScheduleRevision[],
  date: LocalDate,
): MedicationScheduleRevision | undefined {
  return revisions
    .filter((revision) => revision.effectiveDate <= date)
    .sort(
      (a, b) =>
        b.effectiveDate.localeCompare(a.effectiveDate) ||
        b.createdAt - a.createdAt ||
        b.id.localeCompare(a.id),
    )[0];
}

function groupBySourceRule(
  revisions: readonly MedicationScheduleRevision[],
): Map<string, MedicationScheduleRevision[]> {
  const groups = new Map<string, MedicationScheduleRevision[]>();
  for (const revision of revisions) {
    const group = groups.get(revision.sourceRuleId) ?? [];
    group.push(revision);
    groups.set(revision.sourceRuleId, group);
  }
  return groups;
}

function calendarDaysBetween(start: LocalDate, end: LocalDate): number {
  const startDate = parseLocalDate(start);
  const endDate = parseLocalDate(end);
  const startYear = startDate.getFullYear();
  const startMonth = startDate.getMonth();
  const startDay = startDate.getDate();
  const endYear = endDate.getFullYear();
  const endMonth = endDate.getMonth();
  const endDay = endDate.getDate();
  const startUtc = Date.UTC(startYear, startMonth, startDay);
  const endUtc = Date.UTC(endYear, endMonth, endDay);
  return Math.round((endUtc - startUtc) / 86_400_000);
}

function parseLocalDate(value: LocalDate): Date {
  const match = LOCAL_DATE_RE.exec(value);
  if (!match) throw new Error(`Invalid local date: ${value}`);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
}

function parseTime(value: string): [number, number] {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  const hours = Number(match?.[1]);
  const minutes = Number(match?.[2]);
  if (!match || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return [8, 0];
  return [hours, minutes];
}

function normalizeTime(value: string): string {
  const [hours, minutes] = parseTime(value);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function normalizeCycle(
  cycle: ReminderRule['cycle'],
): MedicationScheduleRevision['cycle'] | undefined {
  if (!cycle) return undefined;
  const activeDays = Math.floor(cycle.activeDays);
  const restDays = Math.floor(cycle.restDays);
  if (!Number.isFinite(activeDays) || !Number.isFinite(restDays) || activeDays <= 0 || restDays < 0) {
    return undefined;
  }
  return { activeDays, restDays };
}

function validDoseQuantity(value: number | undefined): value is number {
  return Number.isFinite(value) && (value as number) > 0;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
