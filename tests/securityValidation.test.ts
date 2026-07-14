import { describe, expect, it } from 'vitest';
import { parseSafeBackupPayload } from '../src/security/validation';

function validMedication(name = '测试药') {
  return {
    id: 'med-1',
    name,
    dosageText: '100mg/片',
    amountPerDose: '1片',
    slots: ['morning'],
    mealRels: [],
    mealRelsBySlot: {},
    daysOfWeek: [],
    identity: { gtins: [], rawCodes: [], ocrNames: [], photoHashes: [] },
    updatedAt: 1,
  };
}

describe('backup runtime validation', () => {
  it('accepts hostile-looking strings as data without interpreting markup', () => {
    const name = '<img src=x onerror=alert(1)>';
    const parsed = parseSafeBackupPayload({
      app: 'medbox',
      version: 4,
      meds: [validMedication(name)],
    });

    expect((parsed.meds as Array<{ name: string }>)[0].name).toBe(name);
  });

  it('rejects malformed records before they reach IndexedDB', () => {
    expect(() => parseSafeBackupPayload({
      app: 'medbox',
      meds: [{ ...validMedication(), daysOfWeek: [8] }],
    })).toThrow(/meds\.0\.daysOfWeek\.0/);

    expect(() => parseSafeBackupPayload({
      app: 'medbox',
      workEntries: [{ id: 'entry-1', startAt: 'not-a-number' }],
    })).toThrow(/workEntries\.0/);
  });
});
