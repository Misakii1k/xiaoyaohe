import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildVersionManifest, readApkManifest } from '../scripts/gen-version.mjs';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const apkName = `xiaoyaohe-${pkg.version}-android-release.apk`;

describe('版本元数据与发布产物一致', () => {
  it('downloadUrl 指向同源代理，而不是私有仓库直链', () => {
    const manifest = buildVersionManifest({
      version: '9.9.9',
      versionCode: 99,
      releaseDate: '2026-01-01',
      releaseNotes: 'x',
      apk: null,
    });
    expect(manifest.downloadUrl).toBe('/api/download?tag=v9.9.9');
    expect(manifest.downloadUrl).not.toContain('github.com');
    // 没有产物就不许编造数字（旧的硬编码 16398223 与真实 32,095,374 字节不符）
    expect(manifest).not.toHaveProperty('fileSize');
    expect(manifest).not.toHaveProperty('sha256');
  });

  it('本地存在正式 APK 时，字节数与 SHA256 与 release/SHA256SUMS 一致', () => {
    const apk = readApkManifest(root, pkg.version);
    if (!apk) return; // CI 无产物：gen-version 只警告，不写字段
    expect(apk.size).toBe(statSync(apk.path).size);
    expect(apk.sha256).toMatch(/^[0-9a-f]{64}$/);

    const sumsFile = join(root, 'release', 'SHA256SUMS');
    if (!existsSync(sumsFile)) return;
    const line = readFileSync(sumsFile, 'utf8')
      .split(/\r?\n/)
      .find((entry) => entry.includes(apkName));
    if (line) expect(line.trim().split(/\s+/)[0]).toBe(apk.sha256);
  });

  it('已生成的 public/version.json 与当前版本、当前产物一致', () => {
    const file = join(root, 'public', 'version.json');
    if (!existsSync(file)) return;
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.downloadUrl).toBe(`/api/download?tag=v${pkg.version}`);

    const apk = readApkManifest(root, pkg.version);
    if (!apk) return;
    expect(manifest.fileSize).toBe(apk.size);
    expect(manifest.sha256).toBe(apk.sha256);
  });
});
