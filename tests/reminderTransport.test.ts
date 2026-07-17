import { describe, expect, it, vi } from 'vitest';
import type {
  ActionPerformed,
  LocalNotificationSchema,
  LocalNotificationsPlugin,
  PendingLocalNotificationSchema,
  ScheduleOptions,
} from '@capacitor/local-notifications';
import {
  AndroidReminderTransport,
  UnsupportedBrowserReminderTransport,
  notificationIdFor,
  type KeyValueStore,
} from '../src/features/reminderTransport';

class MemoryStore implements KeyValueStore {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function fakePlugin(permission: 'granted' | 'denied' = 'granted') {
  const pending: PendingLocalNotificationSchema[] = [];
  let actionListener: ((action: ActionPerformed) => void) | undefined;
  const schedule = vi.fn(async (options: ScheduleOptions) => {
    for (const notification of options.notifications) {
      const index = pending.findIndex(({ id }) => id === notification.id);
      const next: PendingLocalNotificationSchema = {
        id: notification.id,
        title: notification.title,
        body: notification.body,
        schedule: notification.schedule,
        extra: notification.extra,
      };
      if (index >= 0) pending[index] = next;
      else pending.push(next);
    }
    return { notifications: options.notifications.map(({ id }) => ({ id })) };
  });
  const cancel = vi.fn(async ({ notifications }: { notifications: Array<{ id: number }> }) => {
    const ids = new Set(notifications.map(({ id }) => id));
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      if (ids.has(pending[index].id)) pending.splice(index, 1);
    }
  });
  const plugin = {
    schedule,
    cancel,
    getPending: vi.fn(async () => ({ notifications: pending.map((item) => ({ ...item })) })),
    checkPermissions: vi.fn(async () => ({ display: permission })),
    requestPermissions: vi.fn(async () => ({ display: permission })),
    checkExactNotificationSetting: vi.fn(async () => ({ exact_alarm: 'denied' })),
    changeExactNotificationSetting: vi.fn(async () => ({ exact_alarm: 'granted' })),
    addListener: vi.fn(async (_event: string, listener: (action: ActionPerformed) => void) => {
      actionListener = listener;
      return { remove: vi.fn(async () => undefined) };
    }),
  } as unknown as LocalNotificationsPlugin;
  return {
    plugin,
    pending,
    schedule,
    cancel,
    emitAction(notification: LocalNotificationSchema) {
      actionListener?.({ actionId: 'tap', notification });
    },
  };
}

