import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.sonalit.guardian.convoy',
  appName: 'Guardian Convoy',
  webDir: 'dist',
  android: { backgroundColor: '#060a08' },
  plugins: {
    Camera: { permissions: ['camera'] },
    Geolocation: { permissions: ['location'] },
  },
};

export default config;
