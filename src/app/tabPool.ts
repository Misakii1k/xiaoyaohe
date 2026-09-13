export const PRIMARY_TAB_ROUTES = ['/today', '/meds', '/history', '/settings'] as const;
export type PrimaryTabRoute = (typeof PRIMARY_TAB_ROUTES)[number];

export interface TabLifecycleDetail {
  tab: string;
  path: string;
  previousTab?: string | null;
  nextTab?: string | null;
}

export type TabLifecycleHandler = (detail: TabLifecycleDetail) => void;

export interface TabKeepAliveEntry {
  tabKey: PrimaryTabRoute;
  container: HTMLElement;
  savedScrollTop: number;
  rendered: boolean;
  cleanup?: (() => void) | null;
  controller?: AbortController;
  lastPath: string;
  onActivated?: () => void | Promise<void>;
  onDeactivated?: () => void | Promise<void>;
}

const tabPool = new Map<PrimaryTabRoute, TabKeepAliveEntry>();
let activeTabKey: PrimaryTabRoute | null = null;
let subpageContainer: HTMLElement | null = null;

const lifecycleListeners = new Map<'activated' | 'deactivated', Set<TabLifecycleHandler>>();
const tabSpecificListeners = new Map<string, Map<'activated' | 'deactivated', Set<TabLifecycleHandler>>>();

export function normalizeRoutePath(rawPath: string): string {
  let path = (rawPath || '').trim();
  if (path.startsWith('#')) path = path.slice(1);
  const [withoutQuery] = path.split('?');
  const [withoutAmp] = (withoutQuery ?? '').split('&');
  path = withoutAmp ?? '';
  if (!path.startsWith('/')) path = '/' + path;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

export function resolveKeepAliveTabKey(rawPath: string): PrimaryTabRoute | null {
  const path = normalizeRoutePath(rawPath);
  if (path === '/' || path === '/today' || path === '/tools') return '/today';
  if (path === '/meds' || path === '/medications') return '/meds';
  if (path === '/history') return '/history';
  if (path === '/settings') return '/settings';
  return null;
}

export function isKeepAliveTab(path: string): boolean {
  return resolveKeepAliveTabKey(path) !== null;
}

export function getActiveTabKey(): PrimaryTabRoute | null {
  return activeTabKey;
}

export function setActiveTabKey(tab: PrimaryTabRoute | null): void {
  activeTabKey = tab;
}

export function getCachedTabEntry(tabKey: PrimaryTabRoute): TabKeepAliveEntry | undefined {
  return tabPool.get(tabKey);
}

export function getAllCachedTabEntries(): TabKeepAliveEntry[] {
  return Array.from(tabPool.values());
}

export function getCachedTabKeys(): PrimaryTabRoute[] {
  return Array.from(tabPool.keys());
}

export function getTabPoolSize(): number {
  return tabPool.size;
}

export function getScrollContainer(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>('.app-main') ?? container;
}

export function saveTabScrollPosition(entry: TabKeepAliveEntry): void {
  const scrollEl = getScrollContainer(entry.container);
  if (scrollEl !== entry.container) {
    entry.savedScrollTop = scrollEl.scrollTop;
  } else {
    entry.savedScrollTop = scrollEl.scrollTop || (typeof window !== 'undefined' ? window.scrollY : 0);
  }
}

export function restoreTabScrollPosition(entry: TabKeepAliveEntry): void {
  const scrollEl = getScrollContainer(entry.container);
  scrollEl.scrollTop = entry.savedScrollTop;
  if (scrollEl === entry.container) {
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo(0, entry.savedScrollTop);
    }
  } else {
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo(0, 0);
    }
  }
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      scrollEl.scrollTop = entry.savedScrollTop;
    });
  }
}

export function showElement(el: HTMLElement): void {
  el.hidden = false;
  el.style.display = '';
  el.removeAttribute('aria-hidden');
}

export function hideElement(el: HTMLElement): void {
  el.hidden = true;
  el.style.display = 'none';
  el.setAttribute('aria-hidden', 'true');
}

export function getOrCreateTabContainer(tabKey: PrimaryTabRoute, rootEl: HTMLElement): TabKeepAliveEntry {
  let entry = tabPool.get(tabKey);
  if (!entry) {
    const container = document.createElement('div');
    container.className = 'tab-keepalive-container';
    container.setAttribute('data-tab-route', tabKey);
    hideElement(container);
    rootEl.appendChild(container);
    entry = {
      tabKey,
      container,
      savedScrollTop: 0,
      rendered: false,
      lastPath: tabKey,
    };
    tabPool.set(tabKey, entry);
  } else if (!entry.container.parentElement || entry.container.parentElement !== rootEl) {
    rootEl.appendChild(entry.container);
  }
  return entry;
}

