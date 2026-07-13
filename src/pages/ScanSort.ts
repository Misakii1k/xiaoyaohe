// 扫码分药页：条形码/追溯码 / 智能扫 / 拍药单三入口。
import { startScan, scanCodeFromImage, type Scanner } from '../features/scanner';
import {
  identifyByCode,
  bindCodeToMed,
  augmentIdentity,
  findMedByPhotoHash,
} from '../features/identify';
import { formatExpiry, type ProductKey } from '../features/gs1';
import { listMeds, listRulesByMed, putMed, putPhoto, uid } from '../db/local';
import {
  SLOT_LABEL,
  formatMealRelsBySlot,
  emptyIdentity,
  type Medication,
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

type ScanMode = 'code' | 'smart' | 'sheet';

let scanner: Scanner | null = null;
let handling = false;
let activeCameraStop: (() => void) | null = null;
let cameraSessionId = 0;

async function stopScanner(): Promise<void> {
  if (scanner) {
    await scanner.stop();
    scanner = null;
  }
}

function stopActiveCameraCapture(): void {
  cameraSessionId += 1;
  if (activeCameraStop) {
    activeCameraStop();
    activeCameraStop = null;
  }
}

export async function renderScanSortPage(root: HTMLElement): Promise<void> {
  await stopScanner();
  stopActiveCameraCapture();
  window.addEventListener(
    'hashchange',
    () => {
      void stopScanner();
      stopActiveCameraCapture();
    },
    { once: true },
  );

  let mode: ScanMode = 'code';
  const content = el('div', { class: 'page scan-workbench' });
  const modeBar = el('div', { class: 'scan-mode-bar' });
  const reader = el('div', { id: 'code-reader' });
  const hint = el('div', { class: 'banner info' });
  const resultBox = el('div', { id: 'scan-result' });

  const smartFile = fileInput();
  const sheetFile = fileInput();

  const buttons: Record<ScanMode, HTMLButtonElement> = {
    code: modeButton('扫条码', 'box'),
    smart: modeButton('智能扫', 'camera'),
    sheet: modeButton('拍药单', 'sparkles'),
  };

  buttons.code.onclick = () => void switchMode('code');
  buttons.smart.onclick = () => void switchMode('smart');
  buttons.sheet.onclick = () => void switchMode('sheet');
  modeBar.append(buttons.code, buttons.smart, buttons.sheet);
  content.append(modeBar, reader, hint, resultBox, smartFile, sheetFile);

  smartFile.onchange = async () => {
    const f = smartFile.files?.[0];
    if (f) await runSmartScan(f, resultBox, hint);
    smartFile.value = '';
  };
  sheetFile.onchange = async () => {
    const f = sheetFile.files?.[0];
    if (f) await runPrescriptionSheet(f, resultBox, hint);
    sheetFile.value = '';
  };

  renderPage({ root, title: '扫码分药', activeTab: 'scan', content });
  await switchMode('code');

  async function switchMode(next: ScanMode): Promise<void> {
    mode = next;
    for (const [key, btn] of Object.entries(buttons)) btn.classList.toggle('active', key === mode);
    await stopScanner();
    stopActiveCameraCapture();
    resultBox.innerHTML = '';

    if (mode === 'code') {
      reader.style.display = '';
      hint.className = 'banner info';
      hint.innerHTML = '把药盒上的条形码 / 追溯码对准取景框';
      try {
        scanner = await startScan({
          containerId: 'code-reader',
          onScan: (r) => handleScan(r.raw, resultBox, hint),
          onError: (m) => {
            hint.className = 'banner warn';
            hint.innerHTML = m;
          },
        });
      } catch {
        /* onError 已处理 */
      }
      return;
    }

    reader.style.display = 'none';
    if (mode === 'smart') {
      renderSmartStart();
    } else {
      renderSheetStart();
    }
  }

  function renderSmartStart(): void {
    hint.className = 'banner info';
    hint.innerHTML = '点击底部拍照，先识别条形码/追溯码；没有码时再识别药名和规格';
    resultBox.innerHTML = '';
    resultBox.append(
      actionCard(
        '智能扫药盒',
        '直接打开相机拍药盒正面；相册作为备用入口',
        '打开相机',
        () =>
          void openCameraCapture({
            title: '智能扫药盒',
            sub: '把药盒正面放进画面，尽量让药名和规格清晰可见',
            filenamePrefix: 'medicine-box',
            box: resultBox,
            hint,
            onCapture: (file) => runSmartScan(file, resultBox, hint),
            onAlbum: () => smartFile.click(),
            onClose: () => {
              if (mode === 'smart') renderSmartStart();
            },
          }),
        '相册上传',
        () => smartFile.click(),
      ),
    );
  }

  function renderSheetStart(): void {
    hint.className = 'banner info';
    hint.innerHTML = '拍药单或上传相册图片，AI 会拆出药名、时段和剂量';
    resultBox.innerHTML = '';
    resultBox.append(
      actionCard(
        '拍药单',
        '直接打开相机拍完整药单；也支持相册上传',
        '打开相机',
        () =>
          void openCameraCapture({
            title: '拍药单',
            sub: '让整张药单铺平入镜，药名、剂量和时段尽量不要被遮挡',
            filenamePrefix: 'prescription-sheet',
            box: resultBox,
            hint,
            onCapture: (file) => runPrescriptionSheet(file, resultBox, hint),
            onAlbum: () => sheetFile.click(),
            onClose: () => {
              if (mode === 'sheet') renderSheetStart();
            },
          }),
        '相册上传',
        () => sheetFile.click(),
      ),
    );
  }
}

async function handleScan(raw: string, box: HTMLElement, hint: HTMLElement): Promise<void> {
  if (handling) return;
  handling = true;
  try {
    if (navigator.vibrate) navigator.vibrate(60);
    const { key, med } = await identifyByCode(raw);
    if (med) {
      await showMatched(med, key, box, hint);
    } else {
      await showUnknownCode(key, box, hint, false);
    }
  } finally {
    setTimeout(() => (handling = false), 1200);
  }
}

async function runSmartScan(file: File, box: HTMLElement, hint: HTMLElement): Promise<void> {
  box.innerHTML = '';
  box.append(loadingCard('智能扫识别中…', '正在先找条形码/追溯码，再分析药盒文字'));
  hint.className = 'banner info';
  hint.innerHTML = '智能扫处理中…';

  const code = await scanCodeFromImage(file);
  if (code?.raw) {
    const { key, med } = await identifyByCode(code.raw);
    if (med) {
      await showMatched(med, key, box, hint);
      return;
    }
    await showUnknownCode(key, box, hint, true);
    return;
  }

  const localText = await tryLocalText(file);
  await runAiIdentify(file, null, box, hint, localText);
}

async function runPrescriptionSheet(file: File, box: HTMLElement, hint: HTMLElement): Promise<void> {
  box.innerHTML = '';
  box.append(loadingCard('药单识别中…', '正在拆分药名、服药时段和剂量'));
  hint.className = 'banner info';
  hint.innerHTML = 'AI 正在识别药单…';
  try {
    const r = await identifyPrescriptionSheetByBlob(file);
    box.innerHTML = '';
    hint.className = r.items.length ? 'banner ok' : 'banner warn';
    hint.innerHTML = r.items.length ? `识别到 ${r.items.length} 种药` : '没有识别到药品';
    const card = el('div', { class: 'card prescription-results' });
    card.append(el('div', { class: 'big', html: '药单草稿' }));
    if (!r.items.length) {
      card.append(el('div', { class: 'muted', html: '请换一张更清晰的药单或手动新增药品。' }));
    }
    for (const item of r.items) card.append(renderPrescriptionItem(item, file));
    box.append(card);
  } catch (e) {
    const msg = e instanceof IdentifyError ? e.message : String(e);
    box.innerHTML = '';
    box.append(banner('warn', '药单识别失败：' + msg));
    hint.className = 'banner warn';
    hint.innerHTML = '药单识别失败';
  }
}

async function showMatched(med: Medication, key: ProductKey, box: HTMLElement, hint: HTMLElement): Promise<void> {
  box.innerHTML = '';
  hint.className = 'banner ok';
  hint.innerHTML = '已识别 ✓';

  const card = el('div', {
    class: 'card elevated',
    style: 'border:1.5px solid var(--brand)',
  } as any);
  card.append(el('div', { class: 'huge', html: med.name }));
  const tags = el('div', { class: 'scan-slot-tags' });
  if (med.slots.length === 0) tags.append(el('span', { class: 'muted', html: '（未设时段）' }));
  for (const s of med.slots) tags.append(slotTag(s));
  card.append(tags);

  const sub = [med.amountPerDose, med.dosageText, formatMealRelsBySlot(med.mealRelsBySlot, med.slots)]
    .filter(Boolean)
    .join(' · ');
  if (sub) card.append(el('div', { class: 'big', html: sub }));

  if (med.slots.length > 0) {
    const guide = med.slots.map((s) => SLOT_LABEL[s]).join('、');
    card.append(banner('ok', `请放入：${guide} 药盒`));
  }

  if (key.parsed?.expiry) {
    const exp = formatExpiry(key.parsed.expiry);
    if (exp) card.append(el('div', { class: 'muted', html: `有效期至 ${exp}`, style: 'margin-top:8px' } as any));
  }

  const rules = await listRulesByMed(med.id);
  const actions = el('div', { class: 'btn-row scan-actions' });
  const edit = el('button', { class: 'btn outlined' });
  edit.append(icon('edit'));
  edit.append(el('span', { html: '进入填表' }));
  edit.onclick = () => navigate(`/meds/${med.id}/edit`);
  actions.append(edit);
  if (rules.length > 0) {
    const addSchedule = el('button', { class: 'btn success' });
    addSchedule.append(icon('check'));
    addSchedule.append(el('span', { html: '一键使用日程' }));
    addSchedule.onclick = async () => {
      if (await confirmDialog('已找到这味药的服药日程，是否查看今天的待办？', '查看今天')) {
        navigate('/today');
      }
    };
    actions.append(addSchedule);
  }
  card.append(actions);
  box.append(card);
}

async function showUnknownCode(
  key: ProductKey,
  box: HTMLElement,
  hint: HTMLElement,
  fromSmartScan: boolean,
): Promise<void> {
  hint.className = 'banner warn';
  hint.innerHTML = '数据库中没有这条记录';
  box.innerHTML = '';
  const card = el('div', { class: 'card' });
  card.append(el('div', { class: 'big', html: '这是什么药？' }));
  card.append(el('div', {
    class: 'muted',
    html: key.kind === 'gtin' ? `产品码 GTIN：${key.value}` : `码：${key.value.slice(0, 48)}`,
  }));

  const input = el('input', { type: 'text', placeholder: '填写药名，例如：阿司匹林肠溶片' }) as HTMLInputElement;
  card.append(fieldLite('药名', input));

  const save = el('button', { class: 'btn success' });
  save.append(icon('check'));
  save.append(el('span', { html: fromSmartScan ? '保存并继续填表' : '保存绑定' }));
  save.onclick = async () => {
    const name = input.value.trim();
    if (!name) {
      toast('请先填写药名');
      return;
    }
    const med = newMedication(name, key);
    await putMed(med);
    toast('已保存，下次扫码会自动识别');
    if (fromSmartScan) navigate(`/meds/${med.id}/edit`);
    else await showMatched(med, key, box, hint);
  };
  card.append(save);

  const meds = await listMeds();
  if (meds.length > 0) {
    card.append(el('div', { class: 'muted', html: '或绑定到已有药品：', style: 'margin-top:14px' } as any));
    const list = el('div', { class: 'scan-existing-list' });
    for (const m of meds) {
      const b = el('button', { class: 'btn tonal', html: m.name });
      b.onclick = async () => {
        await bindCodeToMed(m.id, key);
        toast(`已绑定到「${m.name}」`);
        await showMatched(m, key, box, hint);
      };
      list.append(b);
    }
    card.append(list);
  }
  box.append(card);
}

async function runAiIdentify(
  file: File,
  key: ProductKey | null,
  box: HTMLElement,
  hint: HTMLElement,
  localText = '',
): Promise<void> {
  let photoHash = '';
  try {
    photoHash = await aHash(file);
  } catch {
    /* hash 失败不阻塞主流程 */
  }

  if (photoHash) {
    const similar = await findMedByPhotoHash(photoHash);
    if (similar) {
      await showSimilar(file, key, photoHash, similar.med, similar.distance, box, hint);
      return;
    }
  }

  let result: IdentifyResult;
  try {
    result = await identifyByBlob(file, localText ? `本地识别到的文字：${localText}` : undefined);
  } catch (e) {
    const msg = e instanceof IdentifyError ? e.message : String(e);
    box.innerHTML = '';
    box.append(banner('warn', '识别失败：' + msg));
    hint.className = 'banner warn';
    hint.innerHTML = 'AI 识别失败';
    return;
  }

  if (!result.name) {
    box.innerHTML = '';
    box.append(banner('warn', '没认出来这是什么药，请重拍或手动新增。'));
    hint.className = 'banner warn';
    hint.innerHTML = '未识别';
    return;
  }

  await showAiResult(result, key, file, photoHash, box, hint);
}

async function showSimilar(
  file: File,
  key: ProductKey | null,
  photoHash: string,
  med: Medication,
  distance: number,
  box: HTMLElement,
  hint: HTMLElement,
): Promise<void> {
  box.innerHTML = '';
  hint.className = 'banner info';
  hint.innerHTML = '发现相似药盒';
  const card = el('div', { class: 'card' });
  card.append(el('div', { class: 'big', html: `看起来像「${med.name}」？` }));
  card.append(el('div', { class: 'muted', html: `历史照片相似度高（汉明距 ${distance}）` }));
  const yes = el('button', { class: 'btn success', html: '是的，归并' });
  yes.onclick = async () => {
    if (key) await bindCodeToMed(med.id, key);
    await augmentIdentity(med.id, { photoHashes: [photoHash] });
    await savePhoto(file, med.id);
    toast(`已归并到「${med.name}」`);
    await showMatched(med, key ?? { kind: 'raw', value: '' }, box, hint);
  };
  const no = el('button', { class: 'btn tonal', html: '不是，继续 AI 识别' });
  no.onclick = () => void runAiIdentify(file, key, box, hint);
  const row = el('div', { class: 'btn-row' });
  row.append(yes, no);
  card.append(row);
  box.append(card);
}

async function showAiResult(
  r: IdentifyResult,
  key: ProductKey | null,
  file: File,
  photoHash: string,
  box: HTMLElement,
  hint: HTMLElement,
): Promise<void> {
  box.innerHTML = '';
  hint.className = 'banner ok';
  hint.innerHTML = '已识别 ✓';

  const existing = await findExistingByName(r.name);
  if (existing && (await listRulesByMed(existing.id)).length > 0) {
    const useOld = await confirmDialog(`识别到「${existing.name}」，之前已经填过服药日程，是否一键使用？`, '一键使用');
    if (useOld) {
      if (key) await bindCodeToMed(existing.id, key);
      if (photoHash) await augmentIdentity(existing.id, { photoHashes: [photoHash] });
      await savePhoto(file, existing.id);
      navigate('/today');
      return;
    }
  }

  const card = el('div', { class: 'card' });
  card.append(el('div', { class: 'huge', html: r.name }));
  const meta = [r.dosageText, r.amountPerDose, formatMealRelsBySlot(r.mealRelsBySlot, r.slots)]
    .filter(Boolean)
    .join(' · ');
  if (meta) card.append(el('div', { class: 'big', html: meta }));
  card.append(el('div', { class: 'muted', html: `置信度 ${Math.round(r.confidence * 100)}%` }));

  const addBtn = el('button', { class: 'btn' });
  addBtn.append(icon('plus'));
  addBtn.append(el('span', { html: existing ? '更新/填表已有药品' : '新建为药品（自动填表）' }));
  addBtn.onclick = async () => {
    if (existing) {
      await mergeIdentifyIntoExisting(existing, r, key, photoHash, file);
      navigate(`/meds/${existing.id}/edit`);
      return;
    }
    setPendingPrefill({ result: r, photoBlob: file, aHash: photoHash });
    if (key) sessionStorage.setItem('medbox.prefill.code', JSON.stringify(key));
    navigate('/meds/new');
  };
  card.append(addBtn);

  const meds = await listMeds();
  if (meds.length) {
    card.append(el('div', { class: 'muted', html: '归并到已有药品：', style: 'margin-top:14px' } as any));
    const ranked = rankMeds(meds, r.name);
    for (const m of ranked) {
      const b = el('button', { class: 'btn tonal scan-merge-btn', html: m.name });
      b.onclick = async () => {
        await mergeIdentifyIntoExisting(m, r, key, photoHash, file);
        toast(`已归并到「${m.name}」`);
        await showMatched(m, key ?? { kind: 'raw', value: '' }, box, hint);
      };
      card.append(b);
    }
  }
  box.append(card);
}

function renderPrescriptionItem(item: PrescriptionItemDraft, file: File): HTMLElement {
  const row = el('div', { class: 'prescription-item' });
  row.append(el('div', { class: 'prescription-name', html: item.name }));
  const meta = [item.dosageText, item.amountPerDose, formatMealRelsBySlot(item.mealRelsBySlot, item.slots)]
    .filter(Boolean)
    .join(' · ');
  if (meta) row.append(el('div', { class: 'muted', html: meta }));
  const slots = el('div', { class: 'scan-slot-tags' });
  for (const s of item.slots) slots.append(slotTag(s));
  row.append(slots);
  const add = el('button', { class: 'btn small success' });
  add.append(icon('plus'));
  add.append(el('span', { html: '添加到药品' }));
  add.onclick = () => {
    setPendingPrefill({
      result: prescriptionItemToIdentify(item),
      photoBlob: file,
      aHash: '',
    });
    navigate('/meds/new');
  };
  row.append(add);
  return row;
}

async function mergeIdentifyIntoExisting(
  med: Medication,
  r: IdentifyResult,
  key: ProductKey | null,
  photoHash: string,
  file: File,
): Promise<void> {
  if (key) await bindCodeToMed(med.id, key);
  await augmentIdentity(med.id, {
    gtins: r.evidence.gtins,
    rawCodes: r.evidence.rawCodes,
    ocrNames: [r.name, ...r.evidence.ocrNames],
    photoHashes: photoHash ? [photoHash] : [],
  });
  if (photoHash) await savePhoto(file, med.id);
}

function prescriptionItemToIdentify(item: PrescriptionItemDraft): IdentifyResult {
  return {
    name: item.name,
    dosageText: item.dosageText,
    amountPerDose: item.amountPerDose,
    slots: item.slots,
    mealRels: item.mealRels,
    mealRelsBySlot: item.mealRelsBySlot,
    evidence: { ocrNames: [item.name], gtins: [], rawCodes: [] },
    confidence: item.confidence,
  };
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
  };
  if (key.kind === 'gtin') med.identity.gtins.push(key.value);
  else med.identity.rawCodes.push(key.value);
  return med;
}

