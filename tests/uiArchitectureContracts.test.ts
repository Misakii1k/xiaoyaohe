import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const source = (path: string) => readFileSync(join(root, path), 'utf8');

describe('0.7.0 UI architecture contracts', () => {
  it('centralizes Capacitor and browser safe-area values in design tokens', () => {
    expect(existsSync(join(root, 'src/ui/styles/tokens.css'))).toBe(true);
    const tokens = source('src/ui/styles/tokens.css');
    expect(tokens).toContain('--safe-top: max(env(safe-area-inset-top, 0px), var(--safe-area-inset-top, 0px))');
    expect(tokens).toContain('--safe-bottom: max(env(safe-area-inset-bottom, 0px), var(--safe-area-inset-bottom, 0px))');
  });

  it('loads styles from modular token, shell, primitive, and page layers', () => {
    const entry = source('src/ui/styles.css');
    expect(entry).toContain("@import './styles/tokens.css'");
    expect(entry).toContain("@import './styles/shell.css'");
    expect(entry).toContain("@import './styles/primitives.css'");
    expect(entry).toContain("@import './styles/pages/medications.css'");
  });

  it('uses the application shell instead of page-owned top and bottom bars', () => {
    expect(existsSync(join(root, 'src/app/AppShell.ts'))).toBe(true);
    const shell = source('src/app/AppShell.ts');
    expect(shell).toContain('app-shell');
    expect(shell).toContain('app-main');
    expect(shell).toContain('action-dock');
    expect(shell).toContain('app-navigation');
  });

  it('configures Android edge-to-edge system bars through Capacitor CSS insets', () => {
    const config = source('capacitor.config.ts');
    expect(config).toContain("insetsHandling: 'css'");
    expect(config).toContain("style: 'LIGHT'");
    expect(source('android/app/src/main/res/values/styles.xml')).toContain('windowLightStatusBar');
  });

  it('declares the five fixed primary navigation destinations in one module', () => {
    expect(existsSync(join(root, 'src/app/navigation.ts'))).toBe(true);
    const navigation = source('src/app/navigation.ts');
    for (const label of ['今日', '药品', '分药', '库存', '设置']) {
      expect(navigation).toContain(label);
    }
    expect(navigation).not.toContain("id: 'work'");
    expect(navigation).toContain("id: 'inventory'");
    expect(navigation).toContain("href: '/meds/inventory'");
    expect(navigation).toContain("icon: 'box'");

    const inventory = source('src/pages/MedInventory.ts');
    expect(inventory).toContain("activeTab: 'inventory'");
    expect(inventory).not.toContain("label: '返回药品'");
    expect(existsSync(join(root, 'src/pages/WorkLog.ts'))).toBe(false);
    expect(existsSync(join(root, 'src/db/work.ts'))).toBe(false);
  });

  it('uses a centralized icon registry rather than hand-drawn functional icon paths', () => {
    expect(existsSync(join(root, 'src/ui/icons/iconRegistry.ts'))).toBe(true);
    const registry = source('src/ui/icons/iconRegistry.ts');
    // 图标以 SVG 字符串形式集中注册，避免在组件里内联手写 path
    expect(registry).toMatch(/\.svg\?raw['"]/);
    expect(source('src/ui/components.ts')).toContain("from './icons/Icon'");
  });

  it('renders the initial route before asynchronous secure-storage initialization', () => {
    const main = source('src/main.ts');
    const routerStart = main.indexOf("startRouter(root, '/today');");
    const retiredStorageCleanup = main.indexOf('void Promise.all([');
    const secretInitialization = main.indexOf('.then(() => initializeLlmSecretStore())');

    expect(routerStart).toBeGreaterThan(-1);
    expect(retiredStorageCleanup).toBeGreaterThan(routerStart);
    expect(secretInitialization).toBeGreaterThan(retiredStorageCleanup);
    expect(main).toContain('cleanupRetiredCloudSyncStorage()');
    expect(main).toContain('cleanupRetiredWorkStorage()');
    expect(main).not.toMatch(/await initializeLlmSecretStore\(\)/);
    expect(main).toContain('.catch(() => undefined)');
    expect(main).toContain('.then(() => silentHealthCheck())');
  });

  it('renders snackbar messages as text so user and peer names cannot inject markup', () => {
    const components = source('src/ui/components.ts');
    const toastSource = components.slice(
      components.indexOf('export function toast'),
      components.indexOf('/** ---------- Modal Dialog'),
    );
    expect(toastSource).toContain("{ class: 'toast', text: msg }");
    expect(toastSource).not.toContain('html: msg');
  });

  it('does not replay legacy entrance motion when the application shell rerenders', () => {
    const primitives = source('src/ui/styles/primitives.css');

    expect(primitives).toMatch(/\.app-shell \.list-item,[\s\S]*?animation: none;/);
    expect(primitives).toContain('.app-shell .tabbar a.active .ic');
    expect(primitives).toContain('.app-shell .nlu-box::before');
  });

  it('keeps wide-screen content out of the action-dock grid row', () => {
    const shell = source('src/ui/styles/shell.css');

    expect(shell).toMatch(/\.app-main \{ grid-column: 2; grid-row: 2; \}/);
    expect(shell).not.toContain('grid-row: 2 / span 2');
  });
});
