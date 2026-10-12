import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

/**
 * The end-to-end suite on its own ports (API 5100, web 5273) with a fresh in-memory database, so it never reuses a
 * dev API already running on 5000 (which may point at a real database). Uploads stay in that database and push is
 * off, whatever the .env says.
 *   E2E_API_URL=http://localhost:5100/api/v1 pnpm --filter @stencil/web exec playwright test -c playwright.isolated.config.ts
 */
const API_PORT = 5100;
const WEB_PORT = 5273;

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: `http://localhost:${WEB_PORT}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL || undefined } }],
  webServer: [
    {
      command: 'corepack pnpm --filter @stencil/api dev:memory',
      url: `http://localhost:${API_PORT}/health`,
      timeout: 240_000,
      reuseExistingServer: false,
      cwd: '../..',
      env: {
        PORT: String(API_PORT),
        CLIENT_URL: `http://localhost:${WEB_PORT}`,
        STORAGE_PROVIDER: 'mongo',
        CLOUDINARY_URL: '',
        PUSH_ENABLED: 'false',
        FIREBASE_SERVICE_ACCOUNT: '',
      },
    },
    {
      command: `corepack pnpm --filter @stencil/web exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      timeout: 120_000,
      reuseExistingServer: false,
      cwd: '../..',
      env: { VITE_API_PROXY: `http://localhost:${API_PORT}` },
    },
  ],
});
