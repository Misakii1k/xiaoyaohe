#!/usr/bin/env node
/**
 * 前端 Web 增量热更新资源包归档脚本。
 *
 * 将 dist/ 下的前端静态资源归档压缩为 release/xiaoyaohe-${version}-web-bundle.zip，
 * 计算其 SHA-256 校验摘要并写入 release/。
 *
 * 用法：
 *   node scripts/bundle-web.mjs
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, 'dist');
const releaseDir = resolve(root, 'release');

export function createWebBundle(options = {}) {
  const pkgPath = resolve(root, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const version = options.version || pkg.version;

  if (!existsSync(distDir) || !existsSync(resolve(distDir, 'index.html'))) {
    throw new Error('dist/index.html 不存在，请先运行 npm run build:web');
  }

  if (!existsSync(releaseDir)) {
    mkdirSync(releaseDir, { recursive: true });
  }

  const bundleName = `xiaoyaohe-${version}-web-bundle.zip`;
  const bundlePath = resolve(releaseDir, bundleName);

  // 优先尝试 tar.exe / tar（Windows 10/11 与现代 Linux/macOS 均内建，速度快）
  let success = false;
  let errorMsg = '';

  const tarCmd = process.platform === 'win32' ? 'tar.exe' : 'tar';
  const tarRes = spawnSync(tarCmd, ['-a', '-c', '-f', bundlePath, '-C', distDir, '.'], {
    stdio: 'pipe',
  });

  if (tarRes.status === 0 && existsSync(bundlePath)) {
    success = true;
  } else {
    errorMsg = tarRes.stderr?.toString() || 'tar 执行失败';
  }

  // Windows 兜底：PowerShell Compress-Archive
  if (!success && process.platform === 'win32') {
    const psCmd = `Compress-Archive -Path '${distDir}/*' -DestinationPath '${bundlePath}' -Force`;
    const psRes = spawnSync('powershell', ['-NoProfile', '-Command', psCmd], { stdio: 'pipe' });
    if (psRes.status === 0 && existsSync(bundlePath)) {
      success = true;
    } else {
      errorMsg += '; ' + (psRes.stderr?.toString() || 'PowerShell Compress-Archive 执行失败');
    }
  }

  if (!success) {
    throw new Error(`无法创建 Web 增量包: ${errorMsg}`);
  }

  const stat = statSync(bundlePath);
  const buffer = readFileSync(bundlePath);
  const sha256 = createHash('sha256').update(buffer).digest('hex').toLowerCase();

  const checksumLine = `${sha256}  ${bundleName}\n`;
  const checksumFile = resolve(releaseDir, `xiaoyaohe-${version}-web-bundle-SHA256SUMS.txt`);
  writeFileSync(checksumFile, checksumLine, 'utf8');

  console.log(`[bundle-web] v${version} -> ${bundleName} (${stat.size} bytes, sha256: ${sha256})`);

  return {
    bundleName,
    bundlePath,
    bundleSize: stat.size,
    bundleSha256: sha256,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    createWebBundle();
  } catch (err) {
    console.error(`[bundle-web] 失败: ${err.message}`);
    process.exit(1);
  }
}
