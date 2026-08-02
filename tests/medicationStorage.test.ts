import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  batchDeductInventory,
  getLogForOccurrence,
  getMed,
  importMedsAndRules,
  listInventoryLogs,
  listRecentInventoryOperations,
  listScheduleRevisions,
  putLog,
  putMed,
  putRule,
  recordPreDeduction,
  isOccurrencePreDeducted,
  saveMedicationProfile,
  setOccurrenceAction,
  undoInventoryOperation,
  updateMedicationInventory,
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
    // 库存为 0 时不再阻塞：记录成功，库存不变（仍为 0），日志已创建。
    const takenEmpty = await setOccurrenceAction(occurrence, 'taken');
    expect(takenEmpty.inventoryChanged).toBe(false);
    expect((await getMed(med.id))?.inventory?.remaining).toBe(0);
    const emptyLog = await getLogForOccurrence(occurrence);
    expect(emptyLog?.status).toBe('taken');
    // 撤销以清除日志，便于后续过期测试从无日志状态开始。
    await setOccurrenceAction(occurrence, undefined);
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

  it('pre-deducts exact occurrences, avoids duplicate deductions, and still deducts schedules added later', async () => {
    const med: Medication = {
      id: 'med-pre-deduction',
      name: '分药预扣测试药',
      dosageText: '',
      amountPerDose: '1片',
      doseQuantity: 1,
      doseUnit: '片',
      slots: ['morning', 'noon'],
      mealRels: [],
      mealRelsBySlot: {},
      daysOfWeek: [],
      inventory: { remaining: 10, unit: '片' },
      identity: emptyIdentity(),
      createdAt: Date.now(),
      updatedAt: 1,
    };
    await putMed(med);
    for (const [id, slot, timeLocal] of [
      ['rule-pre-morning', 'morning', '08:00'],
      ['rule-pre-noon', 'noon', '12:00'],
    ] as const) {
      await putRule({
        id,
        medId: med.id,
        slot,
        timeLocal,
        enabled: true,
        escalate: defaultEscalate(),
        updatedAt: 1,
      });
    }
    const today = toLocalDate();
    const initial = projectScheduleDate(
      (await listScheduleRevisions()).filter((revision) => revision.medId === med.id),
      today,
    ).map((projection) => projection.occurrence!);

    const first = await recordPreDeduction(med, [{
      occurrenceId: initial[0].id,
      quantity: initial[0].doseQuantity!,
      unit: initial[0].doseUnit!,
    }], today);
    expect(first).toMatchObject({ deducted: 1, deductedOccurrences: 1, skippedOccurrences: 0, remaining: 9 });

    const repeated = await recordPreDeduction(first.med, [{
      occurrenceId: initial[0].id,
      quantity: 1,
      unit: '片',
    }], today);
    expect(repeated).toMatchObject({ deducted: 0, deductedOccurrences: 0, skippedOccurrences: 1, remaining: 9 });

    const supplemented = await recordPreDeduction(repeated.med, initial.map((occurrence) => ({
      occurrenceId: occurrence.id,
      quantity: occurrence.doseQuantity!,
      unit: occurrence.doseUnit!,
    })), today);
    expect(supplemented).toMatchObject({ deducted: 1, deductedOccurrences: 1, skippedOccurrences: 1, remaining: 8 });
    expect(initial.every((occurrence) => isOccurrencePreDeducted(supplemented.med, occurrence))).toBe(true);

    const taken = await setOccurrenceAction(initial[0], 'taken');
    expect(taken.log).toMatchObject({ status: 'taken', preDeducted: true, inventoryDelta: undefined });
    expect((await getMed(med.id))?.inventory?.remaining).toBe(8);
    await setOccurrenceAction(initial[0], undefined);
    expect((await getMed(med.id))?.inventory?.remaining).toBe(8);

    await putRule({
      id: 'rule-pre-evening',
      medId: med.id,
      slot: 'evening',
      timeLocal: '18:00',
      enabled: true,
      escalate: defaultEscalate(),
      updatedAt: Date.now(),
    });
    const expanded = projectScheduleDate(
      (await listScheduleRevisions()).filter((revision) => revision.medId === med.id),
      today,
    ).map((projection) => projection.occurrence!);
    const added = expanded.find((occurrence) => occurrence.slot === 'evening')!;
    expect(isOccurrencePreDeducted((await getMed(med.id))!, added)).toBe(false);
    await setOccurrenceAction(added, 'taken');
    expect((await getMed(med.id))?.inventory?.remaining).toBe(7);
  });

  it('restores an intake deduction only once when its inventory operation is undone before clearing the intake', async () => {
    const med: Medication = {
      id: 'med-intake-undo-once',
      name: '服药撤回测试药',
      dosageText: '',
      amountPerDose: '1片',
      doseQuantity: 1,
      doseUnit: '片',
      slots: ['morning'],
      mealRels: [],
      mealRelsBySlot: {},
      daysOfWeek: [],
      inventory: { remaining: 5, unit: '片' },
      identity: emptyIdentity(),
      updatedAt: 1,
    };
    await putMed(med);
    await putRule({
      id: 'rule-intake-undo-once',
      medId: med.id,
      slot: 'morning',
      timeLocal: '08:00',
      enabled: true,
      escalate: defaultEscalate(),
      updatedAt: 1,
    });
    const revision = (await listScheduleRevisions()).find((item) => item.sourceRuleId === 'rule-intake-undo-once')!;
    const occurrence = projectScheduleDate([revision], toLocalDate())[0].occurrence!;

    await setOccurrenceAction(occurrence, 'taken');
    expect((await getMed(med.id))?.inventory?.remaining).toBe(4);
    const deduction = (await listInventoryLogs(med.id)).find((item) => item.intakeLogId === occurrence.id)!;
    expect(deduction).toMatchObject({ source: 'intake', delta: -1, canUndo: true });

    const undone = await undoInventoryOperation(deduction.id);
    expect(undone.ok).toBe(true);
    expect((await getMed(med.id))?.inventory?.remaining).toBe(5);
    const intakeAfterUndo = await getLogForOccurrence(occurrence);
    expect(intakeAfterUndo).toMatchObject({ status: 'taken' });
    expect(intakeAfterUndo).not.toHaveProperty('inventoryDelta');
    expect(intakeAfterUndo).not.toHaveProperty('inventoryOperationLogId');

    await setOccurrenceAction(occurrence, undefined);
    expect((await getMed(med.id))?.inventory?.remaining).toBe(5);
    expect(await getLogForOccurrence(occurrence)).toBeUndefined();
  });

  it('rejects out-of-order and stale-state inventory undo without applying a delta or clamp', async () => {
    const med: Medication = {
      id: 'med-strict-undo',
      name: '严格撤回测试药',
      dosageText: '',
      amountPerDose: '1片',
      slots: [],
      mealRels: [],
      mealRelsBySlot: {},
      daysOfWeek: [],
      inventory: { remaining: 10, unit: '片' },
      identity: emptyIdentity(),
      updatedAt: 1,
    };
    await putMed(med);
    const first = await updateMedicationInventory(med.id, {
      action: 'set',
      remaining: 8,
      unit: '片',
      expectedRemaining: 10,
      expectedUnit: '片',
    }, {
      source: 'manual',
      sourceNote: '第一次修改',
    });
    const second = await updateMedicationInventory(med.id, {
      action: 'set',
      remaining: 6,
      unit: '片',
      expectedRemaining: 8,
      expectedUnit: '片',
    }, {
      source: 'manual',
      sourceNote: '第二次修改',
    });

    const outOfOrder = await undoInventoryOperation(first.log.id);
    expect(outOfOrder).toMatchObject({ ok: false });
    expect(outOfOrder.message).toContain('最近仍有效');
    expect((await getMed(med.id))?.inventory?.remaining).toBe(6);

    const stale = (await getMed(med.id))!;
    stale.inventory!.remaining = 5;
    await putMed(stale);
    const staleResult = await undoInventoryOperation(second.log.id);
    expect(staleResult).toMatchObject({ ok: false });
    expect(staleResult.message).toContain('与日志记录');
    expect((await getMed(med.id))?.inventory?.remaining).toBe(5);

    const wrongUnit = (await getMed(med.id))!;
    wrongUnit.inventory = { remaining: 6, unit: '粒' };
    await putMed(wrongUnit);
    const unitConflict = await undoInventoryOperation(second.log.id);
    expect(unitConflict).toMatchObject({ ok: false });
    expect(unitConflict.message).toContain('单位');
    expect((await getMed(med.id))?.inventory).toMatchObject({ remaining: 6, unit: '粒' });
  });

  it('applies add against fresh stock without overwriting fresh inventory metadata', async () => {
    const med: Medication = {
      id: 'med-add-fresh-metadata',
      name: '补货并发元数据测试药',
      dosageText: '',
      amountPerDose: '1片',
      slots: [],
      mealRels: [],
      mealRelsBySlot: {},
      daysOfWeek: [],
      inventory: {
        remaining: 10,
        unit: '片',
        packageQuantity: 20,
        lowThreshold: 5,
        sourceNote: '旧页面',
      },
      identity: emptyIdentity(),
      updatedAt: 1,
    };
    await putMed(med);
    const concurrent = (await getMed(med.id))!;
    concurrent.inventory = {
      ...concurrent.inventory!,
      remaining: 8,
      packageQuantity: 30,
      lowThreshold: 3,
      sourceNote: '并发新值',
      lastReminderAt: 123,
    };
    await putMed(concurrent);

    const committed = await updateMedicationInventory(med.id, {
      action: 'add',
      quantity: 2,
      unit: '片',
    }, {
      source: 'manual',
      sourceNote: '补货两片',
    });

    expect(committed.med.inventory).toMatchObject({
      remaining: 10,
      unit: '片',
      packageQuantity: 30,
      lowThreshold: 3,
      sourceNote: '并发新值',
      lastReminderAt: 123,
    });
  });

  it('rejects stale inventory metadata changes without committing the quantity', async () => {
    const med: Medication = {
      id: 'med-metadata-conflict',
      name: '库存元数据冲突测试药',
      dosageText: '',
      amountPerDose: '1片',
      slots: [],
      mealRels: [],
      mealRelsBySlot: {},
      daysOfWeek: [],
      inventory: { remaining: 10, unit: '片', packageQuantity: 20, sourceNote: '旧值' },
      identity: emptyIdentity(),
      updatedAt: 1,
    };
    await putMed(med);
    const concurrent = (await getMed(med.id))!;
    concurrent.inventory = { ...concurrent.inventory!, packageQuantity: 30, sourceNote: '并发新值' };
    await putMed(concurrent);

    await expect(updateMedicationInventory(med.id, {
      action: 'set',
      remaining: 9,
      unit: '片',
      expectedRemaining: 10,
      expectedUnit: '片',
      metadata: {
        expected: { packageQuantity: 20, sourceNote: '旧值' },
        value: { packageQuantity: 25, sourceNote: '识别新值' },
      },
    }, {
      source: 'manual',
      sourceNote: '智能录入',
    })).rejects.toMatchObject({ code: 'inventory-conflict' });

    expect((await getMed(med.id))?.inventory).toMatchObject({
      remaining: 10,
      packageQuantity: 30,
      sourceNote: '并发新值',
    });
  });

  it('returns actual committed quantities when a batch request exceeds inventory', async () => {
    const med: Medication = {
      id: 'med-batch-actual',
      name: '批量实际扣减测试药',
      dosageText: '',
      amountPerDose: '1片',
      slots: [],
      mealRels: [],
      mealRelsBySlot: {},
      daysOfWeek: [],
      inventory: { remaining: 3, unit: '片' },
      identity: emptyIdentity(),
      updatedAt: 1,
    };
    await putMed(med);

    const result = await batchDeductInventory([{ medId: med.id, quantity: 10 }]);

    expect(result.items).toEqual([{
      medId: med.id,
      medName: med.name,
      previous: 3,
      deducted: 3,
      remaining: 0,
      unit: '片',
    }]);
    expect((await getMed(med.id))?.inventory?.remaining).toBe(0);
  });

  it('writes manual and wizard inventory logs in the same mutation paths', async () => {
    const med: Medication = {
      id: 'med-source-logs',
      name: '来源日志测试药',
      dosageText: '',
      amountPerDose: '1片',
      doseQuantity: 1,
      doseUnit: '片',
      slots: ['morning'],
      mealRels: [],
      mealRelsBySlot: {},
      daysOfWeek: [],
      inventory: { remaining: 10, unit: '片' },
      identity: emptyIdentity(),
      updatedAt: 1,
    };
    await putMed(med);
    const manual = await updateMedicationInventory(med.id, {
      action: 'set',
      remaining: 9,
      unit: '片',
      expectedRemaining: 10,
      expectedUnit: '片',
    }, {
      source: 'manual',
      sourceNote: '库存页直接修改',
    });
    expect(manual.log).toMatchObject({ source: 'manual', previousRemaining: 10, newRemaining: 9, delta: -1 });

    const wizard = await recordPreDeduction(manual.med, [{
      occurrenceId: 'occ-source-log',
      quantity: 2,
      unit: '片',
    }], toLocalDate());
    expect(wizard).toMatchObject({ deducted: 2, remaining: 7 });
    expect(await listInventoryLogs(med.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'manual', delta: -1, canUndo: true }),
      expect.objectContaining({ source: 'wizard', delta: -2, canUndo: false }),
    ]));
  });

  it('rejects a stale medication profile without overwriting concurrent details', async () => {
    const med: Medication = {
      id: 'med-editor-profile-conflict',
      name: '资料冲突测试药',
      dosageText: '',
      amountPerDose: '1片',
      slots: ['morning'],
      mealRels: [],
      mealRelsBySlot: {},
      daysOfWeek: [],
      inventory: { remaining: 10, unit: '片' },
      notes: '编辑页旧备注',
      identity: emptyIdentity(),
      updatedAt: 1,
    };
    await putMed(med);
    const editorDraft = (await getMed(med.id))!;
    const expectedProfile = structuredClone(editorDraft);
    const concurrent = structuredClone(editorDraft);
    concurrent.name = 'LAN 更新后的药名';
    concurrent.notes = 'LAN 更新后的备注';
    await putMed(concurrent);

    editorDraft.notes = '本地编辑页准备保存';
    await expect(saveMedicationProfile(editorDraft, {
      isNew: false,
      expectedInventory: structuredClone(editorDraft.inventory),
      expectedProfile,
    })).rejects.toMatchObject({ code: 'profile-conflict' });

    expect(await getMed(med.id)).toMatchObject({
      name: 'LAN 更新后的药名',
      notes: 'LAN 更新后的备注',
    });
  });

  it('preserves a fresh pre-deduction when a stale editor draft saves medication details', async () => {
    const med: Medication = {
      id: 'med-editor-pre-deduction',
      name: '编辑与预扣测试药',
      dosageText: '',
      amountPerDose: '1片',
      doseQuantity: 1,
      doseUnit: '片',
      slots: ['morning'],
      mealRels: [],
      mealRelsBySlot: {},
      daysOfWeek: [],
      inventory: { remaining: 10, unit: '片' },
      identity: emptyIdentity(),
      updatedAt: 1,
    };
    await putMed(med);
    const editorDraft = (await getMed(med.id))!;
    const expectedInventory = structuredClone(editorDraft.inventory);
    const expectedProfile = structuredClone(editorDraft);
    const localDate = toLocalDate();
    await recordPreDeduction(editorDraft, [{
      occurrenceId: 'occ-editor-pre-deduction',
      quantity: 1,
      unit: '片',
    }], localDate);

    editorDraft.notes = '编辑页更新备注';
    const saved = await saveMedicationProfile(editorDraft, {
      isNew: false,
      expectedInventory,
      expectedProfile,
    });

    expect(saved.med.notes).toBe('编辑页更新备注');
    expect(saved.med.inventory?.remaining).toBe(9);
    expect(saved.med.preDeduction).toMatchObject({
      localDate,
      occurrenceIds: ['occ-editor-pre-deduction'],
      totalDose: 1,
    });
    expect(saved.med.lastPreDeductedAt).toBeTypeOf('number');
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
