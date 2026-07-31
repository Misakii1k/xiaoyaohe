import { describe, expect, it, vi } from 'vitest';
import {
  WebReminderTransport,
  type WebNotificationOptions,
  type WebNotificationTarget,
  type WebReminderHost,
  type WebShownNotification,
} from '../src/features/webReminderTransport';

// happy-dom 既没有 Notification 也没有 navigator.serviceWorker，所以这里不依赖
// DOM 环境，改为注入一个假的 host —— 这也正是 WebReminderHost 存在的理由。
function fakeHost(options: { permission?: NotificationPermission; supported?: boolean } = {}) {
  const messages: Array<Record<string, unknown>> = [];
  const shown: Array<{ title: string; options: WebNotificationOptions }> = [];
  const live: Array<WebShownNotification & { closed: boolean }> = [];
  let permission: NotificationPermission = options.permission ?? 'granted';
  let listener: ((message: unknown) => void) | undefined;

  const target: WebNotificationTarget = {
    showNotification: async (title, notificationOptions) => {
      shown.push({ title, options: notificationOptions });
    },
    getNotifications: async () => live,
    postMessage: (message) => void messages.push(message as Record<string, unknown>),
    requestBackgroundCatchUp: async () => true,
  };

  const host: WebReminderHost = {
    isSupported: () => options.supported !== false,
    getPermission: () => permission,
    requestPermission: async () => {
      permission = 'granted';
      return permission;
    },
    getTarget: async () => (options.supported === false ? undefined : target),
    subscribe: (next) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
  };

  return {
    host,
    messages,
    shown,
    addLiveNotification(tag: string, data?: unknown) {
      const entry = {
        tag,
        data,
        closed: false,
        close() {
          entry.closed = true;
        },
      };
      live.push(entry);
      return entry;
    },
    emit(message: unknown) {
      listener?.(message);
    },
    hasSubscriber: () => listener !== undefined,
  };
}

