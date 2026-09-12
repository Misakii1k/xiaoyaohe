import type { IDBPDatabase } from 'idb';
import {
  openMedboxDatabase as db,
  registerReminderPeriodSeeder,
  type MedboxDB,
} from '../connection';
import {
  defaultEscalate,
  deriveReminderPeriodSettings,
  normalizeMedicationReminderMode,
  SLOT_DEFAULT_TIME,
  type EscalatePolicy,
  type ReminderPeriodSetting,
  type Slot,
} from '../schema';
import { normalizeMedication } from '../normalization';

const REMINDER_PERIOD_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export type ReminderPeriodSettingPatch = Partial<Pick<ReminderPeriodSetting, 'timeLocal' | 'mode' | 'escalate'>>;

/** 幂等 seed：仅当 store 为空且有贡献规则时，按派生值建行（recompute 语义等价）。 */
export async function seedReminderPeriodSettings(d: IDBPDatabase<MedboxDB>): Promise<void> {
  const existing = await d.getAll('reminderPeriods');
  if (existing.length > 0) return;
  await recomputeReminderPeriodReviewStateInDb(d);
}

// 自动向连接模块注册 seeder，避免循环调用时尚未加载的问题
registerReminderPeriodSeeder(seedReminderPeriodSettings);

/** 返回全部 4 个时段：已保存的行原样返回，未保存的时段按派生值合成（不落库）。 */
export async function listReminderPeriodSettings(): Promise<ReminderPeriodSetting[]> {
  const d = await db();
  const [stored, meds, rules] = await Promise.all([
    d.getAll('reminderPeriods'),
    d.getAll('meds'),
    d.getAll('rules'),
  ]);
  const derived = deriveReminderPeriodSettings(meds.map(normalizeMedication), rules);
  const storedBySlot = new Map(stored.map((setting) => [setting.slot, setting]));
  const now = Date.now();
  return derived.map((setting) => storedBySlot.get(setting.slot) ?? { ...setting, updatedAt: now });
}

export async function getReminderPeriodSetting(slot: Slot): Promise<ReminderPeriodSetting> {
  const d = await db();
  const stored = await d.get('reminderPeriods', slot);
  if (stored) return stored;
  const settings = await listReminderPeriodSettings();
  return settings.find((setting) => setting.slot === slot) ?? {
    slot,
    timeLocal: SLOT_DEFAULT_TIME[slot],
    mode: 'strong' as const,
    escalate: defaultEscalate(),
    state: 'active' as const,
    updatedAt: Date.now(),
  };
}

/** escalate 逐轴 clamp 到合法范围内（repeatEveryMin ≥ 1，其余 ≥ 0）。 */
function applyEscalatePatch(base: EscalatePolicy, patch: Partial<EscalatePolicy> | undefined): EscalatePolicy {
  if (!patch) return base;
  const next: EscalatePolicy = { ...base };
  if (Number.isFinite(patch.repeatEveryMin)) {
    next.repeatEveryMin = Math.max(1, Math.floor(patch.repeatEveryMin as number));
  }
  if (Number.isFinite(patch.maxRepeats)) {
    next.maxRepeats = Math.max(0, Math.floor(patch.maxRepeats as number));
  }
  if (Number.isFinite(patch.notifyCaregiverAfterMin)) {
    next.notifyCaregiverAfterMin = Math.max(0, Math.floor(patch.notifyCaregiverAfterMin as number));
  }
  return next;
}

/**
 * 原子更新时段设置：该时段尚无已存行时按当前派生值补全后落库。
 * state（复核标记）不在此处改写——始终由 recompute 从时段内差异派生；
 * 用户显式选择不消除差异，仅决定整体提醒实际采用的时间与方式。
 */
export async function updateReminderPeriodSetting(
  slot: Slot,
  patch: ReminderPeriodSettingPatch,
): Promise<ReminderPeriodSetting> {
  const d = await db();
  const tx = d.transaction(['reminderPeriods', 'meds', 'rules'], 'readwrite');
  try {
    const [stored, meds, rules] = await Promise.all([
      tx.objectStore('reminderPeriods').get(slot),
      tx.objectStore('meds').getAll(),
      tx.objectStore('rules').getAll(),
    ]);
    const derived = deriveReminderPeriodSettings(meds.map(normalizeMedication), rules)
      .find((setting) => setting.slot === slot);
    const base = stored ?? derived ?? {
      slot,
      timeLocal: SLOT_DEFAULT_TIME[slot],
      mode: 'strong' as const,
      escalate: defaultEscalate(),
      state: 'active' as const,
    };
    const next: ReminderPeriodSetting = {
      slot,
      timeLocal: patch.timeLocal ?? base.timeLocal,
      mode: patch.mode ? normalizeMedicationReminderMode(patch.mode) : base.mode,
      escalate: applyEscalatePatch(base.escalate, patch.escalate),
      state: base.state,
      updatedAt: Date.now(),
    };
    if (!REMINDER_PERIOD_TIME_PATTERN.test(next.timeLocal)) {
      throw new TypeError(`无效的提醒时间：${next.timeLocal}（应为 HH:mm）`);
    }
    await tx.objectStore('reminderPeriods').put(next);
    await tx.done;
    return next;
  } catch (error) {
    try { tx.abort(); } catch { /* Transaction may already be closed. */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
}

/**
 * 保存药品/规则后懒重算时段复核标记（needs-review）：
 * - 无已存行、但时段内有非删除规则贡献者 → 按派生值建行；
 * - 已有行 → 保留用户设置，仅刷新 state（差异信号，不静默归一化）；
 * - 无行且无贡献者 → 跳过（界面按派生值合成展示）。
 */
export async function recomputeReminderPeriodReviewState(): Promise<void> {
  await recomputeReminderPeriodReviewStateInDb(await db());
}

export async function recomputeReminderPeriodReviewStateInDb(d: IDBPDatabase<MedboxDB>): Promise<void> {
  const tx = d.transaction(['reminderPeriods', 'meds', 'rules'], 'readwrite');
  try {
    const [stored, meds, rules] = await Promise.all([
      tx.objectStore('reminderPeriods').getAll(),
      tx.objectStore('meds').getAll(),
      tx.objectStore('rules').getAll(),
    ]);
    const medById = new Map(
      meds.filter((record) => !record.deleted).map((record) => [record.id, record]),
    );
    const contributedSlots = new Set(
      rules.filter((rule) => !rule.deleted && medById.has(rule.medId)).map((rule) => rule.slot),
    );
    const derived = deriveReminderPeriodSettings(meds.map(normalizeMedication), rules);
    const storedBySlot = new Map(stored.map((setting) => [setting.slot, setting]));
    const now = Date.now();
    const store = tx.objectStore('reminderPeriods');
    for (const setting of derived) {
      const existing = storedBySlot.get(setting.slot);
      if (!existing) {
        if (!contributedSlots.has(setting.slot)) continue;
        await store.put({ ...setting, updatedAt: now });
      } else if (existing.state !== setting.state) {
        await store.put({ ...existing, state: setting.state });
      }
    }
    await tx.done;
  } catch (error) {
    try { tx.abort(); } catch { /* Transaction may already be closed. */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
}
