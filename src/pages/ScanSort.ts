// 扫码分药页：条形码/追溯码、智能扫药盒、批量拍药单。
import { startScan, scanCodeFromImage, type Scanner } from '../features/scanner';
import {
  identifyByCode,
  bindCodeToMed,
  augmentIdentity,
  findMedByPhotoHash,
} from '../features/identify';
import { formatExpiry, type ProductKey } from '../features/gs1';
import {
  deleteRule,
  listMeds,
  listRulesByMed,
  putMed,
  putPhoto,
  putRule,
  uid,
} from '../db/local';
import {
  SLOTS,
  SLOT_DEFAULT_TIME,
  SLOT_LABEL,
  defaultEscalate,
  formatMealRelsBySlot,
  mealRelsFromBySlot,
  emptyIdentity,
  type MealRelsBySlot,
  type Medication,
  type ReminderRule,
  type Slot,
} from '../db/schema';
import { el, renderPage, toast, slotTag, icon, banner, confirmDialog } from '../ui/components';
import { navigate } from '../router';
import {
  identifyByBlob,
  identifyPrescriptionSheetByBlob,
  IdentifyError,
  type IdentifyResult,
  type PrescriptionItemDraft,
} from '../ai/identify';
import { aHash } from '../features/phash';
import { setPendingPrefill } from '../ai/pendingPrefill';
import { rescheduleMedicationReminders } from '../features/reminderScheduler';

type ScanMode = 'code' | 'smart' | 'sheet';

interface ContinueAction {
  label: string;
  run: () => void | Promise<void>;
}

export type MedicationDiffField = 'name' | 'dosageText' | 'amountPerDose' | 'slots';

export interface MedicationFieldDiff {
  field: MedicationDiffField;
  label: string;
  current: string;
  recognized: string;
  changed: boolean;
  applicable: boolean;
}

interface PrescriptionReviewItem {
  id: string;
  name: string;
  dosageText: string;
  amountPerDose: string;
  slots: Slot[];
  mealRelsBySlot: MealRelsBySlot;
  notes: string;
  confidence: number;
  selected: boolean;
  saved: boolean;
}

export interface PrescriptionMedicationInput {
  name: string;
  dosageText: string;
  amountPerDose: string;
  slots: Slot[];
  mealRelsBySlot: MealRelsBySlot;
  notes: string;
}

let fieldSequence = 0;

/**
 * The route handler returns cleanup immediately. Camera startup and AI work can
 * then be cancelled logically without waiting for a permission prompt to end.
 */