async function findExistingByName(name: string): Promise<Medication | null> {
  const meds = await listMeds();
  const q = name.trim().toLowerCase();
  if (!q) return null;
  return meds.find((m) => m.name.toLowerCase() === q || m.identity.ocrNames.some((n) => n.toLowerCase() === q)) ?? null;
}

function rankMeds(meds: Medication[], name: string): Medication[] {
  const q = name.toLowerCase();
  return [...meds].sort((a, b) => fuzzyScore(b.name, q) - fuzzyScore(a.name, q));
}

async function savePhoto(blob: Blob, medId: string): Promise<void> {
  await putPhoto({ id: uid(), medId, blob, at: Date.now() });
}

async function tryLocalText(file: File): Promise<string> {
  const TD = (window as any).TextDetector;
  if (!TD) return '';
  try {
    const bmp = await createImageBitmap(file);
    const detector = new TD();
    const lines = await detector.detect(bmp);
    return (lines as { rawValue?: string }[]).map((x) => x.rawValue || '').filter(Boolean).join('\n').slice(0, 800);
  } catch {
    return '';
  }
}

async function openCameraCapture(opts: {
  title: string;
  sub: string;
  filenamePrefix: string;
  box: HTMLElement;
  hint: HTMLElement;
  onCapture: (file: File) => Promise<void>;
  onAlbum: () => void;
  onClose: () => void;
}): Promise<void> {
  stopActiveCameraCapture();

  if (!navigator.mediaDevices?.getUserMedia) {
    opts.box.innerHTML = '';
    opts.box.append(banner('warn', '当前浏览器不能直接打开相机，请使用相册上传。'));
    opts.box.append(
      actionCard(opts.title, opts.sub, '相册上传', opts.onAlbum),
    );
    opts.hint.className = 'banner warn';
    opts.hint.innerHTML = '相机不可用';
    return;
  }

  const sessionId = ++cameraSessionId;
  const isCurrent = () => sessionId === cameraSessionId;
  let stream: MediaStream | null = null;
  let closed = false;

  const card = el('div', { class: 'card camera-capture-card' });
  card.append(el('div', { class: 'big', html: opts.title }));
  card.append(el('div', { class: 'muted', html: opts.sub }));

  const preview = el('div', { class: 'camera-preview' });
  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', 'true');
  const frame = el('div', { class: 'camera-frame', ariaHidden: 'true' } as any);
  preview.append(video, frame);
  card.append(preview);

  const capture = el('button', { class: 'btn success camera-shutter', type: 'button' } as any) as HTMLButtonElement;
  capture.append(icon('camera'));
  capture.append(el('span', { html: '拍照' }));

  const album = el('button', { class: 'btn tonal', type: 'button' } as any) as HTMLButtonElement;
  album.append(icon('list'));
  album.append(el('span', { html: '相册上传' }));

  const closeBtn = el('button', { class: 'btn outlined', type: 'button' } as any) as HTMLButtonElement;
  closeBtn.append(icon('undo'));
  closeBtn.append(el('span', { html: '返回' }));

  const actions = el('div', { class: 'camera-actions' });
  actions.append(capture, album, closeBtn);
  card.append(actions);

  const close = (restore: boolean) => {
    if (closed) return;
    closed = true;
    if (activeCameraStop === stopWithoutRestore) activeCameraStop = null;
    stream?.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    if (restore) opts.onClose();
  };
  const stopWithoutRestore = () => close(false);
  activeCameraStop = stopWithoutRestore;

  closeBtn.onclick = () => close(true);
  album.onclick = () => {
    close(true);
    opts.onAlbum();
  };
  capture.onclick = async () => {
    if (!isCurrent() || closed) return;
    const file = await captureFrame(video, opts.filenamePrefix);
    if (!isCurrent() || closed) return;
    if (!file) {
      toast('相机画面还没准备好，请稍等一下再拍');
      return;
    }
    close(false);
    await opts.onCapture(file);
  };

  opts.box.innerHTML = '';
  opts.box.append(card);
  opts.hint.className = 'banner info';
  opts.hint.innerHTML = '正在打开相机…';

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1600 },
        height: { ideal: 1200 },
      },
      audio: false,
    });
    if (!isCurrent() || closed) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    video.srcObject = stream;
    await video.play();
    opts.hint.className = 'banner info';
    opts.hint.innerHTML = '相机已打开，对准后点击底部拍照';
  } catch {
    close(false);
    opts.box.innerHTML = '';
    opts.box.append(banner('warn', '无法直接打开相机，请检查权限，或改用相册上传。'));
    opts.box.append(actionCard(opts.title, opts.sub, '相册上传', opts.onAlbum));
    opts.hint.className = 'banner warn';
    opts.hint.innerHTML = '相机不可用';
  }
}

