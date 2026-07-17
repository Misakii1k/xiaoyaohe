import { z } from 'zod';

export const LAN_SYNC_PROTOCOL_VERSION = 1 as const;
export const LAN_SYNC_MAX_PLAINTEXT_BYTES = 5 * 1024 * 1024;
export const LAN_SYNC_SECRET_BYTES = 32;

export type LanSyncRole = 'host' | 'joiner';
export type LanSyncMessageType = 'join' | 'result' | 'ack' | 'error';

export interface LanSyncMessageMetadata {
  sessionId: string;
  sender: LanSyncRole;
  sequence: number;
  messageType: LanSyncMessageType;
}

export interface LanSyncEncryptedMessage extends LanSyncMessageMetadata {
  kind: 'medbox.lan.encrypted';
  version: typeof LAN_SYNC_PROTOCOL_VERSION;
  iv: string;
  ciphertext: string;
}

const sessionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
const encryptedMessageSchema = z.object({
  kind: z.literal('medbox.lan.encrypted'),
  version: z.literal(LAN_SYNC_PROTOCOL_VERSION),
  sessionId: sessionIdSchema,
  sender: z.enum(['host', 'joiner']),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  messageType: z.enum(['join', 'result', 'ack', 'error']),
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  ciphertext: z.string().min(22).max(Math.ceil((LAN_SYNC_MAX_PLAINTEXT_BYTES + 16) * 4 / 3) + 8),
}).strict();

export function randomLanSyncBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 1 || length > 1024) {
    throw new Error('Invalid random byte length.');
  }
  return crypto.getRandomValues(new Uint8Array(length));
}

export function createLanSyncSessionId(): string {
  return base64UrlEncode(randomLanSyncBytes(16));
}

export async function deriveLanSyncSessionKey(
  secret: Uint8Array,
  sessionId: string,
): Promise<CryptoKey> {
  if (secret.byteLength !== LAN_SYNC_SECRET_BYTES) {
    throw new Error('连接码内容不完整。');
  }
  sessionIdSchema.parse(sessionId);
  const material = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(secret),
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBuffer(new TextEncoder().encode(sessionId)),
      info: toArrayBuffer(new TextEncoder().encode('medbox-lan-sync-v1')),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptLanSyncMessage(
  key: CryptoKey,
  metadata: LanSyncMessageMetadata,
  value: unknown,
): Promise<string> {
  const normalized = normalizeMetadata(metadata);
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('同步资料格式不正确。');
  const plaintext = new TextEncoder().encode(serialized);
  if (plaintext.byteLength > LAN_SYNC_MAX_PLAINTEXT_BYTES) {
    throw new Error('要传送的资料太多，请先减少旧记录后再试。');
  }
  const iv = randomLanSyncBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(buildLanSyncAad(normalized)),
      tagLength: 128,
    },
    key,
    toArrayBuffer(plaintext),
  );
  const envelope: LanSyncEncryptedMessage = {
    kind: 'medbox.lan.encrypted',
    version: LAN_SYNC_PROTOCOL_VERSION,
    ...normalized,
    iv: base64UrlEncode(iv),
    ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
  };
  return JSON.stringify(envelope);
}

export async function decryptLanSyncMessage<T>(
  key: CryptoKey,
  raw: string,
  expected: LanSyncMessageMetadata,
): Promise<T> {
  if (new TextEncoder().encode(raw).byteLength > Math.ceil(LAN_SYNC_MAX_PLAINTEXT_BYTES * 4 / 3) + 2048) {
    throw new Error('收到的资料太多，已停止同步。');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('收到的资料格式不正确。');
  }
  const envelope = encryptedMessageSchema.parse(parsed);
  const normalized = normalizeMetadata(expected);
  if (
    envelope.sessionId !== normalized.sessionId ||
    envelope.sender !== normalized.sender ||
    envelope.sequence !== normalized.sequence ||
    envelope.messageType !== normalized.messageType
  ) {
    throw new Error('连接已经失效，请重新扫码。');
  }
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(base64UrlDecode(envelope.iv)),
        additionalData: toArrayBuffer(buildLanSyncAad(normalized)),
        tagLength: 128,
      },
      key,
      toArrayBuffer(base64UrlDecode(envelope.ciphertext)),
    );
  } catch {
    throw new Error('连接码不匹配，资料没有传送。');
  }
  if (plaintext.byteLength > LAN_SYNC_MAX_PLAINTEXT_BYTES) {
    throw new Error('收到的资料太多，已停止同步。');
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)) as T;
  } catch {
    throw new Error('收到的资料格式不正确。');
  }
}

export function parseLanSyncEncryptedMessage(raw: string): LanSyncEncryptedMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('收到的资料格式不正确。');
  }
  return encryptedMessageSchema.parse(parsed);
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error('连接码内容不完整。');
  }
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error('连接码内容不完整。');
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function normalizeMetadata(metadata: LanSyncMessageMetadata): LanSyncMessageMetadata {
  return {
    sessionId: sessionIdSchema.parse(metadata.sessionId),
    sender: z.enum(['host', 'joiner']).parse(metadata.sender),
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).parse(metadata.sequence),
    messageType: z.enum(['join', 'result', 'ack', 'error']).parse(metadata.messageType),
  };
}

function buildLanSyncAad(metadata: LanSyncMessageMetadata): Uint8Array {
  return new TextEncoder().encode(JSON.stringify([
    'medbox-lan-sync',
    LAN_SYNC_PROTOCOL_VERSION,
    metadata.sessionId,
    metadata.sender,
    metadata.sequence,
    metadata.messageType,
  ]));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}
