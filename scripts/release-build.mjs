// 发版第 2 步：两遍出包。
//
//   node scripts/release-build.mjs                # 门禁 + 两遍构建 + 归档 + 校验
//   node scripts/release-build.mjs --skip-gates   # 只出包（门禁已单独跑过）
//
// 为什么必须两遍：`gen-version.mjs` 要把 APK 的真实体积与 sha256 写进
// version.json，而这份 version.json 又要被打进 APK 的内嵌资源。第一遍打包时
// APK 还不存在，写出的清单缺字段；拿到 APK 后重跑 gen-version 再打第二遍，
// 内嵌清单才完整（见 handoff 第 67 节的「先有鸡还是先有蛋」）。
//
// 两遍的 APK 哈希必然不同（内嵌 version.json 变了），所以最后要再跑一次
// gen-version，让 public/version.json 记录的是**最终**产物的哈希 —— 客户端
// 更新校验读的就是这一份，记错了会导致下载后大小/哈希不符而中止。
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  publishReleaseArtifacts,
  readAndValidateReleaseConfig,
  resolveAndroidArtifact,
  sha256,
} from './lib/release-utils.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';

function run(label, command, args, cwd = root) {
  console.log(`\n=== ${label} ===`);
  console.log(`> ${command} ${args.join(' ')}`);
  const invocation =
    process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command)
      ? { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', [command, ...args].join(' ')] }
      : { command, args };
  const result = spawnSync(invocation.command, invocation.args, { cwd, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status ?? 'unknown'}).`);
}

export function runBuild({ skipGates = false } = {}) {
  const config = readAndValidateReleaseConfig(root);
  console.log(`Release build: ${config.name} ${config.version} (Android ${config.versionCode})`);

  if (!existsSync(join(root, `docs/releases/${config.version}.md`))) {
    throw new Error(`docs/releases/${config.version}.md 不存在 —— 先写发布说明再出包。`);
  }

  if (!skipGates) {
    run('Type-check', npm, ['run', 'typecheck']);
    run('Vitest', npm, ['test']);
    // 默认并行度下每轮会有 1~2 个 worker 的首个用例因冷启动转译打满超时预算
    // （见 handoff 第 77 节），--workers=2 稳定全绿。
    run('Playwright', npx, ['playwright', 'test', '--workers=2']);
  }

  const apkName = `${config.name}-${config.version}-android-release.apk`;
  const archived = join(root, 'release', apkName);
  const built = join(root, 'android/app/build/outputs/apk/release/app-release.apk');

  run('Build web assets (pass 1)', npm, ['run', 'build:web']);
  run('Capacitor sync (pass 1)', npx, ['cap', 'sync', 'android']);
  run('Assemble APK (pass 1)', gradle, ['assembleRelease'], join(root, 'android'));

  // 归档第一遍产物，仅为让 gen-version 能读到体积与哈希
  copyFileSync(built, archived);
  run('Refresh version manifest', 'node', ['scripts/gen-version.mjs']);

  run('Capacitor sync (pass 2)', npx, ['cap', 'sync', 'android']);
  run('Assemble APK (pass 2)', gradle, ['assembleRelease'], join(root, 'android'));

  console.log('\n=== Verify embedded web assets ===');
  const apkFile = resolveAndroidArtifact(root, 'release', config);
  const artifacts = publishReleaseArtifacts({ root, releaseConfig: config, variant: 'release', apkFile });
  console.log(
    `Verified ${artifacts.verification.fileCount} embedded files (aggregate ${artifacts.verification.aggregateHash}).`,
  );

  // 最终哈希回写清单：客户端下载校验读的是这一份
  run('Refresh version manifest (final)', 'node', ['scripts/gen-version.mjs']);

  const finalHash = sha256(readFileSync(artifacts.androidArtifact));
  const manifest = JSON.parse(readFileSync(join(root, 'public/version.json'), 'utf8'));
  if (manifest.sha256 !== finalHash) {
    throw new Error(`public/version.json sha256 (${manifest.sha256}) != final APK (${finalHash}).`);
  }
  if (manifest.version !== config.version || manifest.versionCode !== config.versionCode) {
    throw new Error(`public/version.json 版本 (${manifest.version}/${manifest.versionCode}) 与配置不一致。`);
  }

  console.log('\nArtifacts:');
  console.log(`- ${artifacts.androidArtifact}`);
  console.log(`- ${artifacts.checksumFile}`);
  console.log(`- ${join(root, 'release', `${config.name}-${config.version}-web-bundle.zip`)}`);
  console.log(`\nmanifest sha256 == final APK sha256 (${finalHash.slice(0, 12)}…) ✓`);
  console.log(`下一步：node scripts/release-publish.mjs`);
  return { config, artifacts, finalHash };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runBuild({ skipGates: process.argv.includes('--skip-gates') });
  } catch (error) {
    console.error(`\nRelease build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
