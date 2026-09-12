import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  Medication,
  ReminderRule,
  MedicationScheduleRevision,
  IntakeLog,
  PhotoBlob,
  PushState,
  InventoryOperationLog,
  ReminderPeriodSetting,
  AssistantChatRecord,
} from './schema';

export interface ImportBucketResult {
  added: number;
  updated: number;
  skipped: number;
}

export interface MedImportResult {
  meds: ImportBucketResult;
  rules: ImportBucketResult;
  logs: ImportBucketResult;
  scheduleRevisions: ImportBucketResult;
}

export type SyncLanEntityType = 'medication' | 'reminderRule' | 'schedule' | 'intake';

export interface SyncLanEntityMetadata {
  key: string;
  kind: 'entity';
  entityType: SyncLanEntityType;
  entityId: string;
  operation: 'upsert' | 'delete';
  clock: number;
  deviceId: string;
  payloadHash: string;
  tombstone: boolean;
}

export interface SyncLanCounterMetadata {
  key: 'counter';
  kind: 'counter';
  deviceId: string;
  clock: number;
}

export type SyncLanMetadata = SyncLanEntityMetadata | SyncLanCounterMetadata;

export interface MedboxDB extends DBSchema {
  meds: { key: string; value: Medication };
  rules: { key: string; value: ReminderRule; indexes: { byMed: string } };
  scheduleRevisions: {
    key: string;
    value: MedicationScheduleRevision;
    indexes: { byMed: string; bySourceRule: string };
  };
  logs: { key: string; value: IntakeLog; indexes: { byDue: number } };
  photos: { key: string; value: PhotoBlob; indexes: { byMed: string } };
  pushStates: { key: string; value: PushState };
  syncLanMetadata: { key: string; value: SyncLanMetadata };
  inventoryLogs: { key: string; value: InventoryOperationLog; indexes: { byMed: string; byTimestamp: number } };
  reminderPeriods: { key: string; value: ReminderPeriodSetting };
  assistantMessages: { key: string; value: AssistantChatRecord; indexes: { byCreatedAt: number } };
}

let dbp: Promise<IDBPDatabase<MedboxDB>> | null = null;
let reminderPeriodSeeder: ((d: IDBPDatabase<MedboxDB>) => Promise<void>) | null = null;

export function registerReminderPeriodSeeder(seeder: (d: IDBPDatabase<MedboxDB>) => Promise<void>): void {
  reminderPeriodSeeder = seeder;
}

export function upgradeMedboxDatabase(d: IDBPDatabase<MedboxDB>, oldVersion: number): void {
  if (oldVersion < 1) {
    d.createObjectStore('meds', { keyPath: 'id' });
    const rules = d.createObjectStore('rules', { keyPath: 'id' });
    rules.createIndex('byMed', 'medId');
    const logs = d.createObjectStore('logs', { keyPath: 'id' });
    logs.createIndex('byDue', 'dueAt');
    const photos = d.createObjectStore('photos', { keyPath: 'id' });
    photos.createIndex('byMed', 'medId');
  }
  if (oldVersion < 2) {
    d.createObjectStore('pushStates', { keyPath: 'id' });
  }
  if (oldVersion < 4) {
    const revisions = d.createObjectStore('scheduleRevisions', { keyPath: 'id' });
    revisions.createIndex('byMed', 'medId');
    revisions.createIndex('bySourceRule', 'sourceRuleId');
  }
  if (oldVersion < 6) {
    const migrationDatabase = d as unknown as IDBDatabase;
    if (migrationDatabase.objectStoreNames.contains('outbox')) {
      migrationDatabase.deleteObjectStore('outbox');
    }
    if (migrationDatabase.objectStoreNames.contains('syncV2Metadata')) {
      migrationDatabase.deleteObjectStore('syncV2Metadata');
    }
    if (!d.objectStoreNames.contains('syncLanMetadata')) {
      d.createObjectStore('syncLanMetadata', { keyPath: 'key' });
    }
  }
  if (oldVersion < 7) {
    // no-op; 字段为可选，旧记录读取时为 undefined
  }
  if (oldVersion < 8) {
    if (!d.objectStoreNames.contains('inventoryLogs')) {
      const invLogs = d.createObjectStore('inventoryLogs', { keyPath: 'id' });
      invLogs.createIndex('byMed', 'medId');
      invLogs.createIndex('byTimestamp', 'timestamp');
    }
  }
  if (oldVersion < 9) {
    // 只同步建 store；初始设置由 rules/meds 派生，延后到打开完成后幂等补齐
    // （idb 的 upgrade 回调是同步调用，返回值不会被 await，无法在其中异步派生）。
    if (!d.objectStoreNames.contains('reminderPeriods')) {
      d.createObjectStore('reminderPeriods', { keyPath: 'slot' });
    }
  }
  if (oldVersion < 10) {
    // 小助手聊天记录；仅新增 store，不影响既有数据。
    if (!d.objectStoreNames.contains('assistantMessages')) {
      const assistantMsgs = d.createObjectStore('assistantMessages', { keyPath: 'id' });
      assistantMsgs.createIndex('byCreatedAt', 'createdAt');
    }
  }
}

export function openMedboxDatabase(): Promise<IDBPDatabase<MedboxDB>> {
  if (!dbp) {
    dbp = openDB<MedboxDB>('medbox', 10, {
      upgrade: upgradeMedboxDatabase,
      blocked() {
        console.warn('IndexedDB 升级被旧页面阻塞，请关闭其他已打开的 medbox 页面后刷新。');
      },
      blocking() {
        console.warn('检测到新版数据库升级请求，当前页面将关闭旧连接。');
      },
    }).then(async (database) => {
      // idb 的 upgrade 回调不会 await 异步返回值，v9 的初始派生只能在打开后补齐；
      // seed 幂等：仅当 store 为空且有贡献规则时按派生值建行。
      try {
        if (reminderPeriodSeeder) {
          await reminderPeriodSeeder(database);
        } else {
          const { seedReminderPeriodSettings } = await import('./repositories/reminderPeriodsRepo');
          await seedReminderPeriodSettings(database);
        }
      } catch (error) {
        console.warn('时段提醒设置初始化失败，界面将按派生值合成展示。', error);
      }
      return database;
    });
  }
  return dbp;
}

export const db = openMedboxDatabase;

export function uid(): string {
  return crypto.randomUUID();
}
