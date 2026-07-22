import { Capacitor, registerPlugin } from '@capacitor/core';
import type { ScheduledReminderNotification } from './reminderTransport';

export type FullScreenAlarmCapability = 'granted' | 'denied' | 'unavailable';

export interface NativeMedicationAlarmAction {
  actionId: 'taken' | 'snooze' | 'skip';
  tag: string;
  data: Record<string, unknown>;
}

interface NativeAlarmPlugin {
  reconcile(options: { notifications: NativeAlarmNotification[] }): Promise<{ scheduled: number }>;
  cancel(options: { tag: string }): Promise<void>;
  checkFullScreenPermission(): Promise<{ capability: FullScreenAlarmCapability }>;
  openFullScreenSettings(): Promise<void>;
  getPendingActions(): Promise<{ actions: NativeMedicationAlarmAction[] }>;
  snooze(options: { tag: string; data: Record<string, unknown>; minutes: number }): Promise<void>;
}

interface NativeAlarmNotification {
  id: number;
  at: number;
  title: string;
  body: string;
  tag: string;
  key: string;
  mode: 'fullscreen-short' | 'fullscreen-persistent';
  data: Record<string, unknown>;
}

const plugin = registerPlugin<NativeAlarmPlugin>('MedicationAlarm');

export function nativeMedicationAlarmAvailable(): boolean {
  return Capacitor.getPlatform() === 'android' && Capacitor.isNativePlatform();
}

export async function reconcileNativeMedicationAlarms(
  notifications: readonly ScheduledReminderNotification[],
  notificationIdFor: (tag: string, key?: string) => number,
): Promise<number> {
  if (!nativeMedicationAlarmAvailable()) return 0;
  const native = notifications.flatMap((notification): NativeAlarmNotification[] => {
    const mode = notification.data?.reminderMode;
    if (mode !== 'fullscreen-short' && mode !== 'fullscreen-persistent') return [];
    const key = notification.key ?? 'dose';
    return [{
      id: notificationIdFor(notification.tag, key),
      at: notification.at,
      title: notification.title,
      body: notification.body,
      tag: notification.tag,
      key,
      mode,
      data: notification.data ?? {},
    }];
  });
  const result = await plugin.reconcile({ notifications: native });
  return result.scheduled;
}

export async function cancelNativeMedicationAlarm(tag: string): Promise<void> {
  if (!nativeMedicationAlarmAvailable()) return;
  await plugin.cancel({ tag });
}

export async function checkFullScreenAlarmCapability(): Promise<FullScreenAlarmCapability> {
  if (!nativeMedicationAlarmAvailable()) return 'unavailable';
  return (await plugin.checkFullScreenPermission()).capability;
}

export async function openFullScreenAlarmSettings(): Promise<void> {
  if (!nativeMedicationAlarmAvailable()) return;
  await plugin.openFullScreenSettings();
}

export async function takePendingMedicationAlarmActions(): Promise<NativeMedicationAlarmAction[]> {
  if (!nativeMedicationAlarmAvailable()) return [];
  return (await plugin.getPendingActions()).actions ?? [];
}

export async function snoozeNativeMedicationAlarm(action: NativeMedicationAlarmAction): Promise<void> {
  if (!nativeMedicationAlarmAvailable()) return;
  await plugin.snooze({ tag: action.tag, data: action.data, minutes: 10 });
}
