export const MAX_MEDICATION_IMAGES = 10;
export const MAX_MEDICATION_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_MEDICATION_IMAGE_BATCH_BYTES = 30 * 1024 * 1024;
export const MAX_MEDICATION_BATCH_ITEMS = 50;

export class MedicationImageBatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MedicationImageBatchError';
  }
}

export interface MedicationImageBatchOptions {
  signal?: AbortSignal;
  concurrency?: number;
  maxItems?: number;
}

export interface MedicationImageFailure {
  file: File;
  message: string;
}

export interface MedicationImageBatchResult<T> {
  items: T[];
  failures: MedicationImageFailure[];
  cancelled: boolean;
}

export function validateMedicationImageBatch(files: readonly File[]): void {
  if (files.length === 0) throw new MedicationImageBatchError('请至少选择一张药品图片');
  if (files.length > MAX_MEDICATION_IMAGES) throw new MedicationImageBatchError('一次最多选择 10 张图片');
  let total = 0;
  for (const file of files) {
    if (!file.type.startsWith('image/')) throw new MedicationImageBatchError(`${file.name} 不是图片文件`);
    if (file.size > MAX_MEDICATION_IMAGE_BYTES) throw new MedicationImageBatchError(`${file.name} 不能超过 12MB`);
    total += file.size;
  }
  if (total > MAX_MEDICATION_IMAGE_BATCH_BYTES) {
    throw new MedicationImageBatchError('本次图片总大小不能超过 30MB');
  }
}

/**
 * Processes image requests with stable file order. A failed image is reported
 * independently so successful prior/later recognition results remain usable.
 */
export async function recognizeMedicationImageBatch<T>(
  files: readonly File[],
  recognize: (file: File) => Promise<readonly T[]>,
  options: MedicationImageBatchOptions = {},
): Promise<MedicationImageBatchResult<T>> {
  validateMedicationImageBatch(files);
  const concurrency = Math.max(1, Math.min(2, Math.floor(options.concurrency ?? 2)));
  const maxItems = options.maxItems ?? MAX_MEDICATION_BATCH_ITEMS;
  const slots: Array<readonly T[] | undefined> = new Array(files.length);
  const failures: MedicationImageFailure[] = [];
  let nextIndex = 0;
  let cancelled = options.signal?.aborted ?? false;

  const worker = async () => {
    while (!options.signal?.aborted) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= files.length) return;
      const file = files[index];
      if (!file) return;
      try {
        const items = await recognize(file);
        if (items.length > 20) throw new MedicationImageBatchError(`${file.name} 返回的药品数量超过 20 条`);
        slots[index] = items;
      } catch (error) {
        failures.push({ file, message: error instanceof Error ? error.message : String(error) });
      }
    }
    cancelled = true;
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  if (options.signal?.aborted) cancelled = true;
  const items = slots.flatMap((entry) => entry ?? []);
  if (items.length > maxItems) {
    throw new MedicationImageBatchError(`本次识别结果不能超过 ${maxItems} 条药品`);
  }
  return { items, failures, cancelled };
}
