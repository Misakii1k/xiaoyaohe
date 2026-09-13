import {
  getMedicationExpiryLocalDate,
  isLocalDate,
} from '../domain/medicationSchedule';
import { suggestStructuredDose } from '../features/inventory';
import {
  inflateMed,
  type Medication,
} from './schema';

export function normalizeMedication(med: Medication): Medication {
  const inflated = inflateMed(med) as Medication;
  if (Number.isFinite(inflated.expiryDate)) {
    if (
      !isLocalDate(inflated.expiryLocalDate) ||
      inflated.expirySourceTimestamp !== inflated.expiryDate
    ) {
      const expiryLocalDate = getMedicationExpiryLocalDate({
        ...inflated,
        expiryLocalDate: undefined,
      });
      if (expiryLocalDate) inflated.expiryLocalDate = expiryLocalDate;
    }
    inflated.expirySourceTimestamp = inflated.expiryDate;
  } else if (inflated.expirySourceTimestamp != null) {
    delete inflated.expiryLocalDate;
    delete inflated.expirySourceTimestamp;
  } else if (!isLocalDate(inflated.expiryLocalDate)) {
    const expiryLocalDate = getMedicationExpiryLocalDate(inflated);
    if (expiryLocalDate) inflated.expiryLocalDate = expiryLocalDate;
    else delete inflated.expiryLocalDate;
  }

  const sourceChanged =
    inflated.doseSourceText != null && inflated.doseSourceText !== inflated.amountPerDose;
  const hasConfirmedDose =
    !sourceChanged &&
    Number.isFinite(inflated.doseQuantity) &&
    (inflated.doseQuantity as number) > 0 &&
    !!inflated.doseUnit?.trim();
  if (hasConfirmedDose) {
    inflated.doseQuantity = Number(inflated.doseQuantity);
    inflated.doseUnit = inflated.doseUnit!.trim();
    inflated.doseReviewRequired = false;
    delete inflated.doseMigrationSuggestion;
  } else {
    delete inflated.doseQuantity;
    delete inflated.doseUnit;
    delete inflated.doseSourceText;
    const suggestion = suggestStructuredDose(inflated.amountPerDose, inflated.inventory?.unit);
    if (suggestion) inflated.doseMigrationSuggestion = suggestion;
    else delete inflated.doseMigrationSuggestion;
    inflated.doseReviewRequired = !!inflated.amountPerDose.trim();
  }
  return inflated;
}