export function getOrCreateSubpageContainer(rootEl: HTMLElement): HTMLElement {
  if (!subpageContainer || !subpageContainer.parentElement) {
    subpageContainer = document.createElement('div');
    subpageContainer.className = 'tab-keepalive-subpage';
    hideElement(subpageContainer);
    rootEl.appendChild(subpageContainer);
  } else if (subpageContainer.parentElement !== rootEl) {
    rootEl.appendChild(subpageContainer);
  }
  return subpageContainer;
}

export function getExistingSubpageContainer(): HTMLElement | null {
  return subpageContainer;
}

export function dispatchTabEvent(
  type: 'activated' | 'deactivated',
  tabKey: string,
  container: HTMLElement | null,
  detail: TabLifecycleDetail,
): void {
  if (container) {
    container.dispatchEvent(new CustomEvent(`tab:${type}`, { bubbles: true, detail }));
    container.dispatchEvent(new CustomEvent(`medbox:tab-${type}`, { bubbles: true, detail }));
  }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(`tab:${type}`, { detail }));
    window.dispatchEvent(new CustomEvent(`medbox:tab-${type}`, { detail }));
  }

  const globalSet = lifecycleListeners.get(type);
  if (globalSet) {
    for (const listener of globalSet) {
      try {
        listener(detail);
      } catch (cause) {
        console.error(`[medbox] Tab ${type} listener execution failure`, cause);
      }
    }
  }

  const tabMap = tabSpecificListeners.get(tabKey);
  if (tabMap) {
    const specificSet = tabMap.get(type);
    if (specificSet) {
      for (const listener of specificSet) {
        try {
          listener(detail);
        } catch (cause) {
          console.error(`[medbox] Tab ${type} [${tabKey}] listener execution failure`, cause);
        }
      }
    }
  }
}

export function onTabActivated(
  tabKeyOrHandler: string | TabLifecycleHandler,
  maybeHandler?: TabLifecycleHandler,
): () => void {
  if (typeof tabKeyOrHandler === 'function') {
    let set = lifecycleListeners.get('activated');
    if (!set) {
      set = new Set();
      lifecycleListeners.set('activated', set);
    }
    set.add(tabKeyOrHandler);
    return () => set!.delete(tabKeyOrHandler);
  }
  const tabKey = normalizeRoutePath(tabKeyOrHandler);
  const handler = maybeHandler;
  if (!handler) return () => undefined;
  let tabMap = tabSpecificListeners.get(tabKey);
  if (!tabMap) {
    tabMap = new Map();
    tabSpecificListeners.set(tabKey, tabMap);
  }
  let set = tabMap.get('activated');
  if (!set) {
    set = new Set();
    tabMap.set('activated', set);
  }
  set.add(handler);
  return () => set!.delete(handler);
}

export function onTabDeactivated(
  tabKeyOrHandler: string | TabLifecycleHandler,
  maybeHandler?: TabLifecycleHandler,
): () => void {
  if (typeof tabKeyOrHandler === 'function') {
    let set = lifecycleListeners.get('deactivated');
    if (!set) {
      set = new Set();
      lifecycleListeners.set('deactivated', set);
    }
    set.add(tabKeyOrHandler);
    return () => set!.delete(tabKeyOrHandler);
  }
  const tabKey = normalizeRoutePath(tabKeyOrHandler);
  const handler = maybeHandler;
  if (!handler) return () => undefined;
  let tabMap = tabSpecificListeners.get(tabKey);
  if (!tabMap) {
    tabMap = new Map();
    tabSpecificListeners.set(tabKey, tabMap);
  }
  let set = tabMap.get('deactivated');
  if (!set) {
    set = new Set();
    tabMap.set('deactivated', set);
  }
  set.add(handler);
  return () => set!.delete(handler);
}

export function resetTabPoolForTesting(): void {
  for (const entry of tabPool.values()) {
    entry.controller?.abort();
    try {
      entry.cleanup?.();
    } catch {
      /* ignore */
    }
    entry.container.remove();
  }
  tabPool.clear();
  activeTabKey = null;
  if (subpageContainer) {
    subpageContainer.remove();
    subpageContainer = null;
  }
  lifecycleListeners.clear();
  tabSpecificListeners.clear();
}
