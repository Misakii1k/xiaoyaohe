import { beforeEach, describe, expect, it, vi } from 'vitest';

const consentDialog = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../src/ui/components', () => ({ confirmDialog: consentDialog }));

import {
  clearAiConsents,
  getAiConsentRecords,
  grantAiConsentForOrigins,
  requireAiConsent,
  revokeAiConsent,
} from '../src/ai/consent';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  consentDialog.mockClear();
  clearAiConsents();
});

describe('AI provider consent persistence', () => {
  it('prompts once per provider origin and supported data category', async () => {
    await requireAiConsent('medicine-photo', 'https://api.example.com/v1');
    await requireAiConsent('prescription', 'https://api.example.com/v1');
    await requireAiConsent('assistant-chat', 'https://api.example.com/v1');

    expect(consentDialog).toHaveBeenCalledTimes(2);
    expect(getAiConsentRecords()).toEqual(expect.arrayContaining([
      expect.objectContaining({ origin: 'https://api.example.com', category: 'health', version: 2 }),
      expect.objectContaining({ origin: 'https://api.example.com', category: 'assistant', version: 2 }),
    ]));
  });

  it('requires a new confirmation after the category/origin permission is revoked', async () => {
    await requireAiConsent('medicine-photo', 'https://api.example.com/v1');
    revokeAiConsent('https://api.example.com', 'health');
    await requireAiConsent('prescription', 'https://api.example.com/v1');

    expect(consentDialog).toHaveBeenCalledTimes(2);
  });

  it('reuses persisted batch consent after an app reload instead of prompting again', async () => {
    localStorage.setItem('medbox.ai-consent.v2', JSON.stringify([
      { version: 2, origin: 'https://api.example.com', category: 'health', grantedAt: 1 },
      { version: 2, origin: 'https://api.example.com', category: 'assistant', grantedAt: 1 },
    ]));

    await expect(grantAiConsentForOrigins(
      ['https://api.example.com/v1'],
      '已保存的授权应直接复用。',
    )).resolves.toBe(true);
    expect(consentDialog).not.toHaveBeenCalled();
  });

  it('rejects insecure provider origins before rendering a confirmation', async () => {
    await expect(requireAiConsent('medicine-photo', 'http://api.example.com/v1')).rejects.toThrow(/HTTPS/);
    expect(consentDialog).not.toHaveBeenCalled();
  });
});
