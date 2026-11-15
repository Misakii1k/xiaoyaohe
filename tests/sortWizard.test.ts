// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSortWizardSummary, openSortWizard, type SortWizardItem } from '../src/ui/SortWizard';
import { isSortTtsEnabled, resetSortTtsSessionState, setSortTtsEnabled } from '../src/features/sortTts';
import { emptyIdentity, type Medication } from '../src/db/schema';

function medication(id: string, name: string): Medication {
  return {
    id,
    name,
    dosageText: '',
    amountPerDose: '2片',
    doseQuantity: 9,
    doseUnit: '片',
    slots: ['morning'],
    mealRels: [],
    mealRelsBySlot: {},
    daysOfWeek: [],
    identity: emptyIdentity(),
    updatedAt: 1,
  };
}

describe('sort wizard summary', () => {
  it('uses occurrence doses and excludes rest or expired medications', () => {
    const items: SortWizardItem[] = [
      {
        med: medication('active', '有效药'),
        entries: [
          { occurrenceId: 'occ-1', slot: 'morning', timeLocal: '08:00', doseLabel: '0.5片', doseQuantity: 0.5, doseUnit: '片', mealRels: [] },
          { occurrenceId: 'occ-2', slot: 'evening', timeLocal: '18:00', doseLabel: '1片', doseQuantity: 1, doseUnit: '片', mealRels: [] },
          { occurrenceId: 'occ-review', slot: 'bedtime', timeLocal: '22:00', doseLabel: '按医嘱', mealRels: [] },
        ],
        isRest: false,
        expired: false,
      },
      { med: medication('rest', '停药药'), entries: [], isRest: true, expired: false },
      {
        med: medication('expired', '过期药'),
        entries: [{ occurrenceId: 'occ-expired', slot: 'morning', timeLocal: '08:00', doseLabel: '2片', doseQuantity: 2, doseUnit: '片', mealRels: [] }],
        isRest: false,
        expired: true,
      },
    ];

    expect(buildSortWizardSummary(items, 123)).toEqual({
      items: [{
        medId: 'active',
        medName: '有效药',
        entries: [
          { occurrenceId: 'occ-1', quantity: 0.5, unit: '片' },
          { occurrenceId: 'occ-2', quantity: 1, unit: '片' },
        ],
        totalDose: 1.5,
        doseUnit: '片',
        entryCount: 3,
      }],
      completedAt: 123,
    });
  });
});

describe('openSortWizard TTS playback integration', () => {
  let spoken: string[] = [];
  let cancelMock = vi.fn();

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    window.localStorage.clear();
    resetSortTtsSessionState();
    setSortTtsEnabled(true);
    spoken = [];
    cancelMock = vi.fn();

    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel: cancelMock,
        speak: vi.fn((u: { text: string }) => {
          spoken.push(u.text);
        }),
        getVoices: vi.fn(() => [{ lang: 'zh-CN', name: 'Chinese' }]),
      },
    });
    (globalThis as Record<string, unknown>).SpeechSynthesisUtterance = class {
      text: string;
      lang = '';
      rate = 1;
      constructor(text: string) {
        this.text = text;
      }
    };
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('auto-speaks on step change, supports replay/mute toggle, and stops speech on quit', async () => {
    const items: SortWizardItem[] = [
      {
        med: medication('med-1', '阿莫西林胶囊'),
        entries: [
          { occurrenceId: 'o1', slot: 'morning', timeLocal: '08:00', doseLabel: '1片', doseQuantity: 1, doseUnit: '片', mealRels: [] },
        ],
        isRest: false,
        expired: false,
      },
      {
        med: medication('med-2', '硝苯地平缓释片'),
        entries: [
          { occurrenceId: 'o2', slot: 'evening', timeLocal: '19:00', doseLabel: '1片', doseQuantity: 1, doseUnit: '片', mealRels: [] },
        ],
        isRest: false,
        expired: false,
      },
    ];

    openSortWizard(items);

    await vi.waitFor(() => {
      expect(spoken).toEqual(['阿莫西林胶囊，早上 1片']);
    });

    const replayBtn = document.querySelector<HTMLButtonElement>('button[aria-label="重听 阿莫西林胶囊"]');
    expect(replayBtn).not.toBeNull();
    replayBtn?.click();
    await vi.waitFor(() => {
      expect(spoken).toHaveLength(2);
    });

    const muteBtn = document.querySelector<HTMLButtonElement>('button[aria-label="关闭分药语音播报"]');
    expect(muteBtn).not.toBeNull();
    muteBtn?.click();
    expect(isSortTtsEnabled()).toBe(false);
    expect(cancelMock).toHaveBeenCalled();

    const unmuteBtn = document.querySelector<HTMLButtonElement>('button[aria-label="开启分药语音播报"]');
    expect(unmuteBtn).not.toBeNull();

    const nextBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('放好了，下一盒'));
    expect(nextBtn).toBeTruthy();
    nextBtn?.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(spoken).toHaveLength(2);

    const replaySecondBtn = document.querySelector<HTMLButtonElement>('button[aria-label="重听 硝苯地平缓释片"]');
    expect(replaySecondBtn).not.toBeNull();
    replaySecondBtn?.click();
    await vi.waitFor(() => {
      expect(spoken).toEqual([
        '阿莫西林胶囊，早上 1片',
        '阿莫西林胶囊，早上 1片',
        '硝苯地平缓释片，晚上 1片',
      ]);
    });

    const cancelCountBeforeQuit = cancelMock.mock.calls.length;
    const quitBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('先不分了'));
    expect(quitBtn).toBeTruthy();
    quitBtn?.click();
    expect(cancelMock.mock.calls.length).toBeGreaterThan(cancelCountBeforeQuit);
  });
});
