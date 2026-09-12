let dbRevision = 1;
const listeners = new Set<(scope?: string) => void>();

export function getDatabaseRevision(): number {
  return dbRevision;
}

export function notifyDataChanged(scope?: 'meds' | 'rules' | 'logs' | 'inventory' | 'all' | string): void {
  dbRevision++;
  const targetScope = scope ?? 'all';
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(
      new CustomEvent('medbox:data-changed', {
        detail: { scope: targetScope, revision: dbRevision },
      }),
    );
  }
  for (const listener of listeners) {
    try {
      listener(targetScope);
    } catch (cause) {
      console.error('[medbox] 数据库变更监听器执行失败', cause);
    }
  }
}

export function onDataChanged(listener: (scope?: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetDatabaseRevisionForTesting(): void {
  dbRevision = 1;
  listeners.clear();
}
