import {
  listMeds,
  listRules,
  listReminderPeriodSettings,
  createMedicationBatch,
  getMed,
  putMed,
  softDeleteMed,
  recomputeReminderPeriodReviewState,
  MedicationBatchValidationError,
} from '../../db/local';
import {
  SLOT_LABEL,
  MEDICATION_REMINDER_MODE_LABEL,
  type Slot,
  type LocalDate,
} from '../../db/schema';
import { getMedicationExpiryLocalDate } from '../../domain/medicationSchedule';
import {
  classifyInventoryStatus,
  estimateDaysLeft,
  roundStock,
  suggestStructuredDose,
} from '../../features/inventory';
import { rescheduleMedicationReminders } from '../../features/reminderScheduler';
import { createMedicationDraft, applyExplicitDose } from '../../domain/medicationDraft';
import { checkInteractions } from '../../data/drugInteractions';
import type {
  AssistantCardBlock,
  AssistantCardItem,
  AssistantCardItemStatus,
} from '../assistant';
import {
  type AssistantTool,
  SLOT_VALUES,
  MEDICATION_SLOT_TO_TIME,
  str,
  findMedByName,
  describeMedForConfirm,
} from './toolTypes';

export const listMyMedications: AssistantTool = {
  name: 'list_my_medications',
  label: '翻翻药品清单',
  description: '查询登记过的所有药：名字、规格、每次吃多少、什么时段吃、大概还够吃几天、过期日，以及各时段整体提醒的设置。',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async run() {
    const [meds, rules, periodSettings] = await Promise.all([listMeds(), listRules(), listReminderPeriodSettings()]);
    const medicationRows = meds.map((med): AssistantCardItem => {
      const medRules = rules.filter((r) => r.medId === med.id && !r.deleted && r.enabled);
      const daysLeft = estimateDaysLeft(med, medRules);
      const inventoryStatus = classifyInventoryStatus(med, medRules);
      const inventoryLabel = inventoryStatus === 'empty'
        ? '库存已空'
        : inventoryStatus === 'low'
          ? `仅剩 ${med.inventory?.remaining ?? 0}${med.inventory?.unit || ''}`
          : inventoryStatus === 'days_low'
            ? `约 ${daysLeft} 天`
            : inventoryStatus === 'ok'
              ? `库存 ${med.inventory?.remaining ?? 0}${med.inventory?.unit || ''}`
              : '未设置库存';
      const status: AssistantCardItemStatus = inventoryStatus === 'empty' || inventoryStatus === 'low' || inventoryStatus === 'days_low'
        ? 'warning'
        : inventoryStatus === 'ok'
          ? 'success'
          : 'muted';
      const reminderTimes = medRules.map((r) => r.timeLocal).slice(0, 2).join(' · ');
      return {
        title: med.name,
        subtitle: [med.dosageText, med.amountPerDose ? `每次 ${med.amountPerDose}` : '', reminderTimes].filter(Boolean).join(' · '),
        meta: inventoryLabel,
        status,
        statusLabel: status === 'warning' ? '需补充' : status === 'success' ? '正常' : '未设置',
        icon: 'pill',
      };
    });
    const attentionCount = medicationRows.filter((row) => row.status === 'warning').length;
    const hiddenMedicationCount = Math.max(0, medicationRows.length - 8);
    const needsReview = periodSettings.filter((s) => s.state === 'needs-review');
    const ui: AssistantCardBlock = {
      type: 'card',
      variant: 'inventory',
      icon: 'box',
      eyebrow: `药箱 · ${medicationRows.length} 种药物`,
      title: medicationRows.length > 0 ? '我的药物' : '还没有登记药物',
      badge: attentionCount > 0 ? `${attentionCount} 项需补充` : '状态正常',
      tone: attentionCount > 0 ? 'warning' : 'neutral',
      body: medicationRows.length > 0
        ? `每张药物条目显示规格、提醒时间和库存状态。${hiddenMedicationCount > 0 ? ` 还有 ${hiddenMedicationCount} 种药物未展开。` : ''}${needsReview.length > 0 ? ` 另有 ${needsReview.length} 个时段整体提醒待复核。` : ''}`
        : '可以先添加药物，再让小助手帮你整理服药安排。',
      items: medicationRows.slice(0, 8),
      facts: [
        { label: '药物数', value: `${medicationRows.length} 种` },
        { label: '需留意', value: `${attentionCount} 项` },
        { label: '时段提醒', value: `${periodSettings.length} 个时段` },
      ],
    };
    const details = meds.map((med) => {
      const medRules = rules.filter((r) => r.medId === med.id && !r.deleted && r.enabled);
      const daysLeft = estimateDaysLeft(med, medRules);
      return {
        药名: med.name,
        规格: med.dosageText || undefined,
        每次用量: med.amountPerDose || undefined,
        提醒: medRules.map((r) => `${SLOT_LABEL[r.slot]} ${r.timeLocal}`),
        剩余数量: med.inventory ? `${med.inventory.remaining}${med.inventory.unit || ''}` : undefined,
        大约还够吃: daysLeft != null ? `${daysLeft} 天` : undefined,
        过期日: getMedicationExpiryLocalDate(med) ?? undefined,
        备注: med.notes || undefined,
      };
    });
    return {
      ui,
      药物: details,
      时段提醒设置: periodSettings.map((s) => ({
        时段: SLOT_LABEL[s.slot],
        整体时间: s.timeLocal,
        提醒方式: MEDICATION_REMINDER_MODE_LABEL[s.mode],
        状态: s.state === 'needs-review' ? '待复核' : '正常',
        重复策略: s.escalate.repeatEveryMin > 0
          ? `每 ${s.escalate.repeatEveryMin} 分钟重推（最多 ${s.escalate.maxRepeats} 次${s.escalate.notifyCaregiverAfterMin > 0 ? `；${s.escalate.notifyCaregiverAfterMin} 分钟后通知照护者` : ''}）`
          : '不重推',
      })),
    };
  },
};

