import { configDefaults, defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const appPackage = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

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

// Vite builds the assets embedded in the Capacitor Android WebView.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appPackage.version),
  },
  plugins: [tablerIconsRawResolver()],
  test: {
    // e2e/ 是 Playwright 测试，只能由 npx playwright test 运行
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
  server: {
    host: true, // 允许局域网内手机访问（npm run dev 后用手机打开电脑 IP）
    port: 5173,
    proxy: {
      // 把腾讯云一句话识别代理（server/tencent-asr-proxy.mjs，默认 8787）挂到 dev 站点下，
      // 浏览器用相对路径 /api/speech/tencent 即可，无需 VITE_ASR_PROXY_URL。
      '/api': {
        target: process.env.ASR_PROXY_TARGET ?? 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
