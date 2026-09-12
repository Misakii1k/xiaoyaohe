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

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectDirectoryEntries, createZipBuffer } from './lib/release-utils.mjs';

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

  // 使用跨平台完全确定性 (Reproducible) 纯 Node.js Zip 归档器：
  // 固定时间戳、归一化路径、Deflate 9 压缩，杜绝不同操作系统/tar 工具产生的哈希漂移
  const entries = collectDirectoryEntries(distDir);
  const zipBuffer = createZipBuffer(entries);
  writeFileSync(bundlePath, zipBuffer);

  const sha256 = createHash('sha256').update(zipBuffer).digest('hex').toLowerCase();

  const checksumLine = `${sha256}  ${bundleName}\n`;
  const checksumFile = resolve(releaseDir, `xiaoyaohe-${version}-web-bundle-SHA256SUMS.txt`);
  writeFileSync(checksumFile, checksumLine, 'utf8');

  console.log(`[bundle-web] v${version} -> ${bundleName} (${zipBuffer.length} bytes, sha256: ${sha256})`);

  return {
    bundleName,
    bundlePath,
    bundleSize: zipBuffer.length,
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
