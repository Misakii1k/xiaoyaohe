import '../ui/styles/pages/settings.css';
import { openAvatarPicker } from '../ui/AvatarPicker';
import { getAvatarById, getActiveAvatarId } from '../ui/avatars';
import {
  statNotebookImg,
  statPillboxImg,
  statTargetImg,
  getUserAvatar3dSvg,
  getStatLog3dSvg,
  getStatBox3dSvg,
  getStatRate3dSvg,
  parseSvg,
  render3dMedia,
} from '../ui/assets3d';
import {
  listLogs,
  listMeds,
  listRules,
  listReminderPeriodSettings,
  getReminderPeriodSetting,
  updateReminderPeriodSetting,
} from '../db/local';
import {
  SLOT_LABEL,
  MEDICATION_REMINDER_MODE_LABEL,
  type ReminderPeriodSetting,
  type MedicationReminderMode,
} from '../db/schema';
import { confirmDialog, el, renderPage, toast, icon, field, type IconName, topbarAiPill } from '../ui/components';
import { createSegmentedControl } from '../ui/primitives/SegmentedControl';
import { openBottomSheet } from '../ui/primitives/BottomSheet';
import QRCode from 'qrcode';
import { getThemePreference, setThemePreference, type ThemePreference } from '../ui/theme';
import {
  getLiquidGlassPreference,
  setLiquidGlassPreference,
  type LiquidGlassPreference,
} from '../ui/liquidGlass';
import { openLlmProviderEditor } from '../ui/llmProviderEditor';
import {
  backupProviders,
  buildBackup,
  previewBackupImport,
  type BackupPreviewResult,
  type BackupProvider,
} from '../tools/registry';
import {
  notificationsSupported,
  getPermission,
  getExactAlarmCapability,
  isNativeReminderPlatform,
  requestPermission,
  requestExactAlarmCapability,
  getFullScreenAlarmCapability,
  refreshFullScreenAlarmCapability,
  requestFullScreenAlarmCapability,
  showNotification,
} from '../features/notifier';
import { fireNativeMedicationAlarmNow, nativeMedicationAlarmAvailable } from '../features/nativeMedicationAlarm';
import {
  bindCustomAlarmScanCode,
  disableAlarmScanVerify,
  enableAlarmScanVerify,
  getAlarmScanVerifyPreference,
  getOrCreateGeneratedScanToken,
  hasAlarmScanToken,
  rotateAlarmScanToken,
} from '../features/alarmScanVerify';
import { startScan, scanCodeFromImage, type Scanner } from '../features/scanner';
import {
  isAppNotificationsEnabled,
  setAppNotificationsEnabled,
} from '../features/notificationPreference';
import { runOnce as runReminderOnce, rescheduleMedicationReminders } from '../features/reminderScheduler';
import {
  getLlmProviderSet,
  setLlmProviderSet,
  initializeLlmSecretStore,
  isUsingDefaultKey,
  getLlmHealth,
  DEFAULT_LLM_CONFIG,
  MAX_LLM_PROVIDERS,
  type LlmHealth,
  type LlmProvider,
} from '../ai/llmConfig';
import { clearAiConsents, getAiConsentRecords, revokeAiConsent } from '../ai/consent';
import {
  getWebSecretPersistence,
  isNativeSecretStore,
  setWebSecretPersistence,
  WEB_SECRET_STORAGE_NOTICE,
} from '../ai/secretStore';
import { assertBackupFileSize, parseSafeBackupPayload } from '../security/validation';
import { renderLanSyncSettingsPanel } from '../sync/lan/settingsPanel';
import {
  clearAvailableUpdate,
  downloadUpdate,
  getAvailableUpdate,
  installApk,
  isApkDistributionAvailable,
  scanLanForUpdates,
  LOCAL_APP_VERSION,
} from '../sync/lan/apkTransport';
import { isIgnoringBatteryOptimizations, requestIgnoreBatteryOptimizations, openAppSettings } from '../features/keepAlive';
import {
  clearDiagnosticLogs,
  copyDiagnosticLogs,
  listDiagnosticLogs,
} from '../app/diagnostics';

const settingsPageCleanupByRoot = new WeakMap<HTMLElement, () => void>();

interface SettingsRenderPart {
  element: HTMLElement;
  cleanup: () => void;
}

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

  // 计算真实管理天数
  let daysManaging = 0;
  const timestamps: number[] = [];
  for (const log of logs) {
    if (log.ackAt) timestamps.push(log.ackAt);
    else if (log.dueAt) timestamps.push(log.dueAt);
    else if (log.updatedAt) timestamps.push(log.updatedAt);
  }
  for (const med of meds) {
    if (med.createdAt) timestamps.push(med.createdAt);
    else if (med.updatedAt) timestamps.push(med.updatedAt);
  }
  if (timestamps.length > 0) {
    const earliest = Math.min(...timestamps);
    const diffMs = Math.max(0, Date.now() - earliest);
    daysManaging = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }

  const activeRulesCount = rules.filter((rule) => rule.enabled && !rule.deleted).length;

  // 1. 用户信息卡片 (真实统计与可换头像)
  const profileHero = el('div', { class: 'profile-hero-card' });
  const userRow = el('div', { class: 'profile-user-row' });
  const avatarWrap = el('button', {
    class: 'profile-avatar-wrap',
    type: 'button',
    'aria-label': '更换头像',
    title: '点击更换头像',
  } as any);

  function renderAvatar(): void {
    const item = getAvatarById(getActiveAvatarId());
    avatarWrap.style.backgroundColor = item.bgColor;
    const avatarEl = item.imgUrl
      ? el('img', { class: 'profile-avatar-img', src: item.imgUrl, alt: item.name })
      : parseSvg(getUserAvatar3dSvg());
    const editBadge = el('div', { class: 'profile-avatar-edit-badge' });
    editBadge.append(icon('camera'));
    avatarWrap.replaceChildren(avatarEl, editBadge);
  }
  renderAvatar();

  avatarWrap.onclick = () => {
    openAvatarPicker(() => {
      renderAvatar();
    });
  };

  const userInfo = el('div', { class: 'profile-user-info' });
  userInfo.append(
    el('div', { class: 'profile-user-name', text: '小药盒用户' }),
    el('div', {
      class: 'profile-user-sub',
      text: daysManaging > 0 ? `用药管理第 ${daysManaging} 天` : '开启科学用药管理',
    })
  );
  userRow.append(avatarWrap, userInfo);

  const streakBadge = el('div', { class: 'profile-streak-badge' });
  streakBadge.append(icon(logs.length > 0 ? 'sparkles' : 'shield'));
  streakBadge.append(el('span', {
    text: logs.length > 0 ? `已记录 ${logs.length} 次服药` : '本地安全离线存储',
  }));

  profileHero.append(userRow, streakBadge);
  content.append(profileHero);

  // 2. 我的数据 1x3 真实数据统计栏 (全真实对接，点击跳转)
  const statsSection = el('div', { class: 'profile-stats-section' });
  statsSection.append(el('h2', { class: 'profile-section-title', text: '我的数据' }));

  const statsGrid = el('div', { class: 'profile-stats-grid' });
  statsGrid.append(
    createProfileStatCard('全部药品', `${meds.length} 种`, '在库管理', statPillboxImg, getStatBox3dSvg, () => {
      location.hash = '#/meds';
    }),
    createProfileStatCard('用药计划', `${activeRulesCount} 条`, '今日待服', statNotebookImg, getStatLog3dSvg, () => {
      location.hash = '#/today';
    }),
    createProfileStatCard('打卡记录', `${logs.length} 次`, '历史日历', statTargetImg, getStatRate3dSvg, () => {
      location.hash = '#/history';
    })
  );
  statsSection.append(statsGrid);
  content.append(statsSection);

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
  content.append(reminderAppearanceGroup);

  // 4. 分组 2：数据与家庭同步
  const lanSyncPanel = renderLanSyncSettingsPanel(signal);
  const appUpdatePanel = renderAppUpdatePanel();
  const backupCard = renderBackupCard(root, signal, {
    meds: meds.length,
    rules: rules.length,
    logs: logs.length,
  });
  const dataSyncGroup = createSettingsGroup('数据与家庭同步', 'cloud', [
    lanSyncPanel.element,
    backupCard.element,
    appUpdatePanel.element,
  ]);
  content.append(dataSyncGroup);

  // 5. 分组 3：AI 智能助手与诊断
  const llmPanel = renderLlmPanel();
  const aiDiagnosticsGroup = createSettingsGroup('智能助手与高级', 'sparkles', [
    llmPanel.element,
    renderAiConsentPanel(),
    renderDiagnosticsPanel(),
  ]);
  content.append(aiDiagnosticsGroup);

  // 6. 分组 4：关于小药盒
  content.append(renderAboutSection());

  settingsPageCleanupByRoot.get(root)?.();
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    llmPanel.cleanup();
    lanSyncPanel.cleanup();
    appUpdatePanel.cleanup();
    backupCard.cleanup();
    signal?.removeEventListener('abort', cleanup);
    if (settingsPageCleanupByRoot.get(root) === cleanup) {
      settingsPageCleanupByRoot.delete(root);
    }
  };
  settingsPageCleanupByRoot.set(root, cleanup);
  signal?.addEventListener('abort', cleanup, { once: true });

  renderPage({ root, title: '我的', activeTab: 'settings', topRight: topbarAiPill(), content });
  return cleanup;
}

