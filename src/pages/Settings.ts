// 设置页（M1：本地数据概览 + 导出/导入；M2 云同步绑定；M3 系统通知 + 调度）
// 重构：三大配置卡（同步 / 通知 / AI）改成 iOS 折叠面板（默认收起，标题行带状态徽章 + 箭头）
import { listLogs, listMeds, listRules } from '../db/local';
import { listWorkEntries, listWorkProfiles, listWorkSettlements } from '../db/work';
import { confirmDialog, el, renderPage, toast, icon } from '../ui/components';
import { backupProviders, buildBackup, previewBackupImport } from '../tools/registry';
import {
  CLOUD_SYNC_ENABLED,
  getSyncConfig,
  setSyncConfig,
  clearSyncConfig,
  genId,
  type SyncConfig,
} from '../sync/config';
import { syncNow, onSync, type SyncResult } from '../sync/syncClient';
import {
  notificationsSupported,
  getPermission,
  requestPermission,
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
  type LlmHealth,
} from '../ai/llmConfig';

export async function renderSettingsPage(root: HTMLElement): Promise<void> {
  const [meds, rules, logs, workProfiles, workEntries, workSettlements] = await Promise.all([
    listMeds(),
    listRules(),
    listLogs(),
    listWorkProfiles(),
    listWorkEntries(),
    listWorkSettlements(),
  ]);

  const content = el('div', { class: 'page page-light' });

  // 数据概览
  const stat = el('div', { class: 'card' });
  stat.append(el('h3', { html: '数据概览' }));
  stat.append(statRow('💊', '药品数量', meds.length));
  stat.append(statRow('⏰', '提醒规则', rules.length));
  stat.append(statRow('✅', '服药记录', logs.length));
  stat.append(statRow('💼', '工时记录', workProfiles.length + workEntries.length + workSettlements.length));
  content.append(stat);

  // 三大配置面板（折叠）
  content.append(renderSyncPanel());
  content.append(renderReminderPanel());
  content.append(renderLlmPanel());

  content.append(renderBackupCard(root));

  // 关于
  const about = el('div', { class: 'card' });
  about.append(el('h3', { html: '关于' }));
  about.append(el('div', { class: 'muted', html: '日常工具箱 v0.4.0（本地优先版）。吃药提醒、药盒分类和工时收入都可离线使用；AI 识别与安全检查结果仅供参考，不替代医嘱。' }));
  content.append(about);

  renderPage({ root, title: '设置', activeTab: 'settings', content });
}

function statRow(emoji: string, label: string, value: number): HTMLElement {
  const row = el('div', { class: 'stat-row' });
  row.append(el('span', { class: 'ic-circle-sm', html: emoji }));
  row.append(el('div', { class: 'label', html: label }));
  row.append(el('div', { class: 'value', html: String(value) }));
  return row;
}

