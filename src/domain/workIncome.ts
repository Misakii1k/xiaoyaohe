import type { WorkEntry, WorkProfile, WorkSettlement } from '../db/schema';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export interface WorkEntryIncomeContribution {
  entryId: string;
  profileId?: string;
  effectiveMs: number;
  amount: number;
  billable: boolean;
  key: string;
  settlementStatus: 'pending' | 'settled';
}

export interface WorkSalaryIncomeContribution {
  profileId: string;
  profileName: string;
  periodKey: string;
  amount: number;
  status: 'pending' | 'settled';
  source: 'estimate' | 'settlement';
}

export interface WorkIncomeSummaryResult {
  totalMs: number;
  estimatedIncome: number;
  pendingIncome: number;
  settledIncome: number;
  attendanceDays: number;
}

export interface WorkProfileIncomeResult {
  profileId: string;
  profileName: string;
  totalIncome: number;
  totalMs: number;
  entryCount: number;
}

export interface WorkRangeIncomeResult {
  rangeStart: number;
  rangeEnd: number;
  entryContributions: WorkEntryIncomeContribution[];
  salaryContributions: WorkSalaryIncomeContribution[];
  summary: WorkIncomeSummaryResult;
  byProfile: WorkProfileIncomeResult[];
}

export function effectiveWorkDurationMs(entry: WorkEntry, now = Date.now()): number {
  const actualEnd = entryEndExclusive(entry, now);
  return effectiveDurationBetween(entry, entry.startAt, actualEnd, actualEnd);
}

export function resolveWorkBreakMinutes(
  entryBreakMinutes: number | undefined,
  defaultBreakMinutes: number | undefined,
): number {
  return entryBreakMinutes ?? defaultBreakMinutes ?? 0;
}

/**
 * Canonical income calculation for an inclusive local-time range.
 *
 * Existing callers use ranges such as 00:00:00.000..23:59:59.999, so the
 * public boundary stays inclusive. Internally all clipping is half-open,
 * which prevents a millisecond from being counted in two adjacent ranges.
 */
export function calculateWorkRangeIncome(
  entries: WorkEntry[],
  profiles: WorkProfile[],
  settlements: WorkSettlement[],
  rangeStart: number,
  rangeEnd: number,
  now = Date.now(),
): WorkRangeIncomeResult {
  const safeStart = finiteTime(rangeStart, 0);
  const safeEnd = Math.max(safeStart, finiteTime(rangeEnd, safeStart));
  const endExclusive = inclusiveEndToExclusive(safeEnd);
  const usableEntries = entries.filter((entry) => !entry.deleted);
  const dailyFirst = firstDailyEntryByProfileAndDate(usableEntries);
  const entryContributions: WorkEntryIncomeContribution[] = [];
  const attendanceDates = new Set<string>();
  const entryCountByProfile = new Map<string, Set<string>>();

  for (const entry of usableEntries) {
    const actualEnd = entryEndExclusive(entry, now);
    if (!overlapsHalfOpen(entry.startAt, actualEnd, safeStart, endExclusive)) continue;

    addAttendanceDates(attendanceDates, Math.max(entry.startAt, safeStart), Math.min(actualEnd, endExclusive));
    const contribution = calculateEntryContribution(entry, dailyFirst, safeStart, endExclusive, now);
    entryContributions.push(contribution);
    if (entry.profileId) {
      const ids = entryCountByProfile.get(entry.profileId) ?? new Set<string>();
      ids.add(entry.id);
      entryCountByProfile.set(entry.profileId, ids);
    }
  }

  const salaryContributions = calculateSalaryContributions(
    profiles.filter((profile) => !profile.deleted && profile.payMode === 'salary'),
    settlements.filter((settlement) => !settlement.deleted),
    safeStart,
    endExclusive,
  );

  let totalMs = 0;
  let pendingCents = 0;
  let settledCents = 0;
  for (const contribution of entryContributions) {
    totalMs += contribution.effectiveMs;
    const cents = toCents(contribution.amount);
    if (contribution.settlementStatus === 'settled') settledCents += cents;
    else pendingCents += cents;
  }
  for (const contribution of salaryContributions) {
    const cents = toCents(contribution.amount);
    if (contribution.status === 'settled') settledCents += cents;
    else pendingCents += cents;
  }

  const byProfile = profiles
    .filter((profile) => !profile.deleted)
    .map((profile) => {
      const entryRows = entryContributions.filter((row) => row.profileId === profile.id);
      const salaryRows = salaryContributions.filter((row) => row.profileId === profile.id);
      const totalCents = [...entryRows, ...salaryRows].reduce((sum, row) => sum + toCents(row.amount), 0);
      return {
        profileId: profile.id,
        profileName: profile.name,
        totalIncome: fromCents(totalCents),
        totalMs: entryRows.reduce((sum, row) => sum + row.effectiveMs, 0),
        entryCount: entryCountByProfile.get(profile.id)?.size ?? 0,
      };
    })
    .sort((a, b) => b.totalIncome - a.totalIncome || a.profileName.localeCompare(b.profileName, 'zh-Hans-CN'));

  return {
    rangeStart: safeStart,
    rangeEnd: safeEnd,
    entryContributions,
    salaryContributions,
    summary: {
      totalMs,
      estimatedIncome: fromCents(pendingCents + settledCents),
      pendingIncome: fromCents(pendingCents),
      settledIncome: fromCents(settledCents),
      attendanceDays: attendanceDates.size,
    },
    byProfile,
  };
}

