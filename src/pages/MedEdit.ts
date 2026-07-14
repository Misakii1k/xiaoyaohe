// 药品新增/编辑页
import {
  getMed,
  putMed,
  softDeleteMed,
  listMeds,
  listRulesByMed,
  putRule,
  deleteRule,
  putPhoto,
} from '../db/local';
import { uid } from '../db/local';
import { checkInteractions, type DrugInteraction } from '../data/drugInteractions';
import {
  SLOTS,
  SLOT_LABEL,
  SLOT_DEFAULT_TIME,
  MEAL_LABEL,
  MEAL_RELS,
  WEEKDAY_LABEL,
  emptyIdentity,
  defaultEscalate,
  mealRelsFromBySlot,
  normalizeMealRelsBySlot,
  type Medication,
  type Slot,
  type MealRel,
  type ReminderRule,
  type MealRelsBySlot,
  type MedicationInventory,
  type LocalDate,
} from '../db/schema';
import { el, renderPage, toast, confirmDialog, icon } from '../ui/components';
import { navigate } from '../router';
import {
  identifyByBlob,
  identifyInventoryByBlob,
  IdentifyError,
  type IdentifyResult,
} from '../ai/identify';
import { parsePrescription, ParsePrescriptionError, type PrescriptionDraft } from '../ai/parsePrescription';
import { aHash } from '../features/phash';
import { takePendingPrefill } from '../ai/pendingPrefill';
import { normalizeGtin, type ProductKey } from '../features/gs1';
import { estimateDailyConsumption, estimateDaysLeft, suggestStructuredDose } from '../features/inventory';
import {
  getMedicationExpiryLocalDate,
  isLocalDate,
  toLocalDate,
} from '../domain/medicationSchedule';
import { rescheduleMedicationReminders } from '../features/reminderScheduler';

