import { configDefaults, defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const appPackage = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

// 日常工具箱 PWA：本地数据离线可用，浏览器通知仅在平台允许时尽力送达。
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
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        // 基础信息
        name: '日常工具箱',
        short_name: '日常工具箱',
        description: '本地优先的服药记录、药品管理与工时收入工具。PWA 通知受浏览器后台能力限制。',
        lang: 'zh-CN',
        dir: 'ltr',
        // 颜色 / 显示
        theme_color: '#f2f3f6',
        background_color: '#f2f3f6',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        // 路由 / 身份（PWABuilder 推荐显式声明 id 与 scope）
        start_url: '/',
        scope: '/',
        id: '/',
        // 应用商店分类（PWABuilder 会带到 Play Store metadata）
        categories: ['health', 'productivity', 'lifestyle'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // 预缓存 app shell，断网也能开应用、看本地药品、扫码
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
      devOptions: {
        enabled: false,
        type: 'module',
      },
    }),
  ],
});
