import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

export const VERSION_CODE_BY_VERSION = Object.freeze({
  '0.4.1': 4,
  '0.5.0': 5,
  '0.6.0': 6,
  '0.7.0': 7,
  '0.7.1': 8,
  '0.7.2': 9,
  '0.7.3': 10,
  '0.7.4': 11,
  '0.7.5': 12,
  '0.7.6': 13,
  '0.7.7': 14,
  '0.7.8': 15,
  '0.8.0': 16,
  '0.8.1': 17,
  '0.8.2': 18,
  '0.9.0': 19,
  '0.9.1': 20,
  '0.9.2': 21,
  '0.9.3': 22,
  '0.9.4': 23,
  '0.9.5': 24,
  '0.9.6': 25,
  '0.9.7': 26,
  '0.9.8': 27,
  '0.9.9': 28,
  '0.9.10': 29,
  '0.9.11': 30,
  '0.9.12': 31,
  '0.9.13': 32,
  '0.9.14': 33,
  '0.9.15': 34,
  '1.0.0': 35,
  '1.0.1': 36,
  '1.0.2': 37,
  '1.0.3': 38,
  '1.0.4': 39,
  '1.0.5': 40,
  '1.0.6': 41,
  '1.0.7': 42,
  '1.0.8': 43,
  '1.0.9': 44,
  '1.0.10': 45,
  '1.0.11': 46,
  '1.0.12': 47,
  '1.0.13': 48,
});

/**
 * 首次引入 Android 原生增量包解压与基座动态切换（ApkDistributionPlugin.downloadAndUnpackBundle）
 * 的最低原生 APK versionCode。低版本底座无法运行 Web Bundle，需全量更新 APK。
 */
export const MIN_NATIVE_BUNDLE_VERSION_CODE = 44;

/**
 * 在 vite.config.ts 中由构建期注入到 WebView：把 package.json 的 version
 * 映射成 Android versionCode（与 release-utils 中的校验保持一致）。
 * 未在表中登记的版本返回 null，构建期常量变为 undefined，TS 侧用 0 兜底。
 */
