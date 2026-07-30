import { describe, expect, it } from 'vitest';
import type { WorkEntry, WorkProfile, WorkSettlement } from '../src/db/schema';
import {
  calculateWorkIncome,
  calculateWorkIncomeRange,
  csvCell,
  exportWorkEntriesCsv,
} from '../src/db/work';
import { exportWorkReport } from '../src/tools/registry';
import { effectiveWorkDurationMs, resolveWorkBreakMinutes } from '../src/domain/workIncome';

const HOUR = 3_600_000;

describe('canonical work income range engine', () => {
  it('keeps an explicit zero break and does not deduct planned breaks from running duration', () => {
    expect(resolveWorkBreakMinutes(0, 60)).toBe(0);
    expect(resolveWorkBreakMinutes(undefined, 60)).toBe(60);

    const profile = makeProfile({ defaultBreakMinutes: 60 });
    const startAt = localTime(2026, 7, 13, 9);
    const now = localTime(2026, 7, 13, 10);
    const running = makeEntry(profile, {
      startAt,
      endAt: undefined,
      status: 'running',
      breakMinutes: 60,
    });
    expect(effectiveWorkDurationMs(running, now)).toBe(HOUR);
  });

  it('prorates hourly breaks across adjacent month ranges without losing income', () => {
    const profile = makeProfile({ baseAmount: 40 });
    const entry = makeEntry(profile, {
      startAt: localTime(2026, 1, 31, 22),
      endAt: localTime(2026, 2, 1, 2),
      breakMinutes: 60,
    });
    const boundary = localTime(2026, 2, 1);

    const january = calculateWorkIncomeRange(
      [entry],
      [profile],
      [],
      localTime(2026, 1, 31),
      boundary - 1,
      entry.endAt!,
    );
    const february = calculateWorkIncomeRange(
      [entry],
      [profile],
      [],
      boundary,
      localTime(2026, 2, 2) - 1,
      entry.endAt!,
    );
    const whole = calculateWorkIncomeRange(
      [entry],
      [profile],
      [],
      entry.startAt,
      entry.endAt! - 1,
      entry.endAt!,
    );

    expect(january.summary.totalMs).toBe(1.5 * HOUR);
    expect(february.summary.totalMs).toBe(1.5 * HOUR);
    expect(january.summary.estimatedIncome).toBe(60);
    expect(february.summary.estimatedIncome).toBe(60);
    expect(january.summary.totalMs + february.summary.totalMs).toBe(whole.summary.totalMs);
    expect(january.summary.estimatedIncome + february.summary.estimatedIncome).toBe(whole.summary.estimatedIncome);
    expect(whole.summary.attendanceDays).toBe(2);
  });

  it('does not deduct a planned break while an entry is still running', () => {
    const profile = makeProfile({ baseAmount: 100, defaultBreakMinutes: 60 });
    const startAt = localTime(2026, 7, 13, 9);
    const now = localTime(2026, 7, 13, 10);
    const running = makeEntry(profile, {
      startAt,
      endAt: undefined,
      status: 'running',
      breakMinutes: 60,
    });

    const income = calculateWorkIncome(running, [running], now);
    expect(income.effectiveMs).toBe(HOUR);
    expect(income.amount).toBe(100);
  });

  it('counts daily pay once per profile and local start date', () => {
    const profile = makeProfile({ payMode: 'daily', baseAmount: 200 });
    const first = makeEntry(profile, {
      id: 'first',
      startAt: localTime(2026, 7, 13, 8),
      endAt: localTime(2026, 7, 13, 10),
    });
    const second = makeEntry(profile, {
      id: 'second',
      startAt: localTime(2026, 7, 13, 12),
      endAt: localTime(2026, 7, 13, 14),
    });
    const result = calculateWorkIncomeRange(
      [second, first],
      [profile],
      [],
      localTime(2026, 7, 13),
      localTime(2026, 7, 14) - 1,
      second.endAt!,
    );

    expect(result.summary.estimatedIncome).toBe(200);
    expect(result.entryContributions.find((row) => row.entryId === 'first')?.amount).toBe(200);
    expect(result.entryContributions.find((row) => row.entryId === 'second')?.amount).toBe(0);
  });

  it('assigns cross-midnight daily pay only to the local start date', () => {
    const profile = makeProfile({ payMode: 'daily', baseAmount: 180 });
    const entry = makeEntry(profile, {
      startAt: localTime(2026, 1, 31, 23),
      endAt: localTime(2026, 2, 1, 1),
    });
    const boundary = localTime(2026, 2, 1);
    const firstDay = calculateWorkIncomeRange([entry], [profile], [], entry.startAt, boundary - 1, entry.endAt!);
    const secondDay = calculateWorkIncomeRange([entry], [profile], [], boundary, entry.endAt! - 1, entry.endAt!);

    expect(firstDay.summary.estimatedIncome).toBe(180);
    expect(secondDay.summary.estimatedIncome).toBe(0);
    expect(firstDay.summary.totalMs).toBe(HOUR);
    expect(secondDay.summary.totalMs).toBe(HOUR);
  });

  it('estimates salary by local calendar days even when there are no entries', () => {
    const profile = makeProfile({ payMode: 'salary', baseAmount: 3100 });
    const result = calculateWorkIncomeRange(
      [],
      [profile],
      [],
      localTime(2026, 7, 1),
      localTime(2026, 7, 8) - 1,
      localTime(2026, 7, 8),
    );

    expect(result.summary.totalMs).toBe(0);
    expect(result.summary.attendanceDays).toBe(0);
    expect(result.summary.estimatedIncome).toBe(700);
    expect(result.summary.pendingIncome).toBe(700);
  });

  it('uses an actual salary settlement instead of the profile estimate', () => {
    const profile = makeProfile({ payMode: 'salary', baseAmount: 3100 });
    const settlement: WorkSettlement = {
      id: `${profile.id}_2026-07`,
      profileId: profile.id,
      periodKey: '2026-07',
      amount: 3410,
      status: 'settled',
      settledAt: localTime(2026, 8, 1),
      updatedAt: localTime(2026, 8, 1),
    };
    const result = calculateWorkIncomeRange(
      [],
      [profile],
      [settlement],
      localTime(2026, 7, 1),
      localTime(2026, 8, 1) - 1,
      localTime(2026, 8, 1),
    );

    expect(result.summary.estimatedIncome).toBe(3410);
    expect(result.summary.pendingIncome).toBe(0);
    expect(result.summary.settledIncome).toBe(3410);
    expect(result.salaryContributions[0]?.source).toBe('settlement');
  });
});

