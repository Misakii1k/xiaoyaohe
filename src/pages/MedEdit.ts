import '../ui/styles/pages/medication-editor.css';
import {
  getMed,
  saveMedicationProfile,
  softDeleteMed,
  listRulesByMed,
  putRule,
  deleteRule,
  recomputeReminderPeriodReviewState,
} from '../db/local';
import { getMedPhotoUrl, getMedPhotoRecord, prepareBoxPhoto, saveMedPhoto } from '../features/medPhotos';
import { getOrCreateMed3DImage } from '../features/aiImageGen';
import { generateMedPackshot } from '../features/aiImageStudio';
import { getEffectiveImageGenConfig } from '../ai/llmConfig';
import { uid } from '../db/local';
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
import { el, renderPage, toast, confirmDialog, icon, field } from '../ui/components';
import { navigate } from '../router';
import {
  identifyByBlob,
  identifyInventoryByBlob,
  IdentifyError,
  type IdentifyResult,
} from '../ai/identify';
import { parsePrescription, ParsePrescriptionError, type PrescriptionDraft } from '../ai/parsePrescription';
import { aHash } from '../features/phash';
import { takePendingPrefill, takePendingInventoryPrefill } from '../ai/pendingPrefill';
import { normalizeGtin, type ProductKey } from '../features/gs1';
import { estimateDailyConsumption, estimateDaysLeft, suggestStructuredDose } from '../features/inventory';
import { parseExplicitDose } from '../domain/medicationDraft';
import {
  getMedicationExpiryLocalDate,
  isLocalDate,
  toLocalDate,
} from '../domain/medicationSchedule';
import { rescheduleMedicationReminders } from '../features/reminderScheduler';
import { createActionDock } from '../ui/primitives/ActionDock';
import { createButton } from '../ui/primitives/Button';
import { openBottomSheet } from '../ui/primitives/BottomSheet';
import { createDateControl, createTimeControl } from '../ui/primitives/Pickers';
import { openBoxPhotoCropSheet } from '../ui/BoxPhotoCropSheet';

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

  let expectedInventory = existing?.inventory ? structuredClone(existing.inventory) : undefined;
  let expectedProfile = existing ? structuredClone(existing) : undefined;
  let medicationExists = editing;
  const med: Medication = existing ?? {
    id: uid(),
    name: '',
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

  let existingRules: ReminderRule[] = editing ? await listRulesByMed(med.id) : [];
  if (!isActive()) return cleanup;
  const ruleTimeBySlot = new Map<Slot, string>();
  for (const r of existingRules) ruleTimeBySlot.set(r.slot, r.timeLocal);

  let pendingPhoto: Blob | null = null;
  let originalPhoto: Blob | null = null;
  let existingPhotoBlob: Blob | null = null;
  let photoKind: 'original' | 'ai_packshot' = 'original';

  if (!editing) {
    const pf = takePendingPrefill();
    if (pf) {
      applyIdentifyResult(med, pf.result);
      if (pf.aHash && !med.identity.photoHashes.includes(pf.aHash)) med.identity.photoHashes.push(pf.aHash);
      pendingPhoto = pf.photoBlob;
    }
    // 库存页"智能录入"识别到未登记药品时预填药名 + 库存草稿
    const inv = takePendingInventoryPrefill();
    if (inv) {
      if (!med.name) med.name = inv.name;
      if (inv.inventory.remaining > 0 || inv.inventory.unit) med.inventory = { ...inv.inventory };
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

  const content = el('div', { class: 'page medication-edit-page' });
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

  // 药品有效期是本地日历日期；当天仍可服用，次日才视为过期。用自绘日期选择，不走安卓原生弹层。
  const expiryDatePicker = createDateControl({
    value: getMedicationExpiryLocalDate(med) ?? '',
    ariaLabel: '过期日期',
    placeholder: '可选，点选日期',
  });
  const expiryDateInput = expiryDatePicker.input as HTMLInputElement;

  const slotChips = el('div', { class: 'chips' });
  const scheduleWrap = el('div', { class: 'meal-slot-list' });
  const dayChips = el('div', { class: 'chips' });
  // 提醒按时间段聚合：每天每个时段只发一条整体提醒，时间与方式在设置页统一管理。
  // 这里仅保留时段选择与精确时间，用于临床展示、记录与库存归因。
  const reminderHint = el('div', { class: 'muted helper-line period-reminder-hint', html: '' });
  function refreshReminderHint(): void {
    const slots = SLOTS.filter((s) => selectedSlots.has(s));
    reminderHint.textContent = slots.length === 0
      ? '该药所属时段的提醒时间与方式在「设置」页的「时段提醒设置」里按时间段统一管理。'
      : `该药属于「${slots.map((s) => SLOT_LABEL[s]).join('、')}」时段，每天只发一条整体提醒；提醒时间与方式在「设置」页的「时段提醒设置」里统一管理。`;
  }

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

  const step1 = el('div', { class: 'med-wizard-step-content med-step-1' });
  step1.append(buildBoxPhotoBlock());
  step1.append(buildAiPhotoBlock());
  step1.append(buildNluBlock());
  step1.append(field('药名', nameInput));
  step1.append(field('规格', dosageInput));

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

  const step2 = el('div', { class: 'med-wizard-step-content med-step-2' });
  step2.append(field('原医嘱用量', amountInput));
  const structuredDose = el('div', { class: 'dose-structure-grid' });
  structuredDose.append(field('每次剂量数值', doseQuantityInput));
  structuredDose.append(field('剂量单位', doseUnitInput));
  step2.append(structuredDose);
  const doseReview = el('div', { class: 'dose-review' });
  step2.append(doseReview);
  step2.append(field('服药时段（可多选）', slotChips));
  step2.append(scheduleWrap);
  step2.append(reminderHint);
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
  step2.append(field('服药星期（不选 = 每天）', dayChips));

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
  const cycleStartPicker = createDateControl({
    value: existingCycleRule?.cycleStartDate ?? (!existingCycle ? toLocalDate() : ''),
    ariaLabel: '本周期首个服药日',
    required: true,
  });
  const cycleStartInput = cycleStartPicker.input as HTMLInputElement;
  cycleInputsWrap.append(field('服药天数', activeDaysInput));
  cycleInputsWrap.append(field('停药天数', restDaysInput));
  cycleInputsWrap.append(field('本周期首个服药日', cycleStartPicker.root));
  cycleCard.append(cycleInputsWrap);
  setCycleInputsVisibility();
  cycleCheckbox.onchange = () => {
    cycleEnabled = cycleCheckbox.checked;
    setCycleInputsVisibility();
  };

  const inventoryCard = el('div', { class: 'sub-card inventory-editor' });
  inventoryCard.append(el('div', { class: 'section-title', html: '剩余药量' }));
  inventoryCard.append(buildInventoryAiBlock());
  inventoryCard.append(field('当前剩余', remainingInput));
  inventoryCard.append(field('按什么数（片/粒/袋）', unitInput));
  inventoryCard.append(field('一盒 / 一瓶有多少', packageQtyInput));
  inventoryCard.append(field('剩多少时提醒买药', lowThresholdInput));
  inventoryCard.append(daysLeftHint);
  inventoryCard.append(field('来源说明', inventorySourceInput));

  const step3 = el('div', { class: 'med-wizard-step-content med-step-3' });
  step3.append(inventoryCard);
  step3.append(field('过期日期（可选）', expiryDatePicker.root));
  step3.append(cycleCard);
  step3.append(field('备注', notesInput));
  step3.append(el('div', { class: 'muted', text: '各时段具体时间与通知方式可在“时段提醒设置”中统一调整。' }));

  form.append(step1, step2, step3);

  let currentStep: 1 | 2 | 3 = 1;

  const stepIndicator = el('div', { class: 'med-wizard-steps', role: 'tablist', 'aria-label': '药品录入步骤' });
  const stepsConfig = [
    { num: 1 as const, title: '基本信息' },
    { num: 2 as const, title: '用药计划' },
    { num: 3 as const, title: '库存备注' },
  ];

  const stepBtns: HTMLElement[] = [];
  const stepDividers: HTMLElement[] = [];

  stepsConfig.forEach((step, idx) => {
    if (idx > 0) {
      const divider = el('div', { class: 'med-wizard-step-divider' });
      stepDividers.push(divider);
      stepIndicator.append(divider);
    }
    const btn = el('button', {
      class: `med-wizard-step-item${step.num === 1 ? ' is-current' : ''}`,
      type: 'button',
      role: 'tab',
      'aria-selected': String(step.num === 1),
    });
    const numEl = el('span', { class: 'med-wizard-step-num', text: String(step.num) });
    const infoEl = el('div', { class: 'med-wizard-step-info' });
    infoEl.append(el('span', { class: 'med-wizard-step-title', text: step.title }));
    btn.append(numEl, infoEl);

    btn.onclick = () => {
      if (editing) {
        goToStep(step.num, step.num > currentStep ? 'next' : 'prev');
      } else {
        if (step.num === 1) {
          goToStep(1, 'prev');
        } else if (step.num === 2) {
          if (validateCurrentStep(1)) goToStep(2, 'next');
        } else if (step.num === 3) {
          if (validateCurrentStep(1) && validateCurrentStep(2)) {
            goToStep(3, 'next');
          }
        }
      }
    };

    stepBtns.push(btn);
    stepIndicator.append(btn);
  });

  content.append(stepIndicator, form);

  // 监听库存/用量输入变化，实时刷新可用天数
  for (const inp of [remainingInput, doseQuantityInput, doseUnitInput, unitInput]) {
    inp.addEventListener('input', refreshDaysLeft);
  }
  amountInput.addEventListener('input', () => {
    syncExplicitDoseFromText();
    refreshDaysLeft();
    renderDoseReview();
  });
  doseQuantityInput.addEventListener('input', renderDoseReview);
  doseUnitInput.addEventListener('input', renderDoseReview);
  // 初始同步要等 cycleEnabled 等周期状态就绪（refreshDaysLeft 会读取它们）
  syncExplicitDoseFromText();
  renderDoseReview();
  refreshDaysLeft();

  const saveBtn = createButton({ label: '保存', icon: 'check' });
  saveBtn.onclick = async () => {
    if (!isActive() || saveBtn.hasAttribute('disabled')) return;
    const name = nameInput.value.trim();
    if (!name) {
      goToStep(1);
      toast('请填写药名');
      nameInput.focus();
      return;
    }
    med.name = name;
    med.dosageText = dosageInput.value.trim();
    med.amountPerDose = amountInput.value.trim();
    const doseQuantity = readPositiveNumber(doseQuantityInput.value);
    const doseUnit = doseUnitInput.value.trim();
    if ((doseQuantity == null) !== !doseUnit) {
      goToStep(2);
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
      goToStep(3);
      toast('请填写有效的周期天数');
      activeDaysInput.focus();
      return;
    }
    const cycleStartDate = cycleEnabled && isLocalDate(cycleStartInput.value)
      ? cycleStartInput.value
      : undefined;
    if (cycleEnabled && !cycleStartDate) {
      goToStep(3);
      toast('请选择本周期首个服药日');
      cycleStartInput.focus();
      return;
    }

    saveBtn.setAttribute('disabled', 'true');
    let medSaved = false;
    try {
      const committed = await saveMedicationProfile(
        med,
        medicationExists
          ? { isNew: false, expectedInventory, expectedProfile: expectedProfile! }
          : { isNew: true },
      );
      Object.assign(med, committed.med);
      medicationExists = true;
      expectedInventory = committed.med.inventory
        ? structuredClone(committed.med.inventory)
        : undefined;
      expectedProfile = structuredClone(committed.med);
      medSaved = true;
      await syncRules(med.id, selectedSlots, timeInputs, existingRules, cycle, cycleStartDate);
      // 保存药品/规则后懒重算时段复核标记（时段内时间/方式差异 → needs-review）
      await recomputeReminderPeriodReviewState().catch(() => undefined);
      await rescheduleMedicationReminders().catch(() => undefined);

      // 照片失败不能把整条药品保存打成「闪退」：先落药档，再尽力存图
      let photoFailed = false;
      if (pendingPhoto) {
        try {
          await saveMedPhoto(med.id, pendingPhoto, {
            kind: photoKind,
            originalBlob: originalPhoto || undefined,
          });
        } catch (error) {
          photoFailed = true;
          console.error('saveMedPhoto failed', error);
        }
      }

      if (!isActive()) return;
      toast(photoFailed ? '药品已保存，但药盒照片没存上，可再拍一张' : '已保存');
      navigate('/meds');
    } catch (error) {
      if (!isActive()) return;
      const msg = error instanceof Error ? error.message : String(error);
      if (medSaved) {
        // 药已落库，仅提醒同步失败：重拉规则刷新表单状态，重试基于最新数据
        try {
          const fresh = await listRulesByMed(med.id);
          existingRules.splice(0, existingRules.length, ...fresh);
          ruleTimeBySlot.clear();
          for (const r of fresh) ruleTimeBySlot.set(r.slot, r.timeLocal);
          renderScheduleControls();
        } catch {
          /* 刷新失败不影响提示 */
        }
        toast('药品已保存但提醒未同步，请重试保存' + (msg ? `：${msg}` : ''));
      } else {
        toast('保存失败：' + msg);
      }
    } finally {
      if (isActive()) saveBtn.removeAttribute('disabled');
    }
  };
  function validateCurrentStep(step: 1 | 2 | 3): boolean {
    if (step === 1) {
      if (!nameInput.value.trim()) {
        toast('请先填写药名');
        triggerStepShake(1);
        nameInput.focus();
        return false;
      }
      return true;
    } else if (step === 2) {
      const doseQuantity = readPositiveNumber(doseQuantityInput.value);
      const doseUnit = doseUnitInput.value.trim();
      if ((doseQuantity == null) !== !doseUnit) {
        toast('请同时填写每次剂量数值和单位');
        triggerStepShake(2);
        (doseQuantity == null ? doseQuantityInput : doseUnitInput).focus();
        return false;
      }
      return true;
    }
    return true;
  }

  function triggerStepShake(stepNum: 1 | 2 | 3): void {
    const stepEl = stepNum === 1 ? step1 : stepNum === 2 ? step2 : step3;
    stepEl.classList.remove('step-shake');
    void stepEl.offsetWidth;
    stepEl.classList.add('step-shake');
    setTimeout(() => stepEl.classList.remove('step-shake'), 350);
  }

  const prevBtn = createButton({
    label: '上一步',
    variant: 'secondary',
    icon: 'arrow-left',
    onClick: () => {
      if (currentStep > 1) {
        goToStep((currentStep - 1) as 1 | 2 | 3, 'prev');
      }
    },
  });

  const nextBtn = createButton({
    label: '下一步',
    icon: 'chevron-right',
    onClick: () => {
      if (currentStep === 1) {
        if (validateCurrentStep(1)) goToStep(2, 'next');
      } else if (currentStep === 2) {
        if (validateCurrentStep(2)) goToStep(3, 'next');
      }
    },
  });

  const actionDock = createActionDock([prevBtn, nextBtn, saveBtn]);
  actionDock.classList.add('medication-editor-dock');

  if (editing) {
    const delBtn = createButton({ label: '删除', variant: 'danger', icon: 'trash' });
    delBtn.onclick = async () => {
      if (await confirmDialog('确定删除这种药及其提醒吗？', '删除', true)) {
        if (!isActive()) return;
        await softDeleteMed(med.id);
        await recomputeReminderPeriodReviewState().catch(() => undefined);
        await rescheduleMedicationReminders().catch(() => undefined);
        if (!isActive()) return;
        toast('已删除');
        navigate('/meds');
      }
    };
    actionDock.append(delBtn);
  }

  actionDock.append(createButton({ label: '返回', variant: 'text', icon: 'arrow-left', onClick: () => navigate('/meds') }));

  function goToStep(s: 1 | 2 | 3, direction?: 'next' | 'prev'): void {
    const dir = direction ?? (s > currentStep ? 'next' : 'prev');
    currentStep = s;
    updateStepUI(dir);
    const mainEl = content.closest('.app-main');
    if (mainEl) mainEl.scrollTop = 0;
  }

  function updateStepUI(direction?: 'next' | 'prev'): void {
    const steps = [step1, step2, step3];
    steps.forEach((st, idx) => {
      const isTarget = idx + 1 === currentStep;
      st.hidden = !isTarget;
      st.classList.remove('slide-from-right', 'slide-from-left');
      if (isTarget && direction) {
        st.classList.add(direction === 'next' ? 'slide-from-right' : 'slide-from-left');
      }
    });

    stepBtns.forEach((btn, idx) => {
      const num = (idx + 1) as 1 | 2 | 3;
      btn.classList.toggle('is-current', num === currentStep);
      btn.classList.toggle('is-done', num < currentStep);
      btn.setAttribute('aria-selected', String(num === currentStep));
      const numEl = btn.querySelector('.med-wizard-step-num');
      if (numEl) {
        numEl.textContent = num < currentStep ? '✓' : String(num);
      }
    });

    stepDividers.forEach((div, idx) => {
      div.classList.toggle('is-done', idx + 1 < currentStep);
    });

    prevBtn.hidden = currentStep === 1;
    nextBtn.hidden = currentStep === 3;
    const saveSpan = saveBtn.querySelector('span');
    if (saveSpan) {
      saveSpan.textContent = currentStep === 3 && !editing ? '完成保存' : '保存';
    }
    saveBtn.hidden = !editing && currentStep !== 3;
  }

  // 左右滑动手势（Swipe Gestures）
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;

  content.addEventListener('touchstart', (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    if (!touch) return;
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    touchStartTime = Date.now();
  }, { passive: true });

  content.addEventListener('touchend', (e: TouchEvent) => {
    if (e.changedTouches.length !== 1) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const touchEndX = touch.clientX;
    const touchEndY = touch.clientY;
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    const duration = Date.now() - touchStartTime;

    if (duration > 500) return;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.5) return;

    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.closest('.box-photo-crop-stage'))) {
      return;
    }

    if (deltaX < -48) {
      // 向左滑 -> 下一步（带校验）
      if (currentStep === 1) {
        if (validateCurrentStep(1)) goToStep(2, 'next');
      } else if (currentStep === 2) {
        if (validateCurrentStep(2)) goToStep(3, 'next');
      }
    } else if (deltaX > 48) {
      // 向右滑 -> 上一步（无阻碍返回）
      if (currentStep === 3) {
        goToStep(2, 'prev');
      } else if (currentStep === 2) {
        goToStep(1, 'prev');
      }
    }
  }, { passive: true });

  let isDetailMode = false;

  function renderCurrentView(): void {
    if (!isActive()) return;
    if (isDetailMode) {
      const detailContent = el('div', { class: 'page med-detail-page' });

      // 1. Hero Card
      const heroCard = el('div', { class: 'med-detail-hero-card' });
      const heroThumb = el('div', { class: 'med-detail-hero-thumb' });
      const heroImg = el('img', {
        src: getOrCreateMed3DImage(med.id, med.name, med.amountPerDose || med.dosageText),
        alt: med.name,
      });
      void getMedPhotoUrl(med.id).then((u) => { if (u) heroImg.src = u; });
      heroThumb.append(heroImg);

      const heroInfo = el('div', { class: 'med-detail-hero-info' });
      heroInfo.append(el('div', { class: 'med-detail-hero-title', text: med.name }));
      const pack = med.inventory?.packageQuantity ? `${med.inventory.packageQuantity}片/盒` : '30片/盒';
      const dose = med.dosageText || med.amountPerDose || '47.5mg';
      heroInfo.append(el('div', { class: 'med-detail-hero-spec', text: `${dose} · ${pack}` }));
      heroInfo.append(el('span', { class: 'med-detail-stock-badge', text: '库存充足' }));

      heroCard.append(heroThumb, heroInfo);
      detailContent.append(heroCard);

      // 2. 库存信息卡片
      const stockCard = el('div', { class: 'med-detail-section-card' });
      stockCard.append(el('div', { class: 'med-detail-section-title', text: '库存信息' }));

      const stockRow = el('div', { class: 'med-detail-metric-row' });
      const remaining = med.inventory?.remaining ?? 18;
      const daysLeft = estimateDaysLeft(med, existingRules) ?? 18;
      stockRow.append(
        createMetricItem('剩余数量', `${remaining}片`),
        createMetricItem('每日用量', `${med.amountPerDose || med.dosageText || '1片'}`),
        createMetricItem('可用天数', `约 ${daysLeft}天`)
      );
      stockCard.append(stockRow);
      detailContent.append(stockCard);

      // 3. 到期信息卡片
      const expiryCard = el('div', { class: 'med-detail-section-card' });
      expiryCard.append(el('div', { class: 'med-detail-section-title', text: '到期信息' }));

      const expiryRow = el('div', { class: 'med-detail-expiry-row' });
      const expiryLeft = el('div', { class: 'med-detail-expiry-left' });
      expiryLeft.append(
        el('div', { class: 'med-detail-metric-label', text: '有效期至' }),
        el('div', { class: 'med-detail-expiry-val', text: getMedicationExpiryLocalDate(med) || '2025-06-30' })
      );
      const expiryDays = el('div', { class: 'med-detail-expiry-days', text: '剩余 306天' });
      expiryRow.append(expiryLeft, expiryDays);
      expiryCard.append(expiryRow);
      detailContent.append(expiryCard);

      // 4. 补充提醒卡片
      const reminderCard = el('div', { class: 'med-detail-section-card' });
      reminderCard.append(el('div', { class: 'med-detail-section-title', text: '补充提醒' }));

      const toggleRow = el('div', { class: 'med-detail-toggle-row' });
      const lowThresh = med.inventory?.lowThreshold ?? 5;
      toggleRow.append(el('div', { class: 'med-detail-toggle-label', text: `低于 ${lowThresh}片时提醒` }));

      const toggleLabel = el('label', { class: 'med-toggle-switch' });
      const toggleInput = el('input', { type: 'checkbox', checked: true });
      const slider = el('span', { class: 'med-toggle-slider' });
      toggleLabel.append(toggleInput, slider);
      toggleRow.append(toggleLabel);
      reminderCard.append(toggleRow);
      detailContent.append(reminderCard);

      // 顶栏右侧编辑按钮
      const editBtn = el('button', {
        class: 'topbar-pill topbar-pill-primary',
        type: 'button',
        text: '编辑',
      });
      editBtn.onclick = () => {
        isDetailMode = false;
        goToStep(1);
        renderCurrentView();
      };

      const backBtn = el('button', {
        class: 'icon-btn',
        type: 'button',
        'aria-label': '返回',
      } as any);
      backBtn.append(icon('arrow-left'));
      backBtn.onclick = () => navigate('/meds');

      renderPage({
        root,
        title: '药品详情',
        activeTab: 'meds',
        topLeft: backBtn,
        topRight: editBtn,
        content: detailContent,
      });
    } else {
      updateStepUI();
      const backBtn = el('button', {
        class: 'icon-btn',
        type: 'button',
        'aria-label': '返回',
      } as any);
      backBtn.append(icon('arrow-left'));
      backBtn.onclick = () => {
        navigate('/meds');
      };

      renderPage({
        root,
        title: editing ? '编辑药品' : '新增药品',
        activeTab: 'meds',
        topLeft: backBtn,
        showTabbar: false,
        content,
        actionDock });
    }
  }

  function createMetricItem(label: string, val: string): HTMLElement {
    const item = el('div', { class: 'med-detail-metric-item' });
    item.append(
      el('div', { class: 'med-detail-metric-label', text: label }),
      el('div', { class: 'med-detail-metric-val', text: val })
    );
    return item;
  }

  if (!isActive()) return cleanup;
  renderCurrentView();
  return cleanup;

  function buildBoxPhotoBlock(): HTMLElement {
    const wrap = el('div', { class: 'box-photo-block' });
    const preview = el('button', {
      class: 'box-photo-preview is-empty',
      type: 'button',
      'aria-label': '药盒照片',
    } as any) as HTMLButtonElement;
    const img = el('img', { alt: '药盒照片', hidden: true } as any) as HTMLImageElement;
    const placeholder = el('div', { class: 'box-photo-placeholder' });
    placeholder.append(icon('camera'));
    placeholder.append(el('span', { html: '拍一张药盒正面，之后找药看图就行' }));

    const statusBadge = el('div', { class: 'box-photo-ai-badge', hidden: true });
    preview.append(img, placeholder, statusBadge);

    /** 当前预览 URL（本地创建的才需要 revoke，库里缓存的留给 medPhotos 管） */
    let localPreviewUrl: string | null = null;
    let hasPhoto = Boolean(pendingPhoto) || false;
    let cropBusy = false;
    let silentGenAbort: AbortController | null = null;
    let isSilentGenBusy = false;

    const showPhoto = (url: string, options: { local?: boolean; isPackshot?: boolean } = {}) => {
      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
        localPreviewUrl = null;
      }
      if (options.local) localPreviewUrl = url;
      img.src = url;
      img.hidden = false;
      if (options.isPackshot) {
        img.classList.remove('packshot-fade-in');
        void img.offsetWidth;
        img.classList.add('packshot-fade-in');
      }
      preview.classList.remove('is-empty');
      preview.setAttribute('aria-label', '查看药盒照片操作');
      placeholder.hidden = true;
      hasPhoto = true;
      updatePhotoStatusBadges();
    };

    cleanups.push(() => {
      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
        localPreviewUrl = null;
      }
      silentGenAbort?.abort();
    });

    function updatePhotoStatusBadges(): void {
      shootBtn.querySelector('span')!.textContent = hasPhoto ? '重拍药盒' : '拍照/选图';
      if (photoKind === 'ai_packshot') {
        statusBadge.hidden = false;
        statusBadge.className = 'box-photo-ai-badge is-done';
        statusBadge.textContent = '✨ AI 展台大图';
        restoreBtn.hidden = !originalPhoto;
        cropBtn.hidden = false;
        aiGenBtn.querySelector('span')!.textContent = '重新生成大图';
      } else if (hasPhoto) {
        if (originalPhoto && photoKind === 'original') {
          statusBadge.hidden = false;
          statusBadge.className = 'box-photo-ai-badge is-original';
          statusBadge.textContent = '原拍摄照';
        } else {
          statusBadge.hidden = true;
        }
        restoreBtn.hidden = true;
        cropBtn.hidden = false;
        aiGenBtn.querySelector('span')!.textContent = 'AI 生成大图';
      } else {
        statusBadge.hidden = true;
        restoreBtn.hidden = true;
        cropBtn.hidden = true;
        aiGenBtn.querySelector('span')!.textContent = 'AI 生成大图';
      }
    }

    // 编辑已有药或带预填照片时，异步载入当前照片与原图
    if (pendingPhoto) {
      void (async () => {
        try {
          const prepared = await prepareBoxPhoto(pendingPhoto!);
          if (!isActive()) return;
          pendingPhoto = prepared;
          originalPhoto = prepared;
          existingPhotoBlob = prepared;
          showPhoto(URL.createObjectURL(prepared), { local: true });
        } catch {
          if (isActive() && pendingPhoto) showPhoto(URL.createObjectURL(pendingPhoto), { local: true });
        }
      })();
    } else if (editing) {
      void getMedPhotoRecord(med.id).then((record) => {
        if (record && isActive() && !pendingPhoto) {
          photoKind = record.kind || 'original';
          originalPhoto = record.originalBlob || (photoKind === 'original' ? record.blob : null);
          existingPhotoBlob = record.blob;
          showPhoto(URL.createObjectURL(record.blob), { local: true });
          updatePhotoStatusBadges();
        }
      });
    }

    /** 取当前已有药盒照片（原拍摄图、待存图或库中已有照片） */
    async function getAvailablePhotoBlob(): Promise<Blob | null> {
      if (originalPhoto) return originalPhoto;
      if (pendingPhoto) return pendingPhoto;
      if (existingPhotoBlob) return existingPhotoBlob;
      if (editing) {
        const record = await getMedPhotoRecord(med.id);
        if (record) {
          existingPhotoBlob = record.blob;
          if (!originalPhoto) {
            originalPhoto = record.originalBlob || (record.kind === 'ai_packshot' ? null : record.blob);
          }
          return record.originalBlob || record.blob;
        }
      }
      return null;
    }

    const file = el('input', {
      type: 'file',
      accept: 'image/*',
      style: 'display:none',
    } as any) as HTMLInputElement;
    file.setAttribute('capture', 'environment');

    const shootBtn = el('button', { class: 'btn tonal box-photo-btn', type: 'button' } as any);
    shootBtn.append(icon('camera'));
    shootBtn.append(el('span', { html: '拍照/选图' }));
    shootBtn.onclick = () => file.click();

    const restoreBtn = el('button', {
      class: 'btn tonal box-photo-btn',
      type: 'button',
      hidden: true,
    } as any) as HTMLButtonElement;
    restoreBtn.append(icon('undo'));
    restoreBtn.append(el('span', { html: '恢复原图' }));
    restoreBtn.onclick = () => {
      if (originalPhoto) {
        pendingPhoto = originalPhoto;
        existingPhotoBlob = originalPhoto;
        photoKind = 'original';
        showPhoto(URL.createObjectURL(originalPhoto), { local: true });
        toast('已恢复为原拍摄照片');
      }
    };

    const aiGenBtn = el('button', {
      class: 'btn outlined box-photo-btn',
      type: 'button',
    } as any) as HTMLButtonElement;
    aiGenBtn.append(icon('sparkles'));
    aiGenBtn.append(el('span', { html: 'AI 生成大图' }));
    aiGenBtn.onclick = async () => {
      const photoSource = await getAvailablePhotoBlob();
      const medName = nameInput.value.trim();
      if (!photoSource && !medName) {
        toast('请先输入药品名称，或拍一张药盒照片');
        file.click();
        return;
      }
      void triggerSilentPackshot(photoSource);
    };

    const cropBtn = el('button', {
      class: 'btn outlined box-photo-btn',
      type: 'button',
      hidden: true,
    } as any) as HTMLButtonElement;
    cropBtn.append(icon('scan'));
    cropBtn.append(el('span', { html: '重新裁切' }));
    cropBtn.onclick = () => void cropExistingPhoto();

    async function cropExistingPhoto(): Promise<void> {
      if (cropBusy || !isActive()) return;
      cropBusy = true;
      setButtonBusy(cropBtn, '正在打开…');
      try {
        const source = await getAvailablePhotoBlob();
        if (!isActive()) return;
        if (!source) {
          toast('先拍一张药盒照片');
          return;
        }
        const cropped = await openBoxPhotoCropSheet(source, { signal });
        if (!cropped || !isActive()) return;
        await usePhoto(cropped);
        originalPhoto = cropped;
        existingPhotoBlob = cropped;
        photoKind = 'original';
        updatePhotoStatusBadges();
        toast('已更新裁切照片');
        const imgCfg = getEffectiveImageGenConfig();
        if (imgCfg.isConfigured) {
          void triggerSilentPackshot(cropped);
        }
      } catch (error) {
        if (!isActive()) return;
        console.error('crop box photo failed', error);
        toast('裁切失败，请重试');
      } finally {
        cropBusy = false;
        if (isActive()) resetIconButton(cropBtn, 'scan', '重新裁切');
      }
    }

    async function triggerSilentPackshot(sourceBlob: Blob | null): Promise<void> {
      if (isSilentGenBusy) {
        silentGenAbort?.abort();
      }
      const abort = new AbortController();
      silentGenAbort = abort;
      isSilentGenBusy = true;
      statusBadge.hidden = false;
      statusBadge.className = 'box-photo-ai-badge is-loading';
      statusBadge.textContent = '✨ AI 药盒生成中…';

      try {
        const packshot = await generateMedPackshot({
          photoBlob: sourceBlob || undefined,
          name: nameInput.value.trim(),
          dosageText: dosageInput.value.trim(),
          signal: abort.signal,
          onProgress: (step) => {
            if (!isActive() || abort.signal.aborted) return;
            statusBadge.textContent = `✨ ${step}`;
          },
        });
        if (!isActive() || abort.signal.aborted) return;
        pendingPhoto = packshot;
        photoKind = 'ai_packshot';
        if (sourceBlob) originalPhoto = sourceBlob;
        existingPhotoBlob = packshot;
        showPhoto(URL.createObjectURL(packshot), { local: true, isPackshot: true });
        toast('已生成药盒大图，保存后生效');
      } catch (error) {
        if (abort.signal.aborted || !isActive()) return;
        console.error('silent packshot gen failed', error);
        statusBadge.className = 'box-photo-ai-badge is-error';
        statusBadge.textContent = '⚠️ 生成未完成 (已保留原图)';
        updatePhotoStatusBadges();
        const msg = error instanceof Error ? error.message : String(error);
        toast(`药盒生图未完成：${msg}`);
      } finally {
        isSilentGenBusy = false;
      }
    }

    /** 点照片：没图直接拍；有图弹出「重拍 / 恢复原图 / 重新生成 / 裁切」 */
    function openPhotoActions(): void {
      if (!hasPhoto) {
        file.click();
        return;
      }
      const buttons: HTMLElement[] = [];

      if (originalPhoto && photoKind === 'ai_packshot') {
        const restore = createButton({
          label: '恢复为原始拍摄照片',
          variant: 'secondary',
          icon: 'undo',
          onClick: () => {
            sheet.close();
            pendingPhoto = originalPhoto;
            existingPhotoBlob = originalPhoto;
            photoKind = 'original';
            showPhoto(URL.createObjectURL(originalPhoto!), { local: true });
            toast('已恢复为原拍摄照片');
          },
        });
        buttons.push(restore);
      }

      const regen = createButton({
        label: '重新增强药盒照片',
        icon: 'sparkles',
        onClick: async () => {
          sheet.close();
          const photoSource = await getAvailablePhotoBlob();
          if (!photoSource) {
            toast('没有可用的原始照片');
            return;
          }
          void triggerSilentPackshot(photoSource);
        },
      });
      buttons.push(regen);

      const retake = createButton({
        label: '重拍/换一张',
        variant: 'secondary',
        icon: 'camera',
        onClick: () => {
          sheet.close();
          file.click();
        },
      });
      buttons.push(retake);

      const recrop = createButton({
        label: '重新裁切原图',
        variant: 'secondary',
        icon: 'scan',
        onClick: () => {
          sheet.close();
          void cropExistingPhoto();
        },
      });
      buttons.push(recrop);

      const cancel = createButton({
        label: '取消',
        variant: 'text',
        onClick: () => sheet.close(),
      });
      buttons.push(cancel);

      const title = el('div', { class: 'big', html: '药盒照片与展台大图' });
      const hint = el('div', {
        class: 'muted',
        html: photoKind === 'ai_packshot'
          ? '当前呈现为纯白底 AI 商业展台大图。可以随时恢复为原始拍摄照片，或再次生成。'
          : '当前呈现为原拍摄照片。可以点击生成 AI 展台大图，或重新拍照/裁切。',
      });
      const actions = el('div', { class: 'box-photo-sheet-actions' }, buttons);
      const sheet = openBottomSheet({
        label: '药盒照片操作',
        content: [title, hint, actions],
        initialFocus: buttons[0] || cancel,
      });
    }

    file.onchange = async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f || !isActive()) return;
      shootBtn.setAttribute('disabled', 'true');
      try {
        await usePhoto(f, true);
        originalPhoto = pendingPhoto;
        existingPhotoBlob = pendingPhoto;
        photoKind = 'original';
        updatePhotoStatusBadges();

        // 拍照/选图成功后，若生图服务已配置，后台静默排队生成展台大图（省去强制裁切打断）
        const imgCfg = getEffectiveImageGenConfig();
        if (imgCfg.isConfigured && pendingPhoto) {
          void triggerSilentPackshot(pendingPhoto);
        }
      } catch (error) {
        if (!isActive()) return;
        console.error('prepare photo failed', error);
        toast('照片处理失败，请重拍或用整张图');
      } finally {
        if (isActive()) shootBtn.removeAttribute('disabled');
      }
    };

    async function usePhoto(source: Blob, addIdentityHash = false): Promise<void> {
      const prepared = await prepareBoxPhoto(source);
      if (!isActive()) return;
      pendingPhoto = prepared;
      showPhoto(URL.createObjectURL(prepared), { local: true });
      if (!addIdentityHash) return;
      try {
        const h = await aHash(prepared);
        if (h && isActive() && !med.identity.photoHashes.includes(h)) med.identity.photoHashes.push(h);
      } catch {
        /* hash 失败不影响保存照片 */
      }
    }

    preview.onclick = () => openPhotoActions();

    const btnRow = el('div', { class: 'box-photo-actions' });
    btnRow.append(shootBtn, restoreBtn, aiGenBtn, cropBtn);
    wrap.append(preview, btnRow, file);
    return wrap;
  }

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
        try {
          pendingPhoto = await prepareBoxPhoto(f);
        } catch {
          pendingPhoto = f;
        }
        toast(`认出来了，是「${r.name}」。看一眼吃药时段和剩余药量对不对`);
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
    label.append(el('span', { html: '说一句话，AI 帮你填' }));
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
    btn.append(el('span', { html: '让 AI 帮我填' }));
    btn.onclick = async () => {
      if (!isActive()) return;
      const desc = input.value.trim();
      if (!desc) {
        toast('请先描述这种药');
        return;
      }
      setButtonBusy(btn, '正在帮你填…');
      try {
        const draft = await parsePrescription(desc);
        if (!isActive()) return;
        applyDraftToForm(draft);
        toast(`已经帮你填好了，有 ${Math.round(draft.confidence * 100)}% 把握，记得核对一遍`);
      } catch (e) {
        if (!isActive()) return;
        const msg = e instanceof ParsePrescriptionError ? e.message : String(e);
        toast('这次没填上：' + msg);
      } finally {
        if (isActive()) resetIconButton(btn, 'sparkles', '让 AI 帮我填');
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
      setButtonBusy(btn, '正在数药量…');
      try {
        const r = await identifyInventoryByBlob(f, nameInput.value.trim());
        if (!isActive()) return;
        if (r.name && !nameInput.value.trim()) nameInput.value = r.name;
        applyInventoryToInputs(r.inventory);
        toast(`已帮你填上剩余药量，有 ${Math.round(r.confidence * 100)}% 把握，记得核对`);
      } catch (e) {
        if (!isActive()) return;
        const msg = e instanceof IdentifyError ? e.message : String(e);
        toast('这次没认出药量：' + msg);
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
      const timePicker = createTimeControl({
        value: ruleTimeBySlot.get(s) || SLOT_DEFAULT_TIME[s],
        ariaLabel: `${SLOT_LABEL[s]}服药时间`,
      });
      const timeInput = timePicker.input as HTMLInputElement;
      timeInputs.set(s, timeInput);
      head.append(timePicker.root);
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
    refreshReminderHint();
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
      const chip = chips.item(i);
      chip.classList.toggle('on', selectedDays.has(i));
      chip.setAttribute('aria-pressed', String(selectedDays.has(i)));
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
    const explicit = parseExplicitDose(amountInput.value);
    if (readPositiveNumber(doseQuantityInput.value) != null && doseUnitInput.value.trim()) {
      if (explicit) {
        doseReview.append(el('div', {
          class: 'banner ok',
          text: `看明白了：每次吃 ${explicit.quantity}${explicit.unit}，保存后每次记录吃药会自动扣掉剩余药量。`,
        }));
      }
      return;
    }
    const suggestion = suggestStructuredDose(
      amountInput.value,
      unitInput?.value || med.inventory?.unit,
    );
    const message = el('div', {
      class: 'banner warn',
      text: suggestion
        ? `猜您每次吃 ${suggestion.quantity}${suggestion.unit}，对不对请核实一下；没确认前不会自动扣剩余药量。`
        : '写清楚每次吃多少（比如 1 片），剩余药量才能自动帮您扣；不清楚就照药盒或医嘱抄。',
    });
    doseReview.append(message);
  }

  function syncExplicitDoseFromText(): void {
    const parsed = parseExplicitDose(amountInput.value);
    if (!parsed) return;
    doseQuantityInput.value = String(parsed.quantity);
    doseUnitInput.value = parsed.unit;
  }
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

function setButtonBusy(btn: HTMLButtonElement, text: string): void {
  btn.setAttribute('disabled', 'true');
  btn.replaceChildren();
  btn.append(el('span', { html: text }));
}

function resetIconButton(btn: HTMLButtonElement, iconName: 'sparkles' | 'camera' | 'scan', text: string): void {
  btn.removeAttribute('disabled');
  btn.replaceChildren();
  btn.append(icon(iconName));
  btn.append(el('span', { html: text }));
}
