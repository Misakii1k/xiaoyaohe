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
import {
  calculateWorkIncomeRange,
  csvCell,
  exportWorkEntriesCsv,
  getRunningWorkEntry,
  importWorkData,
  listWorkEntries,
  listWorkIncomeSummary,
  listWorkProfiles,
  listWorkSettlements,
} from '../db/work';
import type {
  IntakeLog,
  Medication,
  MedicationScheduleRevision,
  ReminderRule,
  WorkEntry,
  WorkProfile,
  WorkSettlement,
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
  workProfiles?: WorkProfile[];
  workEntries?: WorkEntry[];
  workSettlements?: WorkSettlement[];
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
  {
    key: 'workEntries',
    version: 1,
    label: '工时记录',
    export: async () => ({
      workProfiles: await listWorkProfiles(true),
      workEntries: await listWorkEntries(true),
      workSettlements: await listWorkSettlements(true),
    }),
    import: async (data) => {
      const payload = asPayload(data);
      return importWorkData({
        workProfiles: Array.isArray(payload.workProfiles) ? payload.workProfiles : [],
        workEntries: Array.isArray(payload.workEntries) ? payload.workEntries : [],
        workSettlements: Array.isArray(payload.workSettlements) ? payload.workSettlements : [],
      });
    },
    count: async () => (await listWorkProfiles()).length + (await listWorkEntries()).length + (await listWorkSettlements()).length,
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
            page.renderMedEditPage(root, params.id, context.signal)),
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
  {
    id: 'work',
    title: '工时记录',
    icon: 'briefcase',
    meta: '计时 · 补录 · 统计',
    homeRoute: '/work',
    routes: [
      {
        path: '/work',
        handler: (_p, root, context) =>
          runLazyRoute(context.signal, () => import('../pages/WorkLog'), (page) =>
            page.renderWorkLogPage(root, context.signal)),
      },
    ],
    getSummary: async () => {
      const running = await getRunningWorkEntry();
      if (running) return { text: `正在上班 · ${running.paySnapshot?.profileName || running.projectName}`, tone: 'ok' };
      const [entries, profiles, settlements] = await Promise.all([listWorkEntries(), listWorkProfiles(), listWorkSettlements()]);
      const todayStart = startOfDay(Date.now());
      const monthStart = startOfMonth(Date.now());
      const today = listWorkIncomeSummary(entries, profiles, settlements, todayStart, todayStart + 24 * 60 * 60 * 1000 - 1);
      const month = listWorkIncomeSummary(entries, profiles, settlements, monthStart, endOfMonth(Date.now()));
      return { text: `今日 ¥${today.estimatedIncome.toFixed(2)} · 待结 ¥${month.pendingIncome.toFixed(2)}`, tone: today.estimatedIncome > 0 ? 'info' : 'muted' };
    },
    backupProvider: backupProviders[1],
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
    workEntries:
      (Array.isArray(payload.workProfiles) ? payload.workProfiles.length : 0) +
      (Array.isArray(payload.workEntries) ? payload.workEntries.length : 0) +
      (Array.isArray(payload.workSettlements) ? payload.workSettlements.length : 0),
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

  // 工时记录：workProfiles + workEntries + workSettlements
  {
    const [existingProfiles, existingEntries, existingSettlements] = await Promise.all([
      listWorkProfiles(true),
      listWorkEntries(true),
      listWorkSettlements(true),
    ]);
    const profileMap = new Map(existingProfiles.map((p) => [p.id, p]));
    const entryMap = new Map(existingEntries.map((e) => [e.id, e]));
    const settlementMap = new Map(existingSettlements.map((s) => [s.id, s]));

    let added = 0;
    let updated = 0;
    let skipped = 0;

    const profiles = Array.isArray(payload.workProfiles) ? payload.workProfiles : [];
    for (const item of profiles) {
      if (!item || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.payMode !== 'string') {
        skipped += 1;
        warnings.push('工作档案存在无效记录（缺少 id/name/payMode），将跳过');
        continue;
      }
      const existing = profileMap.get(item.id);
      if (!existing) added += 1;
      else if ((item.updatedAt || 0) > (existing.updatedAt || 0)) updated += 1;
      else skipped += 1;
    }

    const entries = Array.isArray(payload.workEntries) ? payload.workEntries : [];
    for (const item of entries) {
      if (!item || typeof item.id !== 'string' || typeof item.projectName !== 'string' || typeof item.startAt !== 'number' || typeof item.status !== 'string') {
        skipped += 1;
        warnings.push('工时班次存在无效记录（缺少 id/projectName/startAt/status），将跳过');
        continue;
      }
      const existing = entryMap.get(item.id);
      if (!existing) added += 1;
      else if ((item.updatedAt || 0) > (existing.updatedAt || 0)) updated += 1;
      else skipped += 1;
    }

    const settlements = Array.isArray(payload.workSettlements) ? payload.workSettlements : [];
    for (const item of settlements) {
      if (!item || typeof item.id !== 'string' || typeof item.profileId !== 'string' || typeof item.periodKey !== 'string') {
        skipped += 1;
        warnings.push('工时结算存在无效记录（缺少 id/profileId/periodKey），将跳过');
        continue;
      }
      const existing = settlementMap.get(item.id);
      if (!existing) added += 1;
      else if ((item.updatedAt || 0) > (existing.updatedAt || 0)) updated += 1;
      else skipped += 1;
    }

    providers.push({ key: 'workEntries', label: '工时记录', added, updated, skipped });
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

function startOfMonth(ms: number): number {
  const d = new Date(ms);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function endOfMonth(ms: number): number {
  const d = new Date(ms);
  d.setMonth(d.getMonth() + 1, 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime() - 1;
}

export interface WorkReportResult {
  csv: string;
  summary: string;
}

/**
 * 区间报表导出：把指定区间内的班次聚合为 CSV（含合计行）+ 中文文本摘要。
 * - CSV 列：日期、班次名、开始时间、结束时间、工时、收入、结算状态
 * - 摘要：不超过 150 字，包含总收入/总工时/班次数/已结算比例
 */
export function exportWorkReport(
  entries: WorkEntry[],
  profiles: WorkProfile[],
  settlements: WorkSettlement[],
  start: number,
  end: number,
  mode: 'week' | 'month',
  now = Date.now(),
): WorkReportResult {
  const calculation = calculateWorkIncomeRange(entries, profiles, settlements, start, end, now);
  const incomeByEntry = new Map(calculation.entryContributions.map((row) => [row.entryId, row]));
  const scoped = entries.filter((entry) => incomeByEntry.has(entry.id));
  const header = ['日期', '班次名', '开始时间', '结束时间', '工时(小时)', '收入(元)', '结算状态'];
  const lines: string[] = [header.map(csvCell).join(',')];
  for (const entry of scoped) {
    const income = incomeByEntry.get(entry.id)!;
    const hours = (income.effectiveMs / 3_600_000).toFixed(2);
    const dateText = formatDateSlash(entry.startAt);
    const startText = formatClock(entry.startAt);
    const endText = entry.endAt ? formatClock(entry.endAt) : '';
    const settledText = entry.settlementStatus === 'settled' ? '已结算' : '待结算';
    lines.push([
      dateText,
      entry.paySnapshot?.profileName || entry.projectName,
      startText,
      endText,
      hours,
      income.amount.toFixed(2),
      settledText,
    ].map(csvCell).join(','));
  }
  for (const salary of calculation.salaryContributions) {
    lines.push([
      salary.periodKey,
      `${salary.profileName} · 固定薪资`,
      '',
      '',
      '0.00',
      salary.amount.toFixed(2),
      salary.status === 'settled' ? '已结算' : '待结算',
    ].map(csvCell).join(','));
  }
  lines.push([
    '合计',
    `${scoped.length} 条`,
    '',
    '',
    (calculation.summary.totalMs / 3_600_000).toFixed(2),
    calculation.summary.estimatedIncome.toFixed(2),
    `已结 ${calculation.summary.settledIncome.toFixed(2)}`,
  ].map(csvCell).join(','));

  const totalHours = (calculation.summary.totalMs / 3_600_000).toFixed(1);
  const settledRatio = calculation.summary.estimatedIncome > 0
    ? Math.round((calculation.summary.settledIncome / calculation.summary.estimatedIncome) * 100)
    : 0;
  const periodLabel = mode === 'month' ? '本月' : '本周';
  const summaryParts: string[] = [
    `${periodLabel}共记录班次 ${scoped.length} 次`,
    `总工时 ${totalHours} 小时`,
    `总收入 ${calculation.summary.estimatedIncome.toFixed(2)} 元`,
    `已结算占比 ${settledRatio}%`,
  ];
  if (scoped.length === 0) summaryParts.push('无班次记录，固定薪资仍按日历日估算');
  const summary = summaryParts.join('，') + '。';

  return { csv: '\ufeff' + lines.join('\r\n'), summary };
}

function formatDateSlash(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export { exportWorkEntriesCsv };
