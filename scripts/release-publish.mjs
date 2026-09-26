// 发版第 3 步：提交、打 tag、推送、建 Release、线上冒烟。
//
//   node scripts/release-publish.mjs             # 全流程
//   node scripts/release-publish.mjs --resume    # 跳过已完成的步骤，续跑
//   node scripts/release-publish.mjs --no-merge  # 不快进 main（暂不部署到线上）
//
// 每一步先判断「是否已经做过」，做过就跳过。所以中途断网/中断后直接重跑
// 同一条命令即可续上，不需要人工判断卡在哪一步。
//
// 推送为什么要重试：GitHub 在本机网络下经常出现 schannel 握手失败、
// Recv failure、连接重置。逐个 commit 推 + 指数退避重试是实测唯一可靠的方式
// （见 handoff 第 74 节）。
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAndValidateReleaseConfig } from './lib/release-utils.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORK_BRANCH = 'workspace/claude';
const MAIN_BRANCH = 'main';
const PUSH_ATTEMPTS = 12;

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return { ok: result.status === 0, out: (result.stdout || '').trim(), err: (result.stderr || '').trim() };
}

function step(label, fn) {
  console.log(`\n=== ${label} ===`);
  return fn();
}

// 同步睡眠：spawnSync 一个只负责阻塞的子进程。Atomics.wait 需要 SharedArrayBuffer
// 且在主线程受限，这里用子进程最省事也最可靠。
function sleep(ms) {
  spawnSync(process.execPath, ['-e', `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${ms})`], {
    timeout: ms + 10000,
  });
}

/**
 * 逐个 commit 推送 + 退避重试。小包比大包成功率高得多。
 *
 * non-fast-forward 不重试：那是本地落后于远端，重试一万次也不会变好，
 * 必须先 fetch/rebase。把它和网络故障区分开，否则会白等十几分钟。
 */
function pushWithRetry(refspec, label) {
  for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt += 1) {
    const result = git(['push', 'origin', refspec], { allowFailure: true });
    const output = `${result.err}\n${result.out}`;
    if (result.ok) {
      console.log(`  ${label}: pushed (attempt ${attempt})`);
      return true;
    }
    if (/Everything up-to-date|already exists/.test(output)) {
      console.log(`  ${label}: already on remote`);
      return true;
    }
    if (/non-fast-forward|fetch first|Note about fast-forwards/.test(output)) {
      throw new Error(
        `${label}: 远端已领先本地（non-fast-forward）。先 git fetch origin 再 rebase，不是网络问题。`,
      );
    }
    const wait = Math.min(15000 * attempt, 90000);
    console.log(`  ${label}: attempt ${attempt}/${PUSH_ATTEMPTS} failed (${result.err.split('\n').pop()}); retry in ${wait / 1000}s`);
    if (attempt < PUSH_ATTEMPTS) sleep(wait);
  }
  throw new Error(`${label}: 推送在 ${PUSH_ATTEMPTS} 次尝试后仍失败。网络恢复后重跑 --resume 即可续上。`);
}

/**
 * 远端某 ref 指向的 commit；不存在返回 ''。
 *
 * 网络不可用时抛错而不是返回 null —— 调用方拿 null 当「远端没有这个分支」会
 * 推出全部历史提交（实测列出 249 个，全部注定 non-fast-forward 失败）。
 */
function remoteHas(ref) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = git(['ls-remote', 'origin', ref], { allowFailure: true });
    if (result.ok) return result.out.length > 0 ? result.out.split(/\s+/)[0] : '';
    if (attempt < 3) {
      console.log(`  ls-remote ${ref} 失败，${10 * attempt}s 后重试`);
      sleep(10000 * attempt);
    }
  }
  throw new Error(`无法读取远端 ${ref}（网络不可用）。网络恢复后重跑 --resume。`);
}

