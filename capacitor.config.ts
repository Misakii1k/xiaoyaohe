import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.medbox.app',
  appName: '吃药提醒',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