function renderAboutSection(): HTMLElement {
  const aboutSection = el('section', { class: 'settings-group-section settings-about-section' });
  const aboutHead = el('div', { class: 'settings-group-header' });
  aboutHead.append(icon('info', 'settings-group-icon'));
  aboutHead.append(el('h2', { class: 'settings-group-title', text: '关于小药盒' }));
  aboutSection.append(aboutHead);

  const aboutCard = el('div', { class: 'settings-group-card settings-about-card' });

  const brandRow = el('div', { class: 'settings-about-brand-row' });
  const logo = el('div', { class: 'settings-about-logo' });
  logo.append(icon('pill'));
  const titleWrap = el('div', { class: 'settings-about-title-wrap' });
  titleWrap.append(
    el('div', { class: 'settings-about-app-name', text: '小药盒 · 家庭健康用药管家' }),
    el('div', { class: 'settings-about-version', text: `版本 v${__APP_VERSION__} (正式版)` }),
  );
  brandRow.append(logo, titleWrap);

  const intro = el('div', {
    class: 'settings-about-intro',
    text: '用于家庭日常用药管理。服药提醒、药品信息与库存记录均保存在本地设备中，不展示广告，无需注册账号。',
  });

  const highlights = el('div', { class: 'settings-about-highlights' }, [
    el('div', { class: 'settings-about-hl-item', text: '✔ 定时服药提醒与记录' }),
    el('div', { class: 'settings-about-hl-item', text: '✔ 药箱余量预警' }),
    el('div', { class: 'settings-about-hl-item', text: '✔ 数据保存在本地设备' }),
    el('div', { class: 'settings-about-hl-item', text: '✔ 局域网面对面免流量同步' }),
  ]);

  const disclaimer = el('div', {
    class: 'settings-about-disclaimer muted',
    text: '健康声明：小药盒的服药提醒与助手建议仅供日常健康管理参考，不构成处方或临床诊断意见。如有不适，请咨询专业医生。',
  });

  aboutCard.append(brandRow, intro, highlights, disclaimer);
  aboutSection.append(aboutCard);
  return aboutSection;
}

function createProfileStatCard(
  label: string,
  val: string,
  sub: string,
  img: string,
  svgFn: () => string,
  onClick?: () => void,
): HTMLElement {
  const card = el('button', {
    class: 'profile-stat-card',
    type: 'button',
  } as any);
  const info = el('div', { class: 'profile-stat-info' });
  info.append(
    el('div', { class: 'profile-stat-label', text: label }),
    el('div', { class: 'profile-stat-val', text: val })
  );
  if (sub) {
    info.append(el('div', { class: 'profile-stat-sub', text: sub }));
  }
  const iconWrap = el('div', { class: 'profile-stat-icon' });
  if (img) {
    iconWrap.append(render3dMedia(img, svgFn, label, 'profile-stat-icon-img'));
  } else {
    iconWrap.append(parseSvg(svgFn()));
  }
  card.append(info, iconWrap);
  if (onClick) {
    card.onclick = onClick;
  }
  return card;
}

function createSettingsGroup(
  title: string,
  iconName: IconName,
  items: HTMLElement[],
): HTMLElement {
  const section = el('section', { class: 'settings-group-section' });
  const head = el('div', { class: 'settings-group-header' });
  head.append(icon(iconName, 'settings-group-icon'));
  head.append(el('h2', { class: 'settings-group-title', text: title }));
  section.append(head);

  const card = el('div', { class: 'settings-group-card' });
  for (const item of items) {
    card.append(item);
  }
  section.append(card);
  return section;
}

export interface BackupImportRouteOperations {
  validateFile: (file: File) => void;
  readText: (file: File) => Promise<string>;
  parse: (text: string) => Record<string, unknown>;
  preview: (raw: unknown) => Promise<BackupPreviewResult>;
  confirm: (message: string, okText?: string) => Promise<boolean>;
  providers: readonly Pick<BackupProvider, 'label' | 'import'>[];
  notify: (message: string, duration?: number) => void;
  rerender: (signal?: AbortSignal) => void | Promise<void | (() => void)>;
}

export async function importBackupFileForRoute(
  root: HTMLElement,
  file: File,
  signal?: AbortSignal,
  operations?: BackupImportRouteOperations,
): Promise<void> {
  const ops: BackupImportRouteOperations = operations ?? {
    validateFile: assertBackupFileSize,
    readText: (selectedFile) => selectedFile.text(),
    parse: (text) => parseSafeBackupPayload(JSON.parse(text)),
    preview: previewBackupImport,
    confirm: confirmDialog,
    providers: backupProviders,
    notify: toast,
    rerender: (routeSignal) => renderSettingsPage(root, routeSignal),
  };

  try {
    ops.validateFile(file);
    const text = await ops.readText(file);
    if (signal?.aborted) return;
    const raw = ops.parse(text);

    const preview = await ops.preview(raw);
    if (signal?.aborted) return;
    const totalItems = preview.providers.reduce(
      (sum, provider) => sum + provider.added + provider.updated + provider.skipped,
      0,
    );
    if (totalItems === 0) {
      ops.notify('这个备份里没有可导入的数据');
      return;
    }

    const summaryLines = preview.providers.map(
      (provider) =>
        `${provider.label}：新增 ${provider.added}，更新 ${provider.updated}，跳过 ${provider.skipped}`,
    );
    const warningText = preview.warnings.length
      ? `\n注意：${preview.warnings.slice(0, 5).join('；')}${preview.warnings.length > 5 ? `（共 ${preview.warnings.length} 条）` : ''}`
      : '';
    const confirmed = await ops.confirm(
      `导入备份？\n\n${summaryLines.join('\n')}\n只会合并更新，不会清空本地数据。${warningText}`,
      '导入',
    );
    if (signal?.aborted || !confirmed) return;

    const results: string[] = [];
    for (const provider of ops.providers) {
      const result = await provider.import(raw);
      results.push(
        `${provider.label} 新增 ${result.added}，更新 ${result.updated}，跳过 ${result.skipped}`,
      );
    }
    if (signal?.aborted) return;

    ops.notify(results.join('；'), 4200);
    await ops.rerender(signal);
  } catch (error) {
    if (signal?.aborted) return;
    ops.notify('导入失败：' + (error instanceof Error ? error.message : String(error)), 3600);
  }
}

function renderBackupCard(
  root: HTMLElement,
  signal?: AbortSignal,
  counts?: { meds: number; rules: number; logs: number },
): SettingsRenderPart {
  let fileInput: HTMLInputElement;
  let exportBtn: HTMLElement;
  let importBtn: HTMLElement;

  const countSummary = counts ? `${counts.meds} 药 · ${counts.logs} 记录` : '就绪';

  const element = panel({
    title: '本地数据与备份',
    iconName: 'box',
    chip: { text: countSummary, tone: 'ok' },
    renderBody: (body) => {
      body.classList.add('settings-backup-panel-body');
      if (counts) {
        body.append(el('div', {
          class: 'muted settings-backup-summary',
          text: `本机现有 ${counts.meds} 种药品、${counts.rules} 条提醒规则、${counts.logs} 条服药记录。`,
        }));
      }
      body.append(el('div', {
        class: 'muted settings-backup-note',
        text: '备份会完整包含以上数据。导入时按 ID 与更新时间合并，不会清空本地数据。',
      }));

      exportBtn = el('button', { class: 'btn tonal', type: 'button', text: '导出备份文件' });
      exportBtn.onclick = async () => {
        if (signal?.aborted) return;
        const data = await buildBackup();
        if (signal?.aborted) return;
        downloadJson(data, `xiaoyaohe-backup-${new Date().toISOString().slice(0, 10)}.json`);
      };

      importBtn = el('button', { class: 'btn', type: 'button', text: '从备份恢复数据' });
      fileInput = el('input', {
        type: 'file',
        accept: 'application/json,.json',
        style: 'display:none',
      });
      importBtn.onclick = () => {
        if (!signal?.aborted) fileInput.click();
      };
      fileInput.onchange = async () => {
        if (signal?.aborted) return;
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (!file) return;
        await importBackupFileForRoute(root, file, signal);
      };

      const row = el('div', { class: 'btn-row backup-actions', style: 'margin-block-start: var(--space-3);' });
      row.append(exportBtn, importBtn);
      body.append(row, fileInput);
    },
  });

  return {
    element,
    cleanup: () => {
      if (exportBtn) exportBtn.onclick = null;
      if (importBtn) importBtn.onclick = null;
      if (fileInput) {
        fileInput.onchange = null;
        fileInput.value = '';
      }
    },
  };
}

function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export interface DiagnosticsPanelOperations {
  notify: (message: string) => void;
  confirm: (message: string, okText?: string, danger?: boolean) => Promise<boolean>;
  copy: () => Promise<number>;
}

export function renderDiagnosticsPanel(
  operations?: Partial<DiagnosticsPanelOperations>,
): HTMLElement {
  const ops: DiagnosticsPanelOperations = {
    notify: operations?.notify ?? toast,
    confirm: operations?.confirm ?? confirmDialog,
    copy: operations?.copy ?? copyDiagnosticLogs,
  };
  let refreshContent = () => {};
  const p = panel({
    title: '诊断记录',
    iconName: 'info',
    chip: diagnosticsChip(),
    renderBody: (body) => {
      const description = el('div', {
        class: 'muted',
        text: '仅保留最近 50 条脱敏后的后台失败摘要，不包含密钥、令牌或完整药品正文。',
      });
      const output = el('pre', { class: 'diagnostics-log', tabIndex: 0 });
      const copyButton = el('button', { class: 'btn tonal', type: 'button', text: '复制' });
      const clearButton = el('button', { class: 'btn text', type: 'button', text: '清空' });
      const actions = el('div', { class: 'btn-row diagnostics-actions' });
      actions.append(copyButton, clearButton);

      refreshContent = () => {
        const entries = listDiagnosticLogs();
        output.textContent = entries.length === 0
          ? '暂无诊断记录'
          : entries.map((entry) => `${new Date(entry.at).toLocaleString()}  [${entry.scope}]  ${entry.summary}`).join('\n');
        copyButton.disabled = entries.length === 0;
        clearButton.disabled = entries.length === 0;
      };
      copyButton.onclick = async () => {
        try {
          const count = await ops.copy();
          ops.notify(`已复制 ${count} 条诊断记录`);
        } catch {
          ops.notify('复制失败，请检查剪贴板权限');
        }
      };
      clearButton.onclick = async () => {
        if (!await ops.confirm('清空全部诊断记录？此操作无法撤销。', '清空', true)) return;
        clearDiagnosticLogs();
        refreshContent();
        setChip(p, diagnosticsChip());
        ops.notify('诊断记录已清空');
      };
      body.append(description, output, actions);
    },
  });
  refreshContent();
  return p;
}