export async function renderMedEditPage(
  root: HTMLElement,
  medId: string | null,
  signal?: AbortSignal,
): Promise<() => void> {
  const cleanups: Array<() => void> = [];
  const cleanup = () => cleanups.splice(0).forEach((dispose) => dispose());
  const isActive = () => !signal?.aborted;
  signal?.addEventListener('abort', cleanup, { once: true });
  const editing = medId !== null;
  const existing = editing ? await getMed(medId!) : undefined;
  if (signal?.aborted) return cleanup;
  if (editing && !existing) {
    toast('没有找到这种药');
    navigate('/meds');
    return cleanup;
  }

  const med: Medication = existing ?? {
    id: uid(),
    name: '',
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

  const existingRules = editing ? await listRulesByMed(med.id) : [];
  if (!isActive()) return cleanup;
  const ruleTimeBySlot = new Map<Slot, string>();
  for (const r of existingRules) ruleTimeBySlot.set(r.slot, r.timeLocal);

  let pendingPhoto: Blob | null = null;

  if (!editing) {
    const pf = takePendingPrefill();
    if (pf) {
      applyIdentifyResult(med, pf.result);
      if (pf.aHash && !med.identity.photoHashes.includes(pf.aHash)) med.identity.photoHashes.push(pf.aHash);
      pendingPhoto = pf.photoBlob;
    }
    const codeRaw = sessionStorage.getItem('medbox.prefill.code');
    if (codeRaw) {
      sessionStorage.removeItem('medbox.prefill.code');
      try {
        applyScannedCode(med, JSON.parse(codeRaw) as ProductKey);
      } catch {
        /* ignore */
      }
    }
  }

  const selectedSlots = new Set<Slot>(med.slots);
  const selectedMealBySlot = initMealMap(med.mealRelsBySlot);
  const selectedDays = new Set<number>(med.daysOfWeek);
  const timeInputs = new Map<Slot, HTMLInputElement>();

  const content = el('div', { class: 'page' });
  const form = el('div', { class: 'card' });

  const nameInput = el('input', { type: 'text', value: med.name, placeholder: '例如：阿司匹林肠溶片' });
  const dosageInput = el('input', { type: 'text', value: med.dosageText, placeholder: '例如：100mg/片' });
  const amountInput = el('input', { type: 'text', value: med.amountPerDose, placeholder: '例如：1片 / 半片' });
  const doseQuantityInput = el('input', {
    type: 'number',
    min: '0.0001',
    step: '0.01',
    inputMode: 'decimal',
    value: med.doseQuantity != null ? String(med.doseQuantity) : '',
    placeholder: '例如：1.5',
  } as any) as HTMLInputElement;
  const doseUnitInput = el('input', {
    type: 'text',
    value: med.doseUnit || '',
    placeholder: '片 / 粒 / 袋 / mL',
  }) as HTMLInputElement;
  const notesInput = el('textarea', { value: med.notes || '', placeholder: '医嘱、注意事项等' });

  // 药品有效期是本地日历日期；当天仍可服用，次日才视为过期。
  const expiryDateInput = el('input', {
    type: 'date',
    value: getMedicationExpiryLocalDate(med) ?? '',
  }) as HTMLInputElement;

  const slotChips = el('div', { class: 'chips' });
  const scheduleWrap = el('div', { class: 'meal-slot-list' });
  const dayChips = el('div', { class: 'chips' });

  // 库存可用天数显示（随库存输入实时刷新）
  const daysLeftHint = el('div', { class: 'days-left-hint muted', html: '' });

  const remainingInput = el('input', {
    type: 'number',
    min: '0',
    step: '0.5',
    value: med.inventory?.remaining != null ? String(med.inventory.remaining) : '',
    placeholder: '例如：21',
  } as any) as HTMLInputElement;
  const unitInput = el('input', {
    type: 'text',
    value: med.inventory?.unit || '',
    placeholder: '片 / 粒 / 袋 / mL',
  }) as HTMLInputElement;
  const packageQtyInput = el('input', {
    type: 'number',
    min: '0',
    step: '0.5',
    value: med.inventory?.packageQuantity != null ? String(med.inventory.packageQuantity) : '',
    placeholder: '例如：28',
  } as any) as HTMLInputElement;
  const lowThresholdInput = el('input', {
    type: 'number',
    min: '0',
    step: '0.5',
    value: med.inventory?.lowThreshold != null ? String(med.inventory.lowThreshold) : '',
    placeholder: '例如：5',
  } as any) as HTMLInputElement;
  const inventorySourceInput = el('textarea', {
    value: med.inventory?.sourceNote || '',
    placeholder: '手动填写、票据识别或药盒识别的依据',
    rows: 2,
  } as any) as HTMLTextAreaElement;

  form.append(buildAiPhotoBlock());
  form.append(buildNluBlock());
  form.append(field('药名', nameInput));
  form.append(field('规格', dosageInput));
  form.append(field('原医嘱用量', amountInput));
  const structuredDose = el('div', { class: 'dose-structure-grid' });
  structuredDose.append(field('每次剂量数值', doseQuantityInput));
  structuredDose.append(field('剂量单位', doseUnitInput));
  form.append(structuredDose);
  const doseReview = el('div', { class: 'dose-review' });
  form.append(doseReview);
  renderDoseReview();
  form.append(field('过期日期（可选）', expiryDateInput));

  for (const s of SLOTS) {
    const chip = el('button', {
      class: 'chip' + (selectedSlots.has(s) ? ' on' : ''),
      html: SLOT_LABEL[s],
      type: 'button',
      'aria-pressed': String(selectedSlots.has(s)),
    } as any);
    chip.onclick = () => {
      if (selectedSlots.has(s)) {
        selectedSlots.delete(s);
        selectedMealBySlot.delete(s);
      } else {
        selectedSlots.add(s);
        if (!selectedMealBySlot.has(s)) selectedMealBySlot.set(s, new Set());
      }
      chip.classList.toggle('on');
      chip.setAttribute('aria-pressed', String(selectedSlots.has(s)));
      renderScheduleControls();
      refreshDaysLeft();
    };
    slotChips.append(chip);
  }
  form.append(field('服药时段（可多选）', slotChips));
  form.append(scheduleWrap);
  renderScheduleControls();

  for (let d = 0; d < 7; d++) {
    const chip = el('button', {
      class: 'chip sm' + (selectedDays.has(d) ? ' on' : ''),
      html: WEEKDAY_LABEL[d],
      type: 'button',
      'aria-pressed': String(selectedDays.has(d)),
    } as any);
    chip.onclick = () => {
      if (selectedDays.has(d)) selectedDays.delete(d);
      else selectedDays.add(d);
      chip.classList.toggle('on');
      chip.setAttribute('aria-pressed', String(selectedDays.has(d)));
      refreshDaysLeft();
    };
    dayChips.append(chip);
  }
  form.append(field('服药星期（不选 = 每天）', dayChips));

  // 周期用药配置（吃 N 天停 M 天）
  const existingCycleRule = existingRules.find((r) => r.cycle);
  const existingCycle = existingCycleRule?.cycle;
  let cycleEnabled = !!existingCycle;
  const cycleCard = el('div', { class: 'sub-card cycle-editor' });
  cycleCard.append(el('div', { class: 'section-title', html: '周期用药' }));
  const cycleToggleRow = el('label', { class: 'cycle-toggle-row' });
  const cycleCheckbox = el('input', { type: 'checkbox' } as any) as HTMLInputElement;
  cycleCheckbox.checked = cycleEnabled;
  cycleToggleRow.append(cycleCheckbox);
  cycleToggleRow.append(el('span', { html: '开启周期用药（吃 N 天停 M 天）' }));
  cycleCard.append(cycleToggleRow);
  const cycleInputsWrap = el('div', { class: 'cycle-inputs-wrap' });
  const activeDaysInput = el('input', {
    type: 'number',
    min: '1',
    step: '1',
    value: String(existingCycle?.activeDays ?? 5),
    placeholder: '5',
  } as any) as HTMLInputElement;
  const restDaysInput = el('input', {
    type: 'number',
    min: '0',
    step: '1',
    value: String(existingCycle?.restDays ?? 2),
    placeholder: '2',
  } as any) as HTMLInputElement;
  const cycleStartInput = el('input', {
    type: 'date',
    value: existingCycleRule?.cycleStartDate ?? (!existingCycle ? toLocalDate() : ''),
    required: true,
  } as any) as HTMLInputElement;
  cycleInputsWrap.append(field('服药天数', activeDaysInput));
  cycleInputsWrap.append(field('停药天数', restDaysInput));
  cycleInputsWrap.append(field('本周期首个服药日', cycleStartInput));
  cycleCard.append(cycleInputsWrap);
  setCycleInputsVisibility();
  cycleCheckbox.onchange = () => {
    cycleEnabled = cycleCheckbox.checked;
    setCycleInputsVisibility();
  };
  form.append(cycleCard);

  const inventoryCard = el('div', { class: 'sub-card inventory-editor' });
  inventoryCard.append(el('div', { class: 'section-title', html: '剩余药量' }));
  inventoryCard.append(buildInventoryAiBlock());
  inventoryCard.append(field('当前剩余', remainingInput));
  inventoryCard.append(field('库存单位', unitInput));
  inventoryCard.append(field('单盒/单瓶数量', packageQtyInput));
  inventoryCard.append(field('低库存提醒阈值', lowThresholdInput));
  inventoryCard.append(daysLeftHint);
  inventoryCard.append(field('来源说明', inventorySourceInput));
  form.append(inventoryCard);

  form.append(field('备注', notesInput));
  content.append(form);

  // 监听库存/用量输入变化，实时刷新可用天数
  for (const inp of [remainingInput, amountInput, doseQuantityInput, doseUnitInput, unitInput]) {
    inp.addEventListener('input', refreshDaysLeft);
  }
  amountInput.addEventListener('input', renderDoseReview);
  doseQuantityInput.addEventListener('input', renderDoseReview);
  doseUnitInput.addEventListener('input', renderDoseReview);
  refreshDaysLeft();

  const saveBtn = el('button', { class: 'btn success' });
  saveBtn.append(icon('check'));
  saveBtn.append(el('span', { html: '保存' }));
  saveBtn.onclick = async () => {
    if (!isActive()) return;
    const name = nameInput.value.trim();
    if (!name) {
      toast('请填写药名');
      return;
    }
    med.name = name;
    med.dosageText = dosageInput.value.trim();
    med.amountPerDose = amountInput.value.trim();
    const doseQuantity = readPositiveNumber(doseQuantityInput.value);
    const doseUnit = doseUnitInput.value.trim();
    if ((doseQuantity == null) !== !doseUnit) {
      toast('请同时填写每次剂量数值和单位');
      (doseQuantity == null ? doseQuantityInput : doseUnitInput).focus();
      return;
    }
    if (doseQuantity != null && doseUnit) {
      med.doseQuantity = doseQuantity;
      med.doseUnit = doseUnit;
      med.doseSourceText = med.amountPerDose;
      med.doseReviewRequired = false;
      delete med.doseMigrationSuggestion;
    } else {
      delete med.doseQuantity;
      delete med.doseUnit;
      delete med.doseSourceText;
      med.doseMigrationSuggestion = suggestStructuredDose(med.amountPerDose, med.inventory?.unit);
      med.doseReviewRequired = !!med.amountPerDose;
      if (med.doseReviewRequired) {
        const proceed = await confirmDialog(
          '每次剂量尚未确认，服药打卡不会自动扣减库存。仍要保存为待复核吗？',
          '保存待复核',
        );
        if (!proceed || !isActive()) return;
      }
    }
    med.slots = SLOTS.filter((s) => selectedSlots.has(s));
    med.mealRelsBySlot = buildMealRelsBySlot();
    med.mealRels = mealRelsFromBySlot(med.mealRelsBySlot);
    med.daysOfWeek = [...selectedDays].sort();
    med.inventory = readInventory();
    med.notes = notesInput.value.trim();
    applyExpiryDate();
    // 回写 dailyConsumption（基于当前已选择的时段 + 用量推算）
    const daily = estimateDailyConsumption(med, buildRulesPreview());
    if (med.inventory && daily > 0) {
      med.inventory.dailyConsumption = daily;
    } else if (med.inventory) {
      delete med.inventory.dailyConsumption;
    }

    // 相互作用检查：合并新药名 + 现有药品名（排除自身）
    const cycle = readCycle();
    if (cycleEnabled && !cycle) {
      toast('请填写有效的周期天数');
      activeDaysInput.focus();
      return;
    }
    const cycleStartDate = cycleEnabled && isLocalDate(cycleStartInput.value)
      ? cycleStartInput.value
      : undefined;
    if (cycleEnabled && !cycleStartDate) {
      toast('请选择本周期首个服药日');
      cycleStartInput.focus();
      return;
    }
    try {
      const others = (await listMeds()).filter((m) => m.id !== med.id);
      if (!isActive()) return;
      const allNames = Array.from(new Set([name, ...others.map((m) => m.name)]));
      const hits = checkInteractions(allNames);
      if (hits.length > 0) {
        const msg = buildInteractionWarning(hits);
        if (!(await confirmDialog(msg, '仍要保存', true)) || !isActive()) {
          return;
        }
      }
    } catch {
      // 相互作用检查失败不阻塞保存
    }

    await putMed(med);
    await syncRules(med.id, selectedSlots, timeInputs, existingRules, cycle, cycleStartDate);
    await rescheduleMedicationReminders().catch(() => undefined);

    if (pendingPhoto) await putPhoto({ id: uid(), medId: med.id, blob: pendingPhoto, at: Date.now() });

    if (!isActive()) return;
    toast('已保存');
    navigate('/meds');
  };
  content.append(saveBtn);

  if (editing) {
    const delBtn = el('button', {
      class: 'btn outlined',
      style: 'color:var(--ios-red);border-color:var(--ios-red)',
    } as any);
    delBtn.append(icon('trash'));
    delBtn.append(el('span', { html: '删除这种药' }));
    delBtn.onclick = async () => {
      if (await confirmDialog('确定删除这种药及其提醒吗？', '删除', true)) {
        if (!isActive()) return;
        await softDeleteMed(med.id);
        await rescheduleMedicationReminders().catch(() => undefined);
        if (!isActive()) return;
        toast('已删除');
        navigate('/meds');
      }
    };
    content.append(delBtn);
  }

  const backBtn = el('button', { class: 'btn text' });
  backBtn.append(icon('arrow-left'));
  backBtn.append(el('span', { html: '返回' }));
  backBtn.onclick = () => navigate('/meds');
  content.append(backBtn);

  if (!isActive()) return cleanup;
  renderPage({ root, title: editing ? '编辑药品' : '新增药品', activeTab: 'meds', content });
  return cleanup;

  function buildAiPhotoBlock(): HTMLElement {
    const wrap = el('div', { class: 'inline-actions' });
    const file = el('input', {
      type: 'file',
      accept: 'image/*',
      style: 'display:none',
    } as any) as HTMLInputElement;
    file.setAttribute('capture', 'environment');
    const btn = el('button', { class: 'btn outlined', type: 'button' } as any);
    btn.append(icon('sparkles'));
    btn.append(el('span', { html: '拍照识别（自动填表）' }));
    btn.onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files?.[0];
      if (!f || !isActive()) return;
      setButtonBusy(btn, '识别中…');
      try {
        const r = await identifyByBlob(f);
        if (!isActive()) return;
        if (!r.name) {
          toast('没认出来这是什么药，请手动填写');
          return;
        }
        applyIdentifyResult(med, r);
        applyMedToForm();
        try {
          const h = await aHash(f);
          if (!isActive()) return;
          if (h && !med.identity.photoHashes.includes(h)) med.identity.photoHashes.push(h);
        } catch {
          /* hash 失败不影响 */
        }
        if (!isActive()) return;
        pendingPhoto = f;
        toast(`已识别为「${r.name}」，请确认时段与库存`);
      } catch (e) {
        if (!isActive()) return;
        const msg = e instanceof IdentifyError ? e.message : String(e);
        toast('识别失败：' + msg);
      } finally {
        if (isActive()) resetIconButton(btn, 'sparkles', '拍照识别（自动填表）');
      }
    };
    wrap.append(btn, file);
    return wrap;
  }

  function buildNluBlock(): HTMLElement {
    const wrap = el('div', { class: 'nlu-box' });
    const inputId = 'med-edit-ai-description';
    const label = el('label', { class: 'nlu-label', htmlFor: inputId });
    label.append(icon('sparkles'));
    label.append(el('span', { html: '用一句话描述（AI 填表）' }));
    wrap.append(label);

    const input = el('textarea', {
      id: inputId,
      class: 'nlu-input',
      placeholder: '例：阿司匹林肠溶片 100mg，早餐前和晚餐后各一片，工作日服用',
      rows: 2,
    } as any) as HTMLTextAreaElement;
    wrap.append(input);

    // Pause expensive aurora animation when the NLU box is off-screen
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            entry.target.classList.toggle('nlu-paused', !entry.isIntersecting);
          });
        },
        { threshold: 0 }
      );
      observer.observe(wrap);
      cleanups.push(() => observer.disconnect());
    }

    const btn = el('button', { class: 'btn nlu-btn', type: 'button' } as any);
    btn.append(icon('sparkles'));
    btn.append(el('span', { html: 'AI 解析并填表' }));
    btn.onclick = async () => {
      if (!isActive()) return;
      const desc = input.value.trim();
      if (!desc) {
        toast('请先描述这种药');
        return;
      }
      setButtonBusy(btn, '解析中…');
      try {
        const draft = await parsePrescription(desc);
        if (!isActive()) return;
        applyDraftToForm(draft);
        toast(`已填入字段 ✓ 置信度 ${Math.round(draft.confidence * 100)}%`);
      } catch (e) {
        if (!isActive()) return;
        const msg = e instanceof ParsePrescriptionError ? e.message : String(e);
        toast('AI 填表失败：' + msg);
      } finally {
        if (isActive()) resetIconButton(btn, 'sparkles', 'AI 解析并填表');
      }
    };
    wrap.append(btn);
    return wrap;
  }

  function buildInventoryAiBlock(): HTMLElement {
    const wrap = el('div', { class: 'inline-actions' });
    const file = el('input', {
      type: 'file',
      accept: 'image/*',
      style: 'display:none',
    } as any) as HTMLInputElement;
    const btn = el('button', { class: 'btn outlined', type: 'button' } as any);
    btn.append(icon('camera'));
    btn.append(el('span', { html: '拍票据/药盒辅助填写' }));
    btn.onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files?.[0];
      if (!f || !isActive()) return;
      setButtonBusy(btn, '识别库存中…');
      try {
        const r = await identifyInventoryByBlob(f, nameInput.value.trim());
        if (!isActive()) return;
        if (r.name && !nameInput.value.trim()) nameInput.value = r.name;
        applyInventoryToInputs(r.inventory);
        toast(`已辅助填写库存，置信度 ${Math.round(r.confidence * 100)}%`);
      } catch (e) {
        if (!isActive()) return;
        const msg = e instanceof IdentifyError ? e.message : String(e);
        toast('库存识别失败：' + msg);
      } finally {
        if (isActive()) resetIconButton(btn, 'camera', '拍票据/药盒辅助填写');
      }
    };
    wrap.append(btn, file);
    return wrap;
  }

  function renderScheduleControls(): void {
    scheduleWrap.replaceChildren();
    timeInputs.clear();
    for (const s of SLOTS) {
      if (!selectedSlots.has(s)) continue;
      const row = el('div', { class: 'meal-slot-row' });
      const head = el('div', { class: 'meal-slot-head' });
      head.append(el('span', { class: 'slot-tag slot-' + s, html: SLOT_LABEL[s] }));
      const timeInput = el('input', {
        type: 'time',
        value: ruleTimeBySlot.get(s) || SLOT_DEFAULT_TIME[s],
        'aria-label': `${SLOT_LABEL[s]}服药时间`,
      } as any) as HTMLInputElement;
      timeInputs.set(s, timeInput);
      head.append(timeInput);
      row.append(head);

      const mealChips = el('div', {
        class: 'chips meal-combo-chips',
        role: 'group',
        'aria-label': `${SLOT_LABEL[s]}餐食关系`,
      } as any);
      const relSet = selectedMealBySlot.get(s) ?? new Set<MealRel>();
      selectedMealBySlot.set(s, relSet);
      for (const rel of MEAL_RELS) {
        const chip = el('button', {
          class: 'chip sm' + (relSet.has(rel) ? ' on' : ''),
          html: MEAL_LABEL[rel],
          type: 'button',
          'aria-pressed': String(relSet.has(rel)),
        } as any);
        chip.onclick = () => {
          if (relSet.has(rel)) relSet.delete(rel);
          else relSet.add(rel);
          chip.classList.toggle('on');
          chip.setAttribute('aria-pressed', String(relSet.has(rel)));
        };
        mealChips.append(chip);
      }
      row.append(mealChips);
      scheduleWrap.append(row);
    }
    if (scheduleWrap.childElementCount === 0) {
      scheduleWrap.append(el('div', { class: 'muted helper-line', html: '选择服药时段后，可分别设置早餐前、午餐中、晚餐后。' }));
    }
  }

  function applyMedToForm(): void {
    if (!nameInput.value.trim()) nameInput.value = med.name;
    if (!dosageInput.value.trim()) dosageInput.value = med.dosageText;
    if (!amountInput.value.trim()) amountInput.value = med.amountPerDose;
    renderDoseReview();
    syncSlotChipVisuals();
    renderScheduleControls();
  }

  function applyDraftToForm(d: PrescriptionDraft): void {
    if (d.name) nameInput.value = d.name;
    if (d.dosageText) dosageInput.value = d.dosageText;
    if (d.amountPerDose) amountInput.value = d.amountPerDose;
    if (d.notes) notesInput.value = d.notes;

    if (d.slots.length > 0) {
      for (const s of d.slots) {
        selectedSlots.add(s);
        const t = d.slotTimes[s];
        if (t) ruleTimeBySlot.set(s, t);
      }
      applyMealBySlot(d.mealRelsBySlot, d.mealRels);
      syncSlotChipVisuals();
      renderScheduleControls();
    }

    if (d.daysOfWeek.length > 0) {
      selectedDays.clear();
      for (const d2 of d.daysOfWeek) selectedDays.add(d2);
      syncDayChipVisuals();
    }
    renderDoseReview();
  }

  function applyMealBySlot(bySlot: MealRelsBySlot, fallback: MealRel[]): void {
    const normalized = normalizeMealRelsBySlot(bySlot, [...selectedSlots], fallback);
    for (const s of SLOTS) {
      const rels = normalized[s];
      if (rels && rels.length > 0) selectedMealBySlot.set(s, new Set(rels));
    }
  }

  function buildMealRelsBySlot(): MealRelsBySlot {
    const out: MealRelsBySlot = {};
    for (const s of SLOTS) {
      if (!selectedSlots.has(s)) continue;
      const rels = MEAL_RELS.filter((rel) => selectedMealBySlot.get(s)?.has(rel));
      if (rels.length > 0) out[s] = rels;
    }
    return out;
  }

  function readInventory(): MedicationInventory | undefined {
    const remaining = readNumber(remainingInput.value);
    const packageQuantity = readNumber(packageQtyInput.value);
    const lowThreshold = readNumber(lowThresholdInput.value);
    const unit = unitInput.value.trim();
    const sourceNote = inventorySourceInput.value.trim();
    if (remaining == null && packageQuantity == null && lowThreshold == null && !unit && !sourceNote) return undefined;
    const inv: MedicationInventory = {
      remaining: remaining ?? 0,
      unit: unit || '片',
    };
    if (packageQuantity != null) inv.packageQuantity = packageQuantity;
    if (lowThreshold != null) inv.lowThreshold = lowThreshold;
    if (sourceNote) inv.sourceNote = sourceNote;
    if (med.inventory?.lastReminderAt) inv.lastReminderAt = med.inventory.lastReminderAt;
    return inv;
  }

  function applyInventoryToInputs(inv: MedicationInventory): void {
    if (inv.remaining > 0) remainingInput.value = String(inv.remaining);
    if (inv.unit) unitInput.value = inv.unit;
    if (inv.packageQuantity) packageQtyInput.value = String(inv.packageQuantity);
    if (inv.lowThreshold) lowThresholdInput.value = String(inv.lowThreshold);
    if (inv.sourceNote) inventorySourceInput.value = inv.sourceNote;
  }

  function syncSlotChipVisuals(): void {
    const chips = slotChips.querySelectorAll<HTMLButtonElement>('button.chip');
    SLOTS.forEach((s, i) => {
      chips[i]?.classList.toggle('on', selectedSlots.has(s));
      chips[i]?.setAttribute('aria-pressed', String(selectedSlots.has(s)));
    });
  }

  function syncDayChipVisuals(): void {
    const chips = dayChips.querySelectorAll<HTMLButtonElement>('button.chip');
    for (let i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('on', selectedDays.has(i));
      chips[i].setAttribute('aria-pressed', String(selectedDays.has(i)));
    }
  }

  function applyExpiryDate(): void {
    if (isLocalDate(expiryDateInput.value)) med.expiryLocalDate = expiryDateInput.value;
    else delete med.expiryLocalDate;
    // Once reviewed in the local-date control, the legacy timestamp must not
    // override the selected calendar date during database normalization.
    delete med.expiryDate;
    delete med.expirySourceTimestamp;
  }

  /** 读取周期用药配置：开关开启且 activeDays/restDays 都 > 0 才返回，否则 undefined */
  function readCycle(): { activeDays: number; restDays: number } | undefined {
    if (!cycleEnabled) return undefined;
    const activeDays = readNumber(activeDaysInput.value);
    const restDays = readNumber(restDaysInput.value);
    if (
      !activeDays ||
      activeDays <= 0 ||
      !Number.isInteger(activeDays) ||
      restDays == null ||
      restDays < 0 ||
      !Number.isInteger(restDays)
    ) return undefined;
    if (activeDays + restDays <= 0) return undefined;
    return { activeDays, restDays };
  }

  /** 基于当前已选时段构造一份临时 ReminderRule[]，用于 dailyConsumption 推算 */
  function buildRulesPreview(): ReminderRule[] {
    const out: ReminderRule[] = [];
    for (const s of SLOTS) {
      if (!selectedSlots.has(s)) continue;
      const t = timeInputs.get(s)?.value || SLOT_DEFAULT_TIME[s];
      out.push({
        id: `preview_${s}`,
        medId: med.id,
        slot: s,
        timeLocal: t,
        enabled: true,
        cycle: readCycle(),
        cycleStartDate: cycleEnabled && isLocalDate(cycleStartInput.value)
          ? cycleStartInput.value
          : undefined,
        escalate: defaultEscalate(),
        updatedAt: 0,
      });
    }
    return out;
  }

  /** 实时刷新"约还够 X 天"提示 */
  function refreshDaysLeft(): void {
    const remaining = readNumber(remainingInput.value) ?? 0;
    const unit = unitInput.value.trim() || med.inventory?.unit || '片';
    const previewMed: Medication = {
      ...med,
      amountPerDose: amountInput.value.trim(),
      doseQuantity: readPositiveNumber(doseQuantityInput.value),
      doseUnit: doseUnitInput.value.trim() || undefined,
      slots: SLOTS.filter((s) => selectedSlots.has(s)),
      daysOfWeek: [...selectedDays].sort(),
      inventory: { remaining, unit },
    };
    const days = estimateDaysLeft(previewMed, buildRulesPreview());
    if (days == null || days < 0) {
      daysLeftHint.textContent = '';
      daysLeftHint.style.display = 'none';
      return;
    }
    daysLeftHint.style.display = '';
    daysLeftHint.textContent = `约还够 ${days} 天（按当前用量推算）`;
  }

  function setCycleInputsVisibility(): void {
    cycleInputsWrap.hidden = !cycleEnabled;
    (cycleInputsWrap as HTMLElement & { inert: boolean }).inert = !cycleEnabled;
    cycleCheckbox.setAttribute('aria-expanded', String(cycleEnabled));
  }

  function renderDoseReview(): void {
    doseReview.replaceChildren();
    if (readPositiveNumber(doseQuantityInput.value) != null && doseUnitInput.value.trim()) return;
    const suggestion = suggestStructuredDose(
      amountInput.value,
      unitInput?.value || med.inventory?.unit,
    );
    const message = el('div', {
      class: 'banner warn',
      text: suggestion
        ? `原医嘱可建议为 ${suggestion.quantity}${suggestion.unit}，确认后才会用于库存扣减。`
        : '请按医嘱填写明确的剂量数值和单位；未确认时不会自动扣减库存。',
    });
    doseReview.append(message);
    if (!suggestion) return;
    const accept = el('button', {
      class: 'btn tonal small',
      type: 'button',
      text: '确认使用建议',
    } as any);
    accept.onclick = () => {
      doseQuantityInput.value = String(suggestion.quantity);
      doseUnitInput.value = suggestion.unit;
      renderDoseReview();
      refreshDaysLeft();
      doseQuantityInput.focus();
    };
    doseReview.append(accept);
  }
}

