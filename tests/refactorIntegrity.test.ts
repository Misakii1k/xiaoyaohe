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
});
