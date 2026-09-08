import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import cesium from 'vite-plugin-cesium';
import path from 'path';

function clientPhoneValidationTransform(): Plugin {
  return {
    name: 'sonalit-client-phone-validation',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/ClientOnboardingV3.tsx')) return null;

      const legacyValidator = `function isValidPhoneInput(input: string, country = 'Kenya') {\n  const raw = String(input ?? '').trim();\n  if (!raw || !/^[+0-9()\\s-]+$/.test(raw)) return false;\n  const normalized = raw.replace(/[()\\s-]/g, '');\n  if (country.trim().toLowerCase() === 'kenya') return /^(?:07\\d{8}|\\+2547\\d{8})$/.test(normalized);\n  return /^\\+[1-9]\\d{7,14}$/.test(normalized) || /^[1-9]\\d{7,14}$/.test(normalized);\n}`;

      const hardenedValidator = `function isValidPhoneInput(input: string, country = 'Kenya') {\n  return isValidPhone(input, country);\n}`;

      let next = code;
      if (next.includes(legacyValidator)) next = next.replace(legacyValidator, hardenedValidator);
      if (!next.includes("from '../lib/phone.js'")) {
        next = `import { normalizePhone, isValidPhone } from '../lib/phone.js';\n${next}`;
      }

      next = next.replace(/phone: form\.phone\.trim\(\)/g, 'phone: normalizePhone(form.phone, form.country) ?? form.phone.trim()');
      return next === code ? null : { code: next, map: null };
    },
  };
}

export default defineConfig({
  plugins: [
    clientPhoneValidationTransform(),
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
