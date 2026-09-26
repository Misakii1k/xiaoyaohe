// 发版第 1 步：版本递增。把散落在 6 处的版本号 + 3 份测试夹具一次改完。
//
//   node scripts/release-bump.mjs            # 补丁位 +1（1.1.13 -> 1.1.14）
//   node scripts/release-bump.mjs 1.2.0      # 指定版本
//   node scripts/release-bump.mjs --dry-run  # 只打印将要改什么
//
// 改动点（顺序即依赖顺序）：
//   package.json / package-lock.json         version
//   android/app/build.gradle                 versionCode / versionName
//   scripts/lib/release-utils.mjs            VERSION_CODE_BY_VERSION 追加
//   functions/version.json.ts                同一张表的边缘镜像
//   tests/release-utils.test.ts              新版本断言 + 版本锁
//   tests/{apk,bundle}UpdateVerification / appUpdateButtons
//                                            「云端更高版本」夹具推到本机之上
//
// 夹具为什么要跟着推：这三份测试用一个假的「更高版本」验证更新判定，一旦本机
// versionCode 追平夹具，更新分支就不再成立，17 项断言会一起变红（见 handoff 第 67 节）。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FIXTURE_FILES = [
  'tests/apkUpdateVerification.test.ts',
  'tests/appUpdateButtons.test.ts',
  'tests/bundleUpdateVerification.test.ts',
];

function read(relative) {
  // 仓库里大量文件是 CRLF，newline 必须原样保留，否则 diff 会炸成整文件重写
  return readFileSync(join(root, relative), 'utf8');
}

function write(relative, content, dryRun) {
  if (dryRun) return;
  writeFileSync(join(root, relative), content, 'utf8');
}

export function nextPatchVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Unparseable version: ${version}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

/** 夹具版本必须严格高于本机版本，否则更新判定分支不成立。 */
export function nextFixtureVersion(fixtureVersion, localVersion) {
  const bumped = nextPatchVersion(fixtureVersion);
  return compareVersions(bumped, localVersion) > 0 ? bumped : nextPatchVersion(localVersion);
}

/**
 * 找出夹具里扮演「云端恰好高一版」的那一个版本。
 *
 * 判据是 versionCode 恰为本机当前最高版本码 + 1 —— 这是这批夹具一直遵守的
 * 不变式（本机 71 时夹具是 1.2.4/72）。不能只按「大于本机」来找：文件里还有
 * 0.9.99/99 这类跨源比较用的固定夹具，它不随发版推位；以及 0.9.4 / 0.0.0
 * 等扮演「更旧版本」的夹具。
 */
export function detectFixtureVersion(source, localCode) {
  const candidates = [
    ...source.matchAll(/versionCode:\s*(\d+),\s*\r?\n?\s*versionName:\s*'(\d+\.\d+\.\d+)'/g),
    ...source.matchAll(/version:\s*'(\d+\.\d+\.\d+)',\s*\r?\n?\s*versionCode:\s*(\d+)/g),
  ].map((match) =>
    /^\d+$/.test(match[1])
      ? { code: Number(match[1]), version: match[2] }
      : { code: Number(match[2]), version: match[1] },
  );
  const expected = localCode + 1;
  const matches = candidates.filter((entry) => entry.code === expected);
  if (!matches.length) {
    const seen = [...new Set(candidates.map((e) => `${e.version}/${e.code}`))].join(', ');
    throw new Error(`夹具里找不到 versionCode === ${expected} 的「更高版本」。现有：${seen}`);
  }
  const unique = [...new Set(matches.map((entry) => entry.version))];
  if (unique.length > 1) {
    throw new Error(`versionCode ${expected} 对应多个版本号 (${unique.join(', ')})，请手工确认。`);
  }
  return matches[0];
}

export function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/** 从 release-utils 的映射表里读出当前最高的 version / versionCode。 */
export function readVersionTable(source) {
  const entries = [...source.matchAll(/'(\d+\.\d+\.\d+)':\s*(\d+)/g)].map(([, version, code]) => ({
    version,
    code: Number(code),
  }));
  if (!entries.length) throw new Error('VERSION_CODE_BY_VERSION table not found.');
  return entries;
}

function replaceOnce(source, needle, replacement, label) {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`${label}: pattern not found -> ${needle}`);
  if (source.indexOf(needle, index + needle.length) >= 0) {
    throw new Error(`${label}: pattern is ambiguous -> ${needle}`);
  }
  return source.slice(0, index) + replacement + source.slice(index + needle.length);
}

