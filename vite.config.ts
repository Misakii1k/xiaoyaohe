import { configDefaults, defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

const appPackage = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

// Vite builds the assets embedded in the Capacitor Android WebView.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appPackage.version),
  },
  test: {
    // e2e/ 是 Playwright 测试，只能由 npx playwright test 运行
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
