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
    // Pin every cross-app origin used by assertions. The monorepo developer .env.local may point
    // at a marketplace dev server on another port; browser tests must never depend on that private
    // machine state. The backend proxy targets this forum process, whose own itinerary endpoint
    // supplies the expected unauthenticated contract without requiring an external server.
    command: 'FORUM_E2E_PREVIEW=1 NEXT_PUBLIC_MARKETPLACE_URL=https://eno.vn MARKETPLACE_API_URL=http://127.0.0.1:3101 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=e2e-public-key npm run dev',
    url: baseURL,
    reuseExistingServer: true,
  },
})
