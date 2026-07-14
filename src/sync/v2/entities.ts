import { z } from 'zod';
import type { IntakeLog, Medication, MedicationScheduleRevision } from '../../db/schema';
import { isLocalDate } from '../../domain/medicationSchedule';
import type { SyncEntityType } from './protocol';

const MAX_TEXT_LENGTH = 10_000;
const MAX_LIST_ITEMS = 1_000;
const ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

const text = z.string().max(MAX_TEXT_LENGTH);
const id = z.string().regex(ENTITY_ID_PATTERN);
const finite = z.number().finite();
const nonNegative = finite.nonnegative();
const positive = finite.positive();
const slot = z.enum(['morning', 'noon', 'evening', 'bedtime']);
const mealRel = z.enum(['before', 'with', 'after']);
const localDate = z.string().refine(isLocalDate, 'Expected a real local calendar date (YYYY-MM-DD).');
const timeLocal = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

const identity = z.object({
  gtins: z.array(text).max(MAX_LIST_ITEMS),
  rawCodes: z.array(text).max(MAX_LIST_ITEMS),
  ocrNames: z.array(text).max(MAX_LIST_ITEMS),
  photoHashes: z.array(text).max(MAX_LIST_ITEMS),
}).strict();

const inventory = z.object({
  remaining: nonNegative,
  unit: text,
  packageQuantity: nonNegative.optional(),
  lowThreshold: nonNegative.optional(),
  sourceNote: text.optional(),
  lastReminderAt: nonNegative.optional(),
  dailyConsumption: nonNegative.optional(),
}).strict();

const structuredDose = z.object({
  quantity: positive,
  unit: text.min(1),
}).strict();

const medication = z.object({
  id,
  name: text,
  dosageText: text,
  amountPerDose: text,
  doseQuantity: positive.optional(),
  doseUnit: text.min(1).optional(),
  doseSourceText: text.optional(),
  doseMigrationSuggestion: structuredDose.optional(),
  doseReviewRequired: z.boolean().optional(),
  slots: z.array(slot).max(4),
  mealRels: z.array(mealRel).max(3),
  mealRelsBySlot: z.object({
    morning: z.array(mealRel).max(3).optional(),
    noon: z.array(mealRel).max(3).optional(),
    evening: z.array(mealRel).max(3).optional(),
    bedtime: z.array(mealRel).max(3).optional(),
  }).strict(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7),
  inventory: inventory.optional(),
  notes: text.optional(),
  expiryLocalDate: localDate.optional(),
  identity,
  updatedAt: nonNegative,
  createdAt: nonNegative.optional(),
}).strict().superRefine((value, context) => {
  const hasQuantity = value.doseQuantity !== undefined;
  const hasUnit = value.doseUnit !== undefined;
  if (hasQuantity !== hasUnit) {
    context.addIssue({ code: 'custom', path: ['doseQuantity'], message: 'Structured dose quantity and unit must be provided together.' });
  }
});

const cycle = z.object({
  activeDays: z.number().int().positive(),
  restDays: z.number().int().nonnegative(),
}).strict();

const schedule = z.object({
  id,
  medId: id,
  sourceRuleId: id,
  effectiveDate: localDate,
  createdAt: nonNegative,
  enabled: z.boolean(),
  slot,
  timeLocal,
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7),
  cycle: cycle.optional(),
  cycleStartDate: localDate.optional(),
  mealRels: z.array(mealRel).max(3),
  doseQuantity: positive.optional(),
  doseUnit: text.min(1).optional(),
  reviewFlags: z.array(z.enum(['cycle-start-missing', 'dose-unstructured'])).max(2),
}).strict().superRefine((value, context) => {
  const hasQuantity = value.doseQuantity !== undefined;
  const hasUnit = value.doseUnit !== undefined;
  if (hasQuantity !== hasUnit) {
    context.addIssue({ code: 'custom', path: ['doseQuantity'], message: 'Structured dose quantity and unit must be provided together.' });
  }
  if (!value.cycle && value.cycleStartDate) {
    context.addIssue({ code: 'custom', path: ['cycleStartDate'], message: 'A cycle start date requires an active/rest cycle.' });
  }
});

const intake = z.object({
  id,
  occurrenceId: id.optional(),
  scheduleRevisionId: id.optional(),
  sourceRuleId: id.optional(),
  medId: id,
  slot,
  dueAt: nonNegative,
  status: z.enum(['taken', 'skipped']),
  ackAt: nonNegative.optional(),
  inventoryDelta: positive.optional(),
  updatedAt: nonNegative,
}).strict();

export type SyncMedicationPayload = Omit<
  Medication,
  'deleted' | 'expiryDate' | 'expirySourceTimestamp' | 'mealRel'
>;
export type SyncSchedulePayload = MedicationScheduleRevision;
export type SyncIntakePayload = Omit<IntakeLog, 'status'> & { status: 'taken' | 'skipped' };

export interface SyncEntityPayloadMap {
  medication: SyncMedicationPayload;
  schedule: SyncSchedulePayload;
  intake: SyncIntakePayload;
}

export type SyncEntityPayload = SyncEntityPayloadMap[SyncEntityType];

export function parseSyncEntityPayload<T extends SyncEntityType>(
  entityType: T,
  value: unknown,
): SyncEntityPayloadMap[T] {
  const schema = entityType === 'medication'
    ? medication
    : entityType === 'schedule'
      ? schedule
      : entityType === 'intake'
        ? intake
        : null;
  if (!schema) throw new Error('Only medication, schedule, and intake entities may be synchronized.');
  return schema.parse(value) as SyncEntityPayloadMap[T];
}

export function isSyncEntityId(value: unknown): value is string {
  return typeof value === 'string' && ENTITY_ID_PATTERN.test(value);
}
