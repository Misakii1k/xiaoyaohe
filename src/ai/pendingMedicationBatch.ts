import type { PrescriptionItemDraft } from './identify';

// Cross-route handoff stays in memory so prescription images and their
// extracted health content are never written to browser storage by default.
let pending: PrescriptionItemDraft[] = [];
let pendingPhotos: (Blob | undefined)[] = [];

export function setPendingMedicationBatch(
  items: readonly PrescriptionItemDraft[],
  photos: readonly (Blob | undefined)[] = [],
): void {
  pending = items.map(clonePrescriptionItemDraft);
  pendingPhotos = items.map((_, index) => photos[index]);
}

export function hasPendingMedicationBatch(): boolean {
  return pending.length > 0;
}

export function takePendingMedicationBatch(): PrescriptionItemDraft[] {
  const result = pending;
  pending = [];
  return result;
}

/** 向导里拍的药盒照片，下标与同批次药品一一对应；同样只在内存中传递 */
export function takePendingMedicationPhotos(): (Blob | undefined)[] {
  const result = pendingPhotos;
  pendingPhotos = [];
  return result;
}

function clonePrescriptionItemDraft(item: PrescriptionItemDraft): PrescriptionItemDraft {
  return {
    ...item,
    slots: [...item.slots],
    mealRels: [...item.mealRels],
    mealRelsBySlot: Object.fromEntries(
      Object.entries(item.mealRelsBySlot).map(([slot, rels]) => [slot, [...(rels ?? [])]]),
    ) as PrescriptionItemDraft['mealRelsBySlot'],
    inventory: item.inventory ? { ...item.inventory } : undefined,
  };
}