export function renderScanSortPage(root: HTMLElement, routeSignal?: AbortSignal): () => void {
  if (routeSignal?.aborted) return () => undefined;
  let disposed = false;
  let mode: ScanMode = 'code';
  let scanner: Scanner | null = null;
  let switchSequence = 0;
  let operationSequence = 0;
  let handlingLiveResult = false;
  const cameraCapture = new CameraCaptureController();

  const content = el('div', { class: 'page scan-workbench' });
  const modeBar = el('div', {
    class: 'scan-mode-bar',
    role: 'tablist',
    'aria-label': '扫码方式',
  } as any);
  const panel = el('div', {
    id: 'scan-mode-panel',
    role: 'tabpanel',
  } as any);
  const reader = el('div', { id: 'code-reader' });
  const hint = el('div', {
    class: 'banner info',
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'true',
  } as any);
  const resultBox = el('div', {
    id: 'scan-result',
    role: 'status',
    'aria-live': 'polite',
    'aria-busy': 'false',
  } as any);

  const codeFile = fileInput('从相册识别条码');
  const smartFile = fileInput('上传药盒照片');
  const sheetFile = fileInput('上传药单照片');

  const buttons: Record<ScanMode, HTMLButtonElement> = {
    code: modeButton('扫条码', 'box', 'scan-tab-code'),
    smart: modeButton('智能扫', 'camera', 'scan-tab-smart'),
    sheet: modeButton('拍药单', 'sparkles', 'scan-tab-sheet'),
  };
  const modeOrder: ScanMode[] = ['code', 'smart', 'sheet'];

  for (const key of modeOrder) {
    buttons[key].onclick = () => void switchMode(key);
    buttons[key].onkeydown = (event) => {
      const current = modeOrder.indexOf(key);
      let next = current;
      if (event.key === 'ArrowRight') next = (current + 1) % modeOrder.length;
      else if (event.key === 'ArrowLeft') next = (current - 1 + modeOrder.length) % modeOrder.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = modeOrder.length - 1;
      else return;
      event.preventDefault();
      const nextMode = modeOrder[next];
      buttons[nextMode].focus();
      void switchMode(nextMode);
    };
  }

  modeBar.append(buttons.code, buttons.smart, buttons.sheet);
  panel.append(reader, hint, resultBox);
  content.append(modeBar, panel, codeFile, smartFile, sheetFile);

  codeFile.onchange = async () => {
    const file = codeFile.files?.[0];
    codeFile.value = '';
    if (!file || disposed || mode !== 'code') return;
    const operation = ++operationSequence;
    await runCodeImage(file, resultBox, hint, {
      isCurrent: () => isOperationCurrent(operation, 'code'),
      continueAction: { label: '继续从相册识别', run: () => codeFile.click() },
    });
  };
  smartFile.onchange = async () => {
    const file = smartFile.files?.[0];
    smartFile.value = '';
    if (!file || disposed || mode !== 'smart') return;
    const operation = ++operationSequence;
    await runSmartScan(file, resultBox, hint, {
      isCurrent: () => isOperationCurrent(operation, 'smart'),
      continueAction: { label: '继续智能扫', run: renderSmartStart },
    });
  };
  sheetFile.onchange = async () => {
    const file = sheetFile.files?.[0];
    sheetFile.value = '';
    if (!file || disposed || mode !== 'sheet') return;
    const operation = ++operationSequence;
    await runPrescriptionSheet(file, resultBox, hint, {
      isCurrent: () => isOperationCurrent(operation, 'sheet'),
      onAddImage: () => sheetFile.click(),
    });
  };

  renderPage({ root, title: '扫码分药', activeTab: 'scan', content });
  void switchMode('code');

  function isOperationCurrent(operation: number, expectedMode: ScanMode): boolean {
    return !disposed && mode === expectedMode && operation === operationSequence;
  }

  async function switchMode(next: ScanMode): Promise<void> {
    const currentSwitch = ++switchSequence;
    operationSequence += 1;
    mode = next;
    updateModeButtons(buttons, mode);
    panel.setAttribute('aria-labelledby', buttons[mode].id);
    cameraCapture.stop();
    const previous = scanner;
    scanner = null;
    if (previous) await previous.stop();
    if (disposed || currentSwitch !== switchSequence) return;

    resultBox.replaceChildren();
    setResultBusy(resultBox, false);
    if (mode === 'code') {
      reader.style.display = '';
      setHint(hint, 'info', '把药盒上的条形码或追溯码对准取景框');
      let failureMessage = '';
      try {
        const started = await startScan({
          containerId: reader.id,
          onScan: (result) => void handleLiveScan(result.raw),
          onError: (message) => {
            failureMessage = message;
            if (!disposed && mode === 'code' && currentSwitch === switchSequence) {
              renderScannerUnavailable(message);
            }
          },
        });
        if (disposed || mode !== 'code' || currentSwitch !== switchSequence) {
          await started.stop();
          return;
        }
        scanner = started;
      } catch {
        if (!disposed && mode === 'code' && currentSwitch === switchSequence) {
          renderScannerUnavailable(failureMessage || '无法启动摄像头扫码。');
        }
      }
      return;
    }

    reader.style.display = 'none';
    if (mode === 'smart') renderSmartStart();
    else renderSheetStart();
  }

  async function handleLiveScan(raw: string): Promise<void> {
    if (disposed || mode !== 'code' || handlingLiveResult) return;
    handlingLiveResult = true;
    const operation = ++operationSequence;
    setResultBusy(resultBox, true);
    resultBox.replaceChildren(loadingCard('正在查询…', '已暂停取景，正在匹配这个条码'));
    setHint(hint, 'info', '已扫描，确认结果后可继续');
    try {
      navigator.vibrate?.(60);
      const { key, med } = await identifyByCode(raw);
      if (!isOperationCurrent(operation, 'code')) return;
      const continueAction: ContinueAction = { label: '继续扫描', run: resumeLiveScan };
      if (med) await showMatched(med, key, resultBox, hint, continueAction, () => isOperationCurrent(operation, 'code'));
      else await showUnknownCode(
        key,
        resultBox,
        hint,
        false,
        continueAction,
        () => isOperationCurrent(operation, 'code'),
      );
    } catch (error) {
      if (!isOperationCurrent(operation, 'code')) return;
      resultBox.replaceChildren(banner('warn', `条码处理失败：${errorMessage(error)}`));
      resultBox.append(continueButton({ label: '继续扫描', run: resumeLiveScan }));
      setHint(hint, 'warn', '条码处理失败');
    } finally {
      if (isOperationCurrent(operation, 'code')) setResultBusy(resultBox, false);
      handlingLiveResult = false;
    }
  }

  async function resumeLiveScan(): Promise<void> {
    if (disposed || mode !== 'code') return;
    resultBox.replaceChildren();
    setResultBusy(resultBox, false);
    setHint(hint, 'info', '继续扫描：请移开上一个药盒，再对准下一个条码');
    if (scanner?.state === 'paused') await scanner.resume();
    else if (!scanner || scanner.state === 'stopped') await switchMode('code');
  }

  function renderScannerUnavailable(message: string): void {
    reader.replaceChildren();
    setHint(hint, 'warn', '摄像头不可用');
    resultBox.replaceChildren(banner('warn', message));
    resultBox.append(
      actionCard(
        '无法使用摄像头',
        '允许相机权限后可重试；也可以直接从相册选择清晰的条码图片。',
        '重试',
        () => void switchMode('code'),
        '相册识别',
        () => codeFile.click(),
      ),
    );
  }

  function renderSmartStart(): void {
    if (disposed || mode !== 'smart') return;
    operationSequence += 1;
    setHint(hint, 'info', '拍摄药盒正面；先识别条码，没有码时再识别药名和规格');
    resultBox.replaceChildren(
      actionCard(
        '智能扫药盒',
        '直接打开相机拍药盒正面；相册作为备用入口。',
        '打开相机',
        () => void openSmartCamera(),
        '相册上传',
        () => smartFile.click(),
      ),
    );
    setResultBusy(resultBox, false);
  }

  function renderSheetStart(): void {
    if (disposed || mode !== 'sheet') return;
    operationSequence += 1;
    setHint(hint, 'info', '拍药单或上传相册图片，识别后可在一页中审核全部药品');
    resultBox.replaceChildren(
      actionCard(
        '拍药单',
        '让整张药单平整入镜，药名、剂量和时段尽量不要被遮挡。',
        '打开相机',
        () => void openSheetCamera(),
        '相册上传',
        () => sheetFile.click(),
      ),
    );
    setResultBusy(resultBox, false);
  }

  async function openSmartCamera(): Promise<void> {
    await openCameraCapture({
      title: '智能扫药盒',
      sub: '把药盒正面放进画面，尽量让药名和规格清晰可见。',
      filenamePrefix: 'medicine-box',
      box: resultBox,
      hint,
      controller: cameraCapture,
      isActive: () => !disposed && mode === 'smart',
      onCapture: async (file) => {
        const operation = ++operationSequence;
        await runSmartScan(file, resultBox, hint, {
          isCurrent: () => isOperationCurrent(operation, 'smart'),
          continueAction: { label: '继续智能扫', run: renderSmartStart },
        });
      },
      onAlbum: () => smartFile.click(),
      onClose: renderSmartStart,
    });
  }

  async function openSheetCamera(): Promise<void> {
    await openCameraCapture({
      title: '拍药单',
      sub: '让整张药单铺平入镜，药名、剂量和时段尽量不要被遮挡。',
      filenamePrefix: 'prescription-sheet',
      box: resultBox,
      hint,
      controller: cameraCapture,
      isActive: () => !disposed && mode === 'sheet',
      onCapture: async (file) => {
        const operation = ++operationSequence;
        await runPrescriptionSheet(file, resultBox, hint, {
          isCurrent: () => isOperationCurrent(operation, 'sheet'),
          onAddImage: () => sheetFile.click(),
        });
      },
      onAlbum: () => sheetFile.click(),
      onClose: renderSheetStart,
    });
  }

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    switchSequence += 1;
    operationSequence += 1;
    codeFile.onchange = null;
    smartFile.onchange = null;
    sheetFile.onchange = null;
    cameraCapture.stop();
    const current = scanner;
    scanner = null;
    if (current) void current.stop();
  };
  routeSignal?.addEventListener('abort', cleanup, { once: true });
  return cleanup;
}

