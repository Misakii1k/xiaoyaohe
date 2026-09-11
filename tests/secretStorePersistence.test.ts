// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ native: false }));
const secureStorage = vi.hoisted(() => ({
  setKeyPrefix: vi.fn<() => Promise<void>>(),
  setDefaultKeychainAccess: vi.fn<() => Promise<void>>(),
  get: vi.fn<(key: string) => Promise<string | null>>(),
  set: vi.fn<() => Promise<void>>(),
  remove: vi.fn<() => Promise<boolean>>(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => platform.native },
}));

vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: secureStorage,
  KeychainAccess: { whenUnlockedThisDeviceOnly: 1 },
}));

describe('secretStore persistence', () => {
  beforeEach(() => {
    platform.native = false;
    localStorage.clear();
    sessionStorage.clear();
    secureStorage.setKeyPrefix.mockReset().mockResolvedValue(undefined);
    secureStorage.setDefaultKeychainAccess.mockReset().mockResolvedValue(undefined);
    secureStorage.get.mockReset().mockResolvedValue(null);
    secureStorage.set.mockReset().mockResolvedValue(undefined);
    secureStorage.remove.mockReset().mockResolvedValue(true);
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('moves every known web secret between device and session storage', async () => {
    const store = await import('../src/ai/secretStore');
    await store.setSessionSecret(' llm-key ');

    await store.setWebSecretPersistence('session');

    expect(store.getWebSecretPersistence()).toBe('session');
    expect(localStorage.getItem('medbox_web_secret::ai-api-key')).toBeNull();
    expect(sessionStorage.getItem('medbox_web_secret::ai-api-key')).toBe('llm-key');

    await store.setWebSecretPersistence('device');

    expect(store.getWebSecretPersistence()).toBe('device');
    expect(sessionStorage.getItem('medbox_web_secret::ai-api-key')).toBeNull();
    expect(localStorage.getItem('medbox_web_secret::ai-api-key')).toBe('llm-key');
  });

  it('keeps the source copy and mode when the migration target rejects a key', async () => {
    const store = await import('../src/ai/secretStore');
    await store.setSessionSecret('persisted-key');
    const originalSetItem = sessionStorage.setItem.bind(sessionStorage);
    const setItem = vi.spyOn(sessionStorage, 'setItem').mockImplementation((key, value) => {
      if (key === 'medbox_web_secret::ai-api-key') throw new DOMException('blocked');
      originalSetItem(key, value);
    });

    await expect(store.setWebSecretPersistence('session')).rejects.toMatchObject({
      name: 'SecretStoreError',
      code: 'migration-failed',
    });

    expect(store.getWebSecretPersistence()).toBe('device');
    expect(localStorage.getItem('medbox_web_secret::ai-api-key')).toBe('persisted-key');
    expect(sessionStorage.getItem('medbox_web_secret::ai-api-key')).toBeNull();
    setItem.mockRestore();
  });

  it('uses an in-memory preference only when localStorage cannot persist it', async () => {
    localStorage.setItem('medbox.web-secret-persistence.v1', 'device');
    const store = await import('../src/ai/secretStore');
    await store.setSessionSecret('temporary-key');
    const originalSetItem = localStorage.setItem.bind(localStorage);
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === 'medbox.web-secret-persistence.v1') throw new DOMException('blocked');
      originalSetItem(key, value);
    });

    await store.setWebSecretPersistence('session');

    expect(store.getWebSecretPersistence()).toBe('session');
    expect(sessionStorage.getItem('medbox.web-secret-persistence.v1')).toBe('session');
    expect(sessionStorage.getItem('medbox_web_secret::ai-api-key')).toBe('temporary-key');
    expect(localStorage.getItem('medbox_web_secret::ai-api-key')).toBeNull();

    vi.resetModules();
    const reloaded = await import('../src/ai/secretStore');
    await reloaded.initializeSecretStore();
    expect(reloaded.getWebSecretPersistence()).toBe('session');
    expect(reloaded.getSessionSecret()).toBe('temporary-key');
    setItem.mockRestore();
  });

  it('keeps a session fallback ahead of an older readable device preference after reload', async () => {
    localStorage.setItem('medbox.web-secret-persistence.v1', 'device');
    const store = await import('../src/ai/secretStore');
    await store.setSessionSecret('temporary-key');
    const originalSetItem = localStorage.setItem.bind(localStorage);
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === 'medbox.web-secret-persistence.v1') throw new DOMException('blocked');
      originalSetItem(key, value);
    });

    await store.setWebSecretPersistence('session');
    expect(localStorage.getItem('medbox.web-secret-persistence.v1')).toBe('device');
    expect(sessionStorage.getItem('medbox.web-secret-persistence.v1')).toBe('session');

    vi.resetModules();
    const reloaded = await import('../src/ai/secretStore');
    await reloaded.initializeSecretStore();
    expect(reloaded.getWebSecretPersistence()).toBe('session');
    expect(reloaded.getSessionSecret()).toBe('temporary-key');
    setItem.mockRestore();
  });

  it('re-reads a newer shared device value before moving secrets to the current session', async () => {
    const store = await import('../src/ai/secretStore');
    await store.setSessionSecret('stale-key');
    // 模拟另一标签页已在共享 localStorage 提交了新组合，而当前模块内存仍是旧值。
    localStorage.setItem('medbox_web_secret::ai-api-key', 'newer-key');

    await store.setWebSecretPersistence('session');

    expect(store.getSessionSecret()).toBe('newer-key');
    expect(sessionStorage.getItem('medbox_web_secret::ai-api-key')).toBe('newer-key');
    expect(localStorage.getItem('medbox_web_secret::ai-api-key')).toBeNull();
  });

  it('can switch to session storage when localStorage rejects every write', async () => {
    const store = await import('../src/ai/secretStore');
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked');
    });

    await store.setWebSecretPersistence('session');
    await store.setSessionSecret('session-key');

    expect(store.getWebSecretPersistence()).toBe('session');
    expect(sessionStorage.getItem('medbox.web-secret-persistence.v1')).toBe('session');
    expect(sessionStorage.getItem('medbox_web_secret::ai-api-key')).toBe('session-key');
    setItem.mockRestore();
  });

  it('fails closed when a legacy key has no valid provider endpoint', async () => {
    localStorage.setItem('medbox.llmConfig.v1', JSON.stringify({
      baseUrl: 'http://old-provider.example.com/v1',
      apiKey: 'provider-secret',
      model: 'legacy-model',
    }));
    const llm = await import('../src/ai/llmConfig');

    await llm.initializeLlmSecretStore();

    expect(llm.getLlmConfig()).toEqual({
      ...llm.DEFAULT_LLM_CONFIG,
      model: 'legacy-model',
    });
    expect(llm.getLlmConfig().apiKey).toBe('');
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
    expect(secureStorage.get).toHaveBeenCalledTimes(4);
  });

  it('retries native initialization after secure storage temporarily fails', async () => {
    platform.native = true;
    const failure = new Error('secure storage unavailable');
    secureStorage.setKeyPrefix.mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const store = await import('../src/ai/secretStore');

    await expect(store.initializeSecretStore()).rejects.toMatchObject({
      code: 'initialization-failed',
      cause: failure,
    });
    await expect(store.initializeSecretStore()).resolves.toBeUndefined();

    expect(secureStorage.setKeyPrefix).toHaveBeenCalledTimes(2);
    expect(secureStorage.get).toHaveBeenCalledTimes(4);
  });

  it('does not commit a partial native read when one key fails', async () => {
    platform.native = true;
    const failure = new Error('keychain temporarily locked');
    secureStorage.get
      .mockResolvedValueOnce('legacy-key')
      .mockRejectedValueOnce(failure);
    const store = await import('../src/ai/secretStore');

    await expect(store.initializeSecretStore()).rejects.toMatchObject({
      code: 'initialization-failed',
      cause: failure,
    });

    expect(store.getSessionSecret()).toBe('');
    expect(store.getSessionSecret(store.LLM_CONFIG_SECRET_KEY)).toBe('');
  });

  it('wraps native write errors without logging or exposing raw messages', async () => {
    platform.native = true;
    const store = await import('../src/ai/secretStore');
    await store.initializeSecretStore();
    const failure = new Error('sensitive native details');
    secureStorage.set.mockRejectedValue(failure);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(store.setSessionSecret('new-key')).rejects.toMatchObject({
      code: 'write-failed',
      message: '系统安全存储写入失败，请重试',
      cause: failure,
    });

    expect(store.getSessionSecret()).toBe('');
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the old LLM endpoint and key together when a save or reset fails', async () => {
    platform.native = true;
    const previous = JSON.stringify({
      baseUrl: 'https://old.example.com/v1',
      apiKey: 'old-key',
      model: 'old-model',
    });
    const store = await import('../src/ai/secretStore');
    secureStorage.get.mockImplementation(async (key) => key === store.LLM_CONFIG_SECRET_KEY ? previous : null);
    await store.initializeSecretStore();
    const llm = await import('../src/ai/llmConfig');
    secureStorage.set.mockRejectedValue(new Error('write blocked'));

    await expect(llm.setLlmConfig({
      baseUrl: 'https://new.example.com/v1',
      apiKey: 'new-key',
      model: 'new-model',
    })).rejects.toMatchObject({ code: 'write-failed' });
    expect(llm.getLlmConfig()).toEqual({
      baseUrl: 'https://old.example.com/v1',
      apiKey: 'old-key',
      model: 'old-model',
    });

    await expect(llm.resetLlmConfig()).rejects.toMatchObject({ code: 'write-failed' });
    expect(llm.getLlmConfig().apiKey).toBe('old-key');
    expect(llm.getLlmConfig().baseUrl).toBe('https://old.example.com/v1');
  });

  it('propagates native removal failures without clearing memory', async () => {
    platform.native = true;
    secureStorage.get.mockImplementation(async (key) => key === 'ai-api-key' ? 'native-key' : null);
    const store = await import('../src/ai/secretStore');
    await store.initializeSecretStore();
    const failure = new Error('secure storage removal failed');
    secureStorage.remove.mockRejectedValue(failure);

    await expect(store.clearSessionSecret()).rejects.toMatchObject({
      code: 'remove-failed',
      cause: failure,
    });
    expect(store.getSessionSecret()).toBe('native-key');
  });

  it('uses device-only secure storage on native platforms without web persistence', async () => {
    platform.native = true;
    secureStorage.get.mockImplementation(async (key) => key === 'ai-api-key' ? 'native-key' : null);
    const store = await import('../src/ai/secretStore');

    await store.initializeSecretStore();
    expect(store.getSessionSecret()).toBe('native-key');
    expect(secureStorage.setKeyPrefix).toHaveBeenCalledWith('medbox_');
    expect(secureStorage.setDefaultKeychainAccess).toHaveBeenCalledWith(1);

    await expect(store.setSessionSecret('new-native-key')).resolves.toBeUndefined();
    expect(secureStorage.set).toHaveBeenCalledWith(
      'ai-api-key',
      'new-native-key',
      false,
      false,
      1,
    );
    expect(localStorage.getItem('medbox_web_secret::ai-api-key')).toBeNull();
    expect(sessionStorage.getItem('medbox_web_secret::ai-api-key')).toBeNull();
  });
});
