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
    secureStorage.setKeyPrefix.mockReset().mockResolvedValue(undefined);
    secureStorage.setDefaultKeychainAccess.mockReset().mockResolvedValue(undefined);
    secureStorage.get.mockReset().mockResolvedValue('');
    secureStorage.set.mockReset().mockResolvedValue(true);
    secureStorage.remove.mockReset().mockResolvedValue(true);
    vi.resetModules();
  });

  it('moves every known web secret between device and session storage', async () => {
    const store = await import('../src/ai/secretStore');
    await store.setSessionSecret(' llm-key ');
    await store.setSessionSecret(' asr-id ', store.ASR_SECRET_ID_KEY);
    await store.setSessionSecret(' asr-key ', store.ASR_SECRET_KEY_KEY);

    await store.setWebSecretPersistence('session');

    expect(store.getWebSecretPersistence()).toBe('session');
    expect(localStorage.getItem('medbox_web_secret::ai-api-key')).toBeNull();
    expect(sessionStorage.getItem('medbox_web_secret::ai-api-key')).toBe('llm-key');
    expect(sessionStorage.getItem('medbox_web_secret::ai-asr-secret-id')).toBe('asr-id');
    expect(sessionStorage.getItem('medbox_web_secret::ai-asr-secret-key')).toBe('asr-key');

    await store.setWebSecretPersistence('device');

    expect(store.getWebSecretPersistence()).toBe('device');
    expect(sessionStorage.getItem('medbox_web_secret::ai-api-key')).toBeNull();
    expect(localStorage.getItem('medbox_web_secret::ai-api-key')).toBe('llm-key');
  });

  it('honors a session choice when localStorage cannot persist the preference', async () => {
    const store = await import('../src/ai/secretStore');
    await store.setSessionSecret('temporary-key');
    const originalSetItem = Storage.prototype.setItem;
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (this === localStorage && key === 'medbox.web-secret-persistence.v1') {
        throw new DOMException('blocked');
      }
      return Reflect.apply(originalSetItem, this, [key, value]);
    });

    await store.setWebSecretPersistence('session');

    expect(store.getWebSecretPersistence()).toBe('session');
    expect(sessionStorage.getItem('medbox_web_secret::ai-api-key')).toBe('temporary-key');
    expect(localStorage.getItem('medbox_web_secret::ai-api-key')).toBeNull();
    setItem.mockRestore();
  });

  it('shares one initialization promise across concurrent native callers', async () => {
    platform.native = true;
    let finishPrefix!: () => void;
    secureStorage.setKeyPrefix.mockImplementation(() => new Promise<void>((resolve) => {
      finishPrefix = resolve;
    }));
    const store = await import('../src/ai/secretStore');

    const first = store.initializeSecretStore();
    const second = store.initializeSecretStore();

    expect(second).toBe(first);
    expect(secureStorage.setKeyPrefix).toHaveBeenCalledTimes(1);
    expect(secureStorage.setDefaultKeychainAccess).not.toHaveBeenCalled();

    finishPrefix();
    await Promise.all([first, second]);
    expect(secureStorage.setDefaultKeychainAccess).toHaveBeenCalledTimes(1);
    expect(secureStorage.get).toHaveBeenCalledTimes(3);
  });

  it('retries native initialization after secure storage temporarily fails', async () => {
    platform.native = true;
    const failure = new Error('secure storage unavailable');
    secureStorage.setKeyPrefix.mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const store = await import('../src/ai/secretStore');

    await expect(store.initializeSecretStore()).rejects.toBe(failure);
    await expect(store.initializeSecretStore()).resolves.toBeUndefined();

    expect(secureStorage.setKeyPrefix).toHaveBeenCalledTimes(2);
    expect(secureStorage.get).toHaveBeenCalledTimes(3);
  });

  it('does not expose the raw native write error through console output', async () => {
    platform.native = true;
    const store = await import('../src/ai/secretStore');
    await store.initializeSecretStore();
    const failure = new Error('sensitive native details');
    secureStorage.set.mockRejectedValue(failure);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(store.setSessionSecret('new-key')).rejects.toBe(failure);

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('loads existing keys before switching when the preference write fails', async () => {
    localStorage.setItem('medbox_web_secret::ai-api-key', 'persisted-key');
    localStorage.setItem('medbox.web-secret-persistence.v1', 'device');
    const store = await import('../src/ai/secretStore');
    const originalSetItem = Storage.prototype.setItem;
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (this === localStorage && key === 'medbox.web-secret-persistence.v1') {
        throw new DOMException('blocked');
      }
      return Reflect.apply(originalSetItem, this, [key, value]);
    });

    await store.setWebSecretPersistence('session');

    expect(store.getWebSecretPersistence()).toBe('session');
    expect(store.getSessionSecret()).toBe('persisted-key');
    expect(sessionStorage.getItem('medbox_web_secret::ai-api-key')).toBe('persisted-key');
    expect(localStorage.getItem('medbox_web_secret::ai-api-key')).toBeNull();
    setItem.mockRestore();
  });

  it('propagates native secure storage write failures through config setters', async () => {
    platform.native = true;
    const store = await import('../src/ai/secretStore');
    await store.initializeSecretStore();
    const failure = new Error('secure storage unavailable');
    secureStorage.set.mockRejectedValue(failure);
    const { setLlmConfig } = await import('../src/ai/llmConfig');
    const { setAsrConfig } = await import('../src/ai/asrConfig');

    await expect(setLlmConfig({
      baseUrl: 'https://example.com/v1',
      apiKey: 'llm-key',
      model: 'test-model',
    })).rejects.toBe(failure);
    await expect(setAsrConfig({ secretId: 'asr-id' })).rejects.toBe(failure);
    expect(store.getSessionSecret()).toBe('');
    expect(store.getSessionSecret(store.ASR_SECRET_ID_KEY)).toBe('');
  });

  it('propagates native secure storage removal failures without clearing memory', async () => {
    platform.native = true;
    secureStorage.get.mockImplementation(async (key: string) => key === 'ai-api-key' ? 'native-key' : '');
    const store = await import('../src/ai/secretStore');
    await store.initializeSecretStore();
    const failure = new Error('secure storage removal failed');
    secureStorage.remove.mockRejectedValue(failure);

    await expect(store.clearSessionSecret()).rejects.toBe(failure);
    expect(store.getSessionSecret()).toBe('native-key');
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
