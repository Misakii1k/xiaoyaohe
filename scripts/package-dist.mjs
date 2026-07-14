import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeDirectoryZip } from './lib/release-utils.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const distDir = join(root, 'dist');
const archive = join(root, 'release', `${pkg.name}-${pkg.version}-web.zip`);

if (!existsSync(join(distDir, 'index.html'))) {
  throw new Error('dist/index.html not found. Run npm run build first.');
}

writeDirectoryZip(distDir, archive);
console.log(`Packaged ${archive}`);
