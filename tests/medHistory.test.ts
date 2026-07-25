import { describe, it, expect } from 'vitest';
import {
  computeRangeBounds,
  computeStreak,
  groupOccurrencesByDate,
  HISTORY_EDIT_WINDOW_DAYS,
  type HistoryState,
} from '../src/pages/MedHistory';
import type {
  IntakeLog,
  Medication,
  MedicationOccurrence,
  Slot,
} from '../src/db/schema';
import type { LocalDate } from '../src/db/schema';

function makeOccurrence(overrides: Partial<MedicationOccurrence> & { medId: string; localDate: LocalDate; sourceRuleId: string }): MedicationOccurrence {
  return Object.freeze({
    id: `occurrence:${overrides.sourceRuleId}:${overrides.localDate}`,
    medId: overrides.medId,
    sourceRuleId: overrides.sourceRuleId,
    scheduleRevisionId: `schedule:${overrides.sourceRuleId}:1:hash`,
    localDate: overrides.localDate,
    slot: overrides.slot ?? 'morning',
    dueAt: overrides.dueAt ?? Date.parse(`${overrides.localDate}T08:00:00`),
    timeLocal: overrides.timeLocal ?? '08:00',
    mealRels: overrides.mealRels ?? [],
    doseQuantity: overrides.doseQuantity,
    doseUnit: overrides.doseUnit,
    legacyLogId: `${overrides.sourceRuleId}_${overrides.localDate.replaceAll('-', '')}`,
  });
}

function makeMed(overrides: Partial<Medication> & { id: string }): Medication {
  return {
    id: overrides.id,
    name: overrides.name ?? '测试药',
    dosageText: overrides.dosageText ?? '5mg/片',
    amountPerDose: overrides.amountPerDose ?? '1片',
    slots: overrides.slots ?? ['morning'],
    mealRels: overrides.mealRels ?? [],
    mealRelsBySlot: overrides.mealRelsBySlot ?? {},
    daysOfWeek: overrides.daysOfWeek ?? [],
    reminderMode: overrides.reminderMode ?? 'strong',
    identity: overrides.identity ?? { gtins: [], rawCodes: [], ocrNames: [], photoHashes: [] },
    updatedAt: overrides.updatedAt ?? 0,
    ...overrides,
  } as Medication;
}

function makeLog(overrides: Partial<IntakeLog> & { id: string; medId: string; dueAt: number }): IntakeLog {
  return {
    id: overrides.id,
    medId: overrides.medId,
    slot: overrides.slot ?? 'morning',
    dueAt: overrides.dueAt,
    status: overrides.status ?? 'taken',
    ackAt: overrides.ackAt ?? overrides.dueAt,
    updatedAt: overrides.updatedAt ?? 0,
    ...overrides,
  } as IntakeLog;
}

const TODAY: LocalDate = '2026-07-25';
const NOW = Date.parse('2026-07-25T12:00:00');

describe('computeRangeBounds', () => {
  it('7d 预设返回最近 7 天（含 today）', () => {
    const state: HistoryState = { rangePreset: '7d', filterMed: 'all', filterSlot: 'all', filterStatus: 'all' };
    const bounds = computeRangeBounds(state, TODAY);
    expect(bounds.start).toBe('2026-07-19');
    expect(bounds.end).toBe('2026-07-25');
  });

  it('30d 预设返回最近 30 天', () => {
    const state: HistoryState = { rangePreset: '30d', filterMed: 'all', filterSlot: 'all', filterStatus: 'all' };
    const bounds = computeRangeBounds(state, TODAY);
    expect(bounds.start).toBe('2026-06-26');
    expect(bounds.end).toBe('2026-07-25');
  });

  it('90d 预设返回最近 90 天', () => {
    const state: HistoryState = { rangePreset: '90d', filterMed: 'all', filterSlot: 'all', filterStatus: 'all' };
    const bounds = computeRangeBounds(state, TODAY);
    expect(bounds.start).toBe('2026-04-27');
    expect(bounds.end).toBe('2026-07-25');
  });

  it('custom 区间正常返回', () => {
    const state: HistoryState = {
      rangePreset: 'custom',
      customStart: '2026-07-01',
      customEnd: '2026-07-20',
      filterMed: 'all',
      filterSlot: 'all',
      filterStatus: 'all',
    };
    const bounds = computeRangeBounds(state, TODAY);
    expect(bounds.start).toBe('2026-07-01');
    expect(bounds.end).toBe('2026-07-20');
  });

  it('custom 区间起止颠倒时自动校正', () => {
    const state: HistoryState = {
      rangePreset: 'custom',
      customStart: '2026-07-20',
      customEnd: '2026-07-01',
      filterMed: 'all',
      filterSlot: 'all',
      filterStatus: 'all',
    };
    const bounds = computeRangeBounds(state, TODAY);
    expect(bounds.start).toBe('2026-07-01');
    expect(bounds.end).toBe('2026-07-20');
  });

  it('custom 区间跨度 ≥ 90 天时抛 RangeError', () => {
    const state: HistoryState = {
      rangePreset: 'custom',
      customStart: '2026-01-01',
      customEnd: '2026-06-01',
      filterMed: 'all',
      filterSlot: 'all',
      filterStatus: 'all',
    };
    expect(() => computeRangeBounds(state, TODAY)).toThrow(RangeError);
  });

  it('custom 区间跨度恰好 89 天（含端点共 90 天）不抛错', () => {
    const state: HistoryState = {
      rangePreset: 'custom',
      customStart: '2026-04-27',
      customEnd: '2026-07-25',
      filterMed: 'all',
      filterSlot: 'all',
      filterStatus: 'all',
    };
    const bounds = computeRangeBounds(state, TODAY);
    expect(bounds.start).toBe('2026-04-27');
    expect(bounds.end).toBe('2026-07-25');
  });

  it('custom 区间字段缺失时回退到最近 30 天', () => {
    const state: HistoryState = {
      rangePreset: 'custom',
      filterMed: 'all',
      filterSlot: 'all',
      filterStatus: 'all',
    };
    const bounds = computeRangeBounds(state, TODAY);
    expect(bounds.start).toBe('2026-06-26');
    expect(bounds.end).toBe('2026-07-25');
  });

  it('HISTORY_EDIT_WINDOW_DAYS 常量为 90', () => {
    expect(HISTORY_EDIT_WINDOW_DAYS).toBe(90);
  });
});

