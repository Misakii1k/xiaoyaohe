import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createReleaseCommands,
  parseReleaseArgs,
  requiresCommandShell,
  resolveReleaseCommand,
} from '../scripts/release.mjs';
import {
  createZipBuffer,
  parseAndroidVersions,
  publishReleaseArtifacts,
  readZipEntries,
  sha256,
  validateReleaseVersions,
  verifyApkWebAssets,
} from '../scripts/lib/release-utils.mjs';

const temporaryDirectories: string[] = [];

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'medbox-release-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('release version validation', () => {
  it('accepts the documented package and Android version mapping', () => {
    expect(
      validateReleaseVersions({
        packageVersion: '0.7.0',
        lockVersion: '0.7.0',
        androidVersionName: '0.7.0',
        androidVersionCode: 7,
      }),
    ).toEqual({ version: '0.7.0', versionCode: 7 });

    expect(
      validateReleaseVersions({
        packageVersion: '0.8.0',
        lockVersion: '0.8.0',
        androidVersionName: '0.8.0',
        androidVersionCode: 16,
      }),
    ).toEqual({ version: '0.8.0', versionCode: 16 });

    expect(
      validateReleaseVersions({
        packageVersion: '0.9.0',
        lockVersion: '0.9.0',
        androidVersionName: '0.9.0',
        androidVersionCode: 19,
      }),
    ).toEqual({ version: '0.9.0', versionCode: 19 });
  });

  it('rejects stale Android and lockfile versions', () => {
    expect(() =>
      validateReleaseVersions({
        packageVersion: '0.4.1',
        lockVersion: '0.4.0',
        androidVersionName: '0.4.0',
        androidVersionCode: 3,
      }),
    ).toThrow(/package-lock\.json version 0\.4\.0/);

    expect(() =>
      validateReleaseVersions({
        packageVersion: '0.6.0',
        lockVersion: '0.6.0',
        androidVersionName: '0.5.0',
        androidVersionCode: 5,
      }),
    ).toThrow(/versionName 0\.5\.0/);
  });

  it('parses both Gradle assignment styles', () => {
    expect(parseAndroidVersions('versionCode 4\nversionName "0.4.1"')).toEqual({
      versionCode: 4,
      versionName: '0.4.1',
    });
    expect(parseAndroidVersions("versionCode = 6\nversionName = '0.6.0'")).toEqual({
      versionCode: 6,
      versionName: '0.6.0',
    });
  });
});