export const addMedication: AssistantTool = {
  name: 'add_medication',
  label: '帮忙新增一种药',
  description: '在药箱里新增一种药。必填药名；可填规格、每次用量、提醒时段（早/中/晚/睡前 多选，默认带默认时间）、初始库存。会同时创建对应的提醒规则。',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '药品名', maxLength: 120 },
      dosageText: { type: 'string', description: '规格，如 "5mg/片"', maxLength: 80 },
      amountPerDose: { type: 'string', description: '每次用量文本，如 "1片" / "半片" / "2喷"', maxLength: 40 },
      slots: {
        type: 'array',
        items: { type: 'string', enum: SLOT_VALUES },
        description: '提醒时段，多选；不传则不建提醒',
        maxItems: 4,
      },
      inventoryRemaining: { type: 'number', description: '初始库存数量', minimum: 0 },
      inventoryUnit: { type: 'string', description: '库存单位，如 片/粒/袋/mL', maxLength: 12 },
      notes: { type: 'string', description: '可选备注', maxLength: 200 },
    },
    required: ['name'],
    additionalProperties: false,
  },
  confirm(args) {
    const name = str(args.name);
    const slots = Array.isArray(args.slots)
      ? (args.slots as Slot[]).filter((s) => SLOT_VALUES.includes(s))
      : [];
    const slotText = slots.length > 0 ? slots.map((s) => SLOT_LABEL[s]).join('·') : '不建提醒';
    const inv = typeof args.inventoryRemaining === 'number'
      ? `初始库存 ${args.inventoryRemaining}${str(args.inventoryUnit) || ''}`
      : '不设库存';
    return `新增药品「${name}」（${slotText}，${inv}）？`;
  },
  async run(args) {
    const name = str(args.name);
    if (!name) return { ok: false, 提示: '请提供药品名称' };
    const existing = await listMeds();
    const dup = existing.find((m) => !m.deleted && m.name.trim().toLowerCase() === name.toLowerCase());
    if (dup) return { ok: false, 提示: `已经有一种叫「${dup.name}」的药了，要不要直接改它？` };

    const slots: Slot[] = Array.isArray(args.slots)
      ? (args.slots as Slot[]).filter((s) => SLOT_VALUES.includes(s))
      : [];
    const draft = createMedicationDraft({
      sourceKind: 'manual',
      medication: {
        name,
        dosageText: str(args.dosageText),
        amountPerDose: str(args.amountPerDose),
        slots,
        daysOfWeek: [],
        notes: str(args.notes) || undefined,
      },
    });
    applyExplicitDose(draft);
    if (typeof args.inventoryRemaining === 'number' && args.inventoryRemaining >= 0) {
      const unit = str(args.inventoryUnit) || draft.medication.doseUnit || '片';
      draft.medication.inventory = {
        remaining: roundStock(args.inventoryRemaining),
        unit,
      };
    }
    draft.rules = slots.map((slot) => ({
      id: `rule-${draft.id}-${slot}`,
      slot,
      timeLocal: MEDICATION_SLOT_TO_TIME[slot],
      enabled: true,
    }));
    try {
      const result = await createMedicationBatch([draft]);
      try { await rescheduleMedicationReminders(); } catch { /* 重排失败下次启动兜底 */ }
      try { await recomputeReminderPeriodReviewState(); } catch { /* 复核标记下次打开设置页会刷新 */ }
      const createdId = result.medIds[0];
      const created = createdId ? await getMed(createdId) : undefined;
      const summary = created ? describeMedForConfirm(created) : name;
      const ui: AssistantCardBlock = {
        type: 'card',
        variant: 'medication',
        icon: 'pill',
        eyebrow: '已新增药品',
        title: name,
        tone: 'success',
        body: summary,
        facts: [
          { label: '提醒时段', value: slots.length > 0 ? slots.map((s) => SLOT_LABEL[s]).join('·') : '未建提醒' },
          { label: '库存', value: draft.medication.inventory ? `${draft.medication.inventory.remaining}${draft.medication.inventory.unit}` : '未设置' },
        ],
      };
      return {
        ok: true,
        已新增: `「${name}」已加入药箱`,
        medId: result.medIds[0],
        ui,
      };
    } catch (error) {
      if (error instanceof MedicationBatchValidationError) {
        const messages = [...error.draftErrors.values()].flat().map((e) => e.message);
        return { ok: false, 提示: `校验未通过：${messages.join('；') || '请检查填写'}` };
      }
      const msg = error instanceof Error ? error.message : String(error);
      return { ok: false, 提示: `新增失败：${msg}` };
    }
  },
};

