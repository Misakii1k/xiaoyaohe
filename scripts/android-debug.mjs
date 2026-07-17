// Windows 用 gradlew.bat，其它平台用 ./gradlew；避免 npm script 写死 Unix 名导致打包失败。
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(root, 'android');
const isWin = process.platform === 'win32';
const gradleName = isWin ? 'gradlew.bat' : 'gradlew';
const gradlePath = join(androidDir, gradleName);

if (!existsSync(gradlePath)) {
  console.error(`找不到 ${gradlePath}`);
  process.exit(1);
}

// 用绝对路径调用，避免 shell 找不到当前目录下的脚本
const result = spawnSync(gradlePath, ['assembleDebug'], {
  cwd: androidDir,
  stdio: 'inherit',
  shell: isWin,
  env: process.env,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
