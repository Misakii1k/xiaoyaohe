import '../ui/styles/pages/pill-counter.css';
import {
  getMed,
  listMeds,
  listRulesByMed,
  updateMedicationInventory,
} from '../db/local';
import type { Medication, ReminderRule } from '../db/schema';
import { el, toast } from '../ui/components';
import { openBottomSheet, type BottomSheetHandle } from '../ui/primitives/BottomSheet';
import { createButton } from '../ui/primitives/Button';
import { createSelectControl } from '../ui/primitives/Pickers';
import { createSegmentedControl } from '../ui/primitives/SegmentedControl';
import {
  areDoseUnitsCompatible,
  getConfirmedDose,
  roundStock,
} from './inventory';
import type { PillDetectionMode } from './pillEngine';
import { rescheduleMedicationReminders } from './reminderScheduler';

export type FollowupAction = 'set' | 'add' | 'check_dose';

export interface ApplyFollowupParams {
  action: FollowupAction;
  medId: string;
  count: number;
  sourceLabel?: string;
}

export interface ApplyFollowupResult {
  ok: boolean;
  action: FollowupAction;
  message: string;
  diff?: number;
  expectedDaily?: number;
  newRemaining?: number;
}

export interface OpenFollowupOptions {
  count: number;
  defaultMedId?: string;
  mode?: PillDetectionMode;
  skipIfNoMeds?: boolean;
  onDone?: (result: ApplyFollowupResult) => void | Promise<void>;
}

/**
 * 结合药品确认用量与当前启用的提醒规则，比对清点数与当日应取总片数。
 */
export function evaluateDoseComparison(
  count: number,
  med: Medication,
  rules: readonly ReminderRule[],
): ApplyFollowupResult {
  const confirmedDose = getConfirmedDose(med);
  if (!confirmedDose) {
    return {
      ok: false,
      action: 'check_dose',
      message: `「${med.name}」尚未设置明确的每次用量，请先在药品信息中确认用量`,
    };
  }
  if (!areDoseUnitsCompatible(confirmedDose.unit, '粒')) {
    return {
      ok: false,
      action: 'check_dose',
      message: `「${med.name}」的用量单位为「${confirmedDose.unit}」，暂不支持与清点粒数直接核对`,
    };
  }

  const enabledRules = rules.filter((r) => r.enabled && !r.deleted && r.medId === med.id);
  if (enabledRules.length === 0) {
    return {
      ok: false,
      action: 'check_dose',
      message: `「${med.name}」暂无已启用的每日服药提醒，请先开启时段规则后再核对`,
    };
  }

  const expectedDaily = roundStock(confirmedDose.quantity * enabledRules.length);
  const diff = roundStock(count - expectedDaily);

  let message: string;
  if (diff === 0) {
    message = `核对一致：实数 ${count} 粒，与「${med.name}」当日应取（${expectedDaily}${confirmedDose.unit}）刚好相符`;
  } else if (diff > 0) {
    message = `核对提醒：实数 ${count} 粒，比「${med.name}」当日应取（${expectedDaily}${confirmedDose.unit}）多了 ${diff} 粒`;
  } else {
    message = `核对提醒：实数 ${count} 粒，比「${med.name}」当日应取（${expectedDaily}${confirmedDose.unit}）还差 ${Math.abs(diff)} 粒`;
  }

  return {
    ok: true,
    action: 'check_dose',
    message,
    diff,
    expectedDaily,
  };
}

/**
 * 执行数药片后续业务动作：设为剩余、入库累加或核对当日分药用量。
 */
export async function applyPillCountFollowup(
  params: ApplyFollowupParams,
): Promise<ApplyFollowupResult> {
  const count = roundStock(Math.max(0, Number(params.count) || 0));
  const med = await getMed(params.medId);
  if (!med || med.deleted) {
    return {
      ok: false,
      action: params.action,
      message: '未找到所选药品，请刷新后重试',
    };
  }

  if (params.action === 'check_dose') {
    const rules = await listRulesByMed(med.id);
    return evaluateDoseComparison(count, med, rules);
  }

  const existingUnit = med.inventory?.unit?.trim() ?? '';
  if (existingUnit && !areDoseUnitsCompatible(existingUnit, '粒')) {
    const verb = params.action === 'set' ? '设为剩余' : '累加';
    return {
      ok: false,
      action: params.action,
      message: `「${med.name}」库存单位为「${existingUnit}」，不能直接用「粒」${verb}，请先确认单位换算`,
    };
  }

  const targetUnit = existingUnit || '粒';
  const committed = await updateMedicationInventory(
    med.id,
    params.action === 'add'
      ? {
          action: 'add',
          quantity: count,
          unit: targetUnit,
        }
      : {
          action: 'set',
          remaining: count,
          unit: targetUnit,
          expectedRemaining: med.inventory?.remaining,
          expectedUnit: existingUnit || undefined,
        },
    {
      source: 'manual',
      sourceNote:
        params.sourceLabel ??
        (params.action === 'add'
          ? `数药片入库累加 +${count}${targetUnit}`
          : `数药片盘点为 ${count}${targetUnit}`),
    },
  );

  await rescheduleMedicationReminders();

  const newRemaining = committed.med.inventory?.remaining ?? count;
  const message =
    params.action === 'add'
      ? `已入库累加：${med.name} 现有 ${newRemaining}${targetUnit}`
      : `已更新库存：${med.name} 剩余 ${newRemaining}${targetUnit}`;

  return {
    ok: true,
    action: params.action,
    message,
    newRemaining,
  };
}

