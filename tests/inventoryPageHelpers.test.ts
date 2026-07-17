import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyInventoryStatus,
  getLowStockThreshold,
  isLowStock,
} from '../src/features/inventory';
import {
  defaultEscalate,
  emptyIdentity,
  type Medication,
  type ReminderRule,
} from '../src/db/schema';

const root = resolve(import.meta.dirname, '..');

function medication(overrides: Partial<Medication> = {}): Medication {
  return {
    id: 'med-inventory',
    name: '测试药',
    dosageText: '10mg/片',
    amountPerDose: '1片',
    doseQuantity: 1,
    doseUnit: '片',
    slots: ['morning'],
    mealRels: [],
    mealRelsBySlot: {},
    daysOfWeek: [],
    identity: emptyIdentity(),
    updatedAt: 1,
    ...overrides,
  };
}

function rule(): ReminderRule {
  return {
    id: 'rule-inventory',
    medId: 'med-inventory',
    slot: 'morning',
    timeLocal: '08:00',
    enabled: true,
    escalate: defaultEscalate(),
    updatedAt: 1,
  };
}

describe('inventory page helpers', () => {
  it('uses an explicit low-stock threshold or the shared package fallback', () => {
    expect(getLowStockThreshold(medication({ inventory: { remaining: 8, unit: '片', packageQuantity: 30 } }))).toBe(6);
    expect(getLowStockThreshold(medication({ inventory: { remaining: 8, unit: '片', packageQuantity: 30, lowThreshold: 4 } }))).toBe(4);
    expect(getLowStockThreshold(medication({ inventory: { remaining: 8, unit: '片' } }))).toBe(3);
  });

  it('classifies unset, empty, low, soon-to-run-out, and healthy inventory', () => {
    expect(classifyInventoryStatus(medication(), [rule()])).toBe('unset');
    expect(classifyInventoryStatus(medication({ inventory: { remaining: 0, unit: '片' } }), [rule()])).toBe('empty');
    expect(classifyInventoryStatus(medication({ inventory: { remaining: 2, unit: '片', lowThreshold: 3 } }), [rule()])).toBe('low');
    expect(classifyInventoryStatus(medication({ inventory: { remaining: 6, unit: '片', lowThreshold: 2 } }), [rule()])).toBe('days_low');
    expect(classifyInventoryStatus(medication({ inventory: { remaining: 20, unit: '片', lowThreshold: 2 } }), [rule()])).toBe('ok');
  });

  it('treats an empty recorded inventory as low stock for the overlapping filter', () => {
    expect(isLowStock(medication({ inventory: { remaining: 0, unit: '片', lowThreshold: 2 } }))).toBe(true);
    expect(isLowStock(medication())).toBe(false);
  });

  it('registers the static inventory route before the dynamic medication editor route', () => {
    const registry = readFileSync(join(root, 'src/tools/registry.ts'), 'utf8');
    const inventoryRoute = registry.indexOf("path: '/meds/inventory'");
    const editRoute = registry.indexOf("path: '/meds/:id/edit'");
    expect(inventoryRoute).toBeGreaterThan(-1);
    expect(inventoryRoute).toBeLessThan(editRoute);
  });
});
