import { z } from 'zod';

const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_NODES = 50_000;
const MAX_ARRAY_ITEMS = 10_000;
const MAX_STRING_LENGTH = 10_000;
const MAX_DEPTH = 12;

const shortText = z.string().max(MAX_STRING_LENGTH);
const id = z.string().min(1).max(256);
const finiteNumber = z.number().finite();
const nonNegativeNumber = finiteNumber.nonnegative();
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeLocal = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const slot = z.enum(['morning', 'noon', 'evening', 'bedtime']);
const mealRel = z.enum(['before', 'with', 'after']);
const reminderMode = z.enum(['strong', 'fullscreen-short', 'fullscreen-persistent']);
const stringList = z.array(shortText).max(1_000);

const identitySchema = z.object({
  gtins: stringList,
  rawCodes: stringList,
  ocrNames: stringList,
  photoHashes: stringList,
}).passthrough();

const inventorySchema = z.object({
  remaining: nonNegativeNumber,
  unit: shortText,
  packageQuantity: nonNegativeNumber.optional(),
  lowThreshold: nonNegativeNumber.optional(),
  sourceNote: shortText.optional(),
  lastReminderAt: nonNegativeNumber.optional(),
  dailyConsumption: nonNegativeNumber.optional(),
}).passthrough();

const structuredDoseSchema = z.object({
  quantity: finiteNumber.positive(),
  unit: shortText.min(1),
}).passthrough();

const medicationSchema = z.object({
  id,
  name: shortText,
  dosageText: shortText,
  amountPerDose: shortText,
  doseQuantity: finiteNumber.positive().optional(),
  doseUnit: shortText.min(1).optional(),
  doseSourceText: shortText.optional(),
  doseMigrationSuggestion: structuredDoseSchema.optional(),
  doseReviewRequired: z.boolean().optional(),
  slots: z.array(slot).max(4),
  mealRels: z.array(mealRel).max(3),
  mealRelsBySlot: z.partialRecord(slot, z.array(mealRel).max(3)),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7),
  reminderMode: reminderMode.optional().default('strong'),
  inventory: inventorySchema.optional(),
  notes: shortText.optional(),
  expiryDate: nonNegativeNumber.optional(),
  expiryLocalDate: localDate.optional(),
  expirySourceTimestamp: nonNegativeNumber.optional(),
  identity: identitySchema,
  updatedAt: nonNegativeNumber,
  createdAt: nonNegativeNumber.optional(),
  deleted: z.boolean().optional(),
  mealRel: z.enum(['before', 'after', 'with', 'none']).optional(),
}).passthrough();

const cycleSchema = z.object({
  activeDays: z.number().int().positive(),
  restDays: z.number().int().nonnegative(),
}).passthrough();

const reminderRuleSchema = z.object({
  id,
  medId: id,
  slot,
  timeLocal,
  enabled: z.boolean(),
  cycle: cycleSchema.optional(),
  cycleStartDate: localDate.optional(),
  cycleStartNeedsReview: z.boolean().optional(),
  escalate: z.object({
    repeatEveryMin: z.number().int().nonnegative(),
    maxRepeats: z.number().int().nonnegative(),
    notifyCaregiverAfterMin: z.number().int().nonnegative(),
  }).passthrough(),
  updatedAt: nonNegativeNumber,
  deleted: z.boolean().optional(),
}).passthrough();

const intakeLogSchema = z.object({
  id,
  occurrenceId: id.optional(),
  scheduleRevisionId: id.optional(),
  sourceRuleId: id.optional(),
  medId: id,
  slot,
  dueAt: nonNegativeNumber,
  status: z.enum(['taken', 'skipped', 'pending']),
  ackAt: nonNegativeNumber.optional(),
  inventoryDelta: finiteNumber.positive().optional(),
  updatedAt: nonNegativeNumber,
}).passthrough();

const scheduleRevisionSchema = z.object({
  id,
  medId: id,
  sourceRuleId: id,
  effectiveDate: localDate,
  createdAt: nonNegativeNumber,
  enabled: z.boolean(),
  slot,
  timeLocal,
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7),
  cycle: cycleSchema.optional(),
  cycleStartDate: localDate.optional(),
  mealRels: z.array(mealRel).max(3),
  doseQuantity: finiteNumber.positive().optional(),
  doseUnit: shortText.min(1).optional(),
  reviewFlags: z.array(z.enum(['cycle-start-missing', 'dose-unstructured'])).max(2),
}).passthrough();

const backupSchema = z.object({
  app: z.literal('medbox').optional(),
  version: z.number().int().positive().optional(),
  at: nonNegativeNumber.optional(),
  providers: z.array(z.object({
    key: id,
    version: z.number().int().positive(),
  }).passthrough()).max(100).optional(),
  meds: z.array(medicationSchema).max(MAX_ARRAY_ITEMS).optional(),
  rules: z.array(reminderRuleSchema).max(MAX_ARRAY_ITEMS).optional(),
  logs: z.array(intakeLogSchema).max(MAX_ARRAY_ITEMS).optional(),
  scheduleRevisions: z.array(scheduleRevisionSchema).max(MAX_ARRAY_ITEMS).optional(),
}).passthrough();

export function assertBackupFileSize(file: File): void {
  if (file.size > MAX_BACKUP_BYTES) throw new Error('备份文件超过 5 MB 限制');
}

export function assertSafeBackupPayload(value: unknown): asserts value is Record<string, unknown> {
  parseSafeBackupPayload(value);
}

export function parseSafeBackupPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('备份根节点必须是 JSON 对象');
  }
  let nodes = 0;
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > MAX_TOTAL_NODES) throw new Error('备份记录过多');
    if (depth > MAX_DEPTH) throw new Error('备份嵌套层级过深');
    if (typeof item === 'string') {
      if (item.length > MAX_STRING_LENGTH) throw new Error('备份包含过长文本字段');
      return;
    }
    if (item == null || typeof item === 'number' || typeof item === 'boolean') return;
    if (Array.isArray(item)) {
      if (item.length > MAX_ARRAY_ITEMS) throw new Error('备份数组记录过多');
      for (const child of item) visit(child, depth + 1);
      return;
    }
    if (typeof item !== 'object') throw new Error('备份包含不支持的数据类型');
    for (const [key, child] of Object.entries(item)) {
      if (key.length > 100) throw new Error('备份包含异常字段名');
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  const parsed = backupSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
    throw new Error(`备份字段校验失败（${path}）：${issue.message}`);
  }
  return parsed.data;
}
