import type { CapacitorConfig } from '@capacitor/cli';

/*
 * Sonalit Handover APK — Handover Officers.
 *
 * A thin native shell, same pattern as apps/sonalit-field and apps/sonalit-app:
 * no local UI code here, just a WebView pointed at the hosted /handover route.
 * Workflow changes ship on every web deploy, no new APK needed.
 *
 * Unlike /field (device pairing + PIN, no operator session at all), /handover
 * sits under the normal authRoute — a handover officer signs in with their
 * regular Sonalit email/password, same as any other operator role. If that
 * session is missing, authCheck (apps/web/src/router.tsx) redirects to
 * /login?redirect=/handover, so the app lands back on Handover — not the
 * full operator launcher — right after signing in.
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
