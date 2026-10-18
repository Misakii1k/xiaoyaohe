import { getMed, putMed } from '../db/local';
import { listRulesByMed } from '../db/repositories/rulesRepo';
import type { Medication } from '../db/schema';
import { shouldSendLowStockReminder } from './inventory';
import { showNotification } from './notifier';

/** Persist reminder throttling only after the notification transport accepts it. */
export async function sendLowStockReminderIfDue(
  med: Medication,
  message: string,
): Promise<boolean> {
  if (!med.inventory) return false;
  // 提醒的触发条件和页面上的「需补充」必须一致：只按件数判断会漏掉「只够吃 2 天」。
  const rules = await listRulesByMed(med.id);
  if (!shouldSendLowStockReminder(med, rules)) return false;
  const sent = await showNotification('药量提醒', {
    body: message,
    tag: `inventory_${med.id}`,
    data: { kind: 'inventory', medId: med.id },
  });
  if (!sent) return false;

  // 只写节流时间戳：整条回写旧快照会覆盖通知等待期间其它入口的库存扣减。
  const fresh = await getMed(med.id);
  if (!fresh?.inventory) return true;
  fresh.inventory.lastReminderAt = Date.now();
  await putMed(fresh);
  return true;
}
