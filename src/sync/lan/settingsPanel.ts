import QRCode from 'qrcode';
import { scanCodeFromImage, startScan, type Scanner } from '../../features/scanner';
import { el, icon, toast } from '../../ui/components';
import { openBottomSheet, type BottomSheetHandle } from '../../ui/primitives/BottomSheet';
import { isLanSyncAvailable } from './nativeTransport';
import type { LanSyncContentOptions } from './extras';
import {
  getLanSyncDeviceName,
  getLastLanSyncResult,
  joinLanSyncHost,
  setLanSyncDeviceName,
  startLanSyncHost,
  type HostedLanSyncSession,
  type LanSyncProgress,
  type LanSyncSessionResult,
} from './session';
import {
  formatLanTime,
  isLanAllowRemoteOverwrite,
  policyLabel,
  setLanAllowRemoteOverwrite,
  type LanDeviceSummary,
  type LanSyncPolicy,
} from './policy';
import {
  forgetPeer,
  listKnownPeers,
} from './knownPeers';
import {
  isAutoSyncEnabled,
  isLanAutoSyncSilent,
  pausePersistentHost,
  setAutoSyncEnabled,
  setLanAutoSyncSilent,
  triggerManualJoinAll,
  type ManualJoinSummary,
} from './autoSync';

export interface LanSyncSettingsPart {
  element: HTMLElement;
  cleanup: () => void;
}

let panelSequence = 0;

