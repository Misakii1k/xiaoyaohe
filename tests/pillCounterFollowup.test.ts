// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const reminderMocks = vi.hoisted(() => ({
  reschedule: vi.fn(async () => undefined),
}));

vi.mock('../src/features/reminderScheduler', () => ({
  rescheduleMedicationReminders: reminderMocks.reschedule,
}));

import {
  getMed,
  listInventoryLogs,
  listMeds,
  putMed,
  putRule,
} from '../src/db/local';
import {
  defaultEscalate,
  emptyIdentity,
  type Medication,
  type ReminderRule,
} from '../src/db/schema';
import {
  applyPillCountFollowup,
  openPillCountFollowupSheet,
} from '../src/features/pillCounterFollowup';

function makeMed(id: string, name: string, overrides: Partial<Medication> = {}): Medication {
  const now = Date.now();
  return {
    id,
    name,
    dosageText: '每次 2 片',
    amountPerDose: '2 片',
    doseQuantity: 2,
    doseUnit: '片',
    doseConfirmed: true,
    slots: ['morning', 'evening'],
    daysOfWeek: [],
    reminderMode: 'normal',
    deleted: false,
    updatedAt: now,
    createdAt: now,
    identity: emptyIdentity(),
    inventory: {
      remaining: 20,
      unit: '片',
      lowThreshold: 5,
      updatedAt: now,
    },
    ...overrides,
  };
}

function makeRule(id: string, medId: string, slot: 'morning' | 'evening'): ReminderRule {
  return {
    id,
    medId,
    slot,
    time: slot === 'morning' ? '08:00' : '20:00',
    enabled: true,
    deleted: false,
    escalate: defaultEscalate(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('pillCounterFollowup business closure', () => {
  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase('medbox');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    reminderMocks.reschedule.mockClear();
  });

  it('sets remaining inventory and records inventory operation log', async () => {
    const med = makeMed('med-set-1', '二甲双胍');
    await putMed(med);

    const res = await applyPillCountFollowup({
      action: 'set',
      medId: med.id,
      count: 14,
    });

    expect(res.ok).toBe(true);
    expect(res.newRemaining).toBe(14);
    const updated = await getMed(med.id);
    expect(updated?.inventory?.remaining).toBe(14);
    expect(updated?.inventory?.unit).toBe('片');

    const logs = await listInventoryLogs(med.id, 10);
    expect(logs.some((log) => log.action === 'set' && log.newRemaining === 14)).toBe(true);
    expect(reminderMocks.reschedule).toHaveBeenCalledTimes(1);
  });

  it('adds counted pills onto existing stock balance', async () => {
    const med = makeMed('med-add-1', '阿司匹林', {
      inventory: { remaining: 10, unit: '粒', lowThreshold: 5, updatedAt: Date.now() },
    });
    await putMed(med);

    const res = await applyPillCountFollowup({
      action: 'add',
      medId: med.id,
      count: 12,
    });

    expect(res.ok).toBe(true);
    expect(res.newRemaining).toBe(22);
    const updated = await getMed(med.id);
    expect(updated?.inventory?.remaining).toBe(22);
    expect(updated?.inventory?.unit).toBe('粒');
  });

  it('rejects incompatible container unit (e.g. 盒) without mutating stored unit or remaining count', async () => {
    const med = makeMed('med-box-1', '铝塑整盒药', {
      inventory: { remaining: 3, unit: '盒', lowThreshold: 1, updatedAt: Date.now() },
    });
    await putMed(med);

    const res = await applyPillCountFollowup({
      action: 'set',
      medId: med.id,
      count: 24,
    });

    expect(res.ok).toBe(false);
    expect(res.message).toContain('盒');
    const unchanged = await getMed(med.id);
    expect(unchanged?.inventory?.remaining).toBe(3);
    expect(unchanged?.inventory?.unit).toBe('盒');
  });

  it('compares counted pills against expected daily dose from confirmed dose + active rules', async () => {
    const med = makeMed('med-dose-1', '缬沙坦', {
      doseQuantity: 2,
      doseUnit: '片',
      doseConfirmed: true,
    });
    await putMed(med);
    await putRule(makeRule('rule-1', med.id, 'morning'));
    await putRule(makeRule('rule-2', med.id, 'evening'));

    const exact = await applyPillCountFollowup({
      action: 'check_dose',
      medId: med.id,
      count: 4,
    });
    expect(exact.ok).toBe(true);
    expect(exact.expectedDaily).toBe(4);
    expect(exact.diff).toBe(0);
    expect(exact.message).toContain('刚好');

    const over = await applyPillCountFollowup({
      action: 'check_dose',
      medId: med.id,
      count: 6,
    });
    expect(over.diff).toBe(2);
    expect(over.message).toContain('多了 2');

    const under = await applyPillCountFollowup({
      action: 'check_dose',
      medId: med.id,
      count: 3,
    });
    expect(under.diff).toBe(-1);
    expect(under.message).toContain('还差 1');
  });

  it('renders followup bottom sheet with custom select and segmented actions', async () => {
    const med = makeMed('med-ui-1', '奥美拉唑');
    await putMed(med);
    await putRule(makeRule('ui-rule-1', med.id, 'morning'));
    await putRule(makeRule('ui-rule-2', med.id, 'evening'));

    void openPillCountFollowupSheet({ count: 15, defaultMedId: med.id });

    await vi.waitFor(() => {
      expect(document.querySelector('.pill-followup-sheet')).not.toBeNull();
    });
    const sheet = document.querySelector('.pill-followup-sheet')!;
    expect(sheet.textContent).toContain('共 15 粒');
    expect(sheet.textContent).toContain('清点结果怎么记？');
    expect(sheet.textContent).toContain('设为剩余');
    expect(sheet.textContent).toContain('入库累加');
    expect(sheet.textContent).toContain('核对分药');
    expect(sheet.textContent).toContain('现在');
    expect(sheet.textContent).toContain('记完');
    expect(sheet.textContent).toContain('20片');
    expect(sheet.textContent).toContain('15片');

    const buttons = [...sheet.querySelectorAll('button')];
    expect(buttons.some((b) => b.textContent?.includes('设为剩余 15 粒'))).toBe(true);

    const addBtn = buttons.find((b) => b.textContent?.includes('入库累加'))!;
    addBtn.click();
    expect(sheet.textContent).toContain('35片');
    expect(sheet.textContent).toContain('+15');
    expect(buttons.some((b) => b.textContent?.includes('累加 15 粒'))).toBe(true);

    const checkBtn = buttons.find((b) => b.textContent?.includes('核对分药'))!;
    checkBtn.click();
    expect(sheet.textContent).toContain('当日应取');
    expect(sheet.textContent).toContain('实点');
    expect(sheet.textContent).toContain('多 11 粒');
    expect(buttons.some((b) => b.textContent?.includes('完成核对'))).toBe(true);
  });

  it('skips followup sheet when skipIfNoMeds is set and no active meds exist', async () => {
    const existing = await listMeds();
    for (const m of existing) {
      if (!m.deleted) await putMed({ ...m, deleted: true });
    }
    await openPillCountFollowupSheet({ count: 8, skipIfNoMeds: true });
    expect(document.querySelector('.pill-followup-sheet')).toBeNull();
  });
});
