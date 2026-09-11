import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getVersionCode, MIN_NATIVE_BUNDLE_VERSION_CODE } from './lib/release-utils.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 更新包直链一律走**同源 Cloudflare Pages Functions 代理**。
 *
 * 之前这里写的是 GitHub Release 的 `browser_download_url`，而仓库是私有的：
 * 匿名用户拿到这个链接只会 404（实测 2026-09-09），APK 也没有随静态站点部署
 * （`public/release/` 被 .gitignore 忽略，Pages 从 git 构建时不存在该目录）。
 * 走 `/api/download?tag=…` 后，仓库是否私有、APK 是否入库都不再影响下载。
 */
export function buildVersionManifest({
  version,
  versionCode,
  releaseDate,
  releaseNotes,
  apk,
  bundle,
  minNativeVersionCode,
}) {
  return {
    version,
    versionCode,
    releaseDate,
    downloadUrl: `/api/download?tag=v${version}`,
    ...(apk ? { fileSize: apk.size, sha256: apk.sha256 } : {}),
    ...(bundle ? {
      bundleUrl: `/api/download?tag=v${version}&asset=bundle`,
      bundleSize: bundle.size,
      bundleSha256: bundle.sha256,
      minNativeVersionCode: minNativeVersionCode ?? MIN_NATIVE_BUNDLE_VERSION_CODE,
    } : {}),
    releaseNotes,
  };
}

/** 找出本版本的正式 APK 并算出真实字节数与 SHA256；没有就返回 null（绝不编造数字）。 */
export function readApkManifest(rootDir, version) {
  const name = `xiaoyaohe-${version}-android-release.apk`;
  const file = join(rootDir, 'release', name);
  if (existsSync(file)) {
    return {
      path: file,
      size: statSync(file).size,
      sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    };
  }
  return null;
}

/** 找出本版本的 Web 增量包并算出真实字节数与 SHA256；没有就返回 null。 */
export function readBundleManifest(rootDir, version) {
  const name = `xiaoyaohe-${version}-web-bundle.zip`;
  const file = join(rootDir, 'release', name);
  if (existsSync(file)) {
    return {
      path: file,
      size: statSync(file).size,
      sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    };
  }
  return null;
}

function readReleaseNotes(rootDir, version) {
  const doc = join(rootDir, 'docs', 'releases', `${version}.md`);
  if (!existsSync(doc)) return `小药盒 v${version} 发布`;
  const notes = readFileSync(doc, 'utf8').trim();
  return notes.length > 500 ? `${notes.slice(0, 480)}...` : notes;
}

export function generateVersionFile(rootDir = root) {
  const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
  const version = pkg.version;
  const versionCode = getVersionCode(version) ?? 1;
  const apk = readApkManifest(rootDir, version);
  const bundle = readBundleManifest(rootDir, version);
  const manifest = buildVersionManifest({
    version,
    versionCode,
    releaseDate: new Date().toISOString().slice(0, 10),
    releaseNotes: readReleaseNotes(rootDir, version),
    apk,
    bundle,
    minNativeVersionCode: MIN_NATIVE_BUNDLE_VERSION_CODE,
  });

  const target = join(rootDir, 'public', 'version.json');
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const distTarget = join(rootDir, 'dist', 'version.json');
  if (existsSync(join(rootDir, 'dist'))) {
    writeFileSync(distTarget, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }

  console.log(`[gen-version] v${version} (code ${versionCode}) -> ${manifest.downloadUrl}`);
  if (apk) {
    console.log(`[gen-version] APK ${apk.size} bytes, sha256 ${apk.sha256}`);
  } else {
    console.warn('[gen-version] 未找到本版本 APK（release/ 或 public/release/），'
      + 'version.json 将不含 fileSize/sha256；客户端会跳过大小校验，仍以安装前验签为准。');
  }
  if (bundle) {
    console.log(`[gen-version] WebBundle ${bundle.size} bytes, sha256 ${bundle.sha256}`);
  }
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateVersionFile();
}