describe('WebReminderTransport', () => {
  it('reports itself as a web platform without any exact-alarm capability', async () => {
    const fake = fakeHost();
    const transport = new WebReminderTransport(fake.host);

    expect(transport.platform).toBe('web');
    expect(transport.isSupported()).toBe(true);
    // 浏览器没有 Android 那套精确闹钟权限，必须如实返回 unavailable，
    // 否则设置页会给用户一个点了也没用的「允许精确闹钟」按钮。
    expect(transport.getExactAlarmCapability()).toBe('unavailable');
    await expect(transport.checkExactAlarmCapability()).resolves.toBe('unavailable');
    await expect(transport.requestExactAlarmCapability()).resolves.toBe('unavailable');
  });

  it('shows notifications through the worker with action buttons and a sw-compatible tag', async () => {
    const fake = fakeHost();
    const transport = new WebReminderTransport(fake.host);

    const sent = await transport.show({
      title: '该吃药了',
      body: '降压药 1 片',
      tag: 'occurrence:rule:2026-07-31',
      key: 'repeat-2',
      data: { occurrenceId: 'occurrence:rule:2026-07-31' },
    });

    expect(sent).toBe(true);
    expect(fake.shown).toHaveLength(1);
    expect(fake.shown[0].title).toBe('该吃药了');
    // tag 必须与 public/sw.js showItem 的 `${tag}::${key}` 完全一致，
    // 否则页面和 SW 各发各的，同一次用药会弹出两条通知。
    expect(fake.shown[0].options.tag).toBe('occurrence:rule:2026-07-31::repeat-2');
    expect(fake.shown[0].options.actions?.map(({ action }) => action)).toEqual(['taken', 'skip']);
    expect(fake.shown[0].options.data).toMatchObject({
      tag: 'occurrence:rule:2026-07-31',
      key: 'repeat-2',
      occurrenceId: 'occurrence:rule:2026-07-31',
    });
  });

  it('refuses to show anything before notification permission is granted', async () => {
    const fake = fakeHost({ permission: 'default' });
    const transport = new WebReminderTransport(fake.host);

    await expect(transport.show({ title: 'x', body: 'y', tag: 'occurrence:1' })).resolves.toBe(false);
    expect(fake.shown).toHaveLength(0);
  });

  it('hands only future reminders to the worker and reports the truncated remainder', async () => {
    const fake = fakeHost();
    const transport = new WebReminderTransport(fake.host);
    const now = Date.now();

    const result = await transport.reconcile([
      { at: now - 60_000, title: '已过期', body: '不该下发', tag: 'occurrence:past' },
      { at: now + 120_000, title: '晚的', body: 'b', tag: 'occurrence:late' },
      { at: now + 60_000, title: '早的', body: 'a', tag: 'occurrence:early' },
    ]);

    expect(result).toMatchObject({
      status: 'ok',
      scheduled: 2,
      cancelled: 0,
      truncated: 0,
      exactAlarm: 'unavailable',
    });
    const plan = fake.messages.find((message) => message.type === 'medbox:reminder-plan');
    expect(plan).toBeDefined();
    const notifications = plan?.notifications as Array<{ tag: string; key: string }>;
    // 按时间排序下发，且过期条目不进计划（SW 只负责补发，不负责翻旧账）
    expect(notifications.map(({ tag }) => tag)).toEqual(['occurrence:early', 'occurrence:late']);
    expect(notifications.every(({ key }) => key === 'dose')).toBe(true);
  });

  it('reports permission-denied and an unsupported browser without touching the worker', async () => {
    const denied = fakeHost({ permission: 'denied' });
    await expect(new WebReminderTransport(denied.host).reconcile([])).resolves.toMatchObject({
      status: 'permission-denied',
      scheduled: 0,
    });
    expect(denied.messages).toHaveLength(0);

    const unsupported = fakeHost({ supported: false });
    const transport = new WebReminderTransport(unsupported.host);
    expect(transport.isSupported()).toBe(false);
    // 能力缺失时权限一律按 denied 报告，避免设置页显示「已开启」却什么都收不到
    expect(transport.getPermission()).toBe('denied');
    await expect(transport.reconcile([])).resolves.toMatchObject({ status: 'unsupported' });
    expect(unsupported.messages).toHaveLength(0);
  });

  it('closes displayed notifications for a tag and tells the worker to drop it from the plan', async () => {
    const fake = fakeHost();
    const transport = new WebReminderTransport(fake.host);
    const dose = fake.addLiveNotification('occurrence:1::dose');
    const repeat = fake.addLiveNotification('other', { tag: 'occurrence:1' });
    const unrelated = fake.addLiveNotification('occurrence:2::dose');

    await transport.cancelByTag('occurrence:1');

    expect(dose.closed).toBe(true);
    expect(repeat.closed).toBe(true);
    expect(unrelated.closed).toBe(false);
    expect(fake.messages).toContainEqual({ type: 'medbox:reminder-cancel', tag: 'occurrence:1' });
  });

  it('maps worker messages to reminder actions and ignores unrelated traffic', async () => {
    const fake = fakeHost();
    const transport = new WebReminderTransport(fake.host);
    const listener = vi.fn();

    const cleanup = await transport.addActionListener(listener);
    // 页面关闭期间被点掉的通知暂存在 SW 里，页面起来后必须主动来取
    await Promise.resolve();
    expect(fake.messages).toContainEqual({ type: 'medbox:reminder-drain' });

    fake.emit({ type: 'medbox:reminder-action', actionId: 'taken', tag: 'occurrence:1', data: { logId: 'x' } });
    fake.emit({ type: 'some-other-app-message', tag: 'occurrence:1' });
    fake.emit({ type: 'medbox:reminder-action' });
    fake.emit(null);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      actionId: 'taken',
      tag: 'occurrence:1',
      data: { logId: 'x' },
    });

    cleanup();
    expect(fake.hasSubscriber()).toBe(false);
  });
});
