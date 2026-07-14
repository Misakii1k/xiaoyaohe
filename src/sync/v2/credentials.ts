import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';
import { Capacitor } from '@capacitor/core';
import { base64UrlDecode } from './crypto';
import { isValidHouseholdId } from './protocol';

const DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{3,64}\.[A-Za-z0-9_-]{40,64}$/;
const SECURE_STORAGE_PREFIX = 'medbox_';
const SECURE_STORAGE_KEY_PREFIX = 'sync-v2-credentials-';

export interface StoredSyncV2Credentials {
  deviceToken: string;
  /** Raw 256-bit AES data key encoded as base64url. */
  dataKey: string;
}

export interface SyncV2CredentialStore {
  load(householdId: string): Promise<StoredSyncV2Credentials | null>;
  save(householdId: string, credentials: StoredSyncV2Credentials): Promise<void>;
  clear(householdId: string): Promise<void>;
}

const sessionCredentials = new Map<string, StoredSyncV2Credentials>();

/** Browser credentials intentionally live only for the current JavaScript session. */
export class SessionSyncV2CredentialStore implements SyncV2CredentialStore {
  async load(householdId: string): Promise<StoredSyncV2Credentials | null> {
    assertHouseholdId(householdId);
    const stored = sessionCredentials.get(householdId);
    return stored ? { ...stored } : null;
  }

  async save(householdId: string, credentials: StoredSyncV2Credentials): Promise<void> {
    assertHouseholdId(householdId);
    assertCredentials(credentials);
    sessionCredentials.set(householdId, { ...credentials });
  }

  async clear(householdId: string): Promise<void> {
    assertHouseholdId(householdId);
    sessionCredentials.delete(householdId);
  }
}

let secureStorageInitialization: Promise<void> | null = null;

/** Native credentials are device-bound and never synchronized through backups or iCloud. */
export class NativeSyncV2CredentialStore implements SyncV2CredentialStore {
  async load(householdId: string): Promise<StoredSyncV2Credentials | null> {
    assertHouseholdId(householdId);
    await initializeSecureStorage();
    const value = await SecureStorage.get(storageKey(householdId), false, false);
    if (value === null) return null;
    if (!isRecord(value)) throw new Error('Stored sync credentials are corrupted.');
    const credentials = { deviceToken: value.deviceToken, dataKey: value.dataKey };
    assertCredentials(credentials);
    return credentials;
  }

  async save(householdId: string, credentials: StoredSyncV2Credentials): Promise<void> {
    assertHouseholdId(householdId);
    assertCredentials(credentials);
    await initializeSecureStorage();
    await SecureStorage.set(
      storageKey(householdId),
      { deviceToken: credentials.deviceToken, dataKey: credentials.dataKey },
      false,
      false,
      KeychainAccess.whenUnlockedThisDeviceOnly,
    );
  }

  async clear(householdId: string): Promise<void> {
    assertHouseholdId(householdId);
    await initializeSecureStorage();
    await SecureStorage.remove(storageKey(householdId), false);
  }
}

export function createPlatformSyncV2CredentialStore(): SyncV2CredentialStore {
  return Capacitor.isNativePlatform()
    ? new NativeSyncV2CredentialStore()
    : new SessionSyncV2CredentialStore();
}

export function assertCredentials(value: unknown): asserts value is StoredSyncV2Credentials {
  if (!isRecord(value) || typeof value.deviceToken !== 'string' || !DEVICE_TOKEN_PATTERN.test(value.deviceToken)) {
    throw new Error('Invalid sync device token.');
  }
  if (typeof value.dataKey !== 'string') throw new Error('Invalid sync data key.');
  let keyBytes: Uint8Array;
  try {
    keyBytes = base64UrlDecode(value.dataKey);
  } catch {
    throw new Error('Invalid sync data key encoding.');
  }
  if (keyBytes.byteLength !== 32) throw new Error('A sync data key must contain exactly 32 bytes.');
}

function initializeSecureStorage(): Promise<void> {
  secureStorageInitialization ??= (async () => {
    await SecureStorage.setKeyPrefix(SECURE_STORAGE_PREFIX);
    await SecureStorage.setSynchronize(false);
    await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly);
  })();
  return secureStorageInitialization;
}

function storageKey(householdId: string): string {
  return `${SECURE_STORAGE_KEY_PREFIX}${householdId}`;
}

function assertHouseholdId(householdId: string): void {
  if (!isValidHouseholdId(householdId)) throw new Error('Invalid sync household ID.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
