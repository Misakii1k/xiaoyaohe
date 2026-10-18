import { SLOT_DEFAULT_TIME, SLOT_LABEL, SLOTS, type LocalDate, type Medication, type Slot } from '../db/schema';
import {
  applyExplicitDose,
  createMedicationDraft,
  parseExplicitDose,
  type MedicationCreateDraft,
} from '../domain/medicationDraft';
import { createAccordion } from './primitives/Accordion';
import { createIconButton } from './primitives/IconButton';
import { createStatusBadge } from './primitives/StatusBadge';
import { createDateControl, createTimeControl } from './primitives/Pickers';
import { createStepper, type StepperOptions } from './primitives/Stepper';

export interface MedicationBatchEditorOptions {
  drafts: MedicationCreateDraft[];
  existingMeds: readonly Medication[];
  onChange?: (drafts: readonly MedicationCreateDraft[]) => void;
}

export class MedicationBatchEditor {
  readonly element = document.createElement('div');
  private readonly drafts: MedicationCreateDraft[];
  private readonly existingMeds: readonly Medication[];
  private readonly onChange?: (drafts: readonly MedicationCreateDraft[]) => void;

  constructor(options: MedicationBatchEditorOptions) {
    this.drafts = options.drafts;
    this.existingMeds = options.existingMeds;
    this.onChange = options.onChange;
    this.element.className = 'medication-batch-editor';
    this.render();
  }

  getDrafts(): readonly MedicationCreateDraft[] {
    return this.drafts;
  }

  append(draft = createMedicationDraft()): MedicationCreateDraft {
    this.drafts.push(draft);
    this.refreshDuplicates();
    this.render();
    this.notify();
    return draft;
  }

  appendMany(drafts: readonly MedicationCreateDraft[]): void {
    this.drafts.push(...drafts);
    this.refreshDuplicates();
    this.render();
    this.notify();
  }

  refresh(): void {
    this.refreshDuplicates();
    this.render();
  }

  private render(): void {
    this.element.replaceChildren(...this.drafts.map((draft, index) => this.renderDraft(draft, index)));
  }

