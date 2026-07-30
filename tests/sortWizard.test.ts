import { describe, expect, it } from 'vitest';
import { buildSortWizardSummary, type SortWizardItem } from '../src/ui/SortWizard';
import { emptyIdentity, type Medication } from '../src/db/schema';

function medication(id: string, name: string): Medication {
  return {
    id,
    name,
    dosageText: '',
    amountPerDose: '2片',
    doseQuantity: 9,
    doseUnit: '片',
    slots: ['morning'],
    mealRels: [],
    mealRelsBySlot: {},
    daysOfWeek: [],
    identity: emptyIdentity(),
    updatedAt: 1,
  };
}

describe('sort wizard summary', () => {
  it('uses occurrence doses and excludes rest or expired medications', () => {
    const items: SortWizardItem[] = [
      {
        med: medication('active', '有效药'),
        entries: [
          { occurrenceId: 'occ-1', slot: 'morning', timeLocal: '08:00', doseLabel: '0.5片', doseQuantity: 0.5, doseUnit: '片', mealRels: [] },
          { occurrenceId: 'occ-2', slot: 'evening', timeLocal: '18:00', doseLabel: '1片', doseQuantity: 1, doseUnit: '片', mealRels: [] },
          { occurrenceId: 'occ-review', slot: 'bedtime', timeLocal: '22:00', doseLabel: '按医嘱', mealRels: [] },
        ],
        isRest: false,
        expired: false,
      },
      { med: medication('rest', '停药药'), entries: [], isRest: true, expired: false },
      {
        med: medication('expired', '过期药'),
        entries: [{ occurrenceId: 'occ-expired', slot: 'morning', timeLocal: '08:00', doseLabel: '2片', doseQuantity: 2, doseUnit: '片', mealRels: [] }],
        isRest: false,
        expired: true,
      },
    ];

    expect(buildSortWizardSummary(items, 123)).toEqual({
      items: [{
        medId: 'active',
        medName: '有效药',
        entries: [
          { occurrenceId: 'occ-1', quantity: 0.5, unit: '片' },
          { occurrenceId: 'occ-2', quantity: 1, unit: '片' },
        ],
        totalDose: 1.5,
        doseUnit: '片',
        entryCount: 3,
      }],
      completedAt: 123,
    });
  });
});
