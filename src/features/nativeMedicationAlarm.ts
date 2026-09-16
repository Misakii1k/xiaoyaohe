import { Capacitor, registerPlugin } from '@capacitor/core';
import { getAlarmScanExpectedToken, isAlarmScanVerifyEnabled } from './alarmScanVerify';
import type { ScheduledReminderNotification } from './reminderTransport';

export type FullScreenAlarmCapability = 'granted' | 'denied' | 'unavailable';

export interface NativeMedicationAlarmAction {
  /** 原生侧生成的 action 唯一 id：非破坏性队列，处理成功后按 id acknowledge 移除 */
  id: string;
  actionId: 'taken' | 'snooze' | 'skip' | 'all-taken';
  tag: string;
  data: Record<string, unknown>;
}

interface NativeAlarmPlugin {
  reconcile(options: { notifications: NativeAlarmNotification[] }): Promise<{ scheduled: number }>;
  cancel(options: { tag: string }): Promise<void>;
  checkFullScreenPermission(): Promise<{ capability: FullScreenAlarmCapability; overlayCapability?: FullScreenAlarmCapability; canDrawOverlays?: boolean }>;
  openFullScreenSettings(): Promise<void>;
  checkOverlayPermission?(): Promise<{ capability: FullScreenAlarmCapability; granted: boolean }>;
  openOverlaySettings?(): Promise<void>;
  getPendingActions(): Promise<{ actions: NativeMedicationAlarmAction[] }>;
  /** 非破坏性确认：只移除已处理成功的 action（防丢），未确认项保留待下次重放 */
  acknowledgeActions(options: { ids: string[] }): Promise<void>;
  snooze(options: { tag: string; data: Record<string, unknown>; minutes: number }): Promise<void>;
  fireNow(options: { mode?: string; title?: string; body?: string; scanVerify?: boolean; scanToken?: string }): Promise<void>;
  isAccessibilityServiceEnabled(): Promise<{ enabled: boolean }>;
  openAccessibilitySettings(): Promise<void>;
  getRingtonePreference(): Promise<{ ringtone: string }>;
  setRingtonePreference(options: { ringtone: string }): Promise<{ ringtone: string; success: boolean }>;
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
  /** 开启「扫码解除强制提醒」时置 true，全屏页需扫码后才能出现操作按钮 */
  scanVerify?: boolean;
  /** 解锁码完整内容（含前缀），闹钟页相机扫描结果与之比对 */
  scanToken?: string;
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
  const scanVerify = isAlarmScanVerifyEnabled();
  const scanToken = scanVerify ? getAlarmScanExpectedToken() : undefined;
  const native = notifications.flatMap((notification): NativeAlarmNotification[] => {
    // Android 用药提醒统一走原生 AlarmManager + 通知通道，避免与 LocalNotifications 双轨漏响。
    // 组载荷（V2）用 data.mode，旧单药载荷用 data.reminderMode，两者都识别。
    const rawMode = notification.data?.mode ?? notification.data?.reminderMode;
    const mode =
      rawMode === 'fullscreen-short' || rawMode === 'fullscreen-persistent' || rawMode === 'strong'
        ? rawMode
        : 'strong';
    const key = notification.key ?? 'dose';
    // scan 标记同时放顶层与 data：顶层供当次调度，data 副本保证贪睡重建
    // （buildSnoozePayload 只透传 data）后的闹钟仍要求扫码。
    const withScanData = scanVerify && scanToken
      ? { ...(notification.data ?? {}), scanVerify: true, scanToken }
      : (notification.data ?? {});
    return [{
      id: notificationIdFor(notification.tag, key),
      at: notification.at,
      title: notification.title,
      body: notification.body,
      tag: notification.tag,
      key,
      mode,
      data: withScanData,
      ...(scanVerify && scanToken ? { scanVerify, scanToken } : {}),
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

export async function acknowledgeNativeMedicationAlarmActions(ids: readonly string[]): Promise<void> {
  if (!nativeMedicationAlarmAvailable() || ids.length === 0) return;
  await plugin.acknowledgeActions({ ids: [...ids] });
}

export async function snoozeNativeMedicationAlarm(action: NativeMedicationAlarmAction): Promise<void> {
  if (!nativeMedicationAlarmAvailable()) return;
  await plugin.snooze({ tag: action.tag, data: action.data, minutes: 10 });
}

export async function fireNativeMedicationAlarmNow(
  mode: 'strong' | 'fullscreen-short' | 'fullscreen-persistent' = 'strong',
  options?: { forceScanVerify?: boolean },
): Promise<void> {
  if (!nativeMedicationAlarmAvailable()) return;
  const scanVerify = options?.forceScanVerify !== undefined
    ? options.forceScanVerify
    : isAlarmScanVerifyEnabled();
  const scanToken = scanVerify
    ? getAlarmScanExpectedToken()
    : undefined;
  await plugin.fireNow({
    mode,
    title: '测试强提醒',
    body: '应自动弹出全屏服药页；被系统拦截时以高优先级通知兜底（锁屏可见）',
    ...(scanVerify && scanToken ? { scanVerify, scanToken } : {}),
  });
}

export async function checkAccessibilityGuardEnabled(): Promise<boolean> {
  if (!nativeMedicationAlarmAvailable()) return false;
  try {
    const result = await plugin.isAccessibilityServiceEnabled();
    return !!result?.enabled;
  } catch {
    return false;
  }
}

export async function openAccessibilityGuardSettings(): Promise<void> {
  if (!nativeMedicationAlarmAvailable()) return;
  try {
    await plugin.openAccessibilitySettings();
  } catch {
    // 忽略异常
  }
}

export async function getNativeAlarmRingtone(): Promise<string | null> {
  if (!nativeMedicationAlarmAvailable()) return null;
  try {
    const res = await plugin.getRingtonePreference();
    return res?.ringtone ?? null;
  } catch {
    return null;
  }
}

export async function setNativeAlarmRingtone(ringtone: string): Promise<boolean> {
  if (!nativeMedicationAlarmAvailable()) return false;
  try {
    const res = await plugin.setRingtonePreference({ ringtone });
    return res?.success ?? false;
  } catch {
    return false;
  }
}

export async function checkOverlayCapability(): Promise<FullScreenAlarmCapability> {
  if (!nativeMedicationAlarmAvailable()) return 'unavailable';
  try {
    const result = await plugin.checkOverlayPermission?.();
    return result?.capability ?? 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export async function openOverlaySettings(): Promise<void> {
  if (!nativeMedicationAlarmAvailable()) return;
  try {
    await plugin.openOverlaySettings?.();
  } catch {}
}

