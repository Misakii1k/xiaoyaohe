import { confirmDialog } from '../ui/components';

export type AiDataKind = 'medicine-photo' | 'prescription' | 'assistant-chat' | 'voice-medication' | 'web-search';
export type AiConsentCategory = 'health' | 'assistant';

export interface StoredAiConsent {
  version: 2;
  origin: string;
  category: AiConsentCategory;
  grantedAt: number;
}

const STORAGE_KEY = 'medbox.ai-consent.v2';
const sessionApprovals = new Set<string>();

const KIND_LABEL: Record<AiConsentCategory, string> = {
  health: '药盒、药单或用药信息',
  assistant: '你和小助手的对话内容',
};

export function consentCategoryFor(kind: AiDataKind): AiConsentCategory {
  if (kind === 'assistant-chat' || kind === 'web-search') return 'assistant';
  return 'health';
}

export async function requireAiConsent(kind: AiDataKind, baseUrl: string): Promise<void> {
  const origin = parseSecureOrigin(baseUrl);
  const category = consentCategoryFor(kind);
  const key = recordKey(origin, category);
  if (sessionApprovals.has(key) || getAiConsentRecords().some((record) => recordKey(record.origin, record.category) === key)) {
    sessionApprovals.add(key);
    return;
  }

  const ok = await confirmDialog(
    `即将把${KIND_LABEL[category]}发送到：\n${origin}\n\n授权会保留给此服务商和该数据类别；可在设置中随时撤销。`,
    '同意并继续',
  );
  if (!ok) throw new Error('已取消发送到 AI 服务');

  const record: StoredAiConsent = { version: 2, origin, category, grantedAt: Date.now() };
  writeRecords([...getAiConsentRecords().filter((item) => recordKey(item.origin, item.category) !== key), record]);
  sessionApprovals.add(key);
}

export function getAiConsentRecords(): StoredAiConsent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredConsent);
  } catch {
    return [];
  }
}

export function revokeAiConsent(origin: string, category: AiConsentCategory): void {
  const secureOrigin = parseSecureOrigin(origin);
  const key = recordKey(secureOrigin, category);
  writeRecords(getAiConsentRecords().filter((record) => recordKey(record.origin, record.category) !== key));
  sessionApprovals.delete(key);
}

export function clearAiConsents(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* Non-persistent browser mode. */ }
  sessionApprovals.clear();
}

function writeRecords(records: readonly StoredAiConsent[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // The current tab still remembers consent when browser storage is blocked.
  }
}

function isStoredConsent(value: unknown): value is StoredAiConsent {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<StoredAiConsent>;
  return item.version === 2
    && typeof item.origin === 'string'
    && (item.category === 'health' || item.category === 'assistant')
    && typeof item.grantedAt === 'number';
}

function parseSecureOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('AI 授权只允许 HTTPS 服务商地址');
  if (url.username || url.password) throw new Error('AI 地址不能包含账号密码');
  return url.origin;
}

function recordKey(origin: string, category: AiConsentCategory): string {
  return `${origin}:${category}`;
}
