// LLM 配置（OpenAI 兼容 endpoint），支持保存多家供应商并按优先级路由
// 用于"自然语言填表"、拍照识药和小助手对话
//
// 地址、模型和密钥作为一条记录提交，避免保存失败时把旧密钥发给新地址。
// 多家供应商同理整组提交：列表顺序即故障转移优先级，activeId 是当前默认。
import {
  clearSessionSecret,
  getSessionSecret,
  initializeSecretStore,
  LLM_CONFIG_SECRET_KEY,
  setSessionSecret,
} from './secretStore';

const LEGACY_LS_KEY = 'medbox.llmConfig.v1';
const LEGACY_HEALTH_KEY = 'medbox.llmHealth.v1';
const LS_HEALTH_KEY = 'medbox.llmHealth.v2';
const SILENT_CHECK_INTERVAL_MS = 10 * 60 * 1000;
/** 列表既是优先级也是外发白名单，保持在用户能一眼看完的规模。 */
export const MAX_LLM_PROVIDERS = 8;
let lastSilentCheckAt = 0;
let configMutation: Promise<void> = Promise.resolve();

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** 一家供应商：在 LlmConfig 之上加稳定 id 和用户可读的名字。 */
export interface LlmProvider extends LlmConfig {
  id: string;
  label: string;
}

/** 供应商全集；providers 的数组顺序就是故障转移顺序。 */
export interface LlmProviderSet {
  providers: LlmProvider[];
  activeId: string;
  /** 当前供应商失败时是否自动顺延到下一家。 */
  failover: boolean;
}

export interface LlmHealth {
  state: 'ok' | 'error' | 'unknown';
  message: string;
  at: number;
  /** 体检时拉到的模型列表（用于下拉框） */
  models?: string[];
}

/** 默认配置（apiKey 留空，用户必须在「设置」填自己的密钥） */
export const DEFAULT_LLM_CONFIG: LlmConfig = {
  baseUrl: 'https://apihub.agnes-ai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
};

const DEFAULT_PROVIDER_ID = 'default';
const DEFAULT_PROVIDER_LABEL = '默认服务商';

function defaultProviderSet(): LlmProviderSet {
  return {
    providers: [{ id: DEFAULT_PROVIDER_ID, label: DEFAULT_PROVIDER_LABEL, ...DEFAULT_LLM_CONFIG }],
    activeId: DEFAULT_PROVIDER_ID,
    failover: true,
  };
}

export function initializeLlmSecretStore(): Promise<void> {
  return serializeConfigMutation(async () => {
    await initializeSecretStore();
    if (getSessionSecret(LLM_CONFIG_SECRET_KEY)) {
      cleanupLegacyLlmConfig();
      await cleanupLegacyLlmSecret();
      return;
    }

    const migrated = buildLegacyLlmConfig(readLegacyLlmConfig());
    await setSessionSecret(JSON.stringify(toProviderSet(migrated)), LLM_CONFIG_SECRET_KEY);
    cleanupLegacyLlmConfig();
    await cleanupLegacyLlmSecret();
  });
}

/** 全部供应商 + 当前选择；损坏或缺失时回落到只含默认服务商的集合。 */
export function getLlmProviderSet(): LlmProviderSet {
  const stored = getSessionSecret(LLM_CONFIG_SECRET_KEY);
  if (stored) return parseStoredProviderSet(stored);

  // 启动迁移完成前短暂兼容旧版；新版一旦写入组合记录便永远以它为准。
  return toProviderSet(buildLegacyLlmConfig(readLegacyLlmConfig()));
}

/** 当前默认供应商的配置；老调用方按单供应商语义继续可用。 */
export function getLlmConfig(): LlmConfig {
  const provider = getActiveLlmProvider();
  return { baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: provider.model };
}

export function getActiveLlmProvider(): LlmProvider {
  const set = getLlmProviderSet();
  return set.providers.find((item) => item.id === set.activeId) ?? set.providers[0]!;
}

