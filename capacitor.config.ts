import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.heavyuser73.coffeebet',
  appName: '커피내기(coffee bet)',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
