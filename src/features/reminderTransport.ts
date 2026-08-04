import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import {
  LocalNotifications,
  type ActionPerformed,
  type LocalNotificationSchema,
  type LocalNotificationsPlugin,
  type PendingLocalNotificationSchema,
} from '@capacitor/local-notifications';
import {
  cancelNativeMedicationAlarm,
  reconcileNativeMedicationAlarms,
} from './nativeMedicationAlarm';
import { WebReminderTransport } from './webReminderTransport';
import { reportSilentFailure } from '../app/diagnostics';

const OWNER = 'medbox-medication-reminder-v1';
const REGISTRY_KEY = 'medbox.reminder.notification-ids.v1';
/**
 * Android 对单个 uid 的并发闹钟硬顶大约 500（真机 log：Maximum limit of concurrent alarms 500）。
 * Capacitor Android 在 LocalNotifications.schedule 抛 IllegalStateException 时，
 * 会在 CapacitorPlugins 线程变成 FATAL EXCEPTION 直接杀进程（JS catch 拦不住）。
 * 因此必须：1) 调度前先清空旧闹钟；2) 数量远低于 500。
 */
const MAX_NATIVE_REMINDERS = 120;
const SCHEDULE_CHUNK = 20;
const REGISTRY_RETENTION_MS = 45 * 24 * 60 * 60 * 1000;
const ACTION_TYPE_ID = 'medication-reminder-actions-v1';
const STRONG_CHANNEL_ID = 'medication_strong_v2';
const ALARM_CHANNEL_ID = 'medication_alarm_v1';

interface TruncationInfo {
  truncated: number;
  at: number;
}

let lastTruncation: TruncationInfo | null = null;

