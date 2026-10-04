import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'pieces/*'],
      manifest: {
        name: 'Schönberg Hero',
        short_name: 'Schönberg',
        description: 'Learn your choir part, Guitar-Hero style.',
        theme_color: '#0B0D1A',
        background_color: '#0B0D1A',
        display: 'standalone',
        orientation: 'portrait',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,json,musicxml,xml,mxl,mid}'] },
    }),
  ],
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'] },
});
