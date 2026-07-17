import { afterEach, describe, expect, it, vi } from 'vitest';

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  registerRouteTransitionCleanup: vi.fn(() => () => undefined),
}));

vi.mock('../src/router', () => routerMocks);

import { takePendingMedicationBatch, setPendingMedicationBatch } from '../src/ai/pendingMedicationBatch';
import { handoffPrescriptionBatch } from '../src/pages/ScanSort';
import type { PrescriptionItemDraft } from '../src/ai/identify';

function prescriptionDraft(): PrescriptionItemDraft {
  return {
    name: '对乙酰氨基酚',
    dosageText: '500mg/片',
    amountPerDose: '1片',
    slots: ['morning'],
    mealRels: ['after'],
    mealRelsBySlot: { morning: ['after'] },
    notes: '饭后服用',
    confidence: 0.96,
  };
}

afterEach(() => {
  takePendingMedicationBatch();
  routerMocks.navigate.mockReset();
});

describe('pending medication batch handoff', () => {
  it('deeply snapshots nested prescription fields before a route consumes them', () => {
    const draft = prescriptionDraft();
    setPendingMedicationBatch([draft]);

    draft.slots.push('evening');
    draft.mealRels.push('before');
    draft.mealRelsBySlot.morning?.push('before');

    expect(takePendingMedicationBatch()).toEqual([prescriptionDraft()]);
  });

  it('consumes a pending batch only once', () => {
    setPendingMedicationBatch([prescriptionDraft()]);

    expect(takePendingMedicationBatch()).toHaveLength(1);
    expect(takePendingMedicationBatch()).toEqual([]);
  });

  it('hands recognized prescription items to the unified batch workspace without writing them', () => {
    const draft = prescriptionDraft();

    handoffPrescriptionBatch([draft]);

    expect(routerMocks.navigate).toHaveBeenCalledWith('/meds/new');
    expect(takePendingMedicationBatch()).toEqual([draft]);
  });
});
