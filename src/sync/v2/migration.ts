import { z } from 'zod';
import type { Medication, ReminderRule } from '../../db/schema';
import { emptyIdentity, inflateMed } from '../../db/schema';
import {
  createScheduleRevision,
  isLocalDate,
  toLocalDate,
} from '../../domain/medicationSchedule';
import { base64UrlEncode } from './crypto';
import {
  SyncV2HttpError,
  SyncV2NetworkError,
  SyncV2ProtocolError,
  normalizeEndpoint,
  readBoundedResponseText,
  type SyncFetch,
} from './api';
import {
  parseSyncEntityPayload,
  type SyncEntityPayload,
  type SyncIntakePayload,
  type SyncMedicationPayload,
  type SyncSchedulePayload,
} from './entities';
import { SYNC_V2_LIMITS, type SyncEntityType } from './protocol';
import { SyncV2Client, type RemoteSyncV2Change, type SyncV2RunResult } from './client';

const LEGACY_RESPONSE_BYTES = 5 * 1024 * 1024;
const LEGACY_HOUSEHOLD_PATTERN = /^[a-z0-9]{6,64}$/;
const MAX_LEGACY_RECORDS = 10_000;

const finite = z.number().finite();
const nonNegative = finite.nonnegative();
const localDate = z.string().refine(isLocalDate);
const slot = z.enum(['morning', 'noon', 'evening', 'bedtime']);
const mealRel = z.enum(['before', 'with', 'after']);
const shortText = z.string().max(10_000);
const id = z.string().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const legacyMedication = z.object({
  id,
  name: shortText,
  dosageText: shortText,
  amountPerDose: shortText,
  doseQuantity: finite.positive().optional(),
  doseUnit: shortText.min(1).optional(),
  doseSourceText: shortText.optional(),
  doseMigrationSuggestion: z.object({ quantity: finite.positive(), unit: shortText.min(1) }).passthrough().optional(),
  doseReviewRequired: z.boolean().optional(),
  slots: z.array(z.string()).max(10),
  mealRel: z.enum(['before', 'after', 'with', 'none']).optional(),
  mealRels: z.array(mealRel).max(3).optional(),
  mealRelsBySlot: z.record(z.string(), z.array(mealRel).max(3)).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7),
  inventory: z.object({
    remaining: nonNegative,
    unit: shortText,
    packageQuantity: nonNegative.optional(),
    lowThreshold: nonNegative.optional(),
    sourceNote: shortText.optional(),
    lastReminderAt: nonNegative.optional(),
    dailyConsumption: nonNegative.optional(),
  }).passthrough().optional(),
  notes: shortText.optional(),
  expiryDate: nonNegative.optional(),
  expiryLocalDate: localDate.optional(),
  expirySourceTimestamp: nonNegative.optional(),
  identity: z.object({
    gtins: z.array(shortText).max(1_000),
    rawCodes: z.array(shortText).max(1_000),
    ocrNames: z.array(shortText).max(1_000),
    photoHashes: z.array(shortText).max(1_000),
  }).passthrough().optional(),
  updatedAt: nonNegative,
  createdAt: nonNegative.optional(),
  deleted: z.boolean().optional(),
}).passthrough();

const legacyRule = z.object({
  id,
  medId: id,
  slot,
  timeLocal: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  enabled: z.boolean(),
  cycle: z.object({
    activeDays: z.number().int().positive(),
    restDays: z.number().int().nonnegative(),
  }).passthrough().optional(),
  cycleStartDate: localDate.optional(),
  cycleStartNeedsReview: z.boolean().optional(),
  escalate: z.object({
    repeatEveryMin: z.number().int().nonnegative(),
    maxRepeats: z.number().int().nonnegative(),
    notifyCaregiverAfterMin: z.number().int().nonnegative(),
  }).passthrough(),
  updatedAt: nonNegative,
  deleted: z.boolean().optional(),
}).passthrough();

