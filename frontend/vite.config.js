import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Staff app service worker (docs/superpowers/specs/2026-10-03-staff-pwa-
    // responsive-design.md §2). Registered by lib/staffPwa.js, only on /staff*
    // pages, with scope "/staff" — the public marketplace is never controlled.
    // Precaches the built app shell only: no runtimeCaching, so API responses
    // are never stored on a staff device. Skipped under Vitest. The page side
    // uses workbox-window directly (not `virtual:pwa-register`) so that only
    // the tab that accepted an update reloads.
    !process.env.VITEST && VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: false, // public/staff.webmanifest, linked only on staff pages
      scope: '/staff',
      filename: 'sw.js',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackAllowlist: [/^\/staff(\/|$)/],
        cleanupOutdatedCaches: true,
        // The single app bundle is ~1.6 MB; Workbox's 2 MiB default leaves no headroom.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      // Flat frontend/ layout, no src/ — @ points at this directory's root
      // (frontend/), matching components.json's aliases below.
      '@': path.resolve(__dirname, '.'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.js'],
    globals: true,
  },
})
