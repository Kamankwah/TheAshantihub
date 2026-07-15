import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
