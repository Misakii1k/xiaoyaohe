import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// 吃药提醒 PWA —— 离线优先，安卓可“添加到主屏幕”
export default defineConfig({
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
        name: '吃药提醒 · 药盒分类',
        short_name: '吃药提醒',
        description: '按时吃药强提醒 + 扫码药盒分类，支持 AI 自然语言录入处方、离线可用。',
        lang: 'zh-CN',
        dir: 'ltr',
        // 颜色 / 显示
        theme_color: '#fbfaf8',
        background_color: '#fbfaf8',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'portrait',
        // 路由 / 身份（PWABuilder 推荐显式声明 id 与 scope）
        start_url: '/',
        scope: '/',
        id: '/',
        // 应用商店分类（PWABuilder 会带到 Play Store metadata）
        categories: ['health', 'medical', 'lifestyle'],
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
        // PWABuilder 强烈推荐：截图（横竖各一张能加分）
        screenshots: [
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            form_factor: 'narrow',
            label: '首页 · 今日提醒',
          },
        ],
      },
      workbox: {
        // 预缓存 app shell，断网也能开应用、看本地药品、扫码
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // Worker API：网络优先，失败回退缓存（同步/AI 需要联网，但断网时不致整页崩）
            urlPattern: /\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 8,
            },
          },
        ],
      },
      devOptions: {
        enabled: true, // 开发时也启用 SW，便于在手机上调试 PWA 行为
        type: 'module',
      },
    }),
  ],
});