export function renderLanSyncSettingsPanel(routeSignal?: AbortSignal): LanSyncSettingsPart {
  const available = isLanSyncAvailable();
  const lastResult = getLastLanSyncResult();
  const panel = el('section', { class: 'panel lan-sync-panel' });
  const bodyId = `lan-sync-panel-body-${++panelSequence}`;
  const head = el('button', {
    class: 'panel-head',
    type: 'button',
    'aria-expanded': 'false',
    'aria-controls': bodyId,
  } as any) as HTMLButtonElement;
  const lead = el('span', { class: 'panel-lead' });
  const panelIcon = el('span', { class: 'panel-icon', 'aria-hidden': 'true' } as any);
  panelIcon.append(icon('devices'));
  lead.append(panelIcon, el('span', { class: 'panel-title', text: '家庭同步' }));
  const trailing = el('span', { class: 'panel-right' });
  const chip = el('span', {
    class: `panel-chip ${lastResult ? 'tone-ok' : available ? 'tone-muted' : 'tone-warn'}`,
    text: lastResult ? '已同步' : available ? '未连接' : '仅 App',
  });
  trailing.append(chip, icon('chevron-right', 'panel-chevron'));
  head.append(lead, trailing);

  const body = el('div', { class: 'panel-body' });
  body.id = bodyId;
  body.hidden = true;
  body.setAttribute('inert', '');
  const info = el('div', { class: 'banner info' }, [
    el('span', { text: '两台手机连着同一个 Wi-Fi 时，可以直接互相传。药品、提醒和服药记录不会经过网上的服务器。' }),
  ]);
  const inventoryNote = el('p', {
    class: 'muted lan-sync-note',
    text: '连接后可对比两边数据更新时间并选择覆盖或合并。库存数字仍各自保留在本机，避免同时服药时算错。',
  });
  const nameInput = el('input', {
    type: 'text',
    maxlength: 80,
    autocomplete: 'off',
    value: getLanSyncDeviceName(),
  } as any) as HTMLInputElement;
  nameInput.id = `lan-sync-device-name-${panelSequence}`;
  const nameField = el('div', { class: 'field' }, [
    el('label', { htmlFor: nameInput.id, text: '这台手机叫' } as any),
    nameInput,
  ]);

  const allowOverwrite = el('input', {
    type: 'checkbox',
    id: `lan-sync-allow-overwrite-${panelSequence}`,
  } as any) as HTMLInputElement;
  allowOverwrite.checked = isLanAllowRemoteOverwrite();
  allowOverwrite.onchange = () => setLanAllowRemoteOverwrite(allowOverwrite.checked);
  const allowField = el('label', {
    class: 'lan-sync-extras-item',
    htmlFor: allowOverwrite.id,
    style: 'display:flex;align-items:flex-start;gap:10px;margin:8px 0 4px;padding:10px 12px;border-radius:12px;background:var(--color-surface-muted,#f2f1f5);',
  } as any, [
    allowOverwrite,
    el('span', {
      style: 'font-size:13px;line-height:1.45' as any,
      text: '允许多设备整库覆盖：对方选择「用对方数据覆盖」时，本机数据会被替换（局域网内多台设备同步时需要打开）',
    }),
  ]);

  const autoSyncToggle = el('input', {
    type: 'checkbox',
    id: `lan-sync-auto-${panelSequence}`,
  } as any) as HTMLInputElement;
  autoSyncToggle.checked = isAutoSyncEnabled();
  autoSyncToggle.onchange = () => {
    setAutoSyncEnabled(autoSyncToggle.checked);
    toast(autoSyncToggle.checked
      ? '已开启：每 30 分钟自动同步（双方都需开启，且先手动配对一次）'
      : '已关闭自动同步');
    renderPeersList();
  };
  const autoSyncField = el('label', {
    class: 'lan-sync-extras-item',
    htmlFor: autoSyncToggle.id,
    style: 'display:flex;align-items:flex-start;gap:10px;margin:8px 0 4px;padding:10px 12px;border-radius:12px;background:var(--color-surface-muted,#f2f1f5);',
  } as any, [
    autoSyncToggle,
    el('span', {
      style: 'font-size:13px;line-height:1.45' as any,
      text: '每 30 分钟自动同步：在同一 Wi‑Fi 下后台轮询已配对设备。需先扫码配对一次；两台都开启效果更好。依赖「设置 → 后台运行」。',
    }),
  ]);

  const silentToggle = el('input', {
    type: 'checkbox',
    id: `lan-sync-auto-silent-${panelSequence}`,
  } as any) as HTMLInputElement;
  silentToggle.checked = isLanAutoSyncSilent();
  const silentHint = el('span', {
    style: 'font-size:13px;line-height:1.45' as any,
    text: '自动同步冲突时静默处理：开启后用推荐策略（合并或整库覆盖）直接同步；关闭后遇到整库覆盖会跳过本次，留给手动同步确认。',
  });
  silentToggle.onchange = () => {
    setLanAutoSyncSilent(silentToggle.checked);
    toast(silentToggle.checked
      ? '已开启静默处理：自动同步按推荐策略执行'
      : '已关闭静默处理：整库覆盖将被跳过，请用手动同步确认');
  };
  const silentField = el('label', {
    class: 'lan-sync-extras-item',
    htmlFor: silentToggle.id,
    style: 'display:flex;align-items:flex-start;gap:10px;margin:8px 0 4px;padding:10px 12px;border-radius:12px;background:var(--color-surface-muted,#f2f1f5);',
  } as any, [
    silentToggle,
    silentHint,
  ]);

  const peersBox = el('div', { class: 'lan-sync-peers', style: 'margin:8px 0 4px' } as any);
  const renderPeersList = (): void => {
    peersBox.replaceChildren();
    const peers = listKnownPeers();
    peersBox.append(el('div', {
      class: 'muted',
      style: 'font-size:12px;margin-bottom:6px' as any,
      text: peers.length ? `已配对 ${peers.length} 台设备` : '还没有配对设备，请先用连接码/扫一扫同步一次',
    }));
    for (const peer of peers) {
      const row = el('div', {
        style: 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-block-start:1px solid var(--color-border)' as any,
      });
      row.append(el('div', {
        style: 'min-inline-size:0;font-size:13px;line-height:1.4' as any,
        html: `<strong>${escapeHtml(peer.deviceName)}</strong><br><span class="muted">${escapeHtml(peer.host)}:${peer.port}</span>`,
      }));
      const forget = el('button', { class: 'btn text', type: 'button', text: '忘记' });
      forget.onclick = () => {
        forgetPeer(peer.deviceId);
        toast(`已忘记「${peer.deviceName}」`);
        renderPeersList();
      };
      row.append(forget);
      peersBox.append(row);
    }
  };
  renderPeersList();

  const status = el('div', {
    class: 'lan-sync-status',
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'true',
  } as any);
  renderLastResult(status, lastResult);

  // 额外同步内容勾选
  const photosCheckbox = el('input', { type: 'checkbox', id: `lan-sync-photos-${panelSequence}` } as any) as HTMLInputElement;
  const apiCheckbox = el('input', { type: 'checkbox', id: `lan-sync-api-${panelSequence}` } as any) as HTMLInputElement;
  const extrasFieldset = el('fieldset', { class: 'lan-sync-extras' }, [
    el('legend', { text: '额外同步（可选）' }),
    el('label', { class: 'lan-sync-extras-item', htmlFor: photosCheckbox.id } as any, [
      photosCheckbox,
      el('span', { text: '药品照片' }),
    ]),
    el('label', { class: 'lan-sync-extras-item', htmlFor: apiCheckbox.id } as any, [
      apiCheckbox,
      el('span', { text: 'AI 接口配置' }),
    ]),
  ]);

  const showCode = actionButton('send', '显示连接码');
  const scanCode = actionButton('scan', '扫一扫连接', 'tonal');
  const actions = el('div', { class: 'btn-row lan-sync-actions' }, [showCode, scanCode]);
  // 一键同步：立即对所有已配对设备做一次 join，不等 30 分钟轮询。
  const syncAllBtn = actionButton('retry', '一键同步所有设备', 'tonal');
  const syncAllRow = el('div', { class: 'btn-row lan-sync-syncall-row', style: 'margin-top:8px' } as any, [syncAllBtn]);
  body.append(info, inventoryNote, nameField, allowField, autoSyncField, silentField, peersBox, extrasFieldset, actions, syncAllRow, status);
  if (!available) {
    showCode.disabled = true;
    scanCode.disabled = true;
    syncAllBtn.disabled = true;
    body.append(el('div', {
      class: 'banner warn',
      text: '请在 Android App 里使用家庭同步。',
    }));
  }
  panel.append(head, body);

  let disposed = false;
  let activeSheet: BottomSheetHandle | null = null;
  let hostedSession: HostedLanSyncSession | null = null;
  let scanController: AbortController | null = null;
  let scanner: Scanner | null = null;

  head.onclick = () => {
    const open = panel.classList.toggle('open');
    head.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
    document.body.classList.toggle('lan-sync-panel-active', open);
    if (open) body.removeAttribute('inert');
    else body.setAttribute('inert', '');
  };

  nameInput.onchange = () => {
    try {
      nameInput.value = setLanSyncDeviceName(nameInput.value);
    } catch (error) {
      toast(errorMessage(error));
      nameInput.value = getLanSyncDeviceName();
    }
  };

  showCode.onclick = () => void runHostFlow();
  scanCode.onclick = () => void openScannerSheet();
  syncAllBtn.onclick = () => void runSyncAllFlow();

  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    document.body.classList.remove('lan-sync-panel-active');
    scanController?.abort();
    scanController = null;
    const currentScanner = scanner;
    scanner = null;
    if (currentScanner) void currentScanner.stop();
    activeSheet?.close();
    activeSheet = null;
    const currentHost = hostedSession;
    hostedSession = null;
    if (currentHost) void currentHost.close();
    routeSignal?.removeEventListener('abort', cleanup);
  };
  routeSignal?.addEventListener('abort', cleanup, { once: true });

  return { element: panel, cleanup };

  async function runHostFlow(): Promise<void> {
    if (disposed || hostedSession || !available) return;
    setActionsBusy(true);
    setStatus(status, 'info', '正在准备连接码');
    const resumeAutoSync = await pausePersistentHost();
    try {
      const deviceName = setLanSyncDeviceName(nameInput.value);
      const syncOptions = getSyncOptions();
      const session = await startLanSyncHost({
        signal: routeSignal,
        deviceName,
        onProgress: (progress) => setProgress(status, progress),
        syncOptions,
        choosePolicy: (input) => promptLanSyncPolicy(input),
      });
      if (disposed) {
        await session.close();
        return;
      }
      hostedSession = session;
      const sheet = await openInvitationSheet(session);
      if (disposed) {
        sheet.close();
        return;
      }
      activeSheet = sheet;
      const result = await session.completion;
      if (disposed) return;
      setResultChip(chip, result);
      renderLastResult(status, result);
      toast(resultNeedsAttention(result) ? '同步完成，请查看提示' : `已与${result.peerName}同步`);
      sheet.close();
    } catch (error) {
      if (!disposed && errorMessage(error) !== '同步已取消。') {
        setStatus(status, 'warn', errorMessage(error));
        toast(errorMessage(error), 4200);
      }
    } finally {
      const session = hostedSession;
      hostedSession = null;
      if (session) void session.close();
      const sheet = activeSheet;
      activeSheet = null;
      sheet?.close();
      resumeAutoSync();
      if (!disposed) setActionsBusy(false);
    }
  }

  async function openInvitationSheet(session: HostedLanSyncSession): Promise<BottomSheetHandle> {
    const title = el('h3', { class: 'lan-sync-sheet-title', text: '请让另一台手机扫这个码' });
    const canvas = document.createElement('canvas');
    canvas.className = 'lan-sync-qr';
    canvas.setAttribute('aria-label', '家庭同步连接码');
    const countdown = el('div', { class: 'muted lan-sync-countdown' });
    const close = actionButton('close', '关闭连接码', 'tonal');
    await QRCode.toCanvas(canvas, session.invitation.uri, {
      width: 320,
      margin: 4,
      errorCorrectionLevel: 'M',
      color: { dark: '#151918', light: '#ffffff' },
    });
    let timer = 0;
    let sheet!: BottomSheetHandle;
    const updateCountdown = () => {
      const seconds = Math.max(0, Math.ceil((session.invitation.expiresAt - Date.now()) / 1_000));
      countdown.textContent = seconds > 0 ? `还可使用 ${seconds} 秒` : '连接码已过期';
      if (seconds === 0) {
        setStatus(status, 'warn', '这个连接码已经过期，请重新生成。');
        sheet.close();
      }
    };
    sheet = openBottomSheet({
      label: '家庭同步连接码',
      content: [title, canvas, countdown, close],
      initialFocus: close,
      onClose: () => {
        window.clearInterval(timer);
        if (activeSheet === sheet) activeSheet = null;
        if (hostedSession === session) void session.close();
      },
    });
    close.onclick = () => sheet.close();
    updateCountdown();
    timer = window.setInterval(updateCountdown, 1_000);
    return sheet;
  }

  async function openScannerSheet(): Promise<void> {
    if (disposed || scanController || !available) return;
    setActionsBusy(true);
    const controller = new AbortController();
    scanController = controller;
    const reader = el('div', { class: 'lan-sync-reader' });
    reader.id = `lan-sync-reader-${Date.now()}-${panelSequence}`;
    const scanStatus = el('div', {
      class: 'banner info',
      role: 'status',
      'aria-live': 'polite',
      text: '请对准另一台手机上的连接码',
    } as any);
    const albumInput = el('input', {
      type: 'file',
      accept: 'image/*',
      hidden: true,
      'aria-label': '从相册选择连接码',
    } as any) as HTMLInputElement;
    const album = actionButton('image', '从相册选择', 'tonal');
    const close = actionButton('close', '关闭', 'text');
    const actionRow = el('div', { class: 'btn-row lan-sync-scan-actions' }, [album, close]);
    let processing = false;
    let sheet!: BottomSheetHandle;
    const stopScanner = async () => {
      const current = scanner;
      scanner = null;
      if (current) await current.stop();
    };
    const finish = () => {
      controller.abort();
      void stopScanner();
      if (scanController === controller) scanController = null;
      if (activeSheet === sheet) activeSheet = null;
      if (!disposed) setActionsBusy(false);
    };
    sheet = openBottomSheet({
      label: '扫一扫连接',
      content: [el('h3', { class: 'lan-sync-sheet-title', text: '扫一扫连接' }), reader, scanStatus, actionRow, albumInput],
      initialFocus: close,
      onClose: finish,
    });
    activeSheet = sheet;
    close.onclick = () => sheet.close();
    album.onclick = () => albumInput.click();
    albumInput.onchange = async () => {
      const file = albumInput.files?.[0];
      albumInput.value = '';
      if (!file || processing || controller.signal.aborted) return;
      const result = await scanCodeFromImage(file);
      if (!result) {
        scanStatus.className = 'banner warn';
        scanStatus.textContent = '没有认出连接码，请换一张更清楚的图片。';
        return;
      }
      await handleInvitation(result.raw);
    };
    try {
      const started = await startScan({
        containerId: reader.id,
        onScan: (result) => void handleInvitation(result.raw),
        onError: () => {
          scanStatus.className = 'banner warn';
          scanStatus.textContent = '相机打不开，也可以从相册选择连接码。';
        },
      });
      if (controller.signal.aborted || disposed) await started.stop();
      else scanner = started;
    } catch {
      scanStatus.className = 'banner warn';
      scanStatus.textContent = '相机打不开，也可以从相册选择连接码。';
    }

    async function handleInvitation(raw: string): Promise<void> {
      if (processing || controller.signal.aborted || disposed) return;
      processing = true;
      await scanner?.pause();
      scanStatus.className = 'banner info';
      scanStatus.textContent = '正在连接';
      const resumeAutoSync = await pausePersistentHost();
      try {
        const result = await joinLanSyncHost(raw, {
          signal: controller.signal,
          deviceName: setLanSyncDeviceName(nameInput.value),
          syncOptions: getSyncOptions(),
          allowRemoteOverwrite: allowOverwrite.checked,
          onProgress: (progress) => {
            scanStatus.className = 'banner info';
            scanStatus.textContent = progress.message;
            setProgress(status, progress);
          },
        });
        if (controller.signal.aborted || disposed) return;
        setResultChip(chip, result);
        renderLastResult(status, result);
        toast(resultNeedsAttention(result) ? '同步完成，请查看提示' : `已与${result.peerName}同步`);
        sheet.close();
      } catch (error) {
        if (controller.signal.aborted || disposed) return;
        scanStatus.className = 'banner warn';
        scanStatus.textContent = errorMessage(error);
        processing = false;
        await scanner?.resume();
      } finally {
        resumeAutoSync();
      }
    }
  }

  function getSyncOptions(): LanSyncContentOptions | undefined {
    const photos = photosCheckbox.checked;
    const apiConfig = apiCheckbox.checked;
    if (!photos && !apiConfig) return undefined;
    return { photos, apiConfig };
  }

  function setActionsBusy(busy: boolean): void {
    showCode.disabled = busy || !available;
    scanCode.disabled = busy || !available;
    syncAllBtn.disabled = busy || !available;
    for (const button of [showCode, scanCode, syncAllBtn]) {
      if (busy) button.setAttribute('aria-busy', 'true');
      else button.removeAttribute('aria-busy');
    }
  }

  async function runSyncAllFlow(): Promise<void> {
    if (disposed || !available) return;
    if (syncAllBtn.getAttribute('aria-busy') === 'true') return;
    const peers = listKnownPeers();
    if (peers.length === 0) {
      toast('还没有已配对设备，请先扫码配对一次');
      return;
    }
    setActionsBusy(true);
    setStatus(status, 'info', `正在同步 ${peers.length} 台设备...`);
    try {
      const summary: ManualJoinSummary = await triggerManualJoinAll();
      if (disposed) return;
      const parts: string[] = [];
      if (summary.joined > 0) parts.push(`已同步 ${summary.joined} 台`);
      if (summary.skipped > 0) parts.push(`跳过 ${summary.skipped} 台（请手动确认）`);
      if (summary.failed > 0) parts.push(`失败 ${summary.failed} 台`);
      const message = parts.length > 0
        ? parts.join('，')
        : '没有需要同步的设备';
      const tone: 'ok' | 'warn' = summary.failed > 0 ? 'warn' : 'ok';
      setStatus(status, tone, message);
      toast(message);
      // 同步完成后刷新最近一次结果展示
      const latest = getLastLanSyncResult();
      if (latest) renderLastResult(status, latest);
    } catch (error) {
      if (disposed) return;
      setStatus(status, 'warn', errorMessage(error));
      toast(errorMessage(error), 4200);
    } finally {
      if (!disposed) setActionsBusy(false);
    }
  }
}

