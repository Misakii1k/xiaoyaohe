// Android 设置页：系统提醒、AI、局域网家庭同步、本地备份和应用信息。
// 主要配置使用折叠面板，默认收起并在标题行显示当前状态。
import { listLogs, listMeds, listRules } from '../db/local';
import { listWorkEntries, listWorkProfiles, listWorkSettlements } from '../db/work';
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
import { getAsrHealth, getAsrProxyUrl } from '../ai/asr';
import { clearAiConsents, getAiConsentRecords, revokeAiConsent } from '../ai/consent';
import { assertBackupFileSize, parseSafeBackupPayload } from '../security/validation';
import { renderLanSyncSettingsPanel } from '../sync/lan/settingsPanel';

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
  const lanSyncPanel = renderLanSyncSettingsPanel(signal);
  content.append(lanSyncPanel.element);

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
        el('span', { html: '当前手机无法使用系统通知。请更新应用，并在系统设置中允许通知。' }),
      ])
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
        '提醒说明：\n· 请允许通知和精确闹钟。\n' +
        '· 如果系统限制应用在后台运行，提醒可能稍有延迟。\n' +
        '· 回到应用时会自动检查遗漏的任务。',
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

  // ====== 语音识别：密钥只在服务端，客户端只展示脱敏状态 ======
  const asrHealth = getAsrHealth();
  const asrEndpoint = getAsrProxyUrl();
  body.append(el('div', { class: 'section-title', style: 'margin-top:16px', html: '语音识别' } as any));
  body.append(
    el('div', {
      class: 'muted',
      text: '小助手按住说话和说话录药共用腾讯云一句话识别。密钥保存在服务端，本机不保存 SecretId、SecretKey 或音频日志。',
    })
  );
  const asrStatus = el('div', {
    class: `banner ${asrHealth.stage === 'success' || asrHealth.stage === 'ready' ? 'ok' : asrHealth.stage === 'error' ? 'warn' : 'info'}`,
    style: 'margin-top:10px',
  } as any);
  const diagnostic = [
    asrEndpoint ? asrHealth.message : '生产语音代理尚未配置',
    asrHealth.code ? `错误码 ${asrHealth.code}` : '',
    asrHealth.requestId ? `RequestId ${asrHealth.requestId}` : '',
    asrHealth.at ? new Date(asrHealth.at).toLocaleString() : '',
  ].filter(Boolean).join(' · ');
  asrStatus.append(el('span', { text: diagnostic }));
  body.append(asrStatus);

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
