import { listScheduleRevisions, setOccurrenceAction, setOccurrenceActions } from '../db/local';
import type { LocalDate, MedicationOccurrence, MedicationScheduleRevision } from '../db/schema';
import { generateOccurrences, toLocalDate } from '../domain/medicationSchedule';
import type { ReminderAction } from './reminderTransport';
import {
  acknowledgeNativeMedicationAlarmActions,
  snoozeNativeMedicationAlarm,
  takePendingMedicationAlarmActions,
  type NativeMedicationAlarmAction,
} from './nativeMedicationAlarm';
import { closeNotificationsByTag } from './notifier';
import { rescheduleMedicationReminders } from './reminderScheduler';

/** 组载荷（V2）中的一个明细：按 occurrenceId / legacyLogId 解析为真实 occurrence 后记账 */
interface GroupOccurrenceRef {
  occurrenceId: string;
  legacyLogId: string;
}

function groupOccurrenceRefs(data: Record<string, unknown>): GroupOccurrenceRef[] {
  if (data.kind !== 'reminder-group' || !Array.isArray(data.occurrences)) return [];
  const refs: GroupOccurrenceRef[] = [];
  for (const entry of data.occurrences) {
    if (typeof entry !== 'object' || entry === null) continue;
    const occurrenceId = (entry as { occurrenceId?: unknown }).occurrenceId;
    const legacyLogId = (entry as { legacyLogId?: unknown }).legacyLogId;
    if (typeof occurrenceId === 'string' && typeof legacyLogId === 'string') {
      refs.push({ occurrenceId, legacyLogId });
    }
  }
  return refs;
}

/** 按 occurrenceId（或 legacyLogId）在当日计划中定位真实 occurrence */
function resolveOccurrence(
  revisions: readonly MedicationScheduleRevision[],
  date: LocalDate,
  occurrenceId: string,
  legacyLogId: string,
): MedicationOccurrence | undefined {
  return generateOccurrences(revisions, date, date).find(
    (candidate) => candidate.id === occurrenceId || candidate.legacyLogId === legacyLogId,
  );
}

export async function handleMedicationReminderAction(action: ReminderAction): Promise<boolean> {
  if (action.actionId === 'snooze') {
    await snoozeNativeMedicationAlarm(action as NativeMedicationAlarmAction);
    await closeNotificationsByTag(action.tag);
    return true;
  }
  if (action.actionId === 'all-taken') return handleAllTakenAction(action);
  if (action.actionId !== 'taken' && action.actionId !== 'skip') return false;
  const dueAt = typeof action.data.dueAt === 'number' ? action.data.dueAt : Date.now();
  const date = toLocalDate(dueAt);
  const revisions = await listScheduleRevisions();
  // V2 载荷带 occurrenceId；旧单药载荷回退到 tag（即 occurrence id / legacyLogId）
  const occurrenceId = typeof action.data.occurrenceId === 'string'
    ? action.data.occurrenceId
    : action.tag;
  const occurrence = resolveOccurrence(revisions, date, occurrenceId, occurrenceId);
  if (!occurrence) return false;
  await setOccurrenceAction(occurrence, action.actionId === 'taken' ? 'taken' : 'skipped');
  await closeNotificationsByTag(action.tag); // V2：组 tag
  await closeNotificationsByTag(occurrence.id);
  await closeNotificationsByTag(occurrence.legacyLogId);
  await rescheduleMedicationReminders().catch(() => undefined);
  return true;
}

/** 「全部已服用」：组内全部 occurrence 一次 setOccurrenceActions 单事务 */
async function handleAllTakenAction(action: ReminderAction): Promise<boolean> {
  const refs = groupOccurrenceRefs(action.data);
  if (refs.length === 0) return false;
  const dueAt = typeof action.data.dueAt === 'number' ? action.data.dueAt : Date.now();
  const date = typeof action.data.date === 'string'
    ? (action.data.date as LocalDate)
    : toLocalDate(dueAt);
  const revisions = await listScheduleRevisions();
  const resolved: MedicationOccurrence[] = [];
  for (const ref of refs) {
    const occurrence = resolveOccurrence(revisions, date, ref.occurrenceId, ref.legacyLogId);
    if (occurrence) resolved.push(occurrence);
  }
  if (resolved.length === 0) return false;
  await setOccurrenceActions(resolved, 'taken');
  await closeNotificationsByTag(action.tag);
  await rescheduleMedicationReminders().catch(() => undefined);
  return true;
}

export async function replayPendingMedicationReminderActions(): Promise<number> {
  const actions = await takePendingMedicationAlarmActions();
  let handled = 0;
  const acknowledged: string[] = [];
  for (const action of actions) {
    if (await handleMedicationReminderAction(action)) {
      handled += 1;
      acknowledged.push(action.id);
    }
  }
  // 非破坏性确认：只移除已处理成功的 action，失败项保留待下次重放
  await acknowledgeNativeMedicationAlarmActions(acknowledged);
  return handled;
}