let medEditFieldSeq = 0;
function field(label: string, input: HTMLElement): HTMLElement {
  const f = el('div', { class: 'field' });
  const control = input.matches('input,select,textarea')
    ? input
    : input.querySelector<HTMLElement>('input,select,textarea');
  const labelElement = el('label', { html: label });
  if (control) {
    const id = control.id || `med-edit-field-${++medEditFieldSeq}`;
    control.id = id;
    if (!control.getAttribute('name')) control.setAttribute('name', id);
    labelElement.htmlFor = id;
  } else {
    const labelId = `med-edit-group-${++medEditFieldSeq}`;
    labelElement.id = labelId;
    if (!input.getAttribute('role')) input.setAttribute('role', 'group');
    input.setAttribute('aria-labelledby', labelId);
  }
  f.append(labelElement);
  f.append(input);
  return f;
}

function initMealMap(value: MealRelsBySlot): Map<Slot, Set<MealRel>> {
  const map = new Map<Slot, Set<MealRel>>();
  for (const s of SLOTS) map.set(s, new Set(value[s] ?? []));
  return map;
}

function applyIdentifyResult(med: Medication, r: IdentifyResult): void {
  if (!med.name) med.name = r.name;
  if (!med.dosageText) med.dosageText = r.dosageText;
  if (!med.amountPerDose) med.amountPerDose = r.amountPerDose;
  if (med.slots.length === 0 && r.slots.length) med.slots = [...r.slots];
  if (r.mealRelsBySlot && Object.keys(r.mealRelsBySlot).length > 0) {
    med.mealRelsBySlot = normalizeMealRelsBySlot(r.mealRelsBySlot, med.slots, r.mealRels);
    med.mealRels = mealRelsFromBySlot(med.mealRelsBySlot);
  }

  const id = med.identity;
  const namesHas = new Set(id.ocrNames);
  for (const n of [r.name, ...r.evidence.ocrNames]) {
    if (n && !namesHas.has(n)) id.ocrNames.push(n);
  }
  const gHas = new Set(id.gtins);
  for (const g of r.evidence.gtins) if (g && !gHas.has(normalizeGtin(g))) id.gtins.push(g);
  const rHas = new Set(id.rawCodes);
  for (const c of r.evidence.rawCodes) if (c && !rHas.has(c)) id.rawCodes.push(c);
}