function renderBackupCard(root: HTMLElement): HTMLElement {
  const io = el('div', { class: 'card' });
  io.append(el('h3', { html: '本地备份' }));
  io.append(el('div', {
    class: 'muted',
    html: '备份包含药品、提醒规则、服药记录和本地工时。导入时按 id + 更新时间合并，不会清空本地数据。',
  }));

  const exportBtn = el('button', { class: 'btn tonal', html: '导出数据（JSON）', style: 'margin-top:12px' } as any);
  exportBtn.onclick = async () => {
    const data = await buildBackup();
    downloadJson(data, `medbox-backup-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const importBtn = el('button', { class: 'btn', html: '导入备份', style: 'margin-top:10px' } as any);
  const fileInput = el('input', {
    type: 'file',
    accept: 'application/json,.json',
    style: 'display:none',
  } as any) as HTMLInputElement;
  importBtn.onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      // 预扫描：预估每个 provider 的 added/updated/skipped + 收集异常字段
      const preview = await previewBackupImport(raw);
      const totalItems = preview.providers.reduce(
        (sum, p) => sum + p.added + p.updated + p.skipped,
        0,
      );
      if (totalItems === 0) {
        toast('这个备份里没有可导入的数据');
        return;
      }

      // 构建预扫描摘要：每个 provider 的预计新增/更新/跳过
      const summaryLines = preview.providers.map(
        (p) => `${p.label}：新增 ${p.added}，更新 ${p.updated}，跳过 ${p.skipped}`,
      );
      const warningBlock = preview.warnings.length
        ? `<div style="margin-top:10px;padding:8px 10px;border-radius:8px;background:rgba(255,149,10,0.10);color:#b45309;font-size:13px;line-height:1.5">注意：${preview.warnings.slice(0, 5).map(escapeHtml).join('；')}${preview.warnings.length > 5 ? `（共 ${preview.warnings.length} 条）` : ''}</div>`
        : '';
      const ok = await confirmDialog(
        `导入备份？<br><span style="font-size:15px;font-weight:500;line-height:1.6;display:block;margin-top:10px">${summaryLines.map(escapeHtml).join('<br>')}<br><span style="color:var(--label-secondary)">只会合并更新，不会清空本地数据。</span></span>${warningBlock}`,
        '导入',
      );
      if (!ok) return;

      const results = [];
      for (const provider of backupProviders) {
        const r = await provider.import(raw);
        results.push(`${provider.label} 新增 ${r.added}，更新 ${r.updated}，跳过 ${r.skipped}`);
      }
      toast(results.join('；'), 4200);
      await renderSettingsPage(root);
    } catch (e) {
      toast('导入失败：' + (e instanceof Error ? e.message : String(e)), 3600);
    }
  };

  const row = el('div', { class: 'btn-row backup-actions' });
  row.append(exportBtn, importBtn);
  io.append(row, fileInput);
  return io;
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
  iconHtml: string; // emoji 或 svg 字符串
  chip: PanelChip;
  defaultOpen?: boolean;
  renderBody: (body: HTMLElement) => void;
}

function panel(opts: PanelOpts): HTMLElement {
  const wrap = el('div', {
    class: 'panel' + (opts.defaultOpen ? ' open' : ''),
  } as any);

  const head = el('button', { class: 'panel-head', type: 'button' } as any);
  const lead = el('span', { class: 'panel-lead' } as any);
  lead.append(el('span', { class: 'panel-icon', html: opts.iconHtml } as any));
  lead.append(el('span', { class: 'panel-title', html: opts.title } as any));
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
  opts.renderBody(body);

  head.onclick = () => {
    wrap.classList.toggle('open');
  };

  wrap.append(head, body);
  return wrap;
}

function setChip(panelEl: HTMLElement, chip: PanelChip): void {
  const c = panelEl.querySelector<HTMLElement>('.panel-chip');
  if (!c) return;
  c.className = 'panel-chip tone-' + chip.tone;
  c.innerHTML = chip.text;
}

/** ---------------- 云同步面板 ---------------- */
function renderSyncPanel(): HTMLElement {
  if (!CLOUD_SYNC_ENABLED) {
    return panel({
      title: '云同步',
      iconHtml: '☁️',
      chip: { text: '已暂停', tone: 'muted' },
      renderBody: renderSyncDisabled,
    });
  }

  const cfg = getSyncConfig();
  const chip: PanelChip = cfg
    ? { text: '已绑定', tone: 'ok' }
    : { text: '未配置', tone: 'muted' };
  const p = panel({
    title: '云同步',
    iconHtml: '☁️',
    chip,
    renderBody: (body) => buildSyncBody(body, () => {
      // 重新构建 body
      body.innerHTML = '';
      buildSyncBody(body, () => {});
      const c = getSyncConfig();
      setChip(p, c ? { text: '已绑定', tone: 'ok' } : { text: '未配置', tone: 'muted' });
    }),
  });
  return p;
}

function renderSyncDisabled(body: HTMLElement): void {
  body.append(
    el('div', { class: 'banner info' } as any, [
      el('span', {
        html: '云同步暂时关闭。药品、服药提醒、扫码分药和本地备份都会继续保存在本机，可离线使用。',
      }),
    ])
  );
  body.append(
    el('div', {
      class: 'muted',
      style: 'margin-top:10px;line-height:1.55',
      html:
        '当前不会连接 Worker，也不会上传或拉取云端数据。以后需要恢复同步时，可以重新开启云同步开关，已有的本地数据不会被清除。',
    } as any)
  );
}

function buildSyncBody(body: HTMLElement, rerender: () => void): void {
  const cfg = getSyncConfig();
  if (cfg) {
    renderSyncConfigured(body, cfg, rerender);
  } else {
    renderSyncSetup(body, rerender);
  }
}

function renderSyncConfigured(body: HTMLElement, cfg: SyncConfig, rerender: () => void): void {
  body.append(
    el('div', { class: 'muted', html: '两台手机填同一「共享空间」即看同一份数据。' })
  );

  const info = el('div', { class: 'list-item', style: 'margin-top:8px' } as any, [
    el('div', { class: 'grow' }, [
      el('div', { class: 'name', html: '共享空间' }),
      el('div', { class: 'muted', html: cfg.household, style: 'word-break:break-all;font-size:13px' } as any),
    ]),
    el('span', { class: 'slot-tag', html: cfg.role === 'caregiver' ? '照护者' : '患者' }),
  ]);
  body.append(info);

  const status = el('div', { class: 'banner info', style: 'margin-top:10px' } as any, [
    el('span', { html: '同步状态：—' }),
  ]);
  body.append(status);
  const unsub = onSync((r: SyncResult) => {
    const span = status.firstChild as HTMLElement;
    span.innerHTML = syncStatusText(r);
    status.className = 'banner ' + syncStatusClass(r);
  });
  window.addEventListener('hashchange', () => unsub(), { once: true });

  const row = el('div', { class: 'btn-row', style: 'margin-top:12px' } as any);
  const syncBtn = el('button', { class: 'btn', html: '立即同步' });
  syncBtn.onclick = async () => {
    syncBtn.setAttribute('disabled', 'true');
    const r = await syncNow();
    syncBtn.removeAttribute('disabled');
    toast(r.state === 'ok' ? '已同步 ✓' : r.message);
  };
  const shareBtn = el('button', { class: 'btn tonal', html: '分享给对方' });
  shareBtn.onclick = () => shareConfig(cfg);
  row.append(syncBtn, shareBtn);
  body.append(row);

  const unbind = el('button', {
    class: 'btn text',
    html: '断开云同步',
    style: 'margin-top:10px;color:var(--ios-red)',
  } as any);
  unbind.onclick = () => {
    clearSyncConfig();
    toast('已断开云同步（本地数据保留）');
    rerender();
  };
  body.append(unbind);
}

function renderSyncSetup(body: HTMLElement, rerender: () => void): void {
  body.append(
    el('div', {
      class: 'muted',
      html: '需要先部署免费的 Cloudflare Worker，然后把地址填到这里。详见项目说明。',
    })
  );

  const urlIn = el('input', {
    type: 'url',
    placeholder: 'Worker 地址，如 https://medbox.xxx.workers.dev',
    style: 'margin-top:10px',
  } as any) as HTMLInputElement;

  const houseRow = el('div', { style: 'display:flex;gap:8px;margin-top:8px' } as any);
  const houseIn = el('input', {
    class: 'grow',
    type: 'text',
    placeholder: '共享空间 id（两端相同）',
  } as any) as HTMLInputElement;
  const genBtn = el('button', { class: 'btn tonal small', html: '生成' });
  genBtn.onclick = () => {
    houseIn.value = genId();
    if (!secretIn.value) secretIn.value = genId();
  };
  houseRow.append(houseIn, genBtn);

  const secretIn = el('input', {
    type: 'text',
    placeholder: '共享密钥（与 Worker 的 SYNC_SECRET 一致）',
    style: 'margin-top:8px',
  } as any) as HTMLInputElement;

  const roleRow = el('div', { style: 'display:flex;gap:8px;margin-top:8px' } as any);
  let role: SyncConfig['role'] = 'caregiver';
  const careBtn = el('button', { class: 'chip on', html: '我是照护者' });
  const patBtn = el('button', { class: 'chip', html: '我是患者' });
  careBtn.onclick = () => {
    role = 'caregiver';
    careBtn.classList.add('on');
    patBtn.classList.remove('on');
  };
  patBtn.onclick = () => {
    role = 'patient';
    patBtn.classList.add('on');
    careBtn.classList.remove('on');
  };
  roleRow.append(careBtn, patBtn);

  body.append(urlIn, houseRow, secretIn, roleRow);

  const save = el('button', { class: 'btn', html: '保存并同步', style: 'margin-top:12px' } as any);
  save.onclick = async () => {
    const workerUrl = urlIn.value.trim();
    const household = houseIn.value.trim();
    const secret = secretIn.value.trim();
    if (!/^https?:\/\//.test(workerUrl)) return toast('请填写正确的 Worker 地址');
    if (!/^[a-z0-9]{6,64}$/.test(household)) return toast('共享空间 id 需为 6-64 位小写字母或数字');
    if (!secret) return toast('请填写共享密钥');
    setSyncConfig({ workerUrl, household, secret, role });
    toast('配置已保存，开始同步…');
    rerender();
    const r = await syncNow();
    toast(r.state === 'ok' ? '首次同步成功 ✓' : r.message);
  };
  body.append(save);
}

async function shareConfig(cfg: SyncConfig): Promise<void> {
  const payload = `medbox 云同步配置\nWorker: ${cfg.workerUrl}\n共享空间: ${cfg.household}\n密钥: ${cfg.secret}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'medbox 云同步', text: payload });
      return;
    } catch {
      /* 用户取消或不支持，回退复制 */
    }
  }
  try {
    await navigator.clipboard.writeText(payload);
    toast('已复制配置，发给对方在设置里填入即可');
  } catch {
    toast('请手动复制：' + cfg.household);
  }
}

