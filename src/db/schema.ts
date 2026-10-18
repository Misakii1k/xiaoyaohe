// 全应用共享的数据类型定义（前端与 Worker 对齐）

/** 服药时段（不含"餐中"——餐中改为 mealRels 维度，可与早/中/晚组合） */
export type Slot = 'morning' | 'noon' | 'evening' | 'bedtime';

/** 与进餐的关系（多选；空 = 不限） */
export type MealRel = 'before' | 'after' | 'with';

export const SLOTS: Slot[] = ['morning', 'noon', 'evening', 'bedtime'];

export const SLOT_LABEL: Record<Slot, string> = {
  morning: '早上',
  noon: '中午',
  evening: '晚上',
  bedtime: '睡前',
};

/** 各时段的默认提醒时间（北京时间），新建提醒时作默认值 */
export const SLOT_DEFAULT_TIME: Record<Slot, string> = {
  morning: '08:00',
  noon: '12:00',
  evening: '18:00',
  bedtime: '21:30',
};

export const MEAL_RELS: MealRel[] = ['before', 'with', 'after'];

export const MEAL_LABEL: Record<MealRel, string> = {
  before: '餐前',
  after: '餐后',
  with: '餐中',
};

export type MealRelsBySlot = Partial<Record<Slot, MealRel[]>>;

/** A calendar date in the device's local timezone (YYYY-MM-DD). */
export type LocalDate = `${number}-${number}-${number}`;

/** A confirmed, machine-readable dose used for inventory accounting. */
export interface StructuredDose {
  quantity: number;
  unit: string;
}

/** 把 mealRels 数组拼成展示串，"餐前·餐中·餐后" */
export function formatMealRels(rels: MealRel[] | undefined | null): string {
  if (!rels || rels.length === 0) return '';
  return MEAL_RELS.filter((r) => rels.includes(r))
    .map((r) => MEAL_LABEL[r])
    .join('·');
}

export function normalizeMealRels(rels: unknown): MealRel[] {
  if (!Array.isArray(rels)) return [];
  const set = new Set<MealRel>();
  for (const r of rels) {
    if (r === 'before' || r === 'with' || r === 'after') set.add(r);
  }
  return MEAL_RELS.filter((r) => set.has(r));
}

export function normalizeMealRelsBySlot(value: unknown, slots: Slot[], fallback?: MealRel[]): MealRelsBySlot {
  const out: MealRelsBySlot = {};
  const obj = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const validSlots = new Set(SLOTS);
  for (const s of SLOTS) {
    if (!slots.includes(s)) continue;
    const rels = normalizeMealRels(obj[s]);
    if (rels.length > 0) out[s] = rels;
    else if (fallback && fallback.length > 0) out[s] = [...fallback];
  }
  for (const key of Object.keys(obj)) {
    if (!validSlots.has(key as Slot) || slots.includes(key as Slot)) continue;
    const rels = normalizeMealRels(obj[key]);
    if (rels.length > 0) out[key as Slot] = rels;
  }
  return out;
}

export function mealRelsFromBySlot(value: MealRelsBySlot | undefined | null): MealRel[] {
  const set = new Set<MealRel>();
  if (!value) return [];
  for (const s of SLOTS) {
    for (const r of normalizeMealRels(value[s])) set.add(r);
  }
  return MEAL_RELS.filter((r) => set.has(r));
}

export function formatMealRelsForSlot(slot: Slot, bySlot?: MealRelsBySlot | null): string {
  return formatMealRels(bySlot?.[slot]);
}

export function formatMealRelsBySlot(bySlot: MealRelsBySlot | undefined | null, slots?: Slot[]): string {
  if (!bySlot) return '';
  const parts: string[] = [];
  const selectedSlots = slots && slots.length > 0 ? SLOTS.filter((s) => slots.includes(s)) : SLOTS;
  for (const s of selectedSlots) {
    const meal = formatMealRels(bySlot[s]);
    if (meal) parts.push(`${SLOT_LABEL[s]}${meal}`);
  }
  return parts.join('·');
}

