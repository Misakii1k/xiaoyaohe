import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.medbox.app',
  appName: '小药盒',
  webDir: 'dist',
  loggingBehavior: 'none',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SystemBars: {
      // 用 disable 让 WebView 拿到真实系统栏 insets：插件在 css 模式下会清零交给 WebView 的
      // system-bars insets（Android 16 还会给 WebView 父容器加 padding），导致 Android 15/16
      // edge-to-edge 下长按输入框时原生文本选择工具栏（ActionMode）锚点/尺寸错乱，渲染成巨大空白白块。
      // 安全区改由 WebView 原生 env(safe-area-inset-*) 承担（index.html 已设 viewport-fit=cover，
      // tokens.css 的 --safe-* 已是 max(env(), var(--safe-area-inset-*))，JS 不依赖插件注入变量）。
      insetsHandling: 'disable',
      style: 'LIGHT',
      hidden: false,
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_medbox',
      iconColor: '#17745B',
      presentationOptions: ['badge', 'sound', 'banner', 'list'],
    },
  },
};

export default config;
