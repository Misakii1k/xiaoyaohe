// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyIdentity, type Medication } from '../src/db/schema';
import type { SortWizardItem } from '../src/ui/SortWizard';

const capMocks = vi.hoisted(() => ({
  isNative: false,
  platform: 'web',
  pluginAvailable: true,
  nativeSpeak: vi.fn(async () => ({ spoken: true, supported: true })),
  nativeStop: vi.fn(async () => ({ stopped: true })),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => capMocks.isNative,
    getPlatform: () => capMocks.platform,
    isPluginAvailable: () => capMocks.pluginAvailable,
  },
  registerPlugin: () => ({
    speak: capMocks.nativeSpeak,
    stop: capMocks.nativeStop,
  }),
}));

import {
  buildSortCardSpeechText,
  buildSortSummarySpeechText,
  getSortTtsRate,
  isSortTtsEnabled,
  resetSortTtsSessionState,
  setSortTtsEnabled,
  setSortTtsRate,
  speakSortText,
  stopSortSpeech,
} from '../src/features/sortTts';
import { getSetting, setSetting } from '../src/features/appSettings';

function med(id: string, name: string): Medication {
  return {
    id,
    name,
    dosageText: '',
    amountPerDose: '1片',
    doseQuantity: 1,
    doseUnit: '片',
    slots: ['morning'],
    mealRels: [],
    mealRelsBySlot: {},
    daysOfWeek: [],
    identity: emptyIdentity(),
    updatedAt: 1,
  };
}

describe('sortTts.ts - 分药语音播报', () => {
  let spokenUtterances: Array<{ text: string; lang: string; rate: number }> = [];
  let cancelMock = vi.fn();
  let getVoicesMock = vi.fn(() => [{ lang: 'zh-CN', name: 'Chinese' }]);

  beforeEach(() => {
    window.localStorage.clear();
    resetSortTtsSessionState();
    capMocks.isNative = false;
    capMocks.platform = 'web';
    capMocks.pluginAvailable = true;
    capMocks.nativeSpeak.mockReset().mockResolvedValue({ spoken: true, supported: true });
    capMocks.nativeStop.mockReset().mockResolvedValue({ stopped: true });

    spokenUtterances = [];
    cancelMock = vi.fn();
    getVoicesMock = vi.fn(() => [{ lang: 'zh-CN', name: 'Chinese' }]);

    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel: cancelMock,
        speak: vi.fn((u: { text: string; lang: string; rate: number }) => {
          spokenUtterances.push({ text: u.text, lang: u.lang, rate: u.rate });
        }),
        getVoices: getVoicesMock,
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
    vi.restoreAllMocks();
  });

  it('播报默认开启、语速默认标准，且可通过设置白名单修改', async () => {
    expect(isSortTtsEnabled()).toBe(true);
    expect(getSortTtsRate()).toBe('normal');

    await setSetting('sortTtsRate', 'slow');
    expect(getSortTtsRate()).toBe('slow');

    await setSetting('sortTtsEnabled', false);
    expect(isSortTtsEnabled()).toBe(false);
    expect(getSetting('sortTtsEnabled')).toBe(false);
  });

  it('按常规、空剂量医嘱、停药日、过期与总结卡生成正确中文播报文本', () => {
    const active: SortWizardItem = {
      med: med('m1', '阿莫西林胶囊'),
      entries: [
        { occurrenceId: 'o2', slot: 'evening', timeLocal: '19:00', doseLabel: '1 片', mealRels: [] },
        { occurrenceId: 'o1', slot: 'morning', timeLocal: '08:00', doseLabel: '', mealRels: [] },
      ],
      isRest: false,
      expired: false,
    };
    const rest: SortWizardItem = {
      med: med('m2', '布洛芬缓释胶囊'),
      entries: [],
      isRest: true,
      expired: false,
    };
    const expired: SortWizardItem = {
      med: med('m3', '维生素C片'),
      entries: [],
      isRest: false,
      expired: true,
    };

    expect(buildSortCardSpeechText(active)).toBe('阿莫西林胶囊，早上 按医嘱，晚上 1 片');
    expect(buildSortCardSpeechText(rest)).toBe('布洛芬缓释胶囊，今天停药，不用分');
    expect(buildSortCardSpeechText(expired)).toBe('维生素C片，已过期，请勿分装');
    expect(buildSortSummarySpeechText([active, rest, expired])).toBe('1 盒药都分好了');
    expect(buildSortSummarySpeechText([rest, expired])).toBe('本轮分药已结束');
  });

  it('Web 端切换重听与打断，静音开关关闭后自动播报静默、force 仍可试听', async () => {
    setSortTtsRate('slow');
    expect(await speakSortText('阿莫西林胶囊，早上 1 片')).toBe(true);
    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(spokenUtterances[0]).toEqual({
      text: '阿莫西林胶囊，早上 1 片',
      lang: 'zh-CN',
      rate: 0.8,
    });

    setSortTtsEnabled(false);
    expect(await speakSortText('不应该自动播报')).toBe(false);
    expect(spokenUtterances).toHaveLength(1);

    expect(await speakSortText('点重听仍可播报', { force: true })).toBe(true);
    expect(spokenUtterances).toHaveLength(2);

    stopSortSpeech();
    expect(cancelMock).toHaveBeenCalledTimes(3);
  });

  it('Android 原生环境优先走 MedboxTts，并在缺失中文引擎时每轮仅温和提示一次', async () => {
    capMocks.isNative = true;
    capMocks.platform = 'android';
    capMocks.nativeSpeak.mockResolvedValue({ spoken: false, supported: false });

    const onUnsupported = vi.fn();
    expect(await speakSortText('阿莫西林胶囊', { onUnsupported })).toBe(false);
    expect(await speakSortText('第二盒药', { onUnsupported })).toBe(false);
    expect(capMocks.nativeSpeak).toHaveBeenCalledTimes(2);
    expect(onUnsupported).toHaveBeenCalledTimes(1);
    expect(spokenUtterances).toHaveLength(0);
  });

  it('老旧 Android APK 无原生插件时平滑回退到浏览器或提示不支持而不报错', async () => {
    capMocks.isNative = true;
    capMocks.platform = 'android';
    capMocks.pluginAvailable = false;
    getVoicesMock.mockReturnValue([{ lang: 'en-US', name: 'English Only' }]);

    const onUnsupported = vi.fn();
    await expect(speakSortText('无中文语音包', { onUnsupported })).resolves.toBe(false);
    expect(capMocks.nativeSpeak).not.toHaveBeenCalled();
    expect(onUnsupported).toHaveBeenCalledTimes(1);
  });
});
