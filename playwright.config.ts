import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.E2E_BASE || 'http://127.0.0.1:3101'

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],
  webServer: process.env.E2E_BASE ? undefined : {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: true,
  },
})
