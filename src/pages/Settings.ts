// Android 设置页：系统提醒、AI、局域网家庭同步、本地备份和应用信息。
// 主要配置使用折叠面板，默认收起并在标题行显示当前状态。
import { listLogs, listMeds, listRules } from '../db/local';
import { confirmDialog, el, renderPage, toast, icon, type IconName } from '../ui/components';
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
  isAppNotificationsEnabled,
  setAppNotificationsEnabled,
} from '../features/notificationPreference';
import { runOnce as runReminderOnce, rescheduleMedicationReminders } from '../features/reminderScheduler';
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
import { getAsrHealth, isNativeSpeechFallbackAvailable } from '../ai/asr';
import { clearAsrConfig, getAsrConfig, isAsrCredentialsConfigured, setAsrConfig } from '../ai/asrConfig';
import { clearAiConsents, getAiConsentRecords, revokeAiConsent } from '../ai/consent';
import { assertBackupFileSize, parseSafeBackupPayload } from '../security/validation';
import { renderLanSyncSettingsPanel } from '../sync/lan/settingsPanel';
import { isIgnoringBatteryOptimizations, requestIgnoreBatteryOptimizations, openAppSettings } from '../features/keepAlive';

const settingsPageCleanupByRoot = new WeakMap<HTMLElement, () => void>();

interface SettingsRenderPart {
  element: HTMLElement;
  cleanup: () => void;
}

