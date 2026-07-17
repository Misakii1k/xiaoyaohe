import { beforeEach, describe, expect, it, vi } from 'vitest';

const consentDialog = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../src/ui/components', () => ({ confirmDialog: consentDialog }));

import {
  clearAiConsents,
  getAiConsentRecords,
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
  it('prompts once per provider origin and data category, not per image kind', async () => {
    await requireAiConsent('medicine-photo', 'https://api.example.com/v1');
    await requireAiConsent('prescription', 'https://api.example.com/v1');
    await requireAiConsent('work-data', 'https://api.example.com/v1');

    expect(consentDialog).toHaveBeenCalledTimes(2);
    expect(getAiConsentRecords()).toEqual(expect.arrayContaining([
      expect.objectContaining({ origin: 'https://api.example.com', category: 'health', version: 2 }),
      expect.objectContaining({ origin: 'https://api.example.com', category: 'work', version: 2 }),
    ]));
  });

  it('requires a new confirmation after the category/origin permission is revoked', async () => {
    await requireAiConsent('medicine-photo', 'https://api.example.com/v1');
    revokeAiConsent('https://api.example.com', 'health');
    await requireAiConsent('prescription', 'https://api.example.com/v1');

    expect(consentDialog).toHaveBeenCalledTimes(2);
  });

  it('rejects insecure provider origins before rendering a confirmation', async () => {
    await expect(requireAiConsent('medicine-photo', 'http://api.example.com/v1')).rejects.toThrow(/HTTPS/);
    expect(consentDialog).not.toHaveBeenCalled();
  });
});
