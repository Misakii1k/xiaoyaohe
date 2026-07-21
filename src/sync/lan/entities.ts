import { z } from 'zod';
import {
  emptyIdentity,
  inflateMed,
  type IntakeLog,
  type Medication,
  type MedicationScheduleRevision,
  type ReminderRule,
} from '../../db/schema';
import {
  getMedicationExpiryLocalDate,
  isLocalDate,
} from '../../domain/medicationSchedule';

export const LAN_SYNC_SCHEMA_VERSION = 1 as const;
export const LAN_SYNC_MAX_ENTRIES = 10_000;
export const LAN_SYNC_MAX_JSON_BYTES = 5 * 1024 * 1024;
/** 含 extras（照片 base64 等）的整条消息上限 */
export const LAN_SYNC_MAX_MESSAGE_BYTES = 15 * 1024 * 1024;

const MAX_TEXT_LENGTH = 10_000;
const MAX_LIST_ITEMS = 1_000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const PAYLOAD_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

const text = z.string().max(MAX_TEXT_LENGTH);
const id = z.string().regex(ID_PATTERN);
const sessionId = z.string().regex(SESSION_ID_PATTERN);
const finite = z.number().finite();
const nonNegative = finite.nonnegative();
const positive = finite.positive();
const clock = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const slot = z.enum(['morning', 'noon', 'evening', 'bedtime']);
const mealRel = z.enum(['before', 'with', 'after']);
const localDate = z.string().refine(isLocalDate, 'Expected a real local calendar date (YYYY-MM-DD).');
const timeLocal = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const payloadHash = z.string().regex(PAYLOAD_HASH_PATTERN);

const identity = z.object({
  gtins: z.array(text).max(MAX_LIST_ITEMS),
  rawCodes: z.array(text).max(MAX_LIST_ITEMS),
  ocrNames: z.array(text).max(MAX_LIST_ITEMS),
}).strict();

const structuredDose = z.object({
  quantity: positive,
  unit: text.min(1),
}).strict();

const mealRelsBySlot = z.object({
  morning: z.array(mealRel).max(3).optional(),
  noon: z.array(mealRel).max(3).optional(),
  evening: z.array(mealRel).max(3).optional(),
  bedtime: z.array(mealRel).max(3).optional(),
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
  mealRelsBySlot,
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7),
  notes: text.optional(),
  expiryLocalDate: localDate.optional(),
  identity,
  createdAt: nonNegative.optional(),
}).strict().superRefine((value, context) => {
  if ((value.doseQuantity === undefined) !== (value.doseUnit === undefined)) {
    context.addIssue({
      code: 'custom',
      path: ['doseQuantity'],
      message: 'Structured dose quantity and unit must be provided together.',
    });
  }
});

const cycle = z.object({
  activeDays: z.number().int().positive(),
  restDays: z.number().int().nonnegative(),
}).strict();

const escalate = z.object({
  repeatEveryMin: z.number().int().nonnegative(),
  maxRepeats: z.number().int().nonnegative(),
  notifyCaregiverAfterMin: z.number().int().nonnegative(),
}).strict();

const reminderRule = z.object({
  id,
  medId: id,
  slot,
  timeLocal,
  enabled: z.boolean(),
  cycle: cycle.optional(),
  cycleStartDate: localDate.optional(),
  cycleStartNeedsReview: z.boolean().optional(),
  escalate,
  updatedAt: nonNegative,
}).strict().superRefine((value, context) => {
  if (!value.cycle && value.cycleStartDate) {
    context.addIssue({
      code: 'custom',
      path: ['cycleStartDate'],
      message: 'A cycle start date requires an active/rest cycle.',
    });
  }
});

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
  if ((value.doseQuantity === undefined) !== (value.doseUnit === undefined)) {
    context.addIssue({
      code: 'custom',
      path: ['doseQuantity'],
      message: 'Structured dose quantity and unit must be provided together.',
    });
  }
  if (!value.cycle && value.cycleStartDate) {
    context.addIssue({
      code: 'custom',
      path: ['cycleStartDate'],
      message: 'A cycle start date requires an active/rest cycle.',
    });
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
  updatedAt: nonNegative,
}).strict();

export type LanEntityType = 'medication' | 'reminderRule' | 'schedule' | 'intake';
export type LanMedicationPayload = z.infer<typeof medication>;
export type LanReminderRulePayload = z.infer<typeof reminderRule>;
export type LanSchedulePayload = z.infer<typeof schedule>;
export type LanIntakePayload = z.infer<typeof intake>;

export interface LanEntityPayloadMap {
  medication: LanMedicationPayload;
  reminderRule: LanReminderRulePayload;
  schedule: LanSchedulePayload;
  intake: LanIntakePayload;
}

interface LanEntryVersion {
  entityId: string;
  clock: number;
  deviceId: string;
  payloadHash: string;
}

