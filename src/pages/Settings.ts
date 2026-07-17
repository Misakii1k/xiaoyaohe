// 设置页（M1：本地数据概览 + 导出/导入；M2 云同步绑定；M3 系统通知 + 调度）
// 重构：三大配置卡（同步 / 通知 / AI）改成 iOS 折叠面板（默认收起，标题行带状态徽章 + 箭头）
import { listLogs, listMeds, listRules } from '../db/local';
import { listWorkEntries, listWorkProfiles, listWorkSettlements } from '../db/work';
import { Capacitor } from '@capacitor/core';
import { closeDialog, confirmDialog, el, renderPage, toast, icon, openDialog, type IconName } from '../ui/components';
import {
  backupProviders,
  buildBackup,
  previewBackupImport,
  type BackupPreviewResult,
  type BackupProvider,
} from '../tools/registry';
import {
  SyncV2Api,
  LegacyV1MigrationHelper,
  clearSyncV2PublicConfig,
  createLocalSyncV2Client,
  createPlatformSyncV2CredentialStore,
  getSyncV2PublicConfig,
  parsePairingCode,
  setSyncV2PublicConfig,
  type LocalSyncV2ClientBinding,
  type SyncDeviceSummary,
  type SyncV2PublicConfig,
  type SyncV2Role,
} from '../sync/v2';
import {
  notificationsSupported,
  getPermission,
  getExactAlarmCapability,
  isNativeReminderPlatform,
  requestPermission,
  requestExactAlarmCapability,
  showNotification,
} from '../features/notifier';
import { runOnce as runReminderOnce } from '../features/reminderScheduler';
import {
  getLlmConfig,
  setLlmConfig,
  resetLlmConfig,
  isUsingDefaultKey,
  listModels,
  pingLlm,
  getLlmHealth,
  setLlmHealth,
  DEFAULT_LLM_CONFIG,
  normalizeAndValidateBaseUrl,
  type LlmHealth,
} from '../ai/llmConfig';
import { isNativeSecretStore } from '../ai/secretStore';
import { getAsrConfig, setAsrConfig, resetAsrConfig } from '../ai/asr';
import { clearAiConsents, getAiConsentRecords, revokeAiConsent } from '../ai/consent';
import { assertBackupFileSize, parseSafeBackupPayload } from '../security/validation';

const SYNC_V2_UI_ENABLED = import.meta.env.VITE_SYNC_V2_ENABLED === 'true';
const settingsPageCleanupByRoot = new WeakMap<HTMLElement, () => void>();

interface SettingsRenderPart {
  element: HTMLElement;
  cleanup: () => void;
}