async function runCodeImage(
  file: File,
  box: HTMLElement,
  hint: HTMLElement,
  context: { isCurrent: () => boolean; continueAction: ContinueAction },
): Promise<void> {
  if (!context.isCurrent()) return;
  setResultBusy(box, true);
  box.replaceChildren(loadingCard('正在识别条码…', '正在分析相册中的图片'));
  setHint(hint, 'info', '正在识别图片中的条码…');
  const code = await scanCodeFromImage(file);
  if (!context.isCurrent()) return;
  if (!code?.raw) {
    box.replaceChildren(banner('warn', '图片中没有识别到条码。请换一张更清晰、条码更完整的照片。'));
    box.append(continueButton(context.continueAction));
    setHint(hint, 'warn', '没有识别到条码');
    setResultBusy(box, false);
    return;
  }
  const { key, med } = await identifyByCode(code.raw);
  if (!context.isCurrent()) return;
  if (med) await showMatched(med, key, box, hint, context.continueAction, context.isCurrent);
  else await showUnknownCode(key, box, hint, false, context.continueAction, context.isCurrent);
  if (context.isCurrent()) setResultBusy(box, false);
}

async function runSmartScan(
  file: File,
  box: HTMLElement,
  hint: HTMLElement,
  context: { isCurrent: () => boolean; continueAction: ContinueAction },
): Promise<void> {
  if (!context.isCurrent()) return;
  box.replaceChildren(loadingCard('智能扫识别中…', '正在先找条形码或追溯码，再分析药盒文字'));
  setHint(hint, 'info', '智能扫处理中…');
  setResultBusy(box, true);

  const code = await scanCodeFromImage(file);
  if (!context.isCurrent()) return;
  if (code?.raw) {
    const { key, med } = await identifyByCode(code.raw);
    if (!context.isCurrent()) return;
    if (med) await showMatched(med, key, box, hint, context.continueAction, context.isCurrent);
    else await showUnknownCode(key, box, hint, true, context.continueAction, context.isCurrent);
    if (context.isCurrent()) setResultBusy(box, false);
    return;
  }

  const localText = await tryLocalText(file);
  if (!context.isCurrent()) return;
  await runAiIdentify(file, null, box, hint, localText, context);
  if (context.isCurrent()) setResultBusy(box, false);
}

async function runPrescriptionSheet(
  file: File,
  box: HTMLElement,
  hint: HTMLElement,
  context: { isCurrent: () => boolean; onAddImage: () => void },
): Promise<void> {
  box.replaceChildren(loadingCard('药单识别中…', '正在拆分药名、服药时段和剂量'));
  setHint(hint, 'info', 'AI 正在识别药单…');
  setResultBusy(box, true);
  try {
    const result = await identifyPrescriptionSheetByBlob(file);
    if (!context.isCurrent()) return;
    setHint(hint, result.items.length ? 'ok' : 'warn', result.items.length ? `识别到 ${result.items.length} 种药` : '没有识别到药品');
    renderPrescriptionBatch(result.items, file, box, hint, context);
  } catch (error) {
    if (!context.isCurrent()) return;
    const message = error instanceof IdentifyError ? error.message : errorMessage(error);
    box.replaceChildren(banner('warn', `药单识别失败：${message}`));
    const retry = el('button', { class: 'btn tonal', type: 'button', text: '换一张药单' } as any);
    retry.onclick = context.onAddImage;
    box.append(retry);
    setHint(hint, 'warn', '药单识别失败');
  } finally {
    if (context.isCurrent()) setResultBusy(box, false);
  }
}

async function showMatched(
  med: Medication,
  key: ProductKey,
  box: HTMLElement,
  hint: HTMLElement,
  continuation?: ContinueAction,
  isActive: () => boolean = () => true,
): Promise<void> {
  if (!isActive()) return;
  box.replaceChildren();
  setHint(hint, 'ok', '已识别');

  const card = el('div', {
    class: 'card elevated',
    style: 'border:1.5px solid var(--brand)',
  } as any);
  card.append(el('div', { class: 'huge', text: med.name }));
  const tags = el('div', { class: 'scan-slot-tags' });
  if (med.slots.length === 0) tags.append(el('span', { class: 'muted', text: '（未设时段）' }));
  for (const slot of med.slots) tags.append(slotTag(slot));
  card.append(tags);

  const summary = [med.amountPerDose, med.dosageText, formatMealRelsBySlot(med.mealRelsBySlot, med.slots)]
    .filter(Boolean)
    .join(' · ');
  if (summary) card.append(el('div', { class: 'big', text: summary }));

  if (med.slots.length > 0) {
    card.append(banner('ok', `请放入：${med.slots.map((slot) => SLOT_LABEL[slot]).join('、')} 药盒`));
  }
  if (key.parsed?.expiry) {
    const expiry = formatExpiry(key.parsed.expiry);
    if (expiry) card.append(el('div', { class: 'muted', text: `有效期至 ${expiry}`, style: 'margin-top:8px' } as any));
  }

  const rules = await listRulesByMed(med.id);
  if (!isActive()) return;
  const actions = el('div', { class: 'btn-row scan-actions' });
  const edit = iconButton('edit', '进入填表', 'btn outlined');
  edit.onclick = () => {
    if (isActive()) navigate(`/meds/${med.id}/edit`);
  };
  actions.append(edit);
  if (rules.length > 0) {
    const today = iconButton('check', '查看今日日程', 'btn success');
    today.onclick = async () => {
      if (!isActive()) return;
      const confirmed = await confirmDialog('已找到这味药的服药日程，是否查看今天的待办？', '查看今天');
      if (isActive() && confirmed) navigate('/today');
    };
    actions.append(today);
  }
  if (continuation) actions.append(continueButton(continuation));
  card.append(actions);
  box.append(card);
}

