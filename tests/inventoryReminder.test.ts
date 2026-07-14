import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Medication } from '../src/db/schema';
import { emptyIdentity } from '../src/db/schema';

const mocks = vi.hoisted(() => ({
  putMed: vi.fn(async () => undefined),
  show: vi.fn(async () => false),
}));

vi.mock('../src/db/local', () => ({ putMed: mocks.putMed }));
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

  it('stores lastReminderAt only after the transport accepts the notification', async () => {
    const med = medication('low-stock-sent');
    mocks.show.mockResolvedValue(true);
    const now = 2_000_000_000_000;
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(now);

    expect(await sendLowStockReminderIfDue(med, '库存不足')).toBe(true);
    expect(med.inventory?.lastReminderAt).toBe(now);
    expect(mocks.putMed).toHaveBeenCalledWith(med);
    dateNow.mockRestore();
  });
});
