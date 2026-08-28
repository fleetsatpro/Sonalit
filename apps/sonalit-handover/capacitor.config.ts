import type { CapacitorConfig } from '@capacitor/cli';

/*
 * Sonalit Handover APK — Handover Officers.
 *
 * A thin native shell, same pattern as apps/sonalit-field and apps/sonalit-app:
 * no local UI code here, just a WebView pointed at the hosted /handover route.
 * Workflow changes ship on every web deploy, no new APK needed.
 *
 * Handover officers have a dedicated login at /handover/login (purpose-built,
 * no operator marketing). After email/password auth, first-time officers set
 * a 4-8 digit PIN for quick re-auth. The handoverAuthCheck in router.tsx
 * redirects unauthenticated users to /handover/login automatically.
 */
const HANDOVER_URL = 'https://sonalit.vercel.app/handover';

const config: CapacitorConfig = {
  appId: 'io.sonalit.handover',
  appName: 'Sonalit Handover',
  webDir: 'www',
  backgroundColor: '#0B111C',
  server: {
    url: HANDOVER_URL,
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#0B111C',
  },
};

export default config;
