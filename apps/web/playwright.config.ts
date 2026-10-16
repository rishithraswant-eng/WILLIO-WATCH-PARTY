import { defineConfig, devices } from '@playwright/test';

/**
 * E2E: boots the server + web (dev servers locally, production builds in CI with E2E_PROD=1)
 * unless they are already running. Videos stream from public CDNs, so tests need internet.
 */
const prod = process.env.E2E_PROD === '1';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: prod ? 'npm start -w @blockparty/server' : 'npm run dev:server',
      cwd: '../..',
      url: 'http://localhost:4000/api/health',
      reuseExistingServer: true,
      timeout: 120_000,
      env: { RATE_LIMIT_REST: 'false' },
    },
    {
      command: prod ? 'npm start -w @blockparty/web' : 'npm run dev:web',
      cwd: '../..',
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
