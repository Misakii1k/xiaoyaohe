/** App-level medication notification master switch (does not revoke OS permission). */

const STORAGE_KEY = 'medbox.notifications.enabled.v1';
export const NOTIFICATION_PREF_CHANGE_EVENT = 'medbox:notification-pref-change';

export function isAppNotificationsEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true;
    return raw === '1' || raw === 'true';
  } catch {
    return true;
  }
}

export function setAppNotificationsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    /* Preference write is best-effort. */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(NOTIFICATION_PREF_CHANGE_EVENT, { detail: { enabled } }));
  }
}
