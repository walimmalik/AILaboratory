import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a real API and Postgres. They need DATABASE_URL, a bootstrapped lab and
 * E2E_EMAIL / E2E_PASSWORD for its first user (CI sets these up; see .github/workflows/ci.yml).
 * The API runs with AILAB_TEST_KINDS=1 so the test-only "widget" kind exists, and with the scripted
 * model so the assistant runs without a network or a key.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    // Lets a machine with a preinstalled Chromium skip the browser download.
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  webServer: [
    {
      command: 'pnpm --filter @ailab/api exec tsx --conditions=source src/index.ts',
      url: 'http://localhost:3001/health',
      env: { AILAB_TEST_KINDS: '1', API_PORT: '3001', AGENT_PROVIDER: 'scripted' },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm exec vite --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
