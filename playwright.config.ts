import { defineConfig } from '@playwright/test';

const API = 'http://localhost:8788';
export default defineConfig({
  testDir: 'e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5174', viewport: { width: 1440, height: 900 }, acceptDownloads: true },
  webServer: [
    {
      command: 'npx tsx apps/server/src/main.ts',
      url: `${API}/api/health`,
      reuseExistingServer: false,
      env: { PORT: '8788', DATABASE_URL: process.env.DECK_TEST_DATABASE_URL ?? 'postgres://deck@localhost:5439/deck_test', DECK_PUBLIC_URL: 'http://localhost:5174', DECK_AUTH_RATE: '1000' },
    },
    { command: 'npx vite apps/web --port 5174 --strictPort', url: 'http://localhost:5174', reuseExistingServer: false, env: { DECK_API: API } },
  ],
});
