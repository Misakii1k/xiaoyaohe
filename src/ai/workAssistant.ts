import type { WorkAiDraft, WorkEntry, WorkProfile } from '../db/schema';
import { getLlmConfig, normalizeAndValidateBaseUrl } from './llmConfig';
import { requireAiConsent } from './consent';

export class WorkAiError extends Error {
  constructor(message: string, public hint?: string) {
    super(message);
  }
}

const SYSTEM_PROMPT =
  '你是个人工时和收入记录助手。只输出严格 JSON，不要 markdown。' +
  '你可以解析固定薪资、时薪、日结、班次时间、休息分钟、结算状态、备注。' +
  '所有金额单位为人民币元；不确定的字段留空或给 warnings。';

export async function parseWorkProfileText(text: string): Promise<WorkAiDraft> {
  return requestWorkAi(
    'profile',
    text,
    '输出 {"kind":"profile","profile":{"name":"","payMode":"salary|hourly|daily","baseAmount":0,"defaultStartTime":"HH:mm","defaultEndTime":"HH:mm","defaultBreakMinutes":0,"expectedWorkDaysPerMonth":0,"note":""},"warnings":[],"confidence":0-1}',
  );
}

export async function parseWorkEntryText(text: string, profiles: WorkProfile[]): Promise<WorkAiDraft> {
  return requestWorkAi(
    'entry',
    text,
    '输出 {"kind":"entry","entry":{"projectName":"","profileId":"","taskName":"","startAtText":"","endAtText":"","breakMinutes":0,"note":"","settlementStatus":"pending|settled","amountOverride":0},"entries":[],"warnings":[],"confidence":0-1}。如果有多条班次，放到 entries。',
    profiles.map((p) => ({ id: p.id, name: p.name, payMode: p.payMode, baseAmount: p.baseAmount })),
  );
}

export async function summarizeWorkIncome(summary: unknown): Promise<WorkAiDraft> {
  return requestWorkAi(
    'summary',
    JSON.stringify(summary),
    '输出 {"kind":"summary","summary":"一段不超过120字的中文总结","warnings":[],"confidence":0-1}',
  );
}

export async function detectWorkEntryIssues(entry: WorkEntry, context: unknown): Promise<WorkAiDraft> {
  return requestWorkAi(
    'issues',
    JSON.stringify({ entry, context }),
    '输出 {"kind":"issues","warnings":["发现的问题或需要确认的点"],"confidence":0-1}',
  );
}

async function requestWorkAi(kind: WorkAiDraft['kind'], input: string, shape: string, context?: unknown): Promise<WorkAiDraft> {
  const cfg = getLlmConfig();
  if (!cfg.baseUrl || !cfg.apiKey) {
    throw new WorkAiError('请先在「设置 → AI 大模型」配置 API 地址和密钥', 'unconfigured');
  }
  const baseUrl = normalizeAndValidateBaseUrl(cfg.baseUrl);
  await requireAiConsent('work-data', baseUrl);
  const resp = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + cfg.apiKey,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `任务：${kind}\n输出格式：${shape}\n上下文：${JSON.stringify(context || null)}\n用户输入：${input}` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({})) as { error?: { message?: string } | string };
    const msg = typeof data.error === 'string' ? data.error : data.error?.message || `AI 服务出错（${resp.status}）`;
    throw new WorkAiError(msg);
  }
  const payload = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
  const parsed = tryParseJson(payload.choices?.[0]?.message?.content || '');
  if (!parsed) throw new WorkAiError('AI 返回无法解析');
  return normalizeDraft(parsed, kind);
}

function normalizeDraft(raw: Record<string, unknown>, fallbackKind: WorkAiDraft['kind']): WorkAiDraft {
  const kind = raw.kind === 'profile' || raw.kind === 'entry' || raw.kind === 'entries' || raw.kind === 'summary' || raw.kind === 'issues'
    ? raw.kind
    : fallbackKind;
  return {
    kind,
    profile: asObject(raw.profile),
    entry: asObject(raw.entry),
    entries: Array.isArray(raw.entries) ? raw.entries.filter((e) => e && typeof e === 'object') as Partial<WorkEntry>[] : undefined,
    summary: typeof raw.summary === 'string' ? raw.summary.trim() : undefined,
    warnings: Array.isArray(raw.warnings) ? raw.warnings.filter((w): w is string => typeof w === 'string' && w.trim().length > 0) : [],
    confidence: typeof raw.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0,
  };
}

function asObject<T extends object>(value: unknown): Partial<T> | undefined {
  return value && typeof value === 'object' ? value as Partial<T> : undefined;
}

function tryParseJson(s: string): Record<string, unknown> | null {
  const text = s.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    const obj = JSON.parse(text);
    return obj && typeof obj === 'object' ? obj as Record<string, unknown> : null;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const obj = JSON.parse(match[0]);
      return obj && typeof obj === 'object' ? obj as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
}
