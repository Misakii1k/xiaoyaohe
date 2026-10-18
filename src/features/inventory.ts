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
  // 0 / 负数 / 非数字都不是「不预警」，而是没填：一律回到包装量推算，避免预警线悄悄变成 1。
  const explicit = med.inventory?.lowThreshold;
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) return explicit;
  const packageQuantity = med.inventory?.packageQuantity;
  const basis = typeof packageQuantity === 'number' && Number.isFinite(packageQuantity) && packageQuantity > 0
    ? packageQuantity
    : 14;
  return Math.max(1, Math.ceil(basis * 0.2));
}

/**
 * 件数是否已跌破警戒线（只看剩余件数，不看用量）。
 * 「还够吃几天」属于另一层判断，见 `isInventoryNeedingRestock`；
 * 二者必须分开，否则打卡后的「仅剩 N 片」提示会在库存很多时也冒出来。
 */
export function isLowStock(med: Medication): boolean {
  if (!med.inventory) return false;
  return med.inventory.remaining <= getLowStockThreshold(med);
}

export function classifyInventoryStatus(
  med: Medication,
  rules: ReminderRule[],
): InventoryStatus {
  if (!med.inventory) return 'unset';
  if (med.inventory.remaining <= 0) return 'empty';
  const daysLeft = estimateDaysLeft(med, rules);
  if (isLowStock(med) || (daysLeft != null && daysLeft <= 3)) return 'low';
  if (daysLeft != null && daysLeft <= 7) return 'days_low';
  return 'ok';
}

/**
 * 判断药品是否需要备药/补货：件数跌破警戒线，或按真实排程推算的可用天数 <= 7 天。
 * 未录入库存的药品返回 false —— 那是「未录入」而不是「需补货」，不能混进补货清单。
 */
export function isInventoryNeedingRestock(med: Medication, rules: ReminderRule[] = []): boolean {
  if (!med.inventory) return false;
  if (med.inventory.remaining <= 0) return true;
  if (isLowStock(med)) return true;
  const daysLeft = estimateDaysLeft(med, rules);
  return daysLeft != null && daysLeft <= 7;
}

export type StockTone = 'ok' | 'warn' | 'danger' | 'muted';

export interface StockSummary {
  /** 未录入库存时为 null，调用方不得自行编造件数。 */
  remaining: number | null;
  unit: string;
  daysLeft: number | null;
  /** 卡片主文案，如「剩余 12片 · 约 5 天用量」。 */
  detail: string;
  /** 列表紧凑文案，如「余 12片」或「未录入库存」。 */
  short: string;
  /** 状态胶囊文案，如「充足」「剩 5 天」「已缺药」「未录入」。 */
  label: string;
  tone: StockTone;
}

/**
 * 库存展示的唯一出口：剩余件数、可用天数、胶囊文案与色调都从这里派生，
 * 避免库存页、药品列表、详情页各自算一套而互相矛盾。
 */
