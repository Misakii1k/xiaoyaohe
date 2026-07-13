import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const distDir = join(root, 'dist');
const releaseDir = join(root, 'release');
const archive = join(releaseDir, `${pkg.name}-${pkg.version}.zip`);

if (!existsSync(join(distDir, 'index.html'))) {
  throw new Error('dist/index.html not found. Run npm run build first.');
}

mkdirSync(releaseDir, { recursive: true });
rmSync(archive, { force: true });

const ps = spawnSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Compress-Archive -Path '${distDir}\\*' -DestinationPath '${archive}' -Force`,
  ],
  { stdio: 'inherit' },
);

if (ps.status !== 0) {
  process.exit(ps.status ?? 1);
}

console.log(`Packaged ${archive}`);