function actionButton(
  iconName: Parameters<typeof icon>[0],
  label: string,
  tone = '',
): HTMLButtonElement {
  const button = el('button', {
    class: `btn ${tone}`.trim(),
    type: 'button',
  } as any) as HTMLButtonElement;
  button.append(icon(iconName), el('span', { text: label }));
  return button;
}

function setProgress(element: HTMLElement, progress: LanSyncProgress): void {
  setStatus(element, progress.stage === 'complete' ? 'ok' : 'info', progress.message);
}

function setStatus(element: HTMLElement, tone: 'info' | 'ok' | 'warn', message: string): void {
  element.className = `lan-sync-status banner ${tone}`;
  element.textContent = message;
}

function renderLastResult(element: HTMLElement, result: LanSyncSessionResult | null): void {
  if (!result) {
    element.className = 'lan-sync-status muted';
    element.textContent = '还没有同步过';
    return;
  }
  const when = new Date(result.completedAt).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const notices: string[] = [];
  if (result.conflictCount > 0) {
    notices.push(`请核对 ${result.conflictCount} 条同时修改的资料`);
  }
  if (result.inventoryConflicts.length > 0) {
    notices.push(`请核对 ${result.inventoryConflicts.length} 条同时修改的药品资料`);
  }
  if (result.remindersNeedAttention) {
    notices.push('请重新打开应用后检查提醒');
  }
  setStatus(
    element,
    notices.length > 0 ? 'warn' : 'ok',
    notices.length > 0
      ? `${when} 已同步；${notices.join('；')}。`
      : `${when} 已与${result.peerName}同步`,
  );
}