/**
 * 故障转移候选：当前供应商在最前，其后按列表顺序补齐其它已填密钥的供应商。
 * failover 关闭时只返回当前供应商，绝不把数据外发到用户没选的服务商。
 */
export function getLlmRouteCandidates(): LlmProvider[] {
  const set = getLlmProviderSet();
  const active = set.providers.find((item) => item.id === set.activeId) ?? set.providers[0]!;
  const usable = (provider: LlmProvider): boolean => Boolean(provider.baseUrl && provider.apiKey);
  if (!set.failover) return usable(active) ? [active] : [];
  return [active, ...set.providers.filter((item) => item.id !== active.id)].filter(usable);
}

export function setLlmConfig(cfg: LlmConfig): Promise<void> {
  const set = getLlmProviderSet();
  const activeId = set.providers.some((item) => item.id === set.activeId)
    ? set.activeId
    : set.providers[0]?.id ?? DEFAULT_PROVIDER_ID;
  const next = normalizeProvider({
    ...(set.providers.find((item) => item.id === activeId) ?? { id: activeId, label: DEFAULT_PROVIDER_LABEL }),
    ...cfg,
  });
  return setLlmProviderSet({
    ...set,
    activeId: next.id,
    providers: set.providers.some((item) => item.id === next.id)
      ? set.providers.map((item) => (item.id === next.id ? next : item))
      : [...set.providers, next],
  });
}

/** 整组提交供应商列表；地址非法或列表为空时整笔拒绝，不留下半套配置。 */
export async function setLlmProviderSet(set: LlmProviderSet): Promise<void> {
  const providers = set.providers.map(normalizeProvider);
  if (providers.length === 0) throw new Error('至少要保留一家 AI 服务商');
  if (providers.length > MAX_LLM_PROVIDERS) throw new Error(`最多保存 ${MAX_LLM_PROVIDERS} 家 AI 服务商`);
  const ids = new Set(providers.map((item) => item.id));
  if (ids.size !== providers.length) throw new Error('服务商标识重复');
  const next: LlmProviderSet = {
    providers,
    activeId: ids.has(set.activeId) ? set.activeId : providers[0]!.id,
    failover: set.failover !== false,
  };
  await serializeConfigMutation(async () => {
    await setSessionSecret(JSON.stringify(next), LLM_CONFIG_SECRET_KEY);
    // 删除服务商后立即清理它的体检记录，避免旧状态在列表里复活。
    pruneHealthRecords(providers.map((item) => item.id));
    cleanupLegacyLlmConfig();
    await cleanupLegacyLlmSecret();
  });
}