async function showUnknownCode(
  key: ProductKey,
  box: HTMLElement,
  hint: HTMLElement,
  fromSmartScan: boolean,
  continuation?: ContinueAction,
  isActive: () => boolean = () => true,
): Promise<void> {
  if (!isActive()) return;
  setHint(hint, 'warn', '数据库中没有这条记录');
  box.replaceChildren();
  const card = el('div', { class: 'card' });
  card.append(el('div', { class: 'big', text: '这是什么药？' }));
  card.append(el('div', {
    class: 'muted',
    text: key.kind === 'gtin' ? `产品码 GTIN：${key.value}` : `码：${key.value.slice(0, 48)}`,
  }));

  const input = el('input', { type: 'text', placeholder: '填写药名，例如：阿司匹林肠溶片' }) as HTMLInputElement;
  card.append(fieldLite('药名', input));

  const save = iconButton('check', fromSmartScan ? '保存并继续填表' : '保存绑定', 'btn success');
  save.onclick = async () => {
    if (!isActive()) return;
    const name = input.value.trim();
    if (!name) {
      toast('请先填写药名');
      input.focus();
      return;
    }
    const med = newMedication(name, key);
    await putMed(med);
    if (!isActive()) return;
    toast('已保存，下次扫码会自动识别');
    if (fromSmartScan) navigate(`/meds/${med.id}/edit`);
    else await showMatched(med, key, box, hint, continuation, isActive);
  };
  card.append(save);

  const meds = await listMeds();
  if (!isActive()) return;
  if (meds.length > 0) {
    card.append(el('div', { class: 'muted', text: '或绑定到已有药品：', style: 'margin-top:14px' } as any));
    const list = el('div', { class: 'scan-existing-list' });
    for (const med of meds) {
      const button = el('button', { class: 'btn tonal', type: 'button', text: med.name } as any);
      button.onclick = async () => {
        if (!isActive()) return;
        await bindCodeToMed(med.id, key);
        if (!isActive()) return;
        toast(`已绑定到「${med.name}」`);
        await showMatched(med, key, box, hint, continuation, isActive);
      };
      list.append(button);
    }
    card.append(list);
  }
  if (continuation) card.append(continueButton(continuation));
  box.append(card);
}

async function runAiIdentify(
  file: File,
  key: ProductKey | null,
  box: HTMLElement,
  hint: HTMLElement,
  localText: string,
  context: { isCurrent: () => boolean; continueAction: ContinueAction },
  options: { skipPhotoSimilarity?: boolean } = {},
): Promise<void> {
  if (!context.isCurrent()) return;
  box.replaceChildren(loadingCard('正在识别药盒…', options.skipPhotoSimilarity ? '已排除相似照片，继续使用 AI 识别' : '正在比对历史照片和药盒文字'));
  setHint(hint, 'info', 'AI 正在识别药盒…');
  setResultBusy(box, true);

  let photoHash = '';
  try {
    photoHash = await aHash(file);
  } catch {
    /* A perceptual hash is an optimization; AI identification can continue. */
  }
  if (!context.isCurrent()) return;

  if (photoHash && !options.skipPhotoSimilarity) {
    const similar = await findMedByPhotoHash(photoHash);
    if (!context.isCurrent()) return;
    if (similar) {
      showSimilar(file, key, photoHash, similar.med, similar.distance, box, hint, localText, context);
      setResultBusy(box, false);
      return;
    }
  }

  let result: IdentifyResult;
  try {
    result = await identifyByBlob(file, localText ? `本地识别到的文字：${localText}` : undefined);
  } catch (error) {
    if (!context.isCurrent()) return;
    const message = error instanceof IdentifyError ? error.message : errorMessage(error);
    box.replaceChildren(banner('warn', `识别失败：${message}`), continueButton(context.continueAction));
    setHint(hint, 'warn', 'AI 识别失败');
    setResultBusy(box, false);
    return;
  }
  if (!context.isCurrent()) return;

  if (!result.name) {
    box.replaceChildren(banner('warn', '没认出来这是什么药，请重拍或手动新增。'), continueButton(context.continueAction));
    setHint(hint, 'warn', '未识别');
    setResultBusy(box, false);
    return;
  }
  await showAiResult(result, key, file, photoHash, box, hint, context);
  if (context.isCurrent()) setResultBusy(box, false);
}

function showSimilar(
  file: File,
  key: ProductKey | null,
  photoHash: string,
  med: Medication,
  distance: number,
  box: HTMLElement,
  hint: HTMLElement,
  localText: string,
  context: { isCurrent: () => boolean; continueAction: ContinueAction },
): void {
  if (!context.isCurrent()) return;
  box.replaceChildren();
  setHint(hint, 'info', '发现相似药盒');
  const card = el('div', { class: 'card' });
  card.append(el('div', { class: 'big', text: `看起来像「${med.name}」？` }));
  card.append(el('div', { class: 'muted', text: `历史照片相似度高（汉明距 ${distance}）` }));
  const yes = el('button', { class: 'btn success', type: 'button', text: '是的，归并' } as any);
  yes.onclick = async () => {
    if (!context.isCurrent()) return;
    if (key) await bindCodeToMed(med.id, key);
    await augmentIdentity(med.id, { photoHashes: [photoHash] });
    await savePhoto(file, med.id);
    if (!context.isCurrent()) return;
    toast(`已归并到「${med.name}」`);
    await showMatched(med, key ?? { kind: 'raw', value: '' }, box, hint, context.continueAction, context.isCurrent);
  };
  const no = el('button', { class: 'btn tonal', type: 'button', text: '不是，继续 AI 识别' } as any);
  no.onclick = () => {
    if (!context.isCurrent()) return;
    // Carry the rejection into the next call so the same pHash cannot loop.
    void runAiIdentify(file, key, box, hint, localText, context, { skipPhotoSimilarity: true });
  };
  const row = el('div', { class: 'btn-row scan-actions' });
  row.append(yes, no, continueButton(context.continueAction));
  card.append(row);
  box.append(card);
}

async function showAiResult(
  result: IdentifyResult,
  key: ProductKey | null,
  file: File,
  photoHash: string,
  box: HTMLElement,
  hint: HTMLElement,
  context: { isCurrent: () => boolean; continueAction: ContinueAction },
): Promise<void> {
  if (!context.isCurrent()) return;
  box.replaceChildren();
  setHint(hint, 'ok', '已识别');

  const meds = await listMeds();
  if (!context.isCurrent()) return;
  const existing = findExistingByName(meds, result.name);
  const card = el('div', { class: 'card' });
  card.append(el('div', { class: 'huge', text: result.name }));
  const summary = [result.dosageText, result.amountPerDose, formatMealRelsBySlot(result.mealRelsBySlot, result.slots)]
    .filter(Boolean)
    .join(' · ');
  if (summary) card.append(el('div', { class: 'big', text: summary }));
  card.append(el('div', { class: 'muted', text: `置信度 ${Math.round(result.confidence * 100)}%` }));

  const primary = iconButton('plus', existing ? '审核并更新已有药品' : '新建为药品（自动填表）', 'btn');
  primary.onclick = () => {
    if (!context.isCurrent()) return;
    if (existing) {
      showMedicationDiff(existing, result, key, photoHash, file, box, hint, context);
      return;
    }
    setPendingPrefill({ result, photoBlob: file, aHash: photoHash });
    if (key) sessionStorage.setItem('medbox.prefill.code', JSON.stringify(key));
    navigate('/meds/new');
  };
  card.append(primary);

  if (meds.length > 0) {
    card.append(el('div', { class: 'muted', text: '选择已有药品并审核字段差异：', style: 'margin-top:14px' } as any));
    for (const med of rankMeds(meds, result.name)) {
      if (med.id === existing?.id) continue;
      const button = el('button', { class: 'btn tonal scan-merge-btn', type: 'button', text: med.name } as any);
      button.onclick = () => showMedicationDiff(med, result, key, photoHash, file, box, hint, context);
      card.append(button);
    }
  }
  card.append(continueButton(context.continueAction));
  box.append(card);
}

