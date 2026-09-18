import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntakeLog, Medication, PushState, ReminderRule, Slot } from '../src/db/schema';
import { defaultEscalate, emptyIdentity } from '../src/db/schema';
import { createScheduleRevision, projectScheduleDate, toLocalDate } from '../src/domain/medicationSchedule';
import type { ScheduledReminderNotification } from '../src/features/reminderTransport';

const mocks = vi.hoisted(() => ({
  reconcile: vi.fn(async (_notifications: readonly ScheduledReminderNotification[]) => ({
    scheduled: 1,
    cancelled: 0,
  })),
  show: vi.fn(async () => true),
  getLog: vi.fn(async () => undefined),
  getPushState: vi.fn(async () => undefined),
  listPushStates: vi.fn(async (_ids: readonly string[]) => [] as PushState[]),
  putPushState: vi.fn(async (_state: PushState) => undefined),
  native: true,
  logs: [] as IntakeLog[],
}));

const med: Medication = {
  id: 'native-med',
  name: '原生提醒测试药',
  dosageText: '',
  amountPerDose: '1片',
  doseQuantity: 1,
  doseUnit: '片',
  slots: ['morning', 'noon', 'evening', 'bedtime'],
  mealRels: [],
  mealRelsBySlot: {},
  daysOfWeek: [],
  identity: emptyIdentity(),
  createdAt: 1,
  updatedAt: 1,
};
const rules = (['morning', 'noon', 'evening', 'bedtime'] as Slot[]).map((slot): ReminderRule => ({
  id: `rule-${slot}`,
  medId: med.id,
  slot,
  timeLocal: '00:00',
  enabled: true,
  escalate: defaultEscalate(),
  updatedAt: 1,
}));
const revisions = rules.map((rule) => createScheduleRevision(med, rule, {
  effectiveDate: toLocalDate(),
  createdAt: 1,
}));

vi.mock('../src/db/local', () => ({
  listMeds: vi.fn(async () => [med]),
  listLogs: vi.fn(async () => mocks.logs),
  listRules: vi.fn(async () => rules),
  listScheduleRevisions: vi.fn(async () => revisions),
  listReminderPeriodSettings: vi.fn(async () => (['morning', 'noon', 'evening', 'bedtime'] as Slot[]).map((slot) => ({
    slot,
    timeLocal: '00:00',
    mode: 'strong',
    escalate: defaultEscalate(),
    state: 'active',
    updatedAt: 1,
  }))),
  getLogForOccurrence: mocks.getLog,
  getPushState: mocks.getPushState,
  listPushStates: mocks.listPushStates,
  putPushState: mocks.putPushState,
}));

vi.mock('../src/features/notifier', () => ({
  REMINDER_CAPABILITY_CHANGE_EVENT: 'medbox:test-reminder-change',
  getPermission: vi.fn(() => 'granted'),
  isNativeReminderPlatform: vi.fn(() => mocks.native),
  notificationsSupported: vi.fn(() => true),
  reconcileScheduledNotifications: mocks.reconcile,
  refreshPermission: vi.fn(async () => 'granted'),
  showNotification: mocks.show,
}));

import { runOnce } from '../src/features/reminderScheduler';

describe('native reminder scheduler', () => {
  beforeEach(() => {
    mocks.reconcile.mockClear();
    mocks.show.mockClear();
    mocks.getLog.mockClear();
    mocks.getPushState.mockClear();
    mocks.listPushStates.mockReset();
    mocks.listPushStates.mockResolvedValue([]);
    mocks.putPushState.mockClear();
    mocks.native = true;
    mocks.logs = [];
  });

  it('stops after reconciling the native schedule instead of sending foreground duplicates', async () => {
    await runOnce();

    expect(mocks.reconcile).toHaveBeenCalledOnce();
    const notifications = mocks.reconcile.mock.calls[0][0];
    expect(notifications.length).toBeGreaterThan(0);
    // 组载荷：全部是 reminder-group，tag 不含 _care
    expect(notifications.every(({ tag, data }) => !tag.endsWith('_care') && data?.kind === 'reminder-group')).toBe(true);
    expect(mocks.getLog).not.toHaveBeenCalled();
    expect(mocks.show).not.toHaveBeenCalled();
  });

  it('批量读取多个到点提醒组的状态并保持筛选与写回语义', async () => {
    vi.useFakeTimers();
    try {
      mocks.native = false;
      const today = toLocalDate();
      vi.setSystemTime(new Date(`${today}T12:00:00`));
      const groupIds = (['morning', 'noon', 'evening', 'bedtime'] as Slot[]).map(
        (slot) => `reminder-group:${today}:${slot}`,
      );
      // noon 已发过 dose（count=1），evening 已达上限（count=4）
      mocks.listPushStates.mockResolvedValue([
        { id: groupIds[1]!, count: 1, lastSentAt: 0 },
        { id: groupIds[2]!, count: 4, lastSentAt: 0 },
      ]);

      await runOnce();

      expect(mocks.listPushStates).toHaveBeenCalledOnce();
      expect(new Set(mocks.listPushStates.mock.calls[0][0])).toEqual(new Set(groupIds));
      expect(mocks.getLog).not.toHaveBeenCalled();
      expect(mocks.getPushState).not.toHaveBeenCalled();
      // 按组发整体提醒：早上/睡前无历史 → dose；中午 count=1 → repeat-2；晚上已达上限 → 跳过
      const shown = mocks.show.mock.calls.map(([, options]) => [options.tag, options.key]).sort((a, b) => a[0].localeCompare(b[0]));
      expect(shown).toEqual([
        [groupIds[0]!, 'dose'],
        [groupIds[1]!, 'repeat-2'],
        [groupIds[3]!, 'dose'],
      ].sort((a, b) => a[0].localeCompare(b[0])));
      const written = mocks.putPushState.mock.calls.map(([state]) => ({ id: state.id, count: state.count }))
        .sort((a, b) => a.id.localeCompare(b.id));
      expect(written).toEqual([
        { id: groupIds[0]!, count: 1 },
        { id: groupIds[1]!, count: 2 },
        { id: groupIds[3]!, count: 1 },
      ].sort((a, b) => a.id.localeCompare(b.id)));
    } finally {
      vi.useRealTimers();
    }
  });
});
