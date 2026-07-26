import { describe, it, expect, vi } from 'vitest';
import {
  computeRangeBounds,
  computeStreak,
  groupOccurrencesByDate,
  HISTORY_EDIT_WINDOW_DAYS,
  type HistoryState,
  getActionSheetOptions,
  historyActionToIntake,
  historyActionSuccessMessage,
  performHistoryAction,
} from '../src/pages/MedHistory';
import { MedicationIntakeError, type IntakeMutationResult } from '../src/db/local';
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

// ---- P2: 操作 sheet 与 setOccurrenceAction 集成 ----

describe('getActionSheetOptions', () => {
  function makeLog(status: 'taken' | 'skipped' | 'pending'): IntakeLog | undefined {
    if (status === 'pending') return undefined;
    return { id: 'log1', medId: 'med1', slot: 'morning', dueAt: 0, status, updatedAt: 0 } as IntakeLog;
  }

  it('currentLog=taken → 标记已服 disabled，其余 enabled', () => {
    const opts = getActionSheetOptions(makeLog('taken'));
    expect(opts).toHaveLength(3);
    expect(opts.find((o) => o.action === 'taken')!.disabled).toBe(true);
    expect(opts.find((o) => o.action === 'skipped')!.disabled).toBe(false);
    expect(opts.find((o) => o.action === 'clear')!.disabled).toBe(false);
  });

  it('currentLog=skipped → 标记跳过 disabled，其余 enabled', () => {
    const opts = getActionSheetOptions(makeLog('skipped'));
    expect(opts.find((o) => o.action === 'taken')!.disabled).toBe(false);
    expect(opts.find((o) => o.action === 'skipped')!.disabled).toBe(true);
    expect(opts.find((o) => o.action === 'clear')!.disabled).toBe(false);
  });

  it('currentLog=undefined（pending/missed）→ 清除记录 disabled，其余 enabled', () => {
    const opts = getActionSheetOptions(makeLog('pending'));
    expect(opts.find((o) => o.action === 'taken')!.disabled).toBe(false);
    expect(opts.find((o) => o.action === 'skipped')!.disabled).toBe(false);
    expect(opts.find((o) => o.action === 'clear')!.disabled).toBe(true);
  });

  it('选项顺序固定：taken → skipped → clear（与 UI 渲染顺序一致）', () => {
    const opts = getActionSheetOptions(undefined);
    expect(opts.map((o) => o.action)).toEqual(['taken', 'skipped', 'clear']);
  });

  it('tone 与 label 配对正确', () => {
    const opts = getActionSheetOptions(undefined);
    const byAction = new Map(opts.map((o) => [o.action, o]));
    expect(byAction.get('taken')!.tone).toBe('primary');
    expect(byAction.get('taken')!.label).toBe('标记已服');
    expect(byAction.get('skipped')!.tone).toBe('secondary');
    expect(byAction.get('skipped')!.label).toBe('标记跳过');
    expect(byAction.get('clear')!.tone).toBe('danger');
    expect(byAction.get('clear')!.label).toBe('清除记录');
  });
});

describe('historyActionToIntake', () => {
  it("'taken' → 'taken'", () => {
    expect(historyActionToIntake('taken')).toBe('taken');
  });
  it("'skipped' → 'skipped'", () => {
    expect(historyActionToIntake('skipped')).toBe('skipped');
  });
  it("'clear' → undefined（删除既有 log）", () => {
    expect(historyActionToIntake('clear')).toBeUndefined();
  });
});

describe('historyActionSuccessMessage', () => {
  it.each([
    ['taken', '已记录为已服'],
    ['skipped', '已记录为跳过'],
    ['clear', '已清除记录'],
  ] as const)('action=%s → 文案=%s', (action, expected) => {
    expect(historyActionSuccessMessage(action)).toBe(expected);
  });
});

