import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupRetiredWorkStorage } from './retiredWorkStorage';

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
  vi.stubGlobal('localStorage', new MemoryStorage());
  await deleteDatabase('medbox-work');
});

describe('retired work storage cleanup', () => {
  it('removes the old database and last-entry preference without touching medication data', async () => {
    localStorage.setItem('medbox.lastWorkEntry', '{profileId:legacy}');
    localStorage.setItem('medbox.ai-consent.v2', JSON.stringify([
      { version: 2, origin: 'https://health.example', category: 'health', grantedAt: 1 },
      { version: 2, origin: 'https://work.example', category: 'work', grantedAt: 2 },
      { version: 2, origin: 'https://assistant.example', category: 'assistant', grantedAt: 3 },
    ]));
    localStorage.setItem('medbox.unrelated', 'keep');
    await createRetiredDatabase();

    await cleanupRetiredWorkStorage();

    expect(localStorage.getItem('medbox.lastWorkEntry')).toBeNull();
    expect(localStorage.getItem('medbox.unrelated')).toBe('keep');
    expect(JSON.parse(localStorage.getItem('medbox.ai-consent.v2') ?? '[]')).toEqual([
      { version: 2, origin: 'https://health.example', category: 'health', grantedAt: 1 },
      { version: 2, origin: 'https://assistant.example', category: 'assistant', grantedAt: 3 },
    ]);
    expect((await indexedDB.databases()).map((database) => database.name)).not.toContain('medbox-work');
  });

  it('is safe to run repeatedly', async () => {
    await cleanupRetiredWorkStorage();
    await cleanupRetiredWorkStorage();

    expect((await indexedDB.databases()).map((database) => database.name)).not.toContain('medbox-work');
  });
});

function createRetiredDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('medbox-work', 2);
    request.onupgradeneeded = () => request.result.createObjectStore('workEntries', { keyPath: 'id' });
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
