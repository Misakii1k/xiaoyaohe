// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeState = vi.hoisted(() => ({ candidates: [] as Array<{
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}> }));
const consent = vi.hoisted(() => ({
  require: vi.fn<() => Promise<void>>(),
  has: vi.fn<(kind: string, baseUrl: string) => boolean>(),
}));

vi.mock('../src/ai/llmConfig', () => ({
  getLlmRouteCandidates: () => routeState.candidates,
}));

vi.mock('../src/ai/consent', () => ({
  requireAiConsent: consent.require,
  hasAiConsent: consent.has,
}));

const providerA = {
  id: 'a',
  label: 'A',
  baseUrl: 'https://a.example.com/v1',
  apiKey: 'key-a',
  model: 'model-a',
};
const providerB = {
  id: 'b',
  label: 'B',
  baseUrl: 'https://b.example.com/v1',
  apiKey: 'key-b',
  model: 'model-b',
};
const providerC = {
  id: 'c',
  label: 'C',
  baseUrl: 'https://c.example.com/v1',
  apiKey: 'key-c',
  model: 'model-c',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('LLM failover behavior', () => {
  beforeEach(() => {
    routeState.candidates = [providerA, providerB, providerC];
    consent.require.mockReset().mockResolvedValue(undefined);
    consent.has.mockReset().mockReturnValue(false);
    vi.restoreAllMocks();
  });

  it('runs the active provider after consent and skips unapproved fallback providers', async () => {
    consent.has.mockImplementation((_kind, baseUrl) => baseUrl === providerC.baseUrl);
    const route = await import('../src/ai/llmRouting');
    const attempts: string[] = [];
    const failovers: string[] = [];

    const result = await route.runWithLlmFailover(
      'assistant-chat',
      async (provider) => {
        attempts.push(provider.id);
        if (provider.id === 'a') throw { retryable: true, message: 'service unavailable' };
        return provider.label;
      },
      { onFailover: (from, to) => failovers.push(`${from.id}->${to.id}`) },
    );

    expect(consent.require).toHaveBeenCalledWith('assistant-chat', providerA.baseUrl);
    expect(attempts).toEqual(['a', 'c']);
    expect(failovers).toEqual(['a->c']);
    expect(result).toMatchObject({ value: 'C', provider: providerC, failedOver: true });
  });

  it('updates every exposed identify-session field after advancing', async () => {
    consent.has.mockImplementation((_kind, baseUrl) => baseUrl === providerB.baseUrl);
    const identify = await import('../src/ai/identify');

    const session = await identify.createIdentifySession('prescription_sheet', 'prescription');
    expect(session.providers.map((provider) => provider.id)).toEqual(['a', 'b']);
    expect(session).toMatchObject({
      baseUrl: providerA.baseUrl,
      apiKey: providerA.apiKey,
      model: providerA.model,
      label: providerA.label,
    });

    expect(session.advance()).toBe(true);
    expect(session).toMatchObject({
      baseUrl: providerB.baseUrl,
      apiKey: providerB.apiKey,
      model: providerB.model,
      label: providerB.label,
    });
    expect(session.advance()).toBe(false);
  });

  it('sends the retry to the next provider after a recoverable response', async () => {
    routeState.candidates = [providerA, providerB];
    consent.has.mockImplementation((_kind, baseUrl) => baseUrl === providerB.baseUrl);
    const identify = await import('../src/ai/identify');
    const session = await identify.createIdentifySession('prescription_sheet', 'prescription');
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'busy' } }, 503))
      .mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: JSON.stringify({
          items: [{ name: '阿司匹林', dosageText: '100mg/片', amountPerDose: '1片', slots: ['morning'], confidence: 0.9 }],
          confidence: 0.9,
        }) } }],
      }));

    const result = await identify.parseMedicationSpeech('早上吃一片阿司匹林', { session });

    expect(result.items[0]?.name).toBe('阿司匹林');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      `${providerA.baseUrl}/chat/completions`,
      `${providerB.baseUrl}/chat/completions`,
    ]);
    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { model: string };
    expect(secondRequest.model).toBe(providerB.model);
  });

  it('does not contact a fallback provider after the user cancels', async () => {
    routeState.candidates = [providerA, providerB];
    consent.has.mockImplementation((_kind, baseUrl) => baseUrl === providerB.baseUrl);
    const identify = await import('../src/ai/identify');
    const session = await identify.createIdentifySession('prescription_sheet', 'prescription');
    const controller = new AbortController();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      controller.abort();
      throw new DOMException('cancelled', 'AbortError');
    });

    await expect(identify.parseMedicationSpeech('取消这次识别', {
      session,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(session.baseUrl).toBe(providerA.baseUrl);
  });
});