const legacyLog = z.object({
  id,
  occurrenceId: id.optional(),
  scheduleRevisionId: id.optional(),
  sourceRuleId: id.optional(),
  medId: id,
  slot,
  dueAt: nonNegative,
  status: z.enum(['taken', 'skipped', 'pending']),
  ackAt: nonNegative.optional(),
  inventoryDelta: finite.positive().optional(),
  updatedAt: nonNegative,
  deleted: z.boolean().optional(),
}).passthrough();

const legacySnapshot = z.object({
  meds: z.array(legacyMedication).max(MAX_LEGACY_RECORDS),
  rules: z.array(legacyRule).max(MAX_LEGACY_RECORDS),
  logs: z.array(legacyLog).max(MAX_LEGACY_RECORDS).optional(),
  updatedAt: nonNegative,
}).strict();

export type LegacySnapshot = z.infer<typeof legacySnapshot>;

export interface LegacyV1ReadOptions {
  endpoint: string;
  household: string;
  secret: string;
  signal?: AbortSignal;
}

export interface LegacyV1ReaderOptions {
  fetch?: SyncFetch;
  timeoutMs?: number;
}

export interface LegacyMigrationReport {
  canDisableV1: boolean;
  v1DeletionPerformed: false;
  sourceCounts: {
    medications: number;
    schedules: number;
    intakes: number;
    omittedPendingIntakes: number;
  };
  expectedEntityCount: number;
  verifiedEntityCount: number;
  expectedDigest: string;
  verifiedDigest: string;
  pendingMutationIds: string[];
  conflictMutationIds: string[];
  rejectedMutationIds: string[];
  offline: boolean;
}

export interface MigrationEntity {
  entityType: SyncEntityType;
  entityId: string;
  operation: 'upsert' | 'delete';
  payload?: SyncEntityPayload;
}

export class LegacyV1Reader {
  private readonly fetchImpl: SyncFetch;
  private readonly timeoutMs: number;