function diagnosticsChip(): PanelChip {
  const count = listDiagnosticLogs().length;
  return { text: `${count} 条`, tone: count > 0 ? 'info' : 'muted' };
}

/** ---------------- iOS 折叠面板基础 ---------------- */
interface PanelChip {
  text: string;
  tone: 'ok' | 'warn' | 'info' | 'muted';
}
interface PanelOpts {
  title: string;
  iconName: IconName;
  chip: PanelChip;
  defaultOpen?: boolean;
  renderBody: (body: HTMLElement) => void;
}
let panelSeq = 0;

function panel(opts: PanelOpts): HTMLElement {
  const wrap = el('div', {
    class: 'panel' + (opts.defaultOpen ? ' open' : ''),
  });

  const head = el('button', { class: 'panel-head', type: 'button' });
  const bodyId = `settings-panel-${++panelSeq}`;
  head.setAttribute('aria-expanded', String(Boolean(opts.defaultOpen)));
  head.setAttribute('aria-controls', bodyId);
  const lead = el('span', { class: 'panel-lead' });
  lead.append(icon(opts.iconName, 'panel-icon'));
  lead.append(el('span', { class: 'panel-title', text: opts.title }));
  head.append(lead);

  const right = el('span', { class: 'panel-right' });
  const chip = el('span', {
    class: 'panel-chip tone-' + opts.chip.tone,
    html: opts.chip.text,
  });
  right.append(chip);
  const chevron = el('span', { class: 'panel-chevron' });
  chevron.append(icon('chevron-right'));
  right.append(chevron);
  head.append(right);

  const body = el('div', { class: 'panel-body' });
  body.id = bodyId;
  body.hidden = !opts.defaultOpen;
  if (!opts.defaultOpen) body.setAttribute('inert', '');
  opts.renderBody(body);

  head.onclick = () => {
    const open = wrap.classList.toggle('open');
    head.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
    if (open) body.removeAttribute('inert');
    else body.setAttribute('inert', '');
  };

  wrap.append(head, body);
  return wrap;
}

function setChip(panelEl: HTMLElement, chip: PanelChip): void {
  const c = panelEl.querySelector<HTMLElement>('.panel-chip');
  if (!c) return;
  c.className = 'panel-chip tone-' + chip.tone;
  c.textContent = chip.text;
}

/** ---------------- 外观面板 ---------------- */
const THEME_PREFERENCE_LABEL: Record<ThemePreference, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色',
};

function appearancePanelChip(): PanelChip {
  const pref = getThemePreference();
  return { text: THEME_PREFERENCE_LABEL[pref], tone: pref === 'system' ? 'muted' : 'info' };
}

function renderAppearancePanel(): HTMLElement {
  return panel({
    title: '外观',
    iconName: 'moon',
    chip: appearancePanelChip(),
    defaultOpen: false,
    renderBody: (body) => {
      body.append(el('div', {
        class: 'settings-hint mb-3',
        text: '选择小药盒的配色。跟随系统会随手机的深色模式自动切换。',
      }));
      const control = createSegmentedControl<ThemePreference>(
        '配色方案',
        [
          { value: 'system', label: '跟随系统' },
          { value: 'light', label: '浅色' },
          { value: 'dark', label: '深色' },
        ],
        getThemePreference(),
        (value) => {
          setThemePreference(value);
          const host = body.closest('.panel');
          if (host) setChip(host as HTMLElement, appearancePanelChip());
          toast(`已切换为${THEME_PREFERENCE_LABEL[value]}`);
        },
      );
      body.append(control);

      const liquidEnabled = getLiquidGlassPreference() === 'on';
      const liquidRow = el('label', { class: 'settings-toggle-row mt-3' });
      const liquidCopy = el('div', { class: 'settings-toggle-copy' });
      liquidCopy.append(
        el('div', { class: 'settings-toggle-title', text: '液态玻璃效果' }),
        el('div', {
          class: 'settings-toggle-desc',
          text: liquidEnabled
            ? '底栏与弹层带折射高光的玻璃质感，更耗一点电'
            : '已关闭：使用普通毛玻璃材质，更省电',
        }),
      );
      const liquidToggle = el('input', {
        type: 'checkbox',
        role: 'switch',
        'aria-label': '液态玻璃效果',
      });
      liquidToggle.checked = liquidEnabled;
      liquidToggle.onchange = () => {
        const next: LiquidGlassPreference = liquidToggle.checked ? 'on' : 'off';
        setLiquidGlassPreference(next);
        toast(liquidToggle.checked ? '液态玻璃已开启' : '液态玻璃已关闭');
        // 描述随状态变化
        const desc = liquidCopy.querySelector<HTMLElement>('.settings-toggle-desc');
        if (desc) {
          desc.textContent = liquidToggle.checked
            ? '底栏与弹层带折射高光的玻璃质感，更耗一点电'
            : '已关闭：使用普通毛玻璃材质，更省电';
        }
      };
      liquidRow.append(liquidCopy, liquidToggle);
      body.append(liquidRow);
    },
  });
}

/** ---------------- 通知面板 ---------------- */
function reminderPanelChip(): PanelChip {
  if (!notificationsSupported()) return { text: '不支持', tone: 'warn' };
  if (!isAppNotificationsEnabled()) return { text: '已暂停', tone: 'muted' };
  const perm = getPermission();
  if (perm === 'granted') return { text: '已开启', tone: 'ok' };
  if (perm === 'denied') return { text: '被拒绝', tone: 'warn' };
  return { text: '未开启', tone: 'muted' };
}

function renderReminderPanel(): HTMLElement {
  const p = panel({
    title: '系统通知',
    iconName: 'bell-ring',
    chip: reminderPanelChip(),
    renderBody: (body) => buildReminderBody(body, () => {
      body.replaceChildren();
      buildReminderBody(body, () => {});
      setChip(p, reminderPanelChip());
    }),
  });
  return p;
}

function formatBarcodeTypeLabel(format?: string): string {
  if (!format) return '条形码 / 二维码';
  const f = format.toLowerCase();
  if (f.includes('qr')) return '二维码';
  if (f.includes('ean_13') || f.includes('ean13')) return '商品条形码 (EAN-13)';
  if (f.includes('ean_8') || f.includes('ean8')) return '商品条形码 (EAN-8)';
  if (f.includes('code_128') || f.includes('code128')) return '条形码 (Code 128)';
  if (f.includes('code_39') || f.includes('code39')) return '条形码 (Code 39)';
  if (f.includes('upc')) return '商品条形码 (UPC)';
  if (f.includes('data_matrix') || f.includes('datamatrix')) return 'Data Matrix 码';
  if (f.includes('itf')) return 'ITF 条形码';
  return '条形码 / 二维码';
}

function formatCustomScanCodeSummary(customLabel?: string, token?: string): string {
  const raw = (customLabel || token || '').trim();
  if (!raw) return '已绑定生活码';
  const colonIdx = raw.indexOf(':');
  if (colonIdx > 0 && colonIdx < 16) {
    const formatPart = raw.slice(0, colonIdx).trim();
    const tokenPart = raw.slice(colonIdx + 1).trim();
    const friendlyType = formatBarcodeTypeLabel(formatPart);
    if (tokenPart.length > 20) {
      const tail = tokenPart.slice(-6);
      return `已绑定生活码（${friendlyType} · 尾号 ...${tail}）`;
    }
    return `已绑定生活码（${friendlyType} · ${tokenPart}）`;
  }
  if (raw.length > 24) {
    return `已绑定生活码（尾号 ...${raw.slice(-6)}）`;
  }
  return `已绑定生活码（${raw}）`;
}

