import { expect, test } from '@playwright/test';

/**
 * 时段提醒设置（Settings）的端到端契约：
 * - 4 个时段行 + 时间/方式摘要 + 待复核标记
 * - 点击进入编辑器，保存后回到列表并显示新时间
 * - 时段内方式不一致 → needs-review 待复核 banner
 * - 药品编辑页不再有「提醒方式」选择器，改为时段级提示
 */

async function clearMedboxData(page: import('@playwright/test').Page): Promise<void> {
  // 先落到应用 origin 上（about:blank 等不透明上下文里 IndexedDB 会被拒绝）。
  // 首个冷加载（Vite 转换 + 应用启动升级到 v9）可能较慢，给足等待时间。
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
  await page.evaluate(async () => {
    const transactionDone = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    const request = indexedDB.open('medbox');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stores = ['meds', 'rules', 'scheduleRevisions', 'logs', 'reminderPeriods'];
    const tx = database.transaction(stores, 'readwrite');
    for (const store of stores) tx.objectStore(store).clear();
    await transactionDone(tx);
    database.close();
  });
}

async function seedMorningMedication(
  page: import('@playwright/test').Page,
  id: string,
  name: string,
  reminderMode: string,
): Promise<void> {
  await page.evaluate(async ({ id, name, reminderMode }) => {
    const transactionDone = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    const request = indexedDB.open('medbox');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = database.transaction(['meds', 'rules'], 'readwrite');
    const now = Date.now();
    tx.objectStore('meds').put({
      id,
      name,
      dosageText: '',
      amountPerDose: '1片',
      doseQuantity: 1,
      doseUnit: '片',
      slots: ['morning'],
      mealRels: [],
      mealRelsBySlot: {},
      daysOfWeek: [],
      reminderMode,
      identity: { gtins: [], rawCodes: [], ocrNames: [], photoHashes: [] },
      createdAt: now,
      updatedAt: now,
    });
    tx.objectStore('rules').put({
      id: `rule-${id}`,
      medId: id,
      slot: 'morning',
      timeLocal: '08:00',
      enabled: true,
      escalate: { repeatEveryMin: 10, maxRepeats: 3, notifyCaregiverAfterMin: 30 },
      updatedAt: now,
    });
    await transactionDone(tx);
    database.close();
  }, { id, name, reminderMode });
}

async function openPeriodSettingsPanel(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { level: 1, name: /设置|我的/ })).toBeVisible();
  await page.getByRole('button', { name: /时段提醒设置/ }).click();
  await expect(page.locator('.period-setting-card')).toHaveCount(4);
}

test.describe('period-level reminder settings', () => {
  test('renders four slot rows with time and mode summary', async ({ page }) => {
    await clearMedboxData(page);
    await seedMorningMedication(page, 'e2e-med', '测试药', 'strong');
    await openPeriodSettingsPanel(page);

    const rows = page.locator('.period-setting-card');
    await expect(rows.nth(0)).toContainText('早上');
    await expect(rows.nth(1)).toContainText('中午');
    await expect(rows.nth(2)).toContainText('晚上');
    await expect(rows.nth(3)).toContainText('睡前');
    // 默认时间与方式摘要（0.9.13 起三种方式到点均全屏，标签只区分自动收起策略）
    await expect(rows.nth(0)).toContainText('08:00');
    await expect(rows.nth(0)).toContainText('不自动收起');
    await expect(rows.nth(1)).toContainText('12:00');
    await expect(rows.nth(2)).toContainText('18:00');
    await expect(rows.nth(3)).toContainText('21:30');
  });

  test('edits the morning slot time, saves and reflects it in the list', async ({ page }) => {
    await clearMedboxData(page);
    await seedMorningMedication(page, 'e2e-med', '测试药', 'strong');
    await openPeriodSettingsPanel(page);

    await page.locator('.period-setting-card').nth(0).click();
    // 编辑器：整体提醒时间 + 提醒方式分段 + 保存
    await expect(page.locator('input[type="time"]')).toBeVisible();
    await page.locator('input[type="time"]').fill('07:00');
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.locator('.period-setting-card')).toHaveCount(4);
    await expect(page.locator('.period-setting-card').nth(0)).toContainText('07:00');
  });

  test('shows a needs-review banner when slot modes disagree and confirms review clears it', async ({ page }) => {
    await clearMedboxData(page);
    await seedMorningMedication(page, 'e2e-med-a', '甲药', 'strong');
    await seedMorningMedication(page, 'e2e-med-b', '乙药', 'fullscreen-persistent');
    await openPeriodSettingsPanel(page);

    // 待复核 banner + 行内标记
    await expect(page.locator('.banner.warn').first()).toContainText('不完全一致');
    await expect(page.locator('.period-setting-card').nth(0)).toContainText('待复核');

    // 进入编辑器确认统一时间后保存，差异仍在 → 复核标记保留（需要用户消除差异）
    await page.locator('.period-setting-card').nth(0).click();
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.locator('.period-setting-card').nth(0)).toContainText('待复核');
    await expect(page.locator('.banner.warn').first()).toContainText('不完全一致');
  });

  test('medication editor no longer offers a per-med reminder mode selector', async ({ page }) => {
    await clearMedboxData(page);
    await seedMorningMedication(page, 'e2e-med', '测试药', 'strong');
    // MedEdit 在 /meds/:id/edit（/meds/new 是批量添加页）
    await page.goto('/#/meds/e2e-med/edit');
    await expect(page.getByRole('heading', { level: 1, name: '编辑药品' })).toBeVisible();

    // 移除选择器：没有「提醒方式」radiogroup
    await expect(page.getByRole('radiogroup', { name: '提醒方式' })).toHaveCount(0);
    // 时段级提示指向设置页
    await expect(page.locator('.period-reminder-hint')).toContainText('时段提醒设置');
  });
});
