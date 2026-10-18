import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Medication } from '../src/db/schema';
import { emptyIdentity } from '../src/db/schema';

const mocks = vi.hoisted(() => ({
  putMed: vi.fn(async () => undefined),
  getMed: vi.fn(async () => undefined as Medication | undefined),
  listRulesByMed: vi.fn(async () => [] as unknown[]),
  show: vi.fn(async () => false),
}));

vi.mock('../src/db/local', () => ({ putMed: mocks.putMed, getMed: mocks.getMed }));
vi.mock('../src/db/repositories/rulesRepo', () => ({ listRulesByMed: mocks.listRulesByMed }));
vi.mock('../src/features/notifier', () => ({ showNotification: mocks.show }));

import { sendLowStockReminderIfDue } from '../src/features/inventoryReminder';

function medication(id: string): Medication {
  return {
    id,
    name: '低库存测试药',
    dosageText: '',
    amountPerDose: '1片',
    doseQuantity: 1,
    doseUnit: '片',
    slots: ['morning'],
    mealRels: [],
    mealRelsBySlot: {},
    daysOfWeek: [],
    inventory: { remaining: 1, unit: '片', lowThreshold: 2 },
    identity: emptyIdentity(),
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('low stock reminder persistence', () => {
  beforeEach(() => {
    mocks.putMed.mockClear();
    mocks.getMed.mockReset();
    mocks.show.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  it('does not throttle future reminders when the transport rejects the notification', async () => {
    const med = medication('low-stock-rejected');
    mocks.show.mockResolvedValue(false);

    expect(await sendLowStockReminderIfDue(med, '库存不足')).toBe(false);
    expect(med.inventory?.lastReminderAt).toBeUndefined();
    expect(mocks.putMed).not.toHaveBeenCalled();
  });

  it('writes lastReminderAt onto the latest record instead of the stale snapshot', async () => {
    const med = medication('low-stock-sent');
    mocks.show.mockResolvedValue(true);
    const now = 2_000_000_000_000;
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(now);
    // 通知发出期间，另一个入口把库存扣到了 0：回写旧快照会把这笔扣减抹掉。
    const fresh = medication('low-stock-sent');
    fresh.inventory = { remaining: 0, unit: '片', lowThreshold: 2 };
    mocks.getMed.mockResolvedValue(fresh);

    expect(await sendLowStockReminderIfDue(med, '库存不足')).toBe(true);
    expect(mocks.getMed).toHaveBeenCalledWith('low-stock-sent');
    expect(fresh.inventory?.lastReminderAt).toBe(now);
    expect(mocks.putMed).toHaveBeenCalledWith(fresh);
    expect(med.inventory?.lastReminderAt).toBeUndefined();
    dateNow.mockRestore();
  });

  it('skips the write when the medication disappeared meanwhile', async () => {
    const med = medication('low-stock-deleted');
    mocks.show.mockResolvedValue(true);
    mocks.getMed.mockResolvedValue(undefined);

    expect(await sendLowStockReminderIfDue(med, '库存不足')).toBe(true);
    expect(mocks.putMed).not.toHaveBeenCalled();
  });
});
