import type { Medication, ReminderRule } from '../db/schema';

const LOW_STOCK_REMIND_GAP_MS = 12 * 60 * 60 * 1000;

export function inferDoseQuantity(amountPerDose: string, unitHint?: string): { quantity: number; unit: string } {
  const text = amountPerDose.trim();
  const unitMatch = text.match(/(片|粒|颗|丸|袋|包|支|瓶|贴|滴|mg|g|ml|mL|毫升)/i);
  const unit = unitHint || unitMatch?.[1] || '片';
  if (!text) return { quantity: 1, unit };
  if (/半|0\.5|1\/2/.test(text)) return { quantity: 0.5, unit };

  const mixed = text.match(/(\d+(?:\.\d+)?)/);
  if (mixed) return { quantity: Number(mixed[1]), unit };

  const cnMap: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  const cn = text.match(/[一二两三四五六七八九十]/)?.[0];
  return { quantity: cn ? cnMap[cn] : 1, unit };
}

export function deductInventory(med: Medication): { changed: boolean; low: boolean; message?: string } {
  if (!med.inventory) return { changed: false, low: false };
  const dose = inferDoseQuantity(med.amountPerDose, med.inventory.unit);
  const next = Math.max(0, roundStock(med.inventory.remaining - dose.quantity));
  med.inventory.remaining = next;
  if (!med.inventory.unit) med.inventory.unit = dose.unit;

  const threshold = med.inventory.lowThreshold ?? Math.max(1, Math.ceil((med.inventory.packageQuantity ?? 14) * 0.2));
  const low = next > 0 && next <= threshold;
  const message = low ? `${med.name} 仅剩 ${next}${med.inventory.unit || dose.unit}` : undefined;
  return { changed: true, low, message };
}

export function restoreInventory(med: Medication, quantity: number): boolean {
  if (!med.inventory || !Number.isFinite(quantity) || quantity <= 0) return false;
  med.inventory.remaining = roundStock(med.inventory.remaining + quantity);
  return true;
}

export function shouldSendLowStockReminder(med: Medication): boolean {
  if (!med.inventory) return false;
  const threshold = med.inventory.lowThreshold ?? Math.max(1, Math.ceil((med.inventory.packageQuantity ?? 14) * 0.2));
  if (med.inventory.remaining <= 0 || med.inventory.remaining > threshold) return false;
  const last = med.inventory.lastReminderAt ?? 0;
  return Date.now() - last >= LOW_STOCK_REMIND_GAP_MS;
}

export function roundStock(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 按启用的提醒规则推算日均用量。
 * 考虑每周服药天数（daysOfWeek 为空时视为每天）。
 * 返回值单位与 amountPerDose 解析出的数量一致（片/粒等）。
 */
export function estimateDailyConsumption(med: Medication, rules: ReminderRule[]): number {
  const enabledRules = rules.filter((r) => r.enabled && !r.deleted && r.medId === med.id);
  if (enabledRules.length === 0) return 0;

  // 每周服药天数：daysOfWeek 为空数组时视为 7 天
  const daysOfWeek = med.daysOfWeek ?? [];
  const daysPerWeek = daysOfWeek.length > 0 ? daysOfWeek.length : 7;

  const dose = inferDoseQuantity(med.amountPerDose, med.inventory?.unit).quantity;
  const dosesPerActiveDay = enabledRules.length;
  // 日均用量 = 每个活跃日的剂量 × 活跃天数 / 7
  const daily = (dose * dosesPerActiveDay * daysPerWeek) / 7;
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
