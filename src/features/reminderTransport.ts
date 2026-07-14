import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import {
  LocalNotifications,
  type ActionPerformed,
  type LocalNotificationSchema,
  type LocalNotificationsPlugin,
  type PendingLocalNotificationSchema,
} from '@capacitor/local-notifications';

const OWNER = 'medbox-medication-reminder-v1';
const REGISTRY_KEY = 'medbox.reminder.notification-ids.v1';
const MAX_NATIVE_REMINDERS = 512;
const REGISTRY_RETENTION_MS = 45 * 24 * 60 * 60 * 1000;

export type ExactAlarmCapability = 'granted' | 'denied' | 'prompt' | 'unavailable';
export type ReminderPlatform = 'android' | 'web';

export interface ReminderNotification {
  title: string;
  body: string;
  tag: string;
  /** Stable within a tag, for example `dose`, `repeat-2`, or `care`. */
  key?: string;
  silent?: boolean;
  data?: Record<string, unknown>;
}

export interface ScheduledReminderNotification extends ReminderNotification {
  at: number;
  allowWhileIdle?: boolean;
}

export interface ReminderAction {
  actionId: string;
  tag: string;
  data: Record<string, unknown>;
}

export interface ReminderReconcileResult {
  status: 'ok' | 'unsupported' | 'permission-denied' | 'failed';
  scheduled: number;
  cancelled: number;
  truncated: number;
  exactAlarm: ExactAlarmCapability;
}

export interface ReminderTransport {
  readonly platform: ReminderPlatform;
  isSupported(): boolean;
  getPermission(): NotificationPermission;
  refreshPermission(): Promise<NotificationPermission>;
  requestPermission(): Promise<NotificationPermission>;
  getExactAlarmCapability(): ExactAlarmCapability;
  checkExactAlarmCapability(): Promise<ExactAlarmCapability>;
  requestExactAlarmCapability(): Promise<ExactAlarmCapability>;
  show(notification: ReminderNotification): Promise<boolean>;
  reconcile(notifications: readonly ScheduledReminderNotification[]): Promise<ReminderReconcileResult>;
  cancelByTag(tag: string): Promise<void>;
  addActionListener(listener: (action: ReminderAction) => void): Promise<() => void>;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface NativeEnvelope {
  owner: typeof OWNER;
  tag: string;
  key: string;
  data: Record<string, unknown>;
}

interface RegistryEntry {
  ids: number[];
  updatedAt: number;
}

type ReminderRegistry = Record<string, RegistryEntry>;

export function notificationIdFor(tag: string, key = 'dose'): number {
  let hash = 0x811c9dc5;
  const value = `${tag}\u0000${key}`;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  // Keep IDs positive and non-zero for Android's signed 32-bit requirement.
  return (hash & 0x7fffffff) || 1;
}

export class AndroidReminderTransport implements ReminderTransport {
  readonly platform = 'android' as const;
  private permission: NotificationPermission = 'default';
  private exactAlarm: ExactAlarmCapability = 'prompt';

  constructor(
    private readonly plugin: LocalNotificationsPlugin = LocalNotifications,
    private readonly storage: KeyValueStore = defaultStorage(),
    private readonly now: () => number = Date.now,
  ) {}

  isSupported(): boolean {
    return true;
  }

  getPermission(): NotificationPermission {
    return this.permission;
  }

  async refreshPermission(): Promise<NotificationPermission> {
    try {
      const result = await this.plugin.checkPermissions();
      this.permission = mapPermission(result.display);
    } catch {
      this.permission = 'default';
    }
    return this.permission;
  }

  async requestPermission(): Promise<NotificationPermission> {
    try {
      const result = await this.plugin.requestPermissions();
      this.permission = mapPermission(result.display);
    } catch {
      this.permission = 'denied';
    }
    return this.permission;
  }

  getExactAlarmCapability(): ExactAlarmCapability {
    return this.exactAlarm;
  }

