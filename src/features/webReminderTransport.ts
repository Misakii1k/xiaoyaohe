import type {
  ExactAlarmCapability,
  ReminderAction,
  ReminderNotification,
  ReminderReconcileResult,
  ReminderTransport,
  ScheduledReminderNotification,
} from './reminderTransport';

/**
 * 网页端提醒通道。
 *
 * 与原生端的能力差距必须如实对待：Android App 用系统闹钟（AlarmManager），
 * 到点必响；浏览器**没有**等价机制。这里能做到的只有两层：
 *
 * 1. 页面开着时：`reminderScheduler` 每 60 秒轮询 → `show()` 即时弹通知。准点。
 * 2. 页面关掉后：把未来的提醒计划交给 Service Worker，由它在浏览器愿意唤醒时
 *    （periodicsync / sync，间隔由浏览器决定，实测常以小时计）**补发**已过期的提醒。
 *
 * 第 2 层是补发，不是定时。设置页对用户就是这么写的，不要在别处暗示它能准点。
 *
 * 与 `public/sw.js` 的消息约定（改动时两边必须同步）：
 * - `medbox:reminder-plan`   页面 → SW，全量替换补发计划
 * - `medbox:reminder-cancel` 页面 → SW，某个 tag 已处理，关掉并从计划里摘除
 * - `medbox:reminder-check`  页面 → SW，立刻检查一次（页面即将关闭时用）
 * - `medbox:reminder-drain`  页面 → SW，取回页面关闭期间攒下的通知动作
 * - `medbox:reminder-action` SW → 页面，通知被点击（含按钮）
 */

const PLAN_MESSAGE = 'medbox:reminder-plan';
const CANCEL_MESSAGE = 'medbox:reminder-cancel';
const CHECK_MESSAGE = 'medbox:reminder-check';
const DRAIN_MESSAGE = 'medbox:reminder-drain';
const ACTION_MESSAGE = 'medbox:reminder-action';
const PERIODIC_SYNC_TAG = 'medbox-reminder-catch-up';
const ICON = 'icons/icon-192.png';
/** 计划存在 SW 的 IndexedDB 里，条数只需覆盖几天的排期，取整即可。 */
const MAX_WEB_REMINDERS = 200;
/** `navigator.serviceWorker.ready` 在注册失败时永不 resolve，必须有超时兜底。 */
const REGISTRATION_TIMEOUT_MS = 8_000;
/** periodicsync 的最小间隔只是「不早于」，浏览器可以拖更久，给不了保证。 */
const CATCH_UP_MIN_INTERVAL_MS = 15 * 60 * 1000;

/** TS 的 `NotificationOptions` 不含 `actions`（规范里只有 SW 通知支持），这里补上。 */
export interface WebNotificationOptions {
  body?: string;
  tag?: string;
  icon?: string;
  badge?: string;
  data?: unknown;
  silent?: boolean;
  requireInteraction?: boolean;
  actions?: ReadonlyArray<{ action: string; title: string }>;
}

export interface WebShownNotification {
  readonly tag: string;
  readonly data?: unknown;
  close(): void;
}

/** 页面能对 Service Worker 做的全部操作，抽成接口以便测试注入假实现。 */
export interface WebNotificationTarget {
  showNotification(title: string, options: WebNotificationOptions): Promise<void>;
  getNotifications(): Promise<readonly WebShownNotification[]>;
  postMessage(message: unknown): void;
  /** 申请后台周期唤醒；拿不到就返回 false，调用方不应据此中止。 */
  requestBackgroundCatchUp(): Promise<boolean>;
}

export interface WebReminderHost {
  isSupported(): boolean;
  getPermission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  getTarget(): Promise<WebNotificationTarget | undefined>;
  subscribe(listener: (message: unknown) => void): () => void;
}

/**
 * 浏览器是否具备承载用药提醒的最低能力。
 *
 * 注意 `isSecureContext`：Service Worker 只在 https 或 localhost 可用。
 * 用手机浏览器通过局域网 IP（http://192.168.x.x）打开时注册必定失败，
 * 此时如实报告「不支持」，好过让用户以为提醒已经开着。
 */