async function captureFrame(video: HTMLVideoElement, filenamePrefix: string): Promise<File | null> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) return null;
  return new File([blob], `${filenamePrefix}-${Date.now()}.jpg`, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}

function fileInput(): HTMLInputElement {
  const input = el('input', {
    type: 'file',
    accept: 'image/*',
    style: 'display:none',
  } as any) as HTMLInputElement;
  return input;
}

function modeButton(label: string, ic: 'box' | 'camera' | 'sparkles'): HTMLButtonElement {
  const btn = el('button', { class: 'scan-mode-btn', type: 'button' } as any) as HTMLButtonElement;
  btn.append(icon(ic));
  btn.append(el('span', { html: label }));
  return btn;
}

function actionCard(
  title: string,
  sub: string,
  buttonText: string,
  onClick: () => void,
  secondaryText?: string,
  onSecondary?: () => void,
): HTMLElement {
  const card = el('div', { class: 'card scan-action-card' });
  card.append(el('div', { class: 'big', html: title }));
  card.append(el('div', { class: 'muted', html: sub }));
  const actions = el('div', { class: 'btn-row scan-actions' });
  const btn = el('button', { class: 'btn success', type: 'button' } as any) as HTMLButtonElement;
  btn.append(icon(buttonText.includes('相册') ? 'list' : 'camera'));
  btn.append(el('span', { html: buttonText }));
  btn.onclick = onClick;
  actions.append(btn);
  if (secondaryText && onSecondary) {
    const secondary = el('button', { class: 'btn tonal', type: 'button' } as any) as HTMLButtonElement;
    secondary.append(icon('list'));
    secondary.append(el('span', { html: secondaryText }));
    secondary.onclick = onSecondary;
    actions.append(secondary);
  }
  card.append(actions);
  return card;
}

function loadingCard(title: string, sub: string): HTMLElement {
  const card = el('div', { class: 'card' });
  card.append(el('div', { class: 'big', html: title }));
  card.append(el('div', { class: 'muted', html: sub }));
  return card;
}

function fieldLite(label: string, input: HTMLElement): HTMLElement {
  const f = el('div', { class: 'field' });
  f.append(el('label', { html: label }));
  f.append(input);
  return f;
}

function fuzzyScore(name: string, q: string): number {
  const n = name.toLowerCase();
  if (n.includes(q)) return 10 + q.length;
  let s = 0;
  for (const ch of q) if (n.includes(ch)) s += 1;
  return s;
}
