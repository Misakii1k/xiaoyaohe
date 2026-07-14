import {
  SYNC_V2_SCHEMA_VERSION,
  type EncryptedPayload,
  type SyncEntityType,
  type SyncMutationOperation,
  validateEncryptedPayload,
} from './protocol';

const RECOVERY_PREFIX = 'MB2';
const RECOVERY_VERSION = 2;
const DATA_KEY_BYTES = 32;
const RECOVERY_CHECKSUM_BYTES = 4;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface EntityAadMetadata {
  householdId: string;
  entityType: SyncEntityType;
  entityId: string;
  schemaVersion: typeof SYNC_V2_SCHEMA_VERSION;
  mutationId: string;
  operation: SyncMutationOperation;
}

export interface PairingCodeData {
  endpoint: string;
  householdId: string;
  pairingCode: string;
  recoveryCode: string;
}

export interface ParsedPairingCode extends PairingCodeData {
  pairingUrl: string;
}

export async function generateDataKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function importDataKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.byteLength !== DATA_KEY_BYTES) throw new Error('A sync data key must be exactly 32 bytes.');
  return crypto.subtle.importKey('raw', toArrayBuffer(raw), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

export async function exportDataKey(key: CryptoKey): Promise<Uint8Array> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  if (raw.byteLength !== DATA_KEY_BYTES) throw new Error('Unexpected sync data key length.');
  return raw;
}

export async function generateRecoveryCode(): Promise<{ key: CryptoKey; recoveryCode: string }> {
  const key = await generateDataKey();
  return { key, recoveryCode: encodeRecoveryCode(await exportDataKey(key)) };
}

export function encodeRecoveryCode(rawKey: Uint8Array): string {
  if (rawKey.byteLength !== DATA_KEY_BYTES) throw new Error('A recovery code requires a 32-byte key.');
  const versioned = new Uint8Array(1 + DATA_KEY_BYTES);
  versioned[0] = RECOVERY_VERSION;
  versioned.set(rawKey, 1);
  const checksum = crc32(versioned);
  const payload = new Uint8Array(versioned.byteLength + RECOVERY_CHECKSUM_BYTES);
  payload.set(versioned);
  payload.set(uint32Bytes(checksum), versioned.byteLength);
  const encoded = base32Encode(payload);
  return `${RECOVERY_PREFIX}-${encoded.match(/.{1,5}/g)?.join('-') ?? encoded}`;
}

export function decodeRecoveryCode(code: string): Uint8Array {
  const compact = code.trim().toUpperCase().replace(/[\s-]/g, '');
  if (!compact.startsWith(RECOVERY_PREFIX)) throw new Error('Invalid recovery code prefix.');
  const encoded = compact.slice(RECOVERY_PREFIX.length);
  const payload = base32Decode(encoded);
  if (payload.byteLength !== 1 + DATA_KEY_BYTES + RECOVERY_CHECKSUM_BYTES) {
    throw new Error('Invalid recovery code length.');
  }
  const versioned = payload.slice(0, 1 + DATA_KEY_BYTES);
  if (versioned[0] !== RECOVERY_VERSION) throw new Error('Unsupported recovery code version.');
  const expected = bytesUint32(payload.slice(1 + DATA_KEY_BYTES));
  if (crc32(versioned) !== expected) throw new Error('Recovery code checksum mismatch.');
  const raw = versioned.slice(1);
  const canonicalInput = encoded.replace(/[O]/g, '0').replace(/[IL]/g, '1');
  if (encodeRecoveryCode(raw).replace(/-/g, '') !== `${RECOVERY_PREFIX}${canonicalInput}`) {
    throw new Error('Recovery code is not canonical.');
  }
  return raw;
}

export async function importRecoveryCode(code: string): Promise<CryptoKey> {
  return importDataKey(decodeRecoveryCode(code));
}

export function buildEntityAad(metadata: EntityAadMetadata): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify([
      'medbox-sync-v2',
      metadata.householdId,
      metadata.entityType,
      metadata.entityId,
      metadata.schemaVersion,
      metadata.mutationId,
      metadata.operation,
    ]),
  );
}

