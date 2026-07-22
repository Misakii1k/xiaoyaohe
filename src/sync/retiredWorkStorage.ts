const RETIRED_WORK_DATABASE = 'medbox-work';
const RETIRED_WORK_PREFERENCE = 'medbox.lastWorkEntry';
const AI_CONSENT_STORAGE = 'medbox.ai-consent.v2';

/** Best-effort cleanup for local data left by the removed work-hours module. */
export async function cleanupRetiredWorkStorage(): Promise<void> {
  removeRetiredPreference();
  await deleteRetiredDatabase();
}

function removeRetiredPreference(): void {
  try {
    localStorage.removeItem(RETIRED_WORK_PREFERENCE);
    const rawConsents = localStorage.getItem(AI_CONSENT_STORAGE);
    if (!rawConsents) return;
    const consents = JSON.parse(rawConsents);
    if (!Array.isArray(consents)) return;
    const retained = consents.filter((item) => !item || typeof item !== 'object' || item.category !== 'work');
    if (retained.length === 0) localStorage.removeItem(AI_CONSENT_STORAGE);
    else if (retained.length !== consents.length) localStorage.setItem(AI_CONSENT_STORAGE, JSON.stringify(retained));
  } catch {
    // Storage denial must not block medication features.
  }
}

function deleteRetiredDatabase(): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(RETIRED_WORK_DATABASE);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}
