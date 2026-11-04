import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.buypir.lifegame',
  appName: 'Гра про життя',
  webDir: 'dist/life-game/browser',
  ios: {
    contentInset: 'never',
    backgroundColor: '#f5f6f8',
  },
  plugins: {
    LocalNotifications: {
      iconColor: '#3B5BFD',
    },
  },
};

export default config;
