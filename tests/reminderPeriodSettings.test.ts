import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  getLogForOccurrence,
  getMed,
  getReminderPeriodSetting,
  listReminderPeriodSettings,
  listScheduleRevisions,
  openMedboxDatabase,
  putMed,
  putRule,
  recomputeReminderPeriodReviewState,
  setOccurrenceActions,
  updateReminderPeriodSetting,
} from '../src/db/local';
import { defaultEscalate, emptyIdentity, type Medication, type ReminderRule, type Slot } from '../src/db/schema';
import { addLocalDays, projectScheduleDate, toLocalDate } from '../src/domain/medicationSchedule';

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('medbox');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

// 各测试共享同一 'medbox' 数据库；时段行会保留用户设置，测试间需清空互不干扰
beforeEach(async () => {
  const database = await openMedboxDatabase();
  const tx = database.transaction(['meds', 'rules', 'reminderPeriods'], 'readwrite');
  await Promise.all(
    ['meds', 'rules', 'reminderPeriods'].map((store) => tx.objectStore(store).clear()),
  );
  await tx.done;
});

function medication(id: string, name: string, overrides: Partial<Medication> = {}): Medication {
  return {
    id,
    name,
    dosageText: '',
    amountPerDose: '1片',
    doseQuantity: 1,
    doseUnit: '片',
    slots: ['morning'],
    mealRels: [],
    mealRelsBySlot: {},
    daysOfWeek: [],
    reminderMode: 'strong',
    inventory: { remaining: 2, unit: '片' },
    identity: emptyIdentity(),
    createdAt: Date.now(),
    updatedAt: 1,
    ...overrides,
  };
}

function rule(id: string, medId: string, slot: Slot, overrides: Partial<ReminderRule> = {}): ReminderRule {
  return {
    id,
    medId,
    slot,
    timeLocal: '08:00',
    enabled: true,
    escalate: defaultEscalate(),
    updatedAt: 1,
    ...overrides,
  };
}

describe('时段提醒设置（设备本地 v9）', () => {
  it('v9 数据库带 reminderPeriods store；保存药品/规则后复核重算把贡献时段落库', async () => {
    const database = await openMedboxDatabase();
    expect(Array.from(database.objectStoreNames)).toContain('reminderPeriods');

    // 空库时没有贡献者：不落行，但 list 仍按派生值合成 4 个时段
    const initial = await listReminderPeriodSettings();
    expect(initial.map((s) => s.slot)).toEqual(['morning', 'noon', 'evening', 'bedtime']);
    expect(await database.get('reminderPeriods', 'morning')).toBeUndefined();

    await putMed(medication('seed-med', '种子药'));
    await putRule(rule('seed-rule', 'seed-med', 'morning'));
    await recomputeReminderPeriodReviewState();

    const storedMorning = await database.get('reminderPeriods', 'morning');
    expect(storedMorning).toBeDefined();
    expect(storedMorning.slot).toBe('morning');
    expect(storedMorning.timeLocal).toBe('08:00');
    // 无贡献的时段不落行
    expect(await database.get('reminderPeriods', 'noon')).toBeUndefined();
  });

  it('时段内方式不一致 → needs-review；保存时段设置仍待复核；消除差异后恢复 active 且保留用户时间', async () => {
    await putMed(medication('conflict-a', '甲药', { reminderMode: 'strong' }));
    await putMed(medication('conflict-b', '乙药', { reminderMode: 'fullscreen-persistent', slots: ['morning', 'evening'] }));
    await putRule(rule('conflict-a-rule', 'conflict-a', 'morning'));
    await putRule(rule('conflict-b-rule', 'conflict-b', 'morning'));
    await recomputeReminderPeriodReviewState();

    let morning = (await listReminderPeriodSettings()).find((s) => s.slot === 'morning')!;
    expect(morning.state).toBe('needs-review');
    // 方式取最强档
    expect(morning.mode).toBe('fullscreen-persistent');

    // 用户确认整体时间：只改时间，复核标记由 recompute 派生，不在此处清除
    const saved = await updateReminderPeriodSetting('morning', { timeLocal: '07:30' });
    expect(saved.timeLocal).toBe('07:30');
    expect(saved.state).toBe('needs-review');

    // 乙药方式与甲药一致 → 复核重算后恢复 active，且用户设置的 07:30 保留
    await putMed(medication('conflict-b', '乙药', { reminderMode: 'strong', slots: ['morning', 'evening'] }));
    await recomputeReminderPeriodReviewState();
    morning = (await listReminderPeriodSettings()).find((s) => s.slot === 'morning')!;
    expect(morning.state).toBe('active');
    expect(morning.timeLocal).toBe('07:30');
  });

  it('updateReminderPeriodSetting 非法时间整体回滚，不落任何字段', async () => {
    await putMed(medication('atomic-med', '原子药'));
    await putRule(rule('atomic-rule', 'atomic-med', 'morning'));
    await recomputeReminderPeriodReviewState();
    const before = await getReminderPeriodSetting('morning');

    await expect(
      updateReminderPeriodSetting('morning', { timeLocal: '25:99', mode: 'fullscreen-short' }),
    ).rejects.toThrow();

    const after = await getReminderPeriodSetting('morning');
    expect(after.timeLocal).toBe(before.timeLocal);
    expect(after.mode).toBe(before.mode);
  });

  it('setOccurrenceActions 单事务批量记录；任一条失败则整批回滚', async () => {
    await putMed(medication('batch-med', '批量药', { doseQuantity: 0.5, doseUnit: '片' }));
    await putRule(rule('batch-rule-m', 'batch-med', 'morning'));
    await putRule(rule('batch-rule-n', 'batch-med', 'noon'));
    const revisions = (await listScheduleRevisions())
      .filter((r) => r.sourceRuleId === 'batch-rule-m' || r.sourceRuleId === 'batch-rule-n');
    const occurrences = revisions.map((r) => projectScheduleDate([r], toLocalDate())[0].occurrence!);

    // 两条一起记已服：一次事务扣两次库存、写两条日志
    const results = await setOccurrenceActions(occurrences, 'taken', { ackAt: Date.now() });
    expect(results).toHaveLength(2);
    expect((await getMed('batch-med'))?.inventory?.remaining).toBe(1);
    for (const occurrence of occurrences) {
      expect((await getLogForOccurrence(occurrence))?.status).toBe('taken');
    }

    // 批量撤销：同一事务恢复两条库存。库存恢复要求「最近一次扣减」先回滚，
    // 所以按时间倒序（与恢复链一致）。
    await setOccurrenceActions([...occurrences].reverse(), undefined);
    expect((await getMed('batch-med'))?.inventory?.remaining).toBe(2);
    for (const occurrence of occurrences) {
      expect(await getLogForOccurrence(occurrence)).toBeUndefined();
    }

    // 药品过期后整批回滚：任一条失败，前面已扣的库存与已写日志一并撤销
    const expired = (await getMed('batch-med'))!;
    expired.expiryLocalDate = addLocalDays(toLocalDate(), -1);
    await putMed(expired);
    await expect(setOccurrenceActions(occurrences, 'taken')).rejects.toMatchObject({ code: 'expired' });
    expect((await getMed('batch-med'))?.inventory?.remaining).toBe(2);
    for (const occurrence of occurrences) {
      expect(await getLogForOccurrence(occurrence)).toBeUndefined();
    }
  });
});
