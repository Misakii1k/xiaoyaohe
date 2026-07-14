import {
  getReminderTransport,
  type ExactAlarmCapability,
  type ReminderAction,
  type ScheduledReminderNotification,
} from './reminderTransport';

export const REMINDER_CAPABILITY_CHANGE_EVENT = 'medbox:reminder-capability-change';

export interface NotifyOpts {
  body: string;
  /** Notifications sharing a tag are cancelled together after an intake action. */
  tag: string;
  /** Stable phase within a tag (`dose`, `repeat-2`, `care`). */
  key?: string;
  silent?: boolean;
  data?: Record<string, unknown>;
}

let actionCleanup: (() => void) | undefined;

export function notificationsSupported(): boolean {
  return getReminderTransport().isSupported();
}

export function isNativeReminderPlatform(): boolean {
  return getReminderTransport().platform === 'android';
}

export function getPermission(): NotificationPermission {
  return getReminderTransport().getPermission();
}

export async function refreshPermission(): Promise<NotificationPermission> {
  return getReminderTransport().refreshPermission();
}

export async function requestPermission(): Promise<NotificationPermission> {
  const permission = await getReminderTransport().requestPermission();
  dispatchCapabilityChange();
  return permission;
}

export function getExactAlarmCapability(): ExactAlarmCapability {
  return getReminderTransport().getExactAlarmCapability();
}

export async function refreshExactAlarmCapability(): Promise<ExactAlarmCapability> {
  return getReminderTransport().checkExactAlarmCapability();
}

export async function requestExactAlarmCapability(): Promise<ExactAlarmCapability> {
  const capability = await getReminderTransport().requestExactAlarmCapability();
  dispatchCapabilityChange();
  return capability;
}

export async function initializeNotifier(
  onAction?: (action: ReminderAction) => void,
): Promise<void> {
  const transport = getReminderTransport();
  await Promise.all([
    transport.refreshPermission(),
    transport.checkExactAlarmCapability(),
  ]);
  if (onAction && !actionCleanup) {
    actionCleanup = await transport.addActionListener(onAction);
  }
  dispatchCapabilityChange();
}

/** Display an immediate notification. Resolves true only after the transport accepts it. */
export async function showNotification(title: string, opts: NotifyOpts): Promise<boolean> {
  return getReminderTransport().show({
    title,
    body: opts.body,
    tag: opts.tag,
    key: opts.key,
    silent: opts.silent,
    data: opts.data,
  });
}

export async function reconcileScheduledNotifications(
  notifications: readonly ScheduledReminderNotification[],
) {
  return getReminderTransport().reconcile(notifications);
}

export async function closeNotificationsByTag(tag: string): Promise<void> {
  await getReminderTransport().cancelByTag(tag);
}

function dispatchCapabilityChange(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(REMINDER_CAPABILITY_CHANGE_EVENT));
  }
}