  async checkExactAlarmCapability(): Promise<ExactAlarmCapability> {
    try {
      const result = await this.plugin.checkExactNotificationSetting();
      this.exactAlarm = mapExactAlarm(result.exact_alarm);
    } catch {
      this.exactAlarm = 'unavailable';
    }
    return this.exactAlarm;
  }

  async requestExactAlarmCapability(): Promise<ExactAlarmCapability> {
    try {
      const result = await this.plugin.changeExactNotificationSetting();
      this.exactAlarm = mapExactAlarm(result.exact_alarm);
    } catch {
      this.exactAlarm = 'unavailable';
    }
    return this.exactAlarm;
  }

  async show(notification: ReminderNotification): Promise<boolean> {
    if ((await this.refreshPermission()) !== 'granted') return false;
    const key = notification.key ?? 'dose';
    const id = notificationIdFor(notification.tag, key);
    try {
      await this.plugin.schedule({
        notifications: [this.toNativeNotification(notification, id)],
      });
      this.remember(notification.tag, [id]);
      return true;
    } catch {
      return false;
    }
  }

  async reconcile(
    notifications: readonly ScheduledReminderNotification[],
  ): Promise<ReminderReconcileResult> {
    const exactAlarm = await this.checkExactAlarmCapability();
    if ((await this.refreshPermission()) !== 'granted') {
      return {
        status: 'permission-denied',
        scheduled: 0,
        cancelled: 0,
        truncated: 0,
        exactAlarm,
      };
    }

    const future = notifications
      .filter((notification) => Number.isFinite(notification.at) && notification.at > this.now())
      .sort((left, right) => left.at - right.at || left.tag.localeCompare(right.tag));
    const selected = future.slice(0, MAX_NATIVE_REMINDERS);
    const desired = new Map<number, LocalNotificationSchema>();
    for (const notification of selected) {
      const key = notification.key ?? 'dose';
      const id = notificationIdFor(notification.tag, key);
      desired.set(id, this.toNativeNotification(notification, id, notification.at));
    }

    try {
      const pendingResult = await this.plugin.getPending();
      const ownedPending = pendingResult.notifications.filter(isOwnedPending);
      const stale = ownedPending.filter((pending) => {
        const wanted = desired.get(pending.id);
        return !wanted || !sameNativeNotification(pending, wanted);
      });
      if (stale.length > 0) {
        await this.plugin.cancel({ notifications: stale.map(({ id }) => ({ id })) });
      }

      const stillPendingIds = new Set(
        ownedPending.filter((pending) => !stale.includes(pending)).map(({ id }) => id),
      );
      const missing = [...desired.values()].filter(({ id }) => !stillPendingIds.has(id));
      for (let offset = 0; offset < missing.length; offset += 50) {
        await this.plugin.schedule({ notifications: missing.slice(offset, offset + 50) });
      }

      const idsByTag = new Map<string, number[]>();
      for (const native of desired.values()) {
        const envelope = readEnvelope(native.extra);
        if (!envelope) continue;
        const ids = idsByTag.get(envelope.tag) ?? [];
        ids.push(native.id);
        idsByTag.set(envelope.tag, ids);
      }
      for (const [tag, ids] of idsByTag) this.remember(tag, ids);
      this.purgeRegistry();

      return {
        status: 'ok',
        scheduled: missing.length,
        cancelled: stale.length,
        truncated: Math.max(0, future.length - selected.length),
        exactAlarm,
      };
    } catch {
      return {
        status: 'failed',
        scheduled: 0,
        cancelled: 0,
        truncated: Math.max(0, future.length - selected.length),
        exactAlarm,
      };
    }
  }

  async cancelByTag(tag: string): Promise<void> {
    try {
      const pending = await this.plugin.getPending();
      const pendingIds = pending.notifications
        .filter((notification) => readEnvelope(notification.extra)?.tag === tag)
        .map(({ id }) => id);
      const storedIds = this.readRegistry()[tag]?.ids ?? [];
      const ids = [...new Set([...pendingIds, ...storedIds])];
      if (ids.length > 0) {
        await this.plugin.cancel({ notifications: ids.map((id) => ({ id })) });
      }
      const registry = this.readRegistry();
      delete registry[tag];
      this.writeRegistry(registry);
    } catch {
      // Cancelling a stale notification must never block an intake action.
    }
  }

