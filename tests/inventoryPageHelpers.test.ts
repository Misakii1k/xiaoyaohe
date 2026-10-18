import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  areDoseUnitsCompatible,
  calculateBatchDeductionPreview,
  classifyInventoryStatus,
  deductInventory,
  describeStock,
  getLowStockThreshold,
  isInventoryNeedingRestock,
  isLowStock,
  shouldSendLowStockReminder,
} from '../src/features/inventory';
import { getMedicationExpiryLocalDate } from '../src/domain/medicationSchedule';
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

  it('correctly marks medication with only 4 days left as needing restock instead of fake healthy', () => {
    // 每日消耗 1 片，剩余 4 片，阈值设置较低（1 片）：动态推算为 4 天用量，必须识别为需备药
    const med4Days = medication({ inventory: { remaining: 4, unit: '片', lowThreshold: 1 } });
    expect(classifyInventoryStatus(med4Days, [rule()])).toBe('days_low');
    expect(isInventoryNeedingRestock(med4Days, [rule()])).toBe(true);

    // 充足情况：剩余 12 片（12 天）且高于阈值
    const medPlenty = medication({ inventory: { remaining: 12, unit: '片', lowThreshold: 1 } });
    expect(classifyInventoryStatus(medPlenty, [rule()])).toBe('ok');
    expect(isInventoryNeedingRestock(medPlenty, [rule()])).toBe(false);
  });

  it('keeps isLowStock about pill counts and lets restock carry the day-based warning', () => {
    // 剩余 4 片 / 每日 1 片：件数没跌破警戒线（1 片），所以不是「不足」，但必须进补货清单。
    const med4Days = medication({ inventory: { remaining: 4, unit: '片', lowThreshold: 1 } });
    expect(isLowStock(med4Days)).toBe(false);
    expect(isInventoryNeedingRestock(med4Days, [rule()])).toBe(true);

    // 旧缓存字段不能把件数充足的药误判成「不足」，否则打卡后会出现「仅剩 100 片」。
    const cached = medication({
      inventory: { remaining: 100, unit: '片', lowThreshold: 2, dailyConsumption: 20 },
    });
    expect(isLowStock(cached)).toBe(false);
  });

  it('does not count medication without recorded inventory as needing restock', () => {
    expect(isInventoryNeedingRestock(medication(), [rule()])).toBe(false);
  });

  it('describes stock from one source: never invents pill counts', () => {
    const unset = describeStock(medication(), [rule()]);
    expect(unset.remaining).toBeNull();
    expect(unset.label).toBe('未录入');
    expect(unset.short).toBe('未录入库存');
    expect(unset.detail).not.toMatch(/\d/);

    expect(describeStock(medication({ inventory: { remaining: 0, unit: '片' } }), [rule()]).label).toBe('已缺药');

    const fourDays = describeStock(medication({ inventory: { remaining: 4, unit: '片', lowThreshold: 1 } }), [rule()]);
    expect(fourDays.daysLeft).toBe(4);
    expect(fourDays.label).toBe('剩 4 天');
    expect(fourDays.tone).toBe('warn');

    const plenty = describeStock(medication({ inventory: { remaining: 20, unit: '片', lowThreshold: 2 } }), [rule()]);
    expect(plenty.label).toBe('充足');
    expect(plenty.tone).toBe('ok');
  });

  it('renders sub-day and non-finite stock without NaN or 0-day copy', () => {
    const halfDay = describeStock(
      medication({ inventory: { remaining: 0.5, unit: '片', lowThreshold: 0 } }),
      [{ ...rule(), cycle: { activeDays: 1, restDays: 6, startDate: '2026-01-01' } } as ReminderRule],
    );
    expect(halfDay.detail).not.toContain('NaN');
    expect(halfDay.label).not.toBe('剩 0 天');

    const broken = describeStock(medication({ inventory: { remaining: Number.NaN, unit: '片' } }), [rule()]);
    expect(broken.daysLeft).toBeNull();
    expect(broken.detail).not.toContain('NaN');
  });

  it('counts only medications that actually get deducted in the batch preview', () => {
    const meds = [
      medication({ id: 'with-rules', name: '有排程的药', inventory: { remaining: 10, unit: '片', lowThreshold: 2 } }),
      medication({ id: 'no-rules', name: '没有排程的药', inventory: { remaining: 10, unit: '片', lowThreshold: 2 } }),
    ];
    const rules: ReminderRule[] = [{ ...rule(), medId: 'with-rules' }];
    const preview = calculateBatchDeductionPreview(meds, rules, 7);
    expect(preview.summaryText).toContain('共 1 种药品');
    const withRules = preview.items.find((item) => item.medId === 'with-rules');
    // 扣完只剩 3 天用量：即使件数仍高于警戒线，也要标成「扣后偏低」。
    expect(withRules?.willBeLow).toBe(true);
    const noRules = preview.items.find((item) => item.medId === 'no-rules');
    expect(noRules?.deductQuantity).toBe(0);
    expect(noRules?.willBeLow).toBe(false);
  });

  it('deducts when inventory counts capsules and the dose is written in tablets', () => {
    const med = medication({ inventory: { remaining: 60, unit: '粒', lowThreshold: 5 } });
    const result = deductInventory(med, { quantity: 1, unit: '片' });
    expect(result.reviewRequired).toBeUndefined();
    expect(result.changed).toBe(true);
    expect(med.inventory?.remaining).toBe(59);

    // 片/粒/颗/丸 是同一计数族；盒这类包装单位仍然不可互换。
    expect(areDoseUnitsCompatible('片', '粒')).toBe(true);
    expect(areDoseUnitsCompatible('片', '盒')).toBe(false);
    expect(areDoseUnitsCompatible('盒', '片')).toBe(false);
  });

  it('falls back to the package-derived threshold instead of trusting a zero', () => {
    expect(getLowStockThreshold(medication({ inventory: { remaining: 8, unit: '片', packageQuantity: 0 } }))).toBe(3);
    expect(getLowStockThreshold(medication({ inventory: { remaining: 8, unit: '片', packageQuantity: 30, lowThreshold: 0 } }))).toBe(6);
  });

  it('ignores out-of-range legacy expiry timestamps instead of crashing the page', () => {
    expect(getMedicationExpiryLocalDate(medication({ expiryDate: 8.64e15 + 1 }))).toBeUndefined();
    expect(getMedicationExpiryLocalDate(medication({ expiryDate: Number.NaN }))).toBeUndefined();
  });

  it('reminds by remaining days, not only by pill count', () => {
    const now = 2_000_000_000_000;
    // 20 片、每天 1 片：件数远高于警戒线 2 片，但还够吃 20 天 → 不提醒。
    const twentyDays = medication({ inventory: { remaining: 20, unit: '片', lowThreshold: 2 } });
    expect(shouldSendLowStockReminder(twentyDays, [rule()], now)).toBe(false);

    // 剩 4 天时必须提醒，和库存页的红色状态一致。
    const fourDays = medication({ inventory: { remaining: 4, unit: '片', lowThreshold: 1 } });
    expect(shouldSendLowStockReminder(fourDays, [rule()], now)).toBe(true);

    // 12 小时节流仍然生效。
    const reminded = medication({
      inventory: { remaining: 4, unit: '片', lowThreshold: 1, lastReminderAt: now - 60_000 },
    });
    expect(shouldSendLowStockReminder(reminded, [rule()], now)).toBe(false);
  });

  it('registers the static inventory route before the dynamic medication editor route', () => {
    const registry = readFileSync(join(root, 'src/tools/registry.ts'), 'utf8');
    const inventoryRoute = registry.indexOf("path: '/meds/inventory'");
    const editRoute = registry.indexOf("path: '/meds/:id/edit'");
    expect(inventoryRoute).toBeGreaterThan(-1);
    expect(inventoryRoute).toBeLessThan(editRoute);
  });

  it('includes its filter and search control styles when opened before the medication page', () => {
    const inventoryStyles = readFileSync(join(root, 'src/ui/styles/pages/inventory.css'), 'utf8');
    expect(inventoryStyles).toContain('.topbar-pill');
    expect(inventoryStyles).toContain('.topbar-pill-primary');
    expect(inventoryStyles).toContain('.inventory-search');
    // 断言真正在用的类名：旧契约指向早已不存在的 .inventory-filter-button
    expect(inventoryStyles).toContain('.inventory-filter-btn');
    expect(inventoryStyles).toContain('.inventory-filter-pill.active');
    expect(inventoryStyles).not.toContain('.inventory-filter-button');
  });

  it('includes quick presets, dynamic preview, and expiry management in the inventory add sheet', () => {
    const page = readFileSync(join(root, 'src/pages/MedInventory.ts'), 'utf8');
    expect(page).toContain('inventory-presets-row');
    expect(page).toContain('+1盒');
    expect(page).toContain('inventory-add-preview-card');
    expect(page).toContain('getMedicationExpiryLocalDate');
    expect(page).toContain('expiringCount');
    expect(page).toContain('expiredCount');
    expect(page).not.toContain("createOverviewCol('1', '即将过期'");
    expect(page).not.toContain("createOverviewCol('0', '已过期'");
  });
});
