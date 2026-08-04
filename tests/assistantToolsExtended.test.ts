import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findAssistantTool, assistantTools } from '../src/ai/assistantTools';
import {
  listAdjustableSettings,
  setSetting,
  getSettingDescriptor,
} from '../src/features/appSettings';

// 模拟业务依赖，避免触碰真实 IndexedDB / 网络 / 原生 Plugin
vi.mock('../src/db/local', () => ({
  listMeds: vi.fn(async () => Array.from(savedMeds.values())),
  listRules: vi.fn(async () => []),
  listScheduleRevisions: vi.fn(async () => []),
  listLogsByDay: vi.fn(async () => []),
  listLogsByRange: vi.fn(async () => []),
  putRule: vi.fn(async () => undefined),
  putMed: vi.fn(async (med: { id: string; name: string; reminderMode?: string; inventory?: { remaining: number; unit?: string } }) => {
    savedMeds.set(med.id, med);
  }),
  getMed: vi.fn(async (id: string) => savedMeds.get(id)),
  softDeleteMed: vi.fn(async (id: string) => {
    deletedIds.add(id);
  }),
  createMedicationBatch: vi.fn(async (drafts: ReadonlyArray<{ id: string; medication: { name: string } }>) => {
    for (const draft of drafts) {
      savedMeds.set(draft.id, { id: draft.id, name: draft.medication.name });
    }
    return { medIds: drafts.map((d) => d.id), reminderRescheduleRequired: false };
  }),
  setOccurrenceAction: vi.fn(async () => ({
    med: { id: 'm1', name: '阿莫西林' },
    log: undefined,
    inventoryChanged: false,
    lowStock: false,
  })),
  listRecentInventoryOperations: vi.fn(async () => []),
  undoInventoryOperation: vi.fn(async () => ({ ok: false, message: '暂无日志' })),
  batchDeductInventory: vi.fn(async () => ({ ok: true, items: [] })),
  updateMedicationInventory: vi.fn(async (id: string, inventory: { remaining: number; unit: string }) => {
    const med = savedMeds.get(id) ?? { id, name: id };
    const updated = { ...med, inventory };
    savedMeds.set(id, updated);
    return {
      med: updated,
      log: {
        id: `log-${id}`,
        medId: id,
        medName: updated.name,
        action: 'set',
        previousRemaining: 0,
        newRemaining: inventory.remaining,
        delta: inventory.remaining,
        unit: inventory.unit,
        source: 'ai',
        timestamp: 1,
      },
    };
  }),
  listReminderPeriodSettings: vi.fn(async () => Array.from(savedPeriodSettings.values())),
  recomputeReminderPeriodReviewState: vi.fn(async () => undefined),
  updateReminderPeriodSetting: vi.fn(async (slot: string, patch: {
    timeLocal?: string;
    mode?: string;
    escalate?: { repeatEveryMin?: number; maxRepeats?: number; notifyCaregiverAfterMin?: number };
  }) => {
    const base = savedPeriodSettings.get(slot) ?? {
      slot,
      timeLocal: '08:00',
      mode: 'strong',
      escalate: { repeatEveryMin: 10, maxRepeats: 3, notifyCaregiverAfterMin: 30 },
      state: 'active',
      updatedAt: 1,
    };
    const next = {
      ...base,
      timeLocal: patch.timeLocal ?? base.timeLocal,
      mode: patch.mode ?? base.mode,
      escalate: patch.escalate ? { ...base.escalate, ...patch.escalate } : base.escalate,
      updatedAt: Date.now(),
    };
    savedPeriodSettings.set(slot, next);
    return next;
  }),
  MedicationBatchValidationError: class MedicationBatchValidationError extends Error {},
}));

vi.mock('../src/features/reminderScheduler', () => ({
  rescheduleMedicationReminders: vi.fn(async () => undefined),
}));

vi.mock('../src/features/nativeMedicationAlarm', () => ({
  checkFullScreenAlarmCapability: vi.fn(async () => 'granted'),
}));

vi.mock('../src/sync/lan/autoSync', () => ({
  triggerManualJoinAll: vi.fn(async () => ({ joined: 1, failed: 0, skipped: 0 })),
}));

vi.mock('../src/sync/lan/apkTransport', () => ({
  downloadUpdate: vi.fn(async (update: { version: string }) => `/cache/medbox-update-${update.version}.apk`),
  getAvailableUpdate: vi.fn(() => null),
  installApk: vi.fn(async () => undefined),
  isApkDistributionAvailable: vi.fn(() => true),
  clearAvailableUpdate: vi.fn(),
  LOCAL_APP_VERSION: '0.9.1',
  LOCAL_APP_VERSION_CODE: 20,
}));

