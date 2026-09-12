import { suggestStructuredDose, estimateDaysLeft, estimateDailyConsumption } from '../../features/inventory';
import { parseExplicitDose } from '../../domain/medicationDraft';
import type { Medication, ReminderRule } from '../../db/schema';

export function readNumber(value: string): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && value.trim() !== '' ? n : undefined;
}

export function readPositiveNumber(value: string): number | undefined {
  const valueAsNumber = readNumber(value);
  return valueAsNumber != null && valueAsNumber > 0 ? valueAsNumber : undefined;
}

export interface DoseReviewResult {
  kind: 'explicit' | 'suggested' | 'empty';
  tone: 'ok' | 'warn';
  message: string;
}

/** 计算结构化剂量复核文案与提示状态 */
export function evaluateDoseReview(
  amountText: string,
  doseQuantity: number | undefined,
  doseUnit: string,
  fallbackInventoryUnit?: string,
): DoseReviewResult {
  const explicit = parseExplicitDose(amountText);
  if (doseQuantity != null && doseUnit.trim()) {
    if (explicit) {
      return {
        kind: 'explicit',
        tone: 'ok',
        message: `看明白了：每次吃 ${explicit.quantity}${explicit.unit}，保存后每次记录吃药会自动扣掉剩余药量。`,
      };
    }
    return {
      kind: 'explicit',
      tone: 'ok',
      message: `已设置每次服药 ${doseQuantity}${doseUnit.trim()}，打卡时将自动扣减库存。`,
    };
  }

  const suggestion = suggestStructuredDose(amountText, fallbackInventoryUnit);
  if (suggestion) {
    return {
      kind: 'suggested',
      tone: 'warn',
      message: `猜您每次吃 ${suggestion.quantity}${suggestion.unit}，对不对请核实一下；没确认前不会自动扣剩余药量。`,
    };
  }

  return {
    kind: 'empty',
    tone: 'warn',
    message: '写清楚每次吃多少（比如 1 片），剩余药量才能自动帮您扣；不清楚就照药盒或医嘱抄。',
  };
}

export function calculateEstimatedDaysLeft(med: Medication, rules: ReminderRule[]): number | null | undefined {
  return estimateDaysLeft(med, rules);
}

export function calculateDailyConsumption(med: Medication, rules: ReminderRule[]): number {
  return estimateDailyConsumption(med, rules);
}