function showMedicationDiff(
  med: Medication,
  result: IdentifyResult,
  key: ProductKey | null,
  photoHash: string,
  file: File,
  box: HTMLElement,
  hint: HTMLElement,
  context: { isCurrent: () => boolean; continueAction: ContinueAction },
): void {
  if (!context.isCurrent()) return;
  const diffs = buildMedicationFieldDiff(med, result);
  const selected = new Set<MedicationDiffField>(
    diffs.filter((diff) => diff.changed && diff.applicable).map((diff) => diff.field),
  );
  box.replaceChildren();
  setHint(hint, 'info', '请确认要更新的字段');
  const section = el('div', { class: 'card' });
  section.append(el('div', { class: 'big', text: `更新「${med.name}」` }));
  section.append(el('div', { class: 'muted', text: '只会应用勾选字段；条码和照片证据会在确认后归并。' }));

  for (const diff of diffs) {
    const row = el('div', { class: 'prescription-item' });
    const id = nextFieldId('scan-diff');
    const checkbox = el('input', {
      id,
      type: 'checkbox',
      checked: selected.has(diff.field),
      disabled: !diff.changed || !diff.applicable,
    } as any) as HTMLInputElement;
    checkbox.onchange = () => {
      if (checkbox.checked) selected.add(diff.field);
      else selected.delete(diff.field);
    };
    const label = el('label', { htmlFor: id, text: diff.label } as any);
    row.append(checkbox, label);
    row.append(el('div', { class: 'muted', text: `当前：${diff.current || '未填写'}` }));
    row.append(el('div', { text: `识别：${diff.recognized || '未识别（不会覆盖）'}` }));
    if (!diff.changed && diff.applicable) row.append(el('div', { class: 'muted', text: '内容一致' }));
    section.append(row);
  }

  const apply = iconButton('check', '应用所选并归并', 'btn success');
  apply.onclick = async () => {
    if (!context.isCurrent()) return;
    apply.disabled = true;
    setResultBusy(box, true);
    try {
      const updated = await mergeIdentifyIntoExisting(med, result, key, photoHash, file, selected);
      if (!context.isCurrent()) return;
      toast('已应用所选字段并归并识别证据');
      await showMatched(updated, key ?? { kind: 'raw', value: '' }, box, hint, context.continueAction, context.isCurrent);
    } finally {
      if (context.isCurrent()) setResultBusy(box, false);
    }
  };
  const cancel = el('button', { class: 'btn outlined', type: 'button', text: '返回识别结果' } as any);
  cancel.onclick = () => {
    if (context.isCurrent()) void showAiResult(result, key, file, photoHash, box, hint, context);
  };
  const actions = el('div', { class: 'btn-row scan-actions' });
  actions.append(apply, cancel);
  section.append(actions);
  box.append(section);
}

export function buildMedicationFieldDiff(med: Medication, result: IdentifyResult): MedicationFieldDiff[] {
  const values: Array<Omit<MedicationFieldDiff, 'changed' | 'applicable'>> = [
    { field: 'name', label: '药品名称', current: med.name, recognized: result.name.trim() },
    { field: 'dosageText', label: '规格', current: med.dosageText, recognized: result.dosageText.trim() },
    { field: 'amountPerDose', label: '每次剂量', current: med.amountPerDose, recognized: result.amountPerDose.trim() },
    {
      field: 'slots',
      label: '服药时段',
      current: formatSlots(med.slots),
      recognized: formatSlots(result.slots),
    },
  ];
  return values.map((value) => ({
    ...value,
    applicable: value.recognized.length > 0,
    changed: value.recognized.length > 0 && value.current !== value.recognized,
  }));
}

export function applyMedicationFieldDiff(
  med: Medication,
  result: IdentifyResult,
  selected: ReadonlySet<MedicationDiffField>,
): Medication {
  const next: Medication = {
    ...med,
    slots: [...med.slots],
    mealRels: [...med.mealRels],
    mealRelsBySlot: cloneMealMap(med.mealRelsBySlot),
    daysOfWeek: [...med.daysOfWeek],
    identity: {
      gtins: [...med.identity.gtins],
      rawCodes: [...med.identity.rawCodes],
      ocrNames: [...med.identity.ocrNames],
      photoHashes: [...med.identity.photoHashes],
    },
  };
  if (selected.has('name') && result.name.trim()) next.name = result.name.trim();
  if (selected.has('dosageText') && result.dosageText.trim()) next.dosageText = result.dosageText.trim();
  if (selected.has('amountPerDose') && result.amountPerDose.trim()) next.amountPerDose = result.amountPerDose.trim();
  if (selected.has('slots') && result.slots.length > 0) {
    next.slots = [...result.slots];
    next.mealRelsBySlot = cloneMealMap(result.mealRelsBySlot);
    next.mealRels = mealRelsFromBySlot(next.mealRelsBySlot);
  }
  return next;
}

export async function mergeIdentifyIntoExisting(
  med: Medication,
  result: IdentifyResult,
  key: ProductKey | null,
  photoHash: string,
  file: File,
  selected: ReadonlySet<MedicationDiffField>,
): Promise<Medication> {
  const updated = applyMedicationFieldDiff(med, result, selected);
  const planChanged = hasPlanFieldChange(selected);
  if (selected.size > 0) await putMed(updated);
  if (planChanged) {
    const existingRules = await listRulesByMed(updated.id);
    await syncRecognizedMedicationRules(updated, existingRules);
    await rescheduleMedicationReminders();
  }
  if (key) await bindCodeToMed(updated.id, key);
  await augmentIdentity(updated.id, {
    gtins: result.evidence.gtins,
    rawCodes: result.evidence.rawCodes,
    ocrNames: [result.name, ...result.evidence.ocrNames],
    photoHashes: photoHash ? [photoHash] : [],
  });
  if (photoHash) await savePhoto(file, updated.id);
  return updated;
}