export const updateMedication: AssistantTool = {
  name: 'update_medication',
  label: '帮忙改一下药品信息',
  description: '修改一种已存在的药品的：名称、规格、每次用量、备注、过期日。提醒时段和库存请用其他对应工具。',
  parameters: {
    type: 'object',
    properties: {
      medName: { type: 'string', description: '药名，可以是部分名字' },
      name: { type: 'string', description: '新药名（不改则不传）', maxLength: 120 },
      dosageText: { type: 'string', description: '新规格，如 "5mg/片"', maxLength: 80 },
      amountPerDose: { type: 'string', description: '新每次用量文本，如 "1片" / "半片"', maxLength: 40 },
      notes: { type: 'string', description: '新备注；传空字符串等价于清空', maxLength: 200 },
      expiryLocalDate: { type: 'string', description: '过期日 YYYY-MM-DD；传空字符串清空', pattern: '^\\d{4}-\\d{2}-\\d{2}$|^$' },
    },
    required: ['medName'],
    additionalProperties: false,
  },
  confirm(args) {
    const name = str(args.medName);
    const changes: string[] = [];
    if (typeof args.name === 'string' && args.name.trim()) changes.push(`改名→${args.name.trim()}`);
    if (typeof args.dosageText === 'string') changes.push(`规格→${args.dosageText || '空'}`);
    if (typeof args.amountPerDose === 'string') changes.push(`每次用量→${args.amountPerDose || '空'}`);
    if (typeof args.notes === 'string') changes.push(`备注→${args.notes || '空'}`);
    if (typeof args.expiryLocalDate === 'string') changes.push(`过期日→${args.expiryLocalDate || '空'}`);
    if (changes.length === 0) return `确认不修改「${name}」任何字段？`;
    return `把「${name}」的字段更新为：\n${changes.join('；\n')}？`;
  },
  async run(args) {
    const name = str(args.medName);
    const hasAnyField = typeof args.name === 'string'
      || typeof args.dosageText === 'string'
      || typeof args.amountPerDose === 'string'
      || typeof args.notes === 'string'
      || typeof args.expiryLocalDate === 'string';
    if (!hasAnyField) {
      return { ok: false, 提示: '没有要更新的字段' };
    }
    const { med } = await findMedByName(name);
    if (!med) return { ok: false, 提示: `没找到叫「${name}」的药` };

    const changes: string[] = [];
    if (typeof args.name === 'string') {
      const newName = args.name.trim();
      if (newName && newName !== med.name) {
        const others = (await listMeds()).filter((m) => !m.deleted && m.id !== med.id);
        if (others.some((o) => o.name.trim().toLowerCase() === newName.toLowerCase())) {
          return { ok: false, 提示: `已经有叫「${newName}」的药了，不能重名` };
        }
        med.name = newName;
        changes.push(`名字→${newName}`);
      }
    }
    if (typeof args.dosageText === 'string') {
      med.dosageText = args.dosageText.trim();
      changes.push(`规格→${med.dosageText || '空'}`);
    }
    if (typeof args.amountPerDose === 'string') {
      const newDose = args.amountPerDose.trim();
      med.amountPerDose = newDose;
      if (newDose) {
        const parsed = suggestStructuredDose(newDose, med.inventory?.unit || med.doseUnit);
        if (parsed) {
          med.doseQuantity = parsed.quantity;
          med.doseUnit = parsed.unit;
          med.doseSourceText = newDose;
          med.doseReviewRequired = false;
          delete med.doseMigrationSuggestion;
        } else {
          delete med.doseQuantity;
          delete med.doseUnit;
          delete med.doseSourceText;
          med.doseReviewRequired = true;
        }
      } else {
        delete med.doseQuantity;
        delete med.doseUnit;
        delete med.doseSourceText;
        med.doseReviewRequired = false;
      }
      changes.push(`每次用量→${newDose || '空'}`);
    }
    if (typeof args.notes === 'string') {
      med.notes = args.notes.trim() || undefined;
      changes.push(`备注→${med.notes || '空'}`);
    }
    if (typeof args.expiryLocalDate === 'string') {
      if (args.expiryLocalDate === '') {
        med.expiryLocalDate = undefined;
        delete med.expiryDate;
        changes.push('过期日→空');
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(args.expiryLocalDate)) {
        med.expiryLocalDate = args.expiryLocalDate as LocalDate;
        changes.push(`过期日→${args.expiryLocalDate}`);
      }
    }

    if (changes.length === 0) {
      return { ok: false, 提示: '没有要更新的字段' };
    }
    await putMed(med);
    try { await rescheduleMedicationReminders(); } catch { /* 重排失败下次启动兜底 */ }
    try { await recomputeReminderPeriodReviewState(); } catch { /* 复核标记下次打开设置页会刷新 */ }
    const ui: AssistantCardBlock = {
      type: 'card',
      variant: 'medication',
      icon: 'pill',
      eyebrow: '已更新药品',
      title: med.name,
      tone: 'success',
      body: changes.join('；'),
    };
    return { ok: true, 已更新: `「${med.name}」字段已修改：${changes.join('；')}`, 改动: changes, ui };
  },
};

