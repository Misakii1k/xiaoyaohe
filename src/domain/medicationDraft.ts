import {
  emptyIdentity,
  type LocalDate,
  type MealRelsBySlot,
  type Medication,
  type MedicationInventory,
  type Slot,
  type StructuredDose,
} from '../db/schema';

export type MedicationDraftSource = 'manual' | 'medicine-box' | 'prescription';

export interface DraftReminderRule {
  id: string;
  slot: Slot;
  timeLocal: string;
  enabled: boolean;
  cycle?: { activeDays: number; restDays: number };
  cycleStartDate?: LocalDate;
}

export interface MedicationDraftError {
  field: string;
  code: string;
  message: string;
}

export interface MedicationCreateDraft {
  /** Stable medication id. Retrying a batch reuses it and cannot create a duplicate. */
  id: string;
  medication: Medication;
  rules: DraftReminderRule[];
  sourceKind: MedicationDraftSource;
  sourceImage?: Blob;
  confidence?: number;
  selected: boolean;
  expanded: boolean;
  duplicateCandidateIds?: string[];
  duplicateResolution?: 'skip' | 'create';
  errors: MedicationDraftError[];
}

export interface CreateMedicationDraftOptions {
  id?: string;
  sourceKind?: MedicationDraftSource;
  sourceImage?: Blob;
  confidence?: number;
  medication?: Partial<Medication>;
  rules?: DraftReminderRule[];
}

export function createMedicationDraft(options: CreateMedicationDraftOptions = {}): MedicationCreateDraft {
  const id = options.id ?? draftId();
  const medication = options.medication ?? {};
  const slots = normalizeSlots(medication.slots ?? []);
  const mealRelsBySlot = (medication.mealRelsBySlot ?? {}) as MealRelsBySlot;
  return {
    id,
    medication: {
      id,
      name: medication.name?.trim() ?? '',
      dosageText: medication.dosageText?.trim() ?? '',
      amountPerDose: medication.amountPerDose?.trim() ?? '',
      doseQuantity: medication.doseQuantity,
      doseUnit: medication.doseUnit?.trim(),
      doseSourceText: medication.doseSourceText,
      doseReviewRequired: medication.doseReviewRequired,
      slots,
      mealRels: medication.mealRels ? [...medication.mealRels] : [],
      mealRelsBySlot,
      daysOfWeek: medication.daysOfWeek ? [...medication.daysOfWeek] : [],
      inventory: medication.inventory ? { ...medication.inventory } : undefined,
      notes: medication.notes,
      expiryLocalDate: medication.expiryLocalDate,
      identity: medication.identity ? cloneIdentity(medication.identity) : emptyIdentity(),
      createdAt: medication.createdAt,
      updatedAt: medication.updatedAt ?? 0,
    },
    rules: options.rules ? options.rules.map(cloneRule) : [],
    sourceKind: options.sourceKind ?? 'manual',
    sourceImage: options.sourceImage,
    confidence: options.confidence,
    selected: true,
    expanded: true,
    errors: [],
  };
}

export function parseExplicitDose(value: string): StructuredDose | undefined {
  const text = value.trim().replace(/\s+/g, '');
  if (!text) return undefined;
  const match = /^(半|\d+(?:\.\d+)?|\d+\/\d+)(片|粒|袋|支|丸|滴|喷|mL|ml|毫升)$/u.exec(text);
  if (!match) return undefined;
  const quantityToken = match[1];
  let quantity: number;
  if (quantityToken === '半') quantity = 0.5;
  else if (quantityToken.includes('/')) {
    const [numerator, denominator] = quantityToken.split('/').map(Number);
    if (!denominator) return undefined;
    quantity = numerator / denominator;
  } else quantity = Number(quantityToken);
  if (!Number.isFinite(quantity) || quantity <= 0) return undefined;
  return { quantity: round(quantity), unit: normalizeDoseUnit(match[2]) };
}

export function applyExplicitDose(draft: MedicationCreateDraft): void {
  const parsed = parseExplicitDose(draft.medication.amountPerDose);
  if (parsed) {
    draft.medication.doseQuantity = parsed.quantity;
    draft.medication.doseUnit = parsed.unit;
    draft.medication.doseSourceText = draft.medication.amountPerDose;
    draft.medication.doseReviewRequired = false;
  } else {
    delete draft.medication.doseQuantity;
    delete draft.medication.doseUnit;
    delete draft.medication.doseSourceText;
    draft.medication.doseReviewRequired = Boolean(draft.medication.amountPerDose.trim());
  }
}

