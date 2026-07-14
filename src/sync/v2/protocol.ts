export const SYNC_V2_SCHEMA_VERSION = 2 as const;

export const SYNC_V2_LIMITS = {
  requestBytes: 512 * 1024,
  responseBytes: 768 * 1024,
  mutationsPerRequest: 100,
  changesPerResponse: 500,
  entitiesPerHousehold: 5_000,
  ciphertextBytes: 64 * 1024 + 16,
  entityIdLength: 80,
  mutationIdLength: 80,
  deviceNameLength: 64,
} as const;

export const SYNC_ENTITY_TYPES = ['medication', 'schedule', 'intake'] as const;
export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number];
export type SyncMutationOperation = 'upsert' | 'delete';

export interface EncryptedPayload {
  algorithm: 'AES-GCM-256';
  iv: string;
  ciphertext: string;
}

export interface SyncMutation {
  mutationId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncMutationOperation;
  schemaVersion: typeof SYNC_V2_SCHEMA_VERSION;
  baseEntityRevision: number;
  encrypted?: EncryptedPayload;
}

export interface SyncRequestV2 {
  sinceHouseholdRevision: number;
  mutations: SyncMutation[];
}

export interface EncryptedEntityRecord {
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncMutationOperation;
  schemaVersion: typeof SYNC_V2_SCHEMA_VERSION;
  mutationId: string;
  entityRevision: number;
  householdRevision: number;
  encrypted?: EncryptedPayload;
}

export type MutationResult =
  | {
      mutationId: string;
      status: 'accepted';
      entityRevision: number;
      householdRevision: number;
    }
  | {
      mutationId: string;
      status: 'conflict';
      currentEntityRevision: number;
    }
  | {
      mutationId: string;
      status: 'rejected';
      code: 'mutation_id_reused' | 'entity_limit_reached';
    };

export interface SyncResponseV2 {
  householdRevision: number;
  nextHouseholdRevision: number;
  hasMore: boolean;
  results: MutationResult[];
  changes: EncryptedEntityRecord[];
}

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isSyncEntityType(value: unknown): value is SyncEntityType {
  return typeof value === 'string' && (SYNC_ENTITY_TYPES as readonly string[]).includes(value);
}

export function isValidHouseholdId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z2-9]{26}$/.test(value);
}

export function isValidDeviceId(value: unknown): value is string {
  return isBoundedId(value, 64);
}

export function validateEncryptedPayload(value: unknown, path = 'encrypted'): ValidationResult<EncryptedPayload> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    return invalid(path, 'invalid_type', 'Expected an encrypted payload object.');
  }
  rejectUnknownKeys(value, ['algorithm', 'iv', 'ciphertext'], path, issues);
  if (value.algorithm !== 'AES-GCM-256') {
    issues.push(issue(`${path}.algorithm`, 'unsupported_algorithm', 'Only AES-GCM-256 is supported.'));
  }
  if (!isBase64UrlOfSize(value.iv, 12, 12)) {
    issues.push(issue(`${path}.iv`, 'invalid_iv', 'AES-GCM IV must be 12 base64url-encoded bytes.'));
  }
  if (!isBase64UrlOfSize(value.ciphertext, 16, SYNC_V2_LIMITS.ciphertextBytes)) {
    issues.push(
      issue(
        `${path}.ciphertext`,
        'invalid_ciphertext',
        `Ciphertext must be valid base64url and at most ${SYNC_V2_LIMITS.ciphertextBytes} bytes.`,
      ),
    );
  }
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    value: {
      algorithm: 'AES-GCM-256',
      iv: value.iv as string,
      ciphertext: value.ciphertext as string,
    },
  };
}

