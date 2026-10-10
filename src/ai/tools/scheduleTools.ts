import {
  listMeds,
  listRules,
  listScheduleRevisions,
  listLogsByRange,
  putRule,
  setOccurrenceAction,
  listReminderPeriodSettings,
  updateReminderPeriodSetting,
  recomputeReminderPeriodReviewState,
  type ReminderPeriodSettingPatch,
} from '../../db/local';
import {
  SLOT_LABEL,
  formatMealRels,
  MEDICATION_REMINDER_MODE_LABEL,
  type MedicationReminderMode,
  type Slot,
} from '../../db/schema';
import {
  addLocalDays,
  calculateAdherence,
  findLogForOccurrence,
  generateOccurrences,
  localDayBounds,
  toLocalDate,
} from '../../domain/medicationSchedule';
import { rescheduleMedicationReminders } from '../../features/reminderScheduler';
import { checkFullScreenAlarmCapability } from '../../features/nativeMedicationAlarm';
import type {
  AssistantCardBlock,
  AssistantCardItem,
  AssistantCardItemStatus,
} from '../assistant';
import {
  type AssistantTool,
  SLOT_VALUES,
  TIME_RE,
  PERIOD_SCOPE_VALUES,
  REMINDER_MODE_VALUES,
  str,
  asSlot,
  findMedByName,
  todaySnapshot,
  coerceEscalatePatch,
} from './toolTypes';

export const getTodayPlan: AssistantTool = {
  name: 'get_today_plan',
  label: '看看今天的吃药安排',
  description: '查询今天要吃哪些药、各时段时间和用量，以及哪些已经吃了、哪些还没吃。回答"今天吃什么药/还有什么没吃"类问题前先调用它。',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async run() {
    const { today, medById, projections, logs } = await todaySnapshot();
    const items = projections.map((p) => {
      const med = medById.get(p.revision.medId)!;
      const log = p.occurrence ? findLogForOccurrence(p.occurrence, logs) : undefined;
      return {
        projection: p,
        occurrence: p.occurrence,
        slot: p.revision.slot,
        药名: med.name,
        时段: SLOT_LABEL[p.revision.slot],
        时间: p.revision.timeLocal,
        每次用量: p.revision.doseQuantity && p.revision.doseUnit ? `${p.revision.doseQuantity}${p.revision.doseUnit}` : med.amountPerDose || '按医嘱',
        饭前饭后: formatMealRels([...p.revision.mealRels]) || '不限',
        状态: p.isRest ? '停药期' : log?.status === 'taken' ? '已吃' : log?.status === 'skipped' ? '已跳过' : '还没吃',
      };
    });
    const active = items.filter((i) => i.状态 !== '停药期');
    const pending = active.filter((i) => i.状态 === '还没吃');
    const medicationItems: AssistantCardItem[] = active.slice(0, 8).map((item) => {
      const status: AssistantCardItemStatus = item.状态 === '已吃'
        ? 'success'
        : item.状态 === '已跳过'
          ? 'skipped'
          : item.状态 === '还没吃'
            ? 'pending'
            : 'muted';
      return {
        title: item.药名,
        subtitle: `${item.时间} · ${item.每次用量}${item.饭前饭后 !== '不限' ? ` · ${item.饭前饭后}` : ''}`,
        status,
        statusLabel: item.状态,
        icon: 'pill',
        occurrence: item.occurrence,
        slot: item.slot,
        medName: item.药名,
      };
    });
    const next = pending[0];
    const hiddenCount = Math.max(0, active.length - medicationItems.length);
    const ui: AssistantCardBlock = {
      type: 'card',
      variant: 'medication',
      icon: 'pill',
      eyebrow: `${today} · ${active.length} 项安排`,
      title: pending.length > 0 ? '今天的用药安排' : '今天的用药已处理',
      badge: pending.length > 0 ? `${pending.length} 待处理` : '全部完成',
      tone: pending.length > 0 ? 'warning' : 'success',
      body: next
        ? `下一次是 **${next.时间} ${next.药名}**。${hiddenCount > 0 ? ` 还有 ${hiddenCount} 项安排未展开。` : ''}`
        : active.length > 0 ? '今天的用药安排都已经处理。' : '今天没有需要处理的用药安排。',
      facts: [
        { label: '下一次', value: next ? `${next.时间} ${next.药名}` : '无' },
        { label: '已服', value: `${active.filter((i) => i.状态 === '已吃').length} 项` },
        { label: '待服', value: `${pending.length} 项` },
      ],
      items: medicationItems,
    };
    return {
      ui,
      日期: today,
      共几项: active.length,
      已吃: active.filter((i) => i.状态 === '已吃').length,
      还没吃: active.filter((i) => i.状态 === '还没吃').length,
      清单: items,
    };
  },
};