  private renderDraft(draft: MedicationCreateDraft, index: number): HTMLElement {
    const card = document.createElement('section');
    card.className = 'card medication-draft-card';
    card.setAttribute('aria-label', `药品草稿 ${index + 1}`);

    const header = document.createElement('div');
    header.className = 'medication-draft-header';
    const selectionLabel = document.createElement('label');
    selectionLabel.className = 'medication-draft-selection';
    const selected = document.createElement('input');
    selected.type = 'checkbox';
    selected.checked = draft.selected;
    selected.setAttribute('aria-label', `选择第 ${index + 1} 条药品`);
    selected.addEventListener('change', () => {
      draft.selected = selected.checked;
      this.notify();
    });
    selectionLabel.append(selected);
    const title = document.createElement('strong');
    title.textContent = draft.medication.name.trim() || `药品 ${index + 1}`;
    selectionLabel.append(title);
    const actions = document.createElement('div');
    actions.className = 'medication-draft-actions';
    actions.append(
      createIconButton({
        icon: 'copy',
        label: `复制第 ${index + 1} 条药品`,
        onClick: () => this.append(this.copyDraft(draft)),
      }),
      createIconButton({
        icon: 'trash',
        label: `删除第 ${index + 1} 条药品`,
        onClick: () => this.remove(draft),
      }),
    );
    header.append(selectionLabel, actions);
    card.append(header);

    const primary = document.createElement('div');
    primary.className = 'medication-draft-primary';
    const name = inputField('药品名称', 'text', draft.medication.name, true);
    name.input.placeholder = '例如：阿司匹林肠溶片';
    name.input.addEventListener('input', () => {
      draft.medication.name = name.input.value;
      title.textContent = draft.medication.name.trim() || `药品 ${index + 1}`;
      this.refreshDuplicates();
      this.renderDuplicateNotice(draft, duplicateArea);
      this.notify();
    });
    const dosage = inputField('规格', 'text', draft.medication.dosageText);
    dosage.input.placeholder = '例如：100mg/片';
    dosage.input.addEventListener('input', () => { draft.medication.dosageText = dosage.input.value; this.notify(); });
    const dose = inputField('每次剂量', 'text', draft.medication.amountPerDose);
    dose.input.placeholder = '例如：1片、0.25片、5mL';
    const doseStatus = document.createElement('div');
    doseStatus.className = 'dose-inline-status';
    const updateDose = () => {
      applyExplicitDose(draft);
      this.renderDoseStatus(draft, doseStatus);
      this.notify();
    };
    dose.input.addEventListener('input', () => {
      draft.medication.amountPerDose = dose.input.value;
      updateDose();
    });
    primary.append(name.wrapper, dosage.wrapper, dose.wrapper, doseStatus);
    card.append(primary);
    this.renderDoseStatus(draft, doseStatus);

    const duplicateArea = document.createElement('div');
    this.renderDuplicateNotice(draft, duplicateArea);
    card.append(duplicateArea);

    const schedule = document.createElement('div');
    schedule.className = 'medication-draft-schedule';
    const scheduleLabel = document.createElement('div');
    scheduleLabel.className = 'field-label';
    scheduleLabel.textContent = '服药时段与提醒时间';
    const slotButtons = document.createElement('div');
    slotButtons.className = 'medication-slot-buttons';
    for (const slot of SLOTS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = draft.medication.slots.includes(slot) ? 'is-selected' : '';
      button.textContent = SLOT_LABEL[slot];
      button.setAttribute('aria-pressed', String(draft.medication.slots.includes(slot)));
      button.addEventListener('click', () => {
        this.toggleSlot(draft, slot);
        this.refresh();
        this.notify();
      });
      slotButtons.append(button);
    }
    const times = document.createElement('div');
    times.className = 'medication-slot-times';
    for (const rule of draft.rules.filter((candidate) => draft.medication.slots.includes(candidate.slot))) {
      const field = pickerField(`${SLOT_LABEL[rule.slot]}提醒`, 'time', rule.timeLocal);
      field.input.addEventListener('input', () => { rule.timeLocal = field.input.value; this.notify(); });
      times.append(field.wrapper);
    }
    schedule.append(scheduleLabel, slotButtons, times);
    card.append(schedule);

    const inventory = this.inventoryFields(draft);
    const cycle = this.cycleFields(draft);
    const notes = document.createElement('textarea');
    notes.rows = 3;
    notes.value = draft.medication.notes ?? '';
    notes.placeholder = '备注、医嘱补充或识别来源';
    notes.addEventListener('input', () => { draft.medication.notes = notes.value; this.notify(); });
    card.append(
      createAccordion({ title: '库存与有效期', content: inventory }),
      createAccordion({ title: '用药规则', content: cycle }),
      createAccordion({ title: '备注与识别依据', content: labeledControl('备注', notes) }),
    );
    return card;
  }

