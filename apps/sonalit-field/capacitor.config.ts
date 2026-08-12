import type { CapacitorConfig } from '@capacitor/cli';

/*
 * Sonalit CDS Field APK — Yard & Port teams.
 *
 * A native shell around the hosted web app that lands the operator directly
 * inside the mobile-first field flow at /field:
 *   • Yard: clamp e-locks onto booking containers before dispatch
 *   • Port: unclamp on arrival, mark delivered, notify supervisors
 *
 * Same delivery pattern as apps/sonalit-app: server.url points at the deployed
 * site so every UI/feature change in apps/web ships the moment the web deploys
 * — installed devices never reinstall for /field changes; only native/plugin
 * changes (Geolocation, new Capacitor plugins) trigger a new APK.
 *
 * We enter the site via /login?redirect=/field so authenticated crews land
 * straight on the role picker, and unauthenticated crews get bounced through
 * login and then back to /field on success.
 *
 * appId is intentionally different from io.sonalit.app so both apps can be
 * installed side-by-side on the same device (a supervisor may hold both).
 */
const FIELD_URL = 'https://sonalit.vercel.app/login?redirect=/field';

const config: CapacitorConfig = {
  appId: 'io.sonalit.field',
  appName: 'Sonalit Field',
  webDir: 'www',
  backgroundColor: '#0B111C',
  server: {
    url: FIELD_URL,
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#0B111C',
  },
};

export default config;
