// 分药页：主流程是「按顺序分药」——弹卡一盒一盒带着放；
// 扫码/拍药盒是认不出时的备选，拍药单负责首轮把药录进来。
import '../ui/styles/pages/scanner.css';
import '../ui/styles/pages/med-wizard.css';
import { startScan, scanCodeFromImage, type Scanner } from '../features/scanner';
import {
  identifyByCode,
  bindCodeToMed,
  augmentIdentity,
  findMedByPhotoHash,
} from '../features/identify';
import { pillboxBannerImg, getPillboxMachine3dSvg, render3dMedia } from '../ui/assets3d';
import { formatExpiry, type ProductKey } from '../features/gs1';
import {
  deleteRule,
  createMedicationBatch,
  listMeds,
  listRulesByMed,
  listScheduleRevisions,
  putMed,
  putRule,
  recordPreDeduction,
  uid,
  listRecentInventoryOperations,
} from '../db/local';
import { getMedPhotoUrls, saveMedPhoto } from '../features/medPhotos';
import { sendLowStockReminderIfDue } from '../features/inventoryReminder';
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
  type InventoryOperationLog,
} from '../db/schema';
import { el, renderPage, toast, slotTag, icon, banner, confirmDialog, field, topbarAiPill } from '../ui/components';
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
import { setPendingMedicationBatch } from '../ai/pendingMedicationBatch';
import { openMedOnboardWizard } from '../ui/MedOnboardWizard';
import { openSortWizard, type SortWizardEntry, type SortWizardItem } from '../ui/SortWizard';
import { isMedicationExpiredOn, projectScheduleDate, toLocalDate, localDayBounds } from '../domain/medicationSchedule';
import { rescheduleMedicationReminders } from '../features/reminderScheduler';
import { applyExplicitDose, createMedicationDraft } from '../domain/medicationDraft';
import { openPillCounterSheet } from '../features/pillCounter';

type ScanMode = 'code' | 'sheet';