export const getAdherenceReport: AssistantTool = {
  name: 'get_adherence_report',
  label: '算算最近吃药按时率',
  description: '统计最近 N 天（默认 7 天，最多 30 天）按时吃药的情况：该吃几次、吃了几次、跳过和漏掉几次。',
  parameters: {
    type: 'object',
    properties: { days: { type: 'integer', minimum: 1, maximum: 30, description: '统计最近几天，默认 7' } },
    additionalProperties: false,
  },
  async run(args) {
    const days = Math.min(30, Math.max(1, Number(args.days) || 7));
    const today = toLocalDate();
    const startDate = addLocalDays(today, -(days - 1));
    const [meds, revisions] = await Promise.all([listMeds(), listScheduleRevisions()]);
    const medById = new Map(meds.map((m) => [m.id, m]));
    const occurrences = generateOccurrences(revisions, startDate, today).filter((o) => medById.has(o.medId));
    const logs = await listLogsByRange(localDayBounds(startDate).start, localDayBounds(today).end);
    const overall = calculateAdherence(occurrences, logs);
    const byMed = [...medById.values()].map((med) => {
      const mine = occurrences.filter((o) => o.medId === med.id);
      if (mine.length === 0) return null;
      const s = calculateAdherence(mine, logs);
      return { 药名: med.name, 该吃: s.due, 吃了: s.taken, 跳过: s.skipped, 漏掉: s.missed };
    }).filter(Boolean);
    const rate = overall.due > 0 ? `${Math.round(overall.adherenceRate * 100)}%` : '无安排';
    const ui: AssistantCardBlock = {
      type: 'card',
      variant: 'stats',
      icon: 'timer',
      eyebrow: `最近 ${days} 天`,
      title: '按时服药情况',
      badge: rate,
      tone: overall.due > 0 && overall.adherenceRate >= 0.8 ? 'success' : 'warning',
      body: '按记录统计，漏服和跳过会分别列出，不代表医学判断。',
      facts: [
        { label: '应服', value: `${overall.due} 次` },
        { label: '已服', value: `${overall.taken} 次` },
        { label: '漏服', value: `${overall.missed} 次` },
        { label: '跳过', value: `${overall.skipped} 次` },
      ],
    };
    return {
      ui,
      统计范围: `${startDate} ~ ${today}`,
      总计: { 该吃: overall.due, 吃了: overall.taken, 跳过: overall.skipped, 漏掉: overall.missed, 按时率: rate },
      分药: byMed,
    };
  },
};

export const markMedication: AssistantTool = {
  name: 'mark_medication',
  label: '帮忙记一笔吃药',
  description: '把某种药某个时段记成"已吃"或"跳过"。支持今天及今天以前的任意历史日期（例如传 "2026-07-30"、"昨天"、"前天"）。不传 date 默认操作今天。',
  parameters: {
    type: 'object',
    properties: {
      medName: { type: 'string', description: '药名，可以是部分名字' },
      action: { type: 'string', enum: ['taken', 'skipped'], description: 'taken=已吃，skipped=跳过' },
      slot: { type: 'string', enum: SLOT_VALUES, description: '时段，可选' },
      date: { type: 'string', description: '日期，可选，格式 YYYY-MM-DD 或 "昨天"、"前天"；缺省为今天' },
    },
    required: ['medName', 'action'],
    additionalProperties: false,
  },
  confirm(args) {
    const action = args.action === 'skipped' ? '跳过' : '已经吃了';
    const slot = asSlot(args.slot);
    return `把「${str(args.medName)}」今天${slot ? SLOT_LABEL[slot] : '所有待记录时段'}记成${action}？`;
  },
  async run(args) {
    const name = str(args.medName);
    const action = args.action === 'skipped' ? 'skipped' : 'taken';
    const slot = asSlot(args.slot);
    const { med } = await findMedByName(name);
    if (!med) return { ok: false, 提示: `没找到叫「${name}」的药，先用 list_my_medications 看看都登记了什么药` };
    const { medById, projections, logs } = await todaySnapshot();
    void medById;
    const targets = projections.filter((p) =>
      p.revision.medId === med.id
      && !p.isRest
      && p.occurrence
      && (!slot || p.revision.slot === slot)
      && findLogForOccurrence(p.occurrence, logs)?.status !== action,
    );
    if (targets.length === 0) {
      return { ok: false, 提示: slot ? `「${med.name}」今天${SLOT_LABEL[slot]}没有可记录的安排（可能已记过或是停药期）` : `「${med.name}」今天没有可记录的安排` };
    }
    const done: string[] = [];
    for (const p of targets) {
      await setOccurrenceAction(p.occurrence!, action);
      done.push(`${SLOT_LABEL[p.revision.slot]} ${p.revision.timeLocal}`);
    }
    return { ok: true, 已记录: `「${med.name}」${done.join('、')} → ${action === 'taken' ? '已吃' : '跳过'}` };
  },
};

