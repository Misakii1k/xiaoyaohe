export interface MedicationValidationInput {
  name: string;
  dosageText: string;
  amountPerDose: string;
  doseQuantity: number | undefined;
  doseUnit: string;
  cycleEnabled: boolean;
  cycle: { activeDays: number; restDays: number } | undefined;
  cycleStartDate?: string;
}

export interface MedicationValidationResult {
  valid: boolean;
  errorMessage?: string;
  targetStep?: 1 | 2 | 3;
  targetField?: 'name' | 'dose' | 'cycle' | 'cycleStartDate';
}

/** 统一校验药品编辑表单各分步字段的合法性 */
export function validateMedicationForm(input: MedicationValidationInput): MedicationValidationResult {
  const name = input.name.trim();
  if (!name) {
    return {
      valid: false,
      errorMessage: '请填写药名',
      targetStep: 1,
      targetField: 'name',
    };
  }

  const hasQuantity = input.doseQuantity != null;
  const hasUnit = Boolean(input.doseUnit.trim());
  if (hasQuantity !== hasUnit) {
    return {
      valid: false,
      errorMessage: '请同时填写每次剂量数值和单位',
      targetStep: 2,
      targetField: 'dose',
    };
  }

  if (input.cycleEnabled && !input.cycle) {
    return {
      valid: false,
      errorMessage: '请填写有效的周期天数',
      targetStep: 3,
      targetField: 'cycle',
    };
  }

  if (input.cycleEnabled && input.cycleStartDate !== undefined && !input.cycleStartDate) {
    return {
      valid: false,
      errorMessage: '请选择本周期首个服药日',
      targetStep: 3,
      targetField: 'cycleStartDate',
    };
  }

  return { valid: true };
}
