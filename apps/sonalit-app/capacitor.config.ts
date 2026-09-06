import type { CapacitorConfig } from '@capacitor/cli';

/*
 * Sonalit operator app — a thin NATIVE SHELL around the HOSTED web app.
 *
 * Unlike apps/guardian-convoy (which bundles its web assets, so every change
 * needs a fresh APK), this shell loads the deployed site via `server.url`.
 * Consequences:
 *   • UI / feature updates ship the moment the web app is deployed — installed
 *     users never reinstall and never need a new APK for web changes.
 *   • Only native/plugin changes (new Capacitor plugins, permissions) require a
 *     new APK, and even then Android applies it as an in-place update (same
 *     signing key + higher versionCode), never an uninstall/reinstall.
 *   • The app relies on the same-origin `/api/*` rewrite the web deployment
 *     already does (see vercel.json), so auth cookies, realtime and the API all
 *     work unchanged inside the WebView.
 *
 * To move off the default Vercel production alias, change `server.url` to your
 * custom domain (e.g. https://app.sonalit.io).
 */
// Root URL is the same web deployment used by the admin/desktop app. Field
// crews (Yard + Port) navigate to /field once signed in — a launcher screen
// there picks their role and drops them into the mobile-first clamp/unclamp
// flow. Keeping the shell pointed at the site root (not /field) means the
// same APK also works for anyone who opens the admin URL on their phone.
const PROD_URL = 'https://sonalit.vercel.app';

/*
 * Background location.
 *
 * The hosted web app can only hold GPS while its page is in the foreground, so
 * an installed driver running a journey with the screen locked would silently
 * stop reporting. @capacitor-community/background-geolocation adds a real
 * Android foreground service, and because this shell loads the site remotely,
 * the hosted bundle reaches it through window.Capacitor.Plugins without being
 * rebuilt — see apps/web/src/lib/trackingProviders.ts, which selects the native
 * provider only when the plugin is actually present and otherwise reports
 * `background_status: 'unsupported'` rather than inheriting the native
 * runtime's reputation.
 *
 * This one IS a native change, so unlike ordinary web updates it needs a new
 * APK (same signing key + higher versionCode → in-place update).
 */
const config: CapacitorConfig = {
  appId: 'io.sonalit.app',
  appName: 'Sonalit',
  webDir: 'www',
  backgroundColor: '#0B111C',
  server: {
    url: PROD_URL,
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#0B111C',
  },
};

export default config;