describe('work CSV exports', () => {
  it('uses the canonical range total in the report and includes salary without entries', () => {
    const profile = makeProfile({ payMode: 'salary', baseAmount: 3100 });
    const start = localTime(2026, 7, 1);
    const end = localTime(2026, 7, 8) - 1;
    const calculation = calculateWorkIncomeRange([], [profile], [], start, end, end + 1);
    const report = exportWorkReport([], [profile], [], start, end, 'week', end + 1);
    const totalCells = csvRows(report.csv).at(-1)!;

    expect(totalCells[5]).toBe(calculation.summary.estimatedIncome.toFixed(2));
    expect(report.summary).toContain('总收入 700.00 元');
    expect(report.csv).toContain('固定薪资');
  });

  it('neutralizes spreadsheet formulas in every user-controlled CSV field', async () => {
    const profile = makeProfile({ name: '=HYPERLINK("bad")', baseAmount: 50 });
    const entry = makeEntry(profile, {
      taskName: '+SUM(A1:A2)',
      note: '@malicious',
      startAt: localTime(2026, 7, 13, 9),
      endAt: localTime(2026, 7, 13, 10),
    });
    const csv = await exportWorkEntriesCsv([entry], {
      profiles: [profile],
      settlements: [],
      rangeStart: entry.startAt,
      rangeEnd: entry.endAt! - 1,
      now: entry.endAt,
    });

    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(csv).toContain('"\'+SUM(A1:A2)"');
    expect(csv).toContain('"\'@malicious"');
    expect(csvCell('  -1+2')).toBe('"\'  -1+2"');
  });
});

function makeProfile(overrides: Partial<WorkProfile> = {}): WorkProfile {
  const payMode = overrides.payMode ?? 'hourly';
  return {
    id: 'profile-1',
    name: '测试工作',
    payMode,
    baseAmount: 20,
    settlementCycle: payMode === 'salary' ? 'month' : payMode === 'daily' ? 'day' : 'entry',
    defaultBreakMinutes: 0,
    updatedAt: 1,
    ...overrides,
  };
}

function makeEntry(profile: WorkProfile, overrides: Partial<WorkEntry> = {}): WorkEntry {
  return {
    id: 'entry-1',
    profileId: profile.id,
    projectName: profile.name,
    taskName: '测试班次',
    paySnapshot: { mode: profile.payMode, amount: profile.baseAmount, profileName: profile.name },
    startAt: localTime(2026, 7, 13, 9),
    endAt: localTime(2026, 7, 13, 10),
    breakMinutes: 0,
    status: 'stopped',
    settlementStatus: 'pending',
    updatedAt: 1,
    ...overrides,
  };
}

function localTime(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

function csvRows(csv: string): string[][] {
  return csv
    .replace(/^\ufeff/, '')
    .split('\r\n')
    .map((line) => line.slice(1, -1).split('","').map((cell) => cell.replace(/""/g, '"')));
}
