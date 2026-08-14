import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE CROSS-TENANT REFUSAL — the property that made the VietKite work shippable at all.
 *
 * eno.vn and eno.forum are one codebase deployed twice against ONE Supabase project, so
 * `visa_applications` holds BOTH deployments' cases in a single table. Every operator surface used
 * to select from it by case id with no owner predicate, which was correct only while the sole
 * operator was eno's own support account. Repointing VISA_SHOP_OWNER_EMAIL at a licensed partner
 * made them an operator — and `GET /api/visa/admin/applications/<any-uuid>/bundle` would have
 * handed them any eno.forum applicant's decrypted dossier and passport scans.
 *
 * ⚠️ THESE ASSERTIONS ARE ABOUT THE REAL PREDICATE, NOT A MOCK OF IT. `bundle.test.ts` and
 * `result.test.ts` stub `visaCaseInScope` to `true` because they are about what a route does once a
 * case IS in scope; that stub is exactly why the refusal itself needs its own file. If this test is
 * ever deleted, nothing anywhere proves a partner cannot read the other deployment's applicants.
 */

const h = {
  /** What Supabase answers for `visa_applications.conversation_id`. */
  conversationId: null as string | null,
  supabaseError: null as { code?: string } | null,
  /** Conversations the desk in question actually owns. */
  ownedByDesk: new Set<string>(),
  prismaCalls: 0,
}

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            h.supabaseError
              ? { data: null, error: h.supabaseError }
              : { data: { conversation_id: h.conversationId }, error: null },
        }),
      }),
    }),
  }),
}))

vi.mock('@/lib/db', () => ({
  db: {
    conversation: {
      findFirst: async ({ where }: { where: { id: string; sellerProfileId: string } }) => {
        h.prismaCalls += 1
        // The real predicate is `id = ? AND sellerProfileId = ?` — both must match.
        return h.ownedByDesk.has(where.id) && where.sellerProfileId === 'vietkite-profile'
          ? { id: where.id }
          : null
      },
    },
  },
}))

const { visaCaseInScope } = await import('./visa-admin')

const OURS = '11111111-1111-4111-8111-111111111111'
const THEIRS = '22222222-2222-4222-8222-222222222222'
const PARTNER = { operator: 'info@vietkite.com.vn', all: false as const, deskProfileId: 'vietkite-profile' }
const ADMIN = { operator: 'support@eno.vn', all: true as const }

beforeEach(() => {
  h.conversationId = null
  h.supabaseError = null
  h.ownedByDesk = new Set(['convo-ours'])
  h.prismaCalls = 0
})

describe('a partner desk sees only its own cases', () => {
  it('ALLOWS a case whose conversation this desk answers', async () => {
    h.conversationId = 'convo-ours'
    expect(await visaCaseInScope(OURS, PARTNER)).toBe(true)
  })

  /** THE ONE THAT MATTERS: an eno.forum case, named by uuid, by a real eno.vn desk operator. */
  it('REFUSES a case belonging to the other deployment', async () => {
    h.conversationId = 'convo-theirs'
    expect(await visaCaseInScope(THEIRS, PARTNER)).toBe(false)
  })

  it('REFUSES a case with no conversation at all — unbound is not "mine"', async () => {
    h.conversationId = null
    expect(await visaCaseInScope(OURS, PARTNER)).toBe(false)
  })

  it('REFUSES a non-uuid without touching either database', async () => {
    h.conversationId = 'convo-ours'
    expect(await visaCaseInScope('../../etc/passwd', PARTNER)).toBe(false)
    expect(h.prismaCalls, 'a malformed id must not reach a query').toBe(0)
  })
})

describe('it fails CLOSED, never open', () => {
  /**
   * ⚠️ A LOOKUP ERROR IS NOT "IN SCOPE". The tempting shape — treat a Supabase hiccup as
   * inconclusive and carry on — turns a transient outage into an open door on the one predicate
   * that separates two tenants' passport scans.
   */
  it('REFUSES when the case lookup errors', async () => {
    h.supabaseError = { code: '08006' }
    expect(await visaCaseInScope(OURS, PARTNER)).toBe(false)
  })

  it('REFUSES when the case row does not exist', async () => {
    h.conversationId = null
    expect(await visaCaseInScope('33333333-3333-4333-8333-333333333333', PARTNER)).toBe(false)
  })
})

describe('an eno admin is unaffected', () => {
  /**
   * ⚠️ THIS IS WHAT KEEPS eno.forum WORKING. Scoping EVERY operator would have hidden legacy cases
   * whose `conversation_id` was never backfilled from eno's own queue — a silent regression on the
   * working deployment in the name of securing the other one.
   */
  it('ALLOWS any case, including one with no conversation', async () => {
    h.conversationId = null
    expect(await visaCaseInScope(THEIRS, ADMIN)).toBe(true)
  })

  it('short-circuits before any query — an admin needs no lookup', async () => {
    await visaCaseInScope(THEIRS, ADMIN)
    expect(h.prismaCalls).toBe(0)
  })
})

/**
 * ⛔ THE ASSUMPTION eno.forum's CONTINUITY RESTS ON — pinned as far as a unit test honestly can.
 *
 * `getVisaDeskScope()` grants the wide `{ all: true }` scope only through `isAdminEmail()`. The
 * forum's working operator identity is `support@eno.forum`, which is ALSO the default
 * VISA_SHOP_OWNER_EMAIL — so if that address were dropped from ADMIN_EMAILS it would silently fall
 * to the NARROW desk scope, and every legacy case whose `conversation_id` was never backfilled would
 * vanish from the forum's own queue on the next deploy. A reviewer raised this and was right to.
 *
 * ⚠️ WHAT A UNIT TEST CANNOT DO, STATED RATHER THAN FAKED: it cannot pin the DEPLOYED value. The
 * first version of this test asserted `isAdminEmail('support@eno.forum')` directly and failed —
 * not because the claim is false (ADMIN_EMAILS is "support@eno.vn,support@eno.forum", measured
 * 2026-08-14) but because vitest does not load that env at all. An assertion that passes only when
 * a local env file happens to be present is a false guard, so it is gone. What IS pinned here is the
 * MECHANISM — that an admin identity takes the wide branch — and the env coupling is called out in
 * src/lib/desk-operator.ts where an operator changing ADMIN_EMAILS would actually read it.
 */
describe('an admin identity takes the WIDE branch', () => {
  it('isAdminEmail decides it, so ADMIN_EMAILS is load-bearing for the forum queue', async () => {
    vi.stubEnv('ADMIN_EMAILS', 'support@eno.vn,support@eno.forum')
    const { isAdminEmail } = await import('./admin')
    expect(isAdminEmail('support@eno.forum')).toBe(true)
    expect(isAdminEmail('SUPPORT@ENO.FORUM'), 'case-insensitive, like the real gate').toBe(true)
    expect(isAdminEmail('info@vietkite.com.vn'), 'a partner is NOT an admin').toBe(false)
    vi.unstubAllEnvs()
  })
})
