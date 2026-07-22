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
const PROD_URL = 'https://sonalit.vercel.app';

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