describe('ZIP and APK asset verification', () => {
  it('creates a standards-compatible archive that its verifier can read', () => {
    const archive = createZipBuffer([
      { name: 'index.html', data: Buffer.from('<h1>toolbox</h1>') },
      { name: 'assets/中文.txt', data: Buffer.from('same content '.repeat(20)) },
      { name: 'empty.txt', data: Buffer.alloc(0) },
    ]);
    const entries = readZipEntries(archive);

    expect(entries.get('index.html')?.toString()).toBe('<h1>toolbox</h1>');
    expect(entries.get('assets/中文.txt')?.toString()).toBe('same content '.repeat(20));
    expect(entries.get('empty.txt')).toEqual(Buffer.alloc(0));
  });

  it('accepts byte-identical dist resources and Capacitor bridge extras', () => {
    const root = temporaryDirectory();
    const dist = join(root, 'dist');
    mkdirSync(join(dist, 'assets'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), '<main>current</main>');
    writeFileSync(join(dist, 'assets', 'app.js'), 'console.log("current")');
    const apk = join(root, 'app.apk');
    writeFileSync(
      apk,
      createZipBuffer([
        { name: 'assets/public/index.html', data: readFileSync(join(dist, 'index.html')) },
        { name: 'assets/public/assets/app.js', data: readFileSync(join(dist, 'assets', 'app.js')) },
        { name: 'assets/public/cordova.js', data: Buffer.alloc(0) },
        { name: 'AndroidManifest.xml', data: Buffer.from('binary manifest') },
      ]),
    );

    expect(verifyApkWebAssets(dist, apk)).toMatchObject({ fileCount: 2 });
  });

  it('rejects stale and unexpected APK web resources', () => {
    const root = temporaryDirectory();
    const dist = join(root, 'dist');
    mkdirSync(dist);
    writeFileSync(join(dist, 'index.html'), 'current');

    const staleApk = join(root, 'stale.apk');
    writeFileSync(
      staleApk,
      createZipBuffer([{ name: 'assets/public/index.html', data: Buffer.from('old') }]),
    );
    expect(() => verifyApkWebAssets(dist, staleApk)).toThrow(/stale or modified/);

    const extraApk = join(root, 'extra.apk');
    writeFileSync(
      extraApk,
      createZipBuffer([
        { name: 'assets/public/index.html', data: Buffer.from('current') },
        { name: 'assets/public/assets/old.js', data: Buffer.from('old') },
      ]),
    );
    expect(() => verifyApkWebAssets(dist, extraApk)).toThrow(/unexpected web resources/);
  });

  it('publishes only the versioned Android artifact and its SHA-256 manifest', () => {
    const root = temporaryDirectory();
    const dist = join(root, 'dist');
    mkdirSync(dist);
    writeFileSync(join(dist, 'index.html'), 'release payload');
    const apk = join(root, 'app-debug.apk');
    writeFileSync(
      apk,
      createZipBuffer([
        { name: 'assets/public/index.html', data: Buffer.from('release payload') },
        { name: 'assets/public/cordova.js', data: Buffer.alloc(0) },
      ]),
    );
    const obsoleteWebArchive = join(root, 'release', 'xiaoyaohe-0.8.0-web.zip');
    mkdirSync(join(root, 'release'), { recursive: true });
    writeFileSync(obsoleteWebArchive, 'stale web product');

    const result = publishReleaseArtifacts({
      root,
      releaseConfig: { name: 'xiaoyaohe', version: '0.8.0', versionCode: 16 },
      variant: 'debug',
      apkFile: apk,
    });

    expect(result).not.toHaveProperty('webArchive');
    expect(basename(result.androidArtifact)).toBe('xiaoyaohe-0.8.0-android-debug.apk');
    expect(existsSync(obsoleteWebArchive)).toBe(false);
    const manifest = readFileSync(result.checksumFile, 'utf8');
    expect(manifest).toBe(
      `${sha256(readFileSync(result.androidArtifact))}  xiaoyaohe-0.8.0-android-debug.apk\n`,
    );
  });
});

describe('release command orchestration', () => {
  it('uses a direct cmd.exe wrapper only for Windows command-wrapper executables', () => {
    expect(requiresCommandShell('npm.cmd', 'win32')).toBe(true);
    expect(requiresCommandShell('gradlew.bat', 'win32')).toBe(true);
    expect(requiresCommandShell('npm', 'win32')).toBe(false);
    expect(requiresCommandShell('npm.cmd', 'linux')).toBe(false);

    expect(resolveReleaseCommand(
      { command: 'npm.cmd', args: ['audit', '--audit-level=low'] },
      'win32',
      'cmd.exe',
    )).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm.cmd audit --audit-level=low'],
    });
    expect(resolveReleaseCommand(
      { command: 'npm', args: ['test'] },
      'linux',
      'cmd.exe',
    )).toEqual({ command: 'npm', args: ['test'] });
  });

  it('supports local skip-install and variant selection without dropping release gates', () => {
    const options = parseReleaseArgs(['--skip-install', '--android-variant', 'release']);
    expect(options).toMatchObject({ skipInstall: true, variant: 'release' });

    const commands = createReleaseCommands(options);
    expect(commands.map((command) => command.label)).toEqual([
      'Audit all dependencies',
      'Type-check frontend',
      'Run Vitest suite',
      'Install Playwright Chromium',
      'Run Playwright visual matrix',
      'Build Android WebView assets',
      'Sync Capacitor Android project',
      'Run Android unit tests and assemble APK',
      'Run Android instrumentation tests',
    ]);
    expect(commands[0]?.args).toEqual(['audit', '--audit-level=low']);
    expect(commands.at(-2)?.args).toEqual(['testReleaseUnitTest', 'assembleRelease']);
    expect(commands.at(-1)?.args).toEqual(['connectedReleaseAndroidTest']);

    expect(commands.map((command) => command.label)).toContain('Run Android instrumentation tests');
  });

  it('rejects unknown or unsafe command-line input', () => {
    expect(() => parseReleaseArgs(['--unknown'])).toThrow(/Unknown release option/);
    expect(() => parseReleaseArgs(['--skip-connected-tests'])).toThrow(/Unknown release option/);
    expect(() => parseReleaseArgs(['--android-variant', '../debug'])).toThrow(/Invalid Android variant/);
  });
});