export async function encryptEntity(
  key: CryptoKey,
  metadata: EntityAadMetadata,
  plaintext: unknown,
): Promise<EncryptedPayload> {
  const serialized = JSON.stringify(plaintext);
  if (serialized === undefined) throw new Error('Entity plaintext must be JSON serializable.');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv), additionalData: toArrayBuffer(buildEntityAad(metadata)), tagLength: 128 },
    key,
    toArrayBuffer(new TextEncoder().encode(serialized)),
  );
  return {
    algorithm: 'AES-GCM-256',
    iv: base64UrlEncode(iv),
    ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
  };
}

export async function decryptEntity<T>(
  key: CryptoKey,
  metadata: EntityAadMetadata,
  payload: EncryptedPayload,
): Promise<T> {
  const validated = validateEncryptedPayload(payload);
  if (!validated.ok) throw new Error(validated.issues[0]?.message ?? 'Invalid encrypted payload.');
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(base64UrlDecode(payload.iv)),
      additionalData: toArrayBuffer(buildEntityAad(metadata)),
      tagLength: 128,
    },
    key,
    toArrayBuffer(base64UrlDecode(payload.ciphertext)),
  );
  return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(plaintext)) as T;
}

export async function createPairingCode(data: PairingCodeData): Promise<string> {
  const normalized = normalizePairingData(data);
  const url = new URL('medbox-sync-v2://pair');
  url.searchParams.set('v', '2');
  url.searchParams.set('endpoint', normalized.endpoint);
  url.searchParams.set('household', normalized.householdId);
  url.hash = new URLSearchParams({ code: normalized.pairingCode, key: normalized.recoveryCode }).toString();
  return url.toString();
}

export async function parsePairingCode(value: string): Promise<ParsedPairingCode> {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Pairing code is not a valid URL.');
  }
  if (url.protocol !== 'medbox-sync-v2:' || url.hostname !== 'pair' || url.searchParams.get('v') !== '2') {
    throw new Error('Unsupported pairing code format.');
  }
  const fragment = new URLSearchParams(url.hash.slice(1));
  const normalized = normalizePairingData({
    endpoint: url.searchParams.get('endpoint') ?? '',
    householdId: url.searchParams.get('household') ?? '',
    pairingCode: fragment.get('code') ?? '',
    recoveryCode: fragment.get('key') ?? '',
  });
  return {
    ...normalized,
    pairingUrl: `${normalized.endpoint}/api/v2/households/${normalized.householdId}/pair`,
  };
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new Error('Invalid base64url value.');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function normalizePairingData(data: PairingCodeData): PairingCodeData {
  const endpoint = normalizeEndpoint(data.endpoint);
  if (!/^[a-z2-9]{26}$/.test(data.householdId)) throw new Error('Invalid household ID.');
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(data.pairingCode)) throw new Error('Invalid one-time pairing code.');
  const recoveryCode = encodeRecoveryCode(decodeRecoveryCode(data.recoveryCode));
  return { endpoint, householdId: data.householdId, pairingCode: data.pairingCode, recoveryCode };
}

function normalizeEndpoint(value: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error('Invalid sync endpoint.');
  }
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.pathname !== '/' && endpoint.pathname !== '')
  ) {
    throw new Error('Sync endpoint must be an HTTPS origin without credentials, path, query, or fragment.');
  }
  return endpoint.origin;
}

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += CROCKFORD[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value: string): Uint8Array {
  const aliases = value.replace(/[O]/g, '0').replace(/[IL]/g, '1');
  let bits = 0;
  let buffer = 0;
  const output: number[] = [];
  for (const char of aliases) {
    const index = CROCKFORD.indexOf(char);
    if (index < 0) throw new Error('Recovery code contains an invalid character.');
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) throw new Error('Recovery code has invalid trailing data.');
  return Uint8Array.from(output);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function uint32Bytes(value: number): Uint8Array {
  return Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function bytesUint32(bytes: Uint8Array): number {
  if (bytes.byteLength !== 4) throw new Error('Invalid checksum length.');
  return (((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}
