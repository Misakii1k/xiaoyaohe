import { Capacitor, registerPlugin } from '@capacitor/core';
import { SLOT_LABEL, type Slot } from '../db/schema';
import type { SortWizardItem } from '../ui/SortWizard';

export type SortTtsRate = 'normal' | 'slow';

export const SORT_TTS_ENABLED_STORAGE_KEY = 'medbox.sort-tts.enabled.v1';
export const SORT_TTS_RATE_STORAGE_KEY = 'medbox.sort-tts.rate.v1';
export const SORT_TTS_CHANGE_EVENT = 'medbox:sort-tts-change';

const SLOT_ORDER: readonly Slot[] = ['morning', 'noon', 'evening', 'bedtime'];
const RATE_VALUE_MAP: Record<SortTtsRate, number> = {
  normal: 1.0,
  slow: 0.8,
};

interface NativeMedboxTtsPlugin {
  isAvailable(): Promise<{ available: boolean; chineseSupported: boolean; initialized: boolean }>;
  speak(options: { text: string; rate?: number; interrupt?: boolean }): Promise<{
    spoken: boolean;
    supported: boolean;
    interrupted?: boolean;
  }>;
  stop(): Promise<{ stopped: boolean }>;
}

const nativeTtsPlugin = registerPlugin<NativeMedboxTtsPlugin>('MedboxTts');

let activeSpeechToken = 0;
let unsupportedHintShownInSession = false;

export function resetSortTtsSessionState(): void {
  activeSpeechToken += 1;
  unsupportedHintShownInSession = false;
}

export function isSortTtsEnabled(): boolean {
  try {
    const raw = localStorage.getItem(SORT_TTS_ENABLED_STORAGE_KEY);
    if (raw === 'false' || raw === 'off' || raw === '0') return false;
  } catch {
    // 隐私模式或无存储时保持默认开启
  }
  return true;
}

export function setSortTtsEnabled(enabled: boolean): void {
  const normalized = Boolean(enabled);
  try {
    localStorage.setItem(SORT_TTS_ENABLED_STORAGE_KEY, normalized ? 'true' : 'false');
  } catch {
    // 忽略异常
  }
  dispatchSortTtsChange();
}

export function getSortTtsRate(): SortTtsRate {
  try {
    const raw = localStorage.getItem(SORT_TTS_RATE_STORAGE_KEY);
    if (raw === 'slow') return 'slow';
  } catch {
    // 忽略异常
  }
  return 'normal';
}

export function setSortTtsRate(rate: SortTtsRate): void {
  const normalized: SortTtsRate = rate === 'slow' ? 'slow' : 'normal';
  try {
    localStorage.setItem(SORT_TTS_RATE_STORAGE_KEY, normalized);
  } catch {
    // 忽略异常
  }
  dispatchSortTtsChange();
}

function dispatchSortTtsChange(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(SORT_TTS_CHANGE_EVENT, {
      detail: { enabled: isSortTtsEnabled(), rate: getSortTtsRate() },
    }),
  );
}

/** 生成单盒分药卡片要播报的自然中文文本 */
export function buildSortCardSpeechText(item: SortWizardItem): string {
  const name = item.med.name.trim() || '当前药品';
  if (item.expired) {
    return `${name}，已过期，请勿分装`;
  }
  if (item.isRest) {
    return `${name}，今天停药，不用分`;
  }
  const bySlot = new Map(item.entries.map((entry) => [entry.slot, entry]));
  const slotPhrases: string[] = [];
  for (const slot of SLOT_ORDER) {
    const entry = bySlot.get(slot);
    if (!entry) continue;
    const dose = entry.doseLabel.trim() || '按医嘱';
    slotPhrases.push(`${SLOT_LABEL[slot]} ${dose}`);
  }
  if (slotPhrases.length === 0) {
    return `${name}，今天请按医嘱分药`;
  }
  return `${name}，${slotPhrases.join('，')}`;
}

/** 生成分药向导总结页要播报的文本 */
export function buildSortSummarySpeechText(items: readonly SortWizardItem[]): string {
  const sorted = items.filter((item) => !item.isRest && !item.expired).length;
  return sorted > 0 ? `${sorted} 盒药都分好了` : '本轮分药已结束';
}

function isNativeAndroidTtsCandidate(): boolean {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return false;
  if (typeof Capacitor.isPluginAvailable === 'function') {
    return Capacitor.isPluginAvailable('MedboxTts');
  }
  return true;
}

function speakViaWebSpeech(text: string, rateValue: number): { spoken: boolean; supported: boolean } {
  if (
    typeof window === 'undefined' ||
    !('speechSynthesis' in window) ||
    typeof SpeechSynthesisUtterance === 'undefined'
  ) {
    return { spoken: false, supported: false };
  }
  const synth = window.speechSynthesis;
  try {
    const voices = typeof synth.getVoices === 'function' ? synth.getVoices() : [];
    if (voices.length > 0 && !voices.some((voice) => voice.lang.toLowerCase().startsWith('zh'))) {
      return { spoken: false, supported: false };
    }
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = rateValue;
    synth.speak(utterance);
    return { spoken: true, supported: true };
  } catch {
    return { spoken: false, supported: false };
  }
}

export interface SpeakSortTextOptions {
  /** 为 true 时忽略总开关状态（如点击「重听」「试听示例」） */
  force?: boolean;
  /** 自动播报默认每轮会话最多提示一次；手动点试听/重听时总是提示 */
  alwaysNotifyUnsupported?: boolean;
  onUnsupported?: () => void;
}

function notifyUnsupportedOnce(options: SpeakSortTextOptions): void {
  if (!options.onUnsupported) return;
  if (options.alwaysNotifyUnsupported) {
    options.onUnsupported();
    return;
  }
  if (!unsupportedHintShownInSession) {
    unsupportedHintShownInSession = true;
    options.onUnsupported();
  }
}

export async function speakSortText(
  text: string,
  options: SpeakSortTextOptions = {},
): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (!options.force && !isSortTtsEnabled()) return false;

  const token = ++activeSpeechToken;
  const rateValue = RATE_VALUE_MAP[getSortTtsRate()];

  if (isNativeAndroidTtsCandidate()) {
    try {
      const result = await nativeTtsPlugin.speak({
        text: trimmed,
        rate: rateValue,
        interrupt: true,
      });
      if (token !== activeSpeechToken) return false;
      if (result?.spoken) return true;
      if (result?.interrupted) return false;
      if (result && result.supported === false) {
        notifyUnsupportedOnce(options);
        return false;
      }
    } catch {
      if (token !== activeSpeechToken) return false;
      // 老旧 APK 底座暂未编译原生插件时，回退尝试 WebView 语音能力
    }
  }

  if (token !== activeSpeechToken) return false;
  const webResult = speakViaWebSpeech(trimmed, rateValue);
  if (!webResult.supported) {
    notifyUnsupportedOnce(options);
    return false;
  }
  return webResult.spoken;
}

export function stopSortSpeech(): void {
  activeSpeechToken += 1;
  if (isNativeAndroidTtsCandidate()) {
    void nativeTtsPlugin.stop().catch(() => undefined);
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // 忽略清理异常
    }
  }
}
