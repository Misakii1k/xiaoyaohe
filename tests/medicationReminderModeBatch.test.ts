import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { getMed, putMed, updateMedicationReminderModes } from '../src/db/local';
import { emptyIdentity, type Medication } from '../src/db/schema';

let sequence = 0;

function medication(name: string, reminderMode: Medication['reminderMode'] = 'strong'): Medication {
  const id = `reminder-mode-${++sequence}`;
  return {
    id,
    name,
    dosageText: '100mg/片',
    amountPerDose: '1片',
    slots: ['morning'],
    mealRels: [],
    mealRelsBySlot: {},
    daysOfWeek: [],
    reminderMode,
    inventory: { remaining: 12, unit: '片' },
    notes: '保留这些资料',
    identity: emptyIdentity(),
    updatedAt: 1,
  };
}

describe('atomic medication reminder-mode updates', () => {
  it('updates several medications while preserving unrelated profile fields', async () => {
    const first = medication('提醒甲');
    const second = medication('提醒乙', 'fullscreen-short');
    await putMed(first);
    await putMed(second);

    const result = await updateMedicationReminderModes(
      [first.id, second.id],
      'fullscreen-persistent',
    );

    expect(result.map((entry) => [entry.medName, entry.previousMode, entry.changed])).toEqual([
      ['提醒甲', 'strong', true],
      ['提醒乙', 'fullscreen-short', true],
    ]);
    expect(await getMed(first.id)).toMatchObject({
      reminderMode: 'fullscreen-persistent',
      notes: '保留这些资料',
      inventory: { remaining: 12, unit: '片' },
    });
  });

  it('reports an already matching mode without rewriting its meaning', async () => {
    const med = medication('幂等药', 'strong');
    await putMed(med);

    const result = await updateMedicationReminderModes([med.id, med.id], 'strong');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ changed: false, previousMode: 'strong', mode: 'strong' });
  });

  it('rolls back the whole transaction when any target is missing', async () => {
    const med = medication('回滚药', 'strong');
    await putMed(med);

    await expect(updateMedicationReminderModes(
      [med.id, 'missing-reminder-mode-medication'],
      'fullscreen-short',
    )).rejects.toThrow(/本次未更改任何提醒方式/);

    expect((await getMed(med.id))?.reminderMode).toBe('strong');
  });
});