describe('UnsupportedBrowserReminderTransport', () => {
  it('reports browser previews as unsupported and keeps every operation inert', async () => {
    const transport = new UnsupportedBrowserReminderTransport();
    const listener = vi.fn();

    expect(transport.platform).toBe('web');
    expect(transport.isSupported()).toBe(false);
    expect(transport.getPermission()).toBe('denied');
    await expect(transport.refreshPermission()).resolves.toBe('denied');
    await expect(transport.requestPermission()).resolves.toBe('denied');
    expect(transport.getExactAlarmCapability()).toBe('unavailable');
    await expect(transport.checkExactAlarmCapability()).resolves.toBe('unavailable');
    await expect(transport.requestExactAlarmCapability()).resolves.toBe('unavailable');
    await expect(
      transport.show({ title: 'Dose', body: 'Body', tag: 'occurrence:preview' }),
    ).resolves.toBe(false);
    await expect(
      transport.reconcile([
        {
          at: Date.now() + 60_000,
          title: 'Dose',
          body: 'Body',
          tag: 'occurrence:preview',
        },
      ]),
    ).resolves.toEqual({
      status: 'unsupported',
      scheduled: 0,
      cancelled: 0,
      truncated: 0,
      exactAlarm: 'unavailable',
    });
    await expect(transport.cancelByTag('occurrence:preview')).resolves.toBeUndefined();
    const cleanup = await transport.addActionListener(listener);
    cleanup();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('AndroidReminderTransport', () => {
  const now = new Date(2026, 6, 13, 7, 0, 0).getTime();

  it('uses stable IDs per occurrence phase', () => {
    expect(notificationIdFor('occurrence:1', 'dose')).toBe(
      notificationIdFor('occurrence:1', 'dose'),
    );
    expect(notificationIdFor('occurrence:1', 'dose')).not.toBe(
      notificationIdFor('occurrence:1', 'repeat-2'),
    );
  });

  it('reconciles local calendar alarms without duplicating unchanged entries', async () => {
    const fake = fakePlugin();
    const transport = new AndroidReminderTransport(fake.plugin, new MemoryStore(), () => now);
    const reminder = {
      at: new Date(2026, 6, 13, 8, 5, 0).getTime(),
      title: 'Take medicine',
      body: 'One tablet',
      tag: 'occurrence:rule:2026-07-13',
      key: 'dose',
      data: { occurrenceId: 'occurrence:rule:2026-07-13' },
    };

    const first = await transport.reconcile([reminder]);
    const second = await transport.reconcile([reminder]);

    expect(first).toMatchObject({
      status: 'ok',
      scheduled: 1,
      exactAlarm: 'denied',
    });
    // 策略是「先清空再重建」，所以第二次 reconcile 也会重新 schedule 同一条
    expect(second).toMatchObject({ status: 'ok', scheduled: 1 });
    expect(fake.schedule).toHaveBeenCalled();
    expect(fake.pending).toHaveLength(1);
    expect(fake.pending[0].schedule?.on).toMatchObject({
      year: 2026,
      month: 7,
      day: 13,
      hour: 8,
      minute: 5,
    });
    expect(fake.pending[0].schedule?.allowWhileIdle).toBe(true);
  });

  it('does not schedule after notification permission is denied', async () => {
    const fake = fakePlugin('denied');
    const transport = new AndroidReminderTransport(fake.plugin, new MemoryStore(), () => now);
    const result = await transport.reconcile([
      {
        at: now + 60_000,
        title: 'Reminder',
        body: 'Body',
        tag: 'occurrence:denied',
      },
    ]);

    expect(result.status).toBe('permission-denied');
    expect(fake.schedule).not.toHaveBeenCalled();
  });

  it('cancels every phase for a completed occurrence and routes notification taps', async () => {
    const fake = fakePlugin();
    const transport = new AndroidReminderTransport(fake.plugin, new MemoryStore(), () => now);
    const tag = 'occurrence:rule:2026-07-13';
    await transport.reconcile([
      { at: now + 60_000, title: 'Dose', body: 'Body', tag, key: 'dose' },
      { at: now + 120_000, title: 'Repeat', body: 'Body', tag, key: 'repeat-2' },
    ]);
    const action = vi.fn();
    await transport.addActionListener(action);
    const native = (fake.schedule.mock.calls[0][0] as ScheduleOptions).notifications[0];
    fake.emitAction(native);
    await transport.cancelByTag(tag);

    expect(action).toHaveBeenCalledWith({ actionId: 'tap', tag, data: {} });
    expect(fake.pending).toHaveLength(0);
    expect(fake.cancel).toHaveBeenCalled();
  });

  it('hard-resets when pending alarms already exceed the safe Android ceiling', async () => {
    const fake = fakePlugin();
    // 模拟历史残留：pending 远超 400
    for (let i = 1; i <= 450; i += 1) {
      fake.pending.push({
        id: i,
        title: 'old',
        body: 'old',
        schedule: { on: { year: 2026, month: 8, day: 1, hour: 8, minute: 0 } },
        extra: { __medboxReminder: { owner: 'medbox-medication-reminder-v1', tag: `old:${i}`, key: 'dose', data: {} } },
      });
    }
    const transport = new AndroidReminderTransport(fake.plugin, new MemoryStore(), () => now);
    const result = await transport.reconcile([
      { at: now + 60_000, title: 'Dose', body: 'Body', tag: 'occurrence:fresh', key: 'dose' },
    ]);

    expect(result.status).toBe('ok');
    expect(result.cancelled).toBeGreaterThanOrEqual(450);
    expect(result.scheduled).toBe(1);
    expect(fake.pending).toHaveLength(1);
    expect(fake.pending[0].title).toBe('Dose');
  });
});