export function validateMedicationDraft(draft: MedicationCreateDraft): MedicationDraftError[] {
  const errors: MedicationDraftError[] = [];
  const medication = draft.medication;
  if (!medication.name.trim()) errors.push(error('name', 'name-required', '请填写药品名称'));
  else if (medication.name.trim().length > 120) errors.push(error('name', 'name-too-long', '药品名称不能超过 120 个字符'));

  const hasDoseQuantity = medication.doseQuantity !== undefined;
  const hasDoseUnit = Boolean(medication.doseUnit?.trim());
  if (hasDoseQuantity !== hasDoseUnit) {
    errors.push(error('dose', 'dose-incomplete', '结构化剂量的数量和单位必须同时填写'));
  }
  if (hasDoseQuantity && (!Number.isFinite(medication.doseQuantity) || medication.doseQuantity! <= 0)) {
    errors.push(error('doseQuantity', 'dose-invalid', '每次剂量必须大于 0'));
  }

  const slots = normalizeSlots(medication.slots);
  const rulesBySlot = new Map(draft.rules.map((rule) => [rule.slot, rule]));
  for (const slot of slots) {
    const rule = rulesBySlot.get(slot);
    if (!rule) {
      errors.push(error(`rules.${slot}`, 'time-required', `${slotLabel(slot)}需要设置提醒时间`));
      continue;
    }
    if (!isTime(rule.timeLocal)) errors.push(error(`rules.${slot}`, 'time-invalid', `${slotLabel(slot)}提醒时间无效`));
    if (rule.cycle) {
      if (!Number.isInteger(rule.cycle.activeDays) || rule.cycle.activeDays < 1 || !Number.isInteger(rule.cycle.restDays) || rule.cycle.restDays < 0) {
        errors.push(error(`rules.${slot}.cycle`, 'cycle-invalid', '周期服药天数无效'));
      }
      if (!isLocalDate(rule.cycleStartDate)) errors.push(error(`rules.${slot}.cycleStartDate`, 'cycle-start-invalid', '请设置周期首日'));
    }
  }

  if (medication.expiryLocalDate && !isLocalDate(medication.expiryLocalDate)) {
    errors.push(error('expiryLocalDate', 'expiry-invalid', '有效期日期无效'));
  }
  validateInventory(medication.inventory, errors);
  if ((draft.duplicateCandidateIds?.length ?? 0) > 0 && !draft.duplicateResolution) {
    errors.push(error('duplicate', 'duplicate-unresolved', '请处理疑似重复药品'));
  }
  draft.errors = errors;
  return errors;
}

function validateInventory(inventory: MedicationInventory | undefined, errors: MedicationDraftError[]): void {
  if (!inventory) return;
  if (!Number.isFinite(inventory.remaining) || inventory.remaining < 0) {
    errors.push(error('inventory.remaining', 'inventory-invalid', '库存不能小于 0'));
  }
  if (!inventory.unit?.trim()) errors.push(error('inventory.unit', 'inventory-unit-required', '库存需要单位'));
}

function error(field: string, code: string, message: string): MedicationDraftError {
  return { field, code, message };
}

function isTime(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/u.exec(value);
  return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60);
}

function isLocalDate(value: unknown): value is LocalDate {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00`));
}

function normalizeDoseUnit(value: string): string {
  const normalized = value.toLocaleLowerCase('en-US');
  return normalized === 'ml' || normalized === '毫升' ? 'mL' : value;
}

function normalizeSlots(slots: readonly Slot[]): Slot[] {
  const known: Slot[] = ['morning', 'noon', 'evening', 'bedtime'];
  return known.filter((slot) => slots.includes(slot));
}

function cloneIdentity(identity: Medication['identity']): Medication['identity'] {
  return {
    gtins: [...identity.gtins],
    rawCodes: [...identity.rawCodes],
    ocrNames: [...identity.ocrNames],
    photoHashes: [...identity.photoHashes],
  };
}

function cloneRule(rule: DraftReminderRule): DraftReminderRule {
  return { ...rule, cycle: rule.cycle ? { ...rule.cycle } : undefined };
}

function slotLabel(slot: Slot): string {
  return ({ morning: '早上', noon: '中午', evening: '晚上', bedtime: '睡前' } as const)[slot];
}

function draftId(): string {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `med-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}