export type LanMedicationEntry = LanEntryVersion & (
  | { entityType: 'medication'; tombstone: false; payload: LanMedicationPayload }
  | { entityType: 'medication'; tombstone: true }
);
export type LanReminderRuleEntry = LanEntryVersion & (
  | { entityType: 'reminderRule'; tombstone: false; payload: LanReminderRulePayload }
  | { entityType: 'reminderRule'; tombstone: true }
);
export type LanScheduleEntry = LanEntryVersion & {
  entityType: 'schedule';
  tombstone: false;
  payload: LanSchedulePayload;
};
export type LanIntakeEntry = LanEntryVersion & (
  | { entityType: 'intake'; tombstone: false; payload: LanIntakePayload }
  | { entityType: 'intake'; tombstone: true }
);
export type LanSyncEntry =
  | LanMedicationEntry
  | LanReminderRuleEntry
  | LanScheduleEntry
  | LanIntakeEntry;

const entryVersion = {
  entityId: id,
  clock,
  deviceId: id,
  payloadHash,
};

function upsertEntry<T extends LanEntityType>(entityType: T, payload: z.ZodType): z.ZodType {
  return z.object({
    entityType: z.literal(entityType),
    ...entryVersion,
    tombstone: z.literal(false),
    payload,
  }).strict().superRefine((value, context) => {
    const record = value as { entityId: string; payload: { id: string } };
    if (record.entityId !== record.payload.id) {
      context.addIssue({
        code: 'custom',
        path: ['entityId'],
        message: 'Entry entityId must match payload.id.',
      });
    }
  });
}

function tombstoneEntry<T extends Exclude<LanEntityType, 'schedule'>>(entityType: T): z.ZodType {
  return z.object({
    entityType: z.literal(entityType),
    ...entryVersion,
    tombstone: z.literal(true),
  }).strict();
}

const lanEntry = z.union([
  upsertEntry('medication', medication),
  tombstoneEntry('medication'),
  upsertEntry('reminderRule', reminderRule),
  tombstoneEntry('reminderRule'),
  upsertEntry('schedule', schedule),
  upsertEntry('intake', intake),
  tombstoneEntry('intake'),
]);

const lanSyncSnapshot = z.object({
  schemaVersion: z.literal(LAN_SYNC_SCHEMA_VERSION),
  sessionId,
  entries: z.array(lanEntry).max(LAN_SYNC_MAX_ENTRIES),
}).strict().superRefine((value, context) => {
  const keys = new Set<string>();
  for (let index = 0; index < value.entries.length; index += 1) {
    const entry = value.entries[index] as LanSyncEntry;
    const key = `${entry.entityType}\u0000${entry.entityId}`;
    if (keys.has(key)) {
      context.addIssue({
        code: 'custom',
        path: ['entries', index],
        message: 'A snapshot may contain only one version of an entity.',
      });
    }
    keys.add(key);
  }
});

export interface LanSyncSnapshot {
  schemaVersion: typeof LAN_SYNC_SCHEMA_VERSION;
  sessionId: string;
  entries: LanSyncEntry[];
}

export function parseLanSyncSnapshot(value: unknown): LanSyncSnapshot {
  assertJsonSize(value);
  const parsed = lanSyncSnapshot.parse(value) as LanSyncSnapshot;
  assertJsonSize(parsed);
  return parsed;
}

export function parseLanEntityPayload<T extends LanEntityType>(
  entityType: T,
  value: unknown,
): LanEntityPayloadMap[T] {
  const schema = entityType === 'medication'
    ? medication
    : entityType === 'reminderRule'
      ? reminderRule
      : entityType === 'schedule'
        ? schedule
        : intake;
  return schema.parse(value) as LanEntityPayloadMap[T];
}

export function selectLanMedicationPayload(raw: Medication): LanMedicationPayload {
  const value = inflateMed(structuredClone(raw)) as Medication;
  const hasStructuredDose = Number.isFinite(value.doseQuantity) &&
    Number(value.doseQuantity) > 0 &&
    typeof value.doseUnit === 'string' &&
    value.doseUnit.trim().length > 0;
  const expiryLocalDate = isLocalDate(value.expiryLocalDate)
    ? value.expiryLocalDate
    : getMedicationExpiryLocalDate(value);
  const sourceIdentity = value.identity ?? emptyIdentity();
  return parseLanEntityPayload('medication', {
    id: value.id,
    name: value.name,
    dosageText: value.dosageText,
    amountPerDose: value.amountPerDose,
    ...(hasStructuredDose ? {
      doseQuantity: Number(value.doseQuantity),
      doseUnit: value.doseUnit!.trim(),
      ...(value.doseSourceText !== undefined ? { doseSourceText: value.doseSourceText } : {}),
    } : {}),
    ...(!hasStructuredDose && value.doseMigrationSuggestion
      ? { doseMigrationSuggestion: { ...value.doseMigrationSuggestion } }
      : {}),
    ...(!hasStructuredDose && value.doseReviewRequired !== undefined
      ? { doseReviewRequired: value.doseReviewRequired }
      : {}),
    slots: [...new Set(value.slots)],
    mealRels: [...new Set(value.mealRels)],
    mealRelsBySlot: cloneMealRelsBySlot(value.mealRelsBySlot),
    daysOfWeek: [...new Set(value.daysOfWeek)].sort((left, right) => left - right),
    ...(value.notes !== undefined ? { notes: value.notes } : {}),
    ...(expiryLocalDate ? { expiryLocalDate } : {}),
    identity: {
      gtins: sortedUnique(sourceIdentity.gtins),
      rawCodes: sortedUnique(sourceIdentity.rawCodes),
      ocrNames: sortedUnique(sourceIdentity.ocrNames),
    },
    ...(value.createdAt !== undefined ? { createdAt: value.createdAt } : {}),
  });
}