export const setReminderTime: AssistantTool = {
  name: 'set_reminder_time',
  label: '调整吃药提醒时间',
  description: '把某种药某个时段的提醒改到新的时间（24 小时制 HH:mm）。',
  parameters: {
    type: 'object',
    properties: {
      medName: { type: 'string', description: '药名' },
      slot: { type: 'string', enum: SLOT_VALUES, description: '要改哪个时段' },
      time: { type: 'string', description: '新时间，如 19:30' },
    },
    required: ['medName', 'slot', 'time'],
    additionalProperties: false,
  },
  confirm(args) {
    const slot = asSlot(args.slot);
    return `把「${str(args.medName)}」${slot ? SLOT_LABEL[slot] : ''}的提醒改到 ${str(args.time)}？`;
  },
  async run(args) {
    const slot = asSlot(args.slot);
    const time = str(args.time);
    if (!slot) return { ok: false, 提示: '时段要在 morning/noon/evening/bedtime 里选' };
    if (!TIME_RE.test(time)) return { ok: false, 提示: '时间格式要是 HH:mm，比如 08:00 或 19:30' };
    const { med } = await findMedByName(str(args.medName));
    if (!med) return { ok: false, 提示: `没找到叫「${str(args.medName)}」的药` };
    const rules = await listRules();
    const rule = rules.find((r) => r.medId === med.id && r.slot === slot && !r.deleted);
    if (!rule) return { ok: false, 提示: `「${med.name}」没有${SLOT_LABEL[slot]}的提醒，可以去药品编辑页加一个` };
    const normalized = time.length === 4 ? `0${time}` : time;
    rule.timeLocal = normalized;
    rule.enabled = true;
    await putRule(rule);
    try { await rescheduleMedicationReminders(); } catch { /* 重排失败下次打开会补 */ }
    try { await recomputeReminderPeriodReviewState(); } catch { /* 复核标记下次打开设置页会刷新 */ }
    return { ok: true, 已修改: `「${med.name}」${SLOT_LABEL[slot]}提醒 → ${normalized}` };
  },
};

