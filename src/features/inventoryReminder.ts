import { putMed } from '../db/local';
import type { Medication } from '../db/schema';
import { shouldSendLowStockReminder } from './inventory';
import { showNotification } from './notifier';

/** Persist reminder throttling only after the notification transport accepts it. */
export async function sendLowStockReminderIfDue(
  med: Medication,
  message: string,
): Promise<boolean> {
  if (!med.inventory || !shouldSendLowStockReminder(med)) return false;
  const sent = await showNotification('药量提醒', {
    body: message,
    tag: `inventory_${med.id}`,
    data: { kind: 'inventory', medId: med.id },
  });
  if (!sent) return false;

  med.inventory.lastReminderAt = Date.now();
  await putMed(med);
  return true;
}