export function getVersionCode(packageVersion) {
  return VERSION_CODE_BY_VERSION[packageVersion] ?? null;
}

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_UTF8_FLAG = 0x0800;
const REPRODUCIBLE_ZIP_DATE = new Date('2000-01-01T00:00:00.000Z');
const CAPACITOR_PUBLIC_EXTRAS = [
  /^cordova\.js$/,
  /^cordova_plugins\.js$/,
  /^plugins\//,
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJsonFile(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read JSON file ${file}: ${error.message}`, { cause: error });
  }
}

export function parseAndroidVersions(gradleSource) {
  const versionCodeMatch = gradleSource.match(/^\s*versionCode\s*(?:=\s*)?(\d+)\s*$/m);
  const versionNameMatch = gradleSource.match(
    /^\s*versionName\s*(?:=\s*)?["']([^"']+)["']\s*$/m,
  );

  invariant(versionCodeMatch, 'android/app/build.gradle does not declare versionCode.');
  invariant(versionNameMatch, 'android/app/build.gradle does not declare versionName.');

  return {
    versionCode: Number.parseInt(versionCodeMatch[1], 10),
    versionName: versionNameMatch[1],
  };
}

export function validateReleaseVersions({
  packageVersion,
  lockVersion,
  androidVersionName,
  androidVersionCode,
}) {
  const expectedVersionCode = VERSION_CODE_BY_VERSION[packageVersion];
  invariant(
    expectedVersionCode !== undefined,
    `Unsupported release version ${packageVersion}. Add its Android versionCode mapping first.`,
  );
  invariant(
    lockVersion === packageVersion,
    `package-lock.json version ${lockVersion ?? '(missing)'} does not match package.json ${packageVersion}.`,
  );
  invariant(
    androidVersionName === packageVersion,
    `Android versionName ${androidVersionName} does not match package.json ${packageVersion}.`,
  );
  invariant(
    androidVersionCode === expectedVersionCode,
    `Android versionCode ${androidVersionCode} does not match ${packageVersion} (expected ${expectedVersionCode}).`,
  );

  return { version: packageVersion, versionCode: expectedVersionCode };
}

export function readAndValidateReleaseConfig(root) {
  const packageJson = parseJsonFile(join(root, 'package.json'));
  const packageLock = parseJsonFile(join(root, 'package-lock.json'));
  const gradleFile = join(root, 'android', 'app', 'build.gradle');
  const android = parseAndroidVersions(readFileSync(gradleFile, 'utf8'));
  const lockRoot = packageLock.packages?.[''] ?? {};

  invariant(
    packageJson.name === lockRoot.name,
    `package-lock.json package name ${lockRoot.name ?? '(missing)'} does not match ${packageJson.name}.`,
  );
  invariant(
    /^[a-zA-Z0-9._-]+$/.test(packageJson.name),
    `Package name ${packageJson.name} cannot be used in release artifact filenames.`,
  );

  const version = validateReleaseVersions({
    packageVersion: packageJson.version,
    lockVersion: lockRoot.version ?? packageLock.version,
    androidVersionName: android.versionName,
    androidVersionCode: android.versionCode,
  });
  const releaseNotesFile = join(root, 'docs', 'releases', `${version.version}.md`);
  invariant(
    existsSync(releaseNotesFile),
    `Plain-language release notes not found for ${version.version}: ${releaseNotesFile}`,
  );

  return { name: packageJson.name, ...version, releaseNotesFile };
}

function normalizeArchivePath(path) {
  return path.split(sep).join('/');
}

export function collectDirectoryEntries(directory) {
  const root = resolve(directory);
  invariant(existsSync(root), `Directory not found: ${root}`);
  invariant(statSync(root).isDirectory(), `Expected a directory: ${root}`);

  const entries = [];
  const visit = (current) => {
    for (const item of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, item.name);
      if (item.isSymbolicLink()) {
        throw new Error(`Refusing to package symbolic link: ${absolute}`);
      }
      if (item.isDirectory()) {
        visit(absolute);
      } else if (item.isFile()) {
        entries.push({
          name: normalizeArchivePath(relative(root, absolute)),
          data: readFileSync(absolute),
        });
      }
    }
  };

  visit(root);
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  invariant(entries.length > 0, `Directory is empty: ${root}`);
  return entries;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date) {
  const year = Math.max(1980, Math.min(2107, date.getUTCFullYear()));
  return {
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
  };
}

export function createZipBuffer(entries, { date = REPRODUCIBLE_ZIP_DATE } = {}) {
  invariant(entries.length <= 0xffff, 'ZIP archive has too many files.');
  const { date: dosDate, time: dosTime } = toDosDateTime(date);
  const localParts = [];
  const centralParts = [];
  const seen = new Set();
  let localOffset = 0;

  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    const name = entry.name.replaceAll('\\', '/').replace(/^\.\//, '');
    invariant(name && !name.startsWith('/') && !name.split('/').includes('..'), `Unsafe ZIP path: ${name}`);
    invariant(!seen.has(name), `Duplicate ZIP entry: ${name}`);
    seen.add(name);

    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const compressedCandidate = deflateRawSync(data, { level: 9 });
    const useCompression = compressedCandidate.length < data.length;
    const compressed = useCompression ? compressedCandidate : data;
    const method = useCompression ? 8 : 0;
    const checksum = crc32(data);

    invariant(data.length <= 0xffffffff && compressed.length <= 0xffffffff, `ZIP entry is too large: ${name}`);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(ZIP_LOCAL_FILE_HEADER, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);
    const localPart = Buffer.concat([localHeader, nameBytes, compressed]);
    localParts.push(localPart);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_HEADER, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(ZIP_UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(Buffer.concat([centralHeader, nameBytes]));

    localOffset += localPart.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  invariant(localOffset <= 0xffffffff && centralDirectory.length <= 0xffffffff, 'ZIP64 is not supported.');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

export function writeDirectoryZip(sourceDirectory, destination) {
  const archive = createZipBuffer(collectDirectoryEntries(sourceDirectory));
  atomicWrite(destination, archive);
  return destination;
}

function findEndOfCentralDirectory(archive) {
  const minimumOffset = Math.max(0, archive.length - 0xffff - 22);
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw new Error('Invalid ZIP: end of central directory was not found.');
}

export function readZipEntries(archive) {
  const data = Buffer.isBuffer(archive) ? archive : Buffer.from(archive);
  const endOffset = findEndOfCentralDirectory(data);
  const diskNumber = data.readUInt16LE(endOffset + 4);
  const centralDisk = data.readUInt16LE(endOffset + 6);
  const entryCount = data.readUInt16LE(endOffset + 10);
  let offset = data.readUInt32LE(endOffset + 16);
  invariant(diskNumber === 0 && centralDisk === 0, 'Multi-disk ZIP archives are not supported.');
  invariant(entryCount !== 0xffff && offset !== 0xffffffff, 'ZIP64 archives are not supported.');

  const entries = new Map();
  for (let index = 0; index < entryCount; index += 1) {
    invariant(data.readUInt32LE(offset) === ZIP_CENTRAL_DIRECTORY_HEADER, 'Invalid ZIP central directory.');
    const flags = data.readUInt16LE(offset + 8);
    const method = data.readUInt16LE(offset + 10);
    const expectedCrc = data.readUInt32LE(offset + 16);
    const compressedSize = data.readUInt32LE(offset + 20);
    const uncompressedSize = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const localHeaderOffset = data.readUInt32LE(offset + 42);
    const name = data.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');

    invariant((flags & 1) === 0, `Encrypted ZIP entry is not supported: ${name}`);
    invariant(compressedSize !== 0xffffffff && uncompressedSize !== 0xffffffff, `ZIP64 entry is not supported: ${name}`);
    invariant(data.readUInt32LE(localHeaderOffset) === ZIP_LOCAL_FILE_HEADER, `Invalid local ZIP header: ${name}`);

    const localNameLength = data.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = data.readUInt16LE(localHeaderOffset + 28);
    const contentOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = data.subarray(contentOffset, contentOffset + compressedSize);
    let content;
    if (method === 0) content = Buffer.from(compressed);
    else if (method === 8) content = inflateRawSync(compressed);
    else throw new Error(`Unsupported ZIP compression method ${method}: ${name}`);

    invariant(content.length === uncompressedSize, `ZIP size mismatch: ${name}`);
    invariant(crc32(content) === expectedCrc, `ZIP checksum mismatch: ${name}`);
    invariant(!entries.has(name), `Duplicate ZIP entry: ${name}`);
    if (!name.endsWith('/')) entries.set(name, content);

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function verifyApkWebAssets(distDirectory, apkFile) {
  invariant(existsSync(apkFile), `APK not found: ${apkFile}`);
  const distEntries = collectDirectoryEntries(distDirectory);
  const apkEntries = readZipEntries(readFileSync(apkFile));
  const prefix = 'assets/public/';
  const apkPublic = new Map();

  for (const [name, content] of apkEntries) {
    if (name.startsWith(prefix)) apkPublic.set(name.slice(prefix.length), content);
  }

  invariant(apkPublic.size > 0, 'APK does not contain assets/public web resources.');
  for (const entry of distEntries) {
    const apkContent = apkPublic.get(entry.name);
    invariant(apkContent, `APK is missing dist resource: ${entry.name}`);
    invariant(
      sha256(apkContent) === sha256(entry.data),
      `APK contains stale or modified dist resource: ${entry.name}`,
    );
  }

  const distNames = new Set(distEntries.map((entry) => entry.name));
  const unexpected = [...apkPublic.keys()].filter(
    (name) => !distNames.has(name) && !CAPACITOR_PUBLIC_EXTRAS.some((pattern) => pattern.test(name)),
  );
  invariant(
    unexpected.length === 0,
    `APK contains unexpected web resources not present in dist: ${unexpected.join(', ')}`,
  );

  return {
    fileCount: distEntries.length,
    aggregateHash: sha256(
      Buffer.from(distEntries.map((entry) => `${sha256(entry.data)}  ${entry.name}\n`).join(''), 'utf8'),
    ),
  };
}

export function resolveAndroidArtifact(root, variant, expected) {
  invariant(/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(variant), `Invalid Android variant: ${variant}`);
  const outputDirectory = join(root, 'android', 'app', 'build', 'outputs', 'apk', variant);
  const metadataFile = join(outputDirectory, 'output-metadata.json');
  invariant(existsSync(metadataFile), `Android output metadata not found for variant ${variant}.`);
  const metadata = parseJsonFile(metadataFile);
  invariant(metadata.variantName === variant, `Android metadata variant ${metadata.variantName} is not ${variant}.`);
  invariant(metadata.elements?.length === 1, 'Expected exactly one universal APK output.');
  const element = metadata.elements[0];
  invariant(
    element.versionName === expected.version,
    `Built APK versionName ${element.versionName} does not match ${expected.version}.`,
  );
  invariant(
    element.versionCode === expected.versionCode,
    `Built APK versionCode ${element.versionCode} does not match ${expected.versionCode}.`,
  );
  invariant(!element.filters?.length, 'Split APK outputs are not supported by this release pipeline.');
  invariant(
    basename(element.outputFile) === element.outputFile,
    `Unsafe APK output filename: ${element.outputFile}`,
  );
  const apkFile = join(outputDirectory, element.outputFile);
  invariant(existsSync(apkFile), `Built APK file not found: ${apkFile}`);
  return apkFile;
}

function atomicWrite(destination, content) {
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  rmSync(temporary, { force: true });
  writeFileSync(temporary, content);
  rmSync(destination, { force: true });
  renameSync(temporary, destination);
}

function atomicCopy(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  rmSync(temporary, { force: true });
  copyFileSync(source, temporary);
  rmSync(destination, { force: true });
  renameSync(temporary, destination);
}

export function publishReleaseArtifacts({ root, releaseConfig, variant, apkFile }) {
  const distDirectory = join(root, 'dist');
  invariant(existsSync(join(distDirectory, 'index.html')), 'dist/index.html not found.');
  const verification = verifyApkWebAssets(distDirectory, apkFile);
  const releaseDirectory = join(root, 'release');
  const base = `${releaseConfig.name}-${releaseConfig.version}`;
  const obsoleteWebArchive = join(releaseDirectory, `${base}-web.zip`);
  const androidArtifact = join(releaseDirectory, `${base}-android-${variant}.apk`);
  const checksumFile = join(releaseDirectory, `${base}-SHA256SUMS.txt`);

  rmSync(obsoleteWebArchive, { force: true });
  atomicCopy(apkFile, androidArtifact);

  const checksum = `${sha256(readFileSync(androidArtifact))}  ${basename(androidArtifact)}`;
  atomicWrite(checksumFile, Buffer.from(`${checksum}\n`, 'utf8'));

  return { androidArtifact, checksumFile, verification };
}
