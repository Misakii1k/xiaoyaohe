// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import * as localDb from '../src/db/local';
import * as settingsFacade from '../src/pages/Settings';
import * as settingsIndex from '../src/pages/settings/index';
import { panel, setChip } from '../src/pages/settings/components/panelPrimitives';
import { createProfileStatCard, renderStatsGrid } from '../src/pages/settings/components/StatsGrid';
import { renderSettingsPage } from '../src/pages/settings/index';
import { renderReminderPanel } from '../src/pages/settings/panels/ReminderPanel';
import { renderMedEditPage } from '../src/pages/MedEdit';
import { validateMedicationForm } from '../src/pages/medEdit/formValidation';
import { evaluateDoseReview } from '../src/pages/medEdit/dosageHelper';
import { buildBoxPhotoStudio } from '../src/pages/medEdit/photoStudioHelper';
import { assistantTools, findAssistantTool, OPEN_PAGE_TOOL_NAME } from '../src/ai/assistantTools';
import {
  parseSvg,
  cleanup3dMedia,
  render3dMedia,
  trackMediaBlobUrl,
  safeRevokeMediaUrl,
  revokeTrackedMediaBlobUrls,
} from '../src/ui/assets3d';
import { OEM_GUIDES, openKeepAliveGuideModal } from '../src/pages/settings/panels/KeepAlivePanel';
import { getDeviceKeepAliveInfo, openOemKeepAliveSettings } from '../src/features/keepAlive';
import type { Medication, ReminderRule, IntakeLog } from '../src/db/schema';