function renderPrescriptionBatch(
  drafts: PrescriptionItemDraft[],
  file: File,
  box: HTMLElement,
  hint: HTMLElement,
  context: { isCurrent: () => boolean; onAddImage: () => void },
): void {
  const items = drafts.map(prescriptionReviewItem);
  let saving = false;

  const render = () => {
    if (!context.isCurrent()) return;
    box.replaceChildren();
    const section = el('div', { class: 'card prescription-results' });
    section.append(el('div', { class: 'big', text: '药单批量审核' }));
    section.append(el('div', {
      class: 'muted',
      text: '逐项核对名称、规格、剂量和时段；可取消勾选、添加空白项，再一次保存全部选中项。',
    }));
    if (!items.length) section.append(el('div', { class: 'muted', text: '没有识别到药品，可添加空白项手动录入。' }));
    for (const item of items) section.append(renderPrescriptionEditor(item, saveItems));

    const addBlank = iconButton('plus', '添加空白项', 'btn tonal');
    addBlank.onclick = () => {
      items.push(prescriptionReviewItem({
        name: '',
        dosageText: '',
        amountPerDose: '',
        slots: [],
        mealRels: [],
        mealRelsBySlot: {},
        notes: '',
        confidence: 0,
      }));
      render();
    };
    const saveAll = iconButton('check', '保存全部选中项', 'btn success');
    saveAll.disabled = saving || !items.some((item) => item.selected && !item.saved);
    saveAll.onclick = () => void saveItems(items.filter((item) => item.selected && !item.saved));
    const another = iconButton('camera', '再拍一张药单', 'btn outlined');
    another.onclick = () => {
      if (context.isCurrent()) context.onAddImage();
    };
    const actions = el('div', { class: 'btn-row scan-actions' });
    actions.append(addBlank, saveAll, another);
    section.append(actions);
    box.append(section);
  };

  const saveItems = async (targets: PrescriptionReviewItem[]) => {
    if (saving || !context.isCurrent()) return;
    const pending = targets.filter((item) => !item.saved);
    const missingName = pending.find((item) => !item.name.trim());
    if (!pending.length) {
      toast('没有待保存的药品');
      return;
    }
    if (missingName) {
      toast('请先补全所有选中项的药名');
      return;
    }
    saving = true;
    setResultBusy(box, true);
    render();
    let savedCount = 0;
    try {
      await persistPrescriptionMedicationBatch(pending, async (med, item) => {
        await savePhoto(file, med.id);
        item.saved = true;
        item.selected = false;
        savedCount += 1;
      });
      if (!context.isCurrent()) return;
      setHint(hint, 'ok', `已添加 ${savedCount} 种药，仍可继续审核其他项目`);
      toast(`已添加 ${savedCount} 种药品`);
    } catch (error) {
      if (!context.isCurrent()) return;
      setHint(hint, 'warn', '部分药品保存失败');
      toast(`保存失败：${errorMessage(error)}`);
    } finally {
      saving = false;
      if (context.isCurrent()) {
        setResultBusy(box, false);
        render();
      }
    }
  };

  render();
}

function renderPrescriptionEditor(
  item: PrescriptionReviewItem,
  saveItems: (targets: PrescriptionReviewItem[]) => Promise<void>,
): HTMLElement {
  const row = el('div', { class: 'prescription-item' });
  const includeId = nextFieldId('prescription-include');
  const include = el('input', {
    id: includeId,
    type: 'checkbox',
    checked: item.selected,
    disabled: item.saved,
  } as any) as HTMLInputElement;
  include.onchange = () => (item.selected = include.checked);
  const includeLabel = el('label', {
    htmlFor: includeId,
    text: item.saved ? '已添加' : '添加此项',
  } as any);
  row.append(include, includeLabel);

  const name = textInput(item.name, '药名');
  name.disabled = item.saved;
  name.oninput = () => (item.name = name.value);
  const spec = textInput(item.dosageText, '规格');
  spec.disabled = item.saved;
  spec.oninput = () => (item.dosageText = spec.value);
  const dose = textInput(item.amountPerDose, '每次剂量');
  dose.disabled = item.saved;
  dose.oninput = () => (item.amountPerDose = dose.value);
  const notes = textInput(item.notes, '备注');
  notes.disabled = item.saved;
  notes.oninput = () => (item.notes = notes.value);
  row.append(fieldLite('药名', name), fieldLite('规格', spec), fieldLite('每次剂量', dose), fieldLite('备注', notes));

  const slotGroup = el('div', { class: 'scan-slot-tags', role: 'group', 'aria-label': '服药时段' } as any);
  for (const slot of SLOTS) {
    const button = el('button', {
      class: 'btn small tonal',
      type: 'button',
      text: SLOT_LABEL[slot],
      disabled: item.saved,
      'aria-pressed': item.slots.includes(slot) ? 'true' : 'false',
    } as any) as HTMLButtonElement;
    const syncAppearance = () => {
      const selected = item.slots.includes(slot);
      button.className = `btn small ${selected ? 'success' : 'tonal'}`;
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    };
    button.onclick = () => {
      if (item.slots.includes(slot)) item.slots = item.slots.filter((value) => value !== slot);
      else item.slots = SLOTS.filter((value) => value === slot || item.slots.includes(value));
      syncAppearance();
    };
    syncAppearance();
    slotGroup.append(button);
  }
  row.append(slotGroup);
  if (!item.saved) {
    const save = iconButton('plus', '保存此项', 'btn small success');
    save.onclick = () => void saveItems([item]);
    row.append(save);
  }
  return row;
}

function prescriptionReviewItem(item: PrescriptionItemDraft): PrescriptionReviewItem {
  return {
    id: uid(),
    name: item.name,
    dosageText: item.dosageText,
    amountPerDose: item.amountPerDose,
    slots: [...item.slots],
    mealRelsBySlot: cloneMealMap(item.mealRelsBySlot),
    notes: item.notes,
    confidence: item.confidence,
    selected: true,
    saved: false,
  };
}