export const WEEKDAY_LABEL = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 一种药累积的识别信号集合 —— 越用越准，天然支持"换药厂/多规格"。
 * 这些都是小字段，随快照同步到云端；药盒原图只存本地。
 */
export interface MedIdentity {
  /** 产品标识码 GTIN（GS1 段 01），同规格全球唯一；可多个（不同药厂/规格） */
  gtins: string[];
  /** 无法解析出 GTIN 的整码（20 位监管码、进口码、自印码等） */
  rawCodes: string[];
  /** OCR 出的药名/关键字变体，模糊匹配用 */
  ocrNames: string[];
  /** 盒子参考图的感知哈希 pHash（十六进制串），离线相似度兜底用 */
  photoHashes: string[];
}

export function emptyIdentity(): MedIdentity {
  return { gtins: [], rawCodes: [], ocrNames: [], photoHashes: [] };
}

export interface MedicationInventory {
  /** 当前剩余总量，按 unit 计数；例如 21 片 */
  remaining: number;
  /** 库存单位，例如 片 / 粒 / 袋 / mL */
  unit: string;
  /** 单盒/单瓶标称数量，可为空 */
  packageQuantity?: number;
  /** 低于该数量提醒，可为空 */
  lowThreshold?: number;
  /** 识别或人工填写来源说明 */
  sourceNote?: string;
  /** 最近一次提醒时间，避免低库存提醒刷屏 */
  lastReminderAt?: number;
}

export type InventorySource = 'manual' | 'ai' | 'intake' | 'wizard' | 'batch' | 'undo';

export const INVENTORY_SOURCE_LABEL: Record<InventorySource, string> = {
  manual: '手动修改',
  ai: 'AI小助手',
  intake: '服药扣减',
  wizard: '分药向导',
  batch: '批量扣减',
  undo: '撤回操作',
};

export type InventoryActionType = 'set' | 'add' | 'deduct' | 'mark_empty' | 'batch_deduct' | 'undo';

export interface InventoryOperationLog {
  id: string;
  medId: string;
  medName: string;
  action: InventoryActionType;
  previousRemaining: number;
  newRemaining: number;
  delta: number;
  unit: string;
  source: InventorySource;
  sourceNote?: string;
  timestamp: number;
  canUndo?: boolean;
  undoneLogId?: string;
  /** Device-local intake whose stock effect this operation represents. */
  intakeLogId?: string;
}

export type MedicationReminderMode = 'strong' | 'fullscreen-short' | 'fullscreen-persistent';

export const MEDICATION_REMINDER_MODE_LABEL: Record<MedicationReminderMode, string> = {
  strong: '全屏提醒 · 不自动收起',
  'fullscreen-short': '全屏提醒 · 10 秒收起',
  'fullscreen-persistent': '全屏提醒 · 60 秒收起',
};

export function normalizeMedicationReminderMode(value: unknown): MedicationReminderMode {
  return value === 'fullscreen-short' || value === 'fullscreen-persistent' ? value : 'strong';
}

