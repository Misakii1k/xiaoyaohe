import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkEntry } from '../src/db/schema';
import {
  importWorkData,
  listWorkEntries,
  putWorkEntry,
  RunningWorkEntryConflictError,
  softDeleteWorkEntry,
  startWorkEntry,
} from '../src/db/work';

describe('atomic work entry start', () => {
  beforeEach(async () => {
    await Promise.all((await listWorkEntries(true)).map((entry) => softDeleteWorkEntry(entry.id)));
  });

  it('allows only one running entry when two starts race', async () => {
    const [first, second] = await Promise.all([
      startWorkEntry(runningEntry('atomic-start-a')),
      startWorkEntry(runningEntry('atomic-start-b')),
    ]);

    expect([first, second].filter((result) => result.started)).toHaveLength(1);
    expect([first, second].filter((result) => !result.started)).toHaveLength(1);
    const running = (await listWorkEntries()).filter((entry) => entry.status === 'running');
    expect(running).toHaveLength(1);
  });

  it('rejects a stale edit that would revive a second running entry', async () => {
    const stale = stoppedEntry('stale-editor');
    await putWorkEntry(stale);
    await startWorkEntry(runningEntry('active-shift'));

    await expect(putWorkEntry({ ...stale, status: 'running', endAt: undefined }))
      .rejects.toBeInstanceOf(RunningWorkEntryConflictError);

    const running = (await listWorkEntries()).filter((entry) => entry.status === 'running');
    expect(running).toMatchObject([{ id: 'active-shift' }]);
  });

  it('rolls back a backup import that would create multiple running entries', async () => {
    await expect(importWorkData({
      workEntries: [runningEntry('backup-running-a'), runningEntry('backup-running-b')],
    })).rejects.toBeInstanceOf(RunningWorkEntryConflictError);

    expect(await listWorkEntries()).toHaveLength(0);
  });
});

function runningEntry(id: string): WorkEntry {
  return {
    id,
    projectName: 'Atomic start test',
    taskName: id,
    startAt: Date.now(),
    status: 'running',
    settlementStatus: 'pending',
    updatedAt: 0,
  };
}

function stoppedEntry(id: string): WorkEntry {
  const startAt = Date.now() - 60_000;
  return {
    ...runningEntry(id),
    startAt,
    endAt: startAt + 30_000,
    status: 'stopped',
  };
}
