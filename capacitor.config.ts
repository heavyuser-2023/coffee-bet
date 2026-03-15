import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.heavyuser73.coffeebet',
  appName: 'Coffee Bet App',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
