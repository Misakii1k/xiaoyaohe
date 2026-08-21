import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nativeStorage = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => true),
  setKeyPrefix: vi.fn(async () => undefined),
  setSynchronize: vi.fn(async () => undefined),
  keys: vi.fn(async (): Promise<string[]> => []),
  remove: vi.fn(async () => true),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: nativeStorage.isNativePlatform },
}));

vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: {
    setKeyPrefix: nativeStorage.setKeyPrefix,
    setSynchronize: nativeStorage.setSynchronize,
    keys: nativeStorage.keys,
    remove: nativeStorage.remove,
  },
}));

import { cleanupRetiredCloudSyncStorage } from './retiredCloudStorage';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

beforeEach(async () => {
  vi.clearAllMocks();
  nativeStorage.isNativePlatform.mockReturnValue(true);
  nativeStorage.keys.mockResolvedValue([]);
  vi.stubGlobal('localStorage', new MemoryStorage());
  await deleteDatabase('medbox-sync-v2');
});

describe('retired cloud storage cleanup', () => {
  it('removes only retired sync data and preserves AI secure-storage keys', async () => {
    localStorage.setItem('medbox.sync.config.v1', 'legacy-v1-secret');
    localStorage.setItem('medbox.sync.v2.public-config', 'legacy-v2-config');
    localStorage.setItem('medbox.unrelated', 'keep');
    await createRetiredDatabase();
    nativeStorage.keys.mockResolvedValue([
      'sync-v2-credentials-household-a',
      'ai-api-key',
      'sync-v2-credentials-household-b',
      'unrelated-secret',
    ]);

    await cleanupRetiredCloudSyncStorage();

    expect(localStorage.getItem('medbox.sync.config.v1')).toBeNull();
    expect(localStorage.getItem('medbox.sync.v2.public-config')).toBeNull();
    expect(localStorage.getItem('medbox.unrelated')).toBe('keep');
    expect((await indexedDB.databases()).map((database) => database.name))
      .not.toContain('medbox-sync-v2');
    expect(nativeStorage.setKeyPrefix).toHaveBeenCalledWith('medbox_');
    expect(nativeStorage.setSynchronize).toHaveBeenCalledWith(false);
    expect(nativeStorage.keys).toHaveBeenCalledWith(false);
    expect(nativeStorage.remove.mock.calls).toEqual([
      ['sync-v2-credentials-household-a', false],
      ['sync-v2-credentials-household-b', false],
    ]);
  });

  it('skips secure storage outside the native app', async () => {
    nativeStorage.isNativePlatform.mockReturnValue(false);
    localStorage.setItem('medbox.sync.config.v1', 'legacy');

    await cleanupRetiredCloudSyncStorage();

    expect(localStorage.getItem('medbox.sync.config.v1')).toBeNull();
    expect(nativeStorage.keys).not.toHaveBeenCalled();
    expect(nativeStorage.remove).not.toHaveBeenCalled();
  });

  it('does not reject when native platform detection is unavailable', async () => {
    nativeStorage.isNativePlatform.mockImplementationOnce(() => {
      throw new Error('Capacitor unavailable');
    });

    await expect(cleanupRetiredCloudSyncStorage()).resolves.toBeUndefined();
    expect(nativeStorage.keys).not.toHaveBeenCalled();
  });
});

function createRetiredDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('medbox-sync-v2', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`Database deletion blocked: ${name}`));
  });
}
