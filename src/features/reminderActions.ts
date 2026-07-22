import { listScheduleRevisions, setOccurrenceAction } from '../db/local';
import { generateOccurrences, toLocalDate } from '../domain/medicationSchedule';
import type { ReminderAction } from './reminderTransport';
import {
  snoozeNativeMedicationAlarm,
  takePendingMedicationAlarmActions,
  type NativeMedicationAlarmAction,
} from './nativeMedicationAlarm';
import { closeNotificationsByTag } from './notifier';
import { rescheduleMedicationReminders } from './reminderScheduler';

export async function handleMedicationReminderAction(action: ReminderAction): Promise<boolean> {
  if (action.actionId === 'snooze') {
    await snoozeNativeMedicationAlarm(action as NativeMedicationAlarmAction);
    await closeNotificationsByTag(action.tag);
    return true;
  }
  if (action.actionId !== 'taken' && action.actionId !== 'skip') return false;
  const dueAt = typeof action.data.dueAt === 'number' ? action.data.dueAt : Date.now();
  const date = toLocalDate(dueAt);
  const revisions = await listScheduleRevisions();
  const occurrenceId = typeof action.data.occurrenceId === 'string'
    ? action.data.occurrenceId
    : action.tag;
  const occurrence = generateOccurrences(revisions, date, date)
    .find((candidate) => candidate.id === occurrenceId || candidate.legacyLogId === occurrenceId);
  if (!occurrence) return false;
  await setOccurrenceAction(occurrence, action.actionId === 'taken' ? 'taken' : 'skipped');
  await closeNotificationsByTag(occurrence.id);
  await closeNotificationsByTag(occurrence.legacyLogId);
  await rescheduleMedicationReminders().catch(() => undefined);
  return true;
}

export async function replayPendingMedicationReminderActions(): Promise<number> {
  const actions = await takePendingMedicationAlarmActions();
  let handled = 0;
  for (const action of actions) {
    if (await handleMedicationReminderAction(action)) handled += 1;
  }
  return handled;
}
