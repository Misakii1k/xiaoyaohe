import { areDoseUnitsCompatible, roundStock } from '../features/inventory';
import type { InventoryOperationLog, Medication } from './schema';
import { MedicationInventoryError } from './errors';

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(
      Object.entries(item as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right)),
    );
  });
}

export function nextInventoryOperationTimestamp(
  medLogs: readonly Pick<InventoryOperationLog, 'timestamp'>[],
  now = Date.now(),
): number {
  const latestTimestamp = medLogs.reduce(
    (maximum, log) => Math.max(maximum, Number.isFinite(log.timestamp) ? log.timestamp : 0),
    0,
  );
  return Math.max(now, latestTimestamp + 1);
}

export function effectiveInventoryLogs(logs: readonly InventoryOperationLog[]): InventoryOperationLog[] {
  const undoneIds = new Set(logs.flatMap((item) => item.undoneLogId ? [item.undoneLogId] : []));
  return logs
    .filter((item) => item.action !== 'undo' && item.delta !== 0 && !undoneIds.has(item.id))
    .sort((left, right) => right.timestamp - left.timestamp || right.id.localeCompare(left.id));
}

export function assertExpectedInventory(
  current: Medication['inventory'],
  expectedRemaining: number | undefined,
  expectedUnit: string | undefined,
): void {
  const currentRemaining = current?.remaining;
  if (
    (currentRemaining == null) !== (expectedRemaining == null)
    || (currentRemaining != null && roundStock(currentRemaining) !== roundStock(expectedRemaining!))
  ) {
    throw new MedicationInventoryError(
      'inventory-conflict',
      `库存已被其他操作更新（当前为 ${currentRemaining ?? '未设置'}，编辑时为 ${expectedRemaining ?? '未设置'}），请刷新后重试`,
    );
  }
  if (
    current?.unit
    && (!expectedUnit || !areDoseUnitsCompatible(current.unit, expectedUnit))
  ) {
    throw new MedicationInventoryError(
      'inventory-conflict',
      `库存单位已被其他操作更新（当前为 ${current.unit}，编辑时为 ${expectedUnit || '未设置'}），请刷新后重试`,
    );
  }
}

export type InventoryMetadata = Omit<NonNullable<Medication['inventory']>, 'remaining' | 'unit'>;

export function inventoryMetadata(inventory: Medication['inventory']): InventoryMetadata {
  return {
    packageQuantity: inventory?.packageQuantity,
    lowThreshold: inventory?.lowThreshold,
    sourceNote: inventory?.sourceNote,
    lastReminderAt: inventory?.lastReminderAt,
  };
}

export function assertExpectedInventoryMetadata(current: Medication['inventory'], expected: InventoryMetadata): void {
  if (canonicalJson(inventoryMetadata(current)) !== canonicalJson(expected)) {
    throw new MedicationInventoryError(
      'inventory-conflict',
      '库存详情已被其他操作更新，请刷新后重试',
    );
  }
}
