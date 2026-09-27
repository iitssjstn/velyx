import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pkg from './package.json' with { type: 'json' };

const backend = process.env.VIDALUNE_DEV_BACKEND ?? process.env.VELYX_DEV_BACKEND ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The version goes into the service worker's address, so every update installs it again.
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version) },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: backend, changeOrigin: false },
      '/health': { target: backend },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 600,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
});
