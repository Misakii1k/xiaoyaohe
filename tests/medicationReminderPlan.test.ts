import { describe, expect, it } from 'vitest';
import {
  defaultEscalate,
  emptyIdentity,
  type IntakeLog,
  type Medication,
  type ReminderPeriodSetting,
  type ReminderRule,
} from '../src/db/schema';
import { createScheduleRevision, generateOccurrences } from '../src/domain/medicationSchedule';
import { buildMedicationReminderPlan } from '../src/features/medicationReminderPlan';

function medication(overrides: Partial<Medication> = {}): Medication {
  return {
    id: 'med-1',
    name: '测试药',
    dosageText: '',
    amountPerDose: '1片',
    slots: ['morning'],
    mealRels: [],
    mealRelsBySlot: {},
    daysOfWeek: [],
    reminderMode: 'strong',
    identity: emptyIdentity(),
    updatedAt: 1,
    ...overrides,
  };
}

function rule(overrides: Partial<ReminderRule> = {}): ReminderRule {
  return {
    id: 'rule-1',
    medId: 'med-1',
    slot: 'morning',
    timeLocal: '08:00',
    enabled: true,
    escalate: { ...defaultEscalate(), maxRepeats: 2 },
    updatedAt: 100,
    ...overrides,
  };
}

function periodSetting(overrides: Partial<ReminderPeriodSetting> = {}): ReminderPeriodSetting {
  return {
    slot: 'morning',
    timeLocal: '08:00',
    mode: 'strong',
    escalate: defaultEscalate(),
    state: 'active',
    updatedAt: 1,
    ...overrides,
  };
}

