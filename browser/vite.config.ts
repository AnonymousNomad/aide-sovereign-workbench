import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4777',
        changeOrigin: false
      },
      '/ws': {
        target: 'ws://127.0.0.1:4777',
        ws: true,
        changeOrigin: false
      }
    }
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4777',
        changeOrigin: false
      },
      '/ws': {
        target: 'ws://127.0.0.1:4777',
        ws: true,
        changeOrigin: false
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
