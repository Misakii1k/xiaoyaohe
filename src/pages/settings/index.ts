import { el, renderPage } from '../../ui/components';
import { listLogs, listMeds, listRules } from '../../db/local';
import { initializeLlmSecretStore } from '../../ai/llmConfig';
import { isNativeSecretStore } from '../../ai/secretStore';
import { stopRingtonePreview } from '../../features/alarmRingtone';
import { renderImageGenSettingsPanel } from '../../ui/imageGenSettingsPanel';
import { renderLanSyncSettingsPanel } from '../../sync/lan/settingsPanel';

import { createSettingsGroup } from './components/panelPrimitives';
import { renderProfileHero } from './components/ProfileHero';
import { renderStatsGrid } from './components/StatsGrid';
import { renderAboutSection } from './components/AboutSection';
import type { PanelIconTone } from './types';

import { renderReminderPanel, renderPeriodSettingsPanel } from './panels/ReminderPanel';
import { renderAppearancePanel } from './panels/AppearancePanel';
import { renderKeepAlivePanel } from './panels/KeepAlivePanel';
import { renderAppUpdatePanel } from './panels/AppUpdatePanel';
import { renderBackupCard, importBackupFileForRoute, type BackupImportRouteOperations } from './panels/BackupPanel';
import { renderCacheStoragePanel } from './panels/StorageCachePanel';
import { renderLlmPanel, renderAiConsentPanel } from './panels/LlmConfigPanel';
import { renderDiagnosticsPanel, type DiagnosticsPanelOperations } from './panels/DiagnosticsPanel';

const settingsPageCleanupByRoot = new WeakMap<HTMLElement, () => void>();

export async function renderSettingsPage(
  root: HTMLElement,
  signal?: AbortSignal,
): Promise<void | (() => void)> {
  const [meds, rules, logs, secretInitialization] = await Promise.all([
    listMeds(),
    listRules(),
    listLogs(),
    Promise.allSettled([
      initializeLlmSecretStore(),
    ]),
  ]);
  if (signal?.aborted) return;

  const content = el('div', { class: 'page page-light settings-page' });
  content.classList.add('profile-page');

  // 1. 用户信息卡片 (真实统计与可换头像)
  content.append(renderProfileHero(meds, logs));

  // 2. 我的数据 1x3 真实数据统计栏 (全真实对接，点击跳转)
  content.append(renderStatsGrid(meds, rules, logs));

  if (secretInitialization.some((result) => result.status === 'rejected')) {
    content.append(el('div', {
      class: 'settings-storage-warning',
      role: 'status',
      text: isNativeSecretStore()
        ? 'AI 密钥安全存储暂时不可用；其他设置仍可使用，请稍后重试保存密钥。'
        : '浏览器未能初始化 AI 密钥存储；其他设置仍可使用，可切换“仅本次会话”后重试。',
    } as any));
  }

  // 3. 分组 1：用药提醒与外观
  const reminderAppearanceGroup = createSettingsGroup('提醒与外观', 'bell', [
    renderReminderPanel(),
    renderPeriodSettingsPanel(),
    renderAppearancePanel(),
    renderKeepAlivePanel(),
  ]);

  // 4. 分组 2：数据与家庭同步
  const lanSyncPanel = renderLanSyncSettingsPanel(signal);
  const appUpdatePanel = renderAppUpdatePanel();
  const backupCard = renderBackupCard(
    root,
    signal,
    {
      meds: meds.length,
      rules: rules.length,
      logs: logs.length,
    },
    (routeSignal) => renderSettingsPage(root, routeSignal),
  );
  const cacheStoragePanel = renderCacheStoragePanel(signal);
  const dataSyncGroup = createSettingsGroup('数据与家庭同步', 'cloud', [
    lanSyncPanel.element,
    backupCard.element,
    cacheStoragePanel.element,
    appUpdatePanel.element,
  ]);

  // 5. 分组 3：AI 智能助手与高级
  const llmPanel = renderLlmPanel();
  const imageGenPanel = renderImageGenSettingsPanel();
  const aiDiagnosticsGroup = createSettingsGroup('智能助手与高级', 'sparkles', [
    llmPanel.element,
    imageGenPanel.element,
    renderAiConsentPanel(),
    renderDiagnosticsPanel(),
  ]);

  // 6. 分组卡片与关于小药盒平铺挂载
  const settingsWrapper = el('div', { class: 'profile-advanced-wrapper' });
  settingsWrapper.append(
    reminderAppearanceGroup,
    dataSyncGroup,
    aiDiagnosticsGroup,
    renderAboutSection(),
  );
  content.append(settingsWrapper);

  const onDeactivated = () => {
    stopRingtonePreview();
  };
  root.addEventListener('tab:deactivated', onDeactivated);

  settingsPageCleanupByRoot.get(root)?.();
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    root.removeEventListener('tab:deactivated', onDeactivated);
    stopRingtonePreview();
    llmPanel.cleanup();
    imageGenPanel.cleanup();
    lanSyncPanel.cleanup();
    cacheStoragePanel.cleanup();
    appUpdatePanel.cleanup();
    backupCard.cleanup();
    signal?.removeEventListener('abort', cleanup);
    if (settingsPageCleanupByRoot.get(root) === cleanup) {
      settingsPageCleanupByRoot.delete(root);
    }
  };
  settingsPageCleanupByRoot.set(root, cleanup);
  signal?.addEventListener('abort', cleanup, { once: true });

  if (signal?.aborted) {
    cleanup();
    return cleanup;
  }

  renderPage({ root, title: '我的', activeTab: 'settings', content });
  return cleanup;
}

export {
  renderDiagnosticsPanel,
  importBackupFileForRoute,
  type BackupImportRouteOperations,
  type DiagnosticsPanelOperations,
  type PanelIconTone,
};
