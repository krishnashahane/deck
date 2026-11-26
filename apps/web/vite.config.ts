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
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Stable vendor chunks cache across app releases.
        manualChunks(id: string) {
          if (id.includes('node_modules/react')) return 'react';
          if (/node_modules\/(yjs|y-protocols|y-indexeddb|y-websocket|lib0)\//.test(id)) return 'yjs';
          if (/node_modules\/(jszip|pako|lie|readable-stream|setimmediate|immediate|safe-buffer|string_decoder|util-deprecate|inherits|process-nextick-args|core-util-is|isarray)\//.test(id)) return 'zip';
          if (/node_modules\/(fast-xml-parser|strnum|@nodable)\//.test(id)) return 'xml';
        },
      },
    },
  },
});
