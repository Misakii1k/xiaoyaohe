import {
  getNativeCareMode,
  nativeMedicationAlarmAvailable,
  setNativeCareMode,
} from './nativeMedicationAlarm';

export const CARE_MODE_STORAGE_KEY = 'medbox.care-mode.v1';
export const CARE_MODE_CHANGE_EVENT = 'medbox:care-mode-change';

function readStoredCareMode(): boolean | null {
  try {
    const raw = localStorage.getItem(CARE_MODE_STORAGE_KEY);
    if (raw === 'on' || raw === 'true' || raw === '1') return true;
    if (raw === 'off' || raw === 'false' || raw === '0') return false;
  } catch {
    // 隐私模式或无 localStorage 时保持默认关闭
  }
  return null;
}

function writeStoredCareMode(enabled: boolean): void {
  try {
    localStorage.setItem(CARE_MODE_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // 忽略持久化异常
  }
}

export function isCareModeEnabled(): boolean {
  return readStoredCareMode() === true;
}

export function applyCareModeToDom(enabled: boolean): void {
  if (typeof document === 'undefined' || !document.documentElement) return;
  document.documentElement.dataset.care = enabled ? 'on' : 'off';
}

export async function setCareModeEnabled(enabled: boolean): Promise<void> {
  const normalized = Boolean(enabled);
  writeStoredCareMode(normalized);
  applyCareModeToDom(normalized);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CARE_MODE_CHANGE_EVENT, { detail: { enabled: normalized } }));
  }
  if (nativeMedicationAlarmAvailable()) {
    await setNativeCareMode(normalized);
  }
}

export function initCareMode(): boolean {
  const stored = readStoredCareMode();
  const enabled = stored === true;
  applyCareModeToDom(enabled);
  if (nativeMedicationAlarmAvailable()) {
    if (stored !== null) {
      void setNativeCareMode(enabled);
    } else {
      void getNativeCareMode().then((nativeEnabled) => {
        if (nativeEnabled === null || nativeEnabled === enabled) return;
        writeStoredCareMode(nativeEnabled);
        applyCareModeToDom(nativeEnabled);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent(CARE_MODE_CHANGE_EVENT, { detail: { enabled: nativeEnabled } }),
          );
        }
      });
    }
  }
  return enabled;
}
