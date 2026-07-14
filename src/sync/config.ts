// The v1 snapshot protocol is permanently disabled. This flag only prevents
// obsolete outbox writes while older IndexedDB schemas are migrated in place.
export const CLOUD_SYNC_ENABLED = false;

const LEGACY_CONFIG_KEY = 'medbox.sync.config.v1';

/** Remove shared secrets stored by pre-v2 releases. */
export function clearSyncConfig(): void {
  try {
    localStorage.removeItem(LEGACY_CONFIG_KEY);
  } catch {
    // Storage denial must not block local-only app startup.
  }
}