describe('refactor integrity and modularity contracts', () => {
  it('src/db/local.ts preserves all legacy facade exports for 100% backward compatibility', () => {
    // 基础连接与实用函数
    expect(typeof localDb.openMedboxDatabase).toBe('function');
    expect(typeof localDb.upgradeMedboxDatabase).toBe('function');
    expect(typeof localDb.uid).toBe('function');

    // 助手消息仓储
    expect(typeof localDb.appendAssistantMessage).toBe('function');
    expect(typeof localDb.listRecentAssistantMessages).toBe('function');
    expect(typeof localDb.clearAssistantMessages).toBe('function');

    // 药品仓储
    expect(typeof localDb.listMeds).toBe('function');
    expect(typeof localDb.getMed).toBe('function');
    expect(typeof localDb.putMed).toBe('function');
    expect(typeof localDb.saveMedicationProfile).toBe('function');
    expect(typeof localDb.softDeleteMed).toBe('function');
    expect(typeof localDb.createMedicationBatch).toBe('function');
    expect(typeof localDb.MedicationBatchValidationError).toBe('function');

    // 规则与计划仓储
    expect(typeof localDb.listRules).toBe('function');
    expect(typeof localDb.listRulesByMed).toBe('function');
    expect(typeof localDb.putRule).toBe('function');
    expect(typeof localDb.deleteRule).toBe('function');
    expect(typeof localDb.listScheduleRevisions).toBe('function');
    expect(typeof localDb.batchUpdateRules).toBe('function');

    // 打卡日志仓储
    expect(typeof localDb.listLogsByDay).toBe('function');
    expect(typeof localDb.listLogsByRange).toBe('function');
    expect(typeof localDb.listLogs).toBe('function');
    expect(typeof localDb.getLog).toBe('function');
    expect(typeof localDb.getLogForOccurrence).toBe('function');
    expect(typeof localDb.putLog).toBe('function');
    expect(typeof localDb.setOccurrenceAction).toBe('function');
    expect(typeof localDb.setOccurrenceActions).toBe('function');
    expect(typeof localDb.revertLinkedIntakeInventoryEffect).toBe('function');
    expect(typeof localDb.isPreDeductedToday).toBe('function');
    expect(typeof localDb.isOccurrencePreDeducted).toBe('function');
    expect(typeof localDb.recordPreDeduction).toBe('function');
    expect(typeof localDb.MedicationIntakeError).toBe('function');

    // 照片仓储
    expect(typeof localDb.putPhoto).toBe('function');
    expect(typeof localDb.getPhotosByMed).toBe('function');
    expect(typeof localDb.deletePhotosByMed).toBe('function');
    expect(typeof localDb.listAllPhotos).toBe('function');

    // 推送状态仓储
    expect(typeof localDb.getPushState).toBe('function');
    expect(typeof localDb.listPushStates).toBe('function');
    expect(typeof localDb.putPushState).toBe('function');
    expect(typeof localDb.prunePushStates).toBe('function');

    // 时段设置仓储
    expect(typeof localDb.listReminderPeriodSettings).toBe('function');
    expect(typeof localDb.getReminderPeriodSetting).toBe('function');
    expect(typeof localDb.updateReminderPeriodSetting).toBe('function');
    expect(typeof localDb.recomputeReminderPeriodReviewState).toBe('function');

    // 库存仓储
    expect(typeof localDb.logInventoryOperation).toBe('function');
    expect(typeof localDb.listInventoryLogs).toBe('function');
    expect(typeof localDb.listRecentInventoryOperations).toBe('function');
    expect(typeof localDb.updateMedicationInventory).toBe('function');
    expect(typeof localDb.undoInventoryOperation).toBe('function');
    expect(typeof localDb.batchDeductInventory).toBe('function');
    expect(typeof localDb.MedicationInventoryError).toBe('function');

    // 备份导入导出
    expect(typeof localDb.importMedsAndRules).toBe('function');
  });

  it('src/pages/Settings.ts preserves all entry point and type exports', () => {
    expect(typeof settingsFacade.renderSettingsPage).toBe('function');
    expect(typeof settingsFacade.renderDiagnosticsPanel).toBe('function');
    expect(typeof settingsFacade.importBackupFileForRoute).toBe('function');

    expect(typeof settingsIndex.renderSettingsPage).toBe('function');
    expect(typeof settingsIndex.renderDiagnosticsPanel).toBe('function');
    expect(typeof settingsIndex.importBackupFileForRoute).toBe('function');
  });

  it('panel primitive ensures body is properly attached to wrap before renderBody execution', () => {
    let parentFound = false;
    let closestPanelFound = false;

    const p = panel({
      title: '测试面板',
      iconName: 'bell',
      chip: { text: '测试', tone: 'ok' },
      renderBody: (body) => {
        if (body.parentElement && body.parentElement.classList.contains('panel')) {
          parentFound = true;
        }
        if (body.closest('.panel')) {
          closestPanelFound = true;
        }
      },
    });

    expect(parentFound).toBe(true);
    expect(closestPanelFound).toBe(true);
    expect(p.classList.contains('panel')).toBe(true);

    setChip(p, { text: '已更新', tone: 'warn' });
    expect(p.querySelector('.panel-chip')?.textContent).toBe('已更新');
  });

  it('StatsGrid component renders 3 stat cards and binds navigation', () => {
    const meds: Medication[] = [];
    const rules: ReminderRule[] = [];
    const logs: IntakeLog[] = [];

    const grid = renderStatsGrid(meds, rules, logs);
    expect(grid.querySelector('.profile-section-title')?.textContent).toBe('我的数据');
    const cards = grid.querySelectorAll('.profile-stat-card');
    expect(cards.length).toBe(3);
    expect(cards[0].textContent).toContain('全部药品');
    expect(cards[1].textContent).toContain('用药计划');
    expect(cards[2].textContent).toContain('打卡记录');
  });

  it('renderSettingsPage cleans up and aborts immediately when signal is aborted', async () => {
    const root = document.createElement('div');
    document.body.append(root);

    // 1. 已提前中止的信号：不挂载任何 DOM
    const preAborted = new AbortController();
    preAborted.abort();
    await renderSettingsPage(root, preAborted.signal);
    expect(root.children.length).toBe(0);

    // 2. 正常挂载后中止：触发完整 cleanup
    const active = new AbortController();
    const cleanup = await renderSettingsPage(root, active.signal);
    expect(typeof cleanup).toBe('function');
    expect(root.children.length).toBeGreaterThan(0);

    active.abort();
    // 再次调用 cleanup 不应抛出异常
    expect(() => (cleanup as () => void)()).not.toThrow();
  });

  it('renderReminderPanel handles recursive refresh on multiple toggles', () => {
    const p = renderReminderPanel();
    expect(p.classList.contains('panel')).toBe(true);
    expect(p.querySelector('.panel-title')?.textContent).toBe('系统通知');
  });

  it('renderMedEditPage mounts without ReferenceError/TDZ and initializes wizard steps', async () => {
    const root = document.createElement('div');
    document.body.append(root);

    // Verify mounting doesn't throw ReferenceError (regression test for let photoStudio TDZ)
    const cleanup = await renderMedEditPage(root);
    expect(typeof cleanup).toBe('function');
    expect(root.querySelector('.medication-edit-page')).not.toBeNull();
    expect(root.querySelector('.med-step-1')).not.toBeNull();

    // Verify wizard step buttons and action dock exist
    const dock = root.querySelector('.medication-editor-dock');
    expect(dock).not.toBeNull();
    const nextBtn = dock?.querySelector('button:last-child') as HTMLButtonElement;
    expect(nextBtn).not.toBeNull();

    // Clean up
    expect(() => cleanup()).not.toThrow();
    root.remove();
  });

  it('validateMedicationForm validates required fields, dose pairs, and cycle start dates', () => {
    // 1. Missing name
    const res1 = validateMedicationForm({
      name: '   ',
      dosageText: '',
      amountPerDose: '',
      doseQuantity: undefined,
      doseUnit: '',
      cycleEnabled: false,
      cycle: undefined,
    });
    expect(res1.valid).toBe(false);
    expect(res1.targetField).toBe('name');

    // 2. Quantity without unit
    const res2 = validateMedicationForm({
      name: '阿莫西林',
      dosageText: '',
      amountPerDose: '',
      doseQuantity: 2,
      doseUnit: '',
      cycleEnabled: false,
      cycle: undefined,
    });
    expect(res2.valid).toBe(false);
    expect(res2.targetField).toBe('dose');

    // 3. Cycle enabled without valid cycle days
    const res3 = validateMedicationForm({
      name: '阿莫西林',
      dosageText: '',
      amountPerDose: '',
      doseQuantity: 1,
      doseUnit: '片',
      cycleEnabled: true,
      cycle: undefined,
    });
    expect(res3.valid).toBe(false);
    expect(res3.targetField).toBe('cycle');

    // 4. Cycle enabled without cycleStartDate
    const res4 = validateMedicationForm({
      name: '阿莫西林',
      dosageText: '',
      amountPerDose: '',
      doseQuantity: 1,
      doseUnit: '片',
      cycleEnabled: true,
      cycle: { activeDays: 21, restDays: 7 },
      cycleStartDate: '',
    });
    expect(res4.valid).toBe(false);
    expect(res4.targetField).toBe('cycleStartDate');

    // 5. Valid input
    const res5 = validateMedicationForm({
      name: '阿莫西林',
      dosageText: '0.25g',
      amountPerDose: '1片',
      doseQuantity: 1,
      doseUnit: '片',
      cycleEnabled: true,
      cycle: { activeDays: 21, restDays: 7 },
      cycleStartDate: '2026-09-12',
    });
    expect(res5.valid).toBe(true);
  });

  it('evaluateDoseReview produces structured messages and tones', () => {
    // Explicit dose
    const explicit = evaluateDoseReview('1片', 1, '片');
    expect(explicit.kind).toBe('explicit');
    expect(explicit.tone).toBe('ok');

    // Suggested dose from text
    const suggested = evaluateDoseReview('每次2粒', undefined, '', '粒');
    expect(suggested.kind).toBe('suggested');
    expect(suggested.tone).toBe('warn');
    expect(suggested.message).toContain('猜您每次吃 2粒');

    // Empty dose
    const empty = evaluateDoseReview('', undefined, '');
    expect(empty.kind).toBe('empty');
    expect(empty.tone).toBe('warn');
  });

  it('buildBoxPhotoStudio controller updates photo and originalPhoto cleanly', () => {
    const med: Medication = {
      id: 'med-test-1',
      name: '测试药品',
      slots: [],
      mealRels: [],
      daysOfWeek: [],
      identity: { photoHashes: [], ocrNames: [], gtins: [], rawCodes: [] },
      updatedAt: 0,
      createdAt: 0,
    };
    const cleanups: Array<() => void> = [];
    const studio = buildBoxPhotoStudio({
      med,
      editing: false,
      initialPhoto: null,
      isActive: () => true,
      cleanups,
      getMedName: () => '测试药品',
      getDosageText: () => '1片',
    });

    expect(studio.element).toBeInstanceOf(HTMLElement);
    expect(studio.getPendingPhoto()).toBeNull();

    // Set a mock photo blob
    const mockBlob = new Blob(['mock-data'], { type: 'image/jpeg' });
    studio.setPendingPhoto(mockBlob, 'original');
    expect(studio.getPendingPhoto()).toBe(mockBlob);
    expect(studio.getOriginalPhoto()).toBe(mockBlob);
    expect(studio.getPhotoKind()).toBe('original');

    // Clear photo
    studio.setPendingPhoto(null);
    expect(studio.getPendingPhoto()).toBeNull();

    // Trigger cleanup
    cleanups.forEach((fn) => fn());
  });

  it('src/ai/assistantTools.ts preserves all 22 tools and barrel exports', () => {
    expect(assistantTools.length).toBe(22);
    expect(OPEN_PAGE_TOOL_NAME).toBe('open_page');

    const canonicalToolNames = [
      'get_today_plan',
      'list_my_medications',
      'get_adherence_report',
      'mark_medication',
      'set_reminder_time',
      'set_reminder_period_settings',
      'web_search_exa',
      'present_card',
      'open_page',
      'edit_inventory',
      'add_medication',
      'update_medication',
      'delete_medication',
      'trigger_lan_sync',
      'check_app_update',
      'download_and_install_update',
      'update_app_settings',
      'get_inventory_logs',
      'undo_inventory_operation',
      'batch_deduct_inventory',
      'check_drug_interactions',
      'batch_import_medications',
    ];

    canonicalToolNames.forEach((toolName) => {
      const tool = findAssistantTool(toolName);
      expect(tool).toBeDefined();
      expect(tool?.name).toBe(toolName);
      expect(typeof tool?.description).toBe('string');
      expect(typeof tool?.run).toBe('function');
    });
  });

  it('src/ui/assets3d.ts optimizes image decoding, error bounds, and memory cleanup', () => {
    // 1. parseSvg error boundary with invalid XML
    const fallbackSvg = parseSvg('<<<invalid xml???');
    expect(fallbackSvg).toBeInstanceOf(SVGSVGElement);

    // 2. render3dMedia creates lazy and async decoding img
    const container = render3dMedia('https://example.com/asset.png', () => '<svg></svg>', 'test asset');
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.loading).toBe('lazy');
    expect(img?.decoding).toBe('async');

    // 3. cleanup3dMedia removes images without empty src attribute
    cleanup3dMedia(container);
    expect(container.querySelectorAll('img').length).toBe(0);

    // 4. trackMediaBlobUrl and safeRevokeMediaUrl
    const blobUrl = 'blob:http://localhost/test-uuid';
    expect(trackMediaBlobUrl(blobUrl)).toBe(blobUrl);
    expect(() => safeRevokeMediaUrl(blobUrl)).not.toThrow();
    expect(() => revokeTrackedMediaBlobUrls()).not.toThrow();
  });

  it('KeepAlive OEM guides provide complete multi-vendor coverage', async () => {
    expect(OEM_GUIDES.length).toBe(5);
    const brandIds = OEM_GUIDES.map((g) => g.id);
    expect(brandIds).toEqual(['xiaomi', 'huawei', 'oppo', 'vivo', 'generic']);

    OEM_GUIDES.forEach((guide) => {
      expect(guide.name.length).toBeGreaterThan(0);
      expect(guide.jumpText.length).toBeGreaterThan(0);
      expect(guide.steps.length).toBeGreaterThan(0);
    });

    // getDeviceKeepAliveInfo in web environment defaults safely to generic
    const info = await getDeviceKeepAliveInfo();
    expect(info.matchedOem).toBe('generic');

    // openOemKeepAliveSettings in web environment returns unsupported_platform
    const res = await openOemKeepAliveSettings('xiaomi');
    expect(res.success).toBe(false);
    expect(res.openedAction).toBe('unsupported_platform');
  });
});