// 设置 / 通知相关：用真实 appSettings 模块（无 IO，仅 localStorage + 模块内回调）
// 但需要把 notificationPreference / policy / autoSync 这些被 appSettings 调用的模块也 stub 掉
vi.mock('../src/features/notificationPreference', () => ({
  isAppNotificationsEnabled: vi.fn(() => currentNotificationFlag),
  setAppNotificationsEnabled: vi.fn((value: boolean) => { currentNotificationFlag = value; }),
  NOTIFICATION_PREF_CHANGE_EVENT: 'medbox:notification-pref-change',
}));
vi.mock('../src/sync/lan/policy', () => ({
  isLanAllowRemoteOverwrite: vi.fn(() => currentAllowOverwrite),
  setLanAllowRemoteOverwrite: vi.fn((value: boolean) => { currentAllowOverwrite = value; }),
}));
vi.mock('../src/sync/lan/autoSync', () => ({
  // re-declare because vi.mock hoists; triggerManualJoinAll needs to be here too
  triggerManualJoinAll: vi.fn(async () => ({ joined: 1, failed: 0, skipped: 0 })),
  isAutoSyncEnabled: vi.fn(() => currentAutoSyncFlag),
  setAutoSyncEnabled: vi.fn((value: boolean) => { currentAutoSyncFlag = value; }),
  isLanAutoSyncSilent: vi.fn(() => currentSilentFlag),
  setLanAutoSyncSilent: vi.fn((value: boolean) => { currentSilentFlag = value; }),
}));

vi.mock('../src/ai/exaMcp', () => ({
  searchExaWeb: vi.fn(async () => ({ content: '', sources: [], truncated: false })),
}));

// 由于 vi.mock 在 vitest 中被 hoist，状态变量需要在工厂函数内部初始化
// 用 hoisted 共享状态
const state = vi.hoisted(() => ({
  savedMeds: new Map<string, {
    id: string;
    name: string;
    reminderMode?: string;
    inventory?: { remaining: number; unit?: string };
  }>(),
  savedPeriodSettings: new Map<string, {
    slot: string;
    timeLocal: string;
    mode: string;
    escalate: { repeatEveryMin: number; maxRepeats: number; notifyCaregiverAfterMin: number };
    state: 'active' | 'needs-review';
    updatedAt: number;
  }>(),
  deletedIds: new Set<string>(),
  notificationFlag: true,
  autoSyncFlag: false,
  silentFlag: true,
  allowOverwrite: false,
}));

const savedMeds = state.savedMeds;
const savedPeriodSettings = state.savedPeriodSettings;
const deletedIds = state.deletedIds;
let currentNotificationFlag = state.notificationFlag;
let currentAutoSyncFlag = state.autoSyncFlag;
let currentSilentFlag = state.silentFlag;
let currentAllowOverwrite = state.allowOverwrite;

describe('Phase F assistant tools registration', () => {
  const NEW_TOOL_NAMES = [
    'edit_inventory',
    'add_medication',
    'update_medication',
    'delete_medication',
    'trigger_lan_sync',
    'check_app_update',
    'download_and_install_update',
    'update_app_settings',
  ] as const;

  it('registers period-reminder management alongside existing assistant tools', () => {
    expect(assistantTools).toHaveLength(20);
    expect(findAssistantTool('set_reminder_period_settings')).toBeDefined();
    for (const name of NEW_TOOL_NAMES) {
      const tool = findAssistantTool(name);
      expect(tool, `expected ${name} to be registered`).toBeDefined();
      expect(typeof tool?.run).toBe('function');
      expect(typeof tool?.label).toBe('string');
      expect(typeof tool?.description).toBe('string');
    }
  });

  it('marks data-mutating tools with confirm hooks', () => {
    // 这 7 个工具都会改数据/状态，必须有 confirm
    const mutatingTools = [
      'edit_inventory',
      'add_medication',
      'update_medication',
      'delete_medication',
      'download_and_install_update',
      'update_app_settings',
      'set_reminder_period_settings',
    ];
    for (const name of mutatingTools) {
      const tool = findAssistantTool(name);
      expect(typeof tool?.confirm, `${name} 应当有 confirm`).toBe('function');
    }
  });

  it('leaves read-only tools without confirm', () => {
    const readTools = ['trigger_lan_sync', 'check_app_update'];
    for (const name of readTools) {
      const tool = findAssistantTool(name);
      expect(tool?.confirm, `${name} 不应有 confirm`).toBeUndefined();
    }
  });
});