export function runPublish({ resume = false, merge = true } = {}) {
  const config = readAndValidateReleaseConfig(root);
  const tag = `v${config.version}`;
  const notes = join(root, `docs/releases/${config.version}.md`);
  console.log(`Publish ${config.name} ${config.version} (Android ${config.versionCode})`);

  if (!existsSync(notes)) throw new Error(`${notes} 不存在。`);

  const branch = git(['branch', '--show-current']).out;
  if (branch !== WORK_BRANCH) {
    throw new Error(`当前分支是 ${branch}，发版必须在 ${WORK_BRANCH} 上进行。`);
  }

  // 1) 提交（工作区可能已经干净——resume 场景）
  step('Commit release changes', () => {
    const dirty = git(['status', '--porcelain']).out;
    if (!dirty) {
      console.log('  working tree clean, nothing to commit');
      return;
    }
    const paths = dirty.split('\n').map((line) => line.slice(3).replace(/^"|"$/g, ''));

    // 防呆：绝不提交密钥与构建产物
    const offenders = paths.filter((path) => /(^|\/)\.env$|^release\//.test(path));
    if (offenders.length) throw new Error(`拒绝提交：${offenders.join(', ')}`);

    // 只提交 bump 会碰的那些文件 + 本版发布说明 + 交接文档。手上正在写的其他
    // 东西（未跟踪的脚本、草稿）不该被卷进 release 提交里。
    const RELEASE_PATHS = [
      'package.json',
      'package-lock.json',
      'android/app/build.gradle',
      'scripts/lib/release-utils.mjs',
      'functions/version.json.ts',
      'tests/release-utils.test.ts',
      'tests/apkUpdateVerification.test.ts',
      'tests/appUpdateButtons.test.ts',
      'tests/bundleUpdateVerification.test.ts',
      `docs/releases/${config.version}.md`,
      'docs/handoffs/claude.md',
      'docs/handoffs/CURRENT.md',
    ];
    const staged = RELEASE_PATHS.filter((path) => paths.includes(path));
    if (!staged.length) {
      console.log('  没有发版相关改动待提交（其余改动保留在工作区）');
      return;
    }
    const skipped = paths.filter((path) => !RELEASE_PATHS.includes(path));
    if (skipped.length) console.log(`  保留在工作区（未提交）：${skipped.join(', ')}`);

    git(['add', '--', ...staged]);
    const message =
      `release: ${tag} (versionCode ${config.versionCode})\n\n` +
      `${readFileSync(notes, 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim()}\n\n` +
      `Co-Authored-By: Claude <noreply@anthropic.com>\n`;
    const result = spawnSync('git', ['commit', '-F', '-'], { cwd: root, input: message, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`commit failed: ${result.stderr}`);
    console.log(`  committed ${git(['rev-parse', '--short', 'HEAD']).out} (${staged.length} files)`);
  });

  // 2) 打 tag
  step(`Tag ${tag}`, () => {
    if (git(['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { allowFailure: true }).ok) {
      console.log('  tag already exists locally');
      return;
    }
    git(['tag', tag]);
    console.log('  tagged');
  });

  // 3) 逐个 commit 推分支
  step(`Push ${WORK_BRANCH}`, () => {
    git(['config', 'http.postBuffer', '524288000']);
    const remoteHead = remoteHas(`refs/heads/${WORK_BRANCH}`);
    const range = remoteHead ? `${remoteHead}..HEAD` : 'HEAD';
    const pending = git(['rev-list', '--reverse', range], { allowFailure: true }).out.split('\n').filter(Boolean);
    if (!pending.length) {
      console.log('  remote already up to date');
      return;
    }
    console.log(`  ${pending.length} commit(s) to push, one at a time`);
    for (const sha of pending) {
      pushWithRetry(`${sha}:refs/heads/${WORK_BRANCH}`, git(['rev-parse', '--short', sha]).out);
    }
  });

  // 4) 推 tag
  step(`Push tag ${tag}`, () => {
    if (remoteHas(`refs/tags/${tag}`)) {
      console.log('  tag already on remote');
      return;
    }
    pushWithRetry(`refs/tags/${tag}`, tag);
  });

  // 5) 快进 main（Cloudflare Pages 的生产分支，不推就不会重新部署边缘函数）
  if (merge) {
    step(`Fast-forward ${MAIN_BRANCH}`, () => {
      const head = git(['rev-parse', 'HEAD']).out;
      if (remoteHas(`refs/heads/${MAIN_BRANCH}`) === head) {
        console.log('  already up to date');
        return;
      }
      pushWithRetry(`HEAD:refs/heads/${MAIN_BRANCH}`, MAIN_BRANCH);
    });
  }

  // 6) GitHub Release（缺附件则应用内更新会 404）
  step(`GitHub Release ${tag}`, () => {
    const exists = spawnSync('gh', ['release', 'view', tag], { cwd: root, encoding: 'utf8' });
    if (exists.status === 0) {
      console.log('  release already exists');
      return;
    }
    const base = `${config.name}-${config.version}`;
    const assets = [
      `release/${base}-android-release.apk`,
      `release/${base}-web-bundle.zip`,
      `release/${base}-SHA256SUMS.txt`,
    ];
    for (const asset of assets) {
      if (!existsSync(join(root, asset))) throw new Error(`缺少发布附件：${asset}（先跑 release-build）`);
    }
    const result = spawnSync(
      'gh',
      ['release', 'create', tag, ...assets, '--title', tag, '--notes-file', `docs/releases/${config.version}.md`],
      { cwd: root, stdio: 'inherit' },
    );
    if (result.status !== 0) throw new Error('gh release create 失败（网络恢复后重跑 --resume）。');
  });

  // 7) 线上冒烟
  step('Smoke-test live endpoints', () => {
    const result = spawnSync('node', ['scripts/check-release-endpoints.mjs'], { cwd: root, stdio: 'inherit' });
    if (result.status !== 0) {
      console.log('\n冒烟未全绿。Cloudflare Pages 构建需要一两分钟，稍后重跑：');
      console.log('  node scripts/check-release-endpoints.mjs');
    }
  });

  console.log(`\n${tag} 发布完成。`);
  return { tag, version: config.version, versionCode: config.versionCode };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runPublish({
      resume: process.argv.includes('--resume'),
      merge: !process.argv.includes('--no-merge'),
    });
  } catch (error) {
    console.error(`\nPublish failed: ${error.message}`);
    process.exitCode = 1;
  }
}