function buildReminderBody(body: HTMLElement, rerender: () => void): void {
  const native = isNativeReminderPlatform();
  if (!notificationsSupported()) {
    // 手机 App 和浏览器「收不到提醒」的原因完全不同，给同一句话等于两边都没说清。
    body.append(
      el('div', { class: 'banner warn' }, [
        el('span', {
          html: native
            ? '当前手机无法使用系统通知。请更新应用，并在系统设置中允许通知。'
            : '当前浏览器发不了用药提醒。常见原因：用 http 的局域网地址打开的（需要 https 或本机地址）、浏览器里关掉了通知、或者 iPhone 上还没把本页「添加到主屏幕」。想稳定收到提醒，建议装手机 App。',
        }),
      ])
    );
    return;
  }

  const appEnabled = isAppNotificationsEnabled();
  const toggleRow = el('label', {
    class: 'settings-toggle-row',
  });
  const toggleCopy = el('div', { class: 'settings-toggle-copy' });
  toggleCopy.append(
    el('div', { class: 'settings-toggle-title', text: '应用内用药提醒' }),
    el('div', {
      class: 'settings-toggle-desc',
      text: appEnabled ? '开启后按计划发送系统通知与全屏提醒' : '已暂停：不再调度和弹出用药提醒',
    }),
  );
  const toggle = el('input', {
    type: 'checkbox',
    role: 'switch',
    'aria-label': '应用内用药提醒',
  });
  toggle.checked = appEnabled;
  toggle.onchange = async () => {
    setAppNotificationsEnabled(toggle.checked);
    try {
      await rescheduleMedicationReminders();
    } catch {
      /* reschedule best-effort */
    }
    toast(toggle.checked ? '已开启应用内提醒' : '已暂停应用内提醒');
    rerender();
  };
  toggleRow.append(toggleCopy, toggle);
  body.append(toggleRow);

  if (!appEnabled) {
    body.append(
      el('div', { class: 'banner info' }, [
        el('span', { html: '应用内提醒已关闭。系统通知权限可保留，但不会再发送用药提醒。' }),
      ]),
    );
    return;
  }

  const perm = getPermission();
  const cls = perm === 'granted' ? 'ok' : perm === 'denied' ? 'warn' : 'info';
  const text = perm === 'granted'
    ? native
      ? '通知已开启，应用会按计划发送提醒。'
      : '通知已开启。这个页面开着的时候会准点提醒。'
    : perm === 'denied'
      ? '通知被拒绝。请到系统设置中允许通知。'
      : '通知尚未开启，开启后才能按时收到提醒。';
  body.append(
    el('div', { class: 'banner ' + cls }, [el('span', { html: text })])
  );

  // 诚实降级：网页端做不到手机 App 那种「到点必响」，这一点必须写在用户看得见的
  // 地方，而不是藏在文档里。把话说满，用户漏吃药才是真正的代价。
  if (perm === 'granted' && !native) {
    body.append(
      el('div', { class: 'banner warn mt-3' }, [
        el('span', {
          html:
            '网页端的提醒没有手机 App 可靠：页面关掉之后，浏览器只会在它自己愿意醒来的时候补发提醒，可能晚几十分钟，手机清后台时也可能收不到。每天都要按时吃的药，请装手机 App。',
        }),
      ]),
    );
  }

  if (perm !== 'granted') {
    const row = el('div', { class: 'btn-row mt-3' });
    const grantBtn = el('button', { class: 'btn', html: '开启系统通知' });
    grantBtn.onclick = async () => {
      const r = await requestPermission();
      if (r === 'granted') toast('已开启 ✓');
      else if (r === 'denied') toast('被拒绝，请在系统设置里开');
      else toast('未授权');
      rerender();
    };
    row.append(grantBtn);
    body.append(row);
  } else {
    const isNativeAlarm = isNativeReminderPlatform() && nativeMedicationAlarmAvailable();
    const row = el('div', { class: isNativeAlarm ? 'settings-test-grid' : 'btn-row mt-3' });
    const testBtn = el('button', { class: 'btn tonal', html: '发送测试通知' });
    testBtn.onclick = async () => {
      const ok = await showNotification('测试提醒', {
        body: '看到这条说明当前通知通道可用',
        tag: 'medbox-test',
      });
      toast(ok ? '已发送测试通知' : '发送失败');
    };
    const tickBtn = el('button', { class: 'btn tonal', html: '立即检查到点' });
    tickBtn.onclick = async () => {
      await runReminderOnce();
      toast('已扫描一次到点任务');
    };
    row.append(testBtn, tickBtn);
    if (isNativeAlarm) {
      const strongTest = el('button', { class: 'btn tonal', html: '测试锁屏强提醒' });
      strongTest.onclick = async () => {
        try {
          await fireNativeMedicationAlarmNow('strong');
          toast('已触发强提醒（如未弹出全屏页，请看通知栏/锁屏）');
        } catch {
          toast('触发失败');
        }
      };
      const fullTest = el('button', { class: 'btn tonal', html: '测试全屏提醒' });
      fullTest.onclick = async () => {
        try {
          await fireNativeMedicationAlarmNow('fullscreen-short');
          toast('已触发全屏提醒');
        } catch {
          toast('触发失败，请先允许全屏权限');
        }
      };
      row.append(strongTest, fullTest);
    }
    body.append(row);
  }

  if (perm === 'granted' && isNativeReminderPlatform()) {
    const exactAlarm = getExactAlarmCapability();
    if (exactAlarm !== 'granted') {
      const message = exactAlarm === 'unavailable'
        ? '当前系统无法确认精确闹钟能力，提醒可能有数分钟延迟。'
        : '精确闹钟尚未允许；Android 仍会安排提醒，但可能延迟送达。';
      body.append(
        el('div', { class: 'banner warn mt-3' }, [
          el('span', { html: message }),
        ]),
      );
      if (exactAlarm !== 'unavailable') {
        const exactRow = el('div', { class: 'btn-row mt-3' });
        const exactButton = el('button', { class: 'btn tonal', html: '允许精确闹钟' });
        exactButton.onclick = async () => {
          const capability = await requestExactAlarmCapability();
          if (capability === 'granted') {
            await runReminderOnce();
            toast('精确闹钟已开启');
          } else {
            toast('未开启精确闹钟，将使用系统尽力调度');
          }
          rerender();
        };
        exactRow.append(exactButton);
        body.append(exactRow);
      }
    }
    const fullScreen = getFullScreenAlarmCapability();
    if (fullScreen !== 'granted') {
      body.append(
        el('div', { class: 'banner warn mt-3' }, [
          el('span', {
            html: fullScreen === 'denied'
              ? '全屏提醒权限尚未开启；到点提醒会以顶部通知兜底，不再自动全屏。'
              : '当前系统不提供全屏提醒权限，到点提醒会以顶部通知兜底。',
          }),
        ]),
      );
      if (fullScreen === 'denied') {
        const fullScreenRow = el('div', { class: 'btn-row mt-3' });
        const fullScreenButton = el('button', { class: 'btn tonal', html: '允许全屏提醒' });
        fullScreenButton.onclick = async () => {
          await requestFullScreenAlarmCapability();
          toast('已打开系统设置，返回后会自动检查');
        };
        fullScreenRow.append(fullScreenButton);
        body.append(fullScreenRow);
      }
    }
    void refreshFullScreenAlarmCapability();
  }

  // ── 扫码解除强制提醒（全屏响铃仅 Android 原生生效，配置与绑定全局常驻）──
  const isNativeAlarm = isNativeReminderPlatform() && nativeMedicationAlarmAvailable();
  const scanPref = getAlarmScanVerifyPreference();
  const scanRow = el('label', { class: 'settings-toggle-row mt-3' });
  const scanCopy = el('div', { class: 'settings-toggle-copy' });
  const isCustom = scanPref.mode === 'custom';

  const titleRow = el('div', {
    class: 'settings-toggle-title',
    style: 'display: flex; align-items: center; gap: 8px; flex-wrap: wrap;',
  });
  titleRow.append(el('span', { text: '扫码解除强制提醒' }));
  if (!isNativeAlarm) {
    titleRow.append(
      el('span', {
        class: 'chip-pill',
        style: 'font-size: 11px; font-weight: 500; padding: 1px 7px; border-radius: 999px; background: rgba(0, 0, 0, 0.06); color: var(--color-text-muted);',
        text: '仅 Android App 生效',
      }),
    );
  }

  const descText = scanPref.enabled
    ? (isCustom
        ? `已开启 · ${formatCustomScanCodeSummary(scanPref.customLabel, scanPref.token)}`
        : '已开启 · 全屏提醒必须扫描专属二维码后才能操作')
    : (isCustom
        ? `已关闭 · 当前备用：${formatCustomScanCodeSummary(scanPref.customLabel, scanPref.token)}`
        : '已关闭 · 提醒到点可直接点击完成或贪睡');

  scanCopy.append(
    titleRow,
    el('div', { class: 'settings-toggle-desc', text: descText }),
  );
  const scanToggle = el('input', {
    type: 'checkbox',
    role: 'switch',
    'aria-label': '扫码解除强制提醒',
  });
  scanToggle.checked = scanPref.enabled;
  scanToggle.onchange = async () => {
    if (scanToggle.checked) {
      if (scanPref.mode === 'custom' && scanPref.token) {
        enableAlarmScanVerify('custom');
        toast('已开启扫码验证（已绑定生活码）');
        await rescheduleMedicationReminders().catch(() => {});
      } else {
        enableAlarmScanVerify('generated');
        toast('已开启，请查看专属二维码或扫描已有码绑定');
        openUnlockQrSheet(rerender, true);
      }
    } else {
      disableAlarmScanVerify();
      toast('已关闭扫码验证');
      await rescheduleMedicationReminders().catch(() => {});
    }
    rerender();
  };
  scanRow.append(scanCopy, scanToggle);
  body.append(scanRow);

  // ── 常驻展示当前绑定状态卡片与操作按钮（无论开关开闭均可见）──
  const scanCard = el('div', { class: 'settings-scan-card mt-2' });
  const cardHeader = el('div', { class: 'settings-scan-card-header' });
  const badge = el('span', {
    class: 'chip-pill chip-pill-active',
    style: 'font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px;',
    text: isCustom ? '生活条形码/二维码' : '专属二维码（打印件）',
  });
  const statusLabel = el('span', {
    style: 'font-size: 13px; font-weight: 600; color: var(--color-text);',
    text: isCustom
      ? formatCustomScanCodeSummary(scanPref.customLabel, scanPref.token)
      : (hasAlarmScanToken() ? '专属二维码已就绪' : '专属二维码（系统预置）'),
  });
  cardHeader.append(badge, statusLabel);

  const cardDesc = el('div', {
    class: 'settings-scan-card-desc',
    text: isCustom
      ? '闹钟响起时扫描已绑定的药盒条形码或生活码，直接记录为已服用并自动关闭提醒。'
      : '截图保存专属二维码并打印贴在药箱或远离床的位置，到点起身扫码解除，杜绝睡迷糊随手关闭。',
  });

  scanCard.append(cardHeader, cardDesc);
  if (!isNativeAlarm) {
    scanCard.append(
      el('div', {
        class: 'muted text-xs mt-2',
        text: '💡 网页端支持提前绑定与查看，数据可通过设置页「家庭同步」互传至手机。全屏响铃仅在 Android App 生效。',
      }),
    );
  }
  body.append(scanCard);

  // 操作按钮网格（双列排列，保证移动端自适应舒展）
  const qrGrid = el('div', { class: 'settings-scan-grid mt-2' });
  const testUnlockBtn = el('button', { class: 'btn tonal', html: '试验扫码解锁' });
  testUnlockBtn.onclick = async () => {
    if (!isNativeAlarm) {
      toast('全屏闹钟扫码解锁需在 Android App 中体验');
      return;
    }
    if (!scanPref.enabled) {
      toast('请先开启上方「扫码解除强制提醒」开关');
      return;
    }
    try {
      await fireNativeMedicationAlarmNow('fullscreen-short');
      toast('已触发全屏提醒，请体验扫码解锁');
    } catch {
      toast('触发失败，请先允许全屏权限');
    }
  };

  if (isCustom) {
    const rebindBtn = el('button', { class: 'btn tonal', html: '重新扫码绑定' });
    rebindBtn.onclick = () => openBindCustomCodeSheet(rerender);
    const switchQrBtn = el('button', { class: 'btn tonal', html: '切换为专属二维码' });
    switchQrBtn.onclick = () => {
      openUnlockQrSheet(rerender, true);
      toast('已切换为专属二维码并开启');
    };
    qrGrid.append(rebindBtn, switchQrBtn, testUnlockBtn);
  } else {
    const showQrBtn = el('button', { class: 'btn tonal', html: '查看专属二维码' });
    showQrBtn.onclick = () => openUnlockQrSheet(rerender, scanPref.enabled);
    const bindCustomBtn = el('button', { class: 'btn tonal', html: '扫描生活中的码绑定' });
    bindCustomBtn.onclick = () => openBindCustomCodeSheet(rerender);
    qrGrid.append(showQrBtn, bindCustomBtn, testUnlockBtn);
  }
  body.append(qrGrid);

  body.append(
    el('div', {
      class: 'settings-hint',
      html: native
        ? '提醒说明：\n' +
          '· 请确保允许系统通知、精确闹钟以及（Android 14+）全屏提醒权限。\n' +
          '· 全屏模式将在到点时亮屏提醒，无权限时自动降级为通知栏提醒。\n' +
          '· 若系统限制后台运行，请在电池优化中将本应用设为允许后台活动。\n' +
          '· 重新进入应用时会自动检查遗漏的提醒并校准闹钟。'
        : '网页端提醒说明：\n' +
          '· 将网页「添加到主屏幕」后打开，可提升后台提醒的可靠性。\n' +
          '· 浏览器保持前台运行或处于活跃状态时，提醒最为准确。\n' +
          '· 设备长时间息屏或浏览器进程被清理后，通知可能会延迟或无法接收。\n' +
          '· 网页端不支持锁屏全屏提醒与物理按键拦截，完整功能请使用 Android 客户端。\n' +
          '· 重新打开网页时会自动检查遗漏的服药任务。',
    })
  );
}