export function createLlmProviderId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ?? `provider-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isUsingDefaultKey(): boolean {
  return !getLlmConfig().apiKey;
}

export function resetLlmConfig(): Promise<void> {
  return serializeConfigMutation(async () => {
    // 写入一个权威的空配置，而不是先删元数据再删密钥；失败时旧组合完整保留。
    await setSessionSecret(JSON.stringify(defaultProviderSet()), LLM_CONFIG_SECRET_KEY);
    cleanupLegacyLlmConfig();
    await cleanupLegacyLlmSecret();
  });
}

export function normalizeAndValidateBaseUrl(value: string): string {
  const url = new URL(value.trim());
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !(import.meta.env.DEV && local)) {
    throw new Error('生产环境只允许 HTTPS AI 地址');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('AI 地址不能包含账号密码、查询参数或片段');
  }
  return url.toString().replace(/\/$/, '');
}

/** 拉模型列表（用于下拉自动检测）。失败抛错。 */
export async function listModels(cfg: LlmConfig): Promise<string[]> {
  const baseUrl = normalizeAndValidateBaseUrl(cfg.baseUrl);
  const r = await fetch(baseUrl + '/models', {
    method: 'GET',
    headers: { authorization: 'Bearer ' + cfg.apiKey },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) {
    const d = (await r.json().catch(() => ({}))) as any;
    throw new Error(d?.error?.message || `服务返回 ${r.status}`);
  }
  const data = (await r.json()) as { data?: { id: string }[] };
  const ids = (data.data || [])
    .map((m) => m.id)
    .filter((id) => typeof id === 'string' && id.length > 0);
  // 去重并按字母序
  return [...new Set(ids)].sort();
}

/** 静默体检：拉一次模型列表当作活性检测，比 chat 调用便宜。 */
export async function pingLlm(cfg?: LlmConfig): Promise<LlmHealth> {
  const c = cfg || getLlmConfig();
  const now = Date.now();
  if (!c.baseUrl || !c.apiKey) {
    return { state: 'error', message: '未配置 API 地址或密钥', at: now };
  }
  try {
    const models = await listModels(c);
    return {
      state: 'ok',
      message: models.length > 0 ? `已连接 · ${models.length} 个模型` : '已连接',
      at: now,
      models,
    };
  } catch (e) {
    return { state: 'error', message: String(e instanceof Error ? e.message : e), at: now };
  }
}

/** 每家供应商单独记录体检结果，切换时不会读到别人的模型列表。 */
export function getLlmHealth(providerId: string = getLlmProviderSet().activeId): LlmHealth {
  const unknown: LlmHealth = { state: 'unknown', message: '未检测', at: 0 };
  try {
    const raw = localStorage.getItem(LS_HEALTH_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, LlmHealth>;
      const entry = parsed && typeof parsed === 'object' ? parsed[providerId] : undefined;
      return entry && typeof entry.state === 'string' ? entry : unknown;
    }
    // 旧版只存一条记录；迁移期把它算作当前供应商的历史结果。
    const legacy = localStorage.getItem(LEGACY_HEALTH_KEY);
    if (!legacy) return unknown;
    return providerId === getLlmProviderSet().activeId ? JSON.parse(legacy) as LlmHealth : unknown;
  } catch {
    return unknown;
  }
}

export function setLlmHealth(h: LlmHealth, providerId: string = getLlmProviderSet().activeId): void {
  try {
    const raw = localStorage.getItem(LS_HEALTH_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, LlmHealth> : {};
    const map = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    const known = new Set(getLlmProviderSet().providers.map((item) => item.id));
    known.add(providerId);
    const next = Object.fromEntries(
      Object.entries({ ...map, [providerId]: h }).filter(([id]) => known.has(id)),
    );
    localStorage.setItem(LS_HEALTH_KEY, JSON.stringify(next));
    localStorage.removeItem(LEGACY_HEALTH_KEY);
  } catch {
    /* localStorage 满了就算了 */
  }
}

/** 只保留仍存在的供应商的体检记录；删除服务商后调用，避免旧状态复活。 */
function pruneHealthRecords(providerIds: readonly string[]): void {
  try {
    const raw = localStorage.getItem(LS_HEALTH_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, LlmHealth>;
    const map = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    const keep = new Set(providerIds);
    const next = Object.fromEntries(Object.entries(map).filter(([id]) => keep.has(id)));
    localStorage.setItem(LS_HEALTH_KEY, JSON.stringify(next));
  } catch {
    /* 清理失败不阻塞配置保存 */
  }
}

/** 启动时调一次，把结果存起来；不抛错，不阻塞渲染。10 分钟内不重复检测。 */
export async function silentHealthCheck(): Promise<LlmHealth> {
  const now = Date.now();
  const activeId = getLlmProviderSet().activeId;
  if (now - lastSilentCheckAt < SILENT_CHECK_INTERVAL_MS) {
    const cached = getLlmHealth(activeId);
    if (cached.state !== 'unknown') return cached;
  }
  lastSilentCheckAt = now;
  const h = await pingLlm();
  setLlmHealth(h, activeId);
  // 让 UI 监听者知道
  window.dispatchEvent(new CustomEvent('medbox:llm-health', { detail: h }));
  return h;
}

function serializeConfigMutation(operation: () => Promise<void>): Promise<void> {
  const result = configMutation.then(operation, operation);
  configMutation = result.catch(() => undefined);
  return result;
}

function normalizeProvider(provider: Partial<LlmProvider>): LlmProvider {
  const id = provider.id?.trim() || createLlmProviderId();
  const baseUrl = normalizeAndValidateBaseUrl(provider.baseUrl ?? '');
  return {
    id,
    label: provider.label?.trim().slice(0, 40) || hostLabel(baseUrl),
    baseUrl,
    apiKey: provider.apiKey?.trim() ?? '',
    model: provider.model?.trim() || DEFAULT_LLM_CONFIG.model,
  };
}

function hostLabel(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return DEFAULT_PROVIDER_LABEL;
  }
}

function toProviderSet(cfg: LlmConfig): LlmProviderSet {
  return {
    providers: [{ id: DEFAULT_PROVIDER_ID, label: hostLabel(cfg.baseUrl), ...cfg }],
    activeId: DEFAULT_PROVIDER_ID,
    failover: true,
  };
}

function parseStoredProviderSet(raw: string): LlmProviderSet {
  try {
    const parsed = JSON.parse(raw) as Partial<LlmProviderSet> & Partial<LlmConfig>;
    // v1 记录是单个 {baseUrl, apiKey, model}；读到时按单供应商解释，不丢用户密钥。
    if (!Array.isArray(parsed.providers)) return toProviderSet(parseStoredLlmConfig(parsed));
    const providers = parsed.providers
      .slice(0, MAX_LLM_PROVIDERS)
      .flatMap((item) => {
        try {
          return [normalizeProvider(item)];
        } catch {
          // 单家地址损坏只丢这一家，其余供应商仍然可用。
          return [];
        }
      });
    if (providers.length === 0) return defaultProviderSet();
    const seen = new Set<string>();
    const unique = providers.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
    return {
      providers: unique,
      activeId: unique.some((item) => item.id === parsed.activeId) ? parsed.activeId! : unique[0]!.id,
      failover: parsed.failover !== false,
    };
  } catch {
    // 权威记录损坏时整组失败关闭，不把旧密钥改配到默认服务商。
    return defaultProviderSet();
  }
}

function parseStoredLlmConfig(parsed: Partial<LlmConfig>): LlmConfig {
  try {
    if (typeof parsed.baseUrl !== 'string' || !parsed.baseUrl.trim()) throw new Error('Invalid base URL');
    return {
      baseUrl: normalizeAndValidateBaseUrl(parsed.baseUrl),
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '',
      model: parsed.model?.trim() || DEFAULT_LLM_CONFIG.model,
    };
  } catch {
    return { ...DEFAULT_LLM_CONFIG };
  }
}

function readLegacyLlmConfig(): Partial<LlmConfig> {
  try {
    const raw = localStorage.getItem(LEGACY_LS_KEY);
    return raw ? JSON.parse(raw) as Partial<LlmConfig> : {};
  } catch {
    return {};
  }
}

function cleanupLegacyLlmConfig(): void {
  try { localStorage.removeItem(LEGACY_LS_KEY); } catch { /* authoritative record is already committed */ }
}

async function cleanupLegacyLlmSecret(): Promise<void> {
  if (!getSessionSecret()) return;
  try {
    await clearSessionSecret();
  } catch {
    // 组合记录已成为唯一权威值；下次启动会继续清理迁移残留。
  }
}

function buildLegacyLlmConfig(legacy: Partial<LlmConfig>): LlmConfig {
  const legacyKey = getSessionSecret() || legacy.apiKey?.trim() || '';
  const model = legacy.model?.trim() || DEFAULT_LLM_CONFIG.model;
  if (typeof legacy.baseUrl !== 'string' || !legacy.baseUrl.trim()) {
    // 没有旧端点时，旧密钥的服务商归属无法确认，不能默认发送给 Agnes。
    return { ...DEFAULT_LLM_CONFIG, model };
  }
  try {
    return {
      baseUrl: normalizeAndValidateBaseUrl(legacy.baseUrl),
      apiKey: legacyKey,
      model,
    };
  } catch {
    // 端点无效时整组失败关闭，避免"默认端点 + 旧服务商密钥"的危险重配对。
    return { ...DEFAULT_LLM_CONFIG, model };
  }
}