/** 药品 */
export interface Medication {
  id: string;
  name: string;
  /** 规格，如 "5mg/片" */
  dosageText: string;
  /** 每次用量，如 "1片" / "半片" */
  amountPerDose: string;
  /** 已由用户确认的结构化单次用量；库存扣减只使用该值。 */
  doseQuantity?: number;
  doseUnit?: string;
  /** 确认结构化剂量时对应的原始文本；文本变化后需要重新确认。 */
  doseSourceText?: string;
  /** 旧自由文本可解析时仅保存建议，不直接用于库存扣减。 */
  doseMigrationSuggestion?: StructuredDose;
  doseReviewRequired?: boolean;
  /** 涉及的时段（可多个） */
  slots: Slot[];
  /** 与进餐关系（可多选，例：餐前 + 餐后）；空数组 = 不限 */
  mealRels: MealRel[];
  /** 按服药时段绑定餐前/餐中/餐后，例如 morning: 餐前，noon: 餐中 */
  mealRelsBySlot: MealRelsBySlot;
  /** 服药星期 [0..6]（0=周日）；空数组 = 每天 */
  daysOfWeek: number[];
  /** 同一种药的所有提醒时间共用一个提醒强度。 */
  reminderMode: MedicationReminderMode;
  /** 剩余药量（第一版：按药品总库存） */
  inventory?: MedicationInventory;
  notes?: string;
  /** @deprecated 旧版 UTC 时间戳；仅用于兼容旧编辑页和备份。 */
  expiryDate?: number;
  /** 药品过期日（本地日历日期）；当日结束前均不视为过期。 */
  expiryLocalDate?: LocalDate;
  /** 用于检测旧编辑页是否改动/清空了 expiryDate。 */
  expirySourceTimestamp?: number;
  identity: MedIdentity;
  updatedAt: number;
  /** 创建时间（UTC 毫秒），用于周期用药的 active/rest 日判断；老数据可能缺失 */
  createdAt?: number;
  /** 软删除，便于多端合并 */
  deleted?: boolean;
  /** 最近一次分药向导预扣库存的时间戳（UTC 毫秒）；保留用于兼容旧数据。 */
  lastPreDeductedAt?: number;
  /** 当前分药日已成功预扣的具体服药时段，避免补计划后整味药都被误判为已扣。 */
  preDeduction?: {
    localDate: LocalDate;
    occurrenceIds: string[];
    totalDose: number;
    doseUnit: string;
    updatedAt: number;
  };
  /** @deprecated 旧字段：with_meal slot + 单值 mealRel；inflateMed 会迁移 */
  mealRel?: 'before' | 'after' | 'with' | 'none';
}

/** 提醒升级策略 */
export interface EscalatePolicy {
  /** 未确认则每 N 分钟再推 */
  repeatEveryMin: number;
  /** 最多重推次数（含首次之外），防止超额度 */
  maxRepeats: number;
  /** 超过 X 分钟未确认则通知照护者 */
  notifyCaregiverAfterMin: number;
}

export function defaultEscalate(): EscalatePolicy {
  return { repeatEveryMin: 10, maxRepeats: 3, notifyCaregiverAfterMin: 30 };
}

/** 时段提醒设置状态：active = 时段内时间/方式一致；needs-review = 存在差异待用户确认 */
export type ReminderPeriodState = 'active' | 'needs-review';

/**
 * 按时段聚合的整体提醒设置（设备本地，不入局域网同步）。
 * 每个时段每天只发整体提醒，其触发时间、方式与升级策略由该设置决定；
 * 时段内各药自身的精确时间仍保留，仅用于记录与库存归因。
 */
export interface ReminderPeriodSetting {
  slot: Slot;
  /** 自定义时段名称（若为空则回退 SLOT_LABEL[slot]） */
  name?: string;
  /** 整体提醒主触发时间 "HH:mm"（本地） */
  timeLocal: string;
  /** 该时段内额外的提醒时间点列表，例如 ["08:30"] */
  extraTimes?: string[];
  /** 是否开启该时段提醒，默认为 true；关闭后不再下发系统闹钟 */
  enabled?: boolean;
  /** 是否为用户自定义添加的时段 */
  isCustom?: boolean;
  mode: MedicationReminderMode;
  escalate: EscalatePolicy;
  state: ReminderPeriodState;
  updatedAt: number;
}

/** deriveReminderPeriodSettings 的产物（尚无用户编辑时间戳） */
export type DerivedReminderPeriodSetting = Omit<ReminderPeriodSetting, 'updatedAt'>;

const REMINDER_MODE_RANK: Record<MedicationReminderMode, number> = {
  strong: 0,
  'fullscreen-short': 1,
  'fullscreen-persistent': 2,
};

/** 提醒方式强度排序：持续全屏 > 短时全屏 > 增强通知 */
export function reminderModeRank(mode: MedicationReminderMode): number {
  return REMINDER_MODE_RANK[normalizeMedicationReminderMode(mode)];
}