/**
 * 打开清点完成后的业务关联底抽屉（更新库存 / 累加 / 核对分药用量）。
 */
export async function openPillCountFollowupSheet(
  options: OpenFollowupOptions,
): Promise<void> {
  const count = roundStock(Math.max(0, options.count));
  const activeMeds = (await listMeds()).filter((m) => !m.deleted);
  if (activeMeds.length === 0 && options.skipIfNoMeds) return;

  const rulesByMed = new Map<string, ReminderRule[]>();
  await Promise.all(
    activeMeds.map(async (med) => {
      rulesByMed.set(med.id, await listRulesByMed(med.id));
    }),
  );

  const container = el('div', { class: 'pill-followup-sheet' });
  const header = el('div', { class: 'pill-followup-header' });
  const title = el('h3', { class: 'pill-followup-title', text: '把清点结果用到哪里？' });
  const countBadge = el('span', {
    class: 'pill-counter-count',
    text: `共 ${count} 粒`,
  });
  header.append(title, countBadge);

  let sheetHandle: BottomSheetHandle | undefined;

  if (activeMeds.length === 0) {
    const emptyMsg = el('div', {
      class: 'pill-followup-preview',
      text: '还没有录入在用药品；先去添加药品后，就可以把清点结果直接回填库存或核对分药。',
    });
    const closeBtn = createButton({
      label: '仅关闭',
      variant: 'secondary',
      onClick: () => sheetHandle?.close(),
    });
    container.append(header, emptyMsg, closeBtn);
    sheetHandle = openBottomSheet({
      label: '清点后续操作',
      content: container,
      dismissOnOverlay: true,
    });
    return;
  }

  let selectedMedId =
    options.defaultMedId && activeMeds.some((m) => m.id === options.defaultMedId)
      ? options.defaultMedId
      : activeMeds[0]!.id;
  let selectedAction: FollowupAction = 'set';

  const medControl = createSelectControl({
    ariaLabel: '选择关联药品',
    value: selectedMedId,
    options: activeMeds.map((m) => ({
      value: m.id,
      label: m.inventory?.unit
        ? `${m.name}（现存 ${m.inventory.remaining}${m.inventory.unit}）`
        : m.name,
    })),
  });

  const previewBox = el('div', { class: 'pill-followup-preview' });

  const refreshPreview = () => {
    const med = activeMeds.find((m) => m.id === selectedMedId);
    if (!med) return;
    if (selectedAction === 'check_dose') {
      const check = evaluateDoseComparison(count, med, rulesByMed.get(med.id) ?? []);
      previewBox.textContent = check.message;
      previewBox.dataset.state = check.ok ? (check.diff === 0 ? 'ok' : 'warn') : 'warn';
      return;
    }
    const existingUnit = med.inventory?.unit?.trim() ?? '';
    if (existingUnit && !areDoseUnitsCompatible(existingUnit, '粒')) {
      previewBox.textContent = `「${med.name}」库存单位是「${existingUnit}」，不支持直接用「粒」修改。`;
      previewBox.dataset.state = 'warn';
      return;
    }
    const unit = existingUnit || '粒';
    if (selectedAction === 'add') {
      const base = med.inventory?.remaining ?? 0;
      previewBox.textContent = `将在「${med.name}」原库存 ${base}${unit} 基础上累加 ${count}${unit}（变为 ${roundStock(base + count)}${unit}）`;
    } else {
      previewBox.textContent = `将把「${med.name}」当前剩余库存更新为 ${count}${unit}`;
    }
    previewBox.dataset.state = 'info';
  };

  medControl.select.addEventListener('change', () => {
    selectedMedId = medControl.select.value;
    refreshPreview();
  });

  const actionSegment = createSegmentedControl<FollowupAction>(
    '关联方式',
    [
      { value: 'set', label: '设为剩余' },
      { value: 'add', label: '入库累加' },
      { value: 'check_dose', label: '核对分药' },
    ],
    selectedAction,
    (next) => {
      selectedAction = next;
      refreshPreview();
    },
  );

  const fieldRow = el('div', { class: 'pill-followup-field' });
  fieldRow.append(
    el('label', { class: 'pill-followup-label', text: '对应药品' }),
    medControl.root,
  );

  const actions = el('div', { class: 'pill-followup-actions' });
  const closeBtn = createButton({
    label: '仅关闭',
    variant: 'secondary',
    onClick: () => sheetHandle?.close(),
  });
  const confirmBtn = createButton({
    label: '确认执行',
    variant: 'primary',
    onClick: async () => {
      const result = await applyPillCountFollowup({
        action: selectedAction,
        medId: selectedMedId,
        count,
      });
      toast(result.message);
      if (result.ok) {
        sheetHandle?.close();
        await options.onDone?.(result);
      } else {
        refreshPreview();
      }
    },
  });
  actions.append(closeBtn, confirmBtn);

  refreshPreview();
  container.append(header, fieldRow, actionSegment, previewBox, actions);

  sheetHandle = openBottomSheet({
    label: '清点后续操作',
    content: container,
    dismissOnOverlay: true,
  });
}