export function describeStock(med: Medication, rules: ReminderRule[] = []): StockSummary {
  if (!med.inventory) {
    return {
      remaining: null,
      unit: '',
      daysLeft: null,
      detail: '未录入库存',
      short: '未录入库存',
      label: '未录入',
      tone: 'muted',
    };
  }
  const { remaining } = med.inventory;
  const displayUnit = med.inventory.unit?.trim() || med.doseUnit?.trim() || '';
  // 脏数据（NaN / Infinity）绝不能渲染成「剩余 NaN 片」这种半句话。
  if (!Number.isFinite(remaining)) {
    return {
      remaining: null,
      unit: displayUnit,
      daysLeft: null,
      detail: '库存数据异常，请重新录入',
      short: '库存数据异常',
      label: '异常',
      tone: 'muted',
    };
  }
  const daysLeft = estimateDaysLeft(med, rules);
  const amount = `${formatStockNumber(remaining)}${displayUnit}`;
  const short = `余 ${amount}`;
  const countLow = isLowStock(med);
  const build = (detail: string, label: string, tone: StockTone): StockSummary => ({
    remaining,
    unit: displayUnit,
    daysLeft,
    detail,
    short,
    label,
    tone,
  });

  if (remaining <= 0) return build(`剩余 0${displayUnit}`, '已缺药', 'danger');
  if (daysLeft == null) {
    return build(`剩余 ${amount}`, countLow ? '不足' : '充足', countLow ? 'warn' : 'ok');
  }
  if (daysLeft <= 0) return build(`剩余 ${amount} · 不足 1 天用量`, '不足 1 天', 'danger');
  if (daysLeft <= 3) return build(`剩余 ${amount} · 约 ${daysLeft} 天用量`, `剩 ${daysLeft} 天`, 'danger');
  if (daysLeft <= 7) return build(`剩余 ${amount} · 约 ${daysLeft} 天用量`, `剩 ${daysLeft} 天`, 'warn');
  return build(`剩余 ${amount} · 约 ${daysLeft} 天用量`, countLow ? '不足' : '充足', countLow ? 'warn' : 'ok');
}

function formatStockNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(roundStock(value));
}

/**
 * 片/粒/颗/丸 都是「按个数吃」的同一族单位：库存写 60 粒、剂量写 1 片时，
 * 扣减的是同一堆药，不能因为用词不同就中止打卡，也不该在盘点/撤回时判成冲突。
 * 盒/瓶/袋/支/贴/滴 不在这一族里，字面不一致仍然拒绝。
 */
const COUNT_DOSE_UNITS = new Set(['片', '粒', '颗', '丸']);

export function areDoseUnitsCompatible(left: string, right: string): boolean {
  const a = normalizeDoseUnit(left);
  const b = normalizeDoseUnit(right);
  if (a === b) return true;
  return COUNT_DOSE_UNITS.has(a) && COUNT_DOSE_UNITS.has(b);
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

export function shouldSendLowStockReminder(
  med: Medication,
  rules: ReminderRule[] = [],
  now = Date.now(),
): boolean {
  if (!med.inventory) return false;
  const threshold = getLowStockThreshold(med);
  const daysLeft = estimateDaysLeft(med, rules);
  const needsRestock = med.inventory.remaining <= threshold || (daysLeft != null && daysLeft <= 7);
  if (!needsRestock) return false;
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
  // 与扣减同一把尺子：库存记「粒」、剂量写「片」时照样能推算天数，
  // 否则页面会出现「剩余 60粒」却没有「约 N 天」的空白。
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
  if (!Number.isFinite(daily) || daily <= 0) return null;
  const remaining = med.inventory?.remaining ?? 0;
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
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
    // 只能扣到现有的量：批量扣减实际按 min(现有, 需扣) 执行，预览不能报一个扣不出来的数字。
    const deductQuantity = Math.min(roundStock(daily * days), currentStock);
    const expectedRemaining = Math.max(0, roundStock(currentStock - deductQuantity));
    const threshold = getLowStockThreshold(med);
    const daysAfter = daily > 0 ? Math.floor(expectedRemaining / daily) : null;

    items.push({
      medId: med.id,
      medName: med.name,
      unit,
      currentStock,
      dailyConsumption: daily,
      deductQuantity,
      expectedRemaining,
      willBeEmpty: deductQuantity > 0 && expectedRemaining <= 0,
      willBeLow: expectedRemaining > 0
        && (expectedRemaining <= threshold || (daysAfter != null && daysAfter <= 7)),
    });
  }

  // 日用量为 0 的药（没有启用的服药计划 / 剂量未确认）实际不会被扣，不能算进「共 N 种」。
  const deductingCount = items.filter((item) => item.deductQuantity > 0).length;
  const summaryText = deductingCount > 0
    ? `一次性预扣除 ${days} 天服药库存，共 ${deductingCount} 种药品。`
    : `没有可预扣的药品：这些药还没有确认用量或没有启用的服药计划。`;
  return { days, items, summaryText };
}