describe('groupOccurrencesByDate', () => {
  const med = makeMed({ id: 'med-1' });

  it('按 localDate 倒序、日内按 dueAt 升序', () => {
    const occurrences = [
      makeOccurrence({ medId: 'med-1', sourceRuleId: 'r1', localDate: '2026-07-24', dueAt: Date.parse('2026-07-24T08:00:00') }),
      makeOccurrence({ medId: 'med-1', sourceRuleId: 'r2', localDate: '2026-07-24', dueAt: Date.parse('2026-07-24T20:00:00') }),
      makeOccurrence({ medId: 'med-1', sourceRuleId: 'r1', localDate: '2026-07-25', dueAt: Date.parse('2026-07-25T08:00:00') }),
    ];
    const groups = groupOccurrencesByDate(occurrences, [], new Map([['med-1', med]]), NOW);
    expect(groups.map((g) => g.date)).toEqual(['2026-07-25', '2026-07-24']);
    expect(groups[1].items.map((i) => i.occurrence.dueAt)).toEqual([
      Date.parse('2026-07-24T08:00:00'),
      Date.parse('2026-07-24T20:00:00'),
    ]);
  });

  it('已过 dueAt 且无 log → status=missed', () => {
    const pastDue = Date.parse('2026-07-24T08:00:00');
    const occurrences = [
      makeOccurrence({ medId: 'med-1', sourceRuleId: 'r1', localDate: '2026-07-24', dueAt: pastDue }),
    ];
    const groups = groupOccurrencesByDate(occurrences, [], new Map([['med-1', med]]), NOW);
    expect(groups[0].items[0].status).toBe('missed');
  });

  it('未到 dueAt 且无 log → status=pending', () => {
    const futureDue = Date.parse('2026-07-25T20:00:00');
    const occurrences = [
      makeOccurrence({ medId: 'med-1', sourceRuleId: 'r1', localDate: '2026-07-25', dueAt: futureDue }),
    ];
    const groups = groupOccurrencesByDate(occurrences, [], new Map([['med-1', med]]), NOW);
    expect(groups[0].items[0].status).toBe('pending');
  });

  it('log.status=taken → status=taken', () => {
    const dueAt = Date.parse('2026-07-24T08:00:00');
    const occurrence = makeOccurrence({ medId: 'med-1', sourceRuleId: 'r1', localDate: '2026-07-24', dueAt });
    const log = makeLog({ id: occurrence.id, medId: 'med-1', dueAt, status: 'taken' });
    const groups = groupOccurrencesByDate([occurrence], [log], new Map([['med-1', med]]), NOW);
    expect(groups[0].items[0].status).toBe('taken');
    expect(groups[0].items[0].log).toBe(log);
  });

  it('log.status=skipped → status=skipped', () => {
    const dueAt = Date.parse('2026-07-24T08:00:00');
    const occurrence = makeOccurrence({ medId: 'med-1', sourceRuleId: 'r1', localDate: '2026-07-24', dueAt });
    const log = makeLog({ id: occurrence.id, medId: 'med-1', dueAt, status: 'skipped' });
    const groups = groupOccurrencesByDate([occurrence], [log], new Map([['med-1', med]]), NOW);
    expect(groups[0].items[0].status).toBe('skipped');
  });

  it('occurrence 对应的 med 已删除（不在 medById 中）→ 跳过', () => {
    const occurrences = [
      makeOccurrence({ medId: 'med-missing', sourceRuleId: 'r1', localDate: '2026-07-24' }),
    ];
    const groups = groupOccurrencesByDate(occurrences, [], new Map([['med-1', med]]), NOW);
    expect(groups).toHaveLength(0);
  });

  it('legacy log（通过 legacyLogId 匹配）能被找到', () => {
    const dueAt = Date.parse('2026-07-24T08:00:00');
    const occurrence = makeOccurrence({ medId: 'med-1', sourceRuleId: 'r1', localDate: '2026-07-24', dueAt });
    // 旧式 log：id = legacyLogId，无 occurrenceId
    const legacyLog = makeLog({
      id: occurrence.legacyLogId,
      medId: 'med-1',
      dueAt,
      status: 'taken',
    });
    delete (legacyLog as any).occurrenceId;
    const groups = groupOccurrencesByDate([occurrence], [legacyLog], new Map([['med-1', med]]), NOW);
    expect(groups[0].items[0].status).toBe('taken');
    expect(groups[0].items[0].log).toBe(legacyLog);
  });
});

