import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  MedicationImageBatchError,
  recognizeMedicationImageBatch,
  validateMedicationImageBatch,
} from '../src/features/medicationBatch';

const image = (name: string, size = 100) => new File([new Uint8Array(size)], name, { type: 'image/jpeg' });

describe('batch medication image recognition queue', () => {
  it('rejects oversized, non-image, and over-count image selections before sending any request', () => {
    expect(() => validateMedicationImageBatch([new File(['x'], 'note.txt', { type: 'text/plain' })]))
      .toThrow(MedicationImageBatchError);
    expect(() => validateMedicationImageBatch(Array.from({ length: 11 }, (_, index) => image(`${index}.jpg`))))
      .toThrow(/最多选择 10 张/);
    expect(() => validateMedicationImageBatch([image('large.jpg', 12 * 1024 * 1024 + 1)]))
      .toThrow(/不能超过 12MB/);
  });

  it('keeps successful images when another image fails and never exceeds two concurrent requests', async () => {
    const files = [image('first.jpg'), image('second.jpg'), image('third.jpg')];
    let active = 0;
    let maxActive = 0;
    const result = await recognizeMedicationImageBatch(files, async (file) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (file.name === 'second.jpg') throw new Error('图片模糊');
      return [{ name: file.name }];
    });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(result.items).toEqual([{ name: 'first.jpg' }, { name: 'third.jpg' }]);
    expect(result.failures).toEqual([expect.objectContaining({ file: files[1], message: '图片模糊' })]);
  });

  it('stops unstarted work after cancellation', async () => {
    const controller = new AbortController();
    const files = [image('first.jpg'), image('second.jpg'), image('third.jpg')];
    const started: string[] = [];
    const result = await recognizeMedicationImageBatch(files, async (file) => {
      started.push(file.name);
      controller.abort();
      return [{ name: file.name }];
    }, { signal: controller.signal, concurrency: 1 });

    expect(started).toEqual(['first.jpg']);
    expect(result.cancelled).toBe(true);
    expect(result.items).toEqual([{ name: 'first.jpg' }]);
  });
});
