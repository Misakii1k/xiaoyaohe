// LLM 配置（OpenAI 兼容 endpoint）
// 用于"自然语言填表"功能：用户描述 → 结构化处方
//
// 地址、模型和密钥作为一条记录提交，避免保存失败时把旧密钥发给新地址。
import {
  clearSessionSecret,
  getSessionSecret,
  initializeSecretStore,
  LLM_CONFIG_SECRET_KEY,
  setSessionSecret,
} from './secretStore';

const LEGACY_LS_KEY = 'medbox.llmConfig.v1';
const LS_HEALTH_KEY = 'medbox.llmHealth.v1';
const SILENT_CHECK_INTERVAL_MS = 10 * 60 * 1000;
let lastSilentCheckAt = 0;
let configMutation: Promise<void> = Promise.resolve();

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
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

export function initializeLlmSecretStore(): Promise<void> {
  return serializeConfigMutation(async () => {
    await initializeSecretStore();
    if (getSessionSecret(LLM_CONFIG_SECRET_KEY)) {
      cleanupLegacyLlmConfig();
      await cleanupLegacyLlmSecret();
      return;
    }

    const legacy = readLegacyLlmConfig();
    const migrated: LlmConfig = {
      baseUrl: normalizeLegacyBaseUrl(legacy.baseUrl),
      apiKey: getSessionSecret() || legacy.apiKey?.trim() || '',
      model: legacy.model?.trim() || DEFAULT_LLM_CONFIG.model,
    };
    await setSessionSecret(JSON.stringify(migrated), LLM_CONFIG_SECRET_KEY);
    cleanupLegacyLlmConfig();
    await cleanupLegacyLlmSecret();
  });
}

export function getLlmConfig(): LlmConfig {
  const stored = getSessionSecret(LLM_CONFIG_SECRET_KEY);
  if (stored) return parseStoredLlmConfig(stored);

  // 启动迁移完成前短暂兼容旧版；新版一旦写入组合记录便永远以它为准。
  const legacy = readLegacyLlmConfig();
  return {
    baseUrl: normalizeLegacyBaseUrl(legacy.baseUrl),
    apiKey: getSessionSecret() || legacy.apiKey?.trim() || '',
    model: legacy.model?.trim() || DEFAULT_LLM_CONFIG.model,
  };
}

export function setLlmConfig(cfg: LlmConfig): Promise<void> {
  const next: LlmConfig = {
    baseUrl: normalizeAndValidateBaseUrl(cfg.baseUrl),
    apiKey: cfg.apiKey.trim(),
    model: cfg.model.trim() || DEFAULT_LLM_CONFIG.model,
  };
  return serializeConfigMutation(async () => {
    await setSessionSecret(JSON.stringify(next), LLM_CONFIG_SECRET_KEY);
    cleanupLegacyLlmConfig();
    await cleanupLegacyLlmSecret();
  });
}

export function isUsingDefaultKey(): boolean {
  return !getLlmConfig().apiKey;
}

export function resetLlmConfig(): Promise<void> {
  return serializeConfigMutation(async () => {
    // 写入一个权威的空配置，而不是先删元数据再删密钥；失败时旧组合完整保留。
    await setSessionSecret(JSON.stringify(DEFAULT_LLM_CONFIG), LLM_CONFIG_SECRET_KEY);
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

export function getLlmHealth(): LlmHealth {
  try {
    const raw = localStorage.getItem(LS_HEALTH_KEY);
    if (!raw) return { state: 'unknown', message: '未检测', at: 0 };
    return JSON.parse(raw) as LlmHealth;
  } catch {
    return { state: 'unknown', message: '未检测', at: 0 };
  }
}

export function setLlmHealth(h: LlmHealth): void {
  try {
    localStorage.setItem(LS_HEALTH_KEY, JSON.stringify(h));
  } catch {
    /* localStorage 满了就算了 */
  }
}

/** 启动时调一次，把结果存起来；不抛错，不阻塞渲染。10 分钟内不重复检测。 */
export async function silentHealthCheck(): Promise<LlmHealth> {
  const now = Date.now();
  if (now - lastSilentCheckAt < SILENT_CHECK_INTERVAL_MS) {
    const cached = getLlmHealth();
    if (cached.state !== 'unknown') return cached;
  }
  lastSilentCheckAt = now;
  const h = await pingLlm();
  setLlmHealth(h);
  // 让 UI 监听者知道
  window.dispatchEvent(new CustomEvent('medbox:llm-health', { detail: h }));
  return h;
}

function serializeConfigMutation(operation: () => Promise<void>): Promise<void> {
  const result = configMutation.then(operation, operation);
  configMutation = result.catch(() => undefined);
  return result;
}

function parseStoredLlmConfig(raw: string): LlmConfig {
  try {
    const parsed = JSON.parse(raw) as Partial<LlmConfig>;
    return {
      baseUrl: normalizeLegacyBaseUrl(parsed.baseUrl),
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      model: parsed.model?.trim() || DEFAULT_LLM_CONFIG.model,
    };
  } catch {
    // 权威记录损坏时失败关闭，不回退到可能残留的旧密钥。
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

function normalizeLegacyBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return DEFAULT_LLM_CONFIG.baseUrl;
  try {
    return normalizeAndValidateBaseUrl(value);
  } catch {
    return DEFAULT_LLM_CONFIG.baseUrl;
  }
}