export function validateSyncMutation(value: unknown, path = 'mutation'): ValidationResult<SyncMutation> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return invalid(path, 'invalid_type', 'Expected a mutation object.');

  rejectUnknownKeys(
    value,
    ['mutationId', 'entityType', 'entityId', 'operation', 'schemaVersion', 'baseEntityRevision', 'encrypted'],
    path,
    issues,
  );
  if (!isBoundedId(value.mutationId, SYNC_V2_LIMITS.mutationIdLength)) {
    issues.push(issue(`${path}.mutationId`, 'invalid_id', 'Mutation ID has an invalid format or length.'));
  }
  if (!isSyncEntityType(value.entityType)) {
    issues.push(
      issue(
        `${path}.entityType`,
        'unsupported_entity_type',
        'Only medication, schedule, and intake entities may be synchronized.',
      ),
    );
  }
  if (!isBoundedId(value.entityId, SYNC_V2_LIMITS.entityIdLength)) {
    issues.push(issue(`${path}.entityId`, 'invalid_id', 'Entity ID has an invalid format or length.'));
  }
  if (value.operation !== 'upsert' && value.operation !== 'delete') {
    issues.push(issue(`${path}.operation`, 'invalid_operation', 'Operation must be upsert or delete.'));
  }
  if (value.schemaVersion !== SYNC_V2_SCHEMA_VERSION) {
    issues.push(issue(`${path}.schemaVersion`, 'unsupported_schema', 'Unsupported sync schema version.'));
  }
  if (!isRevision(value.baseEntityRevision)) {
    issues.push(issue(`${path}.baseEntityRevision`, 'invalid_revision', 'Base revision must be a non-negative integer.'));
  }

  let encrypted: EncryptedPayload | undefined;
  if (value.operation === 'upsert') {
    const encryptedResult = validateEncryptedPayload(value.encrypted, `${path}.encrypted`);
    if (encryptedResult.ok) encrypted = encryptedResult.value;
    else issues.push(...encryptedResult.issues);
  } else if (value.operation === 'delete' && value.encrypted !== undefined) {
    issues.push(issue(`${path}.encrypted`, 'unexpected_ciphertext', 'Delete mutations must not contain ciphertext.'));
  }

  if (issues.length) return { ok: false, issues };
  const mutation: SyncMutation = {
    mutationId: value.mutationId as string,
    entityType: value.entityType as SyncEntityType,
    entityId: value.entityId as string,
    operation: value.operation as SyncMutationOperation,
    schemaVersion: SYNC_V2_SCHEMA_VERSION,
    baseEntityRevision: value.baseEntityRevision as number,
  };
  if (encrypted) mutation.encrypted = encrypted;
  return { ok: true, value: mutation };
}

export function validateSyncRequest(value: unknown): ValidationResult<SyncRequestV2> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return invalid('$', 'invalid_type', 'Expected a sync request object.');

  rejectUnknownKeys(value, ['sinceHouseholdRevision', 'mutations'], '$', issues);
  if (!isRevision(value.sinceHouseholdRevision)) {
    issues.push(issue('$.sinceHouseholdRevision', 'invalid_revision', 'Sync cursor must be a non-negative integer.'));
  }
  if (!Array.isArray(value.mutations)) {
    issues.push(issue('$.mutations', 'invalid_type', 'Mutations must be an array.'));
  } else if (value.mutations.length > SYNC_V2_LIMITS.mutationsPerRequest) {
    issues.push(
      issue(
        '$.mutations',
        'too_many_mutations',
        `A request may contain at most ${SYNC_V2_LIMITS.mutationsPerRequest} mutations.`,
      ),
    );
  }

  const mutations: SyncMutation[] = [];
  if (Array.isArray(value.mutations) && value.mutations.length <= SYNC_V2_LIMITS.mutationsPerRequest) {
    const seen = new Set<string>();
    value.mutations.forEach((candidate, index) => {
      const result = validateSyncMutation(candidate, `$.mutations[${index}]`);
      if (!result.ok) {
        issues.push(...result.issues);
        return;
      }
      if (seen.has(result.value.mutationId)) {
        issues.push(issue(`$.mutations[${index}].mutationId`, 'duplicate_mutation_id', 'Mutation IDs must be unique.'));
        return;
      }
      seen.add(result.value.mutationId);
      mutations.push(result.value);
    });
  }

  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    value: {
      sinceHouseholdRevision: value.sinceHouseholdRevision as number,
      mutations,
    },
  };
}

