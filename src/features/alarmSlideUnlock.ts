const STORAGE_KEY = 'medbox.alarm-slide-unlock.v1';

/**
 * 全屏用药提醒是否启用「向右滑动解锁」防误触。
 * 默认开启（true），以避免手机装在口袋或拿取时直接误触「已服用」按钮关闭提醒。
 * 用户可在「设置 - 系统通知」中关闭，关闭后提醒直接显示操作按钮。
 */
export function isAlarmSlideUnlockEnabled(): boolean {
  if (typeof localStorage === 'undefined') return true;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return true;
  return raw !== 'false';
}

export function setAlarmSlideUnlockEnabled(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
}

export function toggleAlarmSlideUnlock(): boolean {
  const next = !isAlarmSlideUnlockEnabled();
  setAlarmSlideUnlockEnabled(next);
  return next;
}
