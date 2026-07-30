// apkTransport 单元测试：覆盖 compareVersion、recordPeerVersion、getAvailableUpdate。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAvailableUpdate,
  compareVersion,
  getAvailableUpdate,
  LOCAL_APP_VERSION_CODE,
  recordPeerVersion,
} from './apkTransport';

const memoryLocalStorage = (() => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
  };
})();

describe('compareVersion', () => {
  it('returns positive when first version is newer', () => {
    expect(compareVersion('0.9.1', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersion('1.0.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersion('0.10.0', '0.9.0')).toBeGreaterThan(0);
  });

  it('returns negative when second version is newer', () => {
    expect(compareVersion('0.9.0', '0.9.1')).toBeLessThan(0);
    expect(compareVersion('0.8.5', '0.9.0')).toBeLessThan(0);
  });

  it('returns 0 for equal versions', () => {
    expect(compareVersion('0.9.1', '0.9.1')).toBe(0);
    expect(compareVersion('1.0.0', '1.0.0')).toBe(0);
  });

  it('pads missing segments with zero', () => {
    expect(compareVersion('1.0', '1.0.0')).toBe(0);
    expect(compareVersion('1', '1.0.0')).toBe(0);
    expect(compareVersion('1.0.1', '1.0')).toBeGreaterThan(0);
  });
});

describe('recordPeerVersion and getAvailableUpdate', () => {
  beforeEach(() => {
    memoryLocalStorage.clear();
    vi.stubGlobal('localStorage', memoryLocalStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not record when peer version is not higher', () => {
    recordPeerVersion('192.168.1.10', {
      appVersion: '0.0.1',
      versionCode: 1,
    });
    expect(getAvailableUpdate()).toBeNull();
  });

  it('does not record when peer version code is equal to local', () => {
    recordPeerVersion('192.168.1.10', {
      appVersion: '0.0.0',
      versionCode: LOCAL_APP_VERSION_CODE,
    });
    expect(getAvailableUpdate()).toBeNull();
  });

  it('records update when peer versionCode is higher than local', () => {
    // 测试环境 LOCAL_APP_VERSION_CODE 通常为 0
    const peerCode = LOCAL_APP_VERSION_CODE + 5;
    recordPeerVersion('192.168.1.10', {
      appVersion: '0.9.5',
      versionCode: peerCode,
    });

    const update = getAvailableUpdate();
    expect(update).not.toBeNull();
    expect(update?.version).toBe('0.9.5');
    expect(update?.versionCode).toBe(peerCode);
    expect(update?.peerHost).toBe('192.168.1.10');
    expect(update?.peerPort).toBe(38473);
    expect(update?.discoveredAt).toBeGreaterThan(0);
  });

  it('does not overwrite when same peer + same version already recorded', () => {
    const peerCode = LOCAL_APP_VERSION_CODE + 5;
    recordPeerVersion('192.168.1.10', {
      appVersion: '0.9.5',
      versionCode: peerCode,
    });
    const first = getAvailableUpdate();
    expect(first).not.toBeNull();

    // 同一个 peer 又同步了一次，版本相同——保留首次发现时间
    recordPeerVersion('192.168.1.10', {
      appVersion: '0.9.5',
      versionCode: peerCode,
    });
    const second = getAvailableUpdate();
    expect(second).not.toBeNull();
    expect(second?.discoveredAt).toBe(first?.discoveredAt);
  });

  it('overwrites when a different peer offers a newer version', () => {
    recordPeerVersion('192.168.1.10', {
      appVersion: '0.9.5',
      versionCode: LOCAL_APP_VERSION_CODE + 5,
    });
    recordPeerVersion('192.168.1.20', {
      appVersion: '0.9.6',
      versionCode: LOCAL_APP_VERSION_CODE + 6,
    });

    const update = getAvailableUpdate();
    expect(update?.version).toBe('0.9.6');
    expect(update?.peerHost).toBe('192.168.1.20');
  });

  it('clearAvailableUpdate removes the recorded update', () => {
    recordPeerVersion('192.168.1.10', {
      appVersion: '0.9.5',
      versionCode: LOCAL_APP_VERSION_CODE + 5,
    });
    expect(getAvailableUpdate()).not.toBeNull();
    clearAvailableUpdate();
    expect(getAvailableUpdate()).toBeNull();
  });

  it('returns null when stored value is corrupted', () => {
    memoryLocalStorage.setItem('medbox.lan-sync.available-update.v1', '{not json');
    expect(getAvailableUpdate()).toBeNull();
  });

  it('returns null when stored value is missing required fields', () => {
    memoryLocalStorage.setItem(
      'medbox.lan-sync.available-update.v1',
      JSON.stringify({ version: '0.9.5' }), // 缺 versionCode/peerHost/peerPort/discoveredAt
    );
    expect(getAvailableUpdate()).toBeNull();
  });
});
