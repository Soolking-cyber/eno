import { defineConfig, devices, type Project } from '@playwright/test'
import { existsSync } from 'node:fs'

// ── E2E config ──────────────────────────────────────────────────────────────────────
// Two modes, chosen by env so the suite is safe-by-default:
//
//  • GUEST (default): read-only flows against a real deploy (prod by default). No auth, no
//    writes — cannot corrupt data, needs zero infra. `E2E_BASE` overrides the target.
//  • AUTHED (opt-in): set `E2E_AUTHED_BASE` to a PREVIEW deploy (never prod) backed by a
//    seeded Supabase branch. global-setup logs the seeded test users in and the seller/admin
//    projects run the write-flows. Absent that env, those projects are simply not registered,
//    and any authed spec self-skips — so prod data is never mutated and no creds live in repo.
const GUEST_BASE = (process.env.E2E_BASE || 'https://eno.vn').replace(/\/$/, '')
const AUTHED_BASE = process.env.E2E_AUTHED_BASE?.replace(/\/$/, '') || ''
const AUTH_DIR = 'e2e/.auth'

const guestProjects: Project[] = [
  { name: 'guest-desktop', use: { ...devices['Desktop Chrome'], baseURL: GUEST_BASE }, testMatch: /guest\/.*\.spec\.ts/ },
  // Mobile viewport — VN traffic is mobile-first, so the layout must hold on a phone too.
  { name: 'guest-mobile', use: { ...devices['Pixel 5'], baseURL: GUEST_BASE }, testMatch: /guest\/.*\.spec\.ts/ },
]

// Authed projects only exist when a preview base is configured. Each depends on the `setup`
// project, which produces the role storageState; we only wire storageState if it was created.
const authedProjects: Project[] = AUTHED_BASE
  ? [
      { name: 'setup', use: { baseURL: AUTHED_BASE }, testMatch: /auth\.setup\.ts/ },
      {
        name: 'seller', dependencies: ['setup'], testMatch: /seller\/.*\.spec\.ts/,
        use: { ...devices['Desktop Chrome'], baseURL: AUTHED_BASE, ...(existsSync(`${AUTH_DIR}/seller.json`) ? { storageState: `${AUTH_DIR}/seller.json` } : {}) },
      },
      {
        name: 'admin', dependencies: ['setup'], testMatch: /admin\/.*\.spec\.ts/,
        use: { ...devices['Desktop Chrome'], baseURL: AUTHED_BASE, ...(existsSync(`${AUTH_DIR}/admin.json`) ? { storageState: `${AUTH_DIR}/admin.json` } : {}) },
      },
      // The multi-actor golden-path smoke test. It opens its OWN seller + buyer contexts from the
      // captured storageStates (so no project-level storageState here), and runs serially.
      {
        name: 'smoke', dependencies: ['setup'], testMatch: /smoke\.spec\.ts/,
        use: { ...devices['Desktop Chrome'], baseURL: AUTHED_BASE },
      },
    ]
  : []

export default defineConfig({
  testDir: 'e2e',
  // Read-only guest flows are safe to parallelise hard; keeps the wall-clock low.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,         // a stray .only must fail CI, never silently narrow it
  retries: 1, // post-deploy ISR regeneration transiently trips the a11y homepage spec — one retry absorbs it (was CI-only)
  workers: process.env.CI ? 4 : undefined,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: GUEST_BASE,
    trace: 'on-first-retry',            // capture a full trace only when a test flakes/fails
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [...guestProjects, ...authedProjects],
})
