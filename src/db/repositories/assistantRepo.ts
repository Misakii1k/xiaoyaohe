import type { IDBPDatabase } from 'idb';
import { openMedboxDatabase as db, type MedboxDB } from '../connection';
import type { AssistantChatRecord } from '../schema';

/** 本机保留的最近聊天条数；更旧的在写入时顺手裁剪。 */
const ASSISTANT_HISTORY_LIMIT = 200;

export async function appendAssistantMessage(record: AssistantChatRecord): Promise<void> {
  const database = await db();
  await database.put('assistantMessages', record);
  await pruneAssistantMessages(database);
}

async function pruneAssistantMessages(database: IDBPDatabase<MedboxDB>): Promise<void> {
  const count = await database.count('assistantMessages');
  if (count <= ASSISTANT_HISTORY_LIMIT) return;
  let excess = count - ASSISTANT_HISTORY_LIMIT;
  let cursor = await database
    .transaction('assistantMessages', 'readwrite')
    .store.index('byCreatedAt')
    .openCursor();
  while (cursor && excess > 0) {
    await cursor.delete();
    excess -= 1;
    cursor = await cursor.continue();
  }
}

/** 按 createdAt 升序返回最近 limit 条（旧→新），可直接顺序渲染。 */
export async function listRecentAssistantMessages(limit = 50): Promise<AssistantChatRecord[]> {
  const database = await db();
  const all = await database.getAllFromIndex('assistantMessages', 'byCreatedAt');
  return all.slice(-Math.max(0, limit));
}

export async function clearAssistantMessages(): Promise<void> {
  const database = await db();
  await database.clear('assistantMessages');
}