/** ---------------- 扫码解除：专属二维码 Sheet ---------------- */
function openUnlockQrSheet(rerender: () => void, activate: boolean = true): void {
  const tokenValue = activate
    ? enableAlarmScanVerify('generated')
    : getOrCreateGeneratedScanToken();
  void rescheduleMedicationReminders().catch(() => {});
  const title = el('h3', { class: 'lan-sync-sheet-title', text: '强制提醒专属二维码' });
  const canvas = document.createElement('canvas');
  canvas.className = 'lan-sync-qr';
  canvas.setAttribute('aria-label', '强制提醒解锁二维码');
  void QRCode.toCanvas(canvas, tokenValue, {
    width: 320,
    margin: 4,
    errorCorrectionLevel: 'M',
    color: { dark: '#151918', light: '#ffffff' },
  });
  const hint = el('div', { class: 'settings-hint' });
  const hintP1 = el('p', { class: 'mb-1' });
  hintP1.append(
    '把这个专属二维码',
    el('strong', { text: '截图保存并打印' }),
    '，贴到药箱、冰箱门或远离床的位置。全屏用药提醒必须扫描此码才能解锁操作。',
  );
  const hintP2 = el('p', { class: 'muted text-xs mt-2' });
  hintP2.append(
    '💡 ',
    el('strong', { text: '没有打印机？' }),
    '您也可以直接点击下方按钮，绑定药盒或生活物品上的已有条码/二维码。',
  );
  hint.append(hintP1, hintP2);
  const rotateBtn = el('button', { class: 'btn tonal', html: '重新生成' });
  rotateBtn.onclick = async () => {
    const confirmed = await confirmDialog(
      '重新生成解锁码？旧二维码将立即作废；已贴出去的打印件需要替换，否则将无法解除提醒。',
      '重新生成',
      true,
    );
    if (!confirmed) return;
    rotateAlarmScanToken();
    toast('已生成新的专属码并开启');
    sheet.close();
    rerender();
    openUnlockQrSheet(rerender, true);
  };
  const switchCustomBtn = el('button', { class: 'btn tonal', html: '改为扫描生活中的码' });
  switchCustomBtn.onclick = () => {
    sheet.close();
    openBindCustomCodeSheet(rerender);
  };
  const closeBtn = el('button', { class: 'btn', html: '完成' });
  let sheet!: ReturnType<typeof openBottomSheet>;
  sheet = openBottomSheet({
    label: '强制提醒专属二维码',
    content: [title, canvas, hint, el('div', { class: 'btn-row mt-3' }, [rotateBtn, switchCustomBtn, closeBtn])],
    initialFocus: closeBtn,
  });
}

/** ---------------- 扫码解除：扫描生活中的已有码绑定 Sheet ---------------- */
function openBindCustomCodeSheet(rerender: () => void): void {
  const title = el('h3', { class: 'lan-sync-sheet-title', text: '扫描生活中的已有码绑定' });
  const hint = el('div', { class: 'settings-hint' });
  const hintP1 = el('p', { class: 'mb-1' });
  hintP1.append(
    '将镜头对准药盒包装上的',
    el('strong', { text: '条形码' }),
    '（如常见药盒 EAN-13 条码）或',
    el('strong', { text: '生活中的任意二维码' }),
    '。',
  );
  const hintP2 = el('p', { class: 'muted text-xs' });
  hintP2.textContent = '绑定后，闹钟提醒响起时只需扫描该码即可解除，无需打印。';
  hint.append(hintP1, hintP2);

  const scannerContainerId = `custom-unlock-scanner-${Date.now()}`;
  const scannerHost = el('div', {
    id: scannerContainerId,
    style: 'width: 100%; min-height: 240px; background: #000; border-radius: 16px; overflow: hidden; position: relative;',
  });

  const statusBox = el('div', { class: 'banner info mt-3', hidden: true });
  const actionRow = el('div', { class: 'btn-row mt-3' });
  const cancelBtn = el('button', { class: 'btn tonal', html: '取消' });
  const fileLabel = el('label', { class: 'btn tonal' });
  fileLabel.append(el('span', { text: '相册选图' }));
  const fileInput = el('input', { type: 'file', accept: 'image/*', style: 'display: none;' }) as HTMLInputElement;
  fileLabel.append(fileInput);

  actionRow.append(fileLabel, cancelBtn);

  let scanner: Scanner | null = null;
  let scannedCode: string | null = null;
  let scannedFormat: string | null = null;

  const scrollToSheetTop = () => {
    sheet.overlay.querySelector<HTMLElement>('.bottom-sheet')?.scrollTo({ top: 0 });
  };

  const handleResult = (raw: string, format: string) => {
    scannedCode = raw.trim();
    scannedFormat = format;
    // 识别成功即收起相机预览（结果门控已暂停相机）：结果与确认按钮直接落入视口，无需上滑。
    scannerHost.hidden = true;
    void scanner?.pause().catch(() => {});
    statusBox.hidden = false;
    statusBox.className = 'banner ok mt-3';
    statusBox.replaceChildren();

    const resultHead = el('div', {
      style: 'font-weight: 600; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;',
    });
    resultHead.append(
      '已识别到：',
      el('span', {
        class: 'chip-pill chip-pill-active',
        style: 'font-size: 12px; font-weight: 500; padding: 2px 8px; border-radius: 999px;',
        text: formatBarcodeTypeLabel(format),
      }),
    );

    const codePreview = el('div', {
      class: 'code-preview mt-2',
      style: 'font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; line-height: 1.4; word-break: break-all; background: rgba(0, 0, 0, 0.05); padding: 8px 10px; border-radius: 8px; max-height: 72px; overflow-y: auto;',
      text: scannedCode,
    });

    const confirmPrompt = el('div', {
      class: 'muted text-xs mt-2',
      text: '确认将该码绑定为提醒解除条件？',
    });

    statusBox.append(resultHead, codePreview, confirmPrompt);

    actionRow.replaceChildren();
    const confirmBtn = el('button', { class: 'btn', html: '确认绑定' });
    confirmBtn.onclick = async () => {
      if (!scannedCode) return;
      bindCustomAlarmScanCode(scannedCode, scannedFormat || undefined);
      toast('已成功绑定并开启！闹钟提醒时扫此码即可解除', 3200);
      await rescheduleMedicationReminders().catch(() => {});
      sheet.close();
      rerender();
    };

    const rescanBtn = el('button', { class: 'btn tonal', html: '重新扫码' });
    rescanBtn.onclick = () => {
      scannedCode = null;
      statusBox.hidden = true;
      scannerHost.hidden = false;
      actionRow.replaceChildren(fileLabel, cancelBtn);
      void scanner?.resume();
      scrollToSheetTop();
    };

    actionRow.append(confirmBtn, rescanBtn);
    scrollToSheetTop();
  };

  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const res = await scanCodeFromImage(file);
      if (res && res.raw) {
        handleResult(res.raw, res.format);
      } else {
        toast('图片中未能识别到有效的条码或二维码，请重试');
      }
    } catch {
      toast('读取图片失败');
    }
  };

  let sheet!: ReturnType<typeof openBottomSheet>;
  sheet = openBottomSheet({
    label: '扫描生活中的已有码绑定',
    content: [title, hint, scannerHost, statusBox, actionRow],
    initialFocus: cancelBtn,
    onClose: () => {
      void scanner?.stop().catch(() => {});
    },
  });

  cancelBtn.onclick = () => {
    sheet.close();
  };

  setTimeout(() => {
    void startScan({
      containerId: scannerContainerId,
      onScan: (res) => {
        handleResult(res.raw, res.format);
      },
      onError: (msg) => {
        statusBox.hidden = false;
        statusBox.className = 'banner warn mt-3';
        statusBox.textContent = `相机提示：${msg}`;
      },
    }).then((s) => {
      scanner = s;
    }).catch(() => {
      statusBox.hidden = false;
      statusBox.className = 'banner warn mt-3';
      statusBox.textContent = '无法启动相机，您也可以点击下方从相册选图识别。';
    });
  }, 100);
}

/** ---------------- 时段提醒设置面板：按时段聚合的整体提醒 ---------------- */
function periodSettingsChip(settings: ReminderPeriodSetting[]): PanelChip {
  if (settings.some((s) => s.state === 'needs-review')) return { text: '待复核', tone: 'warn' };
  if (settings.some((s) => s.state === 'active')) return { text: '已设置', tone: 'ok' };
  return { text: '未设置', tone: 'muted' };
}

