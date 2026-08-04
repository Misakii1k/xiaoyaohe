import { describe, expect, it, vi } from 'vitest';
import type { Medication } from '../src/db/schema';
import { processInventoryReviewCommits } from '../src/features/inventoryReview';

type StockOperation =
  | { action: 'add'; quantity: number }
  | { action: 'set'; remaining: number };

function medication(id: string, remaining: number, deleted = false): Medication {
  return {
    id,
    name: `测试药-${id}`,
    dosageText: '',
    amountPerDose: '',
    slots: [],
    mealRels: [],
    mealRelsBySlot: {},
    daysOfWeek: [],
    reminderMode: 'strong',
    inventory: { remaining, unit: '片' },
    identity: { gtins: [], rawCodes: [], ocrNames: [], photoHashes: [] },
    updatedAt: 1,
    deleted,
  };
}

function applyStockOperation(med: Medication, operation: StockOperation): Medication {
  const remaining = operation.action === 'add'
    ? med.inventory!.remaining + operation.quantity
    : operation.remaining;
  return { ...med, inventory: { ...med.inventory!, remaining } };
}

describe('inventory review save ordering', () => {
  it('uses fresh stock on retry without applying an already saved addition again', async () => {
    let current = medication('a', 10);
    let failSetOnce = true;
    const addCommit = vi.fn();
    const commit = async (med: Medication, operation: StockOperation) => {
      if (operation.action === 'set' && failSetOnce) {
        failSetOnce = false;
        throw new Error('临时失败');
      }
      if (operation.action === 'add') addCommit();
      current = applyStockOperation(med, operation);
      return current;
    };
    const load = async () => current;
    const tasks = [
      { targetId: 'a', payload: { action: 'add', quantity: 2 } as StockOperation },
      { targetId: 'a', payload: { action: 'set', remaining: 5 } as StockOperation },
    ];

    const first = await processInventoryReviewCommits(tasks, load, commit);
    expect(first.map((result) => result.status)).toEqual(['saved', 'failed']);
    expect(current.inventory?.remaining).toBe(12);

    const retry = await processInventoryReviewCommits([tasks[1]!], load, commit);
    expect(retry[0]?.status).toBe('saved');
    expect(current.inventory?.remaining).toBe(5);
    expect(addCommit).toHaveBeenCalledOnce();
  });

  it('blocks later rows for the same medicine when an earlier row fails', async () => {
    let current = medication('a', 10);
    let failSetOnce = true;
    const addCommit = vi.fn();
    const commit = async (med: Medication, operation: StockOperation) => {
      if (operation.action === 'set' && failSetOnce) {
        failSetOnce = false;
        throw new Error('盘点失败');
      }
      if (operation.action === 'add') addCommit();
      current = applyStockOperation(med, operation);
      return current;
    };
    const tasks = [
      { targetId: 'a', payload: { action: 'set', remaining: 5 } as StockOperation },
      { targetId: 'a', payload: { action: 'add', quantity: 2 } as StockOperation },
    ];

    const first = await processInventoryReviewCommits(tasks, async () => current, commit);
    expect(first.map((result) => result.status)).toEqual(['failed', 'blocked']);
    expect(current.inventory?.remaining).toBe(10);
    expect(addCommit).not.toHaveBeenCalled();

    const retry = await processInventoryReviewCommits(tasks, async () => current, commit);
    expect(retry.map((result) => result.status)).toEqual(['saved', 'saved']);
    expect(current.inventory?.remaining).toBe(7);
    expect(addCommit).toHaveBeenCalledOnce();
  });

  it('continues another medicine while one target is blocked', async () => {
    const current = new Map([
      ['a', medication('a', 10)],
      ['b', medication('b', 20)],
    ]);
    const commit = async (med: Medication, operation: StockOperation) => {
      if (med.id === 'a') throw new Error('A 保存失败');
      const updated = applyStockOperation(med, operation);
      current.set(med.id, updated);
      return updated;
    };

    const results = await processInventoryReviewCommits([
      { targetId: 'a', payload: { action: 'set', remaining: 5 } as StockOperation },
      { targetId: 'a', payload: { action: 'add', quantity: 2 } as StockOperation },
      { targetId: 'b', payload: { action: 'add', quantity: 3 } as StockOperation },
    ], async (id) => current.get(id), commit);

    expect(results.map((result) => result.status)).toEqual(['failed', 'blocked', 'saved']);
    expect(current.get('a')?.inventory?.remaining).toBe(10);
    expect(current.get('b')?.inventory?.remaining).toBe(23);
  });

  it('rejects a medication deleted after the review sheet opened', async () => {
    const commit = vi.fn();
    const results = await processInventoryReviewCommits([
      { targetId: 'a', payload: { action: 'add', quantity: 2 } as StockOperation },
    ], async () => medication('a', 10, true), commit);

    expect(results[0]).toMatchObject({
      status: 'failed',
      error: '对应药品已不存在，请重新选择',
    });
    expect(commit).not.toHaveBeenCalled();
  });
});
