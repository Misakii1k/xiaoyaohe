import type { Page } from '@playwright/test';

/**
 * Seeds only the isolated Playwright browser context. Production code keeps
 * owning the schema; this fixture merely writes representative long-text data.
 */
export async function seedVisualFixtures(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('heading', { level: 1 }).waitFor();

  await page.evaluate(async () => {
    const transactionDone = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    const open = (name: string, version: number, upgrade: (database: IDBDatabase) => void) =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onupgradeneeded = () => upgrade(request.result);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const createIndex = (store: IDBObjectStore, name: string, keyPath: string) => {
      if (!store.indexNames.contains(name)) store.createIndex(name, keyPath);
    };

    localStorage.removeItem('medbox.llmConfig.v1');
    localStorage.removeItem('medbox.llmHealth.v1');
    sessionStorage.clear();

    const medsDb = await open('medbox', 6, (database) => {
      if (!database.objectStoreNames.contains('meds')) database.createObjectStore('meds', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('rules')) {
        const rules = database.createObjectStore('rules', { keyPath: 'id' });
        rules.createIndex('byMed', 'medId');
      }
      if (!database.objectStoreNames.contains('scheduleRevisions')) {
        const revisions = database.createObjectStore('scheduleRevisions', { keyPath: 'id' });
        revisions.createIndex('byMed', 'medId');
        revisions.createIndex('bySourceRule', 'sourceRuleId');
      }
      if (!database.objectStoreNames.contains('logs')) {
        const logs = database.createObjectStore('logs', { keyPath: 'id' });
        logs.createIndex('byDue', 'dueAt');
      }
      if (!database.objectStoreNames.contains('photos')) {
        const photos = database.createObjectStore('photos', { keyPath: 'id' });
        photos.createIndex('byMed', 'medId');
      }
      if (!database.objectStoreNames.contains('pushStates')) database.createObjectStore('pushStates', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('syncLanMetadata')) {
        database.createObjectStore('syncLanMetadata', { keyPath: 'key' });
      }
    });
    const medStores = ['meds', 'rules', 'scheduleRevisions', 'logs', 'photos', 'pushStates', 'syncLanMetadata'];
    const medTransaction = medsDb.transaction(medStores, 'readwrite');
    for (const store of medStores) medTransaction.objectStore(store).clear();

    const now = Date.now();
    const today = new Date(now);
    const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const medication = {
      id: 'visual-med-1',
      name: '视觉验收用的长药品名称，用于验证全面屏窄宽度下自然换行、按钮对齐和安全区布局',
      dosageText: '500mg/片',
      amountPerDose: '0.25片',
      doseQuantity: 0.25,
      doseUnit: '片',
      doseSourceText: '0.25片',
      slots: ['morning'],
      mealRels: ['after'],
      mealRelsBySlot: { morning: ['after'] },
      daysOfWeek: [],
      inventory: { remaining: 12.5, unit: '片', lowThreshold: 5 },
      identity: { gtins: [], rawCodes: [], ocrNames: [], photoHashes: [] },
      createdAt: now - 86_400_000,
      updatedAt: now,
    };
    const rule = {
      id: 'visual-rule-1',
      medId: medication.id,
      slot: 'morning',
      timeLocal: '08:00',
      enabled: true,
      escalate: { repeatEveryMin: 10, maxRepeats: 3, notifyCaregiverAfterMin: 30 },
      updatedAt: now,
    };
    const revision = {
      id: 'visual-revision-1',
      medId: medication.id,
      sourceRuleId: rule.id,
      effectiveDate: localDate,
      createdAt: now,
      enabled: true,
      slot: 'morning',
      timeLocal: '08:00',
      daysOfWeek: [],
      mealRels: ['after'],
      doseQuantity: 0.25,
      doseUnit: '片',
      reviewFlags: [],
    };
    medTransaction.objectStore('meds').put(medication);
    medTransaction.objectStore('rules').put(rule);
    medTransaction.objectStore('scheduleRevisions').put(revision);
    await transactionDone(medTransaction);
    medsDb.close();

  });
}
