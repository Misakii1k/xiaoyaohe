// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeState = vi.hoisted(() => ({
  config: { baseUrl: 'https://a.example.com/v1', apiKey: 'key-a', model: 'model-a' },
  candidates: [
    { id: 'a', label: 'A', baseUrl: 'https://a.example.com/v1', apiKey: 'key-a', model: 'model-a' },
    { id: 'b', label: 'B', baseUrl: 'https://b.example.com/v1', apiKey: 'key-b', model: 'model-b' },
  ],
}));
const consent = vi.hoisted(() => ({
  require: vi.fn<() => Promise<void>>(),
  has: vi.fn<(kind: string, baseUrl: string) => boolean>(),
}));

vi.mock('../src/ai/llmConfig', () => ({
  getLlmConfig: () => routeState.config,
  getLlmRouteCandidates: () => routeState.candidates,
  normalizeAndValidateBaseUrl: (url: string) => url,
}));

vi.mock('../src/ai/consent', () => ({
  requireAiConsent: consent.require,
  hasAiConsent: consent.has,
}));

const { runAssistantTurn } = await import('../src/ai/assistant');

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function okReply(text: string): Response {
  return jsonResponse({ choices: [{ message: { content: text } }] });
}

function requestBody(call: number): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[call]![1]!.body as string) as Record<string, unknown>;
}

function turn(overrides: Record<string, unknown> = {}): Promise<{ markdown: string }> {
  return runAssistantTurn(
    [{ role: 'user', content: '你好' }],
    { confirmTool: async () => true, ...overrides } as never,
  ) as Promise<{ markdown: string }>;
}

describe('assistant turn request prefs (model override / reasoning effort)', () => {
  beforeEach(() => {
    consent.require.mockReset().mockResolvedValue(undefined);
    consent.has.mockReset().mockReturnValue(true);
    fetchMock = vi.fn(async () => okReply('好的'));
    vi.stubGlobal('fetch', fetchMock);
  });

  it('sends the provider model and no reasoning_effort when no prefs are set', async () => {
    await turn();
    const body = requestBody(0);
    expect(body.model).toBe('model-a');
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('applies model override and reasoning effort to the active provider only', async () => {
    // 第一家 500 触发顺延，第二家的请求不应带上为 A 家准备的覆盖
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 500 }),
    );
    await turn({ modelOverride: 'model-x', reasoningEffort: 'high' });

    const first = requestBody(0);
    expect(first.model).toBe('model-x');
    expect(first.reasoning_effort).toBe('high');

    const second = requestBody(1);
    expect(second.model).toBe('model-b');
    expect(second).not.toHaveProperty('reasoning_effort');
  });

  it('retries once without reasoning_effort when the endpoint rejects the parameter', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { message: 'Unknown field: reasoning_effort' } }, 400),
    );

    const result = await turn({ reasoningEffort: 'low' });
    expect(result.markdown).toBe('好的');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(0).reasoning_effort).toBe('low');
    expect(requestBody(1)).not.toHaveProperty('reasoning_effort');
  });

  it('keeps a 400 that is unrelated to the reasoning parameter as an error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'messages 数组格式非法' } }, 400));

    await expect(turn({ reasoningEffort: 'medium' })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