describe('native medication reminder plan', () => {
  const now = new Date(2026, 6, 13, 7, 0, 0).getTime();

  it('pre-schedules the dose and bounded escalation phases as one group', () => {
    const med = medication({ doseQuantity: 1.5, doseUnit: '片' });
    const reminderRule = rule();
    const revision = createScheduleRevision(med, reminderRule, {
      effectiveDate: '2026-07-13',
      createdAt: 100,
    });

    const plan = buildMedicationReminderPlan({
      meds: [med],
      rules: [reminderRule],
      revisions: [revision],
      logs: [],
      now,
      horizonDays: 1,
    });

    expect(plan).toHaveLength(3);
    expect(plan.map(({ key }) => key)).toEqual(['dose', 'repeat-2', 'repeat-3']);
    expect(plan.map(({ at }) => new Date(at).getMinutes())).toEqual([0, 10, 20]);
    // 整体提醒：同一 (日期, 时段) 只响一组，所有阶段共用组 tag，reminderCount 递增
    expect(plan.map(({ tag }) => tag)).toEqual([
      'reminder-group:2026-07-13:morning',
      'reminder-group:2026-07-13:morning',
      'reminder-group:2026-07-13:morning',
    ]);
    expect(plan[0].body).toContain('1.5片');
    expect(plan[0].data).toMatchObject({
      kind: 'reminder-group',
      groupId: 'reminder-group:2026-07-13:morning',
      date: '2026-07-13',
      slot: 'morning',
      dueAt: expect.any(Number),
      mode: 'strong',
      reminderCount: 1,
    });
    expect(plan.map(({ data }) => data?.reminderCount)).toEqual([1, 2, 3]);
    expect(plan[0].data?.occurrences).toEqual([
      {
        occurrenceId: 'occurrence:rule-1:2026-07-13',
        legacyLogId: 'rule-1_20260713',
        medId: 'med-1',
        medName: '测试药',
        dose: '1.5片',
      },
    ]);
  });

  it('does not schedule handled occurrences', () => {
    const med = medication();
    const reminderRule = rule();
    const revision = createScheduleRevision(med, reminderRule, {
      effectiveDate: '2026-07-13',
      createdAt: 100,
    });
    const occurrence = generateOccurrences([revision], '2026-07-13', '2026-07-13')[0];
    const log: IntakeLog = {
      id: occurrence.id,
      occurrenceId: occurrence.id,
      medId: med.id,
      slot: occurrence.slot,
      dueAt: occurrence.dueAt,
      status: 'taken',
      updatedAt: now,
    };

    expect(
      buildMedicationReminderPlan({
        meds: [med],
        rules: [reminderRule],
        revisions: [revision],
        logs: [log],
        now,
        horizonDays: 1,
      }),
    ).toEqual([]);
  });

  it('groups multiple medications in the same slot into one reminder with per-med rows', () => {
    const medA = medication({ id: 'med-a', name: '二甲双胍', doseQuantity: 1, doseUnit: '片' });
    const medB = medication({ id: 'med-b', name: '阿司匹林', doseQuantity: 1, doseUnit: '粒' });
    const ruleA = rule({ id: 'rule-a', medId: 'med-a', escalate: { ...defaultEscalate(), maxRepeats: 0 } });
    const ruleB = rule({ id: 'rule-b', medId: 'med-b', escalate: { ...defaultEscalate(), maxRepeats: 0 } });
    const revisionA = createScheduleRevision(medA, ruleA, { effectiveDate: '2026-07-13', createdAt: 100 });
    const revisionB = createScheduleRevision(medB, ruleB, { effectiveDate: '2026-07-13', createdAt: 100 });

    const plan = buildMedicationReminderPlan({
      meds: [medA, medB],
      rules: [ruleA, ruleB],
      revisions: [revisionA, revisionB],
      logs: [],
      now,
      horizonDays: 1,
    });

    expect(plan).toHaveLength(1);
    expect(plan[0].tag).toBe('reminder-group:2026-07-13:morning');
    const occurrences = plan[0].data?.occurrences as Array<Record<string, unknown>>;
    expect(occurrences).toHaveLength(2);
    expect(occurrences.map((item) => item.medName).sort()).toEqual(['二甲双胍', '阿司匹林']);
    expect(plan[0].body).toContain('二甲双胍 1片');
    expect(plan[0].body).toContain('阿司匹林 1粒');
  });

  it('keeps the legacy caregiver delay as inert compatibility data and groups under one tag', () => {
    const med = medication();
    const reminderRule = rule({
      escalate: { ...defaultEscalate(), maxRepeats: 2, notifyCaregiverAfterMin: 1 },
    });
    const revision = createScheduleRevision(med, reminderRule, {
      effectiveDate: '2026-07-13',
      createdAt: 100,
    });

    const plan = buildMedicationReminderPlan({
      meds: [med],
      rules: [reminderRule],
      revisions: [revision],
      logs: [],
      now,
      horizonDays: 1,
    });

    expect(plan).toHaveLength(3);
    expect(plan.map(({ key }) => key)).toEqual(['dose', 'repeat-2', 'repeat-3']);
    expect(plan.map(({ tag }) => tag)).toEqual([
      'reminder-group:2026-07-13:morning',
      'reminder-group:2026-07-13:morning',
      'reminder-group:2026-07-13:morning',
    ]);
    expect(plan.every(({ data }) => data?.kind === 'reminder-group')).toBe(true);
  });

  it('takes mode and trigger time from the period-level settings', () => {
    const med = medication({ reminderMode: 'fullscreen-persistent' });
    const reminderRule = rule({ escalate: { ...defaultEscalate(), maxRepeats: 0 } });
    const revision = createScheduleRevision(med, reminderRule, {
      effectiveDate: '2026-07-13',
      createdAt: 100,
    });
    // 显式传入时段设置：整体时间与方式以时段设置（07:30 全屏）为准，不再跟随单药 reminderMode
    const plan = buildMedicationReminderPlan({
      meds: [med],
      rules: [reminderRule],
      revisions: [revision],
      logs: [],
      now,
      horizonDays: 1,
      periodSettings: [periodSetting({ timeLocal: '07:30', mode: 'fullscreen-short', escalate: { ...defaultEscalate(), maxRepeats: 0 } })],
    });
    expect(plan).toHaveLength(1);
    expect(new Date(plan[0].at).getHours()).toBe(7);
    expect(new Date(plan[0].at).getMinutes()).toBe(30);
    expect(plan[0].data).toMatchObject({
      mode: 'fullscreen-short',
      groupId: 'reminder-group:2026-07-13:morning',
    });
    const occurrences = plan[0].data?.occurrences as Array<Record<string, unknown>>;
    expect(occurrences[0]).toMatchObject({ medName: '测试药', occurrenceId: 'occurrence:rule-1:2026-07-13' });
  });

  it('respects a handled occurrence inside a mixed group', () => {
    const medA = medication({ id: 'med-a', name: '甲药' });
    const medB = medication({ id: 'med-b', name: '乙药' });
    const ruleA = rule({ id: 'rule-a', medId: 'med-a', escalate: { ...defaultEscalate(), maxRepeats: 0 } });
    const ruleB = rule({ id: 'rule-b', medId: 'med-b', escalate: { ...defaultEscalate(), maxRepeats: 0 } });
    const revisionA = createScheduleRevision(medA, ruleA, { effectiveDate: '2026-07-13', createdAt: 100 });
    const revisionB = createScheduleRevision(medB, ruleB, { effectiveDate: '2026-07-13', createdAt: 100 });
    const occurrenceB = generateOccurrences([revisionB], '2026-07-13', '2026-07-13')[0];
    const log: IntakeLog = {
      id: occurrenceB.id,
      occurrenceId: occurrenceB.id,
      medId: medB.id,
      slot: occurrenceB.slot,
      dueAt: occurrenceB.dueAt,
      status: 'taken',
      updatedAt: now,
    };

    const plan = buildMedicationReminderPlan({
      meds: [medA, medB],
      rules: [ruleA, ruleB],
      revisions: [revisionA, revisionB],
      logs: [log],
      now,
      horizonDays: 1,
    });

    expect(plan).toHaveLength(1);
    const occurrences = plan[0].data?.occurrences as Array<Record<string, unknown>>;
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].medName).toBe('甲药');
  });

  it('skips scheduled reminders when the period setting is disabled', () => {
    const med = medication();
    const reminderRule = rule({ escalate: { ...defaultEscalate(), maxRepeats: 0 } });
    const revision = createScheduleRevision(med, reminderRule, { effectiveDate: '2026-07-13', createdAt: 100 });

    const plan = buildMedicationReminderPlan({
      meds: [med],
      rules: [reminderRule],
      revisions: [revision],
      logs: [],
      now,
      horizonDays: 1,
      periodSettings: [periodSetting({ slot: 'morning', enabled: false })],
    });

    expect(plan).toHaveLength(0);
  });

  it('schedules reminders for both primary and extra times in a period', () => {
    const med = medication();
    const reminderRule = rule({ escalate: { ...defaultEscalate(), maxRepeats: 0 } });
    const revision = createScheduleRevision(med, reminderRule, { effectiveDate: '2026-07-13', createdAt: 100 });

    const plan = buildMedicationReminderPlan({
      meds: [med],
      rules: [reminderRule],
      revisions: [revision],
      logs: [],
      now,
      horizonDays: 1,
      periodSettings: [
        periodSetting({
          slot: 'morning',
          timeLocal: '08:00',
          extraTimes: ['08:30'],
          escalate: { ...defaultEscalate(), maxRepeats: 0 },
        }),
      ],
    });

    expect(plan).toHaveLength(2);
    expect(plan[0].tag).toBe('reminder-group:2026-07-13:morning');
    expect(plan[1].tag).toBe('reminder-group:2026-07-13:morning@0830');
  });
});