describe('computeStreak', () => {
  function buildDayGroups(
    config: Array<{ date: LocalDate; statuses: Array<'taken' | 'skipped' | 'missed' | 'pending'> }>,
  ): Array<{ date: LocalDate; items: Array<{ occurrence: { dueAt: number }; status: string }> }> {
    return config.map((day) => ({
      date: day.date,
      items: day.statuses.map((status, idx) => ({
        occurrence: { dueAt: Date.parse(`${day.date}T08:0${idx}:00`) },
        status,
      })),
    })) as any;
  }

  it('连续 5 天全 taken → streak=5（today 也全 taken 但不计入）', () => {
    const groups = buildDayGroups([
      { date: '2026-07-25', statuses: ['taken'] }, // today
      { date: '2026-07-24', statuses: ['taken'] },
      { date: '2026-07-23', statuses: ['taken'] },
      { date: '2026-07-22', statuses: ['taken'] },
      { date: '2026-07-21', statuses: ['taken'] },
      { date: '2026-07-20', statuses: ['missed'] }, // 中断
    ]);
    expect(computeStreak(groups as any, TODAY, NOW)).toBe(5);
  });

  it('today 尚有 pending 不中断但不计入', () => {
    // today 有一项 pending（dueAt > now 视为 pending，但 buildDayGroups 直接传 status）
    // 注意：computeStreak 内部判断 today 时只看 dueItems 是否 allTaken
    const futureDue = Date.parse('2026-07-25T20:00:00'); // tonight, future
    const groups = buildDayGroups([
      { date: '2026-07-25', statuses: ['taken'] }, // today: 已服一项
      { date: '2026-07-24', statuses: ['taken'] },
      { date: '2026-07-23', statuses: ['taken'] },
    ]);
    // 把 today 的 dueAt 改成未来，模拟"今日尚未到时间"
    (groups[0].items[0].occurrence as any).dueAt = futureDue;
    // 但 status='taken'，computeStreak 会因为 dueItems 为空跳过 today
    expect(computeStreak(groups as any, TODAY, NOW)).toBe(2);
  });

  it('today 已全 taken，第 6 天有 missed → streak=5', () => {
    const groups = buildDayGroups([
      { date: '2026-07-25', statuses: ['taken'] },
      { date: '2026-07-24', statuses: ['taken'] },
      { date: '2026-07-23', statuses: ['taken'] },
      { date: '2026-07-22', statuses: ['taken'] },
      { date: '2026-07-21', statuses: ['taken'] },
      { date: '2026-07-20', statuses: ['missed'] },
    ]);
    expect(computeStreak(groups as any, TODAY, NOW)).toBe(5);
  });

  it('today 无任何应服（停药期）→ 从昨天起算', () => {
    const groups = buildDayGroups([
      { date: '2026-07-24', statuses: ['taken'] },
      { date: '2026-07-23', statuses: ['taken'] },
      { date: '2026-07-22', statuses: ['missed'] },
    ]);
    expect(computeStreak(groups as any, TODAY, NOW)).toBe(2);
  });

  it('区间内无任何 due → streak=0', () => {
    const groups: any[] = [];
    expect(computeStreak(groups, TODAY, NOW)).toBe(0);
  });

  it('today 漏服（missed）→ today 不计入也不中断，从昨天起算', () => {
    const groups = buildDayGroups([
      { date: '2026-07-25', statuses: ['missed'] }, // today missed
      { date: '2026-07-24', statuses: ['taken'] },
      { date: '2026-07-23', statuses: ['taken'] },
    ]);
    expect(computeStreak(groups as any, TODAY, NOW)).toBe(2);
  });

  it('yesterday missed → 中断，streak=0（today 不计入）', () => {
    const groups = buildDayGroups([
      { date: '2026-07-25', statuses: ['taken'] }, // today 全 taken
      { date: '2026-07-24', statuses: ['missed'] }, // yesterday missed → 中断
      { date: '2026-07-23', statuses: ['taken'] },
    ]);
    expect(computeStreak(groups as any, TODAY, NOW)).toBe(0);
  });
});