describe('check_app_update', () => {
  it('reports current version and absence of updates', async () => {
    const tool = findAssistantTool('check_app_update')!;
    const result = (await tool.run({})) as { ok: boolean; 当前版本: string; versionCode: number; 可用更新: unknown; 可自动更新: boolean; ui: { title: string } };
    expect(result.ok).toBe(true);
    expect(result.当前版本).toBe('0.9.1');
    expect(result.versionCode).toBe(20);
    expect(result.可用更新).toBeNull();
    expect(result.可自动更新).toBe(true);
    expect(result.ui.title).toBe('已是最新版本');
  });
});

describe('trigger_lan_sync', () => {
  it('returns the manual join summary and a card', async () => {
    const tool = findAssistantTool('trigger_lan_sync')!;
    const result = (await tool.run({})) as {
      ok: boolean;
      摘要: { joined: number; failed: number; skipped: number };
      ui: { tone: string; title: string };
    };
    expect(result.ok).toBe(true);
    expect(result.摘要).toEqual({ joined: 1, failed: 0, skipped: 0 });
    expect(result.ui.tone).toBe('success');
    expect(result.ui.title).toBe('同步完成');
  });
});

describe('update_app_settings', () => {
  beforeEach(() => {
    savedMeds.clear();
    deletedIds.clear();
    currentNotificationFlag = true;
    currentAutoSyncFlag = false;
    currentSilentFlag = true;
    currentAllowOverwrite = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('confirm message lists every requested change', () => {
    const tool = findAssistantTool('update_app_settings')!;
    const message = tool.confirm!({
      settings: [
        { key: 'appNotificationsEnabled', value: false },
        { key: 'lanAutoSyncEnabled', value: true },
      ],
    });
    expect(message).toContain('应用内用药提醒');
    expect(message).toContain('局域网自动同步');
    expect(message).toContain('false');
    expect(message).toContain('true');
  });

  it('rejects settings outside the whitelist', async () => {
    const tool = findAssistantTool('update_app_settings')!;
    const result = (await tool.run({
      settings: [{ key: 'apiKey', value: 'sk-leaked' }],
    })) as { ok: boolean; 跳过: string[]; 已应用: string[] };
    expect(result.ok).toBe(false);
    expect(result.已应用).toEqual([]);
    expect(result.跳过.length).toBe(1);
    expect(result.跳过[0]).toContain('不在白名单');
  });

  it('rejects values that fail coercion', async () => {
    const tool = findAssistantTool('update_app_settings')!;
    const result = (await tool.run({
      settings: [{ key: 'appNotificationsEnabled', value: 'maybe' }],
    })) as { ok: boolean; 跳过: string[] };
    expect(result.ok).toBe(false);
    expect(result.跳过[0]).toContain('值无效');
  });

  it('applies a valid boolean change end-to-end', async () => {
    const tool = findAssistantTool('update_app_settings')!;
    const result = (await tool.run({
      settings: [{ key: 'lanAutoSyncEnabled', value: true }],
    })) as { ok: boolean; 已应用: string[]; 跳过: string[]; ui: { title: string } };
    expect(result.ok).toBe(true);
    expect(result.已应用[0]).toContain('局域网自动同步');
    expect(result.跳过).toEqual([]);
    expect(result.ui.title).toBe('设置已更新');
    // 状态确实被改了
    expect(currentAutoSyncFlag).toBe(true);
  });

  it('lists available settings to caller for discoverability', async () => {
    const all = listAdjustableSettings();
    const keys = all.map((s) => s.key);
    expect(keys).toContain('appNotificationsEnabled');
    expect(keys).toContain('lanAutoSyncEnabled');
    expect(keys).toContain('lanAutoSyncSilent');
    expect(keys).toContain('lanAllowRemoteOverwrite');
    // 敏感项不在白名单
    expect(keys).not.toContain('apiKey');
    expect(keys).not.toContain('aiConsent');
  });

  it('coerces string "true"/"false" to boolean', async () => {
    const tool = findAssistantTool('update_app_settings')!;
    const result = (await tool.run({
      settings: [{ key: 'lanAutoSyncSilent', value: 'false' }],
    })) as { ok: boolean; 已应用: string[] };
    expect(result.ok).toBe(true);
    expect(currentSilentFlag).toBe(false);
  });

  it('setSetting throws on unknown keys', async () => {
    await expect(setSetting('somethingSecret', true)).rejects.toThrow(/不支持的设置项/);
  });

  it('getSettingDescriptor returns undefined for unknown keys', () => {
    expect(getSettingDescriptor('doesNotExist')).toBeUndefined();
  });
});

describe('edit_inventory', () => {
  beforeEach(() => {
    savedMeds.clear();
    deletedIds.clear();
  });

  it('confirm message for mark_empty mentions 0', () => {
    const tool = findAssistantTool('edit_inventory')!;
    const msg = tool.confirm!({ medName: '阿莫西林', action: 'mark_empty' });
    expect(msg).toContain('阿莫西林');
    expect(msg).toContain('0');
  });

  it('confirm message for set shows the target quantity', () => {
    const tool = findAssistantTool('edit_inventory')!;
    const msg = tool.confirm!({ medName: '维生素C', action: 'set', quantity: 21, unit: '片' });
    expect(msg).toContain('21');
    expect(msg).toContain('片');
  });

  it('returns error when medication not found', async () => {
    const tool = findAssistantTool('edit_inventory')!;
    const result = (await tool.run({ medName: '不存在的药', action: 'mark_empty' })) as { ok: boolean; 提示: string };
    expect(result.ok).toBe(false);
    expect(result.提示).toContain('没找到');
  });

  it('returns error for invalid action', async () => {
    const tool = findAssistantTool('edit_inventory')!;
    const result = (await tool.run({ medName: '阿莫西林', action: 'reset' as unknown as string })) as { ok: boolean; 提示: string };
    expect(result.ok).toBe(false);
    expect(result.提示).toContain('set / add / mark_empty');
  });

  it('returns error when set has no quantity', async () => {
    const tool = findAssistantTool('edit_inventory')!;
    const result = (await tool.run({ medName: '阿莫西林', action: 'set' })) as { ok: boolean; 提示: string };
    expect(result.ok).toBe(false);
    expect(result.提示).toContain('数量');
  });
});

describe('set_reminder_period_settings', () => {
  beforeEach(() => {
    savedMeds.clear();
    savedPeriodSettings.clear();
    vi.clearAllMocks();
  });

  it('updates a single slot time and mode in one tool call', async () => {
    savedPeriodSettings.set('morning', {
      slot: 'morning',
      timeLocal: '08:00',
      mode: 'strong',
      escalate: { repeatEveryMin: 10, maxRepeats: 3, notifyCaregiverAfterMin: 30 },
      state: 'active',
      updatedAt: 1,
    });
    const db = await import('../src/db/local');
    const scheduler = await import('../src/features/reminderScheduler');
    const tool = findAssistantTool('set_reminder_period_settings')!;

    const result = (await tool.run({
      slot: 'morning',
      time: '07:30',
      mode: 'fullscreen-short',
    })) as { ok: boolean; 已更新时段: string[] };

    expect(result.ok).toBe(true);
    expect(result.已更新时段).toEqual(['早上']);
    expect(db.updateReminderPeriodSetting).toHaveBeenCalledTimes(1);
    expect(db.updateReminderPeriodSetting).toHaveBeenCalledWith('morning', {
      timeLocal: '07:30',
      mode: 'fullscreen-short',
    });
    expect(scheduler.rescheduleMedicationReminders).toHaveBeenCalledTimes(1);
  });

  it('updates all slots uniformly and applies the escalate policy', async () => {
    const tool = findAssistantTool('set_reminder_period_settings')!;

    const result = (await tool.run({
      slot: 'all',
      mode: 'strong',
      escalate: { repeatEveryMin: 5, maxRepeats: 6, notifyCaregiverAfterMin: 20 },
    })) as { ok: boolean; 已更新时段: string[] };

    expect(result.ok).toBe(true);
    expect(result.已更新时段).toEqual(['早上', '中午', '晚上', '睡前']);
  });

  it('rejects invalid slot, invalid time and empty patches without writing anything', async () => {
    const db = await import('../src/db/local');
    const tool = findAssistantTool('set_reminder_period_settings')!;

    await expect(tool.run({ slot: 'afternoon', mode: 'strong' })).resolves.toMatchObject({ ok: false });
    await expect(tool.run({ slot: 'morning', time: '25:99' })).resolves.toMatchObject({ ok: false });
    await expect(tool.run({ slot: 'morning' })).resolves.toMatchObject({ ok: false });
    expect(db.updateReminderPeriodSetting).not.toHaveBeenCalled();
  });

  it('confirm mentions the slot label and the requested change', () => {
    const tool = findAssistantTool('set_reminder_period_settings')!;
    const msg = tool.confirm!({ slot: 'bedtime', time: '22:00', mode: 'fullscreen-persistent' });
    expect(msg).toContain('睡前');
    expect(msg).toContain('22:00');
    expect(msg).toContain('持续全屏');
  });
});

describe('download_and_install_update', () => {
  it('refuses when APK distribution is unavailable', async () => {
    // isApkDistributionAvailable 已 mock 返回 true；这里覆盖一次为 false 的场景
    const apkModule = await import('../src/sync/lan/apkTransport');
    const original = apkModule.isApkDistributionAvailable as unknown as ReturnType<typeof vi.fn>;
    original.mockReturnValueOnce(false);

    const tool = findAssistantTool('download_and_install_update')!;
    const result = (await tool.run({})) as { ok: boolean; 提示: string };
    expect(result.ok).toBe(false);
    expect(result.提示).toContain('不支持 APK 自动更新');
  });

  it('refuses when no available update is recorded', async () => {
    const tool = findAssistantTool('download_and_install_update')!;
    // getAvailableUpdate mock 默认返回 null
    const result = (await tool.run({})) as { ok: boolean; 提示: string };
    expect(result.ok).toBe(false);
    expect(result.提示).toContain('暂无可用更新');
  });

  it('confirm mentions the peer host when an update exists', async () => {
    const apkModule = await import('../src/sync/lan/apkTransport');
    const getUpdate = apkModule.getAvailableUpdate as unknown as ReturnType<typeof vi.fn>;
    getUpdate.mockReturnValueOnce({
      version: '0.9.2',
      versionCode: 21,
      peerHost: '192.168.1.10',
      peerPort: 38473,
      discoveredAt: Date.now(),
    });
    const tool = findAssistantTool('download_and_install_update')!;
    const msg = tool.confirm!({});
    expect(msg).toContain('192.168.1.10');
    expect(msg).toContain('0.9.2');
  });
});

describe('add_medication', () => {
  beforeEach(() => {
    savedMeds.clear();
  });

  it('rejects empty name', async () => {
    const tool = findAssistantTool('add_medication')!;
    const result = (await tool.run({ name: '   ' })) as { ok: boolean; 提示: string };
    expect(result.ok).toBe(false);
    expect(result.提示).toContain('药品名称');
  });

  it('blocks when a same-named medication already exists', async () => {
    savedMeds.set('m1', { id: 'm1', name: '阿莫西林' });
    const tool = findAssistantTool('add_medication')!;
    const result = (await tool.run({ name: '阿莫西林' })) as { ok: boolean; 提示: string };
    expect(result.ok).toBe(false);
    expect(result.提示).toContain('已经有');
  });

  it('confirm message lists selected slots and inventory', () => {
    const tool = findAssistantTool('add_medication')!;
    const msg = tool.confirm!({
      name: '布洛芬',
      slots: ['morning', 'evening'],
      inventoryRemaining: 20,
      inventoryUnit: '片',
    });
    expect(msg).toContain('布洛芬');
    expect(msg).toContain('早上');
    expect(msg).toContain('晚上');
    expect(msg).toContain('20');
  });
});

describe('delete_medication', () => {
  beforeEach(() => {
    savedMeds.clear();
    deletedIds.clear();
  });

  it('confirm message warns about soft delete', () => {
    const tool = findAssistantTool('delete_medication')!;
    const msg = tool.confirm!({ medName: '阿莫西林' });
    expect(msg).toContain('删除');
    expect(msg).toContain('历史服药记录保留');
  });

  it('returns error when med not found', async () => {
    const tool = findAssistantTool('delete_medication')!;
    const result = (await tool.run({ medName: '不存在' })) as { ok: boolean; 提示: string };
    expect(result.ok).toBe(false);
    expect(result.提示).toContain('没找到');
  });
});

describe('update_medication', () => {
  beforeEach(() => {
    savedMeds.clear();
  });

  it('confirm message lists every changed field', () => {
    const tool = findAssistantTool('update_medication')!;
    const msg = tool.confirm!({
      medName: '阿莫西林',
      name: '阿莫西林胶囊',
      dosageText: '250mg/粒',
      notes: '随餐服',
    });
    expect(msg).toContain('阿莫西林胶囊');
    expect(msg).toContain('250mg/粒');
    expect(msg).toContain('随餐服');
  });

  it('returns error when no fields are being updated', async () => {
    const tool = findAssistantTool('update_medication')!;
    const result = (await tool.run({ medName: '阿莫西林' })) as { ok: boolean; 提示: string };
    expect(result.ok).toBe(false);
    expect(result.提示).toContain('没有要更新的字段');
  });
});
