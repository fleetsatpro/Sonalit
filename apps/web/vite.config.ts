import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.sonalit\.io\//,
            handler: 'NetworkFirst',
            options: { cacheName: 'api-cache', expiration: { maxEntries: 200, maxAgeSeconds: 300 } },
          },
        ],
      },
      manifest: {
        name: 'Sonalit Fleet',
        short_name: 'Sonalit',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@sonalit/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts'),
    },
  },
  server: { port: 3000, proxy: { '/v4': 'http://localhost:4000' } },
  build: { sourcemap: true, rollupOptions: { output: { manualChunks: { vendor: ['react', 'react-dom'], router: ['@tanstack/react-router'], query: ['@tanstack/react-query'], maps: ['maplibre-gl', 'deck.gl'] } } } },
});
