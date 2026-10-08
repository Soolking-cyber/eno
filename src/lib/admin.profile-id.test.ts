import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE CALLER'S ID IS THE VERIFIED JWT SUBJECT — the Supabase auth user id, which the browser holds as
 * `session.user.id` (auth-context.tsx). GET /api/conversations/[id] answers it as `me`, and the thread page and its
 * cache refuse any answer whose `me` is not the account on screen (F5). This pins the server half: getCurrentProfileId()
 * returns `sub` as it is, never a looked-up profile row (Profile.id is "= auth.users.id" anyway — schema.prisma, held
 * by profile_auth_fk). Harness after admin.missing-profile.test.ts.
 */

const h = vi.hoisted(() => ({
  claims: null as Record<string, unknown> | null,
  error: null as unknown,
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: { getClaims: async () => ({ data: h.claims ? { claims: h.claims } : null, error: h.error }) },
  }),
}))
vi.mock('next/headers', () => ({ headers: async () => ({ get: () => null }) }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/profile', () => ({ ensureProfile: async () => null }))
vi.mock('@/lib/trust', () => ({ recordPhoneVerified: async () => {}, BASE_SCORE: 60, PHONE_VERIFIED_BONUS: 10 }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))

const { getCurrentProfileId } = await import('./admin')

beforeEach(() => { h.claims = null; h.error = null })

describe('getCurrentProfileId (F5: the `me` every thread answer carries)', () => {
  it('is the verified token\'s `sub`, exactly — the auth user id the client holds as session.user.id', async () => {
    h.claims = { sub: '0b6f2c1e-8d4a-4f5e-9c3b-2a1d0e9f8c7b', email: 'seller@example.com', role: 'authenticated' }
    expect(await getCurrentProfileId()).toBe('0b6f2c1e-8d4a-4f5e-9c3b-2a1d0e9f8c7b')
  })

  it('no verified claims (no session, or a bad token) → null, never another id', async () => {
    expect(await getCurrentProfileId()).toBeNull()
    h.claims = { sub: 'x' }
    h.error = new Error('invalid JWT')
    expect(await getCurrentProfileId()).toBeNull()
  })
})