function renderPeriodSettingsPanel(): HTMLElement {
  let panelEl!: HTMLElement;
  panelEl = panel({
    title: '时段提醒设置',
    iconName: 'clock',
    chip: { text: '…', tone: 'muted' },
    renderBody: (body) => {
      // 延迟到 panel() 返回后再执行，避免在 panelEl 赋值前引用（TDZ）
      queueMicrotask(() => void renderPeriodSettingsBody(body, panelEl));
    },
  });
  return panelEl;
}

async function renderPeriodSettingsBody(body: HTMLElement, panelEl: HTMLElement): Promise<void> {
  let settings: ReminderPeriodSetting[];
  try {
    settings = await listReminderPeriodSettings();
  } catch {
    body.replaceChildren();
    body.append(el('div', { class: 'banner warn' }, [
      el('span', { html: '时段提醒设置读取失败，请稍后重试。' }),
    ]));
    return;
  }
  setChip(panelEl, periodSettingsChip(settings));
  body.replaceChildren();
  body.append(el('div', {
    class: 'settings-hint',
    html: '每天按早、中、晚、睡前各发送 1 次聚合提醒。点击下方时段可自定义整体时间与响铃方式。',
  }));

  const needsReview = settings.filter((s) => s.state === 'needs-review');
  if (needsReview.length > 0) {
    body.append(el('div', { class: 'banner warn mt-3' }, [
      el('span', {
        html: `以下时段内不同药的提醒时间或方式不完全一致：${needsReview.map((s) => SLOT_LABEL[s.slot]).join('、')}。请逐个确认统一的整体时间与方式。`,
      }),
    ]));
  }

  const list = el('div', { class: 'period-setting-list mt-3' });
  for (const setting of settings) list.append(buildPeriodSettingRow(setting, body, panelEl));
  body.append(list);

  body.append(el('div', {
    class: 'settings-hint',
    html: '各药品自身的具体时间仍保留，新增药品不会重置上方设置。',
  }));
}

function buildPeriodSettingRow(
  setting: ReminderPeriodSetting,
  body: HTMLElement,
  panelEl: HTMLElement,
): HTMLElement {
  const row = el('div', {
    class: 'period-setting-row' + (setting.state === 'needs-review' ? ' needs-review' : ''),
    role: 'button',
    tabIndex: 0,
    'aria-label': `编辑${SLOT_LABEL[setting.slot]}时段提醒`,
  });
  const copy = el('div', { class: 'settings-toggle-copy' });
  const title = el('div', { class: 'settings-toggle-title' });
  title.append(el('span', { text: SLOT_LABEL[setting.slot] }));
  if (setting.state === 'needs-review') {
    title.append(el('span', { class: 'panel-chip tone-warn period-review-badge', text: '待复核' }));
  }
  const meta = [MEDICATION_REMINDER_MODE_LABEL[setting.mode]];
  if (setting.escalate.repeatEveryMin > 0) meta.push(`每 ${setting.escalate.repeatEveryMin} 分钟重推`);
  copy.append(
    title,
    el('div', { class: 'period-setting-time', text: setting.timeLocal }),
    el('div', { class: 'settings-toggle-desc', text: meta.join(' · ') }),
  );
  const chevron = el('span', { class: 'panel-chevron' });
  chevron.append(icon('chevron-right'));
  row.append(copy, chevron);
  const open = () => void renderPeriodEditor(body, setting, panelEl);
  row.onclick = open;
  row.onkeydown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  };
  return row;
}

/** 时段编辑器：整体时间 + 提醒方式 + 重复策略，保存后重建闹钟。 */
async function renderPeriodEditor(
  body: HTMLElement,
  setting: ReminderPeriodSetting,
  panelEl: HTMLElement,
): Promise<void> {
  let latest: ReminderPeriodSetting;
  try {
    latest = await getReminderPeriodSetting(setting.slot);
  } catch {
    toast('时段设置读取失败，请重试');
    return;
  }
  body.replaceChildren();

  const back = el('button', { class: 'btn text small', type: 'button', html: '← 返回时段列表' });
  back.onclick = () => void renderPeriodSettingsBody(body, panelEl);
  body.append(back);

  body.append(el('div', { class: 'section-title mt-3', html: `${SLOT_LABEL[latest.slot]}时段整体提醒` }));

  if (latest.state === 'needs-review') {
    body.append(el('div', { class: 'banner warn mt-3' }, [
      el('span', {
        html: '该时段内不同药的提醒时间或方式不完全一致，当前按下面的统一设置发送整体提醒。确认后复核标记自动消除；每种药自己的精确时间仍保留，仅用于记录与库存归因。',
      }),
    ]));
  }

  const timeIn = el('input', { type: 'time', step: '60', value: latest.timeLocal }) as HTMLInputElement;

  const modeControl = el('div', {
    class: 'period-mode-chips',
    role: 'radiogroup',
    'aria-label': '提醒方式',
  });
  let selectedMode: MedicationReminderMode = latest.mode;
  for (const mode of Object.keys(MEDICATION_REMINDER_MODE_LABEL) as MedicationReminderMode[]) {
    const option = el('button', {
      class: 'period-mode-chip' + (mode === selectedMode ? ' is-selected' : ''),
      type: 'button',
      role: 'radio',
      'aria-checked': String(mode === selectedMode),
    });
    option.append(el('strong', { text: MEDICATION_REMINDER_MODE_LABEL[mode] }));
    option.append(el('span', {
      text: mode === 'strong' ? '高优先级通知' : mode === 'fullscreen-short' ? '全屏 10 秒' : '持续提醒',
    }));
    option.onclick = () => {
      selectedMode = mode;
      for (const child of modeControl.querySelectorAll<HTMLElement>('[role="radio"]')) {
        const selected = child === option;
        child.classList.toggle('is-selected', selected);
        child.setAttribute('aria-checked', String(selected));
      }
    };
    modeControl.append(option);
  }

  const repeatIn = el('input', {
    type: 'number', min: '1', step: '1', value: String(latest.escalate.repeatEveryMin),
  }) as HTMLInputElement;
  const maxRepeatsIn = el('input', {
    type: 'number', min: '0', step: '1', value: String(latest.escalate.maxRepeats),
  }) as HTMLInputElement;
  const caregiverIn = el('input', {
    type: 'number', min: '0', step: '1', value: String(latest.escalate.notifyCaregiverAfterMin),
  }) as HTMLInputElement;

  body.append(
    field('整体提醒时间', timeIn),
    field('提醒方式', modeControl),
    field('未确认时每几分钟再提醒', repeatIn),
    field('最多重推次数（不含首次）', maxRepeatsIn),
    field('超过几分钟通知照护者（0 = 不通知）', caregiverIn),
  );

  const row = el('div', { class: 'btn-row mt-3' });
  const saveBtn = el('button', { class: 'btn', html: '保存' });
  saveBtn.onclick = async () => {
    if (saveBtn.hasAttribute('disabled')) return;
    saveBtn.setAttribute('disabled', 'true');
    try {
      await updateReminderPeriodSetting(latest.slot, {
        timeLocal: timeIn.value,
        mode: selectedMode,
        escalate: {
          repeatEveryMin: Math.max(1, Math.floor(Number(repeatIn.value) || 1)),
          maxRepeats: Math.max(0, Math.floor(Number(maxRepeatsIn.value) || 0)),
          notifyCaregiverAfterMin: Math.max(0, Math.floor(Number(caregiverIn.value) || 0)),
        },
      });
    } catch (error) {
      saveBtn.removeAttribute('disabled');
      toast('保存失败：' + (error instanceof Error ? error.message : String(error)));
      return;
    }
    try { await rescheduleMedicationReminders(); } catch { /* best-effort */ }
    toast(`${SLOT_LABEL[latest.slot]}时段提醒已保存，闹钟已重建`);
    void renderPeriodSettingsBody(body, panelEl);
  };
  row.append(saveBtn);
  body.append(row);
}

/** ---------------- 后台运行/保活面板：申请电池优化白名单 ---------------- */
function renderKeepAlivePanel(): HTMLElement {
  const p = panel({
    title: '后台运行',
    iconName: 'plug',
    chip: { text: '检查中', tone: 'muted' },
    renderBody: (body) => {
      // 延迟到 panel() 返回后再执行，避免在 p 赋值前引用 p（TDZ）
      queueMicrotask(() => void refreshKeepAlive(body, p));
    },
  });
  return p;
}

/** ---------------- 应用更新面板（局域网分发 APK 自动更新） ---------------- */
function renderAppUpdatePanel(): SettingsRenderPart {
  const update = getAvailableUpdate();
  const available = isApkDistributionAvailable();
  const chip: PanelChip = !available
    ? { text: '仅 App', tone: 'muted' }
    : update
      ? { text: `可更新 v${update.version}`, tone: 'info' }
      : { text: '已是最新', tone: 'ok' };

  let refreshFn: (() => void) | null = null;
  const p = panel({
    title: '应用更新',
    iconName: 'cloud',
    chip,
    renderBody: (body) => {
      const refresh = () => buildAppUpdateBody(body, p, available);
      refreshFn = refresh;
      queueMicrotask(refresh);
    },
  });

  // 监听可用更新变化（如自动同步发现新版本后）
  const onUpdate = () => {
    refreshFn?.();
    const nextUpdate = getAvailableUpdate();
    setChip(p, nextUpdate
      ? { text: `可更新 v${nextUpdate.version}`, tone: 'info' }
      : { text: '已是最新', tone: 'ok' });
  };
  window.addEventListener('medbox:app-update-changed', onUpdate);

  return {
    element: p,
    cleanup: () => window.removeEventListener('medbox:app-update-changed', onUpdate),
  };
}

