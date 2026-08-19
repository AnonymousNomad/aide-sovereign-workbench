import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true
  },
  webServer: [
    {
      command: 'node node/src/server.ts',
      url: 'http://127.0.0.1:4778/api/health',
      reuseExistingServer: true,
      timeout: 60000,
      env: { AIDE_ARCH_PORT: '4778', AIDE_VERSION: 'e2e' }
    },
    {
      command: 'node node_modules/vite/bin/vite.js preview --config browser/vite.config.ts',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: true,
      timeout: 60000
    }
  ]
});