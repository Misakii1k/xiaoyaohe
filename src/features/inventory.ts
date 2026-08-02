import type { Medication, ReminderRule, StructuredDose } from '../db/schema';

const LOW_STOCK_REMIND_GAP_MS = 12 * 60 * 60 * 1000;

const DOSE_UNIT_RE = /(毫升|mL|ml|mg|片|粒|颗|丸|袋|包|支|瓶|贴|滴|g)/i;

/**
 * Parses only a single, unambiguous quantity. Callers must treat this as a
 * migration suggestion until the user confirms it; it is never authoritative
 * for inventory accounting by itself.
 */
export function suggestStructuredDose(amountPerDose: string, unitHint?: string): StructuredDose | undefined {
  const text = amountPerDose.trim();
  if (!text) return undefined;
  const unitMatch = text.match(DOSE_UNIT_RE);
  const unit = (unitMatch?.[1] || unitHint || '').trim();
  if (!unit) return undefined;
  const quantityText = text
    .replace(DOSE_UNIT_RE, '')
    .replace(/^(每次|一次|口服)\s*/u, '')
    .trim();

  let quantity: number | undefined;
  const mixedFraction = /^(\d+)\s*(?:又|\s)\s*(\d+)\s*\/\s*(\d+)$/.exec(quantityText);
  const trailingHalf = /^(\d+(?:\.\d+)?)\s*半$/.exec(quantityText);
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(quantityText);
  const decimal = /^(\d+(?:\.\d+)?)$/.exec(quantityText);
  if (mixedFraction && Number(mixedFraction[3]) > 0) {
    quantity = Number(mixedFraction[1]) + Number(mixedFraction[2]) / Number(mixedFraction[3]);
  } else if (trailingHalf) {
    quantity = Number(trailingHalf[1]) + 0.5;
  } else if (fraction && Number(fraction[2]) > 0) {
    quantity = Number(fraction[1]) / Number(fraction[2]);
  } else if (decimal) {
    quantity = Number(decimal[1]);
  } else if (quantityText === '半') {
    quantity = 0.5;
  }
  if (!Number.isFinite(quantity) || (quantity as number) <= 0) return undefined;
  return { quantity: roundStock(quantity as number), unit };
}
export function getConfirmedDose(med: Medication): StructuredDose | undefined {
  if (!Number.isFinite(med.doseQuantity) || (med.doseQuantity as number) <= 0 || !med.doseUnit?.trim()) {
    return undefined;
  }
  return { quantity: med.doseQuantity as number, unit: med.doseUnit.trim() };
}

export interface InventoryChangeResult {
  changed: boolean;
  low: boolean;
  insufficient?: boolean;
  reviewRequired?: boolean;
  partial?: boolean;
  deductedQuantity?: number;
  message?: string;
}

export type InventoryStatus = 'unset' | 'empty' | 'low' | 'ok' | 'days_low';

/** Keep every inventory surface on the same explicit-or-derived threshold. */
export function getLowStockThreshold(med: Medication): number {
  return med.inventory?.lowThreshold
    ?? Math.max(1, Math.ceil((med.inventory?.packageQuantity ?? 14) * 0.2));
}

export function isLowStock(med: Medication): boolean {
  return !!med.inventory && med.inventory.remaining <= getLowStockThreshold(med);
}

export function classifyInventoryStatus(
  med: Medication,
  rules: ReminderRule[],
): InventoryStatus {
  if (!med.inventory) return 'unset';
  if (med.inventory.remaining <= 0) return 'empty';
  if (isLowStock(med)) return 'low';
  const daysLeft = estimateDaysLeft(med, rules);
  if (daysLeft != null && daysLeft <= 7) return 'days_low';
  return 'ok';
}

export function areDoseUnitsCompatible(left: string, right: string): boolean {
  return normalizeDoseUnit(left) === normalizeDoseUnit(right);
}

function normalizeDoseUnit(unit: string): string {
  const normalized = unit.trim().toLocaleLowerCase('en-US').replace(/\s+/g, '');
  if (normalized === '毫升') return 'ml';
  if (normalized === '毫克') return 'mg';
  if (normalized === '克') return 'g';
  if (normalized === '微克' || normalized === 'μg' || normalized === 'ug') return 'mcg';
  return normalized;
}

export function deductInventory(
  med: Medication,
  confirmedDose = getConfirmedDose(med),
  options: { allowPartial?: boolean } = {},
): InventoryChangeResult {
  if (!med.inventory) return { changed: false, low: false };
  if (!confirmedDose) {
    return { changed: false, low: false, reviewRequired: true, message: `${med.name} 的每次用量需要确认` };
  }
  const inventoryUnit = med.inventory.unit?.trim();
  if (inventoryUnit && !areDoseUnitsCompatible(inventoryUnit, confirmedDose.unit)) {
    return {
      changed: false,
      low: false,
      reviewRequired: true,
      message: `${med.name} 的剂量单位（${confirmedDose.unit}）与库存单位（${inventoryUnit}）不一致，请先确认`,
    };
  }
  if (med.inventory.remaining < confirmedDose.quantity) {
    if (options.allowPartial) {
      const actualDeduct = med.inventory.remaining;
      med.inventory.remaining = 0;
      if (!med.inventory.unit) med.inventory.unit = confirmedDose.unit;
      return {
        changed: actualDeduct > 0,
        low: true,
        partial: true,
        deductedQuantity: actualDeduct,
        message: `${med.name} 库存不足，已扣至 0（原剩 ${actualDeduct}${med.inventory.unit || confirmedDose.unit}）`,
      };
    }
    return {
      changed: false,
      low: true,
      insufficient: true,
      message: `${med.name} 库存不足（剩余 ${med.inventory.remaining}${med.inventory.unit || confirmedDose.unit}）`,
    };
  }
  const next = roundStock(med.inventory.remaining - confirmedDose.quantity);
  med.inventory.remaining = next;
  if (!med.inventory.unit) med.inventory.unit = confirmedDose.unit;

  const threshold = getLowStockThreshold(med);
  const low = next <= threshold;
  const message = low
    ? next <= 0
      ? `${med.name} 已无库存`
      : `${med.name} 仅剩 ${next}${med.inventory.unit || confirmedDose.unit}`
    : undefined;
  return { changed: true, low, deductedQuantity: confirmedDose.quantity, message };
}