  private inventoryFields(draft: MedicationCreateDraft): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'medication-detail-grid';
    const expiry = pickerField('有效期', 'date', draft.medication.expiryLocalDate ?? '');
    expiry.input.addEventListener('input', () => {
      draft.medication.expiryLocalDate = expiry.input.value ? expiry.input.value as LocalDate : undefined;
      this.notify();
    });
    const stock = stepperField('当前库存', {
      value: draft.medication.inventory ? draft.medication.inventory.remaining : null,
      min: 0, allowEmpty: true, inputMode: 'decimal',
    });
    const unit = inputField('库存单位', 'text', draft.medication.inventory?.unit ?? '');
    const ensureInventory = () => {
      const remaining = Number(stock.input.value);
      const inventory = draft.medication.inventory ?? { remaining: 0, unit: '' };
      inventory.remaining = Number.isFinite(remaining) && remaining >= 0 ? remaining : 0;
      inventory.unit = unit.input.value.trim();
      // 只填了单位没填数量时不要落成 0：那会让药品直接显示「已缺药」。
      draft.medication.inventory = stock.input.value.trim() ? inventory : undefined;
      this.notify();
    };
    stock.input.addEventListener('input', ensureInventory);
    unit.input.addEventListener('input', ensureInventory);
    grid.append(expiry.wrapper, stock.wrapper, unit.wrapper);
    return grid;
  }

  private cycleFields(draft: MedicationCreateDraft): HTMLElement {
    const section = document.createElement('div');
    section.className = 'medication-cycle-fields';
    if (draft.rules.length === 0) return section;
    const title = document.createElement('div');
    title.className = 'field-label';
    title.textContent = '周期服药';
    section.append(title);
    for (const rule of draft.rules.filter((candidate) => draft.medication.slots.includes(candidate.slot))) {
      const row = document.createElement('div');
      row.className = 'medication-cycle-row';
      const label = document.createElement('label');
      const enabled = document.createElement('input');
      enabled.type = 'checkbox';
      enabled.checked = Boolean(rule.cycle);
      label.append(enabled, document.createTextNode(`${SLOT_LABEL[rule.slot]}按周期服用`));
      const active = stepperField('服药天数', { value: rule.cycle?.activeDays ?? 1, min: 1, max: 365, unit: '天' });
      const rest = stepperField('停药天数', { value: rule.cycle?.restDays ?? 0, min: 0, max: 365, unit: '天' });
      const start = pickerField('周期首日', 'date', rule.cycleStartDate ?? localToday());
      const sync = () => {
        if (!enabled.checked) {
          delete rule.cycle;
          delete rule.cycleStartDate;
        } else {
          rule.cycle = { activeDays: Math.max(1, Number(active.input.value) || 1), restDays: Math.max(0, Number(rest.input.value) || 0) };
          rule.cycleStartDate = start.input.value as LocalDate;
        }
        detail.hidden = !enabled.checked;
        this.notify();
      };
      const detail = document.createElement('div');
      detail.className = 'medication-detail-grid';
      detail.hidden = !enabled.checked;
      detail.append(active.wrapper, rest.wrapper, start.wrapper);
      enabled.addEventListener('change', sync);
      active.input.addEventListener('input', sync);
      rest.input.addEventListener('input', sync);
      start.input.addEventListener('input', sync);
      row.append(label, detail);
      section.append(row);
    }
    return section;
  }

  private renderDoseStatus(draft: MedicationCreateDraft, target: HTMLElement): void {
    target.replaceChildren();
    const parsed = parseExplicitDose(draft.medication.amountPerDose);
    if (parsed) {
      target.append(createStatusBadge(`已识别：每次 ${parsed.quantity}${parsed.unit}`, 'success'));
      return;
    }
    if (draft.medication.amountPerDose.trim()) {
      target.append(createStatusBadge('剂量未结构化，库存不会自动扣减', 'warning'));
    }
  }

  private renderDuplicateNotice(draft: MedicationCreateDraft, target: HTMLElement): void {
    target.replaceChildren();
    if (!draft.duplicateCandidateIds?.length) return;
    const notice = document.createElement('div');
    notice.className = 'medication-duplicate-notice';
    const message = document.createElement('span');
    message.textContent = '发现名称相同或相近的已有药品，请选择处理方式';
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.textContent = '跳过此项';
    skip.className = draft.duplicateResolution === 'skip' ? 'is-selected' : '';
    skip.setAttribute('aria-pressed', String(draft.duplicateResolution === 'skip'));
    skip.addEventListener('click', () => { draft.duplicateResolution = 'skip'; this.renderDuplicateNotice(draft, target); this.notify(); });
    const create = document.createElement('button');
    create.type = 'button';
    create.textContent = '仍新建';
    create.className = draft.duplicateResolution === 'create' ? 'is-selected' : '';
    create.setAttribute('aria-pressed', String(draft.duplicateResolution === 'create'));
    create.addEventListener('click', () => { draft.duplicateResolution = 'create'; this.renderDuplicateNotice(draft, target); this.notify(); });
    notice.append(message, skip, create);
    target.append(notice);
  }

  private refreshDuplicates(): void {
    for (const draft of this.drafts) {
      const name = normalizedName(draft.medication.name);
      if (!name) {
        draft.duplicateCandidateIds = [];
        continue;
      }
      const candidates = new Set<string>();
      for (const med of this.existingMeds) if (normalizedName(med.name) === name) candidates.add(med.id);
      for (const other of this.drafts) {
        if (other !== draft && normalizedName(other.medication.name) === name) candidates.add(other.id);
      }
      const next = [...candidates];
      if (next.join('|') !== (draft.duplicateCandidateIds ?? []).join('|')) draft.duplicateResolution = undefined;
      draft.duplicateCandidateIds = next;
    }
  }

  private toggleSlot(draft: MedicationCreateDraft, slot: Slot): void {
    if (draft.medication.slots.includes(slot)) {
      draft.medication.slots = draft.medication.slots.filter((value) => value !== slot);
      draft.rules = draft.rules.filter((rule) => rule.slot !== slot);
    } else {
      draft.medication.slots = SLOTS.filter((value) => value === slot || draft.medication.slots.includes(value));
      draft.rules.push({ id: `${draft.id}:rule:${slot}`, slot, timeLocal: SLOT_DEFAULT_TIME[slot], enabled: true });
    }
  }

  private copyDraft(draft: MedicationCreateDraft): MedicationCreateDraft {
    const copy = createMedicationDraft({
      medication: { ...draft.medication, identity: { ...draft.medication.identity } },
      sourceKind: 'manual',
      rules: draft.rules.map((rule) => ({ ...rule, id: `${crypto.randomUUID()}:rule:${rule.slot}` })),
    });
    applyExplicitDose(copy);
    return copy;
  }

  private remove(draft: MedicationCreateDraft): void {
    const index = this.drafts.indexOf(draft);
    if (index < 0) return;
    this.drafts.splice(index, 1);
    if (this.drafts.length === 0) this.drafts.push(createMedicationDraft());
    this.refreshDuplicates();
    this.render();
    this.notify();
  }

  private notify(): void {
    this.onChange?.(this.drafts);
  }
}

