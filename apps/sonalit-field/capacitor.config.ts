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
 * We open /field directly — no longer /login?redirect=/field. The Field app
 * has its own login system now (device pairing + a per-worker PIN, see
 * apps/web/src/pages/field/fieldAuth.ts): /field is served outside the
 * operator route tree and shows its own pairing or PIN screen when it needs
 * one. Routing through /login would have asked a yard crew for an operator
 * password they are not issued and the backend would refuse anyway.
 *
 * appId is intentionally different from io.sonalit.app so both apps can be
 * installed side-by-side on the same device — and because the two sessions no
 * longer share any storage, a supervisor can be signed into each independently.
 */
const FIELD_URL = 'https://sonalit.vercel.app/field';

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
