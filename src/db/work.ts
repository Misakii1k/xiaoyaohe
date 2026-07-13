import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  WorkEntry,
  WorkPayMode,
  WorkPaySnapshot,
  WorkProfile,
  WorkSettlement,
  WorkSettlementStatus,
} from './schema';

export interface WorkImportResult {
  added: number;
  updated: number;
  skipped: number;
}

export interface WorkBackupPayload {
  workProfiles?: WorkProfile[];
  workEntries?: WorkEntry[];
  workSettlements?: WorkSettlement[];
}

export interface WorkIncome {
  effectiveMs: number;
  amount: number;
  billable: boolean;
  key: string;
}

export interface WorkIncomeSummary {
  totalMs: number;
  estimatedIncome: number;
  pendingIncome: number;
  settledIncome: number;
  attendanceDays: number;
}

interface WorkDB extends DBSchema {
  workProfiles: {
    key: string;
    value: WorkProfile;
    indexes: { byName: string; byPayMode: WorkPayMode };
  };
  workEntries: {
    key: string;
    value: WorkEntry;
    indexes: { byStartAt: number; byStatus: string; byProjectName: string; byProfileId: string };
  };
  workSettlements: {
    key: string;
    value: WorkSettlement;
    indexes: { byProfileId: string; byPeriodKey: string; byStatus: string };
  };
}

const DB_VERSION = 2;
const DEFAULT_PROFILE_ID = 'default-work-profile';
const DAY = 24 * 60 * 60 * 1000;
let workDbp: Promise<IDBPDatabase<WorkDB>> | null = null;

function workDb(): Promise<IDBPDatabase<WorkDB>> {
  if (!workDbp) {
    workDbp = openDB<WorkDB>('medbox-work', DB_VERSION, {
      upgrade(d, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          const workEntries = d.createObjectStore('workEntries', { keyPath: 'id' });
          workEntries.createIndex('byStartAt', 'startAt');
          workEntries.createIndex('byStatus', 'status');
          workEntries.createIndex('byProjectName', 'projectName');
        }
        if (oldVersion < 2) {
          const profiles = d.createObjectStore('workProfiles', { keyPath: 'id' });
          profiles.createIndex('byName', 'name');
          profiles.createIndex('byPayMode', 'payMode');
          const settlements = d.createObjectStore('workSettlements', { keyPath: 'id' });
          settlements.createIndex('byProfileId', 'profileId');
          settlements.createIndex('byPeriodKey', 'periodKey');
          settlements.createIndex('byStatus', 'status');
          const entries = tx.objectStore('workEntries');
          if (!entries.indexNames.contains('byProfileId')) entries.createIndex('byProfileId', 'profileId');
        }
      },
      blocking() {
        workDbp?.then((d) => d.close()).catch(() => {});
        workDbp = null;
      },
    }).then(async (d) => {
      await ensureDefaultProfileAndMigrate(d);
      return d;
    });
  }
  return workDbp;
}

export function workUid(): string {
  return crypto.randomUUID();
}