function inputField(label: string, type: string, value: string, required = false): { wrapper: HTMLElement; input: HTMLInputElement } {
  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  if (required) input.required = true;
  return { wrapper: labeledControl(label, input), input };
}

/** 时间/日期用自绘选择器，其它类型仍走原生 input */
function pickerField(label: string, type: 'time' | 'date', value: string): { wrapper: HTMLElement; input: HTMLInputElement } {
  const control = type === 'time'
    ? createTimeControl({ value, ariaLabel: label })
    : createDateControl({ value, ariaLabel: label, placeholder: '可选' });
  return { wrapper: labeledControl(label, control.root), input: control.input as HTMLInputElement };
}

/** 数字用自绘步进器，不走原生上下小箭头 */
function stepperField(label: string, options: StepperOptions): { wrapper: HTMLElement; input: HTMLInputElement } {
  const control = createStepper({ ariaLabel: label, ...options });
  return { wrapper: labeledControl(label, control.root), input: control.input };
}

function labeledControl(label: string, control: HTMLElement): HTMLElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'medication-field';
  const text = document.createElement('span');
  text.textContent = label;
  wrapper.append(text, control);
  return wrapper;
}

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase('zh-Hans-CN').replace(/[\s\-_]/gu, '');
}

function localToday(): LocalDate {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` as LocalDate;
}