export const setReminderPeriodSettings: AssistantTool = {
  name: 'set_reminder_period_settings',
  label: '设置时段整体提醒',
  description: '设置某个时段（早上/中午/晚上/睡前）的整体提醒：时间（24 小时制 HH:mm）、方式与重复策略；slot=all 时对所有时段统一设置。现在提醒按时间段聚合，每天每个时段只发一条整体提醒，不再按每种药单独设置。',
  parameters: {
    type: 'object',
    properties: {
      slot: { type: 'string', enum: PERIOD_SCOPE_VALUES, description: '要设置的时段：morning/noon/evening/bedtime；all=全部时段统一设置' },
      time: { type: 'string', description: '整体提醒时间，24 小时制 HH:mm，如 08:00' },
      mode: { type: 'string', enum: REMINDER_MODE_VALUES, description: 'strong=全屏提醒（不自动收起）；fullscreen-short=全屏提醒（10 秒自动收起）；fullscreen-persistent=全屏提醒（60 秒自动收起）' },
      escalate: {
        type: 'object',
        properties: {
          repeatEveryMin: { type: 'integer', minimum: 1, description: '未确认时每几分钟再提醒' },
          maxRepeats: { type: 'integer', minimum: 0, description: '最多重推次数（不含首次）' },
          notifyCaregiverAfterMin: { type: 'integer', minimum: 0, description: '超过几分钟通知照护者；0=不通知' },
        },
        additionalProperties: false,
      },
    },
    required: ['slot'],
    additionalProperties: false,
  },
  confirm(args) {
    const slot = args.slot;
    const who = slot === 'all' ? '全部时段' : `${SLOT_LABEL[asSlot(slot) ?? 'morning']}时段`;
    const parts: string[] = [];
    const time = str(args.time);
    if (time) parts.push(`时间改为 ${time}`);
    const mode = REMINDER_MODE_VALUES.includes(args.mode as MedicationReminderMode)
      ? args.mode as MedicationReminderMode
      : undefined;
    if (mode) parts.push(`方式改为「${MEDICATION_REMINDER_MODE_LABEL[mode]}」`);
    const escalate = coerceEscalatePatch(args.escalate);
    if (escalate.repeatEveryMin != null) parts.push(`每 ${escalate.repeatEveryMin} 分钟重推`);
    if (escalate.maxRepeats != null) parts.push(`最多重推 ${escalate.maxRepeats} 次`);
    if (escalate.notifyCaregiverAfterMin != null) {
      parts.push(escalate.notifyCaregiverAfterMin > 0
        ? `${escalate.notifyCaregiverAfterMin} 分钟后通知照护者`
        : '不通知照护者');
    }
    return `${who}的整体提醒：${parts.length > 0 ? parts.join('、') : '按当前设置'}？`;
  },
  async run(args) {
    const slotArg = args.slot;
    if (slotArg !== 'all' && !asSlot(slotArg)) return { ok: false, 提示: 'slot 要在 morning/noon/evening/bedtime/all 里选' };
    const slots: Slot[] = slotArg === 'all' ? SLOT_VALUES : [asSlot(slotArg)!];
    const time = str(args.time);
    const mode = REMINDER_MODE_VALUES.includes(args.mode as MedicationReminderMode)
      ? args.mode as MedicationReminderMode
      : undefined;
    if (time && !TIME_RE.test(time)) return { ok: false, 提示: '时间格式要是 HH:mm，比如 08:00 或 19:30' };
    const escalate = coerceEscalatePatch(args.escalate);
    if (!time && !mode && Object.keys(escalate).length === 0) {
      return { ok: false, 提示: '至少要提供 time、mode、escalate 中的一项' };
    }

    const current = await listReminderPeriodSettings();
    const changedSlots: Slot[] = [];
    let saveWarning = false;
    for (const slot of slots) {
      const base = current.find((s) => s.slot === slot)?.escalate;
      const patch: ReminderPeriodSettingPatch = {};
      if (time) patch.timeLocal = time;
      if (mode) patch.mode = mode;
      if (Object.keys(escalate).length > 0) {
        patch.escalate = {
          repeatEveryMin: escalate.repeatEveryMin ?? base?.repeatEveryMin ?? 10,
          maxRepeats: escalate.maxRepeats ?? base?.maxRepeats ?? 3,
          notifyCaregiverAfterMin: escalate.notifyCaregiverAfterMin ?? base?.notifyCaregiverAfterMin ?? 30,
        };
      }
      try {
        await updateReminderPeriodSetting(slot, patch);
        changedSlots.push(slot);
      } catch {
        saveWarning = true;
      }
    }
    let scheduleWarning = false;
    if (changedSlots.length > 0) {
      try { await rescheduleMedicationReminders(); } catch { scheduleWarning = true; }
    }
    let permissionWarning = false;
    if (mode && mode !== 'strong') {
      try { permissionWarning = await checkFullScreenAlarmCapability() === 'denied'; } catch { /* 网页端或原生能力不可用 */ }
    }
    const label = slots.map((s) => SLOT_LABEL[s]).join('、');
    const warnings = [
      saveWarning ? '部分时段保存失败，请稍后重试。' : '',
      scheduleWarning ? '提醒已保存，但系统闹钟重排暂未完成，应用会自动重试。' : '',
      permissionWarning ? '系统尚未授予全屏提醒权限；到权限开放前，到点提醒可能降级为顶部通知。' : '',
    ].filter(Boolean);
    const changes: string[] = [];
    if (time) changes.push(`整体时间 ${time}`);
    if (mode) changes.push(`方式 ${MEDICATION_REMINDER_MODE_LABEL[mode]}`);
    if (Object.keys(escalate).length > 0) {
      if (escalate.repeatEveryMin != null) changes.push(`每 ${escalate.repeatEveryMin} 分钟重推`);
      if (escalate.maxRepeats != null) changes.push(`最多重推 ${escalate.maxRepeats} 次`);
      if (escalate.notifyCaregiverAfterMin != null) {
        changes.push(escalate.notifyCaregiverAfterMin > 0
          ? `${escalate.notifyCaregiverAfterMin} 分钟后通知照护者`
          : '不通知照护者');
      }
    }
    const ui: AssistantCardBlock = {
      type: 'card',
      variant: 'medication',
      icon: mode === undefined || mode === 'strong' ? 'bell' : 'bell-ring',
      eyebrow: `时段整体提醒 · ${label}`,
      title: `已更新${label}整体提醒`,
      badge: `${changedSlots.length} 个时段`,
      tone: warnings.length > 0 ? 'warning' : 'success',
      body: `${changes.join(' · ')}${warnings.length > 0 ? ` ${warnings.join(' ')}` : ''}`,
      items: [],
      facts: [
        { label: '更新时段', value: `${changedSlots.length} 个` },
        { label: '保存异常', value: `${slots.length - changedSlots.length} 个` },
      ],
    };
    return {
      ok: changedSlots.length > 0,
      已更新时段: changedSlots.map((s) => SLOT_LABEL[s]),
      失败时段: slots.filter((s) => !changedSlots.includes(s)).map((s) => SLOT_LABEL[s]),
      提示: warnings.length > 0 ? warnings.join(' ') : undefined,
      ui,
    };
  },
};

export const scheduleTools: readonly AssistantTool[] = [
  getTodayPlan,
  getAdherenceReport,
  markMedication,
  setReminderTime,
  setReminderPeriodSettings,
];