function medicationFromPrescriptionItem(item: PrescriptionMedicationInput): Medication {
  const mealRelsBySlot = Object.fromEntries(
    Object.entries(item.mealRelsBySlot).filter(([slot]) => item.slots.includes(slot as Slot)),
  ) as MealRelsBySlot;
  const identity = emptyIdentity();
  identity.ocrNames.push(item.name.trim());
  return {
    id: uid(),
    name: item.name.trim(),
    dosageText: item.dosageText.trim(),
    amountPerDose: item.amountPerDose.trim(),
    slots: [...item.slots],
    mealRels: mealRelsFromBySlot(mealRelsBySlot),
    mealRelsBySlot,
    daysOfWeek: [],
    notes: item.notes.trim() || undefined,
    identity,
    updatedAt: 0,
    createdAt: Date.now(),
  };
}

export async function persistPrescriptionMedicationBatch<T extends PrescriptionMedicationInput>(
  items: readonly T[],
  afterSave?: (med: Medication, item: T) => void | Promise<void>,
): Promise<Medication[]> {
  const saved: Medication[] = [];
  let saveError: unknown;
  try {
    for (const item of items) {
      const med = medicationFromPrescriptionItem(item);
      await putMed(med);
      await syncRecognizedMedicationRules(med, []);
      saved.push(med);
      await afterSave?.(med, item);
    }
  } catch (error) {
    saveError = error;
  }

  let rescheduleError: unknown;
  if (saved.length > 0) {
    try {
      await rescheduleMedicationReminders();
    } catch (error) {
      rescheduleError = error;
    }
  }
  if (saveError) throw saveError;
  if (rescheduleError) throw rescheduleError;
  return saved;
}

async function syncRecognizedMedicationRules(
  med: Medication,
  existingRules: readonly ReminderRule[],
): Promise<void> {
  const selectedSlots = new Set(med.slots);
  const existingSlots = new Set<Slot>();

  for (const rule of existingRules) {
    if (!selectedSlots.has(rule.slot)) {
      await deleteRule(rule.id);
      continue;
    }
    existingSlots.add(rule.slot);
    // putRule snapshots the updated medication even when the time is unchanged.
    await putRule({ ...rule });
  }

  for (const slot of SLOTS) {
    if (!selectedSlots.has(slot) || existingSlots.has(slot)) continue;
    await putRule({
      id: uid(),
      medId: med.id,
      slot,
      timeLocal: SLOT_DEFAULT_TIME[slot],
      enabled: true,
      escalate: defaultEscalate(),
      updatedAt: 0,
    });
  }
}

function hasPlanFieldChange(selected: ReadonlySet<MedicationDiffField>): boolean {
  return selected.has('dosageText') || selected.has('amountPerDose') || selected.has('slots');
}

function newMedication(name: string, key: ProductKey): Medication {
  const med: Medication = {
    id: uid(),
    name,
    dosageText: '',
    amountPerDose: '',
    slots: [],
    mealRels: [],
    mealRelsBySlot: {},
    daysOfWeek: [],
    identity: emptyIdentity(),
    updatedAt: 0,
    createdAt: Date.now(),
  };
  if (key.kind === 'gtin') med.identity.gtins.push(key.value);
  else med.identity.rawCodes.push(key.value);
  return med;
}

function findExistingByName(meds: Medication[], name: string): Medication | null {
  const query = name.trim().toLowerCase();
  if (!query) return null;
  return meds.find((med) => med.name.toLowerCase() === query || med.identity.ocrNames.some((value) => value.toLowerCase() === query)) ?? null;
}

function rankMeds(meds: Medication[], name: string): Medication[] {
  const query = name.toLowerCase();
  return [...meds].sort((a, b) => fuzzyScore(b.name, query) - fuzzyScore(a.name, query));
}

async function savePhoto(blob: Blob, medId: string): Promise<void> {
  await putPhoto({ id: uid(), medId, blob, at: Date.now() });
}

async function tryLocalText(file: File): Promise<string> {
  const TextDetector = (window as any).TextDetector;
  if (!TextDetector) return '';
  try {
    const bitmap = await createImageBitmap(file);
    const detector = new TextDetector();
    const lines = await detector.detect(bitmap);
    bitmap.close?.();
    return (lines as { rawValue?: string }[])
      .map((line) => line.rawValue || '')
      .filter(Boolean)
      .join('\n')
      .slice(0, 800);
  } catch {
    return '';
  }
}

class CameraCaptureController {
  private sequence = 0;
  private activeStop: (() => void) | null = null;

  begin(): number {
    this.stop();
    this.sequence += 1;
    return this.sequence;
  }

  isCurrent(id: number): boolean {
    return id === this.sequence;
  }

  attach(id: number, stop: () => void): boolean {
    if (!this.isCurrent(id)) {
      stop();
      return false;
    }
    this.activeStop = stop;
    return true;
  }

  detach(stop: () => void): void {
    if (this.activeStop === stop) this.activeStop = null;
  }

  stop(): void {
    this.sequence += 1;
    const stop = this.activeStop;
    this.activeStop = null;
    stop?.();
  }
}

async function openCameraCapture(opts: {
  title: string;
  sub: string;
  filenamePrefix: string;
  box: HTMLElement;
  hint: HTMLElement;
  controller: CameraCaptureController;
  isActive: () => boolean;
  onCapture: (file: File) => Promise<void>;
  onAlbum: () => void;
  onClose: () => void;
}): Promise<void> {
  const retry = () => void openCameraCapture(opts);
  if (!navigator.mediaDevices?.getUserMedia) {
    renderCameraUnavailable(opts, '当前浏览器不能直接打开相机。', retry);
    return;
  }

  const sessionId = opts.controller.begin();
  let stream: MediaStream | null = null;
  let closed = false;
  const card = el('div', { class: 'card camera-capture-card' });
  card.append(el('div', { class: 'big', text: opts.title }));
  card.append(el('div', { class: 'muted', text: opts.sub }));

  const preview = el('div', { class: 'camera-preview' });
  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', 'true');
  const frame = el('div', { class: 'camera-frame', 'aria-hidden': 'true' } as any);
  preview.append(video, frame);
  card.append(preview);

  const capture = iconButton('camera', '拍照', 'btn success camera-shutter');
  const album = iconButton('list', '相册上传', 'btn tonal');
  const closeButton = iconButton('undo', '返回', 'btn outlined');
  const actions = el('div', { class: 'camera-actions' });
  actions.append(capture, album, closeButton);
  card.append(actions);

  const stopWithoutRestore = () => close(false);
  const close = (restore: boolean) => {
    if (closed) return;
    closed = true;
    opts.controller.detach(stopWithoutRestore);
    stream?.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    if (restore && opts.isActive()) opts.onClose();
  };
  if (!opts.controller.attach(sessionId, stopWithoutRestore)) return;

  closeButton.onclick = () => close(true);
  album.onclick = () => {
    close(false);
    if (opts.isActive()) opts.onAlbum();
  };
  capture.onclick = async () => {
    if (!opts.controller.isCurrent(sessionId) || closed || !opts.isActive()) return;
    const file = await captureFrame(video, opts.filenamePrefix);
    if (!opts.controller.isCurrent(sessionId) || closed || !opts.isActive()) return;
    if (!file) {
      toast('相机画面还没准备好，请稍等一下再拍');
      return;
    }
    close(false);
    await opts.onCapture(file);
  };

  opts.box.replaceChildren(card);
  setHint(opts.hint, 'info', '正在打开相机…');
  setResultBusy(opts.box, true);
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1600 },
        height: { ideal: 1200 },
      },
      audio: false,
    });
    if (!opts.controller.isCurrent(sessionId) || closed || !opts.isActive()) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    video.srcObject = stream;
    await video.play();
    if (!opts.controller.isCurrent(sessionId) || closed || !opts.isActive()) return;
    setHint(opts.hint, 'info', '相机已打开，对准后点击底部拍照');
  } catch (error) {
    const shouldRenderError = opts.controller.isCurrent(sessionId) && !closed && opts.isActive();
    close(false);
    if (shouldRenderError) renderCameraUnavailable(opts, describeCameraError(error), retry);
  } finally {
    if (opts.controller.isCurrent(sessionId) && !closed && opts.isActive()) setResultBusy(opts.box, false);
  }
}