export async function renderSettingsPage(
  root: HTMLElement,
  signal?: AbortSignal,
): Promise<void | (() => void)> {
  const [meds, rules, logs, workProfiles, workEntries, workSettlements] = await Promise.all([
    listMeds(),
    listRules(),
    listLogs(),
    listWorkProfiles(),
    listWorkEntries(),
    listWorkSettlements(),
  ]);
  if (signal?.aborted) return;

  const content = el('div', { class: 'page page-light settings-page' });

  content.append(renderReminderPanel());
  const llmPanel = renderLlmPanel();
  content.append(llmPanel.element);
  content.append(renderAiConsentPanel());
  if (SYNC_V2_UI_ENABLED) content.append(renderSyncPanel(signal));

  const backupCard = renderBackupCard(root, signal, {
    meds: meds.length,
    rules: rules.length,
    logs: logs.length,
    work: workProfiles.length + workEntries.length + workSettlements.length,
  });
  content.append(backupCard.element);

  const about = el('section', { class: 'settings-about' });
  about.append(el('h2', { text: '关于' }));
  about.append(el('div', {
    class: 'muted',
    html: `日常工具箱 v${__APP_VERSION__}（本地优先版）。吃药提醒、药品管理和工时收入可离线使用；AI 与常见相互作用提示仅供参考，不替代医嘱。`,
  }));
  content.append(about);

  settingsPageCleanupByRoot.get(root)?.();
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    llmPanel.cleanup();
    backupCard.cleanup();
    signal?.removeEventListener('abort', cleanup);
    if (settingsPageCleanupByRoot.get(root) === cleanup) {
      settingsPageCleanupByRoot.delete(root);
    }
  };
  settingsPageCleanupByRoot.set(root, cleanup);
  signal?.addEventListener('abort', cleanup, { once: true });

  renderPage({ root, title: '设置', activeTab: 'settings', content });
  return cleanup;
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
  counts?: { meds: number; rules: number; logs: number; work: number },
): SettingsRenderPart {
  const io = el('section', { class: 'settings-section settings-data-card' });
  io.append(el('h2', { text: '本地数据与备份' }));
  if (counts) {
    io.append(el('div', {
      class: 'muted',
      html: `本机现有 ${counts.meds} 种药品、${counts.rules} 条提醒规则、${counts.logs} 条服药记录、${counts.work} 条工时数据。`,
    }));
  }
  io.append(el('div', {
    class: 'muted',
    html: '备份会完整包含以上数据。导入时按 id + 更新时间合并，不会清空本地数据。',
  }));

  const exportBtn = el('button', { class: 'btn tonal', html: '导出数据（JSON）', style: 'margin-top:12px' } as any);
  exportBtn.onclick = async () => {
    if (signal?.aborted) return;
    const data = await buildBackup();
    if (signal?.aborted) return;
    downloadJson(data, `medbox-backup-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const importBtn = el('button', { class: 'btn', html: '导入备份', style: 'margin-top:10px' } as any);
  const fileInput = el('input', {
    type: 'file',
    accept: 'application/json,.json',
    style: 'display:none',
  } as any) as HTMLInputElement;
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

  const row = el('div', { class: 'btn-row backup-actions' });
  row.append(exportBtn, importBtn);
  io.append(row, fileInput);
  return {
    element: io,
    cleanup: () => {
      exportBtn.onclick = null;
      importBtn.onclick = null;
      fileInput.onchange = null;
      fileInput.value = '';
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
  } as any);

  const head = el('button', { class: 'panel-head', type: 'button' } as any);
  const bodyId = `settings-panel-${++panelSeq}`;
  head.setAttribute('aria-expanded', String(Boolean(opts.defaultOpen)));
  head.setAttribute('aria-controls', bodyId);
  const lead = el('span', { class: 'panel-lead' } as any);
  lead.append(icon(opts.iconName, 'panel-icon'));
  lead.append(el('span', { class: 'panel-title', text: opts.title } as any));
  head.append(lead);

  const right = el('span', { class: 'panel-right' } as any);
  const chip = el('span', {
    class: 'panel-chip tone-' + opts.chip.tone,
    html: opts.chip.text,
  } as any);
  right.append(chip);
  const chevron = el('span', { class: 'panel-chevron' } as any);
  chevron.append(icon('arrow-left'));
  right.append(chevron);
  head.append(right);

  const body = el('div', { class: 'panel-body' } as any);
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

/** ---------------- 端到端加密家庭同步 v2 ---------------- */
function renderSyncPanel(signal?: AbortSignal): HTMLElement {
  const configured = getSyncV2PublicConfig() !== null;
  let p!: HTMLElement;
  p = panel({
    title: '加密家庭同步',
    iconName: 'cloud-check',
    chip: configured ? { text: '已配置', tone: 'ok' } : { text: '未配对', tone: 'muted' },
    renderBody: (body) => {
      queueMicrotask(() => void renderSyncV2Body(body, p, signal));
    },
  });
  return p;
}

async function renderSyncV2Body(body: HTMLElement, panelElement: HTMLElement, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  body.replaceChildren(el('div', { class: 'banner info', html: '正在读取本机同步状态…' }));
  const config = getSyncV2PublicConfig();
  if (signal?.aborted) return;

  const rerender = (): void => {
    if (signal?.aborted) return;
    void renderSyncV2Body(body, panelElement, signal);
  };
  body.replaceChildren();
  if (!config) {
    setChip(panelElement, { text: '未配对', tone: 'muted' });
    renderSyncV2Setup(body, rerender, signal);
    return;
  }
  setChip(panelElement, { text: '已配置', tone: 'ok' });
  await renderSyncV2Configured(body, config, rerender, signal);
}

function renderSyncV2Setup(body: HTMLElement, rerender: () => void, signal?: AbortSignal): void {
  body.append(
    el('div', { class: 'banner info' } as any, [
      el('span', { html: '同步内容在本机加密后上传，服务端只能看到密文和修订元数据。工时与收入不会进入同步载荷。' }),
    ]),
  );

  const endpoint = el('input', {
    type: 'url',
    inputMode: 'url',
    required: true,
    autocomplete: 'url',
    placeholder: 'https://sync.example.com',
    value: import.meta.env.VITE_SYNC_V2_ENDPOINT ?? '',
  } as any) as HTMLInputElement;
  const deviceName = el('input', {
    type: 'text',
    required: true,
    maxlength: 80,
    autocomplete: 'off',
    placeholder: '例如：妈妈的手机',
    value: '我的手机',
  } as any) as HTMLInputElement;
  body.append(field('同步服务 HTTPS 地址', endpoint), field('本设备名称', deviceName));
  body.append(el('div', {
    class: 'muted sync-v2-origin-note',
    html: '如果提示 Origin 不允许，请把本应用的完整 Origin 加入 Worker 的 SYNC_V2_ALLOWED_ORIGINS；协议、域名和端口必须完全一致。Android App 通常是 https://localhost，PWA 使用当前网页的 Origin。',
  }));

  let role: SyncV2Role = 'caregiver';
  const roleControl = createRoleControl(role, (next) => { role = next; });
  body.append(field('家庭角色', roleControl));

  const createButton = el('button', { class: 'btn', type: 'button', html: '创建加密家庭' } as any);
  createButton.onclick = () => void runButtonAction(createButton, async () => {
    const api = new SyncV2Api(endpoint.value.trim());
    const binding = createLocalSyncV2Client({ api });
    const created = await binding.createHousehold(deviceName.value.trim(), { signal });
    setSyncV2PublicConfig({
      endpoint: created.endpoint,
      householdId: created.householdId,
      deviceName: deviceName.value.trim(),
      role,
    });
    await showProtectedValueDialog(
      '保存家庭恢复码',
      '恢复码可解密家庭健康数据，服务端无法找回。请离线保存，不要发给无关人员。',
      created.recoveryCode,
      '恢复码',
    );
    rerender();
  });
  body.append(el('div', { class: 'btn-row sync-v2-actions' }, [createButton]));

  const divider = el('div', { class: 'settings-divider', html: '或使用另一台设备生成的一次性邀请' });
  const invitation = el('textarea', {
    rows: 4,
    maxlength: 4096,
    autocomplete: 'off',
    spellcheck: false,
    placeholder: 'medbox-sync-v2://pair?...',
  } as any) as HTMLTextAreaElement;
  body.append(divider, field('一次性配对邀请', invitation));
  const pairButton = el('button', { class: 'btn tonal', type: 'button', html: '配对本设备' } as any);
  pairButton.onclick = () => void runButtonAction(pairButton, async () => {
    const parsed = await parsePairingCode(invitation.value);
    const binding = createLocalSyncV2Client({ api: new SyncV2Api(parsed.endpoint) });
    const paired = await binding.pairDevice(invitation.value, deviceName.value.trim(), { signal });
    setSyncV2PublicConfig({
      endpoint: paired.endpoint,
      householdId: paired.householdId,
      deviceName: deviceName.value.trim(),
      role,
    });
    toast('配对成功，正在准备首次同步');
    rerender();
  });
  body.append(el('div', { class: 'btn-row sync-v2-actions' }, [pairButton]));

  if (!Capacitor.isNativePlatform()) {
    body.append(el('div', {
      class: 'muted sync-v2-session-note',
      html: 'PWA 不持久化设备令牌或数据密钥。刷新或关闭页面后，需要由仍在线的家庭设备重新生成一次性邀请。',
    }));
  }
}

async function renderSyncV2Configured(
  body: HTMLElement,
  config: SyncV2PublicConfig,
  rerender: () => void,
  signal?: AbortSignal,
): Promise<void> {
  const credentialStore = createPlatformSyncV2CredentialStore();
  const binding = createLocalSyncV2Client({
    api: new SyncV2Api(config.endpoint),
    credentialStore,
    householdId: config.householdId,
  });
  try {
    await binding.useHousehold(config.householdId);
  } catch (error) {
    body.append(el('div', { class: 'banner warn', html: '本机同步状态不完整：' + errorMessage(error) }));
    body.append(forgetSyncV2Button(binding, rerender));
    return;
  }

  const credentials = await credentialStore.load(config.householdId);
  const queued = await binding.client.listQueuedMutations();
  const conflicts = queued.filter((item) => item.status === 'conflict').length;
  const rejected = queued.filter((item) => item.status === 'rejected').length;
  let stagedCount = 0;
  if (credentials) stagedCount = (await binding.client.listStagedChanges()).length;

  const summary = el('div', { class: 'list-item sync-v2-summary' }, [
    el('div', { class: 'grow' }, [
      el('div', { class: 'name', html: config.deviceName }),
      el('div', { class: 'muted sync-v2-id', html: config.householdId }),
    ]),
    el('span', { class: 'slot-tag', html: config.role === 'caregiver' ? '照护者' : '患者' }),
  ]);
  body.append(summary);

  const status = el('div', {
    class: credentials ? (conflicts || rejected ? 'banner warn' : 'banner ok') : 'banner warn',
    html: credentials
      ? `待发送 ${queued.filter((item) => item.status === 'pending').length}，冲突 ${conflicts}，拒绝 ${rejected}，暂存 ${stagedCount}`
      : '当前浏览器会话已失去加密凭证，不能同步。请使用另一台已配对设备生成新邀请。',
  });
  body.append(status);

  if (!Capacitor.isNativePlatform()) {
    body.append(el('div', {
      class: 'muted sync-v2-session-note',
      html: 'PWA 的设备令牌和数据密钥仅保留在当前会话；刷新或关闭页面后需要重新配对。公开的服务地址、家庭编号和设备名称会保留。',
    }));
  }

  if (!credentials) {
    renderSyncV2Repair(body, config, rerender, signal);
    body.append(forgetSyncV2Button(binding, rerender));
    return;
  }

  const actions = el('div', { class: 'btn-row sync-v2-actions' });
  const syncButton = el('button', { class: 'btn', type: 'button', html: '立即同步' } as any);
  syncButton.onclick = () => void runButtonAction(syncButton, async () => {
    const result = await binding.sync({ signal });
    if (result.status === 'offline') {
      toast(`当前离线，${result.pendingCount} 项变更留待重试`);
    } else if (result.conflicts.length || result.rejected.length) {
      toast(`同步完成，但有 ${result.conflicts.length} 个冲突、${result.rejected.length} 个拒绝项`, 4200);
    } else {
      toast(`同步完成，云端修订 ${result.householdRevision}`);
    }
    rerender();
  });
  const inviteButton = el('button', { class: 'btn tonal', type: 'button', html: '生成一次性邀请' } as any);
  inviteButton.onclick = () => void runButtonAction(inviteButton, async () => {
    const invitation = await binding.createPairingInvitation({ signal });
    const expiry = new Date(invitation.expiresAt).toLocaleString('zh-CN');
    await showProtectedValueDialog(
      '一次性配对邀请',
      `邀请将在 ${expiry} 失效，使用一次后立即作废。链接片段内含解密材料，请只发给家庭成员。`,
      invitation.pairingUri,
      '配对邀请',
    );
  });
  actions.append(syncButton, inviteButton);
  body.append(actions);

  const deviceArea = el('div', { class: 'sync-v2-devices' });
  const devicesButton = el('button', { class: 'btn tonal', type: 'button', html: '管理家庭设备' } as any);
  devicesButton.onclick = () => void runButtonAction(devicesButton, async () => {
    await renderSyncV2Devices(deviceArea, binding, signal);
  });
  const rotateButton = el('button', { class: 'btn tonal', type: 'button', html: '轮换本机令牌' } as any);
  rotateButton.onclick = () => void runButtonAction(rotateButton, async () => {
    await binding.client.rotateCurrentDeviceToken({ signal });
    toast('本机设备令牌已轮换，旧令牌立即失效');
  });
  body.append(el('div', { class: 'btn-row sync-v2-actions' }, [devicesButton, rotateButton]), deviceArea);
  const migrateButton = el('button', {
    class: 'btn text',
    type: 'button',
    html: '从旧版只读同步迁移',
  } as any);
  migrateButton.onclick = () => openLegacyMigrationDialog(binding, rerender, signal);
  body.append(migrateButton);
  body.append(forgetSyncV2Button(binding, rerender));
}

function openLegacyMigrationDialog(
  binding: LocalSyncV2ClientBinding,
  rerender: () => void,
  routeSignal?: AbortSignal,
): void {
  const title = el('h3', { html: '迁移旧版云端数据' });
  const note = el('div', {
    class: 'banner warn',
    html: '只是把旧版云端存的药品资料搬过来，核对没问题才写入现在的家庭空间。上班和收入的记录不会搬，旧数据也不会被删。',
  });
  const endpoint = el('input', {
    type: 'url',
    inputMode: 'url',
    required: true,
    autocomplete: 'url',
    placeholder: '旧 Worker 的 HTTPS 地址',
  } as any) as HTMLInputElement;
  const household = el('input', {
    type: 'text',
    required: true,
    maxlength: 64,
    autocomplete: 'off',
    placeholder: '旧版共享空间编号',
  } as any) as HTMLInputElement;
  const secret = el('input', {
    type: 'password',
    required: true,
    maxlength: 512,
    autocomplete: 'off',
    placeholder: '仅本次迁移使用',
  } as any) as HTMLInputElement;
  const acknowledgement = el('input', { type: 'checkbox' } as any) as HTMLInputElement;
  acknowledgement.id = `legacy-migration-confirm-${++settingsFieldSeq}`;
  acknowledgement.name = acknowledgement.id;
  const acknowledgementRow = el('label', { class: 'sync-v2-migration-confirm', htmlFor: acknowledgement.id } as any);
  acknowledgementRow.append(
    acknowledgement,
    el('span', { html: '我已确认旧 Worker 仅临时开启只读迁移，并会在数量和摘要核对成功后关闭 v1。' }),
  );
  const report = el('div', { class: 'sync-v2-migration-report', role: 'status', 'aria-live': 'polite' } as any);
  const migrate = el('button', { class: 'btn', type: 'button', html: '读取、加密并核对' } as any);
  const close = el('button', { class: 'btn text', type: 'button', html: '关闭' } as any);
  const card = el('div', { class: 'card sync-v2-migration-dialog' }, [
    title,
    note,
    field('旧 Worker 地址', endpoint),
    field('旧版共享空间', household),
    field('旧版迁移密钥', secret),
    acknowledgementRow,
    report,
    el('div', { class: 'btn-row' }, [close, migrate]),
  ]);
  const controller = new AbortController();
  const abortFromRoute = (): void => controller.abort(routeSignal?.reason);
  if (routeSignal?.aborted) abortFromRoute();
  else routeSignal?.addEventListener('abort', abortFromRoute, { once: true });
  let overlay: HTMLElement;
  const cleanup = (): void => {
    controller.abort();
    routeSignal?.removeEventListener('abort', abortFromRoute);
    secret.value = '';
  };
  overlay = openDialog(card, { initialFocus: endpoint, onClose: cleanup });
  close.onclick = () => closeDialog(overlay);
  migrate.onclick = () => void runButtonAction(migrate, async () => {
    if (!acknowledgement.checked) throw new Error('请先确认只读迁移和核对要求。');
    report.className = 'sync-v2-migration-report banner info';
    report.textContent = '正在读取旧快照并写入加密家庭…';
    const helper = new LegacyV1MigrationHelper(
      binding.client,
      undefined,
      async (run) => {
        for (const change of run.confirmedChanges) await binding.adapter.applyRemoteChange(change);
        await binding.adapter.consumeRunResult(run);
      },
    );
    const result = await helper.migrate({
      endpoint: endpoint.value.trim(),
      household: household.value.trim(),
      secret: secret.value,
      signal: controller.signal,
    });
    secret.value = '';
    report.className = `sync-v2-migration-report banner ${result.canDisableV1 ? 'ok' : 'warn'}`;
    report.textContent = [
      `药品 ${result.sourceCounts.medications}，计划 ${result.sourceCounts.schedules}，服药记录 ${result.sourceCounts.intakes}`,
      `忽略 pending 记录 ${result.sourceCounts.omittedPendingIntakes}`,
      `实体核对 ${result.verifiedEntityCount}/${result.expectedEntityCount}`,
      `期望摘要 ${result.expectedDigest}`,
      `实测摘要 ${result.verifiedDigest}`,
      result.canDisableV1
        ? '数量与摘要一致。现在可以在 Worker 中关闭 v1 只读开关。旧数据未被删除。'
        : `尚不可关闭 v1：待处理 ${result.pendingMutationIds.length}，冲突 ${result.conflictMutationIds.length}，拒绝 ${result.rejectedMutationIds.length}。`,
    ].join('\n');
    report.style.whiteSpace = 'pre-wrap';
    rerender();
  });
}

function renderSyncV2Repair(
  body: HTMLElement,
  config: SyncV2PublicConfig,
  rerender: () => void,
  signal?: AbortSignal,
): void {
  const invitation = el('textarea', {
    rows: 4,
    maxlength: 4096,
    autocomplete: 'off',
    spellcheck: false,
    placeholder: '粘贴新的一次性配对邀请',
  } as any) as HTMLTextAreaElement;
  body.append(field('重新配对邀请', invitation));
  const pairButton = el('button', { class: 'btn', type: 'button', html: '重新配对当前浏览器' } as any);
  pairButton.onclick = () => void runButtonAction(pairButton, async () => {
    const parsed = await parsePairingCode(invitation.value);
    if (parsed.householdId !== config.householdId) throw new Error('邀请属于另一个家庭空间。');
    const binding = createLocalSyncV2Client({ api: new SyncV2Api(parsed.endpoint) });
    const paired = await binding.pairDevice(invitation.value, config.deviceName, { signal });
    setSyncV2PublicConfig({ ...config, endpoint: paired.endpoint });
    toast('本次浏览器会话已重新配对');
    rerender();
  });
  body.append(el('div', { class: 'btn-row sync-v2-actions' }, [pairButton]));
}

async function renderSyncV2Devices(
  container: HTMLElement,
  binding: LocalSyncV2ClientBinding,
  signal?: AbortSignal,
): Promise<void> {
  const result = await binding.client.listDevices({ signal });
  container.replaceChildren(el('h4', { html: '家庭设备' }));
  for (const device of result.devices) {
    const isCurrent = device.id === result.authenticatedDeviceId;
    const row = el('div', { class: 'list-item sync-v2-device' }, [
      el('div', { class: 'grow' }, [
        el('div', { class: 'name', html: device.name }),
        el('div', {
          class: 'muted',
          html: device.revokedAt ? '已撤销' : `加入于 ${formatTimestamp(device.createdAt)}`,
        }),
      ]),
    ]);
    if (isCurrent) {
      row.append(el('span', { class: 'slot-tag', html: '本机' }));
    } else if (!device.revokedAt) {
      row.append(revokeDeviceButton(device, binding, container, signal));
    }
    container.append(row);
  }
}

function revokeDeviceButton(
  device: SyncDeviceSummary,
  binding: LocalSyncV2ClientBinding,
  container: HTMLElement,
  signal?: AbortSignal,
): HTMLButtonElement {
  const button = el('button', {
    class: 'btn text small',
    type: 'button',
    html: '撤销',
    'aria-label': `撤销设备 ${device.name}`,
  } as any);
  button.onclick = () => void runButtonAction(button, async () => {
    if (!await confirmDialog(`撤销设备“${device.name}”？该设备的令牌会立即失效。`, '撤销', true)) return;
    await binding.client.revokeDevice(device.id, { signal });
    toast('设备已撤销');
    await renderSyncV2Devices(container, binding, signal);
  });
  return button;
}

function forgetSyncV2Button(
  binding: LocalSyncV2ClientBinding,
  rerender: () => void,
): HTMLButtonElement {
  const button = el('button', {
    class: 'btn text sync-v2-forget',
    type: 'button',
    html: '忘记此家庭',
  } as any);
  button.onclick = () => void runButtonAction(button, async () => {
    const confirmed = await confirmDialog(
      '忘记此家庭只会移除本设备的连接和密钥，本机药品与服药记录不会删除。',
      '忘记家庭',
      true,
    );
    if (!confirmed) return;
    await binding.forgetHousehold();
    clearSyncV2PublicConfig();
    toast('已忘记家庭连接，本机业务数据仍保留');
    rerender();
  });
  return button;
}

function createRoleControl(initial: SyncV2Role, onChange: (role: SyncV2Role) => void): HTMLElement {
  const control = el('div', { class: 'chips sync-role-control', role: 'group', 'aria-label': '家庭角色' } as any);
  const caregiver = el('button', { class: 'chip', type: 'button', html: '照护者' } as any);
  const patient = el('button', { class: 'chip', type: 'button', html: '患者' } as any);
  const update = (role: SyncV2Role): void => {
    caregiver.classList.toggle('on', role === 'caregiver');
    patient.classList.toggle('on', role === 'patient');
    caregiver.setAttribute('aria-pressed', String(role === 'caregiver'));
    patient.setAttribute('aria-pressed', String(role === 'patient'));
    onChange(role);
  };
  caregiver.onclick = () => update('caregiver');
  patient.onclick = () => update('patient');
  control.append(caregiver, patient);
  update(initial);
  return control;
}

async function runButtonAction(button: HTMLButtonElement, action: () => Promise<void>): Promise<void> {
  if (button.disabled) return;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    await action();
  } catch (error) {
    toast(errorMessage(error), 4200);
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

async function showProtectedValueDialog(
  titleText: string,
  description: string,
  value: string,
  valueLabel: string,
): Promise<void> {
  const title = el('h3', { html: titleText });
  const descriptionElement = el('div', { class: 'muted', html: description });
  const valueArea = el('textarea', {
    class: 'protected-value',
    readOnly: true,
    rows: 5,
    value,
    'aria-label': valueLabel,
  } as any) as HTMLTextAreaElement;
  const copy = el('button', { class: 'btn tonal', type: 'button', html: '复制' } as any);
  const done = el('button', { class: 'btn', type: 'button', html: '已保存，关闭' } as any);
  const card = el('div', { class: 'card protected-value-dialog' }, [
    title,
    descriptionElement,
    valueArea,
    el('div', { class: 'btn-row' }, [copy, done]),
  ]);
  let overlay: HTMLElement | null = null;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (closedByDialog = false): void => {
      if (settled) return;
      settled = true;
      if (overlay && !closedByDialog) closeDialog(overlay);
      resolve();
    };
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(value);
        toast('已复制');
      } catch {
        valueArea.focus();
        valueArea.select();
        toast('无法自动复制，已选中内容');
      }
    };
    done.onclick = () => finish();
    overlay = openDialog(card, { onClose: () => finish(true), initialFocus: copy });
  });
}

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (/credentials are unavailable|browser session ended/i.test(error.message)) {
      return '浏览器会话凭证已失效，请重新配对。';
    }
    return error.message;
  }
  return String(error);
}

/** ---------------- 通知面板 ---------------- */
function renderReminderPanel(): HTMLElement {
  const perm = notificationsSupported() ? getPermission() : 'denied';
  const chip: PanelChip = !notificationsSupported()
    ? { text: '不支持', tone: 'warn' }
    : perm === 'granted'
      ? { text: '已开启', tone: 'ok' }
      : perm === 'denied'
        ? { text: '被拒绝', tone: 'warn' }
        : { text: '未开启', tone: 'muted' };
  const p = panel({
    title: '系统通知',
    iconName: 'bell-ring',
    chip,
    renderBody: (body) => buildReminderBody(body, () => {
      body.replaceChildren();
      buildReminderBody(body, () => {});
      const perm2 = notificationsSupported() ? getPermission() : 'denied';
      const c: PanelChip = !notificationsSupported()
        ? { text: '不支持', tone: 'warn' }
        : perm2 === 'granted'
          ? { text: '已开启', tone: 'ok' }
          : perm2 === 'denied'
            ? { text: '被拒绝', tone: 'warn' }
            : { text: '未开启', tone: 'muted' };
      setChip(p, c);
    }),
  });
  return p;
}

function buildReminderBody(body: HTMLElement, rerender: () => void): void {
  if (!notificationsSupported()) {
    body.append(
      el('div', { class: 'banner warn' } as any, [
        el('span', { html: '当前浏览器不支持系统通知。建议在手机 Chrome / Safari 中"添加到主屏"后使用。' }),
      ])
    );
    return;
  }

  const perm = getPermission();
  const cls = perm === 'granted' ? 'ok' : perm === 'denied' ? 'warn' : 'info';
  const text = perm === 'granted'
    ? '已授权。Android 应用使用原生调度；PWA 受浏览器后台限制。'
    : perm === 'denied'
      ? '通知被拒绝。请到浏览器/系统设置里手动允许通知。'
      : '未开启。PWA 通知只能尽力送达，关闭浏览器后无法保证。';
  body.append(
    el('div', { class: 'banner ' + cls } as any, [el('span', { html: text })])
  );

  const row = el('div', { class: 'btn-row', style: 'margin-top:12px' } as any);
  if (perm !== 'granted') {
    const grantBtn = el('button', { class: 'btn', html: '开启系统通知' });
    grantBtn.onclick = async () => {
      const r = await requestPermission();
      if (r === 'granted') toast('已开启 ✓');
      else if (r === 'denied') toast('被拒绝，请在系统设置里开');
      else toast('未授权');
      rerender();
    };
    row.append(grantBtn);
  } else {
    const testBtn = el('button', { class: 'btn', html: '发送测试通知' });
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
  }
  body.append(row);

  if (perm === 'granted' && isNativeReminderPlatform()) {
    const exactAlarm = getExactAlarmCapability();
    if (exactAlarm !== 'granted') {
      const message = exactAlarm === 'unavailable'
        ? '当前系统无法确认精确闹钟能力，提醒可能有数分钟延迟。'
        : '精确闹钟尚未允许；Android 仍会安排提醒，但可能延迟送达。';
      body.append(
        el('div', { class: 'banner warn', style: 'margin-top:12px' } as any, [
          el('span', { html: message }),
        ]),
      );
      if (exactAlarm !== 'unavailable') {
        const exactRow = el('div', { class: 'btn-row', style: 'margin-top:12px' } as any);
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
  }

  body.append(
    el('div', {
      class: 'muted',
      style: 'margin-top:12px;font-size:13px;line-height:1.55',
      html:
        '提醒能力：\n· Android 安装版使用原生本地通知，需允许通知和精确闹钟。\n' +
        '· PWA 仅在浏览器允许的前台/后台时尽力提醒，关闭后不保证送达。\n' +
        '· 回到应用时会立即补算未处理的任务。',
    } as any)
  );
}

/** ---------------- AI 大模型面板（支持模型自动检测 + 状态） ---------------- */
function renderLlmPanel(): SettingsRenderPart {
  const initialHealth = getLlmHealth();
  const chip = healthToChip(initialHealth);
  const p = panel({
    title: 'AI 服务商',
    iconName: 'sparkles',
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
      html: '在「编辑药品」里用一句话描述，AI 自动填写药名、规格、用量、时段、提醒时间。',
    })
  );

  const cfg = getLlmConfig();
  const missingKey = isUsingDefaultKey();
  if (missingKey) {
    body.append(
      el('div', { class: 'banner info', style: 'margin-top:10px' } as any, [
        el('span', {
          html: '还没填 AI 密钥。手机 App 里会替您安全保管；网页版为了安全，每次重新打开都要再填一次。',
        }),
      ])
    );
  }

  // ====== 表单 ======
  const urlIn = el('input', {
    type: 'url',
    value: cfg.baseUrl,
    placeholder: 'OpenAI 兼容地址，如 https://api.openai.com/v1',
    style: 'margin-top:10px',
  } as any) as HTMLInputElement;
  body.append(field('API 地址', urlIn));

  const keyWrap = el('div', { style: 'position:relative' } as any);
  const keyIn = el('input', {
    type: 'password',
    value: cfg.apiKey,
    placeholder: 'sk-...',
    style: 'padding-right:64px',
  } as any) as HTMLInputElement;
  const toggleKey = el('button', {
    class: 'key-toggle',
    type: 'button',
    html: '显示',
  } as any);
  let visible = false;
  toggleKey.onclick = () => {
    visible = !visible;
    keyIn.type = visible ? 'text' : 'password';
    toggleKey.textContent = visible ? '隐藏' : '显示';
  };
  keyWrap.append(keyIn, toggleKey);
  body.append(field('API 密钥', keyWrap));

  // 模型：下拉 + 刷新；不通时回退为文本框
  const modelRow = el('div', { class: 'model-row' } as any);
  const modelSel = el('select', { class: 'model-select' } as any) as HTMLSelectElement;
  const modelIn = el('input', {
    type: 'text',
    value: cfg.model,
    placeholder: '模型名，如 gpt-4o-mini',
    style: 'display:none',
  } as any) as HTMLInputElement;
  const refreshBtn = el('button', {
    class: 'btn tonal small',
    type: 'button',
    html: '刷新',
  } as any);

  const modelControlSeq = ++settingsFieldSeq;
  modelSel.id = `settings-model-select-${modelControlSeq}`;
  modelSel.name = modelSel.id;
  modelIn.id = `settings-model-input-${modelControlSeq}`;
  modelIn.name = modelIn.id;
  modelRow.append(modelSel, modelIn, refreshBtn);
  const modelField = field('模型', modelRow);
  const modelLabel = modelField.querySelector<HTMLLabelElement>('label')!;
  body.append(modelField);

  // 状态横条
  const statusBar = el('div', { class: 'llm-status' } as any);
  body.append(statusBar);

  // === 初始填充：用持久化的健康检查结果 ===
  const persisted = getLlmHealth();
  populateModelControl(modelSel, modelIn, modelLabel, persisted.models, cfg.model);
  applyHealthBar(statusBar, persisted);

  refreshBtn.onclick = async () => {
    refreshBtn.setAttribute('disabled', 'true');
    refreshBtn.textContent = '检测中…';
    const tmpCfg = {
      baseUrl: urlIn.value.trim() || cfg.baseUrl,
      apiKey: keyIn.value.trim() || cfg.apiKey,
      model: getCurrentModel(modelSel, modelIn) || cfg.model,
    };
    try {
      const models = await listModels(tmpCfg);
      populateModelControl(modelSel, modelIn, modelLabel, models, tmpCfg.model);
      const h: LlmHealth = {
        state: 'ok',
        message: `已连接 · ${models.length} 个模型`,
        at: Date.now(),
        models,
      };
      setLlmHealth(h);
      applyHealthBar(statusBar, h);
      onHealthChange(h);
      toast('已拉到 ' + models.length + ' 个模型');
    } catch (e) {
      const h: LlmHealth = {
        state: 'error',
        message: e instanceof Error ? e.message : String(e),
        at: Date.now(),
      };
      setLlmHealth(h);
      applyHealthBar(statusBar, h);
      onHealthChange(h);
      // 拉不到列表，让用户手动填
      populateModelControl(modelSel, modelIn, modelLabel, [], tmpCfg.model);
      toast('拉模型失败：' + h.message);
    } finally {
      refreshBtn.removeAttribute('disabled');
      refreshBtn.textContent = '刷新';
    }
  };

  // ====== 语音识别（选填）：说话录药 / 小助手说话 ======
  const asrCfg = getAsrConfig();
  body.append(el('div', { class: 'section-title', style: 'margin-top:16px', html: '语音识别（选填）' } as any));
  body.append(
    el('div', {
      class: 'muted',
      html: '腾讯云「一句话识别」（≤60 秒）。小助手按住说话、说话录药都会用。填 AppId + SecretId + SecretKey；一句话识别按次计费，不是实时流式 5 小时套餐。',
    })
  );

  const asrAppIdIn = el('input', {
    type: 'text',
    inputmode: 'numeric',
    value: asrCfg.appId,
    placeholder: '腾讯云 APPID（纯数字）',
    style: 'margin-top:10px',
  } as any) as HTMLInputElement;
  body.append(field('AppId', asrAppIdIn));

  const asrIdIn = el('input', {
    type: 'text',
    value: asrCfg.secretId,
    placeholder: '以 AKID 开头',
  } as any) as HTMLInputElement;
  body.append(field('SecretId', asrIdIn));

  const asrKeyWrap = el('div', { style: 'position:relative' } as any);
  const asrKeyIn = el('input', {
    type: 'password',
    value: asrCfg.secretKey,
    placeholder: '创建密钥时记下的 SecretKey',
    style: 'padding-right:64px',
  } as any) as HTMLInputElement;
  const asrToggleKey = el('button', {
    class: 'key-toggle',
    type: 'button',
    html: '显示',
  } as any);
  let asrKeyVisible = false;
  asrToggleKey.onclick = () => {
    asrKeyVisible = !asrKeyVisible;
    asrKeyIn.type = asrKeyVisible ? 'text' : 'password';
    asrToggleKey.textContent = asrKeyVisible ? '隐藏' : '显示';
  };
  asrKeyWrap.append(asrKeyIn, asrToggleKey);
  body.append(field('SecretKey', asrKeyWrap));

  // ====== 操作行 ======
  const row = el('div', { class: 'btn-row', style: 'margin-top:12px' } as any);
  const save = el('button', { class: 'btn', html: '保存' });
  save.onclick = async () => {
    const baseUrl = urlIn.value.trim();
    const apiKey = keyIn.value.trim();
    const model = getCurrentModel(modelSel, modelIn);
    try {
      normalizeAndValidateBaseUrl(baseUrl);
    } catch (e) {
      return toast(e instanceof Error ? e.message : '请填写正确的 HTTPS API 地址');
    }
    if (!apiKey) return toast('请填写 API 密钥');
    if (!model) return toast('请填写或选择模型');
    const asrAppId = asrAppIdIn.value.trim();
    const asrSecretId = asrIdIn.value.trim();
    const asrSecretKey = asrKeyIn.value.trim();
    const asrFilled = [asrAppId, asrSecretId, asrSecretKey].filter(Boolean).length;
    if (asrFilled > 0 && asrFilled < 3) {
      return toast('语音识别要 AppId、SecretId、SecretKey 三项都填，或都留空');
    }
    if (asrAppId && !/^\d+$/.test(asrAppId)) {
      return toast('语音识别的 AppId 应该是纯数字');
    }
    await setLlmConfig({ baseUrl, apiKey, model });
    await setAsrConfig({ appId: asrAppId, secretId: asrSecretId, secretKey: asrSecretKey });
    toast('已保存 ✓');
    // 保存后顺手体检一次
    const h = await pingLlm({ baseUrl, apiKey, model });
    setLlmHealth(h);
    applyHealthBar(statusBar, h);
    onHealthChange(h);
  };
  const test = el('button', { class: 'btn tonal', html: '测试连接' });
  test.onclick = async () => {
    test.setAttribute('disabled', 'true');
    test.textContent = '测试中…';
    try {
      const h = await pingLlm({
        baseUrl: urlIn.value.trim() || cfg.baseUrl,
        apiKey: keyIn.value.trim() || cfg.apiKey,
        model: getCurrentModel(modelSel, modelIn) || cfg.model,
      });
      setLlmHealth(h);
      applyHealthBar(statusBar, h);
      onHealthChange(h);
      toast(h.state === 'ok' ? '连接成功 ✓' : '失败：' + h.message);
    } finally {
      test.removeAttribute('disabled');
      test.textContent = '测试连接';
    }
  };
  row.append(save, test);
  body.append(row);

  if (!missingKey) {
    const reset = el('button', {
      class: 'btn text',
      html: '清空这些设置，恢复原样',
      style: 'margin-top:8px',
    } as any);
    reset.onclick = async () => {
      await resetLlmConfig();
      await resetAsrConfig();
      toast('已恢复默认');
      // 重建 body
      body.replaceChildren();
      buildLlmBody(body, onHealthChange);
    };
    body.append(reset);
  }

  body.append(
    el('div', {
      class: 'muted',
      style: 'margin-top:12px;font-size:13px;line-height:1.55',
      html:
        '· 接口需兼容 OpenAI /chat/completions 协议。\n' +
        `· 默认模型 ${DEFAULT_LLM_CONFIG.model}，也可换成其他兼容模型。\n` +
        `· ${isNativeSecretStore() ? 'Android 密钥保存在系统安全存储中。' : 'PWA 密钥仅保留当前会话，刷新后清除。'}`,
    } as any)
  );
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
    iconName: 'shield',
    chip: aiConsentChip(),
    renderBody: (body) => {
      body.append(
        el('div', {
          class: 'muted',
          text: '药盒、药单和用药信息会按“健康”类别授权；工资、班次和收入按“工时”类别单独授权。同一服务商同一类别只会首次询问。',
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
  const clear = el('button', { class: 'btn text small', type: 'button', text: '撤销全部授权' } as any);
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
          : record.category === 'work'
            ? '上班相关（工资、班次和收入）'
            : '小助手对话（可能带上吃药和上班记录）',
      }));
      const revoke = el('button', { class: 'btn text small', type: 'button', text: '撤销' } as any);
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

/** 把模型列表填到 select；列表为空时回退到 input。 */
function populateModelControl(
  sel: HTMLSelectElement,
  input: HTMLInputElement,
  label: HTMLLabelElement,
  models: string[] | undefined,
  current: string,
): void {
  const list = models || [];
  if (list.length === 0) {
    // 回退手填
    sel.style.display = 'none';
    input.style.display = '';
    label.htmlFor = input.id;
    if (current) input.value = current;
    return;
  }
  sel.style.display = '';
  input.style.display = 'none';
  label.htmlFor = sel.id;
  sel.replaceChildren();
  const has = list.includes(current);
  if (!has && current) {
    const op = el('option', { value: current, html: current + '（自定义）' } as any);
    sel.append(op);
  }
  for (const m of list) {
    const op = el('option', { value: m, html: m } as any);
    if (m === current) op.selected = true;
    sel.append(op);
  }
  if (!has && current) sel.value = current;
}

function getCurrentModel(sel: HTMLSelectElement, input: HTMLInputElement): string {
  if (sel.style.display !== 'none') return sel.value.trim();
  return input.value.trim();
}

function applyHealthBar(bar: HTMLElement, h: LlmHealth): void {
  const cls = h.state === 'ok' ? 'ok' : h.state === 'error' ? 'warn' : 'info';
  const t = h.at ? new Date(h.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
  const text = h.state === 'ok'
    ? `${h.message}${t ? '（' + t + '）' : ''}`
    : h.state === 'error'
      ? `连接失败：${h.message}${t ? '（' + t + '）' : ''}`
      : '尚未检测连接，点「测试连接」或「刷新」';
  bar.className = 'llm-status banner ' + cls;
  bar.replaceChildren();
  bar.append(el('span', { html: text }));
}

let settingsFieldSeq = 0;
function field(label: string, input: HTMLElement): HTMLElement {
  const f = el('div', { class: 'field' });
  const control = input.matches('input,select,textarea')
    ? input
    : input.querySelector<HTMLElement>('input,select,textarea');
  const labelEl = el('label', { html: label });
  if (control) {
    const id = control.id || `settings-field-${++settingsFieldSeq}`;
    control.id = id;
    if (!control.getAttribute('name')) control.setAttribute('name', id);
    labelEl.htmlFor = id;
  } else if (input.getAttribute('role') === 'group') {
    labelEl.id = `settings-field-label-${++settingsFieldSeq}`;
    input.setAttribute('aria-labelledby', labelEl.id);
  }
  f.append(labelEl);
  f.append(input);
  return f;
}