export async function listWorkProfiles(includeDeleted = false): Promise<WorkProfile[]> {
  const all = await (await workDb()).getAll('workProfiles');
  return all
    .filter((p) => includeDeleted || !p.deleted)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

export async function putWorkProfile(profile: WorkProfile): Promise<void> {
  profile.name = profile.name.trim();
  profile.baseAmount = money(profile.baseAmount);
  profile.expectedWorkDaysPerMonth = Math.max(0, Math.floor(profile.expectedWorkDaysPerMonth || 0)) || undefined;
  profile.defaultBreakMinutes = Math.max(0, Math.floor(profile.defaultBreakMinutes || 0)) || 0;
  profile.settlementCycle = profile.payMode === 'salary' ? 'month' : profile.payMode === 'daily' ? 'day' : 'entry';
  profile.updatedAt = Date.now();
  await (await workDb()).put('workProfiles', profile);
}

export async function softDeleteWorkProfile(id: string): Promise<void> {
  if (id === DEFAULT_PROFILE_ID) return;
  const d = await workDb();
  const profile = await d.get('workProfiles', id);
  if (!profile) return;
  profile.deleted = true;
  profile.updatedAt = Date.now();
  await d.put('workProfiles', profile);
}

export async function listWorkEntries(includeDeleted = false): Promise<WorkEntry[]> {
  const all = await (await workDb()).getAll('workEntries');
  return all
    .map((e) => normalizeWorkEntry(e))
    .filter((e) => includeDeleted || !e.deleted)
    .sort((a, b) => b.startAt - a.startAt);
}

export async function listWorkEntriesByRange(
  rangeStart: number,
  rangeEnd: number,
  includeDeleted = false,
): Promise<WorkEntry[]> {
  const d = await workDb();
  const fromStarted = await d.getAllFromIndex('workEntries', 'byStartAt', IDBKeyRange.bound(rangeStart, rangeEnd));
  const all = await d.getAll('workEntries');
  const byId = new Map<string, WorkEntry>();
  for (const entry of fromStarted) byId.set(entry.id, normalizeWorkEntry(entry));
  for (const entry of all) {
    const normalized = normalizeWorkEntry(entry);
    const entryEnd = normalized.endAt ?? Date.now();
    if (normalized.startAt < rangeStart && entryEnd >= rangeStart) byId.set(normalized.id, normalized);
  }
  return [...byId.values()]
    .filter((e) => includeDeleted || !e.deleted)
    .sort((a, b) => b.startAt - a.startAt);
}

export async function listWorkEntriesByProfile(profileId: string): Promise<WorkEntry[]> {
  const all = await (await workDb()).getAllFromIndex('workEntries', 'byProfileId', profileId);
  return all
    .map((e) => normalizeWorkEntry(e))
    .filter((e) => !e.deleted)
    .sort((a, b) => b.startAt - a.startAt);
}

export async function getRunningWorkEntry(): Promise<WorkEntry | undefined> {
  const all = await listWorkEntries();
  return all.find((e) => e.status === 'running' && !e.deleted);
}

export async function listProjectNames(limit = 12): Promise<string[]> {
  const profiles = await listWorkProfiles();
  return profiles.slice(0, limit).map((p) => p.name);
}

export async function putWorkEntry(entry: WorkEntry): Promise<void> {
  entry.updatedAt = Date.now();
  await (await workDb()).put('workEntries', normalizeWorkEntry(entry));
}

export async function softDeleteWorkEntry(id: string): Promise<void> {
  const d = await workDb();
  const entry = await d.get('workEntries', id);
  if (!entry) return;
  entry.deleted = true;
  entry.updatedAt = Date.now();
  if (entry.status === 'running') {
    entry.status = 'stopped';
    entry.endAt = Date.now();
  }
  await d.put('workEntries', normalizeWorkEntry(entry));
}

export async function listWorkSettlements(includeDeleted = false): Promise<WorkSettlement[]> {
  const all = await (await workDb()).getAll('workSettlements');
  return all.filter((s) => includeDeleted || !s.deleted).sort((a, b) => b.periodKey.localeCompare(a.periodKey));
}

export async function putWorkSettlement(settlement: WorkSettlement): Promise<void> {
  settlement.amount = money(settlement.amount);
  settlement.updatedAt = Date.now();
  await (await workDb()).put('workSettlements', settlement);
}

export async function markWorkEntrySettled(id: string, status: WorkSettlementStatus): Promise<void> {
  const d = await workDb();
  const entry = await d.get('workEntries', id);
  if (!entry) return;
  entry.settlementStatus = status;
  entry.settledAt = status === 'settled' ? Date.now() : undefined;
  entry.updatedAt = Date.now();
  await d.put('workEntries', normalizeWorkEntry(entry));
}

export async function batchMarkSettled(entryIds: string[], settled: boolean): Promise<void> {
  const d = await workDb();
  await Promise.all(
    entryIds.map(async (id) => {
      const entry = await d.get('workEntries', id);
      if (!entry) return;
      entry.settlementStatus = settled ? 'settled' : 'pending';
      entry.settledAt = settled ? Date.now() : undefined;
      entry.updatedAt = Date.now();
      await putWorkEntry(entry);
    }),
  );
}

export async function markWorkSettlementSettled(id: string, status: WorkSettlementStatus): Promise<void> {
  const d = await workDb();
  const settlement = await d.get('workSettlements', id);
  if (!settlement) return;
  settlement.status = status;
  settlement.settledAt = status === 'settled' ? Date.now() : undefined;
  settlement.updatedAt = Date.now();
  await d.put('workSettlements', settlement);
}

export function calculateWorkIncome(entry: WorkEntry, entriesInScope: WorkEntry[] = [], now = Date.now()): WorkIncome {
  const normalized = normalizeWorkEntry({ ...entry });
  const effectiveMs = durationMs(normalized, now);
  if (normalized.amountOverride !== undefined && Number.isFinite(normalized.amountOverride)) {
    return { effectiveMs, amount: money(normalized.amountOverride), billable: true, key: normalized.id };
  }
  const snap = normalized.paySnapshot;
  if (!snap) return { effectiveMs, amount: 0, billable: false, key: normalized.id };
  if (snap.mode === 'hourly') {
    return { effectiveMs, amount: money((effectiveMs / 3_600_000) * snap.amount), billable: true, key: normalized.id };
  }
  if (snap.mode === 'daily') {
    const key = `${normalized.profileId || normalized.projectName}_${dateKey(normalized.startAt)}`;
    const earliest = entriesInScope
      .filter((e) => !e.deleted && e.paySnapshot?.mode === 'daily')
      .filter((e) => (e.profileId || e.projectName) === (normalized.profileId || normalized.projectName))
      .filter((e) => dateKey(e.startAt) === dateKey(normalized.startAt))
      .sort((a, b) => a.startAt - b.startAt || a.id.localeCompare(b.id))[0];
    const billable = !earliest || earliest.id === normalized.id || normalized.amountOverride !== undefined;
    return { effectiveMs, amount: billable ? money(snap.amount) : 0, billable, key };
  }
  return { effectiveMs, amount: 0, billable: false, key: `${normalized.profileId || normalized.projectName}_${monthKey(normalized.startAt)}` };
}

export function listWorkIncomeSummary(
  entries: WorkEntry[],
  profiles: WorkProfile[],
  settlements: WorkSettlement[],
  rangeStart: number,
  rangeEnd: number,
  now = Date.now(),
): WorkIncomeSummary {
  const scoped = entries.filter((e) => !e.deleted && overlaps(e, rangeStart, rangeEnd, now));
  let totalMs = 0;
  let estimatedIncome = 0;
  let pendingIncome = 0;
  let settledIncome = 0;
  const days = new Set<string>();
  const countedSalary = new Set<string>();

  for (const entry of scoped) {
    totalMs += clippedDurationMs(entry, rangeStart, rangeEnd, now);
    days.add(dateKey(entry.startAt));
    const income = calculateWorkIncome(entry, scoped, now);
    estimatedIncome += income.amount;
    if (entry.settlementStatus === 'settled') settledIncome += income.amount;
    else pendingIncome += income.amount;
  }

  if (rangeEnd - rangeStart >= 25 * DAY) {
    for (const profile of profiles.filter((p) => !p.deleted && p.payMode === 'salary')) {
      const months = monthsInRange(rangeStart, rangeEnd);
      for (const periodKey of months) {
        const key = `${profile.id}_${periodKey}`;
        if (countedSalary.has(key)) continue;
        countedSalary.add(key);
        const existing = settlements.find((s) => s.profileId === profile.id && s.periodKey === periodKey && !s.deleted);
        const amount = money(existing?.amount ?? profile.baseAmount);
        estimatedIncome += amount;
        if (existing?.status === 'settled') settledIncome += amount;
        else pendingIncome += amount;
      }
    }
  }

  return {
    totalMs,
    estimatedIncome: money(estimatedIncome),
    pendingIncome: money(pendingIncome),
    settledIncome: money(settledIncome),
    attendanceDays: days.size,
  };
}

export async function listWorkIncomeByProfile(
  entries: WorkEntry[],
  profiles: WorkProfile[],
  settlements: WorkSettlement[],
  start: number,
  end: number,
  now: number,
): Promise<{ profileId: string; profileName: string; totalIncome: number; totalMs: number; entryCount: number }[]> {
  const results: { profileId: string; profileName: string; totalIncome: number; totalMs: number; entryCount: number }[] = [];
  for (const profile of profiles) {
    if (profile.deleted) continue;
    const scoped = entries.filter(
      (e) => !e.deleted && e.profileId === profile.id && e.startAt >= start && e.startAt <= end,
    );
    let totalIncome = 0;
    let totalMs = 0;
    for (const entry of scoped) {
      const income = calculateWorkIncome(entry, scoped, now);
      totalIncome += income.amount;
      totalMs += income.effectiveMs;
    }
    if (profile.payMode === 'salary' && end - start >= 25 * DAY) {
      const months = monthsInRange(start, end);
      for (const periodKey of months) {
        const existing = settlements.find(
          (s) => s.profileId === profile.id && s.periodKey === periodKey && !s.deleted,
        );
        const amount = money(existing?.amount ?? profile.baseAmount);
        totalIncome += amount;
      }
    }
    results.push({
      profileId: profile.id,
      profileName: profile.name,
      totalIncome: money(totalIncome),
      totalMs,
      entryCount: scoped.length,
    });
  }
  return results.sort((a, b) => b.totalIncome - a.totalIncome);
}

export async function importWorkData(payload: WorkBackupPayload): Promise<WorkImportResult> {
  const result: WorkImportResult = { added: 0, updated: 0, skipped: 0 };
  const d = await workDb();
  const defaultProfile = await d.get('workProfiles', DEFAULT_PROFILE_ID) || workDefaultProfile();
  const tx = d.transaction(['workProfiles', 'workEntries', 'workSettlements'], 'readwrite');
  await mergeStore(tx.objectStore('workProfiles'), payload.workProfiles || [], isWorkProfileLike, normalizeWorkProfile, result);
  await mergeStore(tx.objectStore('workEntries'), payload.workEntries || [], isWorkEntryLike, (entry) => normalizeWorkEntry(entry, defaultProfile), result);
  await mergeStore(tx.objectStore('workSettlements'), payload.workSettlements || [], isWorkSettlementLike, normalizeWorkSettlement, result);
  await tx.done;
  return result;
}

export async function importWorkEntries(entries: WorkEntry[]): Promise<WorkImportResult> {
  return importWorkData({ workEntries: entries });
}

export async function exportWorkEntriesCsv(entries?: WorkEntry[]): Promise<string> {
  const rows = entries ?? await listWorkEntries();
  const scoped = rows.filter((e) => !e.deleted);
  const header = ['工作', '任务', '薪资模式', '开始时间', '结束时间', '休息分钟', '有效小时', '预计收入', '结算状态', '备注'];
  const lines = [header.map(csvCell).join(',')];
  for (const entry of scoped) {
    const income = calculateWorkIncome(entry, scoped, Date.now());
    lines.push([
      entry.paySnapshot?.profileName || entry.projectName,
      entry.taskName,
      payModeLabel(entry.paySnapshot?.mode),
      formatIsoLocal(entry.startAt),
      entry.endAt ? formatIsoLocal(entry.endAt) : '',
      String(entry.breakMinutes || 0),
      (income.effectiveMs / 3_600_000).toFixed(2),
      income.amount.toFixed(2),
      entry.settlementStatus === 'settled' ? '已结算' : '待结算',
      entry.note || '',
    ].map(csvCell).join(','));
  }
  return '\ufeff' + lines.join('\r\n');
}

export function createPaySnapshot(profile: WorkProfile): WorkPaySnapshot {
  return { mode: profile.payMode, amount: money(profile.baseAmount), profileName: profile.name };
}

export function workDefaultProfile(): WorkProfile {
  return {
    id: DEFAULT_PROFILE_ID,
    name: '默认工作',
    payMode: 'hourly',
    baseAmount: 0,
    settlementCycle: 'entry',
    defaultStartTime: '09:00',
    defaultEndTime: '18:00',
    defaultBreakMinutes: 60,
    updatedAt: Date.now(),
  };
}

async function ensureDefaultProfileAndMigrate(d: IDBPDatabase<WorkDB>): Promise<void> {
  const profiles = await d.getAll('workProfiles');
  let defaultProfile = profiles.find((p) => p.id === DEFAULT_PROFILE_ID);
  if (!defaultProfile) {
    defaultProfile = workDefaultProfile();
    await d.put('workProfiles', defaultProfile);
  }
  const entries = await d.getAll('workEntries');
  for (const entry of entries) {
    const normalized = normalizeWorkEntry(entry, defaultProfile);
    if (JSON.stringify(entry) !== JSON.stringify(normalized)) await d.put('workEntries', normalized);
  }
}

async function mergeStore<T extends { id: string; updatedAt: number }>(
  store: any,
  rows: T[],
  guard: (value: unknown) => value is T,
  normalize: (value: T) => T,
  result: WorkImportResult,
): Promise<void> {
  for (const raw of rows) {
    if (!guard(raw)) {
      result.skipped += 1;
      continue;
    }
    const incoming = normalize({ ...raw });
    const existing = await store.get(incoming.id);
    if (!existing) {
      await store.put(incoming);
      result.added += 1;
    } else if ((incoming.updatedAt || 0) > (existing.updatedAt || 0)) {
      await store.put(incoming);
      result.updated += 1;
    } else {
      result.skipped += 1;
    }
  }
}

function normalizeWorkProfile(profile: WorkProfile): WorkProfile {
  return {
    ...profile,
    name: String(profile.name || '未命名工作').trim(),
    payMode: normalizePayMode(profile.payMode),
    baseAmount: money(profile.baseAmount),
    settlementCycle: profile.payMode === 'salary' ? 'month' : profile.payMode === 'daily' ? 'day' : 'entry',
    defaultBreakMinutes: Math.max(0, Math.floor(profile.defaultBreakMinutes || 0)),
    updatedAt: profile.updatedAt || Date.now(),
  };
}

function normalizeWorkEntry(entry: WorkEntry, fallbackProfile?: WorkProfile): WorkEntry {
  const profileName = entry.paySnapshot?.profileName || entry.projectName || fallbackProfile?.name || '默认工作';
  const fallbackSnapshot = fallbackProfile ? createPaySnapshot(fallbackProfile) : undefined;
  const paySnapshot = entry.paySnapshot
    ? { mode: normalizePayMode(entry.paySnapshot.mode), amount: money(entry.paySnapshot.amount), profileName }
    : fallbackSnapshot;
  const normalized: WorkEntry = {
    ...entry,
    projectName: String(entry.projectName || profileName).trim(),
    taskName: String(entry.taskName || '').trim(),
    profileId: entry.profileId || fallbackProfile?.id,
    paySnapshot,
    breakMinutes: Math.max(0, Math.floor(entry.breakMinutes || 0)),
    status: entry.status === 'running' ? 'running' : 'stopped',
    settlementStatus: entry.settlementStatus === 'settled' ? 'settled' : 'pending',
    updatedAt: entry.updatedAt || Date.now(),
  };
  if (normalized.status === 'running') delete normalized.endAt;
  if (normalized.amountOverride !== undefined) normalized.amountOverride = money(normalized.amountOverride);
  if (normalized.note !== undefined) normalized.note = String(normalized.note).trim();
  return normalized;
}

function normalizeWorkSettlement(settlement: WorkSettlement): WorkSettlement {
  return {
    ...settlement,
    amount: money(settlement.amount),
    status: settlement.status === 'settled' ? 'settled' : 'pending',
    updatedAt: settlement.updatedAt || Date.now(),
  };
}

function isWorkProfileLike(value: unknown): value is WorkProfile {
  const p = value as WorkProfile;
  return Boolean(p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.payMode === 'string');
}

function isWorkEntryLike(value: unknown): value is WorkEntry {
  const entry = value as WorkEntry;
  return Boolean(entry && typeof entry.id === 'string' && typeof entry.projectName === 'string' && typeof entry.startAt === 'number' && typeof entry.status === 'string');
}

function isWorkSettlementLike(value: unknown): value is WorkSettlement {
  const s = value as WorkSettlement;
  return Boolean(s && typeof s.id === 'string' && typeof s.profileId === 'string' && typeof s.periodKey === 'string');
}

function normalizePayMode(mode: unknown): WorkPayMode {
  return mode === 'salary' || mode === 'daily' || mode === 'hourly' ? mode : 'hourly';
}

function durationMs(entry: WorkEntry, now: number): number {
  const end = entry.endAt ?? now;
  return Math.max(0, end - entry.startAt - (entry.breakMinutes || 0) * 60_000);
}

function clippedDurationMs(entry: WorkEntry, rangeStart: number, rangeEnd: number, now: number): number {
  const end = entry.endAt ?? now;
  if (entry.startAt > rangeEnd || end < rangeStart) return 0;
  const startAt = Math.max(entry.startAt, rangeStart);
  const endAt = Math.min(end, rangeEnd);
  return Math.max(0, endAt - startAt - (entry.breakMinutes || 0) * 60_000);
}

function overlaps(entry: WorkEntry, rangeStart: number, rangeEnd: number, now: number): boolean {
  const end = entry.endAt ?? now;
  return entry.startAt <= rangeEnd && end >= rangeStart;
}

function monthsInRange(rangeStart: number, rangeEnd: number): string[] {
  const out: string[] = [];
  const d = new Date(rangeStart);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  while (d.getTime() <= rangeEnd) {
    out.push(monthKey(d.getTime()));
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

function money(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function dateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatIsoLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function payModeLabel(mode?: WorkPayMode): string {
  if (mode === 'salary') return '固定薪资';
  if (mode === 'daily') return '日结';
  if (mode === 'hourly') return '时薪';
  return '';
}

function csvCell(value: string): string {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}