const MODE_LABEL: Record<ScanMode, string> = {
  code: '扫码认药',
  sheet: '拍药单录入',
};

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
  let homeSequence = 0;
  let sortLaunching = false;
  let handlingLiveResult = false;
  const cameraCapture = new CameraCaptureController();

  const content = el('div', { class: 'page scan-workbench' });
  // 首屏方式选择：已有药时「按顺序分药」当主入口；还没录药时先引导拍药单/口述录入
  const home = el('div', { class: 'scan-home' });
  const backRow = el('div', { class: 'scan-back-row', hidden: true } as any);
  const backBtn = el('button', { class: 'btn text scan-back-btn', type: 'button' } as any);
  backBtn.append(icon('arrow-left'));
  backBtn.append(el('span', { html: '更换方式' }));
  backRow.append(backBtn);
  const panel = el('div', {
    id: 'scan-mode-panel',
    role: 'region',
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
  const sheetFile = fileInput('上传药单照片');
  const pillFile = fileInput('拍照数药片');

  panel.append(reader, hint, resultBox);
  content.append(home, backRow, panel, codeFile, sheetFile, pillFile);
  backBtn.onclick = () => renderHome();

  pillFile.onchange = async () => {
    const file = pillFile.files?.[0];
    pillFile.value = '';
    if (!file || disposed) return;
    try {
      await openPillCounterSheet({
        image: file,
        onConfirm: (res) => {
          toast(`已完成清点：共 ${res.count} 粒药片`);
        },
        onRetake: () => {
          pillFile.click();
        },
      });
    } catch (e) {
      toast(`数药片出错：${e instanceof Error ? e.message : String(e)}`);
    }
  };

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

  renderPage({ root, title: '分药', activeTab: 'scan', topRight: topbarAiPill(), content });
  renderHome();

  function isOperationCurrent(operation: number, expectedMode: ScanMode): boolean {
    return !disposed && mode === expectedMode && operation === operationSequence;
  }

  function buildHome(
    _hasMeds: boolean,
    allMeds: Medication[] = [],
    recentLogs: InventoryOperationLog[] = [],
  ): void {
    home.replaceChildren();

    // 1. 顶部 3D 横幅
    const bannerCard = el('div', { class: 'scan-banner-card' });
    const bannerLeft = el('div', { class: 'scan-banner-left' });
    bannerLeft.append(
      el('h2', { class: 'scan-banner-title', text: '分药助手' }),
      el('div', { class: 'scan-banner-sub', text: '轻松管理每日用药' })
    );
    const bannerVisual = el('div', { class: 'scan-banner-visual' });
    bannerVisual.append(render3dMedia(pillboxBannerImg, getPillboxMachine3dSvg, '盒宝 · 分药小管家', 'scan-banner-img'));
    bannerCard.append(bannerLeft, bannerVisual);
    home.append(bannerCard);

    // 2. 两大核心行动卡片
    const actionCards = el('div', { class: 'scan-action-cards' });

    // 开始分药
    const sortCard = el('button', {
      class: 'scan-hero-card blue',
      type: 'button',
    } as any);
    const sortIcon = el('div', { class: 'scan-hero-icon-wrap' });
    sortIcon.append(icon('pillbox'));
    const sortInfo = el('div', { class: 'scan-hero-info' });
    sortInfo.append(
      el('div', { class: 'scan-hero-title', text: '开始分药' }),
      el('div', { class: 'scan-hero-sub', text: '按时间分装药品' })
    );
    const sortArrow = el('div', { class: 'scan-hero-arrow' });
    sortArrow.append(icon('chevron-right'));
    sortCard.append(sortIcon, sortInfo, sortArrow);
    sortCard.onclick = () => void startSortWizard();

    // 扫一扫认药
    const scanCard = el('button', {
      class: 'scan-hero-card green',
      type: 'button',
    } as any);
    const scanIcon = el('div', { class: 'scan-hero-icon-wrap' });
    scanIcon.append(icon('scan'));
    const scanInfo = el('div', { class: 'scan-hero-info' });
    scanInfo.append(
      el('div', { class: 'scan-hero-title', text: '扫一扫认药' }),
      el('div', { class: 'scan-hero-sub', text: '识别药品信息' })
    );
    const scanArrow = el('div', { class: 'scan-hero-arrow' });
    scanArrow.append(icon('chevron-right'));
    scanCard.append(scanIcon, scanInfo, scanArrow);
    scanCard.onclick = () => void enterMode('code');

    actionCards.append(sortCard, scanCard);
    home.append(actionCards);

    // 3. 快捷操作
    const quickSection = el('div', { class: 'scan-quick-section' });
    quickSection.append(el('h3', { class: 'scan-section-title', text: '快捷操作' }));

    const quickGrid = el('div', { class: 'scan-quick-grid' });

    const sheetQuick = el('div', { class: 'scan-quick-card' });
    const sheetIcon = el('div', { class: 'scan-quick-icon green' });
    sheetIcon.append(icon('camera'));
    const sheetInfo = el('div', { class: 'scan-quick-info' });
    sheetInfo.append(
      el('div', { class: 'scan-quick-title', text: '拍单录入' }),
      el('div', { class: 'scan-quick-desc', text: '识别处方单' })
    );
    sheetQuick.append(sheetIcon, sheetInfo);
    sheetQuick.onclick = () => void enterMode('sheet', () => void openSheetCamera());

    const pillCountQuick = el('div', { class: 'scan-quick-card' });
    const pillCountIcon = el('div', { class: 'scan-quick-icon blue' });
    pillCountIcon.append(icon('pill'));
    const pillCountInfo = el('div', { class: 'scan-quick-info' });
    pillCountInfo.append(
      el('div', { class: 'scan-quick-title', text: '快速数药片' }),
      el('div', { class: 'scan-quick-desc', text: '拍照秒级清点' })
    );
    pillCountQuick.append(pillCountIcon, pillCountInfo);
    pillCountQuick.onclick = () => pillFile.click();

    quickGrid.append(sheetQuick, pillCountQuick);
    quickSection.append(quickGrid);
    home.append(quickSection);

    // 4. 今日分药记录 (对接真实数据库记录)
    const recordsSection = el('div', { class: 'scan-records-section' });
    recordsSection.append(el('h3', { class: 'scan-section-title', text: '今日分药记录' }));

    const todayDate = toLocalDate(new Date());
    const { start, end } = localDayBounds(todayDate);
    const todayLogs = recentLogs.filter(
      (log) => log.source === 'wizard' && log.timestamp >= start && log.timestamp <= end,
    );

    if (todayLogs.length > 0) {
      const medById = new Map(allMeds.map((m) => [m.id, m]));
      for (const log of todayLogs) {
        const med = medById.get(log.medId);
        const medName = log.medName || med?.name || '药品';
        const unit = med?.inventory?.unit || '份';
        const count = Math.abs(log.delta);
        const timeStr = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        recordsSection.append(
          createRecordCard(
            `${medName} (分装 ${count} ${unit})`,
            `${todayDate} ${timeStr} · ${log.sourceNote || '分药向导完成'}`,
          ),
        );
      }
    } else {
      const emptyCard = el('div', { class: 'scan-record-empty' });
      const emptyIcon = el('div', { class: 'scan-record-empty-icon' });
      emptyIcon.append(icon('pillbox'));
      const emptyInfo = el('div', { class: 'scan-record-empty-info' });
      emptyInfo.append(
        el('div', { class: 'scan-record-empty-title', text: '今日暂无分药记录' }),
        el('div', { class: 'scan-record-empty-desc', text: '点击上方「开始分药」即可按时段将药品分装入盒' }),
      );
      emptyCard.append(emptyIcon, emptyInfo);
      recordsSection.append(emptyCard);
    }

    home.append(recordsSection);
  }

  function createRecordCard(title: string, meta: string): HTMLElement {
    const card = el('div', { class: 'scan-record-card' });
    const left = el('div', { class: 'scan-record-left' });
    const iconWrap = el('div', { class: 'scan-record-icon' });
    iconWrap.append(icon('pillbox'));
    const info = el('div', { class: 'scan-record-info' });
    info.append(
      el('div', { class: 'scan-record-title', text: title }),
      el('div', { class: 'scan-record-meta', text: meta })
    );
    left.append(iconWrap, info);

    const badge = el('span', { class: 'scan-record-badge', text: '已完成' });
    card.append(left, badge);
    return card;
  }

  /** 首屏形态跟着数据走：录过药和第一次用看到的不一样 */
  async function refreshHome(): Promise<void> {
    const current = ++homeSequence;
    let hasMeds = false;
    let meds: Medication[] = [];
    let recentLogs: InventoryOperationLog[] = [];
    try {
      [meds, recentLogs] = await Promise.all([
        listMeds(),
        listRecentInventoryOperations(50),
      ]);
      hasMeds = meds.length > 0;
    } catch {
      /* 读不到就按第一次用展示 */
    }
    if (disposed || current !== homeSequence) return;
    buildHome(hasMeds, meds, recentLogs);
  }

  /** 按顺序分药：把今天的服药安排按药分组，弹卡一盒一盒带着放 */
  async function startSortWizard(): Promise<void> {
    if (disposed || sortLaunching) return;
    sortLaunching = true;
    try {
      const [meds, revisions] = await Promise.all([listMeds(), listScheduleRevisions()]);
      if (disposed) return;
      const today = toLocalDate(new Date());
      const medById = new Map(meds.map((med) => [med.id, med]));
      const grouped = new Map<string, { entries: SortWizardEntry[]; earliest: number }>();
      for (const projection of projectScheduleDate(revisions, today)) {
        const med = medById.get(projection.revision.medId);
        if (!med) continue;
        let group = grouped.get(med.id);
        if (!group) {
          group = { entries: [], earliest: projection.dueAt };
          grouped.set(med.id, group);
        }
        group.earliest = Math.min(group.earliest, projection.dueAt);
        if (projection.isRest || !projection.occurrence) continue;
        group.entries.push({
          occurrenceId: projection.occurrence.id,
          slot: projection.revision.slot,
          timeLocal: projection.revision.timeLocal,
          doseLabel: projection.occurrence.doseQuantity && projection.occurrence.doseUnit
            ? `${projection.occurrence.doseQuantity}${projection.occurrence.doseUnit}`
            : med.amountPerDose || '',
          doseQuantity: projection.occurrence.doseQuantity,
          doseUnit: projection.occurrence.doseUnit,
          mealRels: [...projection.revision.mealRels],
        });
      }
      if (grouped.size === 0) {
        const go = await confirmDialog(
          '药已经录好了，但还没设服药时段。先去药品里点开每味药，把早中晚设一下，就能按顺序分药了。',
          '去药品列表',
        );
        if (!disposed && go) navigate('/meds');
        return;
      }
      const photoUrls = await getMedPhotoUrls(Array.from(grouped.keys()));
      if (disposed) return;
      const items: SortWizardItem[] = Array.from(grouped.entries())
        .sort((a, b) => a[1].earliest - b[1].earliest)
        .map(([medId, group]) => ({
          med: medById.get(medId)!,
          photoUrl: photoUrls.get(medId),
          entries: group.entries,
          isRest: group.entries.length === 0,
          expired: isMedicationExpiredOn(medById.get(medId)!, today),
        }));
      openSortWizard(items, {
        onComplete: async (summary) => {
          let deducted = 0;
          let skipped = 0;
          let failed = 0;
          const lowStockMessages = new Set<string>();
          for (const entry of summary.items) {
            skipped += entry.entryCount - entry.entries.length;
            const med = medById.get(entry.medId);
            if (!med) {
              failed += entry.entryCount;
              continue;
            }
            if (isMedicationExpiredOn(med, today)) {
              skipped += entry.entryCount;
              continue;
            }
            try {
              const result = await recordPreDeduction(med, entry.entries, today);
              deducted += result.deductedOccurrences;
              skipped += result.skippedOccurrences;
              if (result.lowStockMessage) {
                lowStockMessages.add(result.lowStockMessage);
                await sendLowStockReminderIfDue(result.med, result.lowStockMessage);
              }
            } catch {
              failed += entry.entryCount;
            }
          }
          if (deducted > 0) {
            const parts = [`已扣减 ${deducted} 个服药时段的库存`];
            if (skipped > 0) parts.push(`跳过 ${skipped} 个时段`);
            if (failed > 0) parts.push(`失败 ${failed} 个时段`);
            toast(parts.join('，'));
          } else if (skipped > 0) {
            toast(`本次无需重复扣减（${skipped} 个时段已扣或待复核）`);
          } else if (failed > 0) {
            toast(`库存扣减失败：${failed} 个时段`);
          }
          for (const message of lowStockMessages) toast(message);
          void refreshHome();
        },
      });
    } finally {
      sortLaunching = false;
    }
  }

  /** 回到方式选择首屏：停相机、清结果 */
  function renderHome(): void {
    if (disposed) return;
    switchSequence += 1;
    operationSequence += 1;
    cameraCapture.stop();
    const previous = scanner;
    scanner = null;
    if (previous) void previous.stop();
    reader.style.display = 'none';
    resultBox.replaceChildren();
    setResultBusy(resultBox, false);
    home.hidden = false;
    backRow.hidden = true;
    panel.hidden = true;
    void refreshHome();
  }

  /** 从首屏进入某个录入方式，可选自动开相机 */
  async function enterMode(next: ScanMode, after?: () => void): Promise<void> {
    if (disposed) return;
    home.hidden = true;
    backRow.hidden = false;
    panel.hidden = false;
    await switchMode(next);
    if (!disposed && mode === next) after?.();
  }

  async function switchMode(next: ScanMode): Promise<void> {
    const currentSwitch = ++switchSequence;
    operationSequence += 1;
    mode = next;
    panel.setAttribute('aria-label', MODE_LABEL[mode]);
    cameraCapture.stop();
    const previous = scanner;
    scanner = null;
    if (previous) await previous.stop();
    if (disposed || currentSwitch !== switchSequence) return;

    resultBox.replaceChildren();
    setResultBusy(resultBox, false);
    if (mode === 'code') {
      reader.style.display = '';
      setHint(hint, 'info', '对准药盒上的条形码或追溯码，认出后告诉您放哪格');
      try {
        const started = await startScan({
          containerId: reader.id,
          onScan: (result) => void handleLiveScan(result.raw),
          onError: () => {
            if (!disposed && mode === 'code' && currentSwitch === switchSequence) {
              renderScannerUnavailable();
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
          renderScannerUnavailable();
        }
      }
      return;
    }

    reader.style.display = 'none';
    renderSheetStart();
  }

  async function handleLiveScan(raw: string): Promise<void> {
    if (disposed || mode !== 'code' || handlingLiveResult) return;
    handlingLiveResult = true;
    const operation = ++operationSequence;
    setResultBusy(resultBox, true);
    resultBox.replaceChildren(loadingCard('正在查询…', '已暂停取景，正在匹配这个条码'));
    setHint(hint, 'info', '扫到了，正在认这盒药…');
    try {
      navigator.vibrate?.(60);
      const { key, med } = await identifyByCode(raw);
      if (!isOperationCurrent(operation, 'code')) return;
      const continueAction: ContinueAction = { label: '继续扫下一盒', run: resumeLiveScan };
      if (med) await showMatched(med, key, resultBox, hint, continueAction, () => isOperationCurrent(operation, 'code'));
      else await showUnknownCode(
        key,
        resultBox,
        hint,
        continueAction,
        () => isOperationCurrent(operation, 'code'),
      );
    } catch (error) {
      if (!isOperationCurrent(operation, 'code')) return;
      resultBox.replaceChildren(banner('warn', `条码处理失败：${errorMessage(error)}`));
      resultBox.append(continueButton({ label: '继续扫下一盒', run: resumeLiveScan }));
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
    setHint(hint, 'info', '认好一盒了，放下它，再拿下一盒对准条码继续');
    if (scanner?.state === 'paused') await scanner.resume();
    else if (!scanner || scanner.state === 'stopped') await switchMode('code');
  }

  function renderScannerUnavailable(): void {
    reader.replaceChildren();
    setHint(hint, 'info', '相机权限不可用，可从相册识别，或完成授权后重试。');
    resultBox.replaceChildren(
      actionCard(
        '相册识别条码',
        '选择清晰、完整的条码图片，系统会自动识别。',
        '相册识别',
        () => codeFile.click(),
        '重试',
        () => void switchMode('code'),
      ),
    );
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
  else await showUnknownCode(key, box, hint, context.continueAction, context.isCurrent);
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
    if (result.items.length > 0) {
      box.replaceChildren();
      openMedOnboardWizard(result.items, {
        onFinish: (photos) => handoffPrescriptionBatch(result.items, photos),
      });
      return;
    }
    box.replaceChildren(banner('warn', '没有识别到药品，可换一张更清晰的药单。'));
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

/** Keep prescription recognition in-memory and defer all persistence to the batch workspace. */
export function handoffPrescriptionBatch(
  items: readonly PrescriptionItemDraft[],
  photos: readonly (Blob | undefined)[] = [],
): void {
  setPendingMedicationBatch(items, photos);
  navigate('/meds/new');
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
  card.append(field('药名', input));

  const save = iconButton('check', '保存绑定', 'btn success');
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
    await showMatched(med, key, box, hint, continuation, isActive);
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
  // 结果卡在取景框下方：识别后滚到可视区，绑定按钮无需用户手动上滑查找。
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

export function renderPrescriptionBatch(
  drafts: PrescriptionItemDraft[],
  _file: File,
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
      text: '一项一项对着药单看：药名、每次吃多少、什么时候吃。不要的取消勾选，漏了的点下面补一个，最后一起保存。',
    }));
    if (!items.length) section.append(el('div', { class: 'muted', text: '这张药单上没认出药，可以点下面的按钮自己补一个。' }));
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
      const saved = await persistPrescriptionMedicationBatch(pending);
      for (const item of pending) {
        item.saved = true;
        item.selected = false;
      }
      savedCount = saved.length;
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
  row.append(field('药名', name), field('规格', spec), field('每次剂量', dose), field('备注', notes));

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
    reminderMode: 'strong',
    notes: item.notes.trim() || undefined,
    identity,
    updatedAt: 0,
    createdAt: Date.now(),
  };
}

export async function persistPrescriptionMedicationBatch<T extends PrescriptionMedicationInput>(
  items: readonly T[],
): Promise<Medication[]> {
  const drafts = items.map((item) => {
    const med = medicationFromPrescriptionItem(item);
    const draft = createMedicationDraft({
      id: med.id,
      sourceKind: 'prescription',
      medication: med,
      rules: med.slots.map((slot) => ({
        id: `${med.id}:rule:${slot}`,
        slot,
        timeLocal: SLOT_DEFAULT_TIME[slot],
        enabled: true,
      })),
    });
    draft.duplicateResolution = 'create';
    applyExplicitDose(draft);
    return draft;
  });
  const result = await createMedicationBatch(drafts);
  await rescheduleMedicationReminders().catch(() => undefined);
  return result.medIds.map((id) => drafts.find((draft) => draft.id === id)!.medication);
}

/** Keeps existing-medication scan merges on the same rule/revision semantics. */
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
    reminderMode: 'strong',
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
  await saveMedPhoto(medId, blob);
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

  const capture = iconButton('camera', '拍照', 'btn camera-shutter');
  const album = iconButton('image', '相册上传', 'btn tonal');
  const closeButton = iconButton('arrow-left', '返回', 'btn text');
  const actions = el('div', { class: 'camera-actions' });
  actions.append(capture, album, closeButton);
  card.append(actions);

  const stopWithoutRestore = () => close(false);
  const close = (restore: boolean) => {
    if (closed) return;
    closed = true;
    document.body.classList.remove('camera-capture-active');
    opts.controller.detach(stopWithoutRestore);
    stream?.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    if (restore && opts.isActive()) {
      opts.onClose();
      opts.box.querySelector<HTMLButtonElement>('button')?.focus();
    }
  };
  if (!opts.controller.attach(sessionId, stopWithoutRestore)) return;
  document.body.classList.add('camera-capture-active');

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
  capture.focus();
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

function fileInput(label: string): HTMLInputElement {
  return el('input', {
    type: 'file',
    accept: 'image/*',
    style: 'display:none',
    'aria-label': label,
  } as any) as HTMLInputElement;
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
  const actionIcon = (text: string): Parameters<typeof icon>[0] =>
    text.includes('相册') ? 'image' : text.includes('重试') ? 'retry' : 'camera';
  const primary = iconButton(actionIcon(buttonText), buttonText, 'btn');
  primary.onclick = onClick;
  actions.append(primary);
  if (secondaryText && onSecondary) {
    const secondary = iconButton(actionIcon(secondaryText), secondaryText, 'btn tonal');
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
