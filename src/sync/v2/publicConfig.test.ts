import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSyncV2PublicConfig,
  getSyncV2PublicConfig,
  setSyncV2PublicConfig,
} from './publicConfig';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('sync v2 public configuration', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
  });

  it('persists only public routing and presentation fields', () => {
    const value = setSyncV2PublicConfig({
      endpoint: 'https://sync.example.test/',
      householdId: 'a'.repeat(26),
      deviceName: '妈妈的手机',
      role: 'caregiver',
    });
    expect(value.endpoint).toBe('https://sync.example.test');
    expect(getSyncV2PublicConfig()).toEqual(value);
    const persisted = localStorage.getItem('medbox.sync.v2.public-config') ?? '';
    expect(persisted).not.toMatch(/token|secret|dataKey|recovery/i);
  });

  it('fails closed for malformed or non-HTTPS stored metadata', () => {
    localStorage.setItem('medbox.sync.v2.public-config', JSON.stringify({
      endpoint: 'http://sync.example.test',
      householdId: 'a'.repeat(26),
      deviceName: '手机',
      role: 'patient',
    }));
    expect(getSyncV2PublicConfig()).toBeNull();
    clearSyncV2PublicConfig();
    expect(getSyncV2PublicConfig()).toBeNull();
  });
});