/** 最近一次 reconcile 因上限未排入的提醒数量；UI 层据此提示「提醒数量已达上限」。 */
export function getLastTruncationInfo(): TruncationInfo | null {
  return lastTruncation;
}

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
  // 32 位 FNV-1a 哈希存在碰撞可能：极端情况下两个不同 (tag, key) 会得到同一 id，
  // 导致同 id 通知相互覆盖。按单个用户的规则规模碰撞概率可忽略，暂不引入 64 位哈希。
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
  private initialized = false;

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
    await this.ensureInitialized();
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
      lastTruncation = { truncated: 0, at: this.now() };
      return {
        status: 'permission-denied',
        scheduled: 0,
        cancelled: 0,
        truncated: 0,
        exactAlarm,
      };
    }
    await this.ensureInitialized();

    const future = notifications
      .filter((notification) => Number.isFinite(notification.at) && notification.at > this.now())
      .sort((left, right) => left.at - right.at || left.tag.localeCompare(right.tag));
    const selected = future.slice(0, MAX_NATIVE_REMINDERS);
    // Android 原生 MedicationAlarm 负责全部用药提醒；LocalNotifications 仅作清理/兜底，
    // 避免与全屏闹钟双轨并发导致重复或漏响。
    const useNativeAlarms = Capacitor.getPlatform() === 'android' && Capacitor.isNativePlatform();
    const desired = new Map<number, LocalNotificationSchema>();
    if (!useNativeAlarms) {
      for (const notification of selected) {
        const key = notification.key ?? 'dose';
        const id = notificationIdFor(notification.tag, key);
        desired.set(id, this.toNativeNotification(notification, id, notification.at));
      }
    }

    // 策略：永远「先清空再重建」。增量 diff 在闹钟已顶满时，
    // Capacitor 原生 schedule 会抛 IllegalStateException 并直接杀进程。
    try {
      const pendingResult = await this.plugin.getPending();
      // 注册表里的历史 id 一起纳入取消目标，避免 getPending 漏掉的残留闹钟；
      // 无 envelope 的 pending 仅在 id 已在注册表登记时才视为本应用的提醒，避免误伤其他本地通知。
      const registry = this.readRegistry();
      const registryIds = Object.values(registry).flatMap((entry) => entry.ids);
      const registryIdSet = new Set(registryIds);
      const allPending = pendingResult.notifications.filter(
        (pending) => isMedicationPending(pending, registryIdSet),
      );
      const cancelTargets = [...new Set([...allPending.map(({ id }) => id), ...registryIds])];
      const cancelled = await this.cancelIds(cancelTargets);

      // 清空后再挂；任一分片失败立刻停，绝不让异常冒泡
      const scheduled = await this.scheduleInChunksSafe([...desired.values()]);
      const nativeScheduled = await reconcileNativeMedicationAlarms(selected, notificationIdFor).catch(
        (error) => {
          reportSilentFailure('reminder.native-reconcile', error);
          return 0;
        },
      );
      if (useNativeAlarms) {
        const next: ReminderRegistry = {};
        const now = this.now();
        for (const notification of selected) {
          const key = notification.key ?? 'dose';
          const id = notificationIdFor(notification.tag, key);
          const entry = next[notification.tag] ?? { ids: [], updatedAt: now };
          entry.ids = [...new Set([...entry.ids, id])];
          entry.updatedAt = now;
          next[notification.tag] = entry;
        }
        this.writeRegistry(next);
      } else {
        this.replaceRegistryFromDesired(
          new Map([...desired.entries()].filter(([id]) => scheduled.ids.has(id))),
        );
      }
      this.purgeRegistry();

      const scheduledCount = useNativeAlarms ? nativeScheduled : scheduled.ids.size;
      const truncated = Math.max(0, future.length - selected.length) + (useNativeAlarms ? 0 : scheduled.skipped);
      lastTruncation = { truncated, at: this.now() };
      return {
        status: useNativeAlarms
          ? nativeScheduled > 0 || selected.length === 0
            ? 'ok'
            : 'failed'
          : scheduled.failed === 0
            ? 'ok'
            : scheduled.ids.size > 0
              ? 'ok'
              : 'failed',
        scheduled: scheduledCount,
        cancelled,
        truncated,
        exactAlarm,
      };
    } catch (error) {
      reportSilentFailure('reminder.reconcile', error);
      try {
        const all = (await this.plugin.getPending()).notifications;
        await this.cancelIds(all.map(({ id }) => id));
        this.writeRegistry({});
      } catch (cleanupError) {
        reportSilentFailure('reminder.reconcile-cleanup', cleanupError);
        /* ignore */
      }
      const truncated = Math.max(0, future.length - selected.length);
      lastTruncation = { truncated, at: this.now() };
      return {
        status: 'failed',
        scheduled: 0,
        cancelled: 0,
        truncated,
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
      await cancelNativeMedicationAlarm(tag).catch(() => undefined);
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

  /**
 * 分片调度；任一片失败就停止后续，返回已成功 id。
 * 注意：部分 Capacitor 版本会把插件异常变成原生线程崩溃，因此调用前必须先 cancel 腾出配额。
 */
private async scheduleInChunksSafe(
    notifications: LocalNotificationSchema[],
  ): Promise<{ ids: Set<number>; failed: number; skipped: number }> {
    const ids = new Set<number>();
    let failed = 0;
    let skipped = 0;
    for (let offset = 0; offset < notifications.length; offset += SCHEDULE_CHUNK) {
      const chunk = notifications.slice(offset, offset + SCHEDULE_CHUNK);
      if (chunk.length === 0) continue;
      try {
        await this.plugin.schedule({ notifications: chunk });
        for (const item of chunk) ids.add(item.id);
      } catch (error) {
        reportSilentFailure('reminder.schedule-chunk', error);
        failed += 1;
        skipped += notifications.length - offset;
        break;
      }
    }
    return { ids, failed, skipped };
  }

  private async cancelIds(ids: readonly number[]): Promise<number> {
    const unique = [...new Set(ids.filter((id) => Number.isInteger(id)))];
    let cancelled = 0;
    for (let offset = 0; offset < unique.length; offset += 80) {
      const chunk = unique.slice(offset, offset + 80);
      if (chunk.length === 0) continue;
      await this.plugin.cancel({ notifications: chunk.map((id) => ({ id })) });
      cancelled += chunk.length;
    }
    return cancelled;
  }

  private replaceRegistryFromDesired(desired: Map<number, LocalNotificationSchema>): void {
    const idsByTag = new Map<string, number[]>();
    for (const native of desired.values()) {
      const envelope = readEnvelope(native.extra);
      if (!envelope) continue;
      const ids = idsByTag.get(envelope.tag) ?? [];
      ids.push(native.id);
      idsByTag.set(envelope.tag, ids);
    }
    // 用本轮 desired 全量覆盖，避免 registry 无限累积历史 id
    const next: ReminderRegistry = {};
    const now = this.now();
    for (const [tag, ids] of idsByTag) {
      next[tag] = { ids: [...new Set(ids)], updatedAt: now };
    }
    this.writeRegistry(next);
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
    // 组载荷（V2）用 data.mode，旧单药载荷用 data.reminderMode，两者都识别
    const reminderMode = notification.data?.mode ?? notification.data?.reminderMode;
    const native: LocalNotificationSchema = {
      id,
      title: notification.title,
      body: notification.body,
      largeBody: notification.body,
      autoCancel: true,
      actionTypeId: ACTION_TYPE_ID,
      channelId:
        reminderMode === 'fullscreen-short' || reminderMode === 'fullscreen-persistent'
          ? ALARM_CHANNEL_ID
          : STRONG_CHANNEL_ID,
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

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    try {
      await Promise.all([
        this.plugin.createChannel({
        id: STRONG_CHANNEL_ID,
        name: '用药增强提醒',
        description: '高优先级用药通知、声音和振动',
        importance: 5,
        visibility: 1,
        vibration: true,
        lights: true,
        lightColor: '#17745B',
      }),
        this.plugin.createChannel({
        id: ALARM_CHANNEL_ID,
        name: '用药全屏提醒',
        description: '需要立即处理的全屏用药提醒',
        importance: 5,
        visibility: 1,
        vibration: true,
        lights: true,
        lightColor: '#17745B',
      }),
        this.plugin.registerActionTypes({
        types: [{
          id: ACTION_TYPE_ID,
          actions: [
            { id: 'taken', title: '已服用', foreground: true },
            { id: 'snooze', title: '10 分钟后提醒', foreground: true },
            { id: 'skip', title: '跳过', foreground: true, destructive: true },
          ],
        }],
        }),
      ]);
    } catch {
      // Older or mocked plugin implementations can still use the default channel.
    }
    this.initialized = true;
  }

  private remember(tag: string, ids: readonly number[]): void {
    const registry = this.readRegistry();
    registry[tag] = {
      ids: [...new Set(ids)],
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

/**
 * 兜底通道：当前浏览器**确实**没有承载提醒的能力。
 *
 * 命中场景是真实存在的，不是「网页端一律不支持」：
 * - 通过局域网 http://192.168.x.x 打开（非安全上下文，Service Worker 不可用）
 * - 浏览器/系统层面禁用了通知或 Service Worker
 * - 老旧 iOS Safari（网页通知需 16.4+ 且已添加到主屏幕）
 *
 * 具备能力的浏览器走 `WebReminderTransport`，见 `webReminderTransport.ts`。
 */
export class UnsupportedBrowserReminderTransport implements ReminderTransport {
  readonly platform = 'web' as const;

  isSupported(): boolean {
    return false;
  }

  getPermission(): NotificationPermission {
    return 'denied';
  }

  async refreshPermission(): Promise<NotificationPermission> {
    return this.getPermission();
  }

  async requestPermission(): Promise<NotificationPermission> {
    return 'denied';
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

  async show(): Promise<boolean> {
    return false;
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

  async cancelByTag(): Promise<void> {
    // No-op: browser previews do not own notification state.
  }

  async addActionListener(): Promise<() => void> {
    // No-op: browser previews never receive notification actions.
    return () => undefined;
  }
}

let transport: ReminderTransport | undefined;

export function getReminderTransport(): ReminderTransport {
  transport ??= createReminderTransport();
  return transport;
}

function createReminderTransport(): ReminderTransport {
  if (isAndroidNative()) return new AndroidReminderTransport();
  const web = new WebReminderTransport();
  // 能力探测放在这里而不是让 WebReminderTransport 自己报「不支持」，
  // 是为了让 `platform === 'web' 且 isSupported()` 恒等于「网页端真的能提醒」。
  return web.isSupported() ? web : new UnsupportedBrowserReminderTransport();
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

/**
 * 只把带用药提醒 envelope 的 pending 视为本应用提醒；没有 envelope 的
 * 仅当其 id 出现在注册表（notificationIdFor 登记表）时才纳入清理，
 * 避免把所有本地通知都当作用药提醒误删。
 */
function isMedicationPending(
  notification: PendingLocalNotificationSchema,
  registryIds: ReadonlySet<number>,
): boolean {
  if (isOwnedPending(notification)) return true;
  return typeof notification.id === 'number' && registryIds.has(notification.id);
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