export function validateEncryptedEntityRecord(
  value: unknown,
  path = 'entity',
): ValidationResult<EncryptedEntityRecord> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return invalid(path, 'invalid_type', 'Expected an encrypted entity record.');
  rejectUnknownKeys(
    value,
    [
      'entityType',
      'entityId',
      'operation',
      'schemaVersion',
      'mutationId',
      'entityRevision',
      'householdRevision',
      'encrypted',
    ],
    path,
    issues,
  );
  if (!isSyncEntityType(value.entityType)) {
    issues.push(issue(`${path}.entityType`, 'unsupported_entity_type', 'Unsupported synchronized entity type.'));
  }
  if (!isBoundedId(value.entityId, SYNC_V2_LIMITS.entityIdLength)) {
    issues.push(issue(`${path}.entityId`, 'invalid_id', 'Entity ID has an invalid format or length.'));
  }
  if (value.operation !== 'upsert' && value.operation !== 'delete') {
    issues.push(issue(`${path}.operation`, 'invalid_operation', 'Operation must be upsert or delete.'));
  }
  if (value.schemaVersion !== SYNC_V2_SCHEMA_VERSION) {
    issues.push(issue(`${path}.schemaVersion`, 'unsupported_schema', 'Unsupported sync schema version.'));
  }
  if (!isBoundedId(value.mutationId, SYNC_V2_LIMITS.mutationIdLength)) {
    issues.push(issue(`${path}.mutationId`, 'invalid_id', 'Mutation ID has an invalid format or length.'));
  }
  if (!isPositiveRevision(value.entityRevision)) {
    issues.push(issue(`${path}.entityRevision`, 'invalid_revision', 'Entity revision must be a positive integer.'));
  }
  if (!isPositiveRevision(value.householdRevision)) {
    issues.push(issue(`${path}.householdRevision`, 'invalid_revision', 'Household revision must be a positive integer.'));
  }

  let encrypted: EncryptedPayload | undefined;
  if (value.operation === 'upsert') {
    const encryptedResult = validateEncryptedPayload(value.encrypted, `${path}.encrypted`);
    if (encryptedResult.ok) encrypted = encryptedResult.value;
    else issues.push(...encryptedResult.issues);
  } else if (value.operation === 'delete' && value.encrypted !== undefined) {
    issues.push(issue(`${path}.encrypted`, 'unexpected_ciphertext', 'Delete records must not contain ciphertext.'));
  }
  if (issues.length) return { ok: false, issues };

  return {
    ok: true,
    value: {
      entityType: value.entityType as SyncEntityType,
      entityId: value.entityId as string,
      operation: value.operation as SyncMutationOperation,
      schemaVersion: SYNC_V2_SCHEMA_VERSION,
      mutationId: value.mutationId as string,
      entityRevision: value.entityRevision as number,
      householdRevision: value.householdRevision as number,
      ...(encrypted ? { encrypted } : {}),
    },
  };
}

export function validateSyncResponse(value: unknown): ValidationResult<SyncResponseV2> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return invalid('$', 'invalid_type', 'Expected a sync response object.');
  rejectUnknownKeys(
    value,
    ['householdRevision', 'nextHouseholdRevision', 'hasMore', 'results', 'changes'],
    '$',
    issues,
  );
  if (!isRevision(value.householdRevision)) {
    issues.push(issue('$.householdRevision', 'invalid_revision', 'Household revision must be a non-negative integer.'));
  }
  if (!isRevision(value.nextHouseholdRevision)) {
    issues.push(issue('$.nextHouseholdRevision', 'invalid_revision', 'Next revision must be a non-negative integer.'));
  }
  if (typeof value.hasMore !== 'boolean') issues.push(issue('$.hasMore', 'invalid_type', 'hasMore must be a boolean.'));
  if (!Array.isArray(value.results) || value.results.length > SYNC_V2_LIMITS.mutationsPerRequest) {
    issues.push(issue('$.results', 'invalid_results', 'Mutation results have an invalid type or count.'));
  }
  if (!Array.isArray(value.changes) || value.changes.length > SYNC_V2_LIMITS.changesPerResponse) {
    issues.push(issue('$.changes', 'invalid_changes', 'Entity changes have an invalid type or count.'));
  }

  const results: MutationResult[] = [];
  if (Array.isArray(value.results) && value.results.length <= SYNC_V2_LIMITS.mutationsPerRequest) {
    value.results.forEach((candidate, index) => {
      const result = validateMutationResult(candidate, `$.results[${index}]`);
      if (result.ok) results.push(result.value);
      else issues.push(...result.issues);
    });
  }
  const changes: EncryptedEntityRecord[] = [];
  if (Array.isArray(value.changes) && value.changes.length <= SYNC_V2_LIMITS.changesPerResponse) {
    let previousRevision = 0;
    value.changes.forEach((candidate, index) => {
      const result = validateEncryptedEntityRecord(candidate, `$.changes[${index}]`);
      if (!result.ok) {
        issues.push(...result.issues);
        return;
      }
      if (result.value.householdRevision <= previousRevision) {
        issues.push(issue(`$.changes[${index}].householdRevision`, 'invalid_order', 'Changes must be revision ordered.'));
      }
      previousRevision = result.value.householdRevision;
      changes.push(result.value);
    });
  }
  if (
    isRevision(value.householdRevision) &&
    isRevision(value.nextHouseholdRevision) &&
    value.nextHouseholdRevision > value.householdRevision
  ) {
    issues.push(issue('$.nextHouseholdRevision', 'cursor_ahead', 'Next revision cannot exceed household revision.'));
  }
  const householdRevision = isRevision(value.householdRevision) ? value.householdRevision : null;
  if (householdRevision !== null && changes.some((change) => change.householdRevision > householdRevision)) {
    issues.push(issue('$.changes', 'revision_ahead', 'A change cannot exceed the household revision.'));
  }
  if (householdRevision !== null && isRevision(value.nextHouseholdRevision) && typeof value.hasMore === 'boolean') {
    const expectedNext = value.hasMore
      ? changes[changes.length - 1]?.householdRevision
      : householdRevision;
    if (expectedNext === undefined || value.nextHouseholdRevision !== expectedNext) {
      issues.push(issue('$.nextHouseholdRevision', 'invalid_cursor', 'Response cursor does not match the returned page.'));
    }
  }
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    value: {
      householdRevision: value.householdRevision as number,
      nextHouseholdRevision: value.nextHouseholdRevision as number,
      hasMore: value.hasMore as boolean,
      results,
      changes,
    },
  };
}

