// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getActiveTab,
  getCachedTabs,
  isKeepAliveTab,
  navigate,
  onTabActivated,
  onTabDeactivated,
  resetRouterForTesting,
  route,
  startRouter,
} from '../src/router';
import {
  getDatabaseRevision,
  notifyDataChanged,
  resetDatabaseRevisionForTesting,
} from '../src/db/local';

interface RouterTestEnv {
  fakeLocation: { hash: string };
  listeners: Map<string, () => Promise<void> | void>;
  root: HTMLElement;
}

function installTestRouterEnv(initialHash = '#/today'): RouterTestEnv {
  const listeners = new Map<string, () => Promise<void> | void>();
  const fakeLocation = { hash: initialHash };
  vi.stubGlobal('location', fakeLocation);
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: () => Promise<void> | void) => {
      listeners.set(type, listener);
    },
    removeEventListener: (type: string) => {
      listeners.delete(type);
    },
    scrollTo: vi.fn(),
    dispatchEvent: (e: Event) => {
      document.dispatchEvent(e);
      return true;
    },
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  const root = document.createElement('div');
  document.body.append(root);
  return { fakeLocation, listeners, root };
}

describe('Tab Keep-Alive / View Caching Architecture', () => {
  beforeEach(() => {
    resetRouterForTesting();
    resetDatabaseRevisionForTesting();
    document.body.replaceChildren();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    resetRouterForTesting();
    resetDatabaseRevisionForTesting();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('identifies the 4 primary tabs and aliases correctly', () => {
    expect(isKeepAliveTab('/today')).toBe(true);
    expect(isKeepAliveTab('/tools')).toBe(true);
    expect(isKeepAliveTab('/meds')).toBe(true);
    expect(isKeepAliveTab('/medications')).toBe(true);
    expect(isKeepAliveTab('/history')).toBe(true);
    expect(isKeepAliveTab('/settings')).toBe(true);

    // Subpages are NOT keep-alive tabs
    expect(isKeepAliveTab('/meds/new')).toBe(false);
    expect(isKeepAliveTab('/meds/123/edit')).toBe(false);
    expect(isKeepAliveTab('/scan')).toBe(false);
    expect(isKeepAliveTab('/meds/inventory')).toBe(false);
  });

  it('preserves tab DOM elements without destroying them when switching between primary tabs', async () => {
    const { fakeLocation, listeners, root } = installTestRouterEnv('#/today');

    let todayRenderCount = 0;
    let medsRenderCount = 0;
    let historyRenderCount = 0;
    let settingsRenderCount = 0;

    route('/today', (_p, tabRoot) => {
      todayRenderCount++;
      const shell = document.createElement('div');
      shell.className = 'app-shell';
      const main = document.createElement('main');
      main.className = 'app-main';
      main.innerHTML = '<h1>今日用药</h1><p class="content">今日内容</p>';
      shell.append(main);
      tabRoot.replaceChildren(shell);
    });

    route('/meds', (_p, tabRoot) => {
      medsRenderCount++;
      const shell = document.createElement('div');
      shell.className = 'app-shell';
      const main = document.createElement('main');
      main.className = 'app-main';
      main.innerHTML = '<h1>药品管理</h1><p class="content">药品列表</p>';
      shell.append(main);
      tabRoot.replaceChildren(shell);
    });

    route('/history', (_p, tabRoot) => {
      historyRenderCount++;
      const shell = document.createElement('div');
      shell.className = 'app-shell';
      const main = document.createElement('main');
      main.className = 'app-main';
      main.innerHTML = '<h1>用药日历</h1><p class="content">打卡历史</p>';
      shell.append(main);
      tabRoot.replaceChildren(shell);
    });

    route('/settings', (_p, tabRoot) => {
      settingsRenderCount++;
      const shell = document.createElement('div');
      shell.className = 'app-shell';
      const main = document.createElement('main');
      main.className = 'app-main';
      main.innerHTML = '<h1>设置中心</h1><p class="content">用户设置</p>';
      shell.append(main);
      tabRoot.replaceChildren(shell);
    });

    // 1. Initial navigation to /today
    startRouter(root, '/today');
    await vi.waitFor(() => expect(todayRenderCount).toBe(1));
    expect(getActiveTab()).toBe('/today');
    expect(getCachedTabs()).toEqual(['/today']);

    const todayContainer = root.querySelector<HTMLElement>('[data-tab-route="/today"]');
    expect(todayContainer).not.toBeNull();
    expect(todayContainer?.hidden).toBe(false);
    expect(todayContainer?.querySelector('h1')?.textContent).toBe('今日用药');

    // 2. Switch to /meds
    fakeLocation.hash = '#/meds';
    await listeners.get('hashchange')?.();
    await vi.waitFor(() => expect(medsRenderCount).toBe(1));
    expect(getActiveTab()).toBe('/meds');
    expect(getCachedTabs()).toContain('/today');
    expect(getCachedTabs()).toContain('/meds');

    const medsContainer = root.querySelector<HTMLElement>('[data-tab-route="/meds"]');
    expect(medsContainer).not.toBeNull();
    expect(medsContainer?.hidden).toBe(false);
    // /today container is still in the DOM, but hidden!
    expect(todayContainer?.hidden).toBe(true);
    expect(todayContainer?.style.display).toBe('none');

    // 3. Switch to /history
    fakeLocation.hash = '#/history';
    await listeners.get('hashchange')?.();
    await vi.waitFor(() => expect(historyRenderCount).toBe(1));
    expect(getActiveTab()).toBe('/history');

    // 4. Switch to /settings
    fakeLocation.hash = '#/settings';
    await listeners.get('hashchange')?.();
    await vi.waitFor(() => expect(settingsRenderCount).toBe(1));
    expect(getActiveTab()).toBe('/settings');

    // 5. Navigate back to /today
    fakeLocation.hash = '#/today';
    await listeners.get('hashchange')?.();
    // /today was NOT re-rendered! Render count remains 1!
    expect(todayRenderCount).toBe(1);
    expect(getActiveTab()).toBe('/today');

    // Verify the EXACT same DOM node is reused
    const currentTodayContainer = root.querySelector<HTMLElement>('[data-tab-route="/today"]');
    expect(currentTodayContainer).toBe(todayContainer);
    expect(currentTodayContainer?.hidden).toBe(false);
    expect(currentTodayContainer?.querySelector('.content')?.textContent).toBe('今日内容');

    // 6. Navigate back to /meds
    fakeLocation.hash = '#/meds';
    await listeners.get('hashchange')?.();
    expect(medsRenderCount).toBe(1);
    expect(root.querySelector<HTMLElement>('[data-tab-route="/meds"]')).toBe(medsContainer);
    expect(medsContainer?.hidden).toBe(false);
  });

  it('preserves and restores scrollTop for each tab container independently', async () => {
    const { fakeLocation, listeners, root } = installTestRouterEnv('#/today');

    route('/today', (_p, tabRoot) => {
      const shell = document.createElement('div');
      shell.className = 'app-shell';
      const main = document.createElement('main');
      main.className = 'app-main';
      main.innerHTML = '<h1>今天</h1><div style="height: 2000px;">Today tall list</div>';
      shell.append(main);
      tabRoot.replaceChildren(shell);
    });

    route('/meds', (_p, tabRoot) => {
      const shell = document.createElement('div');
      shell.className = 'app-shell';
      const main = document.createElement('main');
      main.className = 'app-main';
      main.innerHTML = '<h1>药品</h1><div style="height: 3000px;">Meds tall list</div>';
      shell.append(main);
      tabRoot.replaceChildren(shell);
    });

    startRouter(root, '/today');
    await vi.waitFor(() => expect(root.querySelector('[data-tab-route="/today"]')).not.toBeNull());

    const todayMain = root.querySelector<HTMLElement>('[data-tab-route="/today"] .app-main')!;
    todayMain.scrollTop = 420;

    // Switch to /meds
    fakeLocation.hash = '#/meds';
    await listeners.get('hashchange')?.();
    await vi.waitFor(() => expect(root.querySelector('[data-tab-route="/meds"]')).not.toBeNull());

    const medsMain = root.querySelector<HTMLElement>('[data-tab-route="/meds"] .app-main')!;
    medsMain.scrollTop = 880;

    // Switch back to /today
    fakeLocation.hash = '#/today';
    await listeners.get('hashchange')?.();

    // todayMain scrollTop must be restored to 420!
    expect(todayMain.scrollTop).toBe(420);

    // Switch back to /meds
    fakeLocation.hash = '#/meds';
    await listeners.get('hashchange')?.();

    // medsMain scrollTop must be restored to 880!
    expect(medsMain.scrollTop).toBe(880);
  });

  it('renders subpages in dedicated subpage container while preserving tab in pool, and restores on return', async () => {
    const { fakeLocation, listeners, root } = installTestRouterEnv('#/meds');

    let medsRenderCount = 0;
    let subpageRenderCount = 0;
    let subpageCleanedUp = false;

    route('/meds', (_p, tabRoot) => {
      medsRenderCount++;
      const shell = document.createElement('div');
      shell.className = 'app-shell';
      const main = document.createElement('main');
      main.className = 'app-main';
      main.innerHTML = '<h1>药品列表</h1>';
      shell.append(main);
      tabRoot.replaceChildren(shell);
    });

    route('/meds/new', (_p, subRoot) => {
      subpageRenderCount++;
      const form = document.createElement('form');
      form.innerHTML = '<h1>新增药品</h1><input id="med-name" value="阿莫西林" />';
      subRoot.replaceChildren(form);
      return () => {
        subpageCleanedUp = true;
      };
    });

    startRouter(root, '/meds');
    await vi.waitFor(() => expect(medsRenderCount).toBe(1));

    const medsContainer = root.querySelector<HTMLElement>('[data-tab-route="/meds"]')!;
    const medsMain = medsContainer.querySelector<HTMLElement>('.app-main')!;
    medsMain.scrollTop = 250;

    // 1. Navigate to subpage /meds/new
    fakeLocation.hash = '#/meds/new';
    await listeners.get('hashchange')?.();
    await vi.waitFor(() => expect(subpageRenderCount).toBe(1));

    // medsContainer is preserved but hidden
    expect(medsContainer.hidden).toBe(true);
    expect(getActiveTab()).toBeNull();

    // Subpage container is active
    const subpageContainer = root.querySelector<HTMLElement>('.tab-keepalive-subpage');
    expect(subpageContainer).not.toBeNull();
    expect(subpageContainer?.hidden).toBe(false);
    expect(subpageContainer?.querySelector('h1')?.textContent).toBe('新增药品');

    // 2. Return from subpage back to /meds
    fakeLocation.hash = '#/meds';
    await listeners.get('hashchange')?.();

    // Subpage cleanup was executed and subpage hidden
    expect(subpageCleanedUp).toBe(true);
    expect(subpageContainer?.hidden).toBe(true);
    expect(subpageContainer?.children.length).toBe(0);

    // Preserved /meds tab restored without rebuilding!
    expect(medsRenderCount).toBe(1);
    expect(medsContainer.hidden).toBe(false);
    expect(medsMain.scrollTop).toBe(250);
    expect(getActiveTab()).toBe('/meds');
  });

  it('dispatches tab:activated and tab:deactivated lifecycle events and invokes registered handlers', async () => {
    const { fakeLocation, listeners, root } = installTestRouterEnv('#/today');

    const activatedEvents: Array<{ tab: string; prev?: string | null }> = [];
    const deactivatedEvents: Array<{ tab: string; next?: string | null }> = [];

    const unregAct = onTabActivated((detail) => {
      activatedEvents.push({ tab: detail.tab, prev: detail.previousTab });
    });
    const unregDeact = onTabDeactivated((detail) => {
      deactivatedEvents.push({ tab: detail.tab, next: detail.nextTab });
    });

    let todayCustomActCount = 0;
    const unregTodayAct = onTabActivated('/today', () => {
      todayCustomActCount++;
    });

    route('/today', (_p, tabRoot) => {
      tabRoot.innerHTML = '<h1>今天</h1>';
    });
    route('/settings', (_p, tabRoot) => {
      tabRoot.innerHTML = '<h1>我的</h1>';
    });

    startRouter(root, '/today');
    await vi.waitFor(() => expect(activatedEvents.length).toBe(1));

    expect(activatedEvents[0]).toEqual({ tab: '/today', prev: null });
    expect(todayCustomActCount).toBe(1);

    // Switch to /settings
    fakeLocation.hash = '#/settings';
    await listeners.get('hashchange')?.();

    expect(deactivatedEvents.length).toBe(1);
    expect(deactivatedEvents[0]).toEqual({ tab: '/today', next: '/settings' });

    expect(activatedEvents.length).toBe(2);
    expect(activatedEvents[1]).toEqual({ tab: '/settings', prev: '/today' });

    // Switch back to /today
    fakeLocation.hash = '#/today';
    await listeners.get('hashchange')?.();

    expect(deactivatedEvents.length).toBe(2);
    expect(deactivatedEvents[1]).toEqual({ tab: '/settings', next: '/today' });

    expect(activatedEvents.length).toBe(3);
    expect(activatedEvents[2]).toEqual({ tab: '/today', prev: '/settings' });
    expect(todayCustomActCount).toBe(2);

    unregAct();
    unregDeact();
    unregTodayAct();
  });

  it('smoothly scrolls to top and re-activates when tapping the current tab', async () => {
    const { fakeLocation, root } = installTestRouterEnv('#/today');

    let activatedCount = 0;
    onTabActivated('/today', () => {
      activatedCount++;
    });

    route('/today', (_p, tabRoot) => {
      const shell = document.createElement('div');
      shell.className = 'app-shell';
      const main = document.createElement('main');
      main.className = 'app-main';
      main.innerHTML = '<h1>今天</h1>';
      shell.append(main);
      tabRoot.replaceChildren(shell);
    });

    startRouter(root, '/today');
    await vi.waitFor(() => expect(activatedCount).toBe(1));

    const main = root.querySelector<HTMLElement>('.app-main')!;
    main.scrollTop = 600;

    // Navigate to current tab again
    navigate('/today');
    expect(activatedCount).toBe(2);
    expect(main.scrollTop).toBe(0);
  });

  it('notifies on database mutations and increments revision', () => {
    const rev0 = getDatabaseRevision();
    expect(rev0).toBe(1);

    let observedScope = '';
    const unbind = notifyDataChanged;

    window.addEventListener('medbox:data-changed', ((e: CustomEvent) => {
      observedScope = e.detail.scope;
    }) as EventListener);

    notifyDataChanged('meds');
    expect(getDatabaseRevision()).toBe(2);
    expect(observedScope).toBe('meds');

    notifyDataChanged('logs');
    expect(getDatabaseRevision()).toBe(3);
    expect(observedScope).toBe('logs');
  });

  it('resets all tab containers and state on resetRouterForTesting', async () => {
    const { root } = installTestRouterEnv('#/today');

    route('/today', (_p, tabRoot) => {
      tabRoot.innerHTML = '<h1>今天</h1>';
    });

    startRouter(root, '/today');
    await vi.waitFor(() => expect(root.querySelector('[data-tab-route="/today"]')).not.toBeNull());

    expect(getCachedTabs()).toEqual(['/today']);
    expect(root.children.length).toBe(1);

    resetRouterForTesting();

    expect(getCachedTabs()).toEqual([]);
    expect(getActiveTab()).toBeNull();
    expect(root.children.length).toBe(0);
  });
});
