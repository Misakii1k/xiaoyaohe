export const DIAGNOSTIC_SCOPES = [
  'global.error',
  'global.rejection',
  'lan.auto-join',
  'lan.auto-start',
  'lan.persistent-host',
  'photo.migration',
  'photo.migration-idle',
  'photo.migration-item',
  'photo.read',
  'photo.recompress',
  'reminder.action',
  'reminder.initialize',
  'reminder.native-reconcile',
  'reminder.reconcile',
  'reminder.reconcile-cleanup',
  'reminder.replay',
  'reminder.replay-visible',
  'reminder.schedule-chunk',
  'reminder.scheduler-start',
  'route.cleanup',
  'route.render',
  'startup.assistant',
  'startup.bootstrap',
  'startup.router',
  'unknown',
] as const;

export const DIAGNOSTIC_CODES = [
  'abort',
  'error',
  'range-error',
  'rejected-value',
  'syntax-error',
  'type-error',
  'unknown',
  'uri-error',
] as const;

export type DiagnosticScope = (typeof DIAGNOSTIC_SCOPES)[number];
export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];

export interface DiagnosticEntry {
  at: number;
  id: string;
  scope: DiagnosticScope;
  code: DiagnosticCode;
  /** Fixed text derived from `code`; never persisted from the original failure. */
  summary: string;
}

interface PersistedDiagnosticEntry {
  at: number;
  id: string;
  scope: DiagnosticScope;
  code: DiagnosticCode;
}

const STORAGE_KEY = 'medbox.diagnostics.v2';
const LEGACY_STORAGE_KEYS = ['medbox.diagnostics.v1'] as const;
const CAPACITY = 50;
const SAFE_ID_PATTERN = /^d-[a-z0-9]+-[a-z0-9]+$/;
const scopeSet = new Set<string>(DIAGNOSTIC_SCOPES);
const codeSet = new Set<string>(DIAGNOSTIC_CODES);
let diagnosticSequence = 0;

const summaries: Record<DiagnosticCode, string> = {
  abort: '操作已取消',
  error: '操作执行失败',
  'range-error': '数据范围无效',
  'rejected-value': '异步操作失败',
  'syntax-error': '数据格式无效',
  'type-error': '数据类型无效',
  unknown: '未知类型故障',
  'uri-error': '页面地址格式无效',
};

// v1 stored raw summaries. Remove it as soon as this privacy-safe module loads,
// even when no new diagnostic is recorded during this session.
discardLegacyEntries();

/**
 * Records only controlled categories and a generated safe id. The original
 * error, message, URL, identifiers and other free text are never persisted.
 */
export function reportSilentFailure(scope: string, cause: unknown): string {
  const id = createDiagnosticId();
  try {
    const entries = readPersistedEntries();
    entries.push({
      at: Date.now(),
      id,
      scope: normalizeScope(scope),
      code: classifyCause(cause),
    });
    persistEntries(entries.slice(-CAPACITY));
  } catch {
    // Diagnostics must never become another application failure.
  }
  return id;
}

export function listDiagnosticLogs(): DiagnosticEntry[] {
  return readPersistedEntries().map((entry) => ({
    ...entry,
    summary: summaries[entry.code],
  }));
}

export function clearDiagnosticLogs(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    discardLegacyEntries();
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

export async function copyDiagnosticLogs(
  writeText: (text: string) => Promise<void> = (text) => navigator.clipboard.writeText(text),
): Promise<number> {
  const entries = listDiagnosticLogs();
  const text = entries.length === 0
    ? '小药盒诊断记录：暂无记录'
    : entries
      .map((entry) => `${new Date(entry.at).toISOString()} [${entry.scope}/${entry.code}] ${entry.summary} (${entry.id})`)
      .join('\n');
  await writeText(text);
  return entries.length;
}

function readPersistedEntries(): PersistedDiagnosticEntry[] {
  try {
    discardLegacyEntries();
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return [];
    const parsed: unknown = JSON.parse(stored);
    const entries = Array.isArray(parsed)
      ? parsed.flatMap(normalizePersistedEntry).slice(-CAPACITY)
      : [];
    const normalized = JSON.stringify(entries);
    if (stored !== normalized) localStorage.setItem(STORAGE_KEY, normalized);
    return entries;
  } catch {
    try {
      localStorage.removeItem(STORAGE_KEY);
      discardLegacyEntries();
    } catch {
      // Ignore unavailable storage while still returning a safe empty view.
    }
    return [];
  }
}

function normalizePersistedEntry(value: unknown): PersistedDiagnosticEntry[] {
  if (!value || typeof value !== 'object') return [];
  const candidate = value as Partial<PersistedDiagnosticEntry>;
  if (
    !Number.isFinite(candidate.at)
    || typeof candidate.id !== 'string'
    || !SAFE_ID_PATTERN.test(candidate.id)
    || typeof candidate.scope !== 'string'
    || !scopeSet.has(candidate.scope)
    || typeof candidate.code !== 'string'
    || !codeSet.has(candidate.code)
  ) {
    return [];
  }
  return [{
    at: candidate.at as number,
    id: candidate.id,
    scope: candidate.scope as DiagnosticScope,
    code: candidate.code as DiagnosticCode,
  }];
}

function persistEntries(entries: PersistedDiagnosticEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  discardLegacyEntries();
}

function discardLegacyEntries(): void {
  try {
    for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key);
  } catch {
    // Storage may not exist in non-browser tools or restricted contexts.
  }
}

function normalizeScope(scope: string): DiagnosticScope {
  return scopeSet.has(scope) ? scope as DiagnosticScope : 'unknown';
}

function classifyCause(cause: unknown): DiagnosticCode {
  if (typeof DOMException !== 'undefined' && cause instanceof DOMException && cause.name === 'AbortError') {
    return 'abort';
  }
  if (cause instanceof URIError) return 'uri-error';
  if (cause instanceof TypeError) return 'type-error';
  if (cause instanceof SyntaxError) return 'syntax-error';
  if (cause instanceof RangeError) return 'range-error';
  if (cause instanceof Error) return 'error';
  if (cause !== null && cause !== undefined) return 'rejected-value';
  return 'unknown';
}

function createDiagnosticId(): string {
  diagnosticSequence = (diagnosticSequence + 1) % 1_679_616;
  return `d-${Date.now().toString(36)}-${diagnosticSequence.toString(36)}`;
}