/** 取最保守（提醒最勤）的升级策略：重推间隔更短、重推次数更多、照护者介入更早 */
export function conservativeEscalate(policies: readonly Partial<EscalatePolicy>[]): EscalatePolicy {
  const fallback = defaultEscalate();
  let repeatEveryMin = Infinity;
  let maxRepeats = -Infinity;
  let notifyCaregiverAfterMin = Infinity;
  for (const policy of policies) {
    if (Number.isFinite(policy.repeatEveryMin)) {
      repeatEveryMin = Math.min(repeatEveryMin, Math.max(0, policy.repeatEveryMin as number));
    }
    if (Number.isFinite(policy.maxRepeats)) {
      maxRepeats = Math.max(maxRepeats, Math.max(0, Math.floor(policy.maxRepeats as number)));
    }
    if (Number.isFinite(policy.notifyCaregiverAfterMin)) {
      notifyCaregiverAfterMin = Math.min(notifyCaregiverAfterMin, Math.max(0, policy.notifyCaregiverAfterMin as number));
    }
  }
  return {
    repeatEveryMin: repeatEveryMin === Infinity ? fallback.repeatEveryMin : Math.max(1, Math.floor(repeatEveryMin)),
    maxRepeats: maxRepeats === -Infinity ? fallback.maxRepeats : Math.floor(maxRepeats),
    notifyCaregiverAfterMin: notifyCaregiverAfterMin === Infinity ? fallback.notifyCaregiverAfterMin : Math.floor(notifyCaregiverAfterMin),
  };
}

/**
 * 从药品与提醒规则推导各时段的整体提醒设置（纯函数，无 IO）。
 * - 时间 = 时段内出现最多的 timeLocal（并列取较早的时间）
 * - 方式 = 最强档（持续全屏 > 短时全屏 > 增强通知）
 * - 升级策略 = 最保守（提醒最勤）
 * - 时段内存在不同时间或不同方式 → needs-review（不静默归一化）
 * 空时段回退 SLOT_DEFAULT_TIME / strong / defaultEscalate，保证界面始终有 4 行可配置。
 */
