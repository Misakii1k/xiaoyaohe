import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  getLogForOccurrence,
  getMed,
  importMedsAndRules,
  listScheduleRevisions,
  putLog,
  putMed,
  putRule,
  setOccurrenceAction,
} from '../src/db/local';
import { defaultEscalate, emptyIdentity, type Medication, type ReminderRule } from '../src/db/schema';
import { addLocalDays, projectScheduleDate, toLocalDate } from '../src/domain/medicationSchedule';

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('medbox');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

describe('atomic occurrence actions', () => {
  it('keeps inventory and action consistent and never invents a legacy restore delta', async () => {
    const med: Medication = {
      id: 'med-storage',
      name: '库存测试药',
      dosageText: '',
      amountPerDose: '0.25片',
      doseQuantity: 0.25,
      doseUnit: '片',
      slots: ['morning'],
      mealRels: [],
      mealRelsBySlot: {},
      daysOfWeek: [],
      inventory: { remaining: 2, unit: '片' },
      identity: emptyIdentity(),
      createdAt: Date.now(),
      updatedAt: 1,
    };
    const rule: ReminderRule = {
      id: 'rule-storage',
      medId: med.id,
      slot: 'morning',
      timeLocal: '08:00',
      enabled: true,
      cycle: { activeDays: 1, restDays: 1 },
      escalate: defaultEscalate(),
      updatedAt: 1,
    };
    await putMed(med);
    await putRule(rule);
    const revision = (await listScheduleRevisions()).find((item) => item.sourceRuleId === rule.id);
    expect(revision).toBeDefined();
    expect(Object.isFrozen(revision)).toBe(true);
    expect(revision?.cycleStartDate).toBe(toLocalDate());
    const today = toLocalDate();
    const occurrence = projectScheduleDate([revision!], today)[0].occurrence!;

    const taken = await setOccurrenceAction(occurrence, 'taken', {
      ackAt: Date.now(),
    });
    expect(taken.med.inventory?.remaining).toBe(1.75);
    expect(taken.log?.inventoryDelta).toBe(0.25);
    expect((await getLogForOccurrence(occurrence))?.status).toBe('taken');

    await setOccurrenceAction(occurrence, undefined);
    expect((await getMed(med.id))?.inventory?.remaining).toBe(2);
    expect(await getLogForOccurrence(occurrence)).toBeUndefined();

    await putLog({
      id: occurrence.legacyLogId,
      medId: med.id,
      slot: occurrence.slot,
      dueAt: occurrence.dueAt,
      status: 'taken',
      updatedAt: 1,
    });
    await setOccurrenceAction(occurrence, undefined);
    expect((await getMed(med.id))?.inventory?.remaining).toBe(2);

    const empty = (await getMed(med.id))!;
    empty.inventory!.remaining = 0;
    await putMed(empty);
    await expect(setOccurrenceAction(occurrence, 'taken')).rejects.toMatchObject({
      code: 'insufficient-inventory',
    });
    expect((await getMed(med.id))?.inventory?.remaining).toBe(0);
    expect(await getLogForOccurrence(occurrence)).toBeUndefined();

    const expired = (await getMed(med.id))!;
    expired.inventory!.remaining = 1;
    expired.expiryLocalDate = addLocalDays(today, -1);
    await putMed(expired);
    await expect(setOccurrenceAction(occurrence, 'taken')).rejects.toMatchObject({ code: 'expired' });
    expect((await getMed(med.id))?.inventory?.remaining).toBe(1);
    expect(await getLogForOccurrence(occurrence)).toBeUndefined();
  });

  it('rolls back both inventory and intake log when confirmed units do not match', async () => {
    const med: Medication = {
      id: 'med-unit-mismatch',
      name: '单位不匹配测试药',
      dosageText: '',
      amountPerDose: '1片',
      doseQuantity: 1,
      doseUnit: '片',
      slots: ['morning'],
      mealRels: [],
      mealRelsBySlot: {},
      daysOfWeek: [],
      inventory: { remaining: 10, unit: 'mL' },
      identity: emptyIdentity(),
      createdAt: Date.now(),
      updatedAt: 1,
    };
    const rule: ReminderRule = {
      id: 'rule-unit-mismatch',
      medId: med.id,
      slot: 'morning',
      timeLocal: '00:00',
      enabled: true,
      escalate: defaultEscalate(),
      updatedAt: 1,
    };
    await putMed(med);
    await putRule(rule);
    const revision = (await listScheduleRevisions()).find((item) => item.sourceRuleId === rule.id)!;
    const occurrence = projectScheduleDate([revision], toLocalDate())[0].occurrence!;

    await expect(setOccurrenceAction(occurrence, 'taken')).rejects.toMatchObject({
      code: 'dose-review-required',
    });
    expect((await getMed(med.id))?.inventory?.remaining).toBe(10);
    expect(await getLogForOccurrence(occurrence)).toBeUndefined();
  });

  it('records a taken occurrence without touching inventory when a legacy dose remains unstructured', async () => {
    const med: Medication = {
      id: 'med-unstructured-dose',
      name: '未结构化剂量测试药',
      dosageText: '10mg/片',
      amountPerDose: '按医嘱',
      doseReviewRequired: true,
      slots: ['morning'],
      mealRels: [],
      mealRelsBySlot: {},
      daysOfWeek: [],
      inventory: { remaining: 6, unit: '片' },
      identity: emptyIdentity(),
      createdAt: Date.now(),
      updatedAt: 1,
    };
    const rule: ReminderRule = {
      id: 'rule-unstructured-dose',
      medId: med.id,
      slot: 'morning',
      timeLocal: '00:00',
      enabled: true,
      escalate: defaultEscalate(),
      updatedAt: 1,
    };
    await putMed(med);
    await putRule(rule);
    const revision = (await listScheduleRevisions()).find((item) => item.sourceRuleId === rule.id)!;
    const occurrence = projectScheduleDate([revision], toLocalDate())[0].occurrence!;

    const result = await setOccurrenceAction(occurrence, 'taken');

    expect(result.inventoryChanged).toBe(false);
    expect(result.log).toMatchObject({ status: 'taken', inventoryDelta: undefined });
    expect((await getMed(med.id))?.inventory?.remaining).toBe(6);
  });

  it('imports immutable schedule history without overwriting an existing revision', async () => {
    const revision = {
      id: 'schedule:imported:1:stable',
      medId: 'med-storage',
      sourceRuleId: 'rule-imported',
      effectiveDate: toLocalDate(),
      createdAt: 1,
      enabled: true,
      slot: 'evening' as const,
      timeLocal: '18:30',
      daysOfWeek: [] as number[],
      mealRels: [] as never[],
      reviewFlags: ['dose-unstructured' as const],
    };
    const first = await importMedsAndRules([], [], [], [revision]);
    const second = await importMedsAndRules([], [], [], [{ ...revision, timeLocal: '19:00' }]);

    expect(first.scheduleRevisions.added).toBe(1);
    expect(second.scheduleRevisions.skipped).toBe(1);
    const stored = (await listScheduleRevisions()).find((item) => item.id === revision.id);
    expect(stored?.timeLocal).toBe('18:30');
    expect(Object.isFrozen(stored)).toBe(true);
  });
});
