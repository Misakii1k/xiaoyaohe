// 小助手对话偏好：模型覆盖与推理强度。
// 只作用于小助手聊天请求，不写入全局服务商配置（识别/填表等其它 AI 功能不受影响）。
// 覆盖模型仅对当前活跃服务商生效：故障转移候选商使用各自配置的模型，
// 避免把为 A 家选的模型名发给 B 家导致 404。

export type AssistantReasoningEffort = 'low' | 'medium' | 'high';

export interface AssistantPrefs {
  /** 覆盖当前活跃服务商的模型名；不设则用服务商配置的模型。 */
  modelOverride?: string;
  /** 推理强度；不设则不在请求里带 reasoning_effort，跟随模型默认。 */
  reasoningEffort?: AssistantReasoningEffort;
}

const LS_KEY = 'medbox.assistant-prefs.v1';
const EFFORTS: readonly AssistantReasoningEffort[] = ['low', 'medium', 'high'];
const CHANGE_EVENT = 'medbox:assistant-prefs';

export function getAssistantPrefs(): AssistantPrefs {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<AssistantPrefs>;
    const prefs: AssistantPrefs = {};
    if (typeof parsed.modelOverride === 'string' && parsed.modelOverride.trim()) {
      prefs.modelOverride = parsed.modelOverride.trim();
    }
    if (parsed.reasoningEffort && EFFORTS.includes(parsed.reasoningEffort)) {
      prefs.reasoningEffort = parsed.reasoningEffort;
    }
    return prefs;
  } catch {
    return {};
  }
}

export function setAssistantPrefs(prefs: AssistantPrefs): void {
  const clean: AssistantPrefs = {};
  if (typeof prefs.modelOverride === 'string' && prefs.modelOverride.trim()) {
    clean.modelOverride = prefs.modelOverride.trim();
  }
  if (prefs.reasoningEffort && EFFORTS.includes(prefs.reasoningEffort)) {
    clean.reasoningEffort = prefs.reasoningEffort;
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(clean));
  } catch {
    /* 存不下来就只在本次会话生效 */
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: clean }));
}

export function setAssistantModelOverride(model: string | undefined): void {
  setAssistantPrefs({ ...getAssistantPrefs(), modelOverride: model });
}

export function setAssistantReasoningEffort(effort: AssistantReasoningEffort | undefined): void {
  setAssistantPrefs({ ...getAssistantPrefs(), reasoningEffort: effort });
}

/** 供 UI 监听偏好变化（例如同一面板外的其它入口改了模型）。 */
export function onAssistantPrefsChange(listener: (prefs: AssistantPrefs) => void): () => void {
  const handler = (event: Event): void => {
    listener((event as CustomEvent<AssistantPrefs>).detail ?? getAssistantPrefs());
  };
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}
