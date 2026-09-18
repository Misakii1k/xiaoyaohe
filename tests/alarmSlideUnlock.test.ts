// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isAlarmSlideUnlockEnabled,
  setAlarmSlideUnlockEnabled,
  toggleAlarmSlideUnlock,
} from '../src/features/alarmSlideUnlock';

describe('全屏提醒滑动解锁偏好管理 (alarmSlideUnlock)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('在没有历史配置时默认开启滑动解锁防误触 (true)', () => {
    expect(isAlarmSlideUnlockEnabled()).toBe(true);
  });

  it('setAlarmSlideUnlockEnabled 正确将偏好持久化至 localStorage', () => {
    setAlarmSlideUnlockEnabled(false);
    expect(isAlarmSlideUnlockEnabled()).toBe(false);
    expect(localStorage.getItem('medbox.alarm-slide-unlock.v1')).toBe('false');

    setAlarmSlideUnlockEnabled(true);
    expect(isAlarmSlideUnlockEnabled()).toBe(true);
    expect(localStorage.getItem('medbox.alarm-slide-unlock.v1')).toBe('true');
  });

  it('toggleAlarmSlideUnlock 正确切换开启/关闭状态', () => {
    // 默认开启 -> 翻转为关闭
    expect(toggleAlarmSlideUnlock()).toBe(false);
    expect(isAlarmSlideUnlockEnabled()).toBe(false);

    // 关闭 -> 翻转为开启
    expect(toggleAlarmSlideUnlock()).toBe(true);
    expect(isAlarmSlideUnlockEnabled()).toBe(true);
  });
});
