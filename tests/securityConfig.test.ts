import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

describe('security release configuration', () => {
  it('does not use HTML string injection APIs in application or Worker source', () => {
    const files = [...sourceFiles(join(root, 'src')), ...sourceFiles(join(root, 'worker'))];
    const offenders = files.filter((file) =>
      /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('blocks inline scripts and API caching in both document and hosting headers', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    const headers = readFileSync(join(root, 'public', '_headers'), 'utf8');
    const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8');

    expect(html).toMatch(/script-src 'self'/);
    expect(html).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(html).toMatch(/object-src 'none'/);
    expect(headers).toMatch(/frame-ancestors 'none'/);
    expect(headers).toMatch(/\/api\/\*[\s\S]*Cache-Control: no-store/);
    expect(vite).not.toMatch(/runtimeCaching\s*:/);
    expect(vite).toMatch(/devOptions:\s*\{\s*enabled: false/);
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
