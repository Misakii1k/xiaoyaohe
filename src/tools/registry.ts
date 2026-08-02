import type { IconName } from '../ui/components';
import { runLazyRoute, type RouteHandler } from '../router';
import {
  listLogs,
  listLogsByDay,
  listMeds,
  listRules,
  listScheduleRevisions,
  importMedsAndRules,
} from '../db/local';
import type {
  IntakeLog,
  Medication,
  MedicationScheduleRevision,
  ReminderRule,
} from '../db/schema';
import {
  findLogForOccurrence,
  generateOccurrences,
  toLocalDate,
} from '../domain/medicationSchedule';

export interface BackupImportResult {
  added: number;
  updated: number;
  skipped: number;
}

export interface BackupProvider {
  key: string;
  version: number;
  label: string;
  export: () => Promise<unknown>;
  import: (data: unknown) => Promise<BackupImportResult>;
  count: () => Promise<number>;
}

export interface ToolRoute {
  path: string;
  handler: RouteHandler;
}

export interface ToolSummary {
  text: string;
  tone?: 'ok' | 'warn' | 'info' | 'muted';
}

export interface ToolDefinition {
  id: string;
  title: string;
  icon: IconName;
  meta: string;
  homeRoute: string;
  routes: ToolRoute[];
  getSummary: () => Promise<ToolSummary>;
  backupProvider?: BackupProvider;
}

interface BackupPayload {
  meds?: Medication[];
  rules?: ReminderRule[];
  logs?: IntakeLog[];
  scheduleRevisions?: MedicationScheduleRevision[];
}

export const backupProviders: BackupProvider[] = [
  {
    key: 'meds',
    version: 2,
    label: '吃药工具',
    export: async () => ({
      meds: await listMeds(true),
      rules: await listRules(true),
      logs: await listLogs(),
      scheduleRevisions: await listScheduleRevisions(),
    }),
    import: async (data) => {
      const payload = asPayload(data);
      const result = await importMedsAndRules(
        Array.isArray(payload.meds) ? payload.meds : [],
        Array.isArray(payload.rules) ? payload.rules : [],
        Array.isArray(payload.logs) ? payload.logs : [],
        Array.isArray(payload.scheduleRevisions) ? payload.scheduleRevisions : [],
      );
      return {
        added: result.meds.added + result.rules.added + result.logs.added + result.scheduleRevisions.added,
        updated: result.meds.updated + result.rules.updated + result.logs.updated,
        skipped: result.meds.skipped + result.rules.skipped + result.logs.skipped + result.scheduleRevisions.skipped,
      };
    },
    count: async () =>
      (await listMeds()).length +
      (await listRules()).length +
      (await listLogs()).length +
      (await listScheduleRevisions()).length,
  },
];

export const tools: ToolDefinition[] = [
  {
    id: 'meds',
    title: '吃药工具',
    icon: 'pill',
    meta: '提醒 · 药盒 · 扫码',
    homeRoute: '/today',
    routes: [
      {
        path: '/today',
        handler: (_p, root, context) =>
          runLazyRoute(context.signal, () => import('../pages/Today'), (page) =>
            page.renderTodayPage(root, context.signal)),
      },
      {
        path: '/history',
        handler: (_p, root, context) =>
          runLazyRoute(context.signal, () => import('../pages/MedHistory'), (page) =>
            page.renderMedHistoryPage(root, context.signal)),
      },
      {
        path: '/meds',
        handler: (_p, root, context) =>
          runLazyRoute(context.signal, () => import('../pages/MedList'), (page) =>
            page.renderMedListPage(root, context.signal)),
      },
      {
        path: '/meds/new',
        handler: (_p, root, context) =>
          runLazyRoute(context.signal, () => import('../pages/MedBatchAdd'), (page) =>
            page.renderMedBatchAddPage(root, context.signal)),
      },
      {
        path: '/meds/batch',
        handler: (_p, root, context) =>
          runLazyRoute(context.signal, () => import('../pages/MedBatchAdd'), (page) =>
            page.renderMedBatchAddPage(root, context.signal)),
      },
      {
        path: '/meds/inventory',
        handler: (_p, root, context) =>
          runLazyRoute(context.signal, () => import('../pages/MedInventory'), (page) =>
            page.renderMedInventoryPage(root, context.signal)),
      },
      {
        path: '/meds/:id/edit',
        handler: (params, root, context) =>
          runLazyRoute(context.signal, () => import('../pages/MedEdit'), (page) =>
            page.renderMedEditPage(root, params.id ?? null, context.signal)),
      },
      {
        path: '/scan',
        handler: (_p, root, context) =>
          runLazyRoute(context.signal, () => import('../pages/ScanSort'), (page) =>
            page.renderScanSortPage(root, context.signal)),
      },
    ],
    getSummary: async () => {
      const [meds, rules, logs, revisions] = await Promise.all([
        listMeds(),
        listRules(),
        listLogsByDay(startOfDay(Date.now()), startOfDay(Date.now()) + DAY - 1),
        listScheduleRevisions(),
      ]);
      if (meds.length === 0) return { text: '还没有药品，先添加常用药', tone: 'muted' };
      const enabled = rules.filter((r) => r.enabled && !r.deleted).length;
      const occurrences = generateOccurrences(revisions, toLocalDate(), toLocalDate())
        .filter((occurrence) => meds.some((med) => med.id === occurrence.medId));
      const done = occurrences.filter((occurrence) => {
        const log = findLogForOccurrence(occurrence, logs);
        return log?.status === 'taken' || log?.status === 'skipped';
      }).length;
      const pending = occurrences.length - done;
      if (pending > 0) return { text: `今日待服 ${pending} 项 · ${meds.length} 种药`, tone: 'warn' };
      if (occurrences.length > 0) return { text: `今日已处理 · ${meds.length} 种药`, tone: 'ok' };
      return { text: `${meds.length} 种药 · ${enabled} 条提醒`, tone: enabled ? 'info' : 'muted' };
    },
    backupProvider: backupProviders[0],
  },
];

