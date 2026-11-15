// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nativeMocks = vi.hoisted(() => ({
  available: false,
  getNativeCareMode: vi.fn(async () => null as boolean | null),
  setNativeCareMode: vi.fn(async () => true),
}));

vi.mock('../src/features/nativeMedicationAlarm', () => ({
  nativeMedicationAlarmAvailable: () => nativeMocks.available,
  getNativeCareMode: nativeMocks.getNativeCareMode,
  setNativeCareMode: nativeMocks.setNativeCareMode,
}));

import {
  CARE_MODE_CHANGE_EVENT,
  CARE_MODE_STORAGE_KEY,
  initCareMode,
  isCareModeEnabled,
  setCareModeEnabled,
} from '../src/features/careMode';
import { getSetting, setSetting } from '../src/features/appSettings';

describe('careMode.ts - 关怀大字模式与原生同步', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.care;
    nativeMocks.available = false;
    nativeMocks.getNativeCareMode.mockReset().mockResolvedValue(null);
    nativeMocks.setNativeCareMode.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('默认关闭，开启后写入 localStorage、更新 data-care 并派发事件', async () => {
    expect(isCareModeEnabled()).toBe(false);
    const events: boolean[] = [];
    const listener = (e: Event) => {
      events.push(Boolean((e as CustomEvent<{ enabled?: boolean }>).detail?.enabled));
    };
    window.addEventListener(CARE_MODE_CHANGE_EVENT, listener);

    await setCareModeEnabled(true);
    expect(isCareModeEnabled()).toBe(true);
    expect(window.localStorage.getItem(CARE_MODE_STORAGE_KEY)).toBe('on');
    expect(document.documentElement.dataset.care).toBe('on');
    expect(events).toEqual([true]);

    await setCareModeEnabled(false);
    expect(isCareModeEnabled()).toBe(false);
    expect(document.documentElement.dataset.care).toBe('off');
    expect(events).toEqual([true, false]);

    window.removeEventListener(CARE_MODE_CHANGE_EVENT, listener);
  });

  it('Android 原生可用时将关怀模式同步到原生闹钟页偏好', async () => {
    nativeMocks.available = true;
    await setCareModeEnabled(true);
    expect(nativeMocks.setNativeCareMode).toHaveBeenCalledWith(true);

    window.localStorage.clear();
    delete document.documentElement.dataset.care;
    nativeMocks.getNativeCareMode.mockResolvedValue(true);

    expect(initCareMode()).toBe(false);
    await vi.waitFor(() => {
      expect(document.documentElement.dataset.care).toBe('on');
      expect(isCareModeEnabled()).toBe(true);
    });
  });

  it('已注册到统一应用设置白名单，可供小助手开关', async () => {
    expect(getSetting('careModeEnabled')).toBe(false);
    await setSetting('careModeEnabled', true);
    expect(getSetting('careModeEnabled')).toBe(true);
    expect(document.documentElement.dataset.care).toBe('on');
  });
});
