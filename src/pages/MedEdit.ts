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
import { estimateDailyConsumption, estimateDaysLeft } from '../features/inventory';

export async function renderMedEditPage(root: HTMLElement, medId: string | null): Promise<void> {
  const editing = medId !== null;
  const existing = editing ? await getMed(medId!) : undefined;
  if (editing && !existing) {
    toast('没有找到这种药');
    navigate('/meds');
    return;
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
  const notesInput = el('textarea', { value: med.notes || '', placeholder: '医嘱、注意事项等' });

  // 过期日期（可选），存储为 UTC 毫秒时间戳；input[type=date] 用 yyyy-MM-dd 字符串
  const expiryDateInput = el('input', {
    type: 'date',
    value: med.expiryDate ? ymdUtc(med.expiryDate) : '',
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
  form.append(field('每次用量', amountInput));
  form.append(field('过期日期（可选）', expiryDateInput));

  for (const s of SLOTS) {
    const chip = el('button', {
      class: 'chip' + (selectedSlots.has(s) ? ' on' : ''),
      html: SLOT_LABEL[s],
      type: 'button',
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
    } as any);
    chip.onclick = () => {
      if (selectedDays.has(d)) selectedDays.delete(d);
      else selectedDays.add(d);
      chip.classList.toggle('on');
      refreshDaysLeft();
    };
    dayChips.append(chip);
  }
  form.append(field('服药星期（不选 = 每天）', dayChips));

  // 周期用药配置（吃 N 天停 M 天）
  const existingCycle = existingRules.find((r) => r.cycle)?.cycle;
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
  cycleInputsWrap.append(field('服药天数', activeDaysInput));
  cycleInputsWrap.append(field('停药天数', restDaysInput));
  cycleCard.append(cycleInputsWrap);
  cycleInputsWrap.style.display = cycleEnabled ? '' : 'none';
  cycleCheckbox.onchange = () => {
    cycleEnabled = cycleCheckbox.checked;
    cycleInputsWrap.style.display = cycleEnabled ? '' : 'none';
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
  for (const inp of [remainingInput, amountInput, unitInput]) {
    inp.addEventListener('input', refreshDaysLeft);
  }
  refreshDaysLeft();

  const saveBtn = el('button', { class: 'btn success' });
  saveBtn.append(icon('check'));
  saveBtn.append(el('span', { html: '保存' }));
  saveBtn.onclick = async () => {
    const name = nameInput.value.trim();
    if (!name) {
      toast('请填写药名');
      return;
    }
    med.name = name;
    med.dosageText = dosageInput.value.trim();
    med.amountPerDose = amountInput.value.trim();
    med.slots = SLOTS.filter((s) => selectedSlots.has(s));
    med.mealRelsBySlot = buildMealRelsBySlot();
    med.mealRels = mealRelsFromBySlot(med.mealRelsBySlot);
    med.daysOfWeek = [...selectedDays].sort();
    med.inventory = readInventory();
    med.notes = notesInput.value.trim();
    med.expiryDate = readExpiryDate();
    // 回写 dailyConsumption（基于当前已选择的时段 + 用量推算）
    const daily = estimateDailyConsumption(med, buildRulesPreview());
    if (med.inventory && daily > 0) {
      med.inventory.dailyConsumption = daily;
    } else if (med.inventory) {
      delete med.inventory.dailyConsumption;
    }

    // 相互作用检查：合并新药名 + 现有药品名（排除自身）
    const cycle = readCycle();
    try {
      const others = (await listMeds()).filter((m) => m.id !== med.id);
      const allNames = Array.from(new Set([name, ...others.map((m) => m.name)]));
      const hits = checkInteractions(allNames);
      if (hits.length > 0) {
        const msg = buildInteractionWarning(hits);
        if (!(await confirmDialog(msg, '仍要保存', true))) {
          return;
        }
      }
    } catch {
      // 相互作用检查失败不阻塞保存
    }

    await putMed(med);
    await syncRules(med.id, selectedSlots, timeInputs, existingRules, cycle);

    if (pendingPhoto) await putPhoto({ id: uid(), medId: med.id, blob: pendingPhoto, at: Date.now() });

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
        await softDeleteMed(med.id);
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

  renderPage({ root, title: editing ? '编辑药品' : '新增药品', activeTab: 'meds', content });

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
      if (!f) return;
      setButtonBusy(btn, '识别中…');
      try {
        const r = await identifyByBlob(f);
        if (!r.name) {
          toast('没认出来这是什么药，请手动填写');
          return;
        }
        applyIdentifyResult(med, r);
        applyMedToForm();
        try {
          const h = await aHash(f);
          if (h && !med.identity.photoHashes.includes(h)) med.identity.photoHashes.push(h);
        } catch {
          /* hash 失败不影响 */
        }
        pendingPhoto = f;
        toast(`已识别为「${r.name}」，请确认时段与库存`);
      } catch (e) {
        const msg = e instanceof IdentifyError ? e.message : String(e);
        toast('识别失败：' + msg);
      } finally {
        resetIconButton(btn, 'sparkles', '拍照识别（自动填表）');
      }
    };
    wrap.append(btn, file);
    return wrap;
  }

  function buildNluBlock(): HTMLElement {
    const wrap = el('div', { class: 'nlu-box' });
    const label = el('div', { class: 'nlu-label' });
    label.append(icon('sparkles'));
    label.append(el('span', { html: '用一句话描述（AI 填表）' }));
    wrap.append(label);

    const input = el('textarea', {
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
    }

    const btn = el('button', { class: 'btn nlu-btn', type: 'button' } as any);
    btn.append(icon('sparkles'));
    btn.append(el('span', { html: 'AI 解析并填表' }));
    btn.onclick = async () => {
      const desc = input.value.trim();
      if (!desc) {
        toast('请先描述这种药');
        return;
      }
      setButtonBusy(btn, '解析中…');
      try {
        const draft = await parsePrescription(desc);
        applyDraftToForm(draft);
        toast(`已填入字段 ✓ 置信度 ${Math.round(draft.confidence * 100)}%`);
      } catch (e) {
        const msg = e instanceof ParsePrescriptionError ? e.message : String(e);
        toast('AI 填表失败：' + msg);
      } finally {
        resetIconButton(btn, 'sparkles', 'AI 解析并填表');
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
      if (!f) return;
      setButtonBusy(btn, '识别库存中…');
      try {
        const r = await identifyInventoryByBlob(f, nameInput.value.trim());
        if (r.name && !nameInput.value.trim()) nameInput.value = r.name;
        applyInventoryToInputs(r.inventory);
        toast(`已辅助填写库存，置信度 ${Math.round(r.confidence * 100)}%`);
      } catch (e) {
        const msg = e instanceof IdentifyError ? e.message : String(e);
        toast('库存识别失败：' + msg);
      } finally {
        resetIconButton(btn, 'camera', '拍票据/药盒辅助填写');
      }
    };
    wrap.append(btn, file);
    return wrap;
  }

  function renderScheduleControls(): void {
    scheduleWrap.innerHTML = '';
    timeInputs.clear();
    for (const s of SLOTS) {
      if (!selectedSlots.has(s)) continue;
      const row = el('div', { class: 'meal-slot-row' });
      const head = el('div', { class: 'meal-slot-head' });
      head.append(el('span', { class: 'slot-tag slot-' + s, html: SLOT_LABEL[s] }));
      const timeInput = el('input', {
        type: 'time',
        value: ruleTimeBySlot.get(s) || SLOT_DEFAULT_TIME[s],
      }) as HTMLInputElement;
      timeInputs.set(s, timeInput);
      head.append(timeInput);
      row.append(head);

      const mealChips = el('div', { class: 'chips meal-combo-chips' });
      const relSet = selectedMealBySlot.get(s) ?? new Set<MealRel>();
      selectedMealBySlot.set(s, relSet);
      for (const rel of MEAL_RELS) {
        const chip = el('button', {
          class: 'chip sm' + (relSet.has(rel) ? ' on' : ''),
          html: MEAL_LABEL[rel],
          type: 'button',
        } as any);
        chip.onclick = () => {
          if (relSet.has(rel)) relSet.delete(rel);
          else relSet.add(rel);
          chip.classList.toggle('on');
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
    SLOTS.forEach((s, i) => chips[i]?.classList.toggle('on', selectedSlots.has(s)));
  }

  function syncDayChipVisuals(): void {
    const chips = dayChips.querySelectorAll<HTMLButtonElement>('button.chip');
    for (let i = 0; i < chips.length; i++) chips[i].classList.toggle('on', selectedDays.has(i));
  }

  /** 读取过期日期，转为 UTC 毫秒时间戳；空值返回 undefined */
  function readExpiryDate(): number | undefined {
    const v = expiryDateInput.value;
    if (!v) return undefined;
    // input[type=date] 返回 yyyy-MM-dd；按 UTC 0 点解析避免时区漂移
    const [y, m, d] = v.split('-').map(Number);
    if (!y || !m || !d) return undefined;
    return Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  }

  /** 读取周期用药配置：开关开启且 activeDays/restDays 都 > 0 才返回，否则 undefined */
  function readCycle(): { activeDays: number; restDays: number } | undefined {
    if (!cycleEnabled) return undefined;
    const activeDays = readNumber(activeDaysInput.value);
    const restDays = readNumber(restDaysInput.value);
    if (!activeDays || activeDays <= 0 || restDays == null || restDays < 0) return undefined;
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
}

function field(label: string, input: HTMLElement): HTMLElement {
  const f = el('div', { class: 'field' });
  f.append(el('label', { html: label }));
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
      await putRule(ex);
    } else {
      await putRule({
        id: uid(),
        medId,
        slot: s,
        timeLocal,
        enabled: true,
        cycle,
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

/** 严重等级中文 + 描述，用于相互作用警告文案 */
function severityCn(s: DrugInteraction['severity']): string {
  return s === 'severe' ? '严重' : s === 'moderate' ? '中等' : '轻微';
}

/** 构造相互作用确认对话框的 HTML 文案 */
function buildInteractionWarning(hits: DrugInteraction[]): string {
  const lines = hits.map(
    (h) =>
      `【${severityCn(h.severity)}】${h.drugs.join(' + ')}：${h.description}`,
  );
  return (
    `检测到 ${hits.length} 条药物相互作用：<br><br>` +
    lines.join('<br><br>') +
    '<br><br>仍要保存吗？'
  );
}

function setButtonBusy(btn: HTMLButtonElement, text: string): void {
  btn.setAttribute('disabled', 'true');
  btn.innerHTML = '';
  btn.append(el('span', { html: text }));
}

function resetIconButton(btn: HTMLButtonElement, iconName: 'sparkles' | 'camera', text: string): void {
  btn.removeAttribute('disabled');
  btn.innerHTML = '';
  btn.append(icon(iconName));
  btn.append(el('span', { html: text }));
}

/** 把 UTC 毫秒时间戳格式化成 input[type=date] 需要的 yyyy-MM-dd 字符串（UTC 视角） */
function ymdUtc(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
