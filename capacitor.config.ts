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
      insetsHandling: 'css',
      style: 'LIGHT',
      hidden: false,
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_medbox',
      iconColor: '#17745B',
      presentationOptions: ['badge', 'sound', 'banner', 'list'],
    },
    // 原生 HTTP 绕过 WebView CORS，才能在 App 里直调腾讯云「一句话识别」API
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
