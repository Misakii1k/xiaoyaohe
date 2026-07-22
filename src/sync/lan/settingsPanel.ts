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
  panelIcon.append(icon('send'));
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
    text: '两台手机的库存数字各自保留，避免同时记录时算错。',
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
  body.append(info, inventoryNote, nameField, extrasFieldset, actions, status);
  if (!available) {
    showCode.disabled = true;
    scanCode.disabled = true;
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
    try {
      const deviceName = setLanSyncDeviceName(nameInput.value);
      const syncOptions = getSyncOptions();
      const session = await startLanSyncHost({
        signal: routeSignal,
        deviceName,
        onProgress: (progress) => setProgress(status, progress),
        syncOptions,
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
      try {
        const result = await joinLanSyncHost(raw, {
          signal: controller.signal,
          deviceName: setLanSyncDeviceName(nameInput.value),
          syncOptions: getSyncOptions(),
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
    for (const button of [showCode, scanCode]) {
      if (busy) button.setAttribute('aria-busy', 'true');
      else button.removeAttribute('aria-busy');
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
