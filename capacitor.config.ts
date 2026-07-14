import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.medbox.app',
  appName: '日常工具箱',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_medbox',
      iconColor: '#17745B',
      presentationOptions: ['badge', 'sound', 'banner', 'list'],
    },
  },
};

export default config;
