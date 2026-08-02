// LLM 配置（OpenAI 兼容 endpoint）
// 用于"自然语言填表"功能：用户描述 → 结构化处方
//
// 地址和模型可持久化；密钥由 Android SecretStore 保管。
import { clearSessionSecret, getSessionSecret, initializeSecretStore, setSessionSecret } from './secretStore';

const LS_KEY = 'medbox.llmConfig.v1';
const LS_HEALTH_KEY = 'medbox.llmHealth.v1';
const SILENT_CHECK_INTERVAL_MS = 10 * 60 * 1000;
let lastSilentCheckAt = 0;

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

export async function initializeLlmSecretStore(): Promise<void> {
  await initializeSecretStore();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<LlmConfig>;
    // Remove the legacy plaintext before touching native storage. If secure
    // storage is unavailable, losing the cached key is safer than retaining it.
    localStorage.removeItem(LS_KEY);
    localStorage.setItem(LS_KEY, JSON.stringify({ baseUrl: parsed.baseUrl, model: parsed.model }));
    if (parsed.apiKey && !getSessionSecret()) await setSessionSecret(parsed.apiKey);
  } catch {
    // A damaged legacy config is handled by getLlmConfig defaults.
  }
}

export function getLlmConfig(): LlmConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_LLM_CONFIG, apiKey: getSessionSecret() };
    const parsed = JSON.parse(raw) as Partial<LlmConfig>;
    return {
      baseUrl: parsed.baseUrl?.trim() || DEFAULT_LLM_CONFIG.baseUrl,
      apiKey: getSessionSecret(),
      model: parsed.model?.trim() || DEFAULT_LLM_CONFIG.model,
    };
  } catch {
    return { ...DEFAULT_LLM_CONFIG, apiKey: getSessionSecret() };
  }
}

export async function setLlmConfig(cfg: LlmConfig): Promise<void> {
  const baseUrl = normalizeAndValidateBaseUrl(cfg.baseUrl);
  localStorage.setItem(LS_KEY, JSON.stringify({ baseUrl, model: cfg.model.trim() }));
  await setSessionSecret(cfg.apiKey);
}

export function isUsingDefaultKey(): boolean {
  return !getLlmConfig().apiKey;
}

export async function resetLlmConfig(): Promise<void> {
  localStorage.removeItem(LS_KEY);
  await clearSessionSecret();
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