export async function buildBackup(): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = {
    version: 4,
    app: 'medbox',
    at: Date.now(),
    providers: backupProviders.map((p) => ({ key: p.key, version: p.version })),
  };
  for (const provider of backupProviders) {
    Object.assign(data, await provider.export());
  }
  return data;
}

export async function countBackupPayload(raw: unknown): Promise<Record<string, number>> {
  const payload = asPayload(raw);
  return {
    meds: Array.isArray(payload.meds) ? payload.meds.length : 0,
    rules: Array.isArray(payload.rules) ? payload.rules.length : 0,
    logs: Array.isArray(payload.logs) ? payload.logs.length : 0,
    scheduleRevisions: Array.isArray(payload.scheduleRevisions) ? payload.scheduleRevisions.length : 0,
  };
}

export interface BackupPreviewProviderResult {
  key: string;
  label: string;
  added: number;
  updated: number;
  skipped: number;
}

export interface BackupPreviewResult {
  providers: BackupPreviewProviderResult[];
  warnings: string[];
}

/**
 * 备份导入预扫描：复用 backupProviders 的字段约束，按 id + updatedAt 比对本地数据，
 * 预估每个 provider 将新增/更新/跳过多少条；异常字段收集到 warnings 但不阻断导入。
 */
export async function previewBackupImport(raw: unknown): Promise<BackupPreviewResult> {
  const payload = asPayload(raw);
  const warnings: string[] = [];
  const providers: BackupPreviewProviderResult[] = [];

  // 吃药工具：meds + rules + logs
  {
    const [existingMeds, existingRules, existingLogs, existingRevisions] = await Promise.all([
      listMeds(true),
      listRules(true),
      listLogs(),
      listScheduleRevisions(),
    ]);
    const medMap = new Map(existingMeds.map((m) => [m.id, m]));
    const ruleMap = new Map(existingRules.map((r) => [r.id, r]));
    const logMap = new Map(existingLogs.map((l) => [l.id, l]));
    const revisionIds = new Set(existingRevisions.map((revision) => revision.id));

    let added = 0;
    let updated = 0;
    let skipped = 0;

    const meds = Array.isArray(payload.meds) ? payload.meds : [];
    for (const item of meds) {
      if (!item || typeof item.id !== 'string') {
        skipped += 1;
        warnings.push('药品存在无效记录（缺少 id），将跳过');
        continue;
      }
      if (typeof item.name !== 'string') warnings.push(`药品 ${item.id} 缺少 name 字段，将按默认值补齐`);
      const existing = medMap.get(item.id);
      if (!existing) added += 1;
      else if ((item.updatedAt || 0) > (existing.updatedAt || 0)) updated += 1;
      else skipped += 1;
    }

    const rules = Array.isArray(payload.rules) ? payload.rules : [];
    for (const item of rules) {
      if (!item || typeof item.id !== 'string') {
        skipped += 1;
        warnings.push('提醒规则存在无效记录（缺少 id），将跳过');
        continue;
      }
      if (typeof item.medId !== 'string') warnings.push(`提醒规则 ${item.id} 缺少 medId 字段`);
      const existing = ruleMap.get(item.id);
      if (!existing) added += 1;
      else if ((item.updatedAt || 0) > (existing.updatedAt || 0)) updated += 1;
      else skipped += 1;
    }

    const logs = Array.isArray(payload.logs) ? payload.logs : [];
    for (const item of logs) {
      if (!item || typeof item.id !== 'string' || typeof item.dueAt !== 'number') {
        skipped += 1;
        warnings.push('服药记录存在无效记录（缺少 id 或 dueAt），将跳过');
        continue;
      }
      const existing = logMap.get(item.id);
      if (!existing) added += 1;
      else if ((item.updatedAt || 0) > (existing.updatedAt || 0)) updated += 1;
      else skipped += 1;
    }

    const scheduleRevisions = Array.isArray(payload.scheduleRevisions)
      ? payload.scheduleRevisions
      : [];
    for (const item of scheduleRevisions) {
      if (!item || typeof item.id !== 'string' || typeof item.sourceRuleId !== 'string') {
        skipped += 1;
        warnings.push('计划历史存在无效记录，将跳过');
        continue;
      }
      if (revisionIds.has(item.id)) skipped += 1;
      else added += 1;
    }

    providers.push({ key: 'meds', label: '吃药工具', added, updated, skipped });
  }

  return { providers, warnings };
}

const DAY = 24 * 60 * 60 * 1000;

function asPayload(value: unknown): BackupPayload {
  return value && typeof value === 'object' ? value as BackupPayload : {};
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