describe('Android-only distribution contract', () => {
  const root = join(import.meta.dirname, '..');

  it('keeps Vite for WebView assets without shipping a PWA product path', () => {
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8');
    const tsconfig = readFileSync(join(root, 'tsconfig.json'), 'utf8');
    const main = readFileSync(join(root, 'src', 'main.ts'), 'utf8');
    const capacitor = readFileSync(join(root, 'capacitor.config.ts'), 'utf8');
    const androidStrings = readFileSync(join(root, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml'), 'utf8');

    expect(packageJson).toMatchObject({
      name: 'xiaoyaohe',
      version: '0.9.0',
      description: expect.stringContaining('Android App'),
      dependencies: { qrcode: expect.any(String) },
      devDependencies: { '@types/qrcode': expect.any(String) },
    });
    expect(capacitor).toContain("appId: 'com.medbox.app'");
    expect(capacitor).toContain("appName: '小药盒'");
    expect(androidStrings).toContain('<string name="app_name">小药盒</string>');
    expect(packageJson.scripts.package).toBeUndefined();
    expect(packageJson.scripts['deploy:pages']).toBeUndefined();
    expect(packageJson.scripts['typecheck:worker']).toBeUndefined();
    expect(packageJson.scripts['worker:dev']).toBeUndefined();
    expect(packageJson.scripts['worker:deploy']).toBeUndefined();
    expect(packageJson.devDependencies['vite-plugin-pwa']).toBeUndefined();
    expect(packageJson.devDependencies['@cloudflare/workers-types']).toBeUndefined();
    expect(packageJson.devDependencies.wrangler).toBeUndefined();
    expect(existsSync(join(root, 'scripts', 'package-dist.mjs'))).toBe(false);
    expect(existsSync(join(root, 'scripts', 'deploy-pages.cmd'))).toBe(false);
    expect(existsSync(join(root, 'public', '_headers'))).toBe(false);
    expect(existsSync(join(root, 'worker'))).toBe(false);
    expect(existsSync(join(root, 'wrangler.toml'))).toBe(false);
    expect(existsSync(join(root, '.env.example'))).toBe(false);
    expect(existsSync(join(root, '.env.production'))).toBe(false);
    expect(existsSync(join(root, 'src', 'sync', 'v2'))).toBe(false);
    expect(existsSync(join(root, 'src', 'sync', 'merge.ts'))).toBe(false);
    expect(existsSync(join(root, 'src', 'sync', 'syncClient.ts'))).toBe(false);
    expect(vite).not.toContain('VitePWA');
    expect(vite).not.toContain('manifest:');
    expect(tsconfig).not.toContain('vite-plugin-pwa/client');
    expect(main).not.toContain('virtual:pwa-register');
    expect(main).not.toContain('registerSW');
    // LAN 家庭同步的 startAutoSync 属于本机能力，允许挂在 main 启动路径上
    expect(main).toContain('startAutoSync');
  });
});
