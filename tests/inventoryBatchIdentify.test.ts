// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  identifyInventoryBatchByBlob,
  mergeInventoryEntryItems,
  type IdentifySession,
  type InventorySpeechItem,
} from '../src/ai/identify';

const session = (): IdentifySession => ({
  baseUrl: 'https://example.com/v1',
  apiKey: 'key',
  model: 'model',
  label: '测试服务',
  providers: [],
  advance: () => false,
});

function response(content: unknown): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function item(
  name: string,
  action: 'add' | 'set',
  remaining: number,
  unit = '片',
): InventorySpeechItem {
  return {
    name,
    action,
    inventory: { remaining, unit },
    confidence: 0.9,
  };
}

describe('batch inventory identification', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps every medication returned from one inventory image', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      items: [
        { name: '阿司匹林', action: 'set', inventory: { remaining: 5, unit: '片' }, confidence: 0.91 },
        { name: '二甲双胍', action: 'add', inventory: { remaining: 40, unit: '片', packageQuantity: 20 }, confidence: 0.88 },
      ],
      confidence: 0.9,
    }));

    const result = await identifyInventoryBatchByBlob(
      new Blob(['image'], { type: 'image/jpeg' }),
      undefined,
      { session: session() },
    );

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ name: '阿司匹林', action: 'set', inventory: { remaining: 5 } });
    expect(result.items[1]).toMatchObject({
      name: '二甲双胍',
      action: 'add',
      inventory: { remaining: 40, packageQuantity: 20 },
    });
  });

  it('defaults legacy responses without action to set', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      items: [{ name: '钙片', inventory: { remaining: 12, unit: '片' }, confidence: 0.8 }],
      confidence: 0.8,
    }));

    const result = await identifyInventoryBatchByBlob(
      new Blob(['image'], { type: 'image/jpeg' }),
      undefined,
      { session: session() },
    );
    expect(result.items[0]?.action).toBe('set');
  });

  it('preserves add semantics parsed from a purchase statement', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      items: [{ name: '钙片', action: 'add', inventory: { remaining: 20, unit: '片', packageQuantity: 20 }, confidence: 0.8 }],
      confidence: 0.8,
    }));

    const result = await identifyInventoryBatchByBlob(
      new Blob(['image'], { type: 'image/jpeg' }),
      undefined,
      { session: session() },
    );
    expect(result.items[0]).toMatchObject({ action: 'add', inventory: { remaining: 20, packageQuantity: 20 } });
  });

  it('merges only compatible add entries and returns defensive copies', () => {
    const source = [
      item('阿司匹林', 'add', 10),
      item(' 阿司匹林 ', 'add', 20),
      item('阿司匹林', 'set', 7),
      item('阿司匹林', 'add', 3),
      item('阿司匹林', 'add', 1, '盒'),
    ];

    const result = mergeInventoryEntryItems(source);

    expect(result.map((entry) => [entry.action, entry.inventory.remaining, entry.inventory.unit])).toEqual([
      ['add', 30, '片'],
      ['set', 7, '片'],
      ['add', 3, '片'],
      ['add', 1, '盒'],
    ]);
    result[0]!.inventory.remaining = 99;
    expect(source[0]!.inventory.remaining).toBe(10);
  });
});