export const deleteMedication: AssistantTool = {
  name: 'delete_medication',
  label: '帮忙删除一种药',
  description: '软删除一种药品（连带提醒规则、计划快照）。服药记录保留以便历史追溯，但药品会从清单消失。请先确认用户真的要删除，不要轻易调用。',
  parameters: {
    type: 'object',
    properties: {
      medName: { type: 'string', description: '药名，可以是部分名字' },
      reason: { type: 'string', description: '删除原因（可选，仅记录用）', maxLength: 80 },
    },
    required: ['medName'],
    additionalProperties: false,
  },
  confirm(args) {
    return `确认删除药品「${str(args.medName)}」？\n提醒规则会被停用，历史服药记录保留；之后可以从备份恢复。`;
  },
  async run(args) {
    const name = str(args.medName);
    const { med } = await findMedByName(name);
    if (!med) return { ok: false, 提示: `没找到叫「${name}」的药` };
    const medName = med.name;
    const medId = med.id;
    await softDeleteMed(medId);
    try { await rescheduleMedicationReminders(); } catch { /* 重排失败下次启动兜底 */ }
    try { await recomputeReminderPeriodReviewState(); } catch { /* 复核标记下次打开设置页会刷新 */ }
    const ui: AssistantCardBlock = {
      type: 'card',
      variant: 'medication',
      icon: 'trash',
      eyebrow: '已删除药品',
      title: medName,
      tone: 'warning',
      body: '相关提醒已停用，历史记录保留。',
    };
    return { ok: true, 已删除: `「${medName}」已从药箱删除`, medId, ui };
  },
};

