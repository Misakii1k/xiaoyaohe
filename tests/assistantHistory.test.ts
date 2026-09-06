// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  appendAssistantMessage,
  clearAssistantMessages,
  listRecentAssistantMessages,
  upgradeMedboxDatabase,
} from '../src/db/local';
import type { AssistantChatRecord } from '../src/db/schema';
import type { IDBPDatabase } from 'idb';
import type { MedboxDB } from '../src/db/local';

function makeRecord(role: AssistantChatRecord['role'], content: string, createdAt: number): AssistantChatRecord {
  return { id: `${role}-${createdAt}-${Math.random().toString(36).slice(2, 8)}`, role, content, createdAt };
}

describe('medbox database upgrade v10 (assistantMessages)', () => {
  it('creates the assistantMessages store with byCreatedAt index only below v10', () => {
    const created: string[] = [];
    const fakeDb = {
      objectStoreNames: { contains: () => false },
      createObjectStore: (name: string) => {
        created.push(name);
        return { createIndex: () => undefined };
      },
    } as unknown as IDBPDatabase<MedboxDB>;

    upgradeMedboxDatabase(fakeDb, 9);
    expect(created).toEqual(['assistantMessages']);

    // 已在 v10 的库重复打开时不能再建
    const createdAgain: string[] = [];
    const fakeDb2 = {
      objectStoreNames: { contains: () => true },
      createObjectStore: (name: string) => {
        createdAgain.push(name);
        return { createIndex: () => undefined };
      },
    } as unknown as IDBPDatabase<MedboxDB>;
    upgradeMedboxDatabase(fakeDb2, 10);
    expect(createdAgain).toEqual([]);
  });
});

describe('assistant chat history persistence', () => {
  beforeEach(async () => {
    await clearAssistantMessages();
  });

  it('lists messages oldest-first and keeps blocks payloads intact', async () => {
    await appendAssistantMessage(makeRecord('user', '今天吃什么药', 1_000));
    await appendAssistantMessage({
      id: 'a-2',
      role: 'assistant',
      content: '',
      blocks: [{ type: 'card', title: '今日用药', items: [{ title: '阿司匹林' }] }],
      createdAt: 1_001,
    });
    await appendAssistantMessage(makeRecord('user', '库存还有多少', 1_002));

    const rows = await listRecentAssistantMessages(50);
    expect(rows.map((r) => r.content)).toEqual(['今天吃什么药', '', '库存还有多少']);
    expect((rows[1]!.blocks as Array<{ type: string }>)?.[0]).toMatchObject({ type: 'card' });
  });

  it('limits the returned window to the most recent entries', async () => {
    for (let i = 0; i < 8; i += 1) {
      await appendAssistantMessage(makeRecord('user', `msg-${i}`, 2_000 + i));
    }
    const rows = await listRecentAssistantMessages(3);
    expect(rows.map((r) => r.content)).toEqual(['msg-5', 'msg-6', 'msg-7']);
  });

  it('prunes to the retention cap as new messages arrive', async () => {
    for (let i = 0; i < 205; i += 1) {
      await appendAssistantMessage(makeRecord('user', `m-${i}`, 3_000 + i));
    }
    const rows = await listRecentAssistantMessages(1_000);
    expect(rows).toHaveLength(200);
    expect(rows[0]!.content).toBe('m-5');
    expect(rows[rows.length - 1]!.content).toBe('m-204');
  });

  it('clears everything', async () => {
    await appendAssistantMessage(makeRecord('user', 'hello', 4_000));
    await clearAssistantMessages();
    expect(await listRecentAssistantMessages(10)).toEqual([]);
  });
});