function applyScannedCode(med: Medication, key: ProductKey): void {
  if (key.kind === 'gtin') {
    const norm = normalizeGtin(key.value);
    if (!med.identity.gtins.some((g) => normalizeGtin(g) === norm)) med.identity.gtins.push(key.value);
  } else if (!med.identity.rawCodes.includes(key.value)) {
    med.identity.rawCodes.push(key.value);
  }
}

async function syncRules(
  medId: string,
  selectedSlots: Set<Slot>,
  timeInputs: Map<Slot, HTMLInputElement>,
  existing: ReminderRule[],
  cycle: { activeDays: number; restDays: number } | undefined,
  cycleStartDate: LocalDate | undefined,
): Promise<void> {
  const existBySlot = new Map<Slot, ReminderRule>();
  for (const r of existing) existBySlot.set(r.slot, r);

  for (const s of selectedSlots) {
    const timeLocal = timeInputs.get(s)?.value || SLOT_DEFAULT_TIME[s];
    const ex = existBySlot.get(s);
    if (ex) {
      ex.timeLocal = timeLocal;
      ex.enabled = true;
      ex.cycle = cycle;
      ex.cycleStartDate = cycleStartDate;
      await putRule(ex);
    } else {
      await putRule({
        id: uid(),
        medId,
        slot: s,
        timeLocal,
        enabled: true,
        cycle,
        cycleStartDate,
        escalate: defaultEscalate(),
        updatedAt: 0,
      });
    }
  }

  for (const r of existing) {
    if (!selectedSlots.has(r.slot)) await deleteRule(r.id);
  }
}

