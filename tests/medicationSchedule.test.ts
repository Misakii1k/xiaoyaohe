import { describe, expect, it } from 'vitest';
import {
  calculateAdherence,
  createScheduleRevision,
  generateOccurrences,
  isMedicationExpiredOn,
  isOccurrenceEligible,
  projectScheduleDate,
  toLocalDate,
} from '../src/domain/medicationSchedule';
import { deductInventory, estimateDailyConsumption, suggestStructuredDose } from '../src/features/inventory';
import { defaultEscalate, emptyIdentity, type IntakeLog, type Medication, type ReminderRule } from '../src/db/schema';

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
    escalate: defaultEscalate(),
    updatedAt: 100,
    ...overrides,
  };
}

describe('immutable medication schedule revisions', () => {
  it('generates stable revision and occurrence ids', () => {
    const med = medication({ doseQuantity: 1.5, doseUnit: '片' });
    const first = createScheduleRevision(med, rule(), {
      effectiveDate: '2026-07-01',
      createdAt: 123,
    });
    const second = createScheduleRevision(med, rule(), {
      effectiveDate: '2026-07-01',
      createdAt: 123,
    });
    const firstOccurrence = generateOccurrences([first], '2026-07-01', '2026-07-01')[0];
    const secondOccurrence = generateOccurrences([second], '2026-07-01', '2026-07-01')[0];

    expect(first.id).toBe(second.id);
    expect(firstOccurrence.id).toBe(secondOccurrence.id);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('uses local calendar days for a 1-day-on, 1-day-off cycle', () => {
    const createdAt = new Date(2026, 6, 13, 15, 45).getTime();
    const revision = createScheduleRevision(
      medication({ createdAt }),
      rule({ cycle: { activeDays: 1, restDays: 1 } }),
      { effectiveDate: '2026-07-13', createdAt: 123 },
    );

    expect(revision.cycleStartDate).toBe('2026-07-13');
    expect(projectScheduleDate([revision], '2026-07-13')[0].isRest).toBe(false);
    const rest = projectScheduleDate([revision], '2026-07-14')[0];
    expect(rest.isRest).toBe(true);
    expect(rest.occurrence).toBeUndefined();
  });

  it('flags a legacy cycle with no creation date for review', () => {
    const revision = createScheduleRevision(
      medication({ createdAt: undefined }),
      rule({ cycle: { activeDays: 1, restDays: 1 } }),
      { effectiveDate: '2026-07-13', createdAt: 123 },
    );
    expect(revision.reviewFlags).toContain('cycle-start-missing');
    expect(projectScheduleDate([revision], '2026-07-14')[0].isRest).toBe(false);
  });
});

describe('occurrence-derived adherence', () => {
  it('counts missing actions as missed and skipped as handled but not adherent', () => {
    const revision = createScheduleRevision(medication(), rule(), {
      effectiveDate: '2026-07-07',
      createdAt: 123,
    });
    const occurrences = generateOccurrences([revision], '2026-07-07', '2026-07-13');
    const logs: IntakeLog[] = [
      {
        id: occurrences[5].id,
        occurrenceId: occurrences[5].id,
        medId: 'med-1',
        slot: 'morning',
        dueAt: occurrences[5].dueAt,
        status: 'skipped',
        updatedAt: 1,
      },
      {
        id: occurrences[6].id,
        occurrenceId: occurrences[6].id,
        medId: 'med-1',
        slot: 'morning',
        dueAt: occurrences[6].dueAt,
        status: 'taken',
        updatedAt: 1,
      },
    ];
    const now = new Date(2026, 6, 13, 12, 0).getTime();
    const summary = calculateAdherence(occurrences, logs, now);

    expect(summary).toMatchObject({ due: 7, taken: 1, skipped: 1, missed: 5, handled: 2 });
    expect(summary.adherenceRate).toBeCloseTo(1 / 7);
    expect(summary.handledRate).toBeCloseTo(2 / 7);
  });

  it('checks early eligibility per occurrence even when slots match', () => {
    const med = medication();
    const early = createScheduleRevision(med, rule({ id: 'rule-8', timeLocal: '08:00' }), {
      effectiveDate: '2026-07-13',
      createdAt: 123,
    });
    const late = createScheduleRevision(med, rule({ id: 'rule-11', timeLocal: '11:00' }), {
      effectiveDate: '2026-07-13',
      createdAt: 123,
    });
    const occurrences = generateOccurrences([early, late], '2026-07-13', '2026-07-13');
    const now = new Date(2026, 6, 13, 7, 40).getTime();

    expect(isOccurrenceEligible(occurrences[0], now)).toBe(true);
    expect(isOccurrenceEligible(occurrences[1], now)).toBe(false);
  });
});

describe('dose and expiry correctness', () => {
  it('preserves decimal doses exactly and never uses a suggestion as confirmation', () => {
    expect(suggestStructuredDose('1.5片')).toEqual({ quantity: 1.5, unit: '片' });
    expect(suggestStructuredDose('0.25片')).toEqual({ quantity: 0.25, unit: '片' });
    expect(suggestStructuredDose('1片半')).toEqual({ quantity: 1.5, unit: '片' });

    const unconfirmed = medication({ inventory: { remaining: 2, unit: '片' } });
    expect(deductInventory(unconfirmed).reviewRequired).toBe(true);
    expect(unconfirmed.inventory?.remaining).toBe(2);
    expect(estimateDailyConsumption(unconfirmed, [rule()])).toBe(0);
    expect(suggestStructuredDose('1片', 'mL')).toEqual({ quantity: 1, unit: '片' });

    const mismatched = medication({
      doseQuantity: 1,
      doseUnit: '片',
      inventory: { remaining: 10, unit: 'mL' },
    });
    expect(deductInventory(mismatched).reviewRequired).toBe(true);
    expect(mismatched.inventory?.remaining).toBe(10);
    expect(estimateDailyConsumption(mismatched, [rule()])).toBe(0);

    const equivalentVolumeUnits = medication({
      doseQuantity: 1.5,
      doseUnit: 'mL',
      inventory: { remaining: 10, unit: '毫升' },
    });
    expect(deductInventory(equivalentVolumeUnits).changed).toBe(true);
    expect(equivalentVolumeUnits.inventory?.remaining).toBe(8.5);

    const confirmed = medication({
      doseQuantity: 0.25,
      doseUnit: '片',
      inventory: { remaining: 1, unit: '片' },
    });
    expect(deductInventory(confirmed).changed).toBe(true);
    expect(confirmed.inventory?.remaining).toBe(0.75);

    expect(
      estimateDailyConsumption(
        medication({ doseQuantity: 1.5, doseUnit: '片' }),
        [rule({ cycle: { activeDays: 1, restDays: 1 } })],
      ),
    ).toBe(0.75);
  });

  it('treats expiry as a local date inclusive through that date', () => {
    const med = medication({ expiryLocalDate: '2026-07-13' });
    expect(isMedicationExpiredOn(med, '2026-07-13')).toBe(false);
    expect(isMedicationExpiredOn(med, '2026-07-14')).toBe(true);
    expect(toLocalDate(new Date(2026, 6, 13, 23, 59))).toBe('2026-07-13');
  });
});