export const checkDrugInteractionsTool: AssistantTool = {
  name: 'check_drug_interactions',
  label: '排查药物相互作用与禁忌',
  description: '排查当前药箱中已登记的所有药品，或者结合用户提到的额外药品名称，检查是否存在已知的配伍禁忌、严重出血风险、代谢抑制或不良相互作用。',
  parameters: {
    type: 'object',
    properties: {
      additionalMeds: {
        type: 'array',
        items: { type: 'string' },
        description: '可选，要加入一起联合排查的新增/拟服用药品名称列表',
      },
    },
    additionalProperties: false,
  },
  async run(args) {
    const meds = await listMeds();
    const existingNames = meds.filter((m) => !m.deleted).map((m) => m.name);
    const additional = Array.isArray(args.additionalMeds)
      ? (args.additionalMeds as unknown[]).map(str).filter(Boolean)
      : [];
    const allNames = Array.from(new Set([...existingNames, ...additional]));

    if (allNames.length < 2) {
      return {
        ok: true,
        提示: '当前排查的药品数量少于 2 种，未发现相互作用组合。可以传入额外药品名称一起联合排查。',
        参与排查药品: allNames,
      };
    }

    const hits = checkInteractions(allNames);
    const severeHits = hits.filter((h) => h.severity === 'severe');
    const moderateHits = hits.filter((h) => h.severity === 'moderate');
    const mildHits = hits.filter((h) => h.severity === 'mild');

    const items: AssistantCardItem[] = hits.map((hit) => {
      const status: AssistantCardItemStatus = hit.severity === 'severe'
        ? 'warning'
        : hit.severity === 'moderate'
          ? 'warning'
          : 'muted';
      const statusLabel = hit.severity === 'severe' ? '严重警告' : hit.severity === 'moderate' ? '中度风险' : '轻度注意';
      return {
        title: hit.drugs.join(' ✕ '),
        subtitle: hit.description,
        status,
        statusLabel,
        icon: hit.severity === 'severe' ? 'warn' : 'info',
      };
    });

    const ui: AssistantCardBlock = {
      type: 'card',
      variant: 'notice',
      icon: hits.length > 0 ? 'warn' : 'check',
      eyebrow: `相互作用排查 · 共排查 ${allNames.length} 种药物`,
      title: hits.length > 0 ? `发现 ${hits.length} 项潜在用药相互作用` : '未发现已知严重药物相互作用',
      badge: hits.length > 0 ? (severeHits.length > 0 ? `${severeHits.length} 严重风险` : `${hits.length} 项注意`) : '安全',
      tone: severeHits.length > 0 ? 'warning' : hits.length > 0 ? 'warning' : 'success',
      body: hits.length > 0
        ? `排查了 ${allNames.join('、')}。发现以下相互作用，请遵医嘱合理调整服药间隔或监测指标：`
        : `排查了 ${allNames.join('、')}，在当前规则库中未命中常见严重禁忌组合。若有特殊用药需求请遵医嘱。`,
      items,
      facts: [
        { label: '排查药品', value: `${allNames.length} 种` },
        { label: '严重风险', value: `${severeHits.length} 项` },
        { label: '中度/轻度', value: `${moderateHits.length + mildHits.length} 项` },
      ],
    };

    return {
      ok: true,
      发现相互作用数: hits.length,
      严重风险数: severeHits.length,
      排查药品清单: allNames,
      命中详情: hits.map((h) => ({
        药物组合: h.drugs.join(' + '),
        严重程度: h.severity === 'severe' ? '严重' : h.severity === 'moderate' ? '中度' : '轻度',
        风险说明: h.description,
      })),
      ui,
    };
  },
};

