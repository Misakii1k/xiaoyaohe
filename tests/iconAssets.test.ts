import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const iconDirectory = join(root, 'public', 'icons');

describe('application icon assets', () => {
  it('keeps generated assets synchronized with the canonical master', () => {
    const result = spawnSync(process.execPath, [join(root, 'scripts', 'gen-icons.mjs'), '--check'], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it('uses dedicated favicon and Apple touch assets', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    expect(html).toContain('href="/icons/favicon.png"');
    expect(html).toContain('sizes="64x64"');
    expect(html).toContain('href="/icons/apple-touch-icon.png"');
    expect(html).toContain('sizes="180x180"');
  });

  it('separates regular and maskable PWA icons', async () => {
    const manifest = JSON.parse(
      readFileSync(join(root, 'public', 'manifest.webmanifest'), 'utf8'),
    ) as { icons: Array<{ src: string; sizes: string; purpose: string }> };

    expect(manifest.icons).toEqual([
      {
        src: 'icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: 'icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: 'icons/icon-192-full.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: 'icons/icon-512-full.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ]);

    expect(await isOpaque(join(iconDirectory, 'icon-512.png'))).toBe(false);
    expect(await isOpaque(join(iconDirectory, 'icon-512-full.png'))).toBe(true);
    expect(await isOpaque(join(iconDirectory, 'apple-touch-icon.png'))).toBe(true);
  });

  it('provides every Android launcher density', async () => {
    const sizes = {
      mdpi: 48,
      hdpi: 72,
      xhdpi: 96,
      xxhdpi: 144,
      xxxhdpi: 192,
    };
    const resourceRoot = join(root, 'android', 'app', 'src', 'main', 'res');

    for (const [density, size] of Object.entries(sizes)) {
      const directory = join(resourceRoot, `mipmap-${density}`);
      await expectDimensions(join(directory, 'ic_launcher.png'), size, size);
      await expectDimensions(join(directory, 'ic_launcher_round.png'), size, size);

      const foregroundPath = join(directory, 'ic_launcher_foreground.png');
      const foregroundSize = size * 2.25;
      await expectDimensions(foregroundPath, foregroundSize, foregroundSize);
      expect(await isTransparentOutsideSafeArea(foregroundPath, foregroundSize / 6)).toBe(true);
    }

    for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
      const adaptiveIcon = readFileSync(
        join(resourceRoot, 'mipmap-anydpi-v26', name),
        'utf8',
      );
      expect(adaptiveIcon).toContain('@drawable/ic_launcher_background');
      expect(adaptiveIcon).toContain('@mipmap/ic_launcher_foreground');
      expect(adaptiveIcon).not.toContain('@color/ic_launcher_background');
    }

    const foregroundAlias = readFileSync(
      join(resourceRoot, 'drawable-v24', 'ic_launcher_foreground.xml'),
      'utf8',
    );
    expect(foregroundAlias).toContain('@mipmap/ic_launcher_foreground');
    expect(foregroundAlias).not.toContain('pathData');
  });
});

async function expectDimensions(path: string, width: number, height: number) {
  const metadata = await sharp(path).metadata();
  expect([metadata.width, metadata.height], path).toEqual([width, height]);
}

async function isOpaque(path: string): Promise<boolean> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let offset = info.channels - 1; offset < data.length; offset += info.channels) {
    if (data[offset] !== 255) return false;
  }
  return true;
}

async function isTransparentOutsideSafeArea(path: string, inset: number): Promise<boolean> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const safeStart = Math.floor(inset);
  const safeEndX = info.width - safeStart;
  const safeEndY = info.height - safeStart;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (x >= safeStart && x < safeEndX && y >= safeStart && y < safeEndY) continue;
      const alpha = data[(y * info.width + x) * info.channels + info.channels - 1];
      if (alpha !== 0) return false;
    }
  }
  return true;
}
