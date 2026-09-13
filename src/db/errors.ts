import type { validateMedicationDraft } from '../domain/medicationDraft';

export type MedicationInventoryErrorCode =
  | 'invalid-intent'
  | 'inventory-conflict'
  | 'profile-conflict'
  | 'unit-conflict';

export class MedicationInventoryError extends Error {
  readonly code: MedicationInventoryErrorCode;
  constructor(code: MedicationInventoryErrorCode, message: string) {
    super(message);
    this.name = 'MedicationInventoryError';
    this.code = code;
  }
}

export type MedicationIntakeErrorCode =
  | 'medication-not-found'
  | 'expired'
  | 'dose-review-required'
  | 'insufficient-inventory'
  | 'inventory-effect-conflict';

export class MedicationIntakeError extends Error {
  readonly code: MedicationIntakeErrorCode;
  constructor(code: MedicationIntakeErrorCode, message: string) {
    super(message);
    this.name = 'MedicationIntakeError';
    this.code = code;
  }
}

export class MedicationBatchValidationError extends Error {
  constructor(readonly draftErrors: ReadonlyMap<string, ReturnType<typeof validateMedicationDraft>>) {
    super('批量药品中存在需要修正的项目');
    this.name = 'MedicationBatchValidationError';
  }
}
