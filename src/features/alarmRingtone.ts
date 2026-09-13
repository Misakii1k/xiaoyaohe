import {
  getNativeAlarmRingtone,
  nativeMedicationAlarmAvailable,
  setNativeAlarmRingtone,
} from './nativeMedicationAlarm';

export type AlarmRingtoneId = 'morning_energy' | 'system';

export interface AlarmRingtoneOption {
  id: AlarmRingtoneId;
  name: string;
  desc: string;
  isDefault?: boolean;
}

export const ALARM_RINGTONE_OPTIONS: readonly AlarmRingtoneOption[] = [
  {
    id: 'morning_energy',
    name: '晨间活力（专属推荐）',
    desc: '轻快清晨旋律，温和唤醒服药，默认首选',
    isDefault: true,
  },
  {
    id: 'system',
    name: '系统默认闹钟',
    desc: '使用手机系统设置中指定的闹钟铃声',
  },
] as const;

export const ALARM_RINGTONE_STORAGE_KEY = 'medbox.alarm.ringtone.v1';

let activePreviewAudio: HTMLAudioElement | null = null;
let currentPreviewListener: (() => void) | null = null;

/**
 * 获取当前设置的提醒铃声。默认使用专属音频 morning_energy。
 */
export function getAlarmRingtonePreference(): AlarmRingtoneId {
  try {
    const raw = localStorage.getItem(ALARM_RINGTONE_STORAGE_KEY);
    if (raw === 'system') return 'system';
    if (raw === 'morning_energy') return 'morning_energy';
  } catch {
    // 忽略异常
  }
  return 'morning_energy';
}

/**
 * 保存提醒铃声设置，并同步到原生层（若原生可用）。
 */
export async function setAlarmRingtonePreference(ringtone: AlarmRingtoneId): Promise<void> {
  try {
    localStorage.setItem(ALARM_RINGTONE_STORAGE_KEY, ringtone);
  } catch {
    // 忽略异常
  }
  if (nativeMedicationAlarmAvailable()) {
    await setNativeAlarmRingtone(ringtone);
  }
}

/**
 * 从原生侧读取铃声设置进行校准同步（可选）。
 */
export async function syncAlarmRingtoneFromNative(): Promise<AlarmRingtoneId> {
  if (nativeMedicationAlarmAvailable()) {
    const nativeVal = await getNativeAlarmRingtone();
    if (nativeVal === 'system' || nativeVal === 'morning_energy') {
      try {
        localStorage.setItem(ALARM_RINGTONE_STORAGE_KEY, nativeVal);
      } catch {
        // 忽略异常
      }
      return nativeVal;
    }
  }
  return getAlarmRingtonePreference();
}

/**
 * 当前是否正在播放预览。
 */
export function isRingtonePreviewPlaying(): boolean {
  return activePreviewAudio !== null && !activePreviewAudio.paused;
}

/**
 * 停止当前铃声试听。
 */
export function stopRingtonePreview(): void {
  if (activePreviewAudio) {
    try {
      activePreviewAudio.pause();
      activePreviewAudio.currentTime = 0;
    } catch {
      // 忽略异常
    }
    activePreviewAudio = null;
  }
  if (currentPreviewListener) {
    currentPreviewListener();
    currentPreviewListener = null;
  }
}

/**
 * 试听指定铃声。
 * 如果是专属音频 morning_energy，使用 Web Audio 播放；如果是系统铃声，返回 false 表示无需播放音频。
 */
export function playRingtonePreview(
  ringtone: AlarmRingtoneId,
  onEnded?: () => void,
): boolean {
  stopRingtonePreview();

  if (ringtone !== 'morning_energy') {
    return false;
  }

  if (typeof Audio === 'undefined') {
    return false;
  }

  try {
    const audio = new Audio('/audio/morning_energy.mp3');
    activePreviewAudio = audio;

    const handleEnd = () => {
      stopRingtonePreview();
      onEnded?.();
    };

    currentPreviewListener = () => {
      audio.removeEventListener('ended', handleEnd);
      audio.removeEventListener('error', handleEnd);
    };

    audio.addEventListener('ended', handleEnd);
    audio.addEventListener('error', handleEnd);

    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        stopRingtonePreview();
        onEnded?.();
      });
    }
    return true;
  } catch {
    stopRingtonePreview();
    return false;
  }
}