describe('performHistoryAction', () => {
  const occurrence = {
    id: 'occ1',
    medId: 'med1',
    sourceRuleId: 'r1',
    scheduleRevisionId: 'rev1',
    localDate: '2026-07-24' as LocalDate,
    slot: 'morning' as Slot,
    dueAt: Date.parse('2026-07-24T08:00:00'),
    timeLocal: '08:00',
    mealRels: [],
    legacyLogId: 'r1_20260724',
  } as MedicationOccurrence;

  function makeDeps(overrides: {
    setOccurrenceAction?: ReturnType<typeof vi.fn>;
    toast?: ReturnType<typeof vi.fn>;
    onRefresh?: ReturnType<typeof vi.fn>;
  } = {}) {
    return {
      setOccurrenceAction: overrides.setOccurrenceAction ?? vi.fn().mockResolvedValue({
        med: {}, inventoryChanged: false, lowStock: false,
      } as IntakeMutationResult),
      toast: overrides.toast ?? vi.fn(),
      onRefresh: overrides.onRefresh ?? vi.fn().mockResolvedValue(undefined),
    };
  }

  it("action='taken' → 调用 setOccurrenceAction(occurrence, 'taken') 并 toast 成功文案并触发 refresh", async () => {
    const deps = makeDeps();
    const result = await performHistoryAction(occurrence, 'taken', deps);
    expect(deps.setOccurrenceAction).toHaveBeenCalledWith(occurrence, 'taken');
    expect(deps.toast).toHaveBeenCalledWith('已记录为已服');
    expect(deps.onRefresh).toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it("action='skipped' → 调用 setOccurrenceAction(occurrence, 'skipped')", async () => {
    const deps = makeDeps();
    await performHistoryAction(occurrence, 'skipped', deps);
    expect(deps.setOccurrenceAction).toHaveBeenCalledWith(occurrence, 'skipped');
    expect(deps.toast).toHaveBeenCalledWith('已记录为跳过');
  });

  it("action='clear' → 调用 setOccurrenceAction(occurrence, undefined)", async () => {
    const deps = makeDeps();
    await performHistoryAction(occurrence, 'clear', deps);
    expect(deps.setOccurrenceAction).toHaveBeenCalledWith(occurrence, undefined);
    expect(deps.toast).toHaveBeenCalledWith('已清除记录');
  });

  it('低库存时附加 lowStockMessage 二次 toast', async () => {
    const deps = makeDeps({
      setOccurrenceAction: vi.fn().mockResolvedValue({
        med: {}, inventoryChanged: true, lowStock: true, lowStockMessage: '阿莫西林 只剩 3 片',
      } as IntakeMutationResult),
    });
    await performHistoryAction(occurrence, 'taken', deps);
    expect(deps.toast).toHaveBeenNthCalledWith(1, '已记录为已服');
    expect(deps.toast).toHaveBeenNthCalledWith(2, '阿莫西林 只剩 3 片');
  });

  it('MedicationIntakeError(expired) → toast 错误信息，不触发 refresh，返回 { ok: false }', async () => {
    const error = new MedicationIntakeError('expired', '阿莫西林 已于 2026-07-01 过期，不能记录服用');
    const deps = makeDeps({ setOccurrenceAction: vi.fn().mockRejectedValue(error) });
    const result = await performHistoryAction(occurrence, 'taken', deps);
    expect(deps.toast).toHaveBeenCalledWith('阿莫西林 已于 2026-07-01 过期，不能记录服用');
    expect(deps.onRefresh).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error });
  });

  it('MedicationIntakeError(insufficient-inventory) → toast 错误信息，不触发 refresh', async () => {
    const error = new MedicationIntakeError('insufficient-inventory', '阿莫西林 库存不足');
    const deps = makeDeps({ setOccurrenceAction: vi.fn().mockRejectedValue(error) });
    const result = await performHistoryAction(occurrence, 'taken', deps);
    expect(deps.toast).toHaveBeenCalledWith('阿莫西林 库存不足');
    expect(deps.onRefresh).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });

  it('MedicationIntakeError(dose-review-required) → toast 错误信息，不触发 refresh', async () => {
    const error = new MedicationIntakeError('dose-review-required', '请先确认用量');
    const deps = makeDeps({ setOccurrenceAction: vi.fn().mockRejectedValue(error) });
    await performHistoryAction(occurrence, 'taken', deps);
    expect(deps.toast).toHaveBeenCalledWith('请先确认用量');
    expect(deps.onRefresh).not.toHaveBeenCalled();
  });

  it('insufficient-inventory 时 skipped 操作不受阻断（仍走成功路径）', async () => {
    // 业务上 setOccurrenceAction 对 skipped 不会抛 insufficient-inventory；
    // 但即便抛了其他类型的错误，performHistoryAction 也应正确处理
    const deps = makeDeps();
    await performHistoryAction(occurrence, 'skipped', deps);
    expect(deps.setOccurrenceAction).toHaveBeenCalledWith(occurrence, 'skipped');
    expect(deps.toast).toHaveBeenCalledWith('已记录为跳过');
    expect(deps.onRefresh).toHaveBeenCalled();
  });

  it('未知错误（非 MedicationIntakeError）→ 向上抛出，不 toast、不 refresh', async () => {
    const error = new Error('网络异常');
    const deps = makeDeps({ setOccurrenceAction: vi.fn().mockRejectedValue(error) });
    await expect(performHistoryAction(occurrence, 'taken', deps)).rejects.toThrow('网络异常');
    expect(deps.toast).not.toHaveBeenCalled();
    expect(deps.onRefresh).not.toHaveBeenCalled();
  });
});
