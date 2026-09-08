import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getVersionCode } from './lib/release-utils.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

const version = pkg.version;
const versionCode = getVersionCode(version) ?? 1;

let releaseNotes = '';
const releaseDocPath = join(root, 'docs', 'releases', `${version}.md`);
if (existsSync(releaseDocPath)) {
  releaseNotes = readFileSync(releaseDocPath, 'utf8').trim();
} else {
  releaseNotes = `小药盒 v${version} 发布`;
}

// 提取前 400 字符作为简明更新说明
if (releaseNotes.length > 500) {
  releaseNotes = releaseNotes.slice(0, 480) + '...';
}

const versionData = {
  version,
  versionCode,
  releaseDate: new Date().toISOString().slice(0, 10),
  downloadUrl: `https://github.com/Misakii1k/xiaoyaohe/releases/download/v${version}/xiaoyaohe-${version}-android-release.apk`,
  fileSize: 18667703,
  releaseNotes,
};

const targetPath = join(root, 'public', 'version.json');
writeFileSync(targetPath, JSON.stringify(versionData, null, 2) + '\n', 'utf8');
console.log(`[gen-version] Generated public/version.json for v${version} (code: ${versionCode})`);
