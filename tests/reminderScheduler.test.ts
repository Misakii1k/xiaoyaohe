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
    expect(notifications.every(({ tag, data }) => !tag.endsWith('_care') && data?.kind === 'reminder')).toBe(true);
    expect(mocks.getLog).not.toHaveBeenCalled();
    expect(mocks.show).not.toHaveBeenCalled();
  });

  it('批量读取多个到点 occurrence 的状态并保持提醒筛选与写回语义', async () => {
    mocks.native = false;
    const occurrences = projectScheduleDate(revisions, toLocalDate())
      .flatMap(({ occurrence }) => occurrence ? [occurrence] : []);
    const [initial, taken, repeat, exhausted] = occurrences;
    mocks.logs = [{
      id: taken.id,
      occurrenceId: taken.id,
      scheduleRevisionId: taken.scheduleRevisionId,
      sourceRuleId: taken.sourceRuleId,
      medId: taken.medId,
      slot: taken.slot,
      dueAt: taken.dueAt,
      status: 'taken',
      ackAt: Date.now(),
      updatedAt: Date.now(),
    }];
    mocks.listPushStates.mockResolvedValue([
      { id: repeat.id, count: 1, lastSentAt: 0 },
      { id: exhausted.id, count: 4, lastSentAt: 0 },
    ]);

    await runOnce();

    expect(mocks.listPushStates).toHaveBeenCalledOnce();
    expect(new Set(mocks.listPushStates.mock.calls[0][0])).toEqual(new Set(occurrences.map(({ id }) => id)));
    expect(mocks.getLog).not.toHaveBeenCalled();
    expect(mocks.getPushState).not.toHaveBeenCalled();
    expect(mocks.show.mock.calls.map(([, options]) => [options.tag, options.key])).toEqual([
      [initial.id, 'dose'],
      [repeat.id, 'repeat-2'],
    ]);
    expect(mocks.putPushState.mock.calls.map(([state]) => ({ id: state.id, count: state.count }))).toEqual([
      { id: initial.id, count: 1 },
      { id: repeat.id, count: 2 },
    ]);
  });
});
