import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import cesium from 'vite-plugin-cesium';
import path from 'path';

function clientPhoneValidationHotfix(): Plugin {
  return {
    name: 'sonalit-client-phone-validation-hotfix',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/ClientOnboardingV3.tsx')) return null;
      const malformed = '/^\\\\+?[0-9][0-9 ()-]{6,}$/';
      const corrected = '/^\\+?[0-9][0-9 ()-]{6,}$/';
      const count = code.split(malformed).length - 1;
      if (count !== 2) {
        throw new Error(`Client phone validation hotfix expected 2 malformed validators, found ${count}`);
      }
      return { code: code.split(malformed).join(corrected), map: null };
    },
  };
}

export default defineConfig({
  plugins: [
    clientPhoneValidationHotfix(),
    react(),
    cesium(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
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
    sourcemap: false,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        appShell: path.resolve(__dirname, 'app-shell.html'),
      },
      output: {
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
