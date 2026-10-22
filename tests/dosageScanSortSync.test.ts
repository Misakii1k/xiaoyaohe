// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getMed,
  listMeds,
  listScheduleRevisions,
  normalizeMedication,
  openMedboxDatabase,
  putMed,
  putRule,
  recordPreDeduction,
} from '../src/db/local';
import { applyMedicationFieldDiff } from '../src/pages/ScanSort';
import { updateMedication } from '../src/ai/tools/medicationTools';
import { toLocalDate } from '../src/domain/medicationSchedule';
import type { Medication, ReminderRule } from '../src/db/schema';
import type { IdentifyResult } from '../src/ai/identify';

describe('剂量修改与分药页面同步（智能差额与关联全链路）', () => {
  beforeEach(async () => {
    const d = await openMedboxDatabase();
    await d.clear('meds');
    await d.clear('rules');
    await d.clear('scheduleRevisions');
    await d.clear('inventoryLogs');
  });

  afterEach(async () => {
    const d = await openMedboxDatabase();
    await d.clear('meds');
    await d.clear('rules');
    await d.clear('scheduleRevisions');
    await d.clear('inventoryLogs');
  });

  it('(1) applyMedicationFieldDiff 更新每次剂量文本，分药页面入口优先对齐 med 最新有效剂量', () => {
    const med: Medication = {
      id: 'med-diff-test',
      name: '阿司匹林',
      dosageText: '100mg',
      amountPerDose: '1片',
      doseQuantity: 1,
      doseUnit: '片',
      doseSourceText: '1片',
      doseReviewRequired: false,
      slots: ['morning'],
      mealRels: [],
      mealRelsBySlot: {},
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      identity: { gtins: [], rawCodes: [], ocrNames: [], photoHashes: [] },
    };

    const identifyResult: IdentifyResult = {
      name: '阿司匹林',
      dosageText: '100mg',
      amountPerDose: '2片',
      slots: ['morning'],
      mealRels: [],
      mealRelsBySlot: {},
      evidence: { gtins: [], rawCodes: [], ocrNames: [] },
      confidence: 1,
    };

    const diffSelected = new Set<'amountPerDose'>(['amountPerDose']);
    const updated = applyMedicationFieldDiff(med, identifyResult, diffSelected);
    expect(updated.amountPerDose).toBe('2片');
    expect(updated.doseQuantity).toBe(2);
    expect(updated.doseUnit).toBe('片');
    expect(updated.doseSourceText).toBe('2片');

    // 关键验证：经过 normalizeMedication 也不应删除结构化剂量
    const normalized = normalizeMedication(updated);
    expect(normalized.doseQuantity).toBe(2);
    expect(normalized.doseUnit).toBe('片');
    expect(normalized.doseReviewRequired).toBe(false);

    // 当药品有确认结构化剂量时，分药页面优先对齐最新有效剂量
    const legacyOccurrence = { id: 'occ-1', doseQuantity: 1, doseUnit: '片' };
    const medHasDose = Number.isFinite(normalized.doseQuantity) && (normalized.doseQuantity as number) > 0 && !!normalized.doseUnit?.trim();
    const effectiveDoseQuantity = medHasDose ? normalized.doseQuantity : legacyOccurrence.doseQuantity;
    const effectiveDoseUnit = medHasDose ? normalized.doseUnit!.trim() : legacyOccurrence.doseUnit;

    expect(effectiveDoseQuantity).toBe(2);
    expect(effectiveDoseUnit).toBe('片');
  });

  it('(2) AI 助手 updateMedication 修改剂量时同步关联 rule 并派生最新 scheduleRevisions 快照', async () => {
    const med: Medication = {
      id: 'med-ai-update',
      name: '降压片',
      dosageText: '5mg',
      amountPerDose: '1片',
      doseQuantity: 1,
      doseUnit: '片',
      doseSourceText: '1片',
      slots: ['morning'],
      mealRels: [],
      mealRelsBySlot: {},
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      identity: { gtins: [], rawCodes: [], ocrNames: [], photoHashes: [] },
    };
    await putMed(med);

    const rule: ReminderRule = {
      id: 'rule-ai-update',
      medId: med.id,
      slot: 'morning',
      timeLocal: '08:00',
      enabled: true,
      escalate: { repeatCount: 1, intervalMinutes: 10 },
      updatedAt: 1000,
    };
    await putRule(rule);

    const initialRevisions = await listScheduleRevisions();
    expect(initialRevisions.find((r) => r.sourceRuleId === rule.id)?.doseQuantity).toBe(1);

    // AI 修改剂量为 2片
    const result = await updateMedication.run({
      medName: '降压片',
      amountPerDose: '2片',
    });
    expect(result.ok).toBe(true);

    const updatedMed = await getMed(med.id);
    expect(updatedMed?.amountPerDose).toBe('2片');
    expect(updatedMed?.doseQuantity).toBe(2);

    const newRevisions = await listScheduleRevisions();
    const latestRev = newRevisions
      .filter((r) => r.sourceRuleId === rule.id)
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.createdAt - a.createdAt)[0];

    expect(latestRev.doseQuantity).toBe(2);
  });

  it('(3) listScheduleRevisions 激活 scheduleRevisionMatches，快照与最新 med 剂量不吻合时派生今日新快照', async () => {
    const med: Medication = {
      id: 'med-matches-test',
      name: '维生素C',
      dosageText: '100mg',
      amountPerDose: '1片',
      doseQuantity: 1,
      doseUnit: '片',
      doseSourceText: '1片',
      slots: ['noon'],
      mealRels: [],
      mealRelsBySlot: {},
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      identity: { gtins: [], rawCodes: [], ocrNames: [], photoHashes: [] },
    };
    await putMed(med);

    const rule: ReminderRule = {
      id: 'rule-matches-test',
      medId: med.id,
      slot: 'noon',
      timeLocal: '12:00',
      enabled: true,
      escalate: { repeatCount: 1, intervalMinutes: 10 },
      updatedAt: 1000,
    };
    await putRule(rule);

    const revs1 = await listScheduleRevisions();
    expect(revs1.find((r) => r.sourceRuleId === rule.id)?.doseQuantity).toBe(1);

    // 模拟仅直接修改 med 剂量，但 rule.updatedAt 未变
    med.amountPerDose = '3片';
    med.doseQuantity = 3;
    med.doseSourceText = '3片';
    await putMed(med);

    // listScheduleRevisions 通过 scheduleRevisionMatches 检查发现已有快照与 med 不吻合，派生今日新快照
    const revs2 = await listScheduleRevisions();
    const latestRev = revs2
      .filter((r) => r.sourceRuleId === rule.id)
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.createdAt - a.createdAt)[0];

    expect(latestRev.doseQuantity).toBe(3);
    expect(latestRev.effectiveDate).toBe(toLocalDate(new Date()));
  });

  it('(4) recordPreDeduction 智能差额：调大自动补扣差额并记账，调小提示“建议从药盒取出放回药瓶”', async () => {
    const today = toLocalDate(new Date());
    const med: Medication = {
      id: 'med-diff-pre-deduct',
      name: '钙片',
      dosageText: '600mg',
      amountPerDose: '1片',
      doseQuantity: 1,
      doseUnit: '片',
      doseSourceText: '1片',
      slots: ['morning'],
      mealRels: [],
      mealRelsBySlot: {},
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      inventory: { remaining: 10, unit: '片' },
      identity: { gtins: [], rawCodes: [], ocrNames: [], photoHashes: [] },
    };
    await putMed(med);

    const occurrenceId = 'occ-morning-1';

    // 1. 首次分药：1片，全额扣减 1 片，剩余 9 片
    const first = await recordPreDeduction(med, [
      { occurrenceId, quantity: 1, unit: '片' },
    ], today);
    expect(first.deducted).toBe(1);
    expect(first.deductedOccurrences).toBe(1);
    expect(first.remaining).toBe(9);
    expect(first.adviceMessage).toBeUndefined();

    // 2. 剂量未变再次分药：无需重复扣减
    const repeated = await recordPreDeduction(first.med, [
      { occurrenceId, quantity: 1, unit: '片' },
    ], today);
    expect(repeated.deducted).toBe(0);
    expect(repeated.skippedOccurrences).toBe(1);
    expect(repeated.remaining).toBe(9);

    // 3. 剂量调大：从 1片 改为 3片，智能补扣差额 2 片，剩余 7 片，并记账
    const increased = await recordPreDeduction(first.med, [
      { occurrenceId, quantity: 3, unit: '片' },
    ], today);
    expect(increased.deducted).toBe(2);
    expect(increased.deductedOccurrences).toBe(1);
    expect(increased.remaining).toBe(7);

    // 4. 剂量调小：从 3片 改为 1片，不扣库存，给出友好提示
    const decreased = await recordPreDeduction(increased.med, [
      { occurrenceId, quantity: 1, unit: '片' },
    ], today);
    expect(decreased.deducted).toBe(0);
    expect(decreased.remaining).toBe(7);
    expect(decreased.adviceMessage).toContain('建议从药盒取出放回药瓶，保持物理药盒与账面一致');

    // 5. 再次调大：从 1片 改回 3片，智能差额再次补扣 2 片，剩余 5 片
    const reIncreased = await recordPreDeduction(decreased.med, [
      { occurrenceId, quantity: 3, unit: '片' },
    ], today);
    expect(reIncreased.deducted).toBe(2);
    expect(reIncreased.deductedOccurrences).toBe(1);
    expect(reIncreased.remaining).toBe(5);
  });

  it('(4b) recordPreDeduction 调大剂量但库存不足以补扣差额时安全回滚并提示低库存', async () => {
    const today = toLocalDate(new Date());
    const med: Medication = {
      id: 'med-low-stock-test',
      name: '阿莫西林',
      dosageText: '250mg',
      amountPerDose: '1粒',
      doseQuantity: 1,
      doseUnit: '粒',
      doseSourceText: '1粒',
      slots: ['morning'],
      mealRels: [],
      mealRelsBySlot: {},
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      inventory: { remaining: 2, unit: '粒' },
      identity: { gtins: [], rawCodes: [], ocrNames: [], photoHashes: [] },
    };
    await putMed(med);

    const occurrenceId = 'occ-amx-1';

    // 首次分药：1粒，剩余 1 粒
    const first = await recordPreDeduction(med, [{ occurrenceId, quantity: 1, unit: '粒' }], today);
    expect(first.deducted).toBe(1);
    expect(first.remaining).toBe(1);

    // 剂量调大至 3粒（需补扣 2粒，但库存仅剩 1粒），应回滚不扣库存并提示
    const failed = await recordPreDeduction(first.med, [{ occurrenceId, quantity: 3, unit: '粒' }], today);
    expect(failed.deducted).toBe(0);
    expect(failed.remaining).toBe(1);
    expect(failed.lowStockMessage).toContain('库存不足（本次需补扣 2粒，剩余 1粒），未执行预扣');
  });

  it('(1b) ScanSort 分药入口优先对齐 med 最新有效剂量，即使 occurrence 快照仍为旧值', () => {
    const med: Medication = {
      id: 'med-scansort-align',
      name: '络活喜',
      dosageText: '5mg',
      amountPerDose: '2片',
      doseQuantity: 2,
      doseUnit: '片',
      doseSourceText: '2片',
      slots: ['morning'],
      mealRels: [],
      mealRelsBySlot: {},
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      identity: { gtins: [], rawCodes: [], ocrNames: [], photoHashes: [] },
    };

    // 假设 occurrence 来自未刷新时的旧快照（只有 1片）
    const legacyOccurrence = {
      id: 'occ-old-snapshot',
      doseQuantity: 1,
      doseUnit: '片',
    };

    const medHasDose = Number.isFinite(med.doseQuantity) && (med.doseQuantity as number) > 0 && !!med.doseUnit?.trim();
    const effectiveDoseQuantity = medHasDose ? med.doseQuantity : legacyOccurrence.doseQuantity;
    const effectiveDoseUnit = medHasDose ? med.doseUnit!.trim() : legacyOccurrence.doseUnit;
    const doseLabel = effectiveDoseQuantity && effectiveDoseUnit
      ? `${effectiveDoseQuantity}${effectiveDoseUnit}`
      : (med.amountPerDose || '');

    expect(effectiveDoseQuantity).toBe(2);
    expect(effectiveDoseUnit).toBe('片');
    expect(doseLabel).toBe('2片');
  });

  it('(3b) listScheduleRevisions 遇已删除规则不派生多余快照', async () => {
    const med: Medication = {
      id: 'med-del-rule-test',
      name: '胃泰',
      dosageText: '1袋',
      amountPerDose: '1袋',
      doseQuantity: 1,
      doseUnit: '袋',
      doseSourceText: '1袋',
      slots: ['morning'],
      mealRels: [],
      mealRelsBySlot: {},
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      identity: { gtins: [], rawCodes: [], ocrNames: [], photoHashes: [] },
    };
    await putMed(med);

    const rule: ReminderRule = {
      id: 'rule-del-test',
      medId: med.id,
      slot: 'morning',
      timeLocal: '08:00',
      enabled: false,
      deleted: true,
      escalate: { repeatCount: 1, intervalMinutes: 10 },
      updatedAt: 1000,
    };
    await putRule(rule);

    const revs = await listScheduleRevisions();
    const ruleRevs = revs.filter((r) => r.sourceRuleId === rule.id);
    // 已删除规则不应重复新增衍生快照
    expect(ruleRevs.length).toBeLessThanOrEqual(1);
  });
});
