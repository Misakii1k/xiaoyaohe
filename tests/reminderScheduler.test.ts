import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Medication, ReminderRule } from '../src/db/schema';
import { defaultEscalate, emptyIdentity } from '../src/db/schema';
import { createScheduleRevision, toLocalDate } from '../src/domain/medicationSchedule';

const mocks = vi.hoisted(() => ({
  reconcile: vi.fn(async () => ({ scheduled: 1, cancelled: 0 })),
  show: vi.fn(async () => true),
  getLog: vi.fn(async () => undefined),
}));

const med: Medication = {
  id: 'native-med',
  name: '原生提醒测试药',
  dosageText: '',
  amountPerDose: '1片',
  doseQuantity: 1,
  doseUnit: '片',
  slots: ['morning'],
  mealRels: [],
  mealRelsBySlot: {},
  daysOfWeek: [],
  identity: emptyIdentity(),
  createdAt: 1,
  updatedAt: 1,
};
const rule: ReminderRule = {
  id: 'native-rule',
  medId: med.id,
  slot: 'morning',
  timeLocal: '00:00',
  enabled: true,
  escalate: defaultEscalate(),
  updatedAt: 1,
};
const revision = createScheduleRevision(med, rule, {
  effectiveDate: toLocalDate(),
  createdAt: 1,
});

vi.mock('../src/db/local', () => ({
  listMeds: vi.fn(async () => [med]),
  listLogs: vi.fn(async () => []),
  listRules: vi.fn(async () => [rule]),
  listScheduleRevisions: vi.fn(async () => [revision]),
  getLogForOccurrence: mocks.getLog,
  getPushState: vi.fn(async () => undefined),
  putPushState: vi.fn(async () => undefined),
}));

vi.mock('../src/features/notifier', () => ({
  REMINDER_CAPABILITY_CHANGE_EVENT: 'medbox:test-reminder-change',
  getPermission: vi.fn(() => 'granted'),
  isNativeReminderPlatform: vi.fn(() => true),
  notificationsSupported: vi.fn(() => true),
  reconcileScheduledNotifications: mocks.reconcile,
  refreshPermission: vi.fn(async () => 'granted'),
  showNotification: mocks.show,
}));

vi.mock('../src/sync/config', () => ({
  getSyncConfig: vi.fn(() => undefined),
}));

import { runOnce } from '../src/features/reminderScheduler';

describe('native reminder scheduler', () => {
  beforeEach(() => {
    mocks.reconcile.mockClear();
    mocks.show.mockClear();
    mocks.getLog.mockClear();
  });

  it('stops after reconciling the native schedule instead of sending foreground duplicates', async () => {
    await runOnce();

    expect(mocks.reconcile).toHaveBeenCalledOnce();
    expect(mocks.getLog).not.toHaveBeenCalled();
    expect(mocks.show).not.toHaveBeenCalled();
  });
});