export async function renderSettingsPage(
  root: HTMLElement,
  signal?: AbortSignal,
): Promise<void | (() => void)> {
  const [meds, rules, logs] = await Promise.all([
    listMeds(),
    listRules(),
    listLogs(),
  ]);
  if (signal?.aborted) return;

  const content = el('div', { class: 'page page-light settings-page' });

  content.append(renderReminderPanel());
  content.append(renderKeepAlivePanel());
  const llmPanel = renderLlmPanel();
  content.append(llmPanel.element);
  content.append(renderAiConsentPanel());
  content.append(renderAsrPanel());
  const lanSyncPanel = renderLanSyncSettingsPanel(signal);
  content.append(lanSyncPanel.element);

  const backupCard = renderBackupCard(root, signal, {
    meds: meds.length,
    rules: rules.length,
    logs: logs.length,
  });
  content.append(backupCard.element);

  const about = el('section', { class: 'settings-about' });
  about.append(el('h2', { text: '关于' }));
  about.append(el('div', {
    class: 'muted',
    html: `小药盒 v${__APP_VERSION__}（本地优先版）。吃药提醒、药品管理和库存记录可离线使用；AI 与常见相互作用提示仅供参考，不替代医嘱。`,
  }));
  content.append(about);

  settingsPageCleanupByRoot.get(root)?.();
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    llmPanel.cleanup();
    lanSyncPanel.cleanup();
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
  counts?: { meds: number; rules: number; logs: number },
): SettingsRenderPart {
  const io = el('section', { class: 'settings-section settings-data-card' });
  io.append(el('h2', { text: '本地数据与备份' }));
  if (counts) {
    io.append(el('div', {
      class: 'muted',
      html: `本机现有 ${counts.meds} 种药品、${counts.rules} 条提醒规则、${counts.logs} 条服药记录。`,
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
    downloadJson(data, `xiaoyaohe-backup-${new Date().toISOString().slice(0, 10)}.json`);
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

function buildReminderBody(body: HTMLElement, rerender: () => void): void {
  if (!notificationsSupported()) {
    body.append(
      el('div', { class: 'banner warn' } as any, [
        el('span', { html: '当前手机无法使用系统通知。请更新应用，并在系统设置中允许通知。' }),
      ])
    );
    return;
  }

  const appEnabled = isAppNotificationsEnabled();
  const toggleRow = el('label', {
    class: 'settings-toggle-row',
    style: 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 12px;padding:12px 14px;border-radius:14px;background:var(--color-surface-muted,#f2f1f5);',
  } as any);
  const toggleCopy = el('div', { style: 'min-width:0' } as any);
  toggleCopy.append(
    el('div', { style: 'font-weight:700;color:var(--color-text)', text: '应用内用药提醒' } as any),
    el('div', {
      class: 'muted',
      style: 'font-size:13px;line-height:1.45;margin-top:2px',
      text: appEnabled ? '开启后按计划发送系统通知与全屏提醒' : '已暂停：不再调度和弹出用药提醒',
    } as any),
  );
  const toggle = el('input', {
    type: 'checkbox',
    role: 'switch',
    'aria-label': '应用内用药提醒',
  } as any) as HTMLInputElement;
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
      el('div', { class: 'banner info' } as any, [
        el('span', { html: '应用内提醒已关闭。系统通知权限可保留，但不会再发送用药提醒。' }),
      ]),
    );
    return;
  }

  const perm = getPermission();
  const cls = perm === 'granted' ? 'ok' : perm === 'denied' ? 'warn' : 'info';
  const text = perm === 'granted'
    ? '通知已开启，应用会按计划发送提醒。'
    : perm === 'denied'
      ? '通知被拒绝。请到系统设置中允许通知。'
      : '通知尚未开启，开启后才能按时收到提醒。';
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
    if (isNativeReminderPlatform() && nativeMedicationAlarmAvailable()) {
      const strongTest = el('button', { class: 'btn tonal', html: '测试锁屏强提醒' });
      strongTest.onclick = async () => {
        try {
          await fireNativeMedicationAlarmNow('strong');
          toast('已触发增强通知（请看通知栏/锁屏）');
        } catch {
          toast('触发失败');
        }
      };
      const fullTest = el('button', { class: 'btn', html: '测试全屏提醒' });
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
    const fullScreen = getFullScreenAlarmCapability();
    if (fullScreen !== 'granted') {
      body.append(
        el('div', { class: 'banner warn', style: 'margin-top:12px' } as any, [
          el('span', {
            html: fullScreen === 'denied'
              ? '全屏提醒权限尚未开启；选择全屏模式的药物会自动降级为增强通知。'
              : '当前系统不提供全屏提醒权限，相关提醒会使用增强通知。',
          }),
        ]),
      );
      if (fullScreen === 'denied') {
        const fullScreenRow = el('div', { class: 'btn-row', style: 'margin-top:12px' } as any);
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

  body.append(
    el('div', {
      class: 'muted',
      style: 'margin-top:12px;font-size:13px;line-height:1.55',
      html:
        '提醒说明：\n· 请允许通知、精确闹钟，以及（Android 14+）全屏提醒权限。\n' +
        '· 药品编辑页可选择「增强通知 / 短时全屏 / 持续全屏」。\n' +
        '· 全屏模式会在锁屏时点亮屏幕并弹出服药页；无权限时自动降级为增强通知。\n' +
        '· 若系统限制后台运行，请在电池优化里允许本应用。\n' +
        '· 回到应用时会自动检查遗漏的任务并重建闹钟。',
    } as any)
  );
}

/** ---------------- 后台运行/保活面板：申请电池优化白名单 ---------------- */
function renderKeepAlivePanel(): HTMLElement {
  const p = panel({
    title: '后台运行',
    iconName: 'shield',
    chip: { text: '检查中', tone: 'muted' },
    renderBody: (body) => {
      void refreshKeepAlive(body, p);
    },
  });
  return p;
}

async function refreshKeepAlive(body: HTMLElement, panelEl: HTMLElement): Promise<void> {
  body.replaceChildren();
  const ignoring = await isIgnoringBatteryOptimizations();
  setChip(panelEl, ignoring
    ? { text: '已允许', tone: 'ok' }
    : { text: '需授权', tone: 'warn' });
  if (ignoring) {
    body.append(el('div', { class: 'muted', style: 'font-size:13px;line-height:1.55', html: '已在电池优化白名单中，应用可在后台持续运行提醒与同步。' } as any));
    const row = el('div', { class: 'btn-row', style: 'margin-top:12px' } as any);
    const openBtn = el('button', { class: 'btn tonal', html: '打开应用设置' });
    openBtn.onclick = () => void openAppSettings();
    row.append(openBtn);
    body.append(row);
    return;
  }
  body.append(el('div', { class: 'banner warn' } as any, [
    el('span', { html: '允许小药盒在后台运行，提醒和自动同步才不会被系统关闭。点下方按钮，在弹窗里选「允许」。' }),
  ]));
  const row = el('div', { class: 'btn-row', style: 'margin-top:12px' } as any);
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
    await setLlmConfig({ baseUrl, apiKey, model });
    // 语音识别密钥在独立 panel「语音识别（腾讯云）」里设置。
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
        '· 密钥保存在这台手机的安全存储中。',
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
          : '小助手对话与联网搜索',
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

/** 把已保存的密钥在 UI 上脱敏显示：保留前 3 + 后 4，中间用 * 遮。 */
function maskSecret(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length <= 8) return '*'.repeat(trimmed.length);
  return `${trimmed.slice(0, 3)}${'*'.repeat(Math.min(8, trimmed.length - 7))}${trimmed.slice(-4)}`;
}

/** ---------------- 语音识别（腾讯云）独立面板 ---------------- */
function renderAsrPanel(): HTMLElement {
  const asrCfg = getAsrConfig();
  const asrHealth = getAsrHealth();
  const initialChip: PanelChip = isAsrCredentialsConfigured()
    ? { text: '已配置', tone: 'ok' }
    : isNativeSpeechFallbackAvailable()
      ? { text: '未填密钥', tone: 'warn' }
      : { text: '未配置', tone: 'warn' };

  const body = el('div', {});
  body.append(
    el('div', {
      class: 'muted',
      style: 'margin-bottom:10px' as any,
      text: '小助手按住说话、说话录药、库存智能录入共用腾讯云一句话识别。密钥只保存在这台手机（Web 预览 = localStorage；Android App = 安全存储），App 直连腾讯云，任意设备装好填密钥即可用，无需再跑代理。',
    })
  );

  const initialId = asrCfg.secretId;
  const initialKey = asrCfg.secretKey;
  const initialRegion = asrCfg.region || 'ap-guangzhou';

  const idIn = el('input', {
    type: 'text',
    autocomplete: 'off',
    spellcheck: 'false',
    value: initialId ? maskSecret(initialId) : '',
    placeholder: 'AKIDxxxxxxxxxxxxxxxx',
  } as any) as HTMLInputElement;
  idIn.readOnly = Boolean(initialId); // 有保存就展示 mask，避免误改

  const keyIn = el('input', {
    type: 'password',
    autocomplete: 'off',
    value: initialKey ? maskSecret(initialKey) : '',
    placeholder: 'sk-xxxxxxxxxxxxxxxx',
  } as any) as HTMLInputElement;
  keyIn.readOnly = Boolean(initialKey);

  const regionIn = el('input', {
    type: 'text',
    autocomplete: 'off',
    value: initialRegion,
    placeholder: 'ap-guangzhou',
  } as any) as HTMLInputElement;

  body.append(field('SecretId', idIn));
  body.append(field('SecretKey', keyIn));
  body.append(field('地域 Region', regionIn));

  const status = el('div', {
    class: `banner ${asrHealth.stage === 'success' || asrHealth.stage === 'ready' ? 'ok' : asrHealth.stage === 'error' ? 'warn' : 'info'}`,
    style: 'margin-top:10px',
  } as any);
  const renderStatus = (): void => {
    const h = getAsrHealth();
    status.className = `banner ${h.stage === 'success' || h.stage === 'ready' ? 'ok' : h.stage === 'error' ? 'warn' : 'info'}`;
    const diagnostic = [
      isAsrCredentialsConfigured()
        ? h.message || '腾讯云语音识别已配置'
        : isNativeSpeechFallbackAvailable()
          ? '未填密钥，将使用设备系统语音识别'
          : '请填写 SecretId 和 SecretKey',
      h.code ? `错误码 ${h.code}` : '',
      h.requestId ? `RequestId ${h.requestId}` : '',
      h.at ? new Date(h.at).toLocaleString() : '',
    ].filter(Boolean).join(' · ');
    status.replaceChildren(el('span', { text: diagnostic }));
  };
  renderStatus();
  body.append(status);

  const row = el('div', { class: 'btn-row', style: 'margin-top:10px' } as any);

  // 已保存时：「修改」解锁两个输入框并切换为保存
  const editBtn = el('button', { class: 'btn tonal', type: 'button', html: '修改密钥' } as any);
  const saveBtn = el('button', { class: 'btn', type: 'button', html: '保存' } as any);
  const clearBtn = el('button', { class: 'btn text', type: 'button', html: '清除' } as any);

  const enterEditMode = (): void => {
    idIn.readOnly = false;
    keyIn.readOnly = false;
    idIn.value = '';
    keyIn.value = '';
    idIn.type = 'text';
    keyIn.type = 'text';
    idIn.focus();
  };

  editBtn.onclick = enterEditMode;
  saveBtn.onclick = async () => {
    const nextId = idIn.value.trim() || (idIn.readOnly ? initialId : '');
    const nextKey = keyIn.value.trim() || (keyIn.readOnly ? initialKey : '');
    if (!nextId || !nextKey) return toast('请填写 SecretId 和 SecretKey');
    await setAsrConfig({
      secretId: nextId,
      secretKey: nextKey,
      region: regionIn.value.trim() || 'ap-guangzhou',
    });
    // 保存后回到 mask 显示，避免误读
    idIn.value = maskSecret(nextId);
    keyIn.value = maskSecret(nextKey);
    idIn.readOnly = true;
    keyIn.readOnly = true;
    keyIn.type = 'password';
    renderStatus();
    setChip(panelEl, isAsrCredentialsConfigured() ? { text: '已配置', tone: 'ok' } : initialChip);
    toast('语音密钥已保存到本机 ✓');
  };
  clearBtn.onclick = async () => {
    if (!(await confirmDialog('清除本机腾讯云语音密钥？', '清除'))) return;
    await clearAsrConfig();
    idIn.value = '';
    keyIn.value = '';
    idIn.readOnly = false;
    keyIn.readOnly = false;
    keyIn.type = 'password';
    regionIn.value = 'ap-guangzhou';
    renderStatus();
    setChip(panelEl, { text: '未配置', tone: 'warn' });
    toast('已清除语音密钥');
  };

  if (isAsrCredentialsConfigured()) {
    row.append(editBtn, clearBtn);
  } else {
    row.append(saveBtn);
    row.append(clearBtn);
    if (!isAsrCredentialsConfigured()) {
      // 首次配置：聚焦第一个空输入框
      window.setTimeout(() => {
        if (!idIn.value) idIn.focus();
      }, 0);
    }
  }
  body.append(row);

  let panelEl: HTMLElement = document.createElement('div'); // 由 panel() 赋值，saveBtn 闭包依赖
  panelEl = panel({
    title: '语音识别（腾讯云）',
    iconName: 'mic',
    defaultOpen: true,
    chip: initialChip,
    renderBody: (b) => {
      b.append(...Array.from(body.children));
    },
  });
  return panelEl;
}