function calculateEntryContribution(
  entry: WorkEntry,
  dailyFirst: Map<string, string>,
  rangeStart: number,
  rangeEndExclusive: number,
  now: number,
): WorkEntryIncomeContribution {
  const actualEnd = entryEndExclusive(entry, now);
  const clipStart = Math.max(entry.startAt, rangeStart);
  const clipEnd = Math.min(actualEnd, rangeEndExclusive);
  const effectiveMs = effectiveDurationBetween(entry, clipStart, clipEnd, actualEnd);
  const status = entry.settlementStatus === 'settled' ? 'settled' : 'pending';
  const identity = profileIdentity(entry);

  if (entry.amountOverride !== undefined && Number.isFinite(entry.amountOverride)) {
    const amount = allocateFixedAmount(entry.amountOverride, entry.startAt, actualEnd, clipStart, clipEnd);
    return {
      entryId: entry.id,
      profileId: entry.profileId,
      effectiveMs,
      amount,
      billable: true,
      key: entry.id,
      settlementStatus: status,
    };
  }

  const snapshot = entry.paySnapshot;
  if (!snapshot) {
    return {
      entryId: entry.id,
      profileId: entry.profileId,
      effectiveMs,
      amount: 0,
      billable: false,
      key: entry.id,
      settlementStatus: status,
    };
  }

  if (snapshot.mode === 'hourly') {
    const amount = allocateHourlyAmount(entry, snapshot.amount, clipStart, clipEnd, actualEnd);
    return {
      entryId: entry.id,
      profileId: entry.profileId,
      effectiveMs,
      amount,
      billable: true,
      key: entry.id,
      settlementStatus: status,
    };
  }

  if (snapshot.mode === 'daily') {
    const date = localDateKey(entry.startAt);
    const key = `${identity}_${date}`;
    const isFirst = dailyFirst.get(key) === entry.id;
    const startDateIsInRange = entry.startAt >= rangeStart && entry.startAt < rangeEndExclusive;
    return {
      entryId: entry.id,
      profileId: entry.profileId,
      effectiveMs,
      amount: isFirst && startDateIsInRange ? fromCents(toCents(snapshot.amount)) : 0,
      billable: isFirst,
      key,
      settlementStatus: status,
    };
  }

  return {
    entryId: entry.id,
    profileId: entry.profileId,
    effectiveMs,
    amount: 0,
    billable: false,
    key: `${identity}_${localMonthKey(entry.startAt)}`,
    settlementStatus: status,
  };
}

function calculateSalaryContributions(
  profiles: WorkProfile[],
  settlements: WorkSettlement[],
  rangeStart: number,
  rangeEndExclusive: number,
): WorkSalaryIncomeContribution[] {
  const result: WorkSalaryIncomeContribution[] = [];
  for (const profile of profiles) {
    for (const monthStart of localMonthStartsInRange(rangeStart, rangeEndExclusive)) {
      const nextMonth = nextLocalMonth(monthStart);
      const clipStart = Math.max(rangeStart, monthStart);
      const clipEnd = Math.min(rangeEndExclusive, nextMonth);
      if (clipEnd <= clipStart) continue;

      const periodKey = localMonthKey(monthStart);
      const actual = settlements.find(
        (settlement) => settlement.profileId === profile.id && settlement.periodKey === periodKey,
      );
      const monthlyAmount = actual?.amount ?? profile.baseAmount;
      const amount = allocateMonthlyAmount(monthlyAmount, monthStart, clipStart, clipEnd);
      result.push({
        profileId: profile.id,
        profileName: profile.name,
        periodKey,
        amount,
        status: actual?.status === 'settled' ? 'settled' : 'pending',
        source: actual ? 'settlement' : 'estimate',
      });
    }
  }
  return result;
}

function firstDailyEntryByProfileAndDate(entries: WorkEntry[]): Map<string, string> {
  const result = new Map<string, string>();
  const daily = entries
    .filter((entry) => entry.paySnapshot?.mode === 'daily')
    .sort((a, b) => a.startAt - b.startAt || a.id.localeCompare(b.id));
  for (const entry of daily) {
    const key = `${profileIdentity(entry)}_${localDateKey(entry.startAt)}`;
    if (!result.has(key)) result.set(key, entry.id);
  }
  return result;
}