export function bump({ targetVersion, dryRun = false, log = console.log } = {}) {
  const pkgSource = read('package.json');
  const currentVersion = JSON.parse(pkgSource).version;
  const version = targetVersion ?? nextPatchVersion(currentVersion);
  if (compareVersions(version, currentVersion) <= 0) {
    throw new Error(`Target ${version} is not above current ${currentVersion}.`);
  }

  const utilsSource = read('scripts/lib/release-utils.mjs');
  const table = readVersionTable(utilsSource);
  const highest = table.reduce((a, b) => (b.code > a.code ? b : a));
  const versionCode = highest.code + 1;
  log(`bump ${currentVersion} (${highest.code}) -> ${version} (${versionCode})`);

  // 1) package.json / package-lock.json
  write('package.json', pkgSource.replace(`"version": "${currentVersion}"`, `"version": "${version}"`), dryRun);
  const lockSource = read('package-lock.json');
  // lock 顶部两处（root 包与 packages."" 自身），其余依赖版本不能碰
  let lockOut = lockSource;
  let lockHits = 0;
  lockOut = lockOut.replace(new RegExp(`"version": "${currentVersion.replace(/\./g, '\\.')}"`, 'g'), (m) => {
    lockHits += 1;
    return lockHits <= 2 ? `"version": "${version}"` : m;
  });
  if (lockHits < 2) throw new Error('package-lock.json: expected two version fields.');
  write('package-lock.json', lockOut, dryRun);

  // 2) android/app/build.gradle
  const gradleSource = read('android/app/build.gradle');
  let gradleOut = replaceOnce(gradleSource, `versionCode ${highest.code}`, `versionCode ${versionCode}`, 'build.gradle');
  gradleOut = replaceOnce(gradleOut, `versionName "${currentVersion}"`, `versionName "${version}"`, 'build.gradle');
  write('android/app/build.gradle', gradleOut, dryRun);

  // 3) release-utils 映射表
  const utilsOut = replaceOnce(
    utilsSource,
    `  '${highest.version}': ${highest.code},`,
    `  '${highest.version}': ${highest.code},\n  '${version}': ${versionCode},`,
    'release-utils.mjs',
  );
  write('scripts/lib/release-utils.mjs', utilsOut, dryRun);

  // 4) functions/version.json.ts 边缘镜像（同一张表，漏改会让线上下发旧 versionCode，见 handoff 第 68 节）
  const edgeSource = read('functions/version.json.ts');
  const edgeOut = replaceOnce(
    edgeSource,
    `'${highest.version}': ${highest.code},`,
    `'${highest.version}': ${highest.code}, '${version}': ${versionCode},`,
    'functions/version.json.ts',
  );
  write('functions/version.json.ts', edgeOut, dryRun);

  // 5) release-utils.test.ts：追加新版本断言 + 更新 package.json 版本锁
  const utilsTestSource = read('tests/release-utils.test.ts');
  const assertion =
    `    ).toEqual({ version: '${highest.version}', versionCode: ${highest.code} });`;
  let utilsTestOut = replaceOnce(
    utilsTestSource,
    assertion,
    `${assertion}\n` +
      `    expect(\n` +
      `      validateReleaseVersions({\n` +
      `        packageVersion: '${version}',\n` +
      `        lockVersion: '${version}',\n` +
      `        androidVersionName: '${version}',\n` +
      `        androidVersionCode: ${versionCode},\n` +
      `      }),\n` +
      `    ).toEqual({ version: '${version}', versionCode: ${versionCode} });`,
    'release-utils.test.ts',
  );
  // 版本锁在 `expect(packageJson).toMatchObject({ name: 'xiaoyaohe', version: ... })` 里。
  // 必须锚到 name 行上，否则会命中上面那串历史版本断言（实测会把上一版的期望值改坏）。
  utilsTestOut = replaceOnce(
    utilsTestOut,
    `      name: '${JSON.parse(pkgSource).name}',\n      version: '${currentVersion}',`,
    `      name: '${JSON.parse(pkgSource).name}',\n      version: '${version}',`,
    'release-utils.test.ts version lock',
  );
  write('tests/release-utils.test.ts', utilsTestOut, dryRun);

  // 6) 更新判定夹具：推到本机版本之上
  //
  // 只动「扮演云端更高版本」的那一个版本号，靠版本串本身定位。这些文件里还有
  // 大量不能碰的数字：toBe(38473) 是分发端口，toBe(44) 是底座门槛，其余是字节数；
  // 以及 versionName: '0.9.4' / '0.0.0' 等扮演「更旧版本」的夹具。
  const fixtureBefore = detectFixtureVersion(read(FIXTURE_FILES[0]), highest.code);
  const fixtureVersion = nextFixtureVersion(fixtureBefore.version, version);
  const fixtureCode = versionCode + 1;
  log(`fixtures ${fixtureBefore.version}/${fixtureBefore.code} -> ${fixtureVersion}/${fixtureCode}`);
  for (const file of FIXTURE_FILES) {
    const source = read(file);
    let out = source.split(fixtureBefore.version).join(fixtureVersion);
    // 版本码只替换旧夹具那个具体数值，且只在这三处成对出现的写法里
    for (const pattern of [
      [`versionCode: ${fixtureBefore.code}`, `versionCode: ${fixtureCode}`],
      [`toBe(${fixtureBefore.code})`, `toBe(${fixtureCode})`],
      [`versionCode = ${fixtureBefore.code}`, `versionCode = ${fixtureCode}`],
    ]) {
      out = out.split(pattern[0]).join(pattern[1]);
    }
    write(file, out, dryRun);
  }

  return { version, versionCode, fixtureVersion, fixtureCode, previousVersion: currentVersion };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const targetVersion = args.find((a) => /^\d+\.\d+\.\d+$/.test(a));
  try {
    const result = bump({ targetVersion, dryRun });
    console.log(
      dryRun
        ? '\nDry run complete. Nothing written.'
        : `\nBumped to ${result.version} / ${result.versionCode}. 下一步：写 docs/releases/${result.version}.md，然后 npm run release:build`,
    );
  } catch (error) {
    console.error(`\nBump failed: ${error.message}`);
    process.exitCode = 1;
  }
}
