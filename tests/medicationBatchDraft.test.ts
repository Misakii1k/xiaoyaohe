import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  createMedicationDraft,
  parseExplicitDose,
  validateMedicationDraft,
} from '../src/domain/medicationDraft';
import {
  createMedicationBatch,
  getMed,
  listRulesByMed,
  listScheduleRevisions,
} from '../src/db/local';

let sequence = 0;
const id = (prefix: string) => `${prefix}-${++sequence}`;

describe('medication creation drafts', () => {
  it('creates one selected, stable draft with a matching medication id', () => {
    const draft = createMedicationDraft({ id: id('draft') });

    expect(draft.selected).toBe(true);
    expect(draft.medication.id).toBe(draft.id);
    expect(draft.rules).toEqual([]);
    expect(draft.errors).toEqual([]);
  });

  it('parses explicit doses without treating specification strength as a dose', () => {
    expect(parseExplicitDose('1片')).toEqual({ quantity: 1, unit: '片' });
    expect(parseExplicitDose('0.25片')).toEqual({ quantity: 0.25, unit: '片' });
    expect(parseExplicitDose('1.5粒')).toEqual({ quantity: 1.5, unit: '粒' });
    expect(parseExplicitDose('5 mL')).toEqual({ quantity: 5, unit: 'mL' });
    expect(parseExplicitDose('半片')).toEqual({ quantity: 0.5, unit: '片' });
    expect(parseExplicitDose('1/2片')).toEqual({ quantity: 0.5, unit: '片' });
    expect(parseExplicitDose('100mg/片')).toBeUndefined();
    expect(parseExplicitDose('每日一次')).toBeUndefined();
  });

  it('requires a valid medication name and exact time for every selected slot', () => {
    const draft = createMedicationDraft({ id: id('invalid') });
    draft.medication.name = '  ';
    draft.medication.slots = ['morning'];
    draft.rules = [{ id: id('rule'), slot: 'morning', timeLocal: '8:00', enabled: true }];

    expect(validateMedicationDraft(draft).map((error) => error.code)).toEqual(
      expect.arrayContaining(['name-required', 'time-invalid']),
    );
  });

  it('persists all selected medication records, rules, and revisions in one successful batch', async () => {
    const first = validDraft(id('first'), '甲药', ['morning']);
    const second = validDraft(id('second'), '乙药', ['noon', 'evening']);

    const result = await createMedicationBatch([first, second]);

    expect(result.medIds).toEqual([first.id, second.id]);
    for (const draft of [first, second]) {
      expect(await getMed(draft.id)).toMatchObject({ id: draft.id, name: draft.medication.name });
      expect(await listRulesByMed(draft.id)).toHaveLength(draft.rules.length);
      expect((await listScheduleRevisions()).filter((item) => item.medId === draft.id))
        .toHaveLength(draft.rules.length);
    }
  });

  it('writes none of a batch when any selected draft is invalid', async () => {
    const valid = validDraft(id('valid'), '完整药品', ['morning']);
    const invalid = validDraft(id('bad'), '', ['evening']);

    await expect(createMedicationBatch([valid, invalid])).rejects.toMatchObject({
      name: 'MedicationBatchValidationError',
    });
    expect(await getMed(valid.id)).toBeUndefined();
    expect(await getMed(invalid.id)).toBeUndefined();
  });
});

function validDraft(idValue: string, name: string, slots: Array<'morning' | 'noon' | 'evening' | 'bedtime'>) {
  const draft = createMedicationDraft({ id: idValue });
  draft.medication.name = name;
  draft.medication.amountPerDose = '1片';
  draft.medication.doseQuantity = 1;
  draft.medication.doseUnit = '片';
  draft.medication.doseSourceText = '1片';
  draft.medication.slots = slots;
  draft.rules = slots.map((slot, index) => ({
    id: `${idValue}-rule-${index}`,
    slot,
    timeLocal: slot === 'morning' ? '08:00' : slot === 'noon' ? '12:00' : '18:00',
    enabled: true,
  }));
  return draft;
}