function allocateHourlyAmount(
  entry: WorkEntry,
  hourlyRate: number,
  clipStart: number,
  clipEnd: number,
  actualEnd: number,
): number {
  const rate = Number.isFinite(hourlyRate) ? hourlyRate : 0;
  const beforeStart = effectiveDurationBetween(entry, entry.startAt, clipStart, actualEnd);
  const throughEnd = effectiveDurationBetween(entry, entry.startAt, clipEnd, actualEnd);
  const startCents = Math.round((beforeStart / HOUR_MS) * rate * 100);
  const endCents = Math.round((throughEnd / HOUR_MS) * rate * 100);
  return fromCents(endCents - startCents);
}

function allocateFixedAmount(
  amount: number,
  entryStart: number,
  entryEnd: number,
  clipStart: number,
  clipEnd: number,
): number {
  const totalMs = Math.max(0, entryEnd - entryStart);
  if (totalMs === 0) return clipStart === entryStart ? fromCents(toCents(amount)) : 0;
  const totalCents = toCents(amount);
  const startFraction = clamp((clipStart - entryStart) / totalMs, 0, 1);
  const endFraction = clamp((clipEnd - entryStart) / totalMs, 0, 1);
  return fromCents(Math.round(totalCents * endFraction) - Math.round(totalCents * startFraction));
}

function allocateMonthlyAmount(amount: number, monthStart: number, clipStart: number, clipEnd: number): number {
  const days = daysInLocalMonth(monthStart);
  const totalCents = toCents(amount);
  const startPosition = localCalendarPosition(monthStart, clipStart);
  const endPosition = localCalendarPosition(monthStart, clipEnd);
  return fromCents(
    Math.round(totalCents * endPosition / days) - Math.round(totalCents * startPosition / days),
  );
}

function effectiveDurationBetween(entry: WorkEntry, from: number, to: number, actualEnd: number): number {
  const totalRaw = Math.max(0, actualEnd - entry.startAt);
  if (totalRaw === 0 || to <= from) return 0;
  const startElapsed = clamp(from - entry.startAt, 0, totalRaw);
  const endElapsed = clamp(to - entry.startAt, 0, totalRaw);
  const breakMs = entry.status === 'running'
    ? 0
    : Math.min(totalRaw, Math.max(0, finiteNumber(entry.breakMinutes)) * MINUTE_MS);
  const effectiveRatio = (totalRaw - breakMs) / totalRaw;
  return Math.max(0, (endElapsed - startElapsed) * effectiveRatio);
}

function entryEndExclusive(entry: WorkEntry, now: number): number {
  const end = entry.status === 'running' || entry.endAt === undefined ? now : entry.endAt;
  return Math.max(entry.startAt, finiteTime(end, entry.startAt));
}

function addAttendanceDates(target: Set<string>, start: number, endExclusive: number): void {
  if (endExclusive <= start) return;
  let dayStart = startOfLocalDay(start);
  while (dayStart < endExclusive) {
    const dayEnd = nextLocalDay(dayStart);
    if (start < dayEnd && endExclusive > dayStart) target.add(localDateKey(dayStart));
    dayStart = dayEnd;
  }
}

function localMonthStartsInRange(start: number, endExclusive: number): number[] {
  const result: number[] = [];
  let cursor = startOfLocalMonth(start);
  while (cursor < endExclusive) {
    result.push(cursor);
    cursor = nextLocalMonth(cursor);
  }
  return result;
}

function localCalendarPosition(monthStart: number, value: number): number {
  const nextMonth = nextLocalMonth(monthStart);
  if (value <= monthStart) return 0;
  if (value >= nextMonth) return daysInLocalMonth(monthStart);
  const date = new Date(value);
  const dayStart = startOfLocalDay(value);
  const dayEnd = nextLocalDay(dayStart);
  const fraction = (value - dayStart) / Math.max(1, dayEnd - dayStart);
  return date.getDate() - 1 + fraction;
}

function daysInLocalMonth(monthStart: number): number {
  const date = new Date(nextLocalMonth(monthStart));
  date.setDate(0);
  return date.getDate();
}

function startOfLocalDay(value: number): number {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function nextLocalDay(dayStart: number): number {
  const date = new Date(dayStart);
  date.setDate(date.getDate() + 1);
  return date.getTime();
}

function startOfLocalMonth(value: number): number {
  const date = new Date(value);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function nextLocalMonth(monthStart: number): number {
  const date = new Date(monthStart);
  date.setMonth(date.getMonth() + 1, 1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function localDateKey(value: number): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localMonthKey(value: number): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function profileIdentity(entry: WorkEntry): string {
  return entry.profileId || entry.projectName;
}

function overlapsHalfOpen(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && endA > startB;
}

function inclusiveEndToExclusive(value: number): number {
  return value < Number.MAX_SAFE_INTEGER ? value + 1 : value;
}

function finiteTime(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function finiteNumber(value: number | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toCents(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100);
}

function fromCents(value: number): number {
  return value / 100;
}
