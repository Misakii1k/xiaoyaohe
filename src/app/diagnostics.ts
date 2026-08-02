export interface DiagnosticEntry {
  at: number;
  scope: string;
  summary: string;
}

const STORAGE_KEY = 'medbox.diagnostics.v1';
const CAPACITY = 50;
const MAX_SUMMARY_LENGTH = 280;

export function reportSilentFailure(scope: string, cause: unknown): void {
  try {
    const entries = readEntries();
    entries.push({
      at: Date.now(),
      scope: sanitizeScope(scope),
      summary: sanitizeSummary(cause),
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-CAPACITY)));
  } catch {
    return;
  }
}

export function listDiagnosticLogs(): DiagnosticEntry[] {
  return readEntries();
}

export function clearDiagnosticLogs(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    return;
  }
}

export async function copyDiagnosticLogs(
  writeText: (text: string) => Promise<void> = (text) => navigator.clipboard.writeText(text),
): Promise<number> {
  const entries = readEntries();
  const text = entries.length === 0
    ? '小药盒诊断记录：暂无记录'
    : entries.map((entry) => `${new Date(entry.at).toISOString()} [${entry.scope}] ${entry.summary}`).join('\n');
  await writeText(text);
  return entries.length;
}

function readEntries(): DiagnosticEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value): DiagnosticEntry[] => {
      if (!value || typeof value !== 'object') return [];
      const candidate = value as Partial<DiagnosticEntry>;
      if (!Number.isFinite(candidate.at) || typeof candidate.scope !== 'string' || typeof candidate.summary !== 'string') {
        return [];
      }
      return [{ at: candidate.at as number, scope: sanitizeScope(candidate.scope), summary: sanitizeText(candidate.summary) }];
    }).slice(-CAPACITY);
  } catch {
    return [];
  }
}

function sanitizeScope(scope: string): string {
  const normalized = scope.replace(/[^a-z0-9._-]/gi, '-').slice(0, 64);
  return normalized || 'unknown';
}

function sanitizeSummary(cause: unknown): string {
  if (cause instanceof Error) return sanitizeText(`${cause.name}: ${cause.message}`);
  if (typeof cause === 'string') return sanitizeText(cause);
  return sanitizeText(Object.prototype.toString.call(cause));
}

function sanitizeText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [已脱敏]')
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[已脱敏]')
    .replace(/\bsk-[a-z0-9_-]{8,}\b/gi, '[已脱敏]')
    .replace(/https?:\/\/[^\s]+/gi, '[已脱敏网址]')
    .replace(/[「“\"]([^」”\"]{2,})[」”\"]/g, '[已脱敏]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, MAX_SUMMARY_LENGTH);
}