function syncStatusText(r: SyncResult): string {
  const t = r.at ? new Date(r.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
  switch (r.state) {
    case 'ok': return `已同步 ✓（${t}）`;
    case 'syncing': return '同步中…';
    case 'offline': return '当前离线，联网后自动同步';
    case 'error': return '同步出错：' + r.message;
    case 'disabled': return '云同步已暂停，本机数据照常可用';
    case 'unconfigured': return '未配置';
    default: return '等待同步';
  }
}

function syncStatusClass(r: SyncResult): string {
  if (r.state === 'ok') return 'ok';
  if (r.state === 'error') return 'warn';
  if (r.state === 'disabled') return 'info';
  return 'info';
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
    iconHtml: '🔔',
    chip,
    renderBody: (body) => buildReminderBody(body, () => {
      body.innerHTML = '';
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
    ? '已授权 ✓ 到点会弹出系统通知 + 震动'
    : perm === 'denied'
      ? '通知被拒绝。请到浏览器/系统设置里手动允许通知。'
      : '未开启：开启后即使应用挂在后台也能按时提醒。';
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
      const ok = await showNotification('🔔 测试提醒', {
        body: '看到这条说明系统通知工作正常 · 应用挂后台也能响',
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

  body.append(
    el('div', {
      class: 'muted',
      style: 'margin-top:12px;font-size:13px;line-height:1.55',
      html:
        '小贴士：' +
        '<br>· 安卓把本应用<b>添加到主屏</b>，并在系统电池里把它加入<b>白名单</b>，挂后台也能按时响。' +
        '<br>· iOS 需把网页<b>添加到主屏</b>后，从主屏图标启动，才能收到系统通知。' +
        '<br>· 锁屏 / 应用被完全杀掉时，本地调度可能错过；联网/回到前台后会立即追账补提醒。',
    } as any)
  );
}

/** ---------------- AI 大模型面板（支持模型自动检测 + 状态） ---------------- */
function renderLlmPanel(): HTMLElement {
  const initialHealth = getLlmHealth();
  const chip = healthToChip(initialHealth);
  const p = panel({
    title: 'AI 大模型',
    iconHtml: '✨',
    chip,
    renderBody: (body) => buildLlmBody(body, (h) => setChip(p, healthToChip(h))),
  });

  // 监听启动期静默体检的回调（main.ts fire）
  const onHealth = (e: Event) => {
    const h = (e as CustomEvent<LlmHealth>).detail;
    setChip(p, healthToChip(h));
  };
  window.addEventListener('medbox:llm-health', onHealth);
  window.addEventListener('hashchange', () => {
    window.removeEventListener('medbox:llm-health', onHealth);
  }, { once: true });

  return p;
}

function healthToChip(h: LlmHealth): PanelChip {
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
  const usingDefault = isUsingDefaultKey();
  if (usingDefault) {
    body.append(
      el('div', { class: 'banner info', style: 'margin-top:10px' } as any, [
        el('span', {
          html: '当前使用默认密钥（来自项目作者预填）。如部署到公开环境请改为你自己的密钥。',
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
    toggleKey.innerHTML = visible ? '隐藏' : '显示';
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

  modelRow.append(modelSel, modelIn, refreshBtn);
  body.append(field('模型', modelRow));

  // 状态横条
  const statusBar = el('div', { class: 'llm-status' } as any);
  body.append(statusBar);

  // === 初始填充：用持久化的健康检查结果 ===
  const persisted = getLlmHealth();
  populateModelControl(modelSel, modelIn, persisted.models, cfg.model);
  applyHealthBar(statusBar, persisted);

  refreshBtn.onclick = async () => {
    refreshBtn.setAttribute('disabled', 'true');
    refreshBtn.innerHTML = '检测中…';
    const tmpCfg = {
      baseUrl: urlIn.value.trim() || cfg.baseUrl,
      apiKey: keyIn.value.trim() || cfg.apiKey,
      model: getCurrentModel(modelSel, modelIn) || cfg.model,
    };
    try {
      const models = await listModels(tmpCfg);
      populateModelControl(modelSel, modelIn, models, tmpCfg.model);
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
      populateModelControl(modelSel, modelIn, [], tmpCfg.model);
      toast('拉模型失败：' + h.message);
    } finally {
      refreshBtn.removeAttribute('disabled');
      refreshBtn.innerHTML = '刷新';
    }
  };

  // ====== 操作行 ======
  const row = el('div', { class: 'btn-row', style: 'margin-top:12px' } as any);
  const save = el('button', { class: 'btn', html: '保存' });
  save.onclick = async () => {
    const baseUrl = urlIn.value.trim();
    const apiKey = keyIn.value.trim();
    const model = getCurrentModel(modelSel, modelIn);
    if (!/^https?:\/\//.test(baseUrl)) return toast('请填写正确的 API 地址');
    if (!apiKey) return toast('请填写 API 密钥');
    if (!model) return toast('请填写或选择模型');
    setLlmConfig({ baseUrl, apiKey, model });
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
    test.innerHTML = '测试中…';
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
      test.innerHTML = '测试连接';
    }
  };
  row.append(save, test);
  body.append(row);

  if (!usingDefault) {
    const reset = el('button', {
      class: 'btn text',
      html: '恢复默认配置',
      style: 'margin-top:8px',
    } as any);
    reset.onclick = () => {
      resetLlmConfig();
      toast('已恢复默认');
      // 重建 body
      body.innerHTML = '';
      buildLlmBody(body, onHealthChange);
    };
    body.append(reset);
  }

  body.append(
    el('div', {
      class: 'muted',
      style: 'margin-top:12px;font-size:13px;line-height:1.55',
      html:
        '· 接口需兼容 OpenAI <code>/chat/completions</code> 协议。' +
        '<br>· 默认模型 <code>' + DEFAULT_LLM_CONFIG.model + '</code>，也可换成 <code>gpt-4o</code>、<code>claude-3-5-sonnet</code> 等。' +
        '<br>· 密钥仅保存在本机 localStorage，不上云、不同步。',
    } as any)
  );
}

/** 把模型列表填到 select；列表为空时回退到 input。 */
function populateModelControl(
  sel: HTMLSelectElement,
  input: HTMLInputElement,
  models: string[] | undefined,
  current: string,
): void {
  const list = models || [];
  if (list.length === 0) {
    // 回退手填
    sel.style.display = 'none';
    input.style.display = '';
    if (current) input.value = current;
    return;
  }
  sel.style.display = '';
  input.style.display = 'none';
  sel.innerHTML = '';
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
  bar.innerHTML = '';
  bar.append(el('span', { html: text }));
}

function field(label: string, input: HTMLElement): HTMLElement {
  const f = el('div', { class: 'field' });
  f.append(el('label', { html: label }));
  f.append(input);
  return f;
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