function resultNeedsAttention(result: LanSyncSessionResult): boolean {
  return result.conflictCount > 0 ||
    result.inventoryConflicts.length > 0 ||
    result.remindersNeedAttention;
}

function setResultChip(chip: HTMLElement, result: LanSyncSessionResult): void {
  const needsAttention = resultNeedsAttention(result);
  chip.className = `panel-chip ${needsAttention ? 'tone-warn' : 'tone-ok'}`;
  chip.textContent = needsAttention ? '需检查' : '已同步';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '资料没有传完，请重新同步。';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function deviceCard(title: string, summary: LanDeviceSummary, recommended: boolean): HTMLElement {
  const card = el('div', {
    style: `padding:12px 14px;border-radius:14px;border:1px solid ${recommended ? 'var(--color-primary)' : 'var(--color-border,#eeedf2)'};background:var(--color-surface,#fff);`,
  } as any);
  card.append(
    el('div', {
      style: 'display:flex;justify-content:space-between;gap:8px;align-items:center',
    } as any, [
      el('strong', { text: title }),
      recommended
        ? el('span', {
          style: 'font-size:11px;font-weight:700;color:var(--color-primary)',
          text: '推荐',
        } as any)
        : el('span', { text: '' }),
    ]),
    el('div', { class: 'muted', style: 'font-size:13px;margin-top:6px;line-height:1.45' } as any, [
      el('div', { text: `设备：${summary.deviceName}` }),
      el('div', { text: `本机数据更新：${formatLanTime(summary.dataUpdatedAt)}` }),
      el('div', { text: `同步版本时钟：${summary.maxClock || '—'}` }),
      el('div', { text: `药品 ${summary.medicationCount} · 含库存记录 ${summary.withInventoryCount}` }),
      el('div', { text: `本机库存摘要：${summary.inventoryHint}` }),
    ]),
  );
  return card;
}

function promptLanSyncPolicy(input: {
  local: LanDeviceSummary;
  remote: LanDeviceSummary;
  recommended: LanSyncPolicy;
}): Promise<LanSyncPolicy> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (policy: LanSyncPolicy) => {
      if (settled) return;
      settled = true;
      sheet.close();
      resolve(policy);
    };
    const title = el('h3', { class: 'lan-sync-sheet-title', text: '选择同步数据版本' });
    const tip = el('p', {
      class: 'muted',
      style: 'font-size:13px;line-height:1.5;margin:0 0 12px',
      text: '两边都是本地数据。请对照更新时间（尤其库存）选择要保留的版本；推荐项会高亮。',
    } as any);
    const recLocal = input.recommended === 'overwrite-local';
    const recRemote = input.recommended === 'overwrite-remote';
    const cards = el('div', { style: 'display:grid;gap:10px;margin-bottom:12px' } as any, [
      deviceCard('本机', input.local, recLocal),
      deviceCard('对方', input.remote, recRemote),
    ]);
    const recLabel = policyLabel(input.recommended);
    const recBanner = el('div', {
      class: 'banner info',
      style: 'margin-bottom:12px',
    } as any, [
      el('span', { text: `推荐：${recLabel}` }),
    ]);
    const useLocal = actionButton('check', '使用本机覆盖', recLocal ? undefined : 'tonal');
    const useRemote = actionButton('send', '使用对方覆盖', recRemote ? undefined : 'tonal');
    const useMerge = actionButton('info', '智能合并', input.recommended === 'merge' ? undefined : 'tonal');
    useLocal.onclick = () => finish('overwrite-local');
    useRemote.onclick = () => finish('overwrite-remote');
    useMerge.onclick = () => finish('merge');
    const actions = el('div', { class: 'btn-row', style: 'flex-wrap:wrap;gap:8px' } as any, [
      useLocal,
      useRemote,
      useMerge,
    ]);
    const sheet = openBottomSheet({
      label: '选择同步方式',
      content: [title, tip, cards, recBanner, actions],
      initialFocus: recRemote ? useRemote : recLocal ? useLocal : useMerge,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(input.recommended);
        }
      },
    });
  });
}
