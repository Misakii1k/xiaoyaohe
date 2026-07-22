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
  fireNow(options: { mode?: string; title?: string; body?: string }): Promise<void>;
}

interface NativeAlarmNotification {
  id: number;
  at: number;
  title: string;
  body: string;
  tag: string;
  key: string;
  mode: 'strong' | 'fullscreen-short' | 'fullscreen-persistent';
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
    // Android 用药提醒统一走原生 AlarmManager + 通知通道，避免与 LocalNotifications 双轨漏响。
    const rawMode = notification.data?.reminderMode;
    const mode =
      rawMode === 'fullscreen-short' || rawMode === 'fullscreen-persistent' || rawMode === 'strong'
        ? rawMode
        : 'strong';
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

/** Immediate strong / full-screen alarm for settings self-test. */
export async function fireNativeMedicationAlarmNow(
  mode: 'strong' | 'fullscreen-short' | 'fullscreen-persistent' = 'fullscreen-short',
): Promise<void> {
  if (!nativeMedicationAlarmAvailable()) return;
  await plugin.fireNow({
    mode,
    title: mode === 'strong' ? '测试增强通知' : '测试全屏提醒',
    body: mode === 'strong'
      ? '高优先级通知 + 铃声振动（锁屏可见）'
      : '应点亮屏幕并显示全屏服药页',
  });
}