function buildAppUpdateBody(
  body: HTMLElement,
  panelEl: HTMLElement,
  available: boolean,
): void {
  body.replaceChildren();

  // 当前版本信息
  const versionInfo = el('div', { class: 'settings-hint' });
  versionInfo.append(
    '当前版本：',
    el('strong', { text: `v${LOCAL_APP_VERSION}` }),
    '（正式版）',
  );
  body.append(versionInfo);

  if (!available) {
    body.append(el('div', { class: 'banner info mt-3' }, [
      el('span', { html: '应用更新仅在 Android App 中可用。其他设备同步时会发现可用更新。' }),
    ]));
    return;
  }

  const update = getAvailableUpdate();
  if (!update) {
    body.append(el('div', { class: 'settings-hint mt-3' }, [
      el('span', { html: '同一局域网（Wi-Fi）内有设备升级后，可点击下方按钮主动扫描探测新版本，或在同步时自动接收更新。' }),
    ]));
    const row = el('div', { class: 'btn-row mt-3' });
    const checkBtn = el('button', { class: 'btn tonal', html: '检查局域网更新' });
    checkBtn.onclick = async () => {
      checkBtn.disabled = true;
      checkBtn.textContent = '正在扫描局域网...';
      try {
        const found = await scanLanForUpdates();
        if (found) {
          toast(`发现新版本 v${found.version}！`, 3000);
          setChip(panelEl, { text: `可更新 v${found.version}`, tone: 'info' });
          buildAppUpdateBody(body, panelEl, available);
        } else {
          toast('未在局域网内发现新版本（当前已是最新或暂未检测到已升级设备）', 3500);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : '未知错误';
        toast(`检查失败：${msg}`, 3500);
      } finally {
        checkBtn.disabled = false;
        checkBtn.textContent = '检查局域网更新';
      }
    };
    row.append(checkBtn);
    body.append(row);
    return;
  }

  // 发现可用更新：显示版本、来源、操作按钮
  const updateBanner = el('div', { class: 'banner info mt-3' });
  const updateTitle = el('div');
  updateTitle.append('发现新版本 ', el('strong', { text: `v${update.version}` }));
  const updateSource = el('div', {
    class: 'muted text-xs mt-1',
    text: `来源：${update.peerHost}（局域网内已升级设备）。`,
  });
  updateBanner.append(updateTitle, updateSource);
  body.append(updateBanner);

  const row = el('div', { class: 'btn-row mt-3' });
  const downloadBtn = el('button', { class: 'btn', html: '下载并安装' });
  const recheckBtn = el('button', { class: 'btn tonal', html: '重新扫描' });
  const skipBtn = el('button', { class: 'btn tonal', html: '本次跳过' });

  recheckBtn.onclick = async () => {
    recheckBtn.disabled = true;
    recheckBtn.textContent = '扫描中...';
    try {
      const found = await scanLanForUpdates();
      if (found) {
        toast(`已刷新版本：v${found.version}`, 3000);
        setChip(panelEl, { text: `可更新 v${found.version}`, tone: 'info' });
      } else {
        toast('局域网暂无更新版本');
      }
    } catch {
      toast('扫描失败');
    } finally {
      recheckBtn.disabled = false;
      recheckBtn.textContent = '重新扫描';
      buildAppUpdateBody(body, panelEl, available);
    }
  };

  downloadBtn.onclick = async () => {
    if (downloadBtn.getAttribute('aria-busy') === 'true') return;
    downloadBtn.setAttribute('aria-busy', 'true');
    downloadBtn.textContent = '下载中...';
    downloadBtn.disabled = true;
    recheckBtn.disabled = true;
    skipBtn.disabled = true;
    try {
      const apkPath = await downloadUpdate(update);
      toast(`已下载 v${update.version}，正在调起安装器`, 3200);
      await installApk(apkPath, update.versionCode);
      // 安装器调起后不立即清除可用更新——安装结果由用户在系统中确认。
      // 安装成功后应用会重启，状态自然刷新。
    } catch (error) {
      const msg = error instanceof Error ? error.message : '未知错误';
      toast(`更新失败：${msg}`, 4200);
    } finally {
      downloadBtn.removeAttribute('aria-busy');
      downloadBtn.textContent = '下载并安装';
      downloadBtn.disabled = false;
      recheckBtn.disabled = false;
      skipBtn.disabled = false;
    }
  };

  skipBtn.onclick = () => {
    clearAvailableUpdate();
    toast('已跳过本次更新');
    setChip(panelEl, { text: '已是最新', tone: 'ok' });
    buildAppUpdateBody(body, panelEl, available);
  };

  row.append(downloadBtn, recheckBtn, skipBtn);
  body.append(row);
}

async function refreshKeepAlive(body: HTMLElement, panelEl: HTMLElement): Promise<void> {
  body.replaceChildren();
  const ignoring = await isIgnoringBatteryOptimizations();
  setChip(panelEl, ignoring
    ? { text: '已允许', tone: 'ok' }
    : { text: '需授权', tone: 'warn' });
  if (ignoring) {
    body.append(el('div', { class: 'settings-hint', html: '已在电池优化白名单中，应用可在后台持续运行提醒与同步。' }));
    const row = el('div', { class: 'btn-row mt-3' });
    const openBtn = el('button', { class: 'btn tonal', html: '打开应用设置' });
    openBtn.onclick = () => void openAppSettings();
    row.append(openBtn);
    body.append(row);
    return;
  }
  body.append(el('div', { class: 'banner warn' }, [
    el('span', { html: '允许小药盒在后台运行，提醒和自动同步才不会被系统关闭。点下方按钮，在弹窗里选「允许」。' }),
  ]));
  const row = el('div', { class: 'btn-row mt-3' });
  const allowBtn = el('button', { class: 'btn', html: '允许后台运行' });
  allowBtn.onclick = async () => {
    const ok = await requestIgnoreBatteryOptimizations();
    toast(ok ? '已加入电池优化白名单' : '未加入，可稍后再试');
    void refreshKeepAlive(body, panelEl);
  };
  const openBtn = el('button', { class: 'btn tonal', html: '打开应用设置' });
  openBtn.onclick = () => void openAppSettings();
  row.append(allowBtn, openBtn);
  body.append(row);
}

/** ---------------- AI 大模型面板（支持模型自动检测 + 状态） ---------------- */
function renderLlmPanel(): SettingsRenderPart {
  const initialHealth = getLlmHealth();
  const chip = healthToChip(initialHealth);
  const p = panel({
    title: 'AI 服务商',
    iconName: 'robot',
    chip,
    renderBody: (body) => buildLlmBody(body, (h) => setChip(p, healthToChip(h))),
  });

  // 监听启动期静默体检的回调（main.ts fire）
  const onHealth = (e: Event) => {
    const h = (e as CustomEvent<LlmHealth>).detail;
    setChip(p, healthToChip(h));
  };
  window.addEventListener('medbox:llm-health', onHealth);

  return {
    element: p,
    cleanup: () => window.removeEventListener('medbox:llm-health', onHealth),
  };
}

function healthToChip(h: LlmHealth): PanelChip {
  if (isUsingDefaultKey()) return { text: '未配置', tone: 'muted' };
  if (h.state === 'ok') return { text: '已连接', tone: 'ok' };
  if (h.state === 'error') return { text: '不通', tone: 'warn' };
  return { text: '未检测', tone: 'muted' };
}

function buildLlmBody(body: HTMLElement, onHealthChange: (h: LlmHealth) => void): void {
  body.append(
    el('div', {
      class: 'muted',
      html: '在「编辑药品」里用一句话描述，AI 自动填写药名、规格、用量、时段、提醒时间。可以保存多家服务商，当前一家连不上时按列表顺序自动换下一家。',
    })
  );

  const missingKey = isUsingDefaultKey();
  if (missingKey) {
    body.append(
      el('div', { class: 'banner info mt-3' }, [
        el('span', {
          html: isNativeSecretStore()
            ? '还没填 AI 密钥。手机 App 会把它存进系统安全存储替您保管。'
            : '还没填 AI 密钥。网页版只能把它明文存在这台电脑的浏览器里，请看下方的保存方式说明。',
        }),
      ])
    );
  }

  // 网页端没有系统安全存储可用，密钥只能明文留在浏览器里。如实告知 + 给一个真正有效的选项。
  if (!isNativeSecretStore()) {
    body.append(
      el('div', { class: 'banner warn mt-3' }, [
        el('span', { text: WEB_SECRET_STORAGE_NOTICE }),
      ])
    );
    body.append(buildWebSecretPersistenceRow());
  }

  const listWrap = el('div', { class: 'llm-provider-list mt-3' });
  const failoverRow = el('div', { class: 'settings-toggle-row mt-3' });
  body.append(listWrap, failoverRow);

  const persistAndRender = async (
    providers: LlmProvider[],
    activeId: string,
    failover: boolean,
  ): Promise<void> => {
    await persistProviderSet(providers, activeId, failover, onHealthChange);
    renderList();
  };
  const runProviderMutation = async (mutation: () => Promise<void>): Promise<void> => {
    try {
      await mutation();
    } catch (error) {
      toast('保存失败：' + (error instanceof Error ? error.message : String(error)));
    }
  };

  const renderList = () => {
    const set = getLlmProviderSet();
    listWrap.replaceChildren();

    set.providers.forEach((provider, index) => {
      const row = el('div', { class: `llm-provider-row${provider.id === set.activeId ? ' is-active' : ''}` });
      const head = el('div', { class: 'llm-provider-head' });
      const title = el('div', { class: 'llm-provider-title' });
      const rankBadge = el('span', { class: 'llm-provider-rank', text: `#${index + 1}` });
      title.append(
        rankBadge,
        el('span', { class: 'llm-provider-name', text: provider.label }),
      );
      head.append(title);

      const badges = el('div', { class: 'llm-provider-badges' });
      if (provider.id === set.activeId) {
        badges.append(el('span', { class: 'llm-provider-badge', text: '当前' }));
      }

      const host = hostOf(provider.baseUrl);
      const health = getLlmHealth(provider.id);
      let statusText = '未检测';
      let statusCls = 'pending';
      if (!provider.apiKey) {
        statusText = '未填密钥';
        statusCls = 'warn';
      } else if (health.state === 'ok') {
        statusText = '已连接';
        statusCls = 'ok';
      } else if (health.state === 'error') {
        statusText = '不通';
        statusCls = 'error';
      }

      const statusBadge = el('span', { class: `llm-provider-status ${statusCls}` });
      statusBadge.append(
        el('span', { class: 'llm-status-dot' }),
        el('span', { class: 'llm-status-text', text: statusText }),
      );
      badges.append(statusBadge);
      head.append(badges);
      row.append(head);

      const meta = el('div', { class: 'llm-provider-meta' });
      meta.append(
        el('span', { class: 'llm-meta-host', text: host }),
        el('span', { class: 'llm-meta-sep', text: '·' }),
        el('span', { class: 'llm-meta-model', text: provider.model }),
      );
      row.append(meta);

      const actions = el('div', { class: 'llm-provider-actions' });
      const actionsLeft = el('div', { class: 'llm-actions-left' });
      const actionsRight = el('div', { class: 'llm-actions-right' });

      if (index > 0) {
        const up = el('button', { class: 'btn tonal small', type: 'button', html: '↑ 上移' });
        up.title = '优先级上移';
        up.onclick = () => void runProviderMutation(async () => {
          const latest = getLlmProviderSet();
          const currentIndex = latest.providers.findIndex((item) => item.id === provider.id);
          if (currentIndex <= 0) return;
          const next = [...latest.providers];
          const upper = next[currentIndex - 1]!;
          const lower = next[currentIndex]!;
          next[currentIndex - 1] = lower;
          next[currentIndex] = upper;
          await persistAndRender(next, latest.activeId, latest.failover);
        });
        actionsLeft.append(up);
      }

      if (provider.id !== set.activeId) {
        const activate = el('button', { class: 'btn tonal small llm-activate-btn', type: 'button', html: '设为当前' });
        activate.onclick = () => void runProviderMutation(async () => {
          const latest = getLlmProviderSet();
          await persistAndRender(latest.providers, provider.id, latest.failover);
        });
        actionsRight.append(activate);
      }

      const edit = el('button', { class: 'btn tonal small', type: 'button', html: '编辑' });
      edit.onclick = () => void openLlmProviderEditor(provider, async (draft) => {
        const latest = getLlmProviderSet();
        const next = latest.providers.map((item) => (item.id === draft.id ? draft : item));
        await persistAndRender(next, latest.activeId, latest.failover);
      });
      actionsRight.append(edit);

      if (set.providers.length > 1) {
        const remove = el('button', { class: 'btn text small danger-text', type: 'button', html: '删除' });
        remove.onclick = async () => {
          const ok = await confirmDialog(`删除服务商「${provider.label}」？删除后密钥一并清除。`, '删除', true);
          if (!ok) return;
          await runProviderMutation(async () => {
            const latest = getLlmProviderSet();
            const next = latest.providers.filter((item) => item.id !== provider.id);
            await persistAndRender(next, latest.activeId === provider.id ? next[0]!.id : latest.activeId, latest.failover);
          });
        };
        actionsRight.append(remove);
      }

      actions.append(actionsLeft, actionsRight);
      row.append(actions);
      listWrap.append(row);
    });

    if (set.providers.length >= MAX_LLM_PROVIDERS) {
      listWrap.append(el('div', { class: 'muted', text: `最多保存 ${MAX_LLM_PROVIDERS} 家服务商。` }));
    } else {
      const add = el('button', { class: 'btn tonal mt-3', type: 'button', html: '+ 添加服务商' });
      add.onclick = () => void openLlmProviderEditor(undefined, async (draft) => {
        const latest = getLlmProviderSet();
        await persistAndRender([...latest.providers, draft], draft.id, latest.failover);
      });
      listWrap.append(add);
    }
  };

  const failoverToggle = el('input', { type: 'checkbox', role: 'switch', 'aria-label': '自动切换服务商' });
  failoverToggle.checked = getLlmProviderSet().failover;
  failoverToggle.onchange = async () => {
    const set = getLlmProviderSet();
    try {
      await persistProviderSet(set.providers, set.activeId, failoverToggle.checked, onHealthChange);
      toast(failoverToggle.checked ? '已开启自动切换：当前服务商连不上时自动换下一家' : '已关闭自动切换：只使用当前选中的服务商');
    } catch (error) {
      failoverToggle.checked = set.failover;
      toast('保存失败：' + (error instanceof Error ? error.message : String(error)));
    }
  };
  failoverRow.append(
    el('div', { class: 'settings-toggle-copy' }, [
      el('div', { class: 'settings-toggle-title', text: '自动切换服务商' }),
      el('div', {
        class: 'settings-toggle-desc',
        text: '当前服务商连不上（超时、服务端错误、限流）时，按列表顺序自动试下一家；切换会在界面提示。',
      }),
    ]),
    failoverToggle,
  );

  renderList();

  body.append(
    el('div', {
      class: 'settings-hint',
      html:
        '· 支持 DeepSeek、智谱等主流 AI 服务商；\n' +
        `· 最多可添加 ${MAX_LLM_PROVIDERS} 家服务商，自动按列表顺序智能故障转移；\n` +
        `· 当前推荐模型 ${DEFAULT_LLM_CONFIG.model}；\n` +
        (isNativeSecretStore()
          ? '· 密钥保存在这台手机的系统安全存储中。'
          : '· 网页版没有系统安全存储可用，密钥在浏览器里是明文保存的。'),
    })
  );
}

async function persistProviderSet(
  providers: LlmProvider[],
  activeId: string,
  failover: boolean,
  onHealthChange: (h: LlmHealth) => void,
): Promise<void> {
  await setLlmProviderSet({ providers, activeId, failover });
  // 换到新服务商后，把它的体检结果刷到面板标题和状态栏。
  onHealthChange(getLlmHealth(activeId));
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return baseUrl;
  }
}

