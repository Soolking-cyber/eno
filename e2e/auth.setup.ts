import { test as setup } from '@playwright/test'
import { createServerClient } from '@supabase/ssr'
import { mkdirSync, writeFileSync } from 'node:fs'

// ── Authed storageState producer (opt-in, never runs against prod) ──────────────────
// Only meaningful when E2E_AUTHED_BASE points at a PREVIEW deploy backed by a seeded
// Supabase branch. It signs the seeded test users in *programmatically* (password grant)
// and captures the session as a Playwright storageState per role — so the seller/admin
// specs reuse a cookie instead of doing a UI login per test.
//
// Correct-by-construction: the cookies are serialised by @supabase/ssr — the SAME library
// the app reads them with — so the format (incl. chunking) always matches. We never write a
// password into the repo; everything comes from env at run time:
//   E2E_AUTHED_BASE, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
//   E2E_SELLER_EMAIL, E2E_ADMIN_EMAIL, E2E_TEST_PASSWORD
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPA_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || ''
const PASSWORD = process.env.E2E_TEST_PASSWORD || ''
const AUTHED_BASE = process.env.E2E_AUTHED_BASE || ''
const AUTH_DIR = 'e2e/.auth'

const ROLES: Record<string, string | undefined> = {
  seller: process.env.E2E_SELLER_EMAIL,
  admin: process.env.E2E_ADMIN_EMAIL,
}

// Sign one role in and write its storageState. Returns false (→ spec skips) if not configured.
async function captureRole(role: string, email: string | undefined): Promise<boolean> {
  if (!email || !SUPA_URL || !SUPA_KEY || !PASSWORD || !AUTHED_BASE) return false
  const host = new URL(AUTHED_BASE).hostname
  const jar: { name: string; value: string }[] = []
  const supabase = createServerClient(SUPA_URL, SUPA_KEY, {
    cookies: {
      getAll: () => jar.map(({ name, value }) => ({ name, value })),
      setAll: (toSet) => { for (const c of toSet) jar.push({ name: c.name, value: c.value }) },
    },
  })
  const { error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`[auth.setup] ${role} sign-in failed: ${error.message}`)

  const cookies = jar.map((c) => ({
    name: c.name, value: c.value, domain: host, path: '/',
    expires: -1, httpOnly: false, secure: AUTHED_BASE.startsWith('https'), sameSite: 'Lax' as const,
  }))
  mkdirSync(AUTH_DIR, { recursive: true })
  writeFileSync(`${AUTH_DIR}/${role}.json`, JSON.stringify({ cookies, origins: [] }, null, 2))
  return true
}

setup('authenticate seeded roles', async () => {
  if (!AUTHED_BASE) { setup.skip(true, 'E2E_AUTHED_BASE not set — guest-only run'); return }
  for (const [role, email] of Object.entries(ROLES)) {
    const done = await captureRole(role, email)
    // eslint-disable-next-line no-console
    console.log(`[auth.setup] ${role}: ${done ? 'storageState written' : 'skipped (env missing)'}`)
  }
})