export function restoreInventory(med: Medication, quantity: number): boolean {
  if (!med.inventory || !Number.isFinite(quantity) || quantity <= 0) return false;
  med.inventory.remaining = roundStock(med.inventory.remaining + quantity);
  return true;
}

export function shouldSendLowStockReminder(med: Medication, now = Date.now()): boolean {
  if (!med.inventory) return false;
  const threshold = getLowStockThreshold(med);
  if (med.inventory.remaining > threshold) return false;
  const last = med.inventory.lastReminderAt ?? 0;
  return now - last >= LOW_STOCK_REMIND_GAP_MS;
}

export function roundStock(n: number): number {
  return Math.round((n + Number.EPSILON) * 10_000) / 10_000;
}

/**
 * 按启用的提醒规则推算日均用量。
 * 考虑每周服药天数（daysOfWeek 为空时视为每天）。
 * 只使用用户确认过的结构化剂量；未确认或库存单位不匹配时返回 0。
 */
export function estimateDailyConsumption(med: Medication, rules: ReminderRule[]): number {
  const enabledRules = rules.filter((r) => r.enabled && !r.deleted && r.medId === med.id);
  if (enabledRules.length === 0) return 0;

  // 每周服药天数：daysOfWeek 为空数组时视为 7 天
  const daysOfWeek = med.daysOfWeek ?? [];
  const daysPerWeek = daysOfWeek.length > 0 ? daysOfWeek.length : 7;

  const confirmedDose = getConfirmedDose(med);
  if (!confirmedDose) return 0;
  if (med.inventory?.unit && !areDoseUnitsCompatible(med.inventory.unit, confirmedDose.unit)) return 0;
  const dose = confirmedDose.quantity;
  const weekdayFactor = daysPerWeek / 7;
  const dosesPerCalendarDay = enabledRules.reduce((sum, rule) => {
    const cycleLength = (rule.cycle?.activeDays ?? 0) + (rule.cycle?.restDays ?? 0);
    const cycleFactor = rule.cycle && cycleLength > 0 ? rule.cycle.activeDays / cycleLength : 1;
    return sum + weekdayFactor * cycleFactor;
  }, 0);
  const daily = dose * dosesPerCalendarDay;
  return roundStock(daily);
}

/**
 * 预测库存可用天数。
 * 当 dailyConsumption > 0 且 remaining > 0 时返回向下取整的天数，否则返回 null。
 */
export function estimateDaysLeft(med: Medication, rules: ReminderRule[]): number | null {
  const daily = estimateDailyConsumption(med, rules);
  if (daily <= 0) return null;
  const remaining = med.inventory?.remaining ?? 0;
  if (remaining <= 0) return null;
  return Math.floor(remaining / daily);
}

export interface BatchDeductionItemPreview {
  medId: string;
  medName: string;
  unit: string;
  currentStock: number;
  dailyConsumption: number;
  deductQuantity: number;
  expectedRemaining: number;
  willBeEmpty: boolean;
  willBeLow: boolean;
}

export interface BatchDeductionPreview {
  days: number;
  items: BatchDeductionItemPreview[];
  summaryText: string;
}

export function calculateBatchDeductionPreview(
  meds: Medication[],
  rules: ReminderRule[],
  days: number = 7,
): BatchDeductionPreview {
  const items: BatchDeductionItemPreview[] = [];
  for (const med of meds) {
    if (!med.inventory || med.deleted) continue;
    const medRules = rules.filter((r) => r.medId === med.id && !r.deleted && r.enabled);
    const daily = estimateDailyConsumption(med, medRules);
    const unit = med.inventory.unit || '片';
    const currentStock = med.inventory.remaining;
    const deductQuantity = roundStock(daily * days);
    const expectedRemaining = Math.max(0, roundStock(currentStock - deductQuantity));
    const threshold = getLowStockThreshold(med);

    items.push({
      medId: med.id,
      medName: med.name,
      unit,
      currentStock,
      dailyConsumption: daily,
      deductQuantity,
      expectedRemaining,
      willBeEmpty: expectedRemaining <= 0,
      willBeLow: expectedRemaining > 0 && expectedRemaining <= threshold,
    });
  }

  const summaryText = `一次性预扣除 ${days} 天服药库存，共 ${items.length} 种药品。`;
  return { days, items, summaryText };
}