function renderCameraUnavailable(
  opts: { title: string; sub: string; box: HTMLElement; hint: HTMLElement; onAlbum: () => void },
  message: string,
  retry: () => void,
): void {
  opts.box.replaceChildren(banner('warn', message));
  opts.box.append(actionCard(opts.title, `${opts.sub} 可先检查权限后重试，或直接使用相册。`, '重试', retry, '相册上传', opts.onAlbum));
  setHint(opts.hint, 'warn', '相机不可用');
  setResultBusy(opts.box, false);
}

function describeCameraError(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '相机权限被拒绝。请在系统设置或浏览器站点设置中允许相机权限，然后点击“重试”。';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return '没有找到可用摄像头。';
  if (name === 'NotReadableError' || name === 'TrackStartError') return '摄像头可能正被其他应用占用。';
  return '无法直接打开相机。请检查权限或改用相册上传。';
}

async function captureFrame(video: HTMLVideoElement, filenamePrefix: string): Promise<File | null> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(video, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) return null;
  return new File([blob], `${filenamePrefix}-${Date.now()}.jpg`, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}

function updateModeButtons(buttons: Record<ScanMode, HTMLButtonElement>, mode: ScanMode): void {
  for (const [key, button] of Object.entries(buttons) as [ScanMode, HTMLButtonElement][]) {
    const selected = key === mode;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    button.tabIndex = selected ? 0 : -1;
  }
}

function fileInput(label: string): HTMLInputElement {
  return el('input', {
    type: 'file',
    accept: 'image/*',
    style: 'display:none',
    'aria-label': label,
  } as any) as HTMLInputElement;
}

function modeButton(
  label: string,
  iconName: 'box' | 'camera' | 'sparkles',
  id: string,
): HTMLButtonElement {
  const button = el('button', {
    id,
    class: 'scan-mode-btn',
    type: 'button',
    role: 'tab',
    'aria-controls': 'scan-mode-panel',
    'aria-selected': 'false',
    'aria-pressed': 'false',
  } as any) as HTMLButtonElement;
  button.append(icon(iconName), el('span', { text: label }));
  return button;
}

function actionCard(
  title: string,
  subtitle: string,
  buttonText: string,
  onClick: () => void,
  secondaryText?: string,
  onSecondary?: () => void,
): HTMLElement {
  const card = el('div', { class: 'card scan-action-card' });
  card.append(el('div', { class: 'big', text: title }), el('div', { class: 'muted', text: subtitle }));
  const actions = el('div', { class: 'btn-row scan-actions' });
  const primary = iconButton(buttonText.includes('相册') ? 'list' : 'camera', buttonText, 'btn success');
  primary.onclick = onClick;
  actions.append(primary);
  if (secondaryText && onSecondary) {
    const secondary = iconButton('list', secondaryText, 'btn tonal');
    secondary.onclick = onSecondary;
    actions.append(secondary);
  }
  card.append(actions);
  return card;
}

function loadingCard(title: string, subtitle: string): HTMLElement {
  const card = el('div', { class: 'card' });
  card.append(el('div', { class: 'big', text: title }), el('div', { class: 'muted', text: subtitle }));
  return card;
}

function fieldLite(labelText: string, input: HTMLInputElement): HTMLElement {
  if (!input.id) input.id = nextFieldId('scan-field');
  const field = el('div', { class: 'field' });
  field.append(el('label', { htmlFor: input.id, text: labelText } as any), input);
  return field;
}

function textInput(value: string, placeholder: string): HTMLInputElement {
  return el('input', { type: 'text', value, placeholder }) as HTMLInputElement;
}

function iconButton(iconName: Parameters<typeof icon>[0], text: string, className: string): HTMLButtonElement {
  const button = el('button', { class: className, type: 'button' } as any) as HTMLButtonElement;
  button.append(icon(iconName), el('span', { text }));
  return button;
}

function continueButton(action: ContinueAction): HTMLButtonElement {
  const button = iconButton('camera', action.label, 'btn tonal');
  button.onclick = () => void action.run();
  return button;
}

function setHint(element: HTMLElement, tone: 'info' | 'ok' | 'warn', message: string): void {
  element.className = `banner ${tone}`;
  element.textContent = message;
}

function setResultBusy(element: HTMLElement, busy: boolean): void {
  element.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function cloneMealMap(value: MealRelsBySlot): MealRelsBySlot {
  return Object.fromEntries(
    Object.entries(value).map(([slot, rels]) => [slot, rels ? [...rels] : []]),
  ) as MealRelsBySlot;
}

function formatSlots(slots: readonly Slot[]): string {
  return SLOTS.filter((slot) => slots.includes(slot)).map((slot) => SLOT_LABEL[slot]).join('、');
}

function nextFieldId(prefix: string): string {
  fieldSequence += 1;
  return `${prefix}-${fieldSequence}`;
}

function fuzzyScore(name: string, query: string): number {
  const normalized = name.toLowerCase();
  if (normalized.includes(query)) return 10 + query.length;
  let score = 0;
  for (const character of query) if (normalized.includes(character)) score += 1;
  return score;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