function readNumber(value: string): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && value.trim() !== '' ? n : undefined;
}

function readPositiveNumber(value: string): number | undefined {
  const valueAsNumber = readNumber(value);
  return valueAsNumber != null && valueAsNumber > 0 ? valueAsNumber : undefined;
}

/** 严重等级中文 + 描述，用于相互作用警告文案 */
function severityCn(s: DrugInteraction['severity']): string {
  return s === 'severe' ? '严重' : s === 'moderate' ? '中等' : '轻微';
}

/** 构造纯文本确认文案；本地规则库仅覆盖内置的常见组合。 */
function buildInteractionWarning(hits: DrugInteraction[]): string {
  const lines = hits.map(
    (h) =>
      `【${severityCn(h.severity)}】${h.drugs.join(' + ')}：${h.description}`,
  );
  return (
    `常见相互作用提示命中 ${hits.length} 条（仅覆盖应用内置的有限规则，不替代医生或药师判断）：\n\n` +
    lines.join('\n\n') +
    '\n\n仍要保存吗？'
  );
}

function setButtonBusy(btn: HTMLButtonElement, text: string): void {
  btn.setAttribute('disabled', 'true');
  btn.replaceChildren();
  btn.append(el('span', { html: text }));
}

function resetIconButton(btn: HTMLButtonElement, iconName: 'sparkles' | 'camera', text: string): void {
  btn.removeAttribute('disabled');
  btn.replaceChildren();
  btn.append(icon(iconName));
  btn.append(el('span', { html: text }));
}
