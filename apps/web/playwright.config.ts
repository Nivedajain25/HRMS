import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the real API on an in-memory, pre-seeded
 * MongoDB replica set (`dev:memory`) and the Vite dev server.
 * First run: `pnpm --filter @stencil/web exec playwright install chromium`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // PW_CHANNEL=chrome|msedge runs against an installed browser instead of the bundled Chromium.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL || undefined } }],
  webServer: [
    {
      command: 'corepack pnpm --filter @stencil/api dev:memory',
      url: 'http://localhost:5000/health',
      timeout: 240_000,
      reuseExistingServer: !process.env.CI,
      cwd: '../..',
    },
    {
      command: 'corepack pnpm --filter @stencil/web dev',
      url: 'http://localhost:5173',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      cwd: '../..',
    },
  ],
});
