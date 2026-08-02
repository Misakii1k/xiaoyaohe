import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { listPushStates, openMedboxDatabase, putPushState } from '../src/db/local';

beforeEach(async () => {
  const database = await openMedboxDatabase();
  await database.clear('pushStates');
});

describe('listPushStates', () => {
  it('reads the store once and filters requested occurrence states in memory', async () => {
    const database = await openMedboxDatabase();
    await Promise.all([
      putPushState({ id: 'due-a', count: 1, lastSentAt: 10 }),
      putPushState({ id: 'due-b', count: 2, lastSentAt: 20 }),
      putPushState({ id: 'unrelated', count: 3, lastSentAt: 30 }),
    ]);
    let getAllCalls = 0;
    const originalGetAll = database.getAll.bind(database);
    database.getAll = ((...args: Parameters<typeof originalGetAll>) => {
      getAllCalls += 1;
      return originalGetAll(...args);
    }) as typeof database.getAll;

    const states = await listPushStates(['due-b', 'missing', 'due-a']);

    expect(getAllCalls).toBe(1);
    expect(states).toEqual([
      { id: 'due-a', count: 1, lastSentAt: 10 },
      { id: 'due-b', count: 2, lastSentAt: 20 },
    ]);
  });
});
