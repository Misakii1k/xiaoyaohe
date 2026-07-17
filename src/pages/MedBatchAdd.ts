import { createIdentifySession, identifyMedicationBatchByBlob, type PrescriptionItemDraft } from '../ai/identify';
import { takePendingMedicationBatch, takePendingMedicationPhotos } from '../ai/pendingMedicationBatch';
import { createMedicationBatch, listMeds } from '../db/local';
import { emptyIdentity } from '../db/schema';
import { createMedicationDraft, applyExplicitDose, validateMedicationDraft } from '../domain/medicationDraft';
import { saveMedPhoto } from '../features/medPhotos';
import { recognizeMedicationImageBatch } from '../features/medicationBatch';
import { rescheduleMedicationReminders } from '../features/reminderScheduler';
import { navigate } from '../router';
import { MedicationBatchEditor } from '../ui/MedicationBatchEditor';
import { createActionDock } from '../ui/primitives/ActionDock';
import { createButton } from '../ui/primitives/Button';
import { renderPage, toast } from '../ui/components';

export async function renderMedBatchAddPage(root: HTMLElement, signal?: AbortSignal): Promise<void> {
  const existingMeds = await listMeds();
  if (signal?.aborted) return;
  const pending = takePendingMedicationBatch();
  const pendingPhotos = takePendingMedicationPhotos();
  const drafts = pending.length > 0 ? pending.map(toDraft) : [createMedicationDraft()];
  // 认药向导拍的药盒照片；draft.id 保存后就是 medId，据此在建档成功后落库
  const boxPhotos = new Map<string, Blob>();
  if (pending.length > 0) {
    drafts.forEach((draft, index) => {
      const photo = pendingPhotos[index];
      if (photo) boxPhotos.set(draft.id, photo);
    });
  }
  const content = document.createElement('div');
  content.className = 'page medication-batch-page';

  const upload = document.createElement('input');
  upload.type = 'file';
  upload.accept = 'image/*';
  upload.multiple = true;
  upload.hidden = true;
  const recognitionStatus = document.createElement('div');
  recognitionStatus.className = 'medication-recognition-status';
  const editor = new MedicationBatchEditor({ drafts, existingMeds, onChange: updateDock });
  const addBlank = createButton({ label: '添加空白药品', variant: 'secondary', icon: 'plus', onClick: () => editor.append() });
  const addPhoto = createButton({ label: '拍照/相册识别', variant: 'secondary', icon: 'camera', onClick: () => upload.click() });
  const tools = document.createElement('div');
  tools.className = 'medication-batch-tools';
  tools.append(addBlank, addPhoto);
  content.append(tools, recognitionStatus, editor.element, upload);

  const saveButton = createButton({ label: '保存 1 条药品', icon: 'check', onClick: () => void saveAll() });
  const dock = createActionDock([saveButton]);
  renderPage({ root, title: '新增药品', activeTab: 'meds', content, actionDock: dock });
  updateDock();

  upload.addEventListener('change', () => void recognizeFiles(Array.from(upload.files ?? [])));

  async function recognizeFiles(files: File[]): Promise<void> {
    upload.value = '';
    if (files.length === 0 || signal?.aborted) return;
    recognitionStatus.textContent = `正在识别 ${files.length} 张图片…`;
    addPhoto.disabled = true;
    try {
      const session = await createIdentifySession('medication_batch');
      if (signal?.aborted) return;
      const result = await recognizeMedicationImageBatch(
        files,
        async (file) => (await identifyMedicationBatchByBlob(file, undefined, { session, signal })).items,
        { signal },
      );
      if (signal?.aborted) return;
      const recognized = result.items.map(toDraft);
      if (recognized.length > 0) editor.appendMany(recognized);
      const messages = [recognized.length > 0 ? `已追加 ${recognized.length} 条识别结果` : '没有识别到可用药品'];
      if (result.failures.length > 0) messages.push(`${result.failures.length} 张图片识别失败，可重新选择失败图片`);
      if (result.cancelled) messages.push('识别已停止');
      recognitionStatus.textContent = messages.join('；');
    } catch (error) {
      if (!signal?.aborted) recognitionStatus.textContent = `识别未完成：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      addPhoto.disabled = false;
    }
  }

  async function saveAll(): Promise<void> {
    if (signal?.aborted) return;
    const selected = editor.getDrafts().filter((draft) => draft.selected && draft.duplicateResolution !== 'skip');
    const invalid = selected.flatMap((draft) => validateMedicationDraft(draft));
    if (invalid.length > 0 || selected.length === 0) {
      editor.refresh();
      toast(selected.length === 0 ? '请至少选择一条药品' : `请先完成 ${invalid.length} 处必填或格式问题`);
      return;
    }
    saveButton.disabled = true;
    try {
      const result = await createMedicationBatch(editor.getDrafts());
      for (const medId of result.medIds) {
        const photo = boxPhotos.get(medId);
        if (!photo) continue;
        try {
          await saveMedPhoto(medId, photo);
        } catch {
          /* 照片保存失败不影响药品建档 */
        }
      }
      let reminderWarning = false;
      if (result.reminderRescheduleRequired) {
        try { await rescheduleMedicationReminders(); } catch { reminderWarning = true; }
      }
      if (signal?.aborted) return;
      toast(reminderWarning ? `已保存 ${result.medIds.length} 条药品，提醒重排待重试` : `已保存 ${result.medIds.length} 条药品`);
      navigate('/meds');
    } catch (error) {
      editor.refresh();
      toast(error instanceof Error ? error.message : '保存失败，请稍后重试');
    } finally {
      saveButton.disabled = false;
    }
  }

  function updateDock(): void {
    const count = editor.getDrafts().filter((draft) => draft.selected && draft.duplicateResolution !== 'skip').length;
    saveButton.querySelector('span')!.textContent = `保存 ${count} 条药品`;
  }
}

function toDraft(item: PrescriptionItemDraft) {
  const draft = createMedicationDraft({
    sourceKind: 'prescription',
    confidence: item.confidence,
    medication: {
      name: item.name,
      dosageText: item.dosageText,
      amountPerDose: item.amountPerDose,
      slots: item.slots,
      mealRels: item.mealRels,
      mealRelsBySlot: item.mealRelsBySlot,
      notes: item.notes,
      identity: { ...emptyIdentity(), ocrNames: item.name ? [item.name] : [] },
    },
    rules: item.slots.map((slot) => ({
      id: `${crypto.randomUUID()}:rule:${slot}`,
      slot,
      timeLocal: slot === 'morning' ? '08:00' : slot === 'noon' ? '12:00' : slot === 'evening' ? '18:00' : '21:30',
      enabled: true,
    })),
  });
  applyExplicitDose(draft);
  return draft;
}