export function webRemindersAvailable(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (typeof Notification === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;
  return window.isSecureContext === true;
}

export class WebReminderTransport implements ReminderTransport {
  readonly platform = 'web' as const;

  constructor(private readonly host: WebReminderHost = browserReminderHost()) {}

  isSupported(): boolean {
    return this.host.isSupported();
  }

  getPermission(): NotificationPermission {
    // 浏览器的 Notification.permission 是同步且随时可读的，不需要像原生端那样缓存。
    return this.host.isSupported() ? this.host.getPermission() : 'denied';
  }

  async refreshPermission(): Promise<NotificationPermission> {
    return this.getPermission();
  }

  async requestPermission(): Promise<NotificationPermission> {
    if (!this.host.isSupported()) return 'denied';
    try {
      return await this.host.requestPermission();
    } catch {
      return 'denied';
    }
  }

  /**
   * 浏览器没有「精确闹钟」这一概念（那是 Android 的 SCHEDULE_EXACT_ALARM 权限）。
   * 统一返回 unavailable，设置页据此隐藏整块精确闹钟设置，不给用户假选项。
   */
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
    const target = await this.host.getTarget();
    if (!target) return false;
    try {
      await target.showNotification(notification.title, toOptions(notification));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 把未来的提醒计划整体交给 SW。
   *
   * 返回的 `scheduled` 是「已交给 SW 补发的条数」，**不等于**「一定会准点响」——
   * 网页端没有系统级闹钟。原生端同名字段才是真的排进了 AlarmManager。
   */
  async reconcile(
    notifications: readonly ScheduledReminderNotification[],
  ): Promise<ReminderReconcileResult> {
    if (!this.host.isSupported()) return outcome('unsupported');
    if (this.getPermission() !== 'granted') return outcome('permission-denied');
    const target = await this.host.getTarget();
    if (!target) return outcome('failed');

    const now = Date.now();
    const future = notifications
      .filter((notification) => Number.isFinite(notification.at) && notification.at > now)
      .sort((left, right) => left.at - right.at || left.tag.localeCompare(right.tag));
    const selected = future.slice(0, MAX_WEB_REMINDERS);
    try {
      target.postMessage({
        type: PLAN_MESSAGE,
        notifications: selected.map((notification) => ({
          at: notification.at,
          title: notification.title,
          body: notification.body,
          tag: notification.tag,
          key: notification.key ?? 'dose',
          data: notification.data ?? {},
        })),
      });
      // 拿不到后台唤醒权限也照常返回 ok：页面开着时的轮询提醒仍然有效。
      await target.requestBackgroundCatchUp().catch(() => false);
      return {
        status: 'ok',
        scheduled: selected.length,
        cancelled: 0,
        truncated: future.length - selected.length,
        exactAlarm: 'unavailable',
      };
    } catch {
      return outcome('failed');
    }
  }

  async cancelByTag(tag: string): Promise<void> {
    const target = await this.host.getTarget();
    if (!target) return;
    try {
      const shown = await target.getNotifications();
      for (const notification of shown) {
        if (matchesTag(notification, tag)) notification.close();
      }
      target.postMessage({ type: CANCEL_MESSAGE, tag });
    } catch {
      // 关不掉旧通知不能阻断「已服用」这类记录动作。
    }
  }

  async addActionListener(listener: (action: ReminderAction) => void): Promise<() => void> {
    const unsubscribe = this.host.subscribe((message) => {
      const action = readAction(message);
      if (action) listener(action);
    });
    // 通知在页面关闭时被点掉的情况：SW 会先把动作暂存，页面起来后主动取回。
    void this.host
      .getTarget()
      .then((target) => target?.postMessage({ type: DRAIN_MESSAGE }))
      .catch(() => undefined);
    return unsubscribe;
  }
}

/** 注册网页端提醒用的 Service Worker。原生 App 走系统闹钟，不需要调用。 */
export async function registerWebReminderWorker(): Promise<boolean> {
  if (!webRemindersAvailable()) return false;
  const base = import.meta.env.BASE_URL || '/';
  try {
    await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
    return true;
  } catch {
    // 注册失败（http 局域网、企业策略禁用等）只影响后台补发，前台提醒照常。
    return false;
  }
}

/** 页面即将关闭时踢 SW 一脚，让它把刚过期的提醒补上。纯尽力而为。 */
export function requestWebReminderCatchUp(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    navigator.serviceWorker.controller?.postMessage({ type: CHECK_MESSAGE });
  } catch {
    // 页面正在卸载，失败无从补救也无需补救。
  }
}

export function browserReminderHost(): WebReminderHost {
  return {
    isSupported: webRemindersAvailable,
    getPermission: () => (typeof Notification === 'undefined' ? 'denied' : Notification.permission),
    requestPermission: async () => {
      if (typeof Notification === 'undefined') return 'denied';
      return Notification.requestPermission();
    },
    getTarget: async () => {
      const registration = await readyRegistration();
      return registration ? wrapRegistration(registration) : undefined;
    },
    subscribe: (listener) => {
      if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => undefined;
      const handler = (event: MessageEvent): void => listener(event.data);
      navigator.serviceWorker.addEventListener('message', handler);
      return () => navigator.serviceWorker.removeEventListener('message', handler);
    },
  };
}

async function readyRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined;
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing?.active) return existing;
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<undefined>((resolve) => {
        window.setTimeout(() => resolve(undefined), REGISTRATION_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return undefined;
  }
}

function wrapRegistration(registration: ServiceWorkerRegistration): WebNotificationTarget {
  return {
    showNotification: (title, options) =>
      registration.showNotification(title, options as NotificationOptions),
    getNotifications: () => registration.getNotifications(),
    postMessage: (message) => {
      const worker = registration.active ?? navigator.serviceWorker.controller;
      worker?.postMessage(message);
    },
    requestBackgroundCatchUp: () => requestPeriodicSync(registration),
  };
}

async function requestPeriodicSync(registration: ServiceWorkerRegistration): Promise<boolean> {
  // Periodic Background Sync 目前只有 Chromium 系支持，且必须已「添加到主屏幕」。
  // 拿不到就安静降级，不弹任何东西打扰用户。
  const periodicSync = (
    registration as unknown as {
      periodicSync?: { register(tag: string, options?: { minInterval: number }): Promise<void> };
    }
  ).periodicSync;
  if (!periodicSync) return false;
  try {
    const status = await navigator.permissions.query({
      name: 'periodic-background-sync' as PermissionName,
    });
    if (status.state !== 'granted') return false;
    await periodicSync.register(PERIODIC_SYNC_TAG, { minInterval: CATCH_UP_MIN_INTERVAL_MS });
    return true;
  } catch {
    return false;
  }
}

function toOptions(notification: ReminderNotification): WebNotificationOptions {
  const key = notification.key ?? 'dose';
  return {
    body: notification.body,
    // tag 格式与 public/sw.js 的 showItem 保持一致，否则两边关不掉同一条通知。
    tag: `${notification.tag}::${key}`,
    icon: ICON,
    badge: ICON,
    data: { ...(notification.data ?? {}), tag: notification.tag, key },
    silent: notification.silent ?? false,
    // 吃药提醒不该自己消失；桌面端会一直挂着直到用户处理，移动端浏览器会忽略此项。
    requireInteraction: true,
    actions: [
      { action: 'taken', title: '已服用' },
      { action: 'skip', title: '跳过' },
    ],
  };
}

function matchesTag(notification: WebShownNotification, tag: string): boolean {
  if (notification.tag === tag || notification.tag.startsWith(`${tag}::`)) return true;
  const data = notification.data;
  return isRecord(data) && data.tag === tag;
}

function readAction(message: unknown): ReminderAction | undefined {
  if (!isRecord(message) || message.type !== ACTION_MESSAGE) return undefined;
  if (typeof message.tag !== 'string' || message.tag.length === 0) return undefined;
  return {
    actionId: typeof message.actionId === 'string' ? message.actionId : 'tap',
    tag: message.tag,
    data: isRecord(message.data) ? message.data : {},
  };
}

function outcome(status: ReminderReconcileResult['status']): ReminderReconcileResult {
  return { status, scheduled: 0, cancelled: 0, truncated: 0, exactAlarm: 'unavailable' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
