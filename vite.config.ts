import { configDefaults, defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { getVersionCode } from './scripts/lib/release-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const appPackage = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

const appVersionCode = getVersionCode(appPackage.version) ?? 0;

// Vitest 在 Node 模式下无法直接解析 @tabler/icons 子路径 + ?raw 的导入，
// 因为 npm 包的 exports 会把查询字符串算进路径。此插件把这类导入重写为
// node_modules 中的绝对路径，让 Vite 的 ?raw 加载器正常工作。
const tablerIconsRawResolver = () => ({
  name: 'tabler-icons-raw',
  enforce: 'pre' as const,
  resolveId(id: string) {
    if (id.startsWith('@tabler/icons/') && id.endsWith('?raw')) {
      const filePath = id.slice('@tabler/icons/'.length, -'?raw'.length);
      return resolve(__dirname, 'node_modules/@tabler/icons', filePath) + '?raw';
    }
  },
});

// Vite builds the assets embedded in the Capacitor Android WebView or hosted statically on Web/PWA.
export default defineConfig({
  base: process.env.VITE_BASE_PATH || './',
  define: {
    __APP_VERSION__: JSON.stringify(appPackage.version),
    __APP_VERSION_CODE__: JSON.stringify(appVersionCode),
  },
  plugins: [tablerIconsRawResolver()],
  test: {
    // e2e/ 是 Playwright 测试，不由 Vitest 运行
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
  server: {
    host: true, // 允许局域网内手机访问（npm run dev 后用手机打开电脑 IP）
    port: 5173,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
