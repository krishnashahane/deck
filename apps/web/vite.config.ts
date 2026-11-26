/// <reference types="node" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': process.env.DECK_API ?? 'http://localhost:8787',
      '/sync': { target: (process.env.DECK_API ?? 'http://localhost:8787').replace('http', 'ws'), ws: true },
    },
  },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1500 },
});
