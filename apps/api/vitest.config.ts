import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    environment: 'node',
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent', REDIS_URL: '', SMTP_HOST: '' },
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    pool: 'forks',
  },
});
