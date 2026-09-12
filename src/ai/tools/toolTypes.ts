import {
  listMeds,
  listScheduleRevisions,
  listLogsByDay,
} from '../../db/local';
import {
  SLOT_LABEL,
  SLOT_DEFAULT_TIME,
  type EscalatePolicy,
  type Medication,
  type MedicationReminderMode,
  type Slot,
} from '../../db/schema';
import {
  localDayBounds,
  projectScheduleDate,
  toLocalDate,
} from '../../domain/medicationSchedule';
import type {
  AssistantCardIcon,
  AssistantCardItemStatus,
  AssistantCardVariant,
} from '../assistant';

export interface AssistantTool {
  name: string;
  /** 执行时给用户看的一句话，例如「正在看今天的吃药安排」 */
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  /** 返回非空字符串时，执行前需要用户确认 */
  confirm?: (args: Record<string, unknown>) => string;
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

export const SLOT_VALUES: Slot[] = ['morning', 'noon', 'evening', 'bedtime'];
export const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
export const MAX_CARD_TEXT = 600;
export const CARD_VARIANTS: AssistantCardVariant[] = ['summary', 'medication', 'stats', 'search', 'notice', 'inventory'];
export const CARD_ICONS: AssistantCardIcon[] = ['pill', 'box', 'calendar', 'clock', 'timer', 'scan', 'bell', 'bell-ring', 'check', 'warn', 'sparkles', 'info', 'cloud', 'gear', 'trash'];
export const CARD_ITEM_STATUSES: AssistantCardItemStatus[] = ['pending', 'success', 'skipped', 'warning', 'muted'];

export function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function asSlot(v: unknown): Slot | undefined {
  return SLOT_VALUES.includes(v as Slot) ? (v as Slot) : undefined;
}

export async function findMedByName(name: string) {
  const meds = await listMeds();
  const keyword = name.trim().toLowerCase();
  if (!keyword) return { med: undefined, meds };
  const med = meds.find((m) => m.name.toLowerCase() === keyword)
    ?? meds.find((m) => m.name.toLowerCase().includes(keyword) || keyword.includes(m.name.toLowerCase()));
  return { med, meds };
}

/** 今日各药各时段的状态快照，供查询与打卡共用 */
export async function todaySnapshot() {
  const today = toLocalDate();
  const { start, end } = localDayBounds(today);
  const [meds, revisions, logs] = await Promise.all([
    listMeds(),
    listScheduleRevisions(),
    listLogsByDay(start, end),
  ]);
  const medById = new Map(meds.map((m) => [m.id, m]));
  const projections = projectScheduleDate(revisions, today).filter((p) => medById.has(p.revision.medId));
  return { today, meds, medById, projections, logs };
}

export const MEDICATION_SLOT_TO_TIME: Record<Slot, string> = {
  morning: SLOT_DEFAULT_TIME.morning,
  noon: SLOT_DEFAULT_TIME.noon,
  evening: SLOT_DEFAULT_TIME.evening,
  bedtime: SLOT_DEFAULT_TIME.bedtime,
};

export function describeMedForConfirm(med: Medication): string {
  const inventory = med.inventory
    ? `${med.inventory.remaining}${med.inventory.unit || ''}`
    : '未设置库存';
  const slots = med.slots.length > 0 ? med.slots.map((s) => SLOT_LABEL[s]).join('·') : '无提醒';
  return `${med.name}（${med.dosageText || '无规格'}，${slots}，库存 ${inventory}）`;
}

export const REMINDER_MODE_VALUES: MedicationReminderMode[] = ['strong', 'fullscreen-short', 'fullscreen-persistent'];
export const PERIOD_SCOPE_VALUES: Array<Slot | 'all'> = [...SLOT_VALUES, 'all'];

/** 把未确认提醒的升级策略逐轴转成合法数值（非法输入保留原值语义：undefined = 不改）。 */
export function coerceEscalatePatch(value: unknown): Partial<EscalatePolicy> {
  const patch: Partial<EscalatePolicy> = {};
  if (!value || typeof value !== 'object') return patch;
  const raw = value as Record<string, unknown>;
  for (const key of ['repeatEveryMin', 'maxRepeats', 'notifyCaregiverAfterMin'] as const) {
    const num = Number(raw[key]);
    if (Number.isFinite(num)) patch[key] = key === 'repeatEveryMin' ? Math.max(1, Math.floor(num)) : Math.max(0, Math.floor(num));
  }
  return patch;
}