export function deriveReminderPeriodSettings(
  meds: readonly Medication[],
  rules: readonly ReminderRule[],
): DerivedReminderPeriodSetting[] {
  const medById = new Map<string, Medication>();
  for (const med of meds) {
    if (!med.deleted) medById.set(med.id, med);
  }
  const timeCounts = new Map<Slot, Map<string, number>>();
  const modesBySlot = new Map<Slot, Map<string, MedicationReminderMode>>();
  const escalatesBySlot = new Map<Slot, EscalatePolicy[]>();
  for (const slot of SLOTS) {
    timeCounts.set(slot, new Map());
    modesBySlot.set(slot, new Map());
    escalatesBySlot.set(slot, []);
  }
  // 同一 (药品, 时段, 时间) 只计一次，避免同一药的重复规则加权
  const seen = new Set<string>();
  for (const rule of rules) {
    if (rule.deleted) continue;
    const med = medById.get(rule.medId);
    if (!med) continue;
    const key = `${med.id}:${rule.slot}:${rule.timeLocal}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const counts = timeCounts.get(rule.slot)!;
    counts.set(rule.timeLocal, (counts.get(rule.timeLocal) ?? 0) + 1);
    const modes = modesBySlot.get(rule.slot)!;
    if (!modes.has(med.id)) modes.set(med.id, normalizeMedicationReminderMode(med.reminderMode));
    escalatesBySlot.get(rule.slot)!.push(rule.escalate ?? defaultEscalate());
  }
  const results: DerivedReminderPeriodSetting[] = [];
  for (const slot of SLOTS) {
    const counts = timeCounts.get(slot)!;
    let timeLocal = SLOT_DEFAULT_TIME[slot];
    if (counts.size > 0) {
      let bestTime = '';
      let bestCount = -1;
      for (const [time, count] of counts) {
        if (count > bestCount || (count === bestCount && (bestTime === '' || time < bestTime))) {
          bestCount = count;
          bestTime = time;
        }
      }
      timeLocal = bestTime;
    }
    const modes = [...modesBySlot.get(slot)!.values()];
    let mode: MedicationReminderMode = 'strong';
    if (modes.length > 0) {
      mode = modes.reduce((strongest, current) =>
        reminderModeRank(current) > reminderModeRank(strongest) ? current : strongest,
      mode);
    }
    const escalates = escalatesBySlot.get(slot)!;
    const escalate = escalates.length > 0 ? conservativeEscalate(escalates) : defaultEscalate();
    const distinctModes = new Set(modes).size;
    const state: ReminderPeriodState = counts.size > 1 || distinctModes > 1 ? 'needs-review' : 'active';
    results.push({ slot, timeLocal, mode, escalate, state });
  }
  return results;
}

/** 提醒规则：某药 + 某时段 + 具体时间 */
export interface ReminderRule {
  id: string;
  medId: string;
  slot: Slot;
  /** "08:00" 北京时间；Worker 转 UTC 判定 */
  timeLocal: string;
  enabled: boolean;
  /** 周期性用药规则（吃 N 天停 M 天），缺省时视为每日服药 */
  cycle?: { activeDays: number; restDays: number };
  /** 周期首日，按设备本地日历日期计算，避免创建时刻导致首日错位。 */
  cycleStartDate?: LocalDate;
  /** 旧数据缺少周期首日时提示用户复核，不静默猜测。 */
  cycleStartNeedsReview?: boolean;
  escalate: EscalatePolicy;
  updatedAt: number;
  deleted?: boolean;
}

/** 服药记录（照护闭环） */
export interface IntakeLog {
  id: string;
  /** 新版记录引用确定性的 occurrence；旧记录可能缺失。 */
  occurrenceId?: string;
  scheduleRevisionId?: string;
  sourceRuleId?: string;
  medId: string;
  slot: Slot;
  /** 应服时间（UTC 毫秒） */
  dueAt: number;
  /** 新记录只持久化 taken/skipped；pending 仅兼容旧备份。 */
  status: 'taken' | 'skipped' | 'pending';
  /** 患者确认时间（UTC 毫秒） */
  ackAt?: number;
  /** 本次打卡扣减的库存数量；用于撤销时恢复，老记录为空表示无法自动恢复 */
  inventoryDelta?: number;
  /** Device-local inventory operation created for this intake deduction. */
  inventoryOperationLogId?: string;
  /**
   * 标记此条服药记录的库存已在分药向导完成时预扣。
   * - taken 记录：true 表示库存已扣，setOccurrenceAction 跳过 deductInventory，
   *   撤销时也不回滚库存（因为药已分到药盒格中）。
   * - 分药后实际打卡产生的 taken 记录使用此标记。
   */
  preDeducted?: boolean;
  updatedAt: number;
}

/** 小助手聊天记录（本机 IndexedDB，随对话即时写入；附件不入库）。 */
export interface AssistantChatRecord {
  id: string;
  role: 'user' | 'assistant';
  /** 消息文本；user 消息为展示文本（图片等附件只显示占位说明） */
  content: string;
  /**
   * assistant 消息随附的卡片/跳转块，结构与 ai/assistant 的 AssistantContentBlock
   * 一致；此处保持 unknown 以避免 db 层反向依赖 ai 层。
   */
  blocks?: unknown;
  createdAt: number;
}

export type MedicationScheduleReviewFlag = 'cycle-start-missing' | 'dose-unstructured';

/**
 * An immutable snapshot of one reminder rule plus the medication fields that
 * influence scheduling. New snapshots supersede earlier snapshots for the same
 * sourceRuleId from effectiveDate onward; earlier snapshots are never mutated.
 */
export interface MedicationScheduleRevision {
  readonly id: string;
  readonly medId: string;
  readonly sourceRuleId: string;
  readonly effectiveDate: LocalDate;
  readonly createdAt: number;
  readonly enabled: boolean;
  readonly slot: Slot;
  readonly timeLocal: string;
  readonly daysOfWeek: readonly number[];
  readonly cycle?: Readonly<{ activeDays: number; restDays: number }>;
  readonly cycleStartDate?: LocalDate;
  readonly mealRels: readonly MealRel[];
  readonly doseQuantity?: number;
  readonly doseUnit?: string;
  readonly reviewFlags: readonly MedicationScheduleReviewFlag[];
}

/** One expected dose generated deterministically from a schedule revision. */
export interface MedicationOccurrence {
  readonly id: string;
  readonly medId: string;
  readonly sourceRuleId: string;
  readonly scheduleRevisionId: string;
  readonly localDate: LocalDate;
  readonly slot: Slot;
  readonly dueAt: number;
  readonly timeLocal: string;
  readonly mealRels: readonly MealRel[];
  readonly doseQuantity?: number;
  readonly doseUnit?: string;
  /** Legacy logs used ruleId_YYYYMMDD; this key keeps them readable in place. */
  readonly legacyLogId: string;
}

/** 云同步的快照主体（KV: data:{household}） */
export interface DataSnapshot {
  meds: Medication[];
  rules: ReminderRule[];
  logs?: IntakeLog[];
  updatedAt: number;
}

/** 本地存储的药盒原图与 AI 展台大图（不上云） */
export interface PhotoBlob {
  id: string;
  medId: string;
  blob: Blob;
  at: number;
  /** 照片类型：用户真实拍摄原图 或 AI 生成的商业白底展台大图 */
  kind?: 'original' | 'ai_packshot';
  /** 若当前展示图为 AI 展台大图，可在此保留一份压缩后的真实拍摄原图，方便无损恢复 */
  originalBlob?: Blob;
}

/** 提醒推送状态（仅本地，防重复 + 升级用） */
export interface PushState {
  /** = IntakeLog.id，或派生 key（如照护者升级用 logId + '_care'） */
  id: string;
  /** 已发送次数 */
  count: number;
  /** 上次发送时间（UTC ms） */
  lastSentAt: number;
}

/**
 * 把旧字段 (mealRel 单值, with_meal slot) 升级到新字段 (mealRels[] 多选, 4 时段)。
 * 幂等：已经是新版结构的 Medication 不会被改坏。
 */
export function inflateMed<T extends Partial<Medication> & { slots?: any; mealRel?: any; mealRels?: any; mealRelsBySlot?: any; reminderMode?: any }>(m: T): T {
  if (!Array.isArray(m.slots)) m.slots = [];
  // mealRels 字段补齐
  if (!Array.isArray(m.mealRels)) {
    const old = (m as any).mealRel;
    if (old && old !== 'none' && (old === 'before' || old === 'after' || old === 'with')) {
      m.mealRels = [old];
    } else {
      m.mealRels = [];
    }
  }
  // with_meal slot 迁移 → 加 'with' 进 mealRels，原 with_meal 替换成 noon（如果还没 noon）
  if (Array.isArray(m.slots) && m.slots.includes('with_meal')) {
    m.slots = m.slots.filter((s: any) => s !== 'with_meal');
    if (!m.slots.includes('noon')) m.slots.push('noon');
    if (!m.mealRels.includes('with')) m.mealRels.push('with');
  }
  m.slots = SLOTS.filter((s) => (m.slots as any[]).includes(s));
  m.mealRels = normalizeMealRels(m.mealRels) as any;
  m.mealRelsBySlot = normalizeMealRelsBySlot(m.mealRelsBySlot, m.slots as Slot[], m.mealRels as MealRel[]) as any;
  m.mealRels = mealRelsFromBySlot(m.mealRelsBySlot as MealRelsBySlot) as any;
  if (!m.identity) m.identity = emptyIdentity() as any;
  if (!Array.isArray(m.daysOfWeek)) m.daysOfWeek = [] as any;
  m.reminderMode = normalizeMedicationReminderMode(m.reminderMode) as any;
  return m;
}
