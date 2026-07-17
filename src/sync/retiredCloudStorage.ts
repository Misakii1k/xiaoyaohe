import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { Capacitor } from '@capacitor/core';

const RETIRED_LOCAL_STORAGE_KEYS = [
  'medbox.sync.config.v1',
  'medbox.sync.v2.public-config',
] as const;
const RETIRED_DATABASE_NAME = 'medbox-sync-v2';
const SECURE_STORAGE_PREFIX = 'medbox_';
const RETIRED_CREDENTIAL_PREFIX = 'sync-v2-credentials-';

/** Best-effort cleanup for data left by the retired cloud sync implementation. */
export async function cleanupRetiredCloudSyncStorage(): Promise<void> {
  removeRetiredLocalStorage();
  await Promise.all([
    deleteRetiredDatabase(),
    removeRetiredNativeCredentials(),
  ]);
}

function removeRetiredLocalStorage(): void {
  try {
    for (const key of RETIRED_LOCAL_STORAGE_KEYS) localStorage.removeItem(key);
  } catch {
    // Storage denial must not block application startup.
  }
}

function deleteRetiredDatabase(): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(RETIRED_DATABASE_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function removeRetiredNativeCredentials(): Promise<void> {
  try {
    if (!Capacitor.isNativePlatform()) return;
    await SecureStorage.setKeyPrefix(SECURE_STORAGE_PREFIX);
    await SecureStorage.setSynchronize(false);
    const keys = await SecureStorage.keys(false);
    const retiredKeys = keys.filter((key) => key.startsWith(RETIRED_CREDENTIAL_PREFIX));
    await Promise.all(retiredKeys.map((key) => SecureStorage.remove(key, false)));
  } catch {
    // A later startup can retry if native secure storage is temporarily unavailable.
  }
}
