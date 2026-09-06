import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import cesium from 'vite-plugin-cesium';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    cesium(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // index.html is replaced at build time by the prerendered public
        // homepage (scripts/prerender.tsx), so it can no longer serve as the
        // SPA navigation fallback — an operator opening /command offline would
        // get marketing markup first. app-shell.html is the application's own
        // shell (a build input, therefore precached) and is the fallback here
        // and in vercel.json. The public marketing URLs are excluded so they
        // are fetched for real and keep their prerendered content.
        navigateFallback: '/app-shell.html',
        navigateFallbackDenylist: [
          /^\/$/,
          /^\/(about|contact|fleet-management|convoy-management|container-delivery|security-operations)\/?$/,
          /^\/(robots\.txt|sitemap\.xml)$/,
        ],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        globIgnores: ['**/cesium/**', '**/Cesium.js', 'convoy.html', 'convoy-assets/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/api/'),
            method: 'GET',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 200, maxAgeSeconds: 300 },
              networkTimeoutSeconds: 5,
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
      manifest: {
        name: 'Sonalit',
        short_name: 'Sonalit',
        description: 'Sonalit fleet, convoy and container delivery operations platform.',
        // The installed PWA is the OPERATOR application, so it starts at the
        // authenticated launcher (which bounces to /login when there is no
        // session) rather than at the public marketing homepage now on '/'.
        start_url: '/home',
        scope: '/',
        theme_color: '#0B111C',
        background_color: '#000000',
        display: 'standalone',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@sonalit/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true },
      '/realtime': { target: 'ws://localhost:8000', ws: true, changeOrigin: true },
    },
  },
  build: {
    // Source maps let anyone reconstruct the original TypeScript from the
    // deployed bundle (auth flow, API surface, internal TODOs). Keep them
    // out of the production artifact entirely.
    sourcemap: false,
    rollupOptions: {
      // Two HTML entries: index.html becomes the public site (its built output
      // is overwritten with prerendered marketing HTML) and app-shell.html is
      // the SPA fallback the authenticated application is served from. Both
      // load the same /src/main.tsx bundle, so this adds no JavaScript.
      input: {
        main: path.resolve(__dirname, 'index.html'),
        appShell: path.resolve(__dirname, 'app-shell.html'),
      },
      output: {
        // maplibre/deck.gl are deliberately NOT force-chunked here. Naming
        // them made rollup hoist Vite's shared preload helper into that chunk,
        // so every entry — the login screen and now the public marketing
        // pages — statically imported ~1 MB of map code it never used. Left
        // alone, both libraries land in a chunk shared by the lazy map routes
        // that actually import them.
        manualChunks: {
          react: ['react', 'react-dom'],
          tanstack: ['@tanstack/react-router', '@tanstack/react-query'],
          crdt: ['yjs'],
          forms: ['react-hook-form', 'zod'],
        },
      },
    },
  },
});
