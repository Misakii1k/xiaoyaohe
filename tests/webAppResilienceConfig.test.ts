import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

describe('web app resilience configuration', () => {
  it('declares an installable same-scope manifest with usable icons', () => {
    const manifest = JSON.parse(
      readFileSync(join(root, 'public', 'manifest.webmanifest'), 'utf8'),
    ) as {
      name?: string;
      short_name?: string;
      start_url?: string;
      scope?: string;
      display?: string;
      theme_color?: string;
      background_color?: string;
      icons?: Array<{ src?: string; sizes?: string; type?: string; purpose?: string }>;
    };
    const html = readFileSync(join(root, 'index.html'), 'utf8');

    expect(manifest.name).toBe('小药盒');
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe('./#/today');
    expect(manifest.scope).toBe('./');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain(`<meta name="theme-color" content="${manifest.theme_color}" />`);

    const icons = manifest.icons ?? [];
    expect(icons.some(({ sizes, purpose }) => sizes === '192x192' && purpose === 'any')).toBe(true);
    expect(icons.some(({ sizes, purpose }) => sizes === '512x512' && purpose === 'any')).toBe(true);
    expect(icons.some(({ sizes, purpose }) => sizes === '512x512' && purpose === 'maskable')).toBe(true);
    for (const icon of icons) {
      expect(icon.type).toBe('image/png');
      expect(readPngSize(join(root, 'public', icon.src ?? ''))).toEqual(icon.sizes);
    }
  });

  it('keeps worker and page reminder protocols aligned without an offline cache', () => {
    const worker = readFileSync(join(root, 'public', 'sw.js'), 'utf8');
    const transport = readFileSync(join(root, 'src', 'features', 'webReminderTransport.ts'), 'utf8');
    const messageTypes = [
      'medbox:reminder-plan',
      'medbox:reminder-cancel',
      'medbox:reminder-check',
      'medbox:reminder-drain',
      'medbox:reminder-action',
    ];

    for (const messageType of messageTypes) {
      expect(worker).toContain(messageType);
      expect(transport).toContain(messageType);
    }
    expect(worker).toContain("addEventListener('notificationclick'");
    expect(worker).not.toMatch(/addEventListener\(\s*['"]fetch['"]/);
    expect(worker).not.toMatch(/\bcaches\b/);
  });

  it('keeps honest browser reminder degradation visible in settings', () => {
    const settings = readFileSync(join(root, 'src', 'pages', 'Settings.ts'), 'utf8');

    expect(settings).toContain('当前浏览器发不了用药提醒');
    expect(settings).toContain('需要 https 或本机地址');
    expect(settings).toContain('添加到主屏幕');
    expect(settings).toContain('页面关掉之后');
    expect(settings).toContain('可能晚几十分钟');
    expect(settings).toContain('建议装手机 App');
  });
});

function readPngSize(filePath: string): string {
  const bytes = readFileSync(filePath);
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}