  async addActionListener(listener: (action: ReminderAction) => void): Promise<() => void> {
    const handle: PluginListenerHandle = await this.plugin.addListener(
      'localNotificationActionPerformed',
      (performed: ActionPerformed) => {
        const envelope = readEnvelope(performed.notification.extra);
        if (!envelope) return;
        listener({
          actionId: performed.actionId,
          tag: envelope.tag,
          data: envelope.data,
        });
      },
    );
    return () => void handle.remove();
  }

  private toNativeNotification(
    notification: ReminderNotification,
    id: number,
    at?: number,
  ): LocalNotificationSchema {
    const key = notification.key ?? 'dose';
    const envelope: NativeEnvelope = {
      owner: OWNER,
      tag: notification.tag,
      key,
      data: notification.data ?? {},
    };
    const native: LocalNotificationSchema = {
      id,
      title: notification.title,
      body: notification.body,
      largeBody: notification.body,
      autoCancel: true,
      extra: { __medboxReminder: envelope },
      silent: notification.silent ?? false,
    };
    if (at != null) {
      const local = new Date(at);
      native.schedule = {
        on: {
          year: local.getFullYear(),
          month: local.getMonth() + 1,
          day: local.getDate(),
          hour: local.getHours(),
          minute: local.getMinutes(),
          second: local.getSeconds(),
        },
        allowWhileIdle:
          'allowWhileIdle' in notification
            ? (notification as ScheduledReminderNotification).allowWhileIdle !== false
            : true,
      };
    }
    return native;
  }

  private remember(tag: string, ids: readonly number[]): void {
    const registry = this.readRegistry();
    const oldIds = registry[tag]?.ids ?? [];
    registry[tag] = {
      ids: [...new Set([...oldIds, ...ids])],
      updatedAt: this.now(),
    };
    this.writeRegistry(registry);
  }

  private purgeRegistry(): void {
    const registry = this.readRegistry();
    const cutoff = this.now() - REGISTRY_RETENTION_MS;
    let changed = false;
    for (const [tag, entry] of Object.entries(registry)) {
      if (entry.updatedAt < cutoff) {
        delete registry[tag];
        changed = true;
      }
    }
    if (changed) this.writeRegistry(registry);
  }

  private readRegistry(): ReminderRegistry {
    try {
      const parsed = JSON.parse(this.storage.getItem(REGISTRY_KEY) ?? '{}') as unknown;
      if (!isRecord(parsed)) return {};
      const registry: ReminderRegistry = {};
      for (const [tag, value] of Object.entries(parsed)) {
        if (!isRecord(value) || !Array.isArray(value.ids) || typeof value.updatedAt !== 'number') continue;
        registry[tag] = {
          ids: value.ids.filter((id): id is number => Number.isInteger(id)),
          updatedAt: value.updatedAt,
        };
      }
      return registry;
    } catch {
      return {};
    }
  }

  private writeRegistry(registry: ReminderRegistry): void {
    try {
      if (Object.keys(registry).length === 0) this.storage.removeItem(REGISTRY_KEY);
      else this.storage.setItem(REGISTRY_KEY, JSON.stringify(registry));
    } catch {
      // Registry persistence is best-effort; pending notifications remain queryable.
    }
  }
}

export class WebReminderTransport implements ReminderTransport {
  readonly platform = 'web' as const;

  isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator
    );
  }

  getPermission(): NotificationPermission {
    return this.isSupported() ? Notification.permission : 'denied';
  }

  async refreshPermission(): Promise<NotificationPermission> {
    return this.getPermission();
  }

  async requestPermission(): Promise<NotificationPermission> {
    if (!this.isSupported()) return 'denied';
    return Notification.requestPermission();
  }

  getExactAlarmCapability(): ExactAlarmCapability {
    return 'unavailable';
  }

  async checkExactAlarmCapability(): Promise<ExactAlarmCapability> {
    return 'unavailable';
  }

  async requestExactAlarmCapability(): Promise<ExactAlarmCapability> {
    return 'unavailable';
  }

  async show(notification: ReminderNotification): Promise<boolean> {
    if (this.getPermission() !== 'granted') return false;
    try {
      const registration = await navigator.serviceWorker.ready;
      const options: NotificationOptions = {
        body: notification.body,
        tag: notification.tag,
        requireInteraction: true,
        silent: notification.silent ?? false,
        icon: '/icons/icon-192.png',
        data: notification.data,
        ...({
          vibrate: [400, 200, 400, 200, 400],
          badge: '/icons/icon-192.png',
        } as Record<string, unknown>),
      };
      await registration.showNotification(notification.title, options);
      if (!notification.silent && typeof navigator.vibrate === 'function') {
        navigator.vibrate([400, 200, 400, 200, 400]);
      }
      return true;
    } catch {
      return false;
    }
  }

  async reconcile(): Promise<ReminderReconcileResult> {
    return {
      status: 'unsupported',
      scheduled: 0,
      cancelled: 0,
      truncated: 0,
      exactAlarm: 'unavailable',
    };
  }

  async cancelByTag(tag: string): Promise<void> {
    if (!this.isSupported()) return;
    try {
      const registration = await navigator.serviceWorker.ready;
      const notifications = await registration.getNotifications({ tag });
      for (const notification of notifications) notification.close();
    } catch {
      // Ignore a disappearing service worker during navigation/update.
    }
  }

  async addActionListener(): Promise<() => void> {
    // Generated PWA service workers cannot guarantee click routing once closed.
    return () => undefined;
  }
}

let transport: ReminderTransport | undefined;

export function getReminderTransport(): ReminderTransport {
  transport ??= isAndroidNative()
    ? new AndroidReminderTransport()
    : new WebReminderTransport();
  return transport;
}

export function setReminderTransportForTesting(next: ReminderTransport | undefined): void {
  transport = next;
}

function isAndroidNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

function mapPermission(value: string): NotificationPermission {
  if (value === 'granted') return 'granted';
  if (value === 'denied') return 'denied';
  return 'default';
}

function mapExactAlarm(value: string): ExactAlarmCapability {
  if (value === 'granted') return 'granted';
  if (value === 'denied') return 'denied';
  return 'prompt';
}

function isOwnedPending(notification: PendingLocalNotificationSchema): boolean {
  return readEnvelope(notification.extra)?.owner === OWNER;
}

function readEnvelope(extra: unknown): NativeEnvelope | undefined {
  if (!isRecord(extra)) return undefined;
  const candidate = extra.__medboxReminder;
  if (!isRecord(candidate)) return undefined;
  if (candidate.owner !== OWNER || typeof candidate.tag !== 'string' || typeof candidate.key !== 'string') {
    return undefined;
  }
  return {
    owner: OWNER,
    tag: candidate.tag,
    key: candidate.key,
    data: isRecord(candidate.data) ? candidate.data : {},
  };
}

function sameNativeNotification(
  pending: PendingLocalNotificationSchema,
  wanted: LocalNotificationSchema,
): boolean {
  const pendingEnvelope = readEnvelope(pending.extra);
  const wantedEnvelope = readEnvelope(wanted.extra);
  const pendingOn = pending.schedule?.on;
  const wantedOn = wanted.schedule?.on;
  return (
    pending.title === wanted.title &&
    pending.body === wanted.body &&
    pendingEnvelope?.tag === wantedEnvelope?.tag &&
    pendingEnvelope?.key === wantedEnvelope?.key &&
    pendingOn?.year === wantedOn?.year &&
    pendingOn?.month === wantedOn?.month &&
    pendingOn?.day === wantedOn?.day &&
    pendingOn?.hour === wantedOn?.hour &&
    pendingOn?.minute === wantedOn?.minute &&
    (pendingOn?.second ?? 0) === (wantedOn?.second ?? 0)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultStorage(): KeyValueStore {
  if (typeof localStorage !== 'undefined') return localStorage;
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}