/**
 * 网页端密钥存放方式的开关。
 *
 * 这里不提供「加密保存」这种选项：密钥和解开它所需的一切都在同一个浏览器里，
 * 前端加密拦不住任何真正能读到存储的人，只会给用户虚假的安全感。
 * 真正有意义的区别只有「关掉标签页还在不在」，所以就只给这一个选择。
 */
function buildWebSecretPersistenceRow(): HTMLElement {
  const sessionOnly = getWebSecretPersistence() === 'session';
  const row = el('div', { class: 'settings-toggle-row' });
  const copy = el('div', { class: 'settings-toggle-copy' });
  copy.append(
    el('div', { class: 'settings-toggle-title', text: '仅本次会话保存密钥' }),
    el('div', {
      class: 'settings-toggle-desc',
      text: sessionOnly
        ? '关掉这个标签页密钥就没了，下次要重新填。适合公用电脑。'
        : '密钥会留在这台电脑上，关掉浏览器再打开还在。',
    }),
  );
  const toggle = el('input', {
    type: 'checkbox',
    role: 'switch',
    'aria-label': '仅本次会话保存密钥',
  });
  toggle.checked = sessionOnly;
  toggle.onchange = async () => {
    const requestedMode = toggle.checked ? 'session' : 'device';
    toggle.disabled = true;
    try {
      // 已填的密钥会被就地搬到新位置，用户不必重输
      await setWebSecretPersistence(requestedMode);
      toast(requestedMode === 'session' ? '密钥改为仅本次会话保存' : '密钥将保留在这台电脑上');
      const desc = copy.querySelector<HTMLElement>('.settings-toggle-desc');
      if (desc) {
        desc.textContent = requestedMode === 'session'
          ? '关掉这个标签页密钥就没了，下次要重新填。适合公用电脑。'
          : '密钥会留在这台电脑上，关掉浏览器再打开还在。';
      }
    } catch {
      toggle.checked = getWebSecretPersistence() === 'session';
      toast('密钥存放方式切换失败，请重试');
    } finally {
      toggle.disabled = false;
    }
  };
  row.append(copy, toggle);
  return row;
}

function aiConsentChip(): PanelChip {
  const count = getAiConsentRecords().length;
  return count > 0
    ? { text: `${count} 项授权`, tone: 'ok' }
    : { text: '首次询问', tone: 'muted' };
}

function renderAiConsentPanel(): HTMLElement {
  let panelElement!: HTMLElement;
  panelElement = panel({
    title: 'AI 外发授权',
    iconName: 'lock',
    chip: aiConsentChip(),
    renderBody: (body) => {
      body.append(
        el('div', {
          class: 'muted',
          text: '药盒、药单和用药信息会按“健康”类别授权；小助手对话和联网搜索按“助手”类别授权。同一服务商同一类别只会首次询问。',
        }),
        renderAiConsentControls(() => setChip(panelElement, aiConsentChip())),
      );
    },
  });
  return panelElement;
}

function renderAiConsentControls(onChanged: () => void): HTMLElement {
  const wrap = el('div', { class: 'ai-consent-controls' });
  const title = el('div', { class: 'section-title', html: '已授权的 AI 服务商' });
  const list = el('div', { class: 'ai-consent-list' });
  const clear = el('button', { class: 'btn text small', type: 'button', text: '撤销全部授权' });
  const render = () => {
    list.replaceChildren();
    const records = getAiConsentRecords();
    clear.hidden = records.length === 0;
    if (records.length === 0) {
      list.append(el('div', { class: 'muted', html: '尚未保存外发数据授权。首次识别或分析时会显示服务商域名。' }));
      return;
    }
    for (const record of records) {
      const row = el('div', { class: 'ai-consent-row' });
      const text = el('div');
      text.append(el('strong', { text: record.origin }));
      text.append(el('div', {
        class: 'muted',
        text: record.category === 'health'
          ? '吃药相关（药盒、药单、用药信息）'
          : '小助手对话与联网搜索',
      }));
      const revoke = el('button', { class: 'btn text small', type: 'button', text: '撤销' });
      revoke.onclick = () => {
        revokeAiConsent(record.origin, record.category);
        render();
        onChanged();
        toast('已撤销该服务商授权');
      };
      row.append(text, revoke);
      list.append(row);
    }
  };
  clear.onclick = () => {
    clearAiConsents();
    render();
    onChanged();
    toast('已撤销全部 AI 外发授权');
  };
  wrap.append(title, list, clear);
  render();
  return wrap;
}

