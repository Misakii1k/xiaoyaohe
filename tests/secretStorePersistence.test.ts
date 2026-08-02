// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ native: false }));
const secureStorage = vi.hoisted(() => ({
  setKeyPrefix: vi.fn(async () => undefined),
  setDefaultKeychainAccess: vi.fn(async () => undefined),
  get: vi.fn(async () => ''),
  set: vi.fn(async () => true),
  remove: vi.fn(async () => true),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => platform.native },
}));

vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: secureStorage,
  KeychainAccess: { whenUnlockedThisDeviceOnly: 'when-unlocked-this-device-only' },
}));

describe('secretStore persistence', () => {
  beforeEach(() => {
    platform.native = false;
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('moves every known web secret between device and session storage', async () => {
    const store = await import('../src/ai/secretStore');
    await store.setSessionSecret(' llm-key ');
    await store.setSessionSecret(' asr-id ', store.ASR_SECRET_ID_KEY);
    await store.setSessionSecret(' asr-key ', store.ASR_SECRET_KEY_KEY);

    store.setWebSecretPersistence('session');

    expect(store.getWebSecretPersistence()).toBe('session');
    expect(localStorage.getItem('medbox_web_secret::ai-api-key')).toBeNull();
    expect(sessionStorage.getItem('medbox_web_secret::ai-api-key')).toBe('llm-key');
    expect(sessionStorage.getItem('medbox_web_secret::ai-asr-secret-id')).toBe('asr-id');
    expect(sessionStorage.getItem('medbox_web_secret::ai-asr-secret-key')).toBe('asr-key');

    store.setWebSecretPersistence('device');

    expect(store.getWebSecretPersistence()).toBe('device');
    expect(sessionStorage.getItem('medbox_web_secret::ai-api-key')).toBeNull();
    expect(localStorage.getItem('medbox_web_secret::ai-api-key')).toBe('llm-key');
  });

  it('honors a session choice when localStorage cannot persist the preference', async () => {
    const store = await import('../src/ai/secretStore');
    await store.setSessionSecret('temporary-key');
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (this === localStorage && key === 'medbox.web-secret-persistence.v1') {
        throw new DOMException('blocked');
      }
      return Reflect.apply(Storage.prototype.setItem, this, [key, value]);
    });

    store.setWebSecretPersistence('session');

    expect(store.getWebSecretPersistence()).toBe('session');
    expect(sessionStorage.getItem('medbox_web_secret::ai-api-key')).toBe('temporary-key');
    expect(localStorage.getItem('medbox_web_secret::ai-api-key')).toBeNull();
    setItem.mockRestore();
  });

  it('uses device-only secure storage on native platforms without web persistence', async () => {
    platform.native = true;
    secureStorage.get.mockImplementation(async (key: string) => key === 'ai-api-key' ? 'native-key' : '');
    const store = await import('../src/ai/secretStore');

    await store.initializeSecretStore();
    expect(store.getSessionSecret()).toBe('native-key');
    expect(secureStorage.setKeyPrefix).toHaveBeenCalledWith('medbox_');
    expect(secureStorage.setDefaultKeychainAccess).toHaveBeenCalledWith('when-unlocked-this-device-only');

    await expect(store.setSessionSecret('new-native-key')).resolves.toBe(true);
    expect(secureStorage.set).toHaveBeenCalledWith(
      'ai-api-key',
      'new-native-key',
      false,
      false,
      'when-unlocked-this-device-only',
    );
    expect(localStorage.getItem('medbox_web_secret::ai-api-key')).toBeNull();
    expect(sessionStorage.getItem('medbox_web_secret::ai-api-key')).toBeNull();
  });
});