export function validateDeviceName(value: unknown): ValidationResult<string> {
  if (typeof value !== 'string') return invalid('deviceName', 'invalid_type', 'Device name must be a string.');
  const name = value.trim();
  if (!name || name.length > SYNC_V2_LIMITS.deviceNameLength || /[\u0000-\u001f\u007f]/.test(name)) {
    return invalid('deviceName', 'invalid_device_name', 'Device name must contain 1 to 64 printable characters.');
  }
  return { ok: true, value: name };
}

export function canonicalMutation(mutation: SyncMutation): string {
  return JSON.stringify({
    mutationId: mutation.mutationId,
    entityType: mutation.entityType,
    entityId: mutation.entityId,
    operation: mutation.operation,
    schemaVersion: mutation.schemaVersion,
    baseEntityRevision: mutation.baseEntityRevision,
    encrypted: mutation.encrypted ?? null,
  });
}

function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveRevision(value: unknown): value is number {
  return isRevision(value) && value > 0;
}

function validateMutationResult(value: unknown, path: string): ValidationResult<MutationResult> {
  if (!isRecord(value)) return invalid(path, 'invalid_type', 'Expected a mutation result object.');
  const issues: ValidationIssue[] = [];
  if (!isBoundedId(value.mutationId, SYNC_V2_LIMITS.mutationIdLength)) {
    issues.push(issue(`${path}.mutationId`, 'invalid_id', 'Mutation ID has an invalid format or length.'));
  }
  if (value.status === 'accepted') {
    rejectUnknownKeys(value, ['mutationId', 'status', 'entityRevision', 'householdRevision'], path, issues);
    if (!isPositiveRevision(value.entityRevision)) {
      issues.push(issue(`${path}.entityRevision`, 'invalid_revision', 'Entity revision must be positive.'));
    }
    if (!isPositiveRevision(value.householdRevision)) {
      issues.push(issue(`${path}.householdRevision`, 'invalid_revision', 'Household revision must be positive.'));
    }
    if (issues.length) return { ok: false, issues };
    return {
      ok: true,
      value: {
        mutationId: value.mutationId as string,
        status: 'accepted',
        entityRevision: value.entityRevision as number,
        householdRevision: value.householdRevision as number,
      },
    };
  }
  if (value.status === 'conflict') {
    rejectUnknownKeys(value, ['mutationId', 'status', 'currentEntityRevision'], path, issues);
    if (!isRevision(value.currentEntityRevision)) {
      issues.push(issue(`${path}.currentEntityRevision`, 'invalid_revision', 'Current revision must be non-negative.'));
    }
    if (issues.length) return { ok: false, issues };
    return {
      ok: true,
      value: {
        mutationId: value.mutationId as string,
        status: 'conflict',
        currentEntityRevision: value.currentEntityRevision as number,
      },
    };
  }
  if (value.status === 'rejected') {
    rejectUnknownKeys(value, ['mutationId', 'status', 'code'], path, issues);
    if (value.code !== 'mutation_id_reused' && value.code !== 'entity_limit_reached') {
      issues.push(issue(`${path}.code`, 'invalid_rejection_code', 'Unsupported mutation rejection code.'));
    }
    if (issues.length) return { ok: false, issues };
    return {
      ok: true,
      value: {
        mutationId: value.mutationId as string,
        status: 'rejected',
        code: value.code as 'mutation_id_reused' | 'entity_limit_reached',
      },
    };
  }
  return invalid(path, 'invalid_status', 'Unsupported mutation result status.');
}

function isBoundedId(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength && ID_PATTERN.test(value);
}

function isBase64UrlOfSize(value: unknown, minBytes: number, maxBytes: number): value is string {
  if (typeof value !== 'string' || !BASE64URL_PATTERN.test(value) || value.length % 4 === 1) return false;
  const bytes = Math.floor((value.length * 6) / 8);
  return bytes >= minBytes && bytes <= maxBytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      issues.push(issue(`${path}.${key}`, 'unknown_field', `Unexpected field: ${key}.`));
    }
  }
}

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

function invalid<T>(path: string, code: string, message: string): ValidationResult<T> {
  return { ok: false, issues: [issue(path, code, message)] };
}
