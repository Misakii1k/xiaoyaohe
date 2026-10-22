import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const reminderMocks = vi.hoisted(() => ({
  reschedule: vi.fn(async () => undefined),
}));

vi.mock('../src/features/reminderScheduler', () => ({
  rescheduleMedicationReminders: reminderMocks.reschedule,
}));

import {
  listRules,
  listRulesByMed,
  listScheduleRevisions,
  putMed,
  putRule,
} from '../src/db/local';
import {
  SLOT_DEFAULT_TIME,
  defaultEscalate,
  emptyIdentity,
  type Medication,
  type ReminderRule,
  type Slot,
} from '../src/db/schema';
import type { IdentifyResult } from '../src/ai/identify';
import {
  mergeIdentifyIntoExisting,
  persistPrescriptionMedicationBatch,
  type PrescriptionMedicationInput,
} from '../src/pages/ScanSort';

let sequence = 0;

beforeEach(() => {
  reminderMocks.reschedule.mockClear();
});

describe('scan medication persistence', () => {
  it('creates a default rule and immutable revision for every imported medication slot', async () => {
    const inputs: PrescriptionMedicationInput[] = [
      prescription('batch-a', ['morning', 'evening']),
      prescription('batch-b', ['noon']),
    ];

    const saved = await persistPrescriptionMedicationBatch(inputs);

    expect(saved).toHaveLength(2);
    expect(reminderMocks.reschedule).toHaveBeenCalledTimes(1);
    for (const med of saved) {
      const rules = await listRulesByMed(med.id);
      expect(new Set(rules.map(({ slot }) => slot))).toEqual(new Set(med.slots));
      for (const rule of rules) {
        expect(rule.timeLocal).toBe(SLOT_DEFAULT_TIME[rule.slot]);
        expect(rule.escalate).toEqual(defaultEscalate());
      }
      const revisions = (await listScheduleRevisions()).filter(
        (revision) => revision.medId === med.id,
      );
      expect(revisions).toHaveLength(med.slots.length);
      expect(new Set(revisions.map(({ sourceRuleId }) => sourceRuleId))).toEqual(
        new Set(rules.map(({ id }) => id)),
      );
    }
  });

  it('preserves existing times, deletes removed slots, and defaults newly recognized slots', async () => {
    const med = medication('merge-slots', ['morning', 'noon']);
    await putMed(med);
    const morning = rule(med.id, 'morning', '07:15');
    const noon = rule(med.id, 'noon', '12:40');
    await putRule(morning);
    await putRule(noon);
    const morningBefore = (await listScheduleRevisions()).filter(
      ({ sourceRuleId }) => sourceRuleId === morning.id,
    ).length;

    await mergeIdentifyIntoExisting(
      med,
      identify({ amountPerDose: '2片', slots: ['morning', 'evening'] }),
      null,
      '',
      imageFile(),
      new Set(['amountPerDose', 'slots']),
    );

    const active = await listRulesByMed(med.id);
    expect(active).toHaveLength(2);
    expect(active.find(({ slot }) => slot === 'morning')).toMatchObject({
      id: morning.id,
      timeLocal: '07:15',
    });
    expect(active.find(({ slot }) => slot === 'evening')).toMatchObject({
      timeLocal: SLOT_DEFAULT_TIME.evening,
      escalate: defaultEscalate(),
    });
    const includingDeleted = (await listRules(true)).filter(({ medId }) => medId === med.id);
    expect(includingDeleted.find(({ id }) => id === noon.id)?.deleted).toBe(true);

    const revisions = (await listScheduleRevisions()).filter(({ medId }) => medId === med.id);
    expect(revisions.filter(({ sourceRuleId }) => sourceRuleId === morning.id).length)
      .toBeGreaterThan(morningBefore);
    expect(revisions.some(({ sourceRuleId, enabled }) => sourceRuleId === noon.id && !enabled)).toBe(true);
    const eveningRule = active.find(({ slot }) => slot === 'evening');
    expect(revisions.some(({ sourceRuleId }) => sourceRuleId === eveningRule?.id)).toBe(true);
    expect(reminderMocks.reschedule).toHaveBeenCalledTimes(1);
  });

  it('writes a new revision when only the recognized dose text changes', async () => {
    const med = medication('merge-dose', ['morning'], {
      amountPerDose: '1片',
      doseQuantity: 1,
      doseUnit: '片',
      doseSourceText: '1片',
    });
    await putMed(med);
    const morning = rule(med.id, 'morning', '06:50');
    await putRule(morning);
    const before = (await listScheduleRevisions()).filter(
      ({ sourceRuleId }) => sourceRuleId === morning.id,
    );

    await mergeIdentifyIntoExisting(
      med,
      identify({ amountPerDose: '半片', slots: ['morning'] }),
      null,
      '',
      imageFile(),
      new Set(['amountPerDose']),
    );

    const rules = await listRulesByMed(med.id);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ id: morning.id, timeLocal: '06:50' });
    const after = (await listScheduleRevisions()).filter(
      ({ sourceRuleId }) => sourceRuleId === morning.id,
    );
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.some((revision) => revision.doseQuantity === 0.5 || revision.doseQuantity == null)).toBe(true);
    expect(reminderMocks.reschedule).toHaveBeenCalledTimes(1);
  });
});

function medication(
  prefix: string,
  slots: Slot[],
  overrides: Partial<Medication> = {},
): Medication {
  return {
    id: unique(prefix),
    name: `${prefix}药`,
    dosageText: '5mg/片',
    amountPerDose: '1片',
    slots,
    mealRels: [],
    mealRelsBySlot: {},
    daysOfWeek: [],
    identity: emptyIdentity(),
    createdAt: Date.now(),
    updatedAt: 0,
    ...overrides,
  };
}

function rule(medId: string, slot: Slot, timeLocal: string): ReminderRule {
  return {
    id: unique(`rule-${slot}`),
    medId,
    slot,
    timeLocal,
    enabled: true,
    escalate: defaultEscalate(),
    updatedAt: 0,
  };
}

function prescription(prefix: string, slots: Slot[]): PrescriptionMedicationInput {
  return {
    name: `${unique(prefix)}药`,
    dosageText: '10mg/片',
    amountPerDose: '1片',
    slots,
    mealRelsBySlot: {},
    notes: '',
  };
}

function identify(overrides: Partial<IdentifyResult>): IdentifyResult {
  return {
    name: '识别药',
    dosageText: '10mg/片',
    amountPerDose: '1片',
    slots: ['morning'],
    mealRels: [],
    mealRelsBySlot: {},
    evidence: { ocrNames: ['识别药'], gtins: [], rawCodes: [] },
    confidence: 0.95,
    ...overrides,
  };
}

function imageFile(): File {
  return new File(['image'], 'medicine.jpg', { type: 'image/jpeg' });
}

function unique(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}
