// LLM 供应商路由：按优先级依次尝试，当前供应商可恢复地失败时顺延到下一家。
// 只把请求发给用户保存过密钥、且已获得数据外发同意的服务商。
import { requireAiConsent, hasAiConsent, type AiDataKind } from './consent';
import { getLlmRouteCandidates, type LlmProvider } from './llmConfig';

/** 可自动顺延的失败：网络不可达、超时、服务端错误、限流、鉴权失败。 */
export interface LlmAttemptError {
  readonly retryable: boolean;
  readonly status?: number;
  readonly message: string;
}

export function isLlmAttemptError(error: unknown): error is LlmAttemptError {
  return Boolean(
    error
    && typeof error === 'object'
    && 'retryable' in error
    && typeof (error as LlmAttemptError).retryable === 'boolean',
  );
}

/** 把任意异常归类为可顺延或终局错误；消费方用它包装自己的网络/HTTP 异常。 */
export function classifyLlmError(error: unknown): LlmAttemptError {
  if (isLlmAttemptError(error)) return error;
  if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return { retryable: true, message: '请求超时' };
  }
  return { retryable: false, message: error instanceof Error ? error.message : String(error) };
}

export interface LlmRouteCallbacks {
  /** 每次实际发起请求前调用（含故障转移后的重试），供 UI 显示当前服务商。 */
  onAttempt?: (provider: LlmProvider) => void;
  /** 从当前供应商顺延到另一家时调用，供 UI 提示“已改用 XX”。 */
  onFailover?: (from: LlmProvider, to: LlmProvider) => void;
}

export interface LlmRouteResult<T> {
  value: T;
  provider: LlmProvider;
  /** 是否发生过顺延；false 表示全程由最初选中的服务商完成。 */
  failedOver: boolean;
}

/**
 * 按优先级执行一次 LLM 请求。
 * - 数据类别按 kind 校验同意；当前供应商未同意时弹窗询问，顺延候选未同意时直接跳过。
 * - 只有 retryable 的失败才顺延；取消、解析失败等终局错误立即抛出。
 * - 全部候选都失败时抛最后一次失败的原始异常。
 */
export async function runWithLlmFailover<T>(
  kind: AiDataKind,
  run: (provider: LlmProvider) => Promise<T>,
  callbacks: LlmRouteCallbacks = {},
): Promise<LlmRouteResult<T>> {
  const candidates = getLlmRouteCandidates();
  if (candidates.length === 0) {
    throw new Error('还没连接 AI 服务。到「设置 → AI 服务商」填好服务地址和密钥');
  }

  // 当前供应商是用户明确选择的：未同意就弹窗。顺延候选是备用，未同意则跳过，
  // 不打断当前正在进行的操作去问“要不要发给另一家”。
  await requireAiConsent(kind, candidates[0]!.baseUrl);
  const approved = candidates.filter((provider, index) =>
    index === 0 || hasAiConsent(kind, provider.baseUrl),
  );

  for (let index = 0; index < approved.length; index += 1) {
    const provider = approved[index]!;
    try {
      callbacks.onAttempt?.(provider);
      const value = await run(provider);
      return { value, provider, failedOver: index > 0 };
    } catch (error) {
      if (!isLlmAttemptError(error) || !error.retryable) throw error;
      const next = approved[index + 1];
      if (!next) throw error;
      callbacks.onFailover?.(provider, next);
    }
  }
  throw new Error('所有 AI 服务商都还没有获得数据外发授权');
}