export function selectLanReminderRulePayload(raw: ReminderRule): LanReminderRulePayload {
  return parseLanEntityPayload('reminderRule', {
    id: raw.id,
    medId: raw.medId,
    slot: raw.slot,
    timeLocal: raw.timeLocal,
    enabled: raw.enabled,
    ...(raw.cycle ? { cycle: { ...raw.cycle } } : {}),
    ...(raw.cycleStartDate ? { cycleStartDate: raw.cycleStartDate } : {}),
    ...(raw.cycleStartNeedsReview !== undefined
      ? { cycleStartNeedsReview: raw.cycleStartNeedsReview }
      : {}),
    escalate: { ...raw.escalate },
    updatedAt: raw.updatedAt,
  });
}

export function selectLanSchedulePayload(raw: MedicationScheduleRevision): LanSchedulePayload {
  return parseLanEntityPayload('schedule', {
    id: raw.id,
    medId: raw.medId,
    sourceRuleId: raw.sourceRuleId,
    effectiveDate: raw.effectiveDate,
    createdAt: raw.createdAt,
    enabled: raw.enabled,
    slot: raw.slot,
    timeLocal: raw.timeLocal,
    daysOfWeek: [...raw.daysOfWeek],
    ...(raw.cycle ? { cycle: { ...raw.cycle } } : {}),
    ...(raw.cycleStartDate ? { cycleStartDate: raw.cycleStartDate } : {}),
    mealRels: [...raw.mealRels],
    ...(raw.doseQuantity !== undefined ? { doseQuantity: raw.doseQuantity } : {}),
    ...(raw.doseUnit !== undefined ? { doseUnit: raw.doseUnit } : {}),
    reviewFlags: [...raw.reviewFlags],
  });
}

export function selectLanIntakePayload(raw: IntakeLog): LanIntakePayload {
  return parseLanEntityPayload('intake', {
    id: raw.id,
    ...(raw.occurrenceId ? { occurrenceId: raw.occurrenceId } : {}),
    ...(raw.scheduleRevisionId ? { scheduleRevisionId: raw.scheduleRevisionId } : {}),
    ...(raw.sourceRuleId ? { sourceRuleId: raw.sourceRuleId } : {}),
    medId: raw.medId,
    slot: raw.slot,
    dueAt: raw.dueAt,
    status: raw.status,
    ...(raw.ackAt !== undefined ? { ackAt: raw.ackAt } : {}),
    updatedAt: raw.updatedAt,
  });
}

export function canonicalLanJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export async function hashLanPayload(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalLanJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

export async function verifyLanSyncSnapshotHashes(snapshot: LanSyncSnapshot): Promise<void> {
  await Promise.all(snapshot.entries.map(async (entry) => {
    const expected = await hashLanPayload(entry.tombstone ? null : entry.payload);
    if (entry.payloadHash !== expected) {
      throw new Error(`LAN sync payload hash mismatch for ${entry.entityType}:${entry.entityId}.`);
    }
  }));
}

function assertJsonSize(value: unknown): void {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new Error('LAN sync snapshot must be valid JSON data.');
  }
  if (json === undefined) throw new Error('LAN sync snapshot must be valid JSON data.');
  if (new TextEncoder().encode(json).byteLength > LAN_SYNC_MAX_JSON_BYTES) {
    throw new Error('LAN sync snapshot exceeds the 5 MiB limit.');
  }
}

function cloneMealRelsBySlot(value: Medication['mealRelsBySlot']): Medication['mealRelsBySlot'] {
  return {
    ...(value.morning ? { morning: [...new Set(value.morning)] } : {}),
    ...(value.noon ? { noon: [...new Set(value.noon)] } : {}),
    ...(value.evening ? { evening: [...new Set(value.evening)] } : {}),
    ...(value.bedtime ? { bedtime: [...new Set(value.bedtime)] } : {}),
  };
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) sorted[key] = sortJson(value[key]);
  }
  return sorted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
