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

  it('keeps the embedded WebView CSP strict without registering a PWA service worker', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8');
    const main = readFileSync(join(root, 'src', 'main.ts'), 'utf8');

    expect(html).toMatch(/script-src 'self'/);
    expect(html).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(html).toMatch(/object-src 'none'/);
    expect(html).not.toContain('manifest-src');
    expect(html).not.toContain('apple-mobile-web-app-capable');
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