  constructor(options: LegacyV1ReaderOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 120_000) {
      throw new Error('Legacy sync timeout must be between 1 ms and 120 seconds.');
    }
  }

  async read(options: LegacyV1ReadOptions): Promise<LegacySnapshot> {
    const endpoint = normalizeEndpoint(options.endpoint);
    if (!LEGACY_HOUSEHOLD_PATTERN.test(options.household)) throw new Error('Invalid legacy household ID.');
    if (!options.secret || options.secret.length > 512) throw new Error('Legacy migration requires an authentication secret.');

    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = (): void => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abortFromCaller();
    else options.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException('Legacy sync request timed out.', 'TimeoutError'));
    }, this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${endpoint}/api/sync`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'cache-control': 'no-store',
          pragma: 'no-cache',
          'x-household': options.household,
          'x-secret': options.secret,
        },
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    } catch (error) {
      throw new SyncV2NetworkError(
        timedOut ? 'Legacy sync request timed out.' : 'Legacy sync endpoint is unreachable.',
        timedOut,
        { cause: error },
      );
    } finally {
      globalThis.clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abortFromCaller);
    }

    const rawText = await readBoundedResponseText(response, LEGACY_RESPONSE_BYTES);
    let raw: unknown;
    try {
      raw = JSON.parse(rawText) as unknown;
    } catch {
      throw new SyncV2ProtocolError('Legacy sync endpoint returned invalid JSON.');
    }
    if (!response.ok) {
      const code = isRecord(raw) && typeof raw.error === 'string' ? raw.error : 'http_error';
      throw new SyncV2HttpError(response.status, code, raw);
    }
    const parsed = legacySnapshot.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new SyncV2ProtocolError(`Legacy snapshot validation failed at ${issue?.path.join('.') || 'root'}: ${issue?.message}`);
    }
    return parsed.data;
  }
}

export class LegacyV1MigrationHelper {
  constructor(
    private readonly client: SyncV2Client,
    private readonly reader = new LegacyV1Reader(),
    private readonly consumeRunResult?: (result: SyncV2RunResult) => void | Promise<void>,
  ) {}

  async migrate(options: LegacyV1ReadOptions): Promise<LegacyMigrationReport> {
    const snapshot = await this.reader.read(options);
    const transformed = transformLegacySnapshot(snapshot);
    if (transformed.entities.length > SYNC_V2_LIMITS.entitiesPerHousehold) {
      throw new Error(`Legacy snapshot exceeds the v2 household limit of ${SYNC_V2_LIMITS.entitiesPerHousehold} entities.`);
    }

    const expectedDigest = await digestEntities(transformed.entities);
    const queuedByEntity = new Map(
      (await this.client.listQueuedMutations()).map((item) => [entityKey(item.mutation.entityType, item.mutation.entityId), item]),
    );
    const migrationMutationIds = new Set<string>();
    for (const entity of transformed.entities) {
      const existing = queuedByEntity.get(entityKey(entity.entityType, entity.entityId));
      if (existing) {
        migrationMutationIds.add(existing.mutation.mutationId);
        continue;
      }
      const queued = entity.operation === 'delete'
        ? await this.client.queueDelete(entity.entityType, entity.entityId, 0)
        : await this.queueUpsert(entity);
      migrationMutationIds.add(queued.mutation.mutationId);
    }

    const observed = new Map<string, MigrationEntity>();
    const conflicts = new Set<string>();
    const rejected = new Set<string>();
    let offline = false;
    const maxRounds = Math.ceil(Math.max(1, transformed.entities.length) / SYNC_V2_LIMITS.mutationsPerRequest) + 2;
    for (let round = 0; round < maxRounds; round += 1) {
      const run = await this.client.sync({ signal: options.signal });
      await this.consumeRunResult?.(run);
      for (const change of [...run.appliedChanges, ...run.deferredChanges, ...run.confirmedChanges]) {
        observed.set(entityKey(change.record.entityType, change.record.entityId), changeToMigrationEntity(change));
      }
      for (const conflict of run.conflicts) if (migrationMutationIds.has(conflict.mutationId)) conflicts.add(conflict.mutationId);
      for (const rejection of run.rejected) if (migrationMutationIds.has(rejection.mutationId)) rejected.add(rejection.mutationId);
      if (run.status === 'offline') {
        offline = true;
        break;
      }
      const remaining = (await this.client.listQueuedMutations()).filter((item) => migrationMutationIds.has(item.mutation.mutationId));
      if (remaining.length === 0 || remaining.some((item) => item.status !== 'pending')) break;
    }

    const expectedByKey = new Map(transformed.entities.map((entity) => [entityKey(entity.entityType, entity.entityId), entity]));
    const verified = transformed.entities.filter((entity) => {
      const actual = observed.get(entityKey(entity.entityType, entity.entityId));
      return actual !== undefined && canonicalJson(actual) === canonicalJson(entity);
    });
    const verifiedDigest = await digestEntities(verified);
    const unresolved = (await this.client.listQueuedMutations())
      .filter((item) => migrationMutationIds.has(item.mutation.mutationId));
    for (const item of unresolved) {
      if (item.status === 'conflict') conflicts.add(item.mutation.mutationId);
      if (item.status === 'rejected') rejected.add(item.mutation.mutationId);
    }
    const pending = unresolved.map((item) => item.mutation.mutationId);
    const observedOnlyExpected = [...observed.entries()].filter(([key]) => expectedByKey.has(key)).length;
    const fullyVerified =
      verified.length === transformed.entities.length &&
      observedOnlyExpected === transformed.entities.length &&
      verifiedDigest === expectedDigest;

    return {
      canDisableV1: fullyVerified && pending.length === 0 && conflicts.size === 0 && rejected.size === 0 && !offline,
      v1DeletionPerformed: false,
      sourceCounts: transformed.counts,
      expectedEntityCount: transformed.entities.length,
      verifiedEntityCount: verified.length,
      expectedDigest,
      verifiedDigest,
      pendingMutationIds: pending,
      conflictMutationIds: [...conflicts],
      rejectedMutationIds: [...rejected],
      offline,
    };
  }

  private queueUpsert(entity: MigrationEntity) {
    if (entity.operation !== 'upsert' || !entity.payload) throw new Error('Migration upsert is missing its payload.');
    if (entity.entityType === 'medication') {
      return this.client.queueUpsert('medication', entity.payload as SyncMedicationPayload, 0);
    }
    if (entity.entityType === 'schedule') {
      return this.client.queueUpsert('schedule', entity.payload as SyncSchedulePayload, 0);
    }
    return this.client.queueUpsert('intake', entity.payload as SyncIntakePayload, 0);
  }
}

export function transformLegacySnapshot(snapshot: LegacySnapshot): {
  entities: MigrationEntity[];
  counts: LegacyMigrationReport['sourceCounts'];
} {
  const medPayloadById = new Map<string, SyncMedicationPayload>();
  const medDeletedById = new Map<string, boolean>();
  const entities: MigrationEntity[] = [];
  for (const legacy of snapshot.meds) {
    const payload = convertMedication(legacy);
    medPayloadById.set(payload.id, payload);
    medDeletedById.set(payload.id, legacy.deleted === true);
    entities.push(legacy.deleted
      ? { entityType: 'medication', entityId: payload.id, operation: 'delete' }
      : { entityType: 'medication', entityId: payload.id, operation: 'upsert', payload });
  }

  let scheduleCount = 0;
  for (const legacy of snapshot.rules) {
    const medPayload = medPayloadById.get(legacy.medId);
    if (!medPayload) throw new SyncV2ProtocolError(`Legacy rule ${legacy.id} references a missing medication.`);
    const med = { ...medPayload, deleted: medDeletedById.get(legacy.medId) } as Medication;
    const rule = legacy as ReminderRule;
    const revision = parseSyncEntityPayload(
      'schedule',
      createScheduleRevision(med, rule, { enabled: rule.enabled && !rule.deleted && !med.deleted }),
    );
    entities.push({ entityType: 'schedule', entityId: revision.id, operation: 'upsert', payload: revision });
    scheduleCount += 1;
  }

  let intakeCount = 0;
  let omittedPendingIntakes = 0;
  for (const legacy of snapshot.logs ?? []) {
    if (legacy.status === 'pending') {
      omittedPendingIntakes += 1;
      continue;
    }
    if (legacy.deleted) {
      entities.push({ entityType: 'intake', entityId: legacy.id, operation: 'delete' });
    } else {
      const payload = parseSyncEntityPayload('intake', selectIntake(legacy));
      entities.push({ entityType: 'intake', entityId: payload.id, operation: 'upsert', payload });
    }
    intakeCount += 1;
  }

  const duplicate = findDuplicateEntityKey(entities);
  if (duplicate) throw new SyncV2ProtocolError(`Legacy snapshot produces duplicate v2 entity ${duplicate}.`);
  return {
    entities,
    counts: {
      medications: snapshot.meds.length,
      schedules: scheduleCount,
      intakes: intakeCount,
      omittedPendingIntakes,
    },
  };
}

function convertMedication(legacy: z.infer<typeof legacyMedication>): SyncMedicationPayload {
  const inflated = inflateMed({ ...legacy } as unknown as Medication & {
    slots: unknown[];
    mealRel?: unknown;
    mealRels?: unknown;
    mealRelsBySlot?: unknown;
  });
  const hasStructuredDose =
    Number.isFinite(inflated.doseQuantity) &&
    Number(inflated.doseQuantity) > 0 &&
    typeof inflated.doseUnit === 'string' &&
    inflated.doseUnit.trim().length > 0;
  const expiryLocalDate = isLocalDate(inflated.expiryLocalDate)
    ? inflated.expiryLocalDate
    : Number.isFinite(inflated.expiryDate)
      ? toLocalDate(inflated.expiryDate)
      : undefined;
  const candidate = {
    id: inflated.id,
    name: inflated.name,
    dosageText: inflated.dosageText,
    amountPerDose: inflated.amountPerDose,
    ...(hasStructuredDose ? {
      doseQuantity: Number(inflated.doseQuantity),
      doseUnit: inflated.doseUnit?.trim(),
      ...(inflated.doseSourceText ? { doseSourceText: inflated.doseSourceText } : {}),
    } : {}),
    ...(!hasStructuredDose && inflated.doseMigrationSuggestion
      ? { doseMigrationSuggestion: inflated.doseMigrationSuggestion }
      : {}),
    ...(!hasStructuredDose && inflated.amountPerDose.trim() ? { doseReviewRequired: true } : {}),
    slots: inflated.slots,
    mealRels: inflated.mealRels,
    mealRelsBySlot: inflated.mealRelsBySlot,
    daysOfWeek: [...new Set(inflated.daysOfWeek)].sort((left, right) => left - right),
    ...(inflated.inventory ? { inventory: selectInventory(inflated.inventory) } : {}),
    ...(inflated.notes !== undefined ? { notes: inflated.notes } : {}),
    ...(expiryLocalDate ? { expiryLocalDate } : {}),
    identity: inflated.identity ?? emptyIdentity(),
    updatedAt: inflated.updatedAt,
    ...(inflated.createdAt !== undefined ? { createdAt: inflated.createdAt } : {}),
  };
  return parseSyncEntityPayload('medication', candidate);
}

function selectInventory(value: NonNullable<Medication['inventory']>): NonNullable<SyncMedicationPayload['inventory']> {
  return {
    remaining: value.remaining,
    unit: value.unit,
    ...(value.packageQuantity !== undefined ? { packageQuantity: value.packageQuantity } : {}),
    ...(value.lowThreshold !== undefined ? { lowThreshold: value.lowThreshold } : {}),
    ...(value.sourceNote !== undefined ? { sourceNote: value.sourceNote } : {}),
    ...(value.lastReminderAt !== undefined ? { lastReminderAt: value.lastReminderAt } : {}),
    ...(value.dailyConsumption !== undefined ? { dailyConsumption: value.dailyConsumption } : {}),
  };
}

function selectIntake(value: z.infer<typeof legacyLog>): SyncIntakePayload {
  return {
    id: value.id,
    ...(value.occurrenceId ? { occurrenceId: value.occurrenceId } : {}),
    ...(value.scheduleRevisionId ? { scheduleRevisionId: value.scheduleRevisionId } : {}),
    ...(value.sourceRuleId ? { sourceRuleId: value.sourceRuleId } : {}),
    medId: value.medId,
    slot: value.slot,
    dueAt: value.dueAt,
    status: value.status as 'taken' | 'skipped',
    ...(value.ackAt !== undefined ? { ackAt: value.ackAt } : {}),
    ...(value.inventoryDelta !== undefined ? { inventoryDelta: value.inventoryDelta } : {}),
    updatedAt: value.updatedAt,
  };
}

function changeToMigrationEntity(change: RemoteSyncV2Change): MigrationEntity {
  return change.record.operation === 'delete'
    ? { entityType: change.record.entityType, entityId: change.record.entityId, operation: 'delete' }
    : {
        entityType: change.record.entityType,
        entityId: change.record.entityId,
        operation: 'upsert',
        payload: change.payload,
      };
}

async function digestEntities(entities: readonly MigrationEntity[]): Promise<string> {
  const canonical = canonicalJson([...entities].sort((left, right) =>
    entityKey(left.entityType, left.entityId).localeCompare(entityKey(right.entityType, right.entityId))));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return base64UrlEncode(new Uint8Array(digest));
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
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

function findDuplicateEntityKey(entities: readonly MigrationEntity[]): string | null {
  const seen = new Set<string>();
  for (const entity of entities) {
    const key = entityKey(entity.entityType, entity.entityId);
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return null;
}

function entityKey(entityType: SyncEntityType, entityId: string): string {
  return `${entityType}:${entityId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
