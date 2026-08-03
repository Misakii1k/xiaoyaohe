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

describe('LLM multi-provider routing config', () => {
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

  it('stores multiple providers with an active id and failover order', async () => {
    const llm = await import('../src/ai/llmConfig');
    await llm.initializeLlmSecretStore();

    await llm.setLlmProviderSet({
      providers: [
        { id: 'agnes', label: 'Agnes', baseUrl: 'https://apihub.agnes-ai.com/v1', apiKey: 'key-a', model: 'gpt-4o-mini' },
        { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'key-b', model: 'deepseek-chat' },
      ],
      activeId: 'deepseek',
      failover: true,
    });

    expect(llm.getLlmProviderSet().providers).toHaveLength(2);
    expect(llm.getLlmProviderSet().activeId).toBe('deepseek');
    expect(llm.getLlmConfig()).toEqual({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'key-b',
      model: 'deepseek-chat',
    });
    // 列表顺序即故障转移优先级：当前供应商在前，其余按保存顺序。
    expect(llm.getLlmRouteCandidates().map((p) => p.id)).toEqual(['deepseek', 'agnes']);
  });

  it('returns only the active provider when failover is disabled', async () => {
    const llm = await import('../src/ai/llmConfig');
    await llm.initializeLlmSecretStore();

    await llm.setLlmProviderSet({
      providers: [
        { id: 'a', label: 'A', baseUrl: 'https://a.example.com/v1', apiKey: 'k1', model: 'm1' },
        { id: 'b', label: 'B', baseUrl: 'https://b.example.com/v1', apiKey: 'k2', model: 'm2' },
      ],
      activeId: 'a',
      failover: false,
    });

    expect(llm.getLlmRouteCandidates().map((p) => p.id)).toEqual(['a']);
  });

  it('skips providers without keys when building failover candidates', async () => {
    const llm = await import('../src/ai/llmConfig');
    await llm.initializeLlmSecretStore();

    await llm.setLlmProviderSet({
      providers: [
        { id: 'a', label: 'A', baseUrl: 'https://a.example.com/v1', apiKey: 'k1', model: 'm1' },
        { id: 'b', label: 'B', baseUrl: 'https://b.example.com/v1', apiKey: '', model: 'm2' },
        { id: 'c', label: 'C', baseUrl: 'https://c.example.com/v1', apiKey: 'k3', model: 'm3' },
      ],
      activeId: 'a',
      failover: true,
    });

    expect(llm.getLlmRouteCandidates().map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('keeps per-provider health records and prunes removed providers', async () => {
    const llm = await import('../src/ai/llmConfig');
    await llm.initializeLlmSecretStore();
    await llm.setLlmProviderSet({
      providers: [
        { id: 'a', label: 'A', baseUrl: 'https://a.example.com/v1', apiKey: 'k1', model: 'm1' },
        { id: 'b', label: 'B', baseUrl: 'https://b.example.com/v1', apiKey: 'k2', model: 'm2' },
      ],
      activeId: 'a',
      failover: true,
    });

    llm.setLlmHealth({ state: 'ok', message: 'A ok', at: 1 }, 'a');
    llm.setLlmHealth({ state: 'error', message: 'B down', at: 2 }, 'b');

    expect(llm.getLlmHealth('a').state).toBe('ok');
    expect(llm.getLlmHealth('b').state).toBe('error');

    // 删除 B 后它的体检记录一并清理，避免无限堆积。
    await llm.setLlmProviderSet({
      providers: [
        { id: 'a', label: 'A', baseUrl: 'https://a.example.com/v1', apiKey: 'k1', model: 'm1' },
      ],
      activeId: 'a',
      failover: true,
    });
    expect(llm.getLlmHealth('b').state).toBe('unknown');
  });

  it('migrates a legacy single-provider record into the provider set', async () => {
    const llm = await import('../src/ai/llmConfig');
    await llm.initializeLlmSecretStore();

    await llm.setLlmConfig({
      baseUrl: 'https://old.example.com/v1',
      apiKey: 'old-key',
      model: 'old-model',
    });

    const set = llm.getLlmProviderSet();
    expect(set.providers).toHaveLength(1);
    expect(set.providers[0]).toMatchObject({
      baseUrl: 'https://old.example.com/v1',
      apiKey: 'old-key',
      model: 'old-model',
    });
    expect(set.activeId).toBe(set.providers[0]!.id);
    expect(set.failover).toBe(true);
  });

  it('rejects an empty provider list without touching stored secrets', async () => {
    const llm = await import('../src/ai/llmConfig');
    await llm.initializeLlmSecretStore();
    await llm.setLlmProviderSet({
      providers: [
        { id: 'a', label: 'A', baseUrl: 'https://a.example.com/v1', apiKey: 'k1', model: 'm1' },
      ],
      activeId: 'a',
      failover: true,
    });

    await expect(llm.setLlmProviderSet({ providers: [], activeId: '', failover: true }))
      .rejects.toThrow('至少要保留一家 AI 服务商');
    expect(llm.getLlmProviderSet().providers).toHaveLength(1);
  });
});
