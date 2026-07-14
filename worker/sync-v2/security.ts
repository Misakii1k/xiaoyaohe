import { canonicalMutation, type SyncMutation } from '../../src/sync/v2/protocol';

const HOUSEHOLD_ALPHABET = 'abcdefghjklmnpqrstuvwxyz23456789';

export interface BearerCredentials {
  deviceId: string;
  tokenHash: string;
}

export function randomHouseholdId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bits = 0;
  let buffer = 0;
  let output = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += HOUSEHOLD_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += HOUSEHOLD_ALPHABET[(buffer << (5 - bits)) & 31];
  return output;
}

export function randomId(prefix: string): string {
  return `${prefix}_${randomBase64Url(12)}`;
}

export function createDeviceToken(deviceId: string): string {
  return `${deviceId}.${randomBase64Url(32)}`;
}

export function createPairingSecret(): string {
  return randomBase64Url(24);
}

export async function parseBearerCredentials(header: string | null): Promise<BearerCredentials | null> {
  if (!header) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{3,64}\.[A-Za-z0-9_-]{40,64})$/.exec(header);
  if (!match) return null;
  const token = match[1];
  const separator = token.indexOf('.');
  return { deviceId: token.slice(0, separator), tokenHash: await sha256(token) };
}

export async function fingerprintMutation(mutation: SyncMutation): Promise<string> {
  return sha256(canonicalMutation(mutation));
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

export function constantTimeEqual(left: string, right: string): boolean {
  const max = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < max; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function randomBase64Url(byteLength: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
