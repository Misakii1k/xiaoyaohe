import { describe, expect, it } from 'vitest';
import { defaultEscalate, emptyIdentity, type IntakeLog, type Medication, type ReminderRule } from '../src/db/schema';
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

describe('native medication reminder plan', () => {
  const now = new Date(2026, 6, 13, 7, 0, 0).getTime();

  it('pre-schedules the dose and bounded escalation phases', () => {
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
    expect(plan[0].body).toContain('1.5片');
    expect(plan[0].data).toMatchObject({
      occurrenceId: 'occurrence:rule-1:2026-07-13',
      medId: 'med-1',
    });
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

  it('keeps the legacy caregiver delay as inert compatibility data', () => {
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
      'occurrence:rule-1:2026-07-13',
      'occurrence:rule-1:2026-07-13',
      'occurrence:rule-1:2026-07-13',
    ]);
    expect(plan.every(({ data }) => data?.kind === 'reminder')).toBe(true);
  });
});
