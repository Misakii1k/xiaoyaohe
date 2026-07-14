import { beforeEach, describe, expect, it, vi } from 'vitest';

const html5Mocks = vi.hoisted(() => ({
  instances: [] as any[],
  success: undefined as ((text: string, result: unknown) => void) | undefined,
  fileResult: {
    decodedText: 'FILE-CODE',
    result: { format: { formatName: 'DATA_MATRIX' } },
  },
  events: [] as string[],
}));

vi.mock('html5-qrcode', () => {
  class Html5Qrcode {
    isScanning = true;
    start = vi.fn(async (_camera, _config, success) => {
      html5Mocks.success = success;
      return null;
    });
    pause = vi.fn(() => html5Mocks.events.push('pause'));
    resume = vi.fn(() => html5Mocks.events.push('resume'));
    stop = vi.fn(async () => {
      html5Mocks.events.push('stop');
    });
    clear = vi.fn(() => html5Mocks.events.push('clear'));
    scanFileV2 = vi.fn(async () => html5Mocks.fileResult);

    constructor(public readonly elementId: string) {
      html5Mocks.instances.push(this);
    }
  }
  return { Html5Qrcode };
});

import { createResultGate, scanCodeFromImage, startScan } from '../src/features/scanner';
import { applyMedicationFieldDiff, buildMedicationFieldDiff } from '../src/pages/ScanSort';
import { emptyIdentity, type Medication } from '../src/db/schema';
import type { IdentifyResult } from '../src/ai/identify';

beforeEach(() => {
  html5Mocks.instances.length = 0;
  html5Mocks.events.length = 0;
  html5Mocks.success = undefined;
  vi.stubGlobal('window', { BarcodeDetector: undefined });
});

describe('scanner session lifecycle', () => {
  it('pauses before delivering the first new code and deduplicates it after resume', () => {
    const statesAtDelivery: string[] = [];
    let gate: ReturnType<typeof createResultGate>;
    gate = createResultGate(() => statesAtDelivery.push(gate.state));

    expect(gate.accept({ raw: ' 123 ', format: 'EAN_13' })).toBe(true);
    expect(statesAtDelivery).toEqual(['paused']);
    expect(gate.state).toBe('paused');
    expect(gate.accept({ raw: '123', format: 'EAN_13' })).toBe(false);

    gate.resume();
    expect(gate.accept({ raw: '123', format: 'EAN_13' })).toBe(false);
    expect(gate.state).toBe('running');
    expect(gate.accept({ raw: '456', format: 'EAN_13' })).toBe(true);
    expect(statesAtDelivery).toEqual(['paused', 'paused']);
  });

  it('makes html5 camera scanning pause explicitly and only resume on command', async () => {
    const delivered: string[] = [];
    const scanner = await startScan({
      containerId: 'reader',
      onScan: (result) => {
        html5Mocks.events.push('scan');
        delivered.push(result.raw);
      },
    });

    html5Mocks.success?.('A-001', { result: { format: { formatName: 'CODE_128' } } });
    expect(html5Mocks.events.slice(0, 2)).toEqual(['pause', 'scan']);
    expect(scanner.state).toBe('paused');

    await scanner.resume();
    html5Mocks.success?.('A-001', { result: { format: { formatName: 'CODE_128' } } });
    expect(delivered).toEqual(['A-001']);
    expect(scanner.state).toBe('running');

    html5Mocks.success?.('A-002', { result: { format: { formatName: 'CODE_128' } } });
    expect(delivered).toEqual(['A-001', 'A-002']);
    expect(scanner.state).toBe('paused');
    await scanner.stop();
    expect(scanner.state).toBe('stopped');
  });

  it('uses html5-qrcode for file images when BarcodeDetector is unavailable', async () => {
    const host = {
      id: '',
      hidden: false,
      remove: vi.fn(),
    };
    const append = vi.fn();
    vi.stubGlobal('document', {
      createElement: vi.fn(() => host),
      body: { append },
    });

    const result = await scanCodeFromImage(new File(['image'], 'box.jpg', { type: 'image/jpeg' }));

    expect(result).toEqual({ raw: 'FILE-CODE', format: 'DATA_MATRIX' });
    expect(html5Mocks.instances).toHaveLength(1);
    expect(html5Mocks.instances[0].scanFileV2).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledWith(host);
    expect(host.remove).toHaveBeenCalledOnce();
  });
});

describe('recognized medication field review', () => {
  const existing: Medication = {
    id: 'med-1',
    name: '旧药名',
    dosageText: '5mg/片',
    amountPerDose: '1片',
    slots: ['morning'],
    mealRels: [],
    mealRelsBySlot: {},
    daysOfWeek: [],
    identity: emptyIdentity(),
    updatedAt: 1,
  };
  const recognized: IdentifyResult = {
    name: '新药名',
    dosageText: '10mg/片',
    amountPerDose: '2片',
    slots: ['noon', 'evening'],
    mealRels: ['after'],
    mealRelsBySlot: { noon: ['after'], evening: ['after'] },
    evidence: { ocrNames: ['新药名'], gtins: [], rawCodes: [] },
    confidence: 0.9,
  };

  it('presents explicit name, specification, dose and slot differences', () => {
    const diffs = buildMedicationFieldDiff(existing, recognized);

    expect(diffs.map((diff) => diff.field)).toEqual(['name', 'dosageText', 'amountPerDose', 'slots']);
    expect(diffs.every((diff) => diff.changed && diff.applicable)).toBe(true);
    expect(diffs.find((diff) => diff.field === 'slots')).toMatchObject({
      current: '早上',
      recognized: '中午、晚上',
    });
  });

  it('applies only selected fields and keeps the original object unchanged', () => {
    const updated = applyMedicationFieldDiff(
      existing,
      recognized,
      new Set(['dosageText', 'slots']),
    );

    expect(updated.name).toBe('旧药名');
    expect(updated.dosageText).toBe('10mg/片');
    expect(updated.amountPerDose).toBe('1片');
    expect(updated.slots).toEqual(['noon', 'evening']);
    expect(updated.mealRelsBySlot).toEqual({ noon: ['after'], evening: ['after'] });
    expect(existing).toMatchObject({ dosageText: '5mg/片', slots: ['morning'] });
  });

  it('does not clear existing values when recognition leaves a field blank', () => {
    const sparse = { ...recognized, dosageText: '', amountPerDose: '', slots: [] as [] };
    const diffs = buildMedicationFieldDiff(existing, sparse);
    const updated = applyMedicationFieldDiff(
      existing,
      sparse,
      new Set(['dosageText', 'amountPerDose', 'slots']),
    );

    expect(diffs.filter((diff) => diff.field !== 'name').every((diff) => !diff.applicable)).toBe(true);
    expect(updated).toMatchObject({
      dosageText: '5mg/片',
      amountPerDose: '1片',
      slots: ['morning'],
    });
  });
});
