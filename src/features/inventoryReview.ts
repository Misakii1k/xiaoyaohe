import type { Medication } from '../db/schema';

export interface InventoryReviewCommitTask<T> {
  targetId: string;
  payload: T;
}

export type InventoryReviewCommitResult<T> =
  | { task: InventoryReviewCommitTask<T>; status: 'saved'; medication: Medication }
  | { task: InventoryReviewCommitTask<T>; status: 'failed' | 'blocked'; error: string };

type MedicationLoader = (id: string) => Promise<Medication | undefined>;
type InventoryCommitter<T> = (medication: Medication, payload: T) => Promise<Medication>;

/**
 * 按识别顺序保存库存。同一药品的前一条失败后，后续条目留到下次重试，
 * 避免 set/add 越过失败项后改变用户确认的处理顺序。
 */
export async function processInventoryReviewCommits<T>(
  tasks: readonly InventoryReviewCommitTask<T>[],
  loadMedication: MedicationLoader,
  commit: InventoryCommitter<T>,
): Promise<InventoryReviewCommitResult<T>[]> {
  const blockedTargets = new Set<string>();
  const results: InventoryReviewCommitResult<T>[] = [];

  for (const task of tasks) {
    if (blockedTargets.has(task.targetId)) {
      results.push({
        task,
        status: 'blocked',
        error: '同一药品前一条尚未保存，请先修正后重试',
      });
      continue;
    }

    try {
      const medication = await loadMedication(task.targetId);
      if (!medication || medication.deleted) {
        throw new Error('对应药品已不存在，请重新选择');
      }
      results.push({
        task,
        status: 'saved',
        medication: await commit(medication, task.payload),
      });
    } catch (error) {
      blockedTargets.add(task.targetId);
      results.push({
        task,
        status: 'failed',
        error: error instanceof Error ? error.message : '库存保存失败',
      });
    }
  }

  return results;
}
