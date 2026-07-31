import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

describe('security release configuration', () => {
  it('does not use HTML string injection APIs in application source', () => {
    const files = sourceFiles(join(root, 'src'));
    const offenders = files.filter((file) =>
      /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  // 原先这条契约禁止一切 PWA 痕迹（manifest-src、apple-mobile-web-app-capable、
  // Service Worker），依据是「网页端只是开发预览，装 App 才是正路」。
  // 网页端现在是正式使用场景，且浏览器里除了 Service Worker 没有第二种办法在
  // 页面关掉后弹提醒，所以「不许有 SW」这条前提本身已经不成立。
  //
  // 但当初这条契约真正想挡的风险仍然成立，而且必须继续挡住：**离线缓存壳**。
  // 缓存了应用外壳的 SW 会出现「装了新版还在跑旧版」，在一个吃药 App 上意味着
  // 用户可能按旧的用药规则被提醒，排查还极其困难。
  // 所以断言改成：允许有 SW，但它只能发通知，不许碰 Cache / fetch，
  // 也不许引入会自动生成缓存壳的 VitePWA。
  it('keeps the CSP strict and allows only a notification-only service worker', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8');
    const main = readFileSync(join(root, 'src', 'main.ts'), 'utf8');
    const worker = readFileSync(join(root, 'public', 'sw.js'), 'utf8');

    expect(html).toMatch(/script-src 'self'/);
    expect(html).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(html).toMatch(/object-src 'none'/);
    // SW 与 manifest 都必须限定同源，不能借 default-src 的回退含糊过去
    expect(html).toMatch(/worker-src 'self'/);
    expect(html).toMatch(/manifest-src 'self'/);

    // 不缓存任何东西：没有 fetch 拦截，也不碰 Cache Storage
    expect(worker).not.toMatch(/addEventListener\(\s*['"]fetch['"]/);
    expect(worker).not.toMatch(/\bcaches\b/);
    expect(worker).not.toMatch(/new\s+Response\b/);

    // 也不许由构建插件偷偷生成一个缓存壳
    expect(vite).not.toMatch(/runtimeCaching\s*:/);
    expect(vite).not.toContain('VitePWA');
    expect(main).not.toContain('virtual:pwa-register');
    expect(main).not.toContain('registerSW');
  });

  it('does not retain retired cloud sync, Worker, or Pages deployment paths', () => {
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const environmentTypes = readFileSync(join(root, 'src', 'env.d.ts'), 'utf8');
    const retiredPaths = [
      'worker',
      'wrangler.toml',
      '.env.example',
      '.env.production',
      'src/sync/v2',
      'src/sync/merge.ts',
      'src/sync/syncClient.ts',
      'public/_headers',
      'scripts/deploy-pages.cmd',
    ];

    expect(retiredPaths.filter((path) => existsSync(join(root, ...path.split('/'))))).toEqual([]);
    expect(packageJson.scripts['typecheck:worker']).toBeUndefined();
    expect(packageJson.scripts['worker:dev']).toBeUndefined();
    expect(packageJson.scripts['worker:deploy']).toBeUndefined();
    expect(packageJson.scripts['deploy:pages']).toBeUndefined();
    expect(packageJson.devDependencies['@cloudflare/workers-types']).toBeUndefined();
    expect(packageJson.devDependencies.wrangler).toBeUndefined();
    expect(environmentTypes).not.toContain('VITE_SYNC_V2');
  });

  it('keeps Android health data and secrets out of platform backups', () => {
    const manifest = readFileSync(
      join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
      'utf8',
    );
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:fullBackupContent="false"');
    expect(manifest).toContain('android.permission.POST_NOTIFICATIONS');
    expect(manifest).toContain('android.permission.SCHEDULE_EXACT_ALARM');
  });
});

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (['.ts', '.tsx', '.js', '.mjs'].includes(extname(entry.name))) files.push(path);
  }
  return files;
}