export const batchImportMedicationsTool: AssistantTool = {
  name: 'batch_import_medications',
  label: '批量导入处方/清单中的药品',
  description: '把从处方单、病历单、图片或表格中提取的一批药品（多项）一次性录入到药箱中，并建立提醒规则与初始库存。',
  parameters: {
    type: 'object',
    properties: {
      medications: {
        type: 'array',
        minItems: 1,
        maxItems: 30,
        description: '要批量录入的药品列表',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '药品名称', maxLength: 120 },
            dosageText: { type: 'string', description: '规格，如 "5mg/片"', maxLength: 80 },
            amountPerDose: { type: 'string', description: '每次用量文本，如 "1片" / "10ml"', maxLength: 40 },
            slots: {
              type: 'array',
              items: { type: 'string', enum: SLOT_VALUES },
              description: '提醒时段（morning/noon/evening/bedtime）',
              maxItems: 4,
            },
            inventoryRemaining: { type: 'number', description: '初始库存数量', minimum: 0 },
            inventoryUnit: { type: 'string', description: '库存单位，如 片/粒/盒', maxLength: 12 },
            notes: { type: 'string', description: '医嘱说明或用药备注', maxLength: 200 },
          },
          required: ['name'],
          additionalProperties: false,
        },
      },
    },
    required: ['medications'],
    additionalProperties: false,
  },
  confirm(args) {
    const list = Array.isArray(args.medications) ? (args.medications as Array<Record<string, unknown>>) : [];
    const names = list.map((m) => str(m.name)).filter(Boolean);
    return `确认一键将以下 ${names.length} 种药品批量录入到药箱中吗？\n${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}`;
  },
  async run(args) {
    const list = Array.isArray(args.medications) ? (args.medications as Array<Record<string, unknown>>) : [];
    if (list.length === 0) {
      return { ok: false, 提示: '没有提供要导入的药品' };
    }

    const existing = await listMeds();
    const existingNameSet = new Set(existing.filter((m) => !m.deleted).map((m) => m.name.trim().toLowerCase()));

    const drafts = [];
    const skippedDups: string[] = [];

    for (const item of list) {
      const name = str(item.name);
      if (!name) continue;
      if (existingNameSet.has(name.toLowerCase())) {
        skippedDups.push(name);
        continue;
      }
      const slots: Slot[] = Array.isArray(item.slots)
        ? (item.slots as Slot[]).filter((s) => SLOT_VALUES.includes(s))
        : [];
      const draft = createMedicationDraft({
        sourceKind: 'manual',
        medication: {
          name,
          dosageText: str(item.dosageText),
          amountPerDose: str(item.amountPerDose),
          slots,
          daysOfWeek: [],
          notes: str(item.notes) || undefined,
        },
      });
      applyExplicitDose(draft);
      if (typeof item.inventoryRemaining === 'number' && item.inventoryRemaining >= 0) {
        draft.medication.inventory = {
          remaining: roundStock(item.inventoryRemaining),
          unit: str(item.inventoryUnit) || draft.medication.doseUnit || '片',
        };
      }
      draft.rules = slots.map((slot) => ({
        id: `rule-${draft.id}-${slot}`,
        slot,
        timeLocal: MEDICATION_SLOT_TO_TIME[slot],
        enabled: true,
      }));
      drafts.push(draft);
    }

    if (drafts.length === 0) {
      return {
        ok: false,
        提示: skippedDups.length > 0
          ? `拟导入的药品（${skippedDups.join('、')}）均已存在于药箱中，无需重复录入。`
          : '没有合法的药品条目可录入',
      };
    }

    try {
      await createMedicationBatch(drafts);
      try { await rescheduleMedicationReminders(); } catch { /* ignore */ }
      try { await recomputeReminderPeriodReviewState(); } catch { /* ignore */ }

      const items: AssistantCardItem[] = drafts.map((d) => ({
        title: d.medication.name,
        subtitle: [d.medication.dosageText, d.medication.amountPerDose ? `每次 ${d.medication.amountPerDose}` : '', d.rules.map((r) => SLOT_LABEL[r.slot]).join('·')].filter(Boolean).join(' · '),
        meta: d.medication.inventory ? `${d.medication.inventory.remaining}${d.medication.inventory.unit}` : undefined,
        status: 'success',
        statusLabel: '已入库',
        icon: 'pill',
      }));

      const ui: AssistantCardBlock = {
        type: 'card',
        variant: 'medication',
        icon: 'check',
        eyebrow: `处方批量录入 · 成功添加 ${drafts.length} 种药品`,
        title: '已批量导入药品到药箱',
        badge: `${drafts.length} 种新药`,
        tone: 'success',
        body: `成功批量录入了 ${drafts.length} 种药品。${skippedDups.length > 0 ? ` 已跳过已存在的 ${skippedDups.join('、')}。` : ''}可在「今天的用药」或「药品列表」中查看。`,
        items,
        facts: [
          { label: '成功录入', value: `${drafts.length} 种` },
          { label: '跳过重复', value: `${skippedDups.length} 种` },
        ],
      };

      return {
        ok: true,
        成功录入数: drafts.length,
        跳过重复数: skippedDups.length,
        已录入药品: drafts.map((d) => d.medication.name),
        ui,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { ok: false, 提示: `批量录入失败：${msg}` };
    }
  },
};

export const medicationTools: readonly AssistantTool[] = [
  listMyMedications,
  addMedication,
  updateMedication,
  deleteMedication,
  checkDrugInteractionsTool,
  batchImportMedicationsTool,
];
