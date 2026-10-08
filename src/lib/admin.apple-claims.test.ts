import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What the caller's LOCALLY verified token says about Sign in with Apple (commit gate round 2):
 *   · isCurrentUserAppleLinkedByClaims — the Meta CAPI question (D14). It may only REMOVE the email hash, so "cannot
 *     tell" (no verified claims) answers TRUE — the hash stays home (O5);
 *   · currentAppleClaims — the self-service deletion's: the subject, the Apple link and the email, or null.
 */
const h = vi.hoisted(() => ({
  claims: null as Record<string, unknown> | null,
  throws: false,
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: {
      getClaims: async () => {
        if (h.throws) throw new Error('boom')
        return h.claims ? { data: { claims: h.claims }, error: null } : { data: null, error: new Error('no session') }
      },
    },
  }),
}))
vi.mock('next/headers', () => ({ headers: async () => ({ get: () => null }) }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/profile', () => ({ ensureProfile: async () => null }))
vi.mock('@/lib/trust', () => ({ recordPhoneVerified: async () => {}, BASE_SCORE: 60, PHONE_VERIFIED_BONUS: 10 }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))

const { currentAppleClaims, isCurrentUserAppleLinkedByClaims } = await import('./admin')

beforeEach(() => {
  h.claims = null
  h.throws = false
})

describe('isCurrentUserAppleLinkedByClaims (Meta CAPI, D14)', () => {
  it('reads app_metadata from the verified claims', async () => {
    h.claims = { sub: 'u1', app_metadata: { provider: 'email', providers: ['email', 'apple'] } }
    expect(await isCurrentUserAppleLinkedByClaims()).toBe(true)
    h.claims = { sub: 'u1', app_metadata: { provider: 'google', providers: ['google'] } }
    expect(await isCurrentUserAppleLinkedByClaims()).toBe(false)
    // ⛔ in any case (verifier, commit gate round 2): GoTrue keeps the provider as the authorize request spelled it
    h.claims = { sub: 'u1', app_metadata: { provider: 'Apple', providers: ['Apple'] } }
    expect(await isCurrentUserAppleLinkedByClaims()).toBe(true)
  })

  it('⛔ no verified claims — no session, a refused token, a throw — answers TRUE: the email hash stays home', async () => {
    expect(await isCurrentUserAppleLinkedByClaims()).toBe(true)
    h.throws = true
    expect(await isCurrentUserAppleLinkedByClaims()).toBe(true)
  })
})

describe('currentAppleClaims (the self-service deletion)', () => {
  it('the subject, whether app_metadata names Apple, and the email claim', async () => {
    h.claims = { sub: 'u1', email: 'x@privaterelay.appleid.com', app_metadata: { provider: 'apple', providers: ['apple'] } }
    expect(await currentAppleClaims()).toEqual({ id: 'u1', appleLinked: true, email: 'x@privaterelay.appleid.com' })
    h.claims = { sub: 'u2', app_metadata: { providers: ['email'] } }
    expect(await currentAppleClaims()).toEqual({ id: 'u2', appleLinked: false, email: null })
    // ⛔ an `Apple` account with a real, shared address: the retry's status is `manual`, never `none`
    h.claims = { sub: 'u3', email: 'jane@example.com', app_metadata: { provider: 'Apple', providers: ['Apple'] } }
    expect(await currentAppleClaims()).toEqual({ id: 'u3', appleLinked: true, email: 'jane@example.com' })
  })

  it('null without verified claims or without a subject', async () => {
    expect(await currentAppleClaims()).toBeNull()
    h.claims = { email: 'a@b.c' }
    expect(await currentAppleClaims()).toBeNull()
    h.throws = true
    expect(await currentAppleClaims()).toBeNull()
  })
})
