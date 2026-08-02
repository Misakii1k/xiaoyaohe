import { describe, expect, it } from 'vitest';
import {
  calculateBatchDeductionPreview,
  roundStock,
} from '../src/features/inventory';
import type { Medication, ReminderRule } from '../src/db/schema';
import { findAssistantTool } from '../src/ai/assistantTools';

describe('Inventory Logs, Undo & Batch Deduction Preview', () => {
  it('calculates batch deduction preview accurately with diffs', () => {
    const med1: Medication = {
      id: 'med1',
      name: '阿司匹林',
      dosageText: '100mg/片',
      amountPerDose: '1片',
      doseQuantity: 1,
      doseUnit: '片',
      slots: ['morning'],
      mealRels: [],
      mealRelsBySlot: {},
      daysOfWeek: [],
      reminderMode: 'strong',
      inventory: { remaining: 20, unit: '片', lowThreshold: 5 },
      identity: { gtins: [], rawCodes: [], ocrNames: [], photoHashes: [] },
      updatedAt: Date.now(),
    };

    const med2: Medication = {
      id: 'med2',
      name: '降压药',
      dosageText: '5mg/片',
      amountPerDose: '2片',
      doseQuantity: 2,
      doseUnit: '片',
      slots: ['morning', 'evening'],
      mealRels: [],
      mealRelsBySlot: {},
      daysOfWeek: [],
      reminderMode: 'strong',
      inventory: { remaining: 10, unit: '片', lowThreshold: 8 },
      identity: { gtins: [], rawCodes: [], ocrNames: [], photoHashes: [] },
      updatedAt: Date.now(),
    };

    const rules: ReminderRule[] = [
      { id: 'r1', medId: 'med1', slot: 'morning', timeLocal: '08:00', enabled: true, escalate: { repeatEveryMin: 10, maxRepeats: 3, notifyCaregiverAfterMin: 30 }, updatedAt: Date.now() },
      { id: 'r2', medId: 'med2', slot: 'morning', timeLocal: '08:00', enabled: true, escalate: { repeatEveryMin: 10, maxRepeats: 3, notifyCaregiverAfterMin: 30 }, updatedAt: Date.now() },
      { id: 'r3', medId: 'med2', slot: 'evening', timeLocal: '20:00', enabled: true, escalate: { repeatEveryMin: 10, maxRepeats: 3, notifyCaregiverAfterMin: 30 }, updatedAt: Date.now() },
    ];

    const preview = calculateBatchDeductionPreview([med1, med2], rules, 7);

    expect(preview.days).toBe(7);
    expect(preview.items).toHaveLength(2);

    const med1Preview = preview.items.find((i) => i.medId === 'med1')!;
    expect(med1Preview.dailyConsumption).toBe(1);
    expect(med1Preview.deductQuantity).toBe(7);
    expect(med1Preview.expectedRemaining).toBe(13);
    expect(med1Preview.willBeEmpty).toBe(false);

    const med2Preview = preview.items.find((i) => i.medId === 'med2')!;
    expect(med2Preview.dailyConsumption).toBe(4); // 2片 * 2次/天
    expect(med2Preview.deductQuantity).toBe(28);
    expect(med2Preview.expectedRemaining).toBe(0); // 原有 10，扣 28 归零
    expect(med2Preview.willBeEmpty).toBe(true);
  });

  it('registers new AI assistant tools for inventory logs, undo and batch deduction', () => {
    const logsTool = findAssistantTool('get_inventory_logs');
    expect(logsTool).toBeDefined();
    expect(logsTool?.name).toBe('get_inventory_logs');

    const undoTool = findAssistantTool('undo_inventory_operation');
    expect(undoTool).toBeDefined();
    expect(undoTool?.name).toBe('undo_inventory_operation');

    const batchTool = findAssistantTool('batch_deduct_inventory');
    expect(batchTool).toBeDefined();
    expect(batchTool?.name).toBe('batch_deduct_inventory');
  });

  it('mark_medication tool supports date parameter for past intake management', () => {
    const markTool = findAssistantTool('mark_medication');
    expect(markTool).toBeDefined();
    const props = markTool?.parameters.properties as Record<string, unknown>;
    expect(props).toHaveProperty('date');
  });
});
