import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright Configuration for ACM Mode A Isolated Mock Browser E2E.
 * Enforces strict network isolation, fail-closed offline mock verification,
 * and zero database mutations.
 */
export default defineConfig({
  testDir: './playwright/tests',
  fullyParallel: false, // Run sequentially for predictable network guard tracking
  forbidOnly: !!process.env.CI,
  retries: 0, // No retries to preserve test execution deterministic order
  workers: 1, // Single worker prevents mock interference and race conditions
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'off', // Evidence security: traces OFF by default to avoid leaking sensitive data
    screenshot: 'only-on-failure',
    video: 'off',
    serviceWorkers: 'block', // Block service workers to prevent cached requests or background sync
    actionTimeout: 10000,
    navigationTimeout: 15000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
  webServer: {
    command: 'npm run preview -- --port 4174 --host 127.0.0.1',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
