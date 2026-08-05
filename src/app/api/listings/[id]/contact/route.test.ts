import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/listings/[id]/contact — the reply-first gate on a seller's PHONE NUMBER.
 *
 * ⚠️ THIS ROUTE IS THE ONE THAT HANDS OUT PII, AND IT HAD NO TESTS. Listing IDs are public and
 * enumerable, so without the gate a single signed-in account could walk the catalogue and harvest
 * every seller's phone number. The route's own comment records that the reply-first rule "was
 * previously enforced only in the UI" — i.e. this exact hole was once open — and nothing in the
 * suite has pinned it shut since.
 *
 * The gate has four independent parts and each is one line:
 *   · a listing must exist AND be `verified`  → a pending/hidden listing exposes nothing
 *   · the caller must already have a conversation for that listing
 *   · someone OTHER than the caller must have posted in it — `senderProfileId: { not: user.id }`
 *   · the seller must have a real stored phone
 * The third is the subtle one. Drop the `not` and a buyer satisfies "the seller replied" with their
 * OWN opening message, which turns the gate into a formality: send anything, then read the number.
 * That case is tested explicitly below because it is invisible in a happy-path test.
 */

type Row = Record<string, any>

const LISTING_ID = 'listing-1'
const BUYER = 'buyer-1'
const SELLER = 'seller-1'

const h = vi.hoisted(() => ({
  user: { id: 'buyer-1', email: 'b@example.test', phone: null } as Row | null,
  listing: null as Row | null,
  convo: null as Row | null,
  /** Messages in the thread, as { senderProfileId }. */
  messages: [] as Row[],
  rateOk: true,
  reveals: [] as Row[],
}))

vi.mock('next/server', async (orig) => {
  const actual = await orig<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => { void fn() } }
})
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: vi.fn(async (w: Row) => w) }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => ({ success: h.rateOk, remaining: 10 }),
}))
vi.mock('@/lib/contact', () => ({
  phoneForSeller: ({ phone }: Row) => phone ?? null,
  telHref: (p: string) => `tel:${p}`,
  zaloHref: (p: string) => `https://zalo.me/${p}`,
}))
vi.mock('@/lib/meta-capi', () => ({ sendMetaCapiEvent: async () => {}, metaUserDataFromHeaders: () => ({}) }))
vi.mock('@/lib/db', () => ({
  db: {
    listing: { findFirst: async () => h.listing, update: async () => ({}) },
    // ⚠️ HONOURS ITS `where`, because a mock that ignores it cannot fail. The real lookup is by the
    // composite unique { listingId, buyerProfileId }; if the route regressed to "this caller has
    // ANY conversation", an always-return mock would stay green while phone numbers leaked across
    // enumerable listings. Raised by a reviewer of the first version of this file, and correct.
    conversation: {
      findUnique: async ({ where }: Row) => {
        const key = where?.listingId_buyerProfileId
        if (!h.convo || !key) return null
        return key.listingId === h.convo.listingId && key.buyerProfileId === h.convo.buyerProfileId ? h.convo : null
      },
    },
    // The real predicate is `senderProfileId: { not: <caller> }` — model it, so a test can tell
    // "someone else spoke" from "anyone spoke".
    message: {
      findFirst: async ({ where }: Row) => {
        const notId = where?.senderProfileId?.not
        const hit = h.messages.find((m) => (notId === undefined ? true : m.senderProfileId !== notId))
        return hit ? { id: 'm1' } : null
      },
    },
    contactReveal: { create: async ({ data }: Row) => { h.reveals.push(data); return data } },
    $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
  },
}))

const { POST } = await import('@/app/api/listings/[id]/contact/route')
const { scopedListingWhere } = await import('@/lib/edition-scope')

const call = () => POST(new Request('https://eno.vn/api/listings/listing-1/contact', { method: 'POST' }),
  { params: Promise.resolve({ id: LISTING_ID }) })

const verifiedListing = (over: Row = {}) => ({ id: LISTING_ID, verified: true, seller: { id: SELLER, phone: '+84901234567' }, ...over })

afterEach(() => { vi.unstubAllEnvs() })

beforeEach(() => {
  h.user = { id: BUYER, email: 'b@example.test', phone: null }
  h.listing = verifiedListing()
  h.convo = { id: 'convo-1', listingId: LISTING_ID, buyerProfileId: BUYER }
  h.messages = [{ senderProfileId: SELLER }] // the seller has replied
  h.rateOk = true
  h.reveals = []
  vi.clearAllMocks()
})

describe('who is refused, and with which code', () => {
  it('an anonymous caller gets 401 and no phone', async () => {
    h.user = null
    const res = await call()
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'auth_required' })
  })

  it('a rate-limited caller gets 429', async () => {
    h.rateOk = false
    expect((await call()).status).toBe(429)
  })

  it('an UNVERIFIED listing is a 404, not a reveal', async () => {
    // A pending or moderated-down listing must expose nothing at all, including its existence.
    h.listing = verifiedListing({ verified: false })
    expect((await call()).status).toBe(404)
  })

  it('a missing listing is a 404', async () => {
    h.listing = null
    expect((await call()).status).toBe(404)
  })

  it('a seller with no stored phone is a 404, never a synthetic number', async () => {
    h.listing = verifiedListing({ seller: { id: SELLER, phone: null } })
    const res = await call()
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'no_contact' })
  })
})

describe('the reply-first gate — the anti-harvesting rule', () => {
  it('a conversation belonging to a DIFFERENT buyer does not count', async () => {
    // The composite key is { listingId, buyerProfileId }. A caller with a thread on some other
    // listing — or another buyer's thread on this one — must not satisfy the gate.
    h.convo = { id: 'convo-other', listingId: LISTING_ID, buyerProfileId: 'someone-else' }
    expect((await call()).status).toBe(403)
  })

  it('a conversation on a DIFFERENT listing does not count', async () => {
    h.convo = { id: 'convo-other', listingId: 'listing-999', buyerProfileId: BUYER }
    expect((await call()).status).toBe(403)
  })

  it('no conversation at all → 403 reply_required', async () => {
    h.convo = null
    const res = await call()
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ error: 'reply_required' })
  })

  it('a conversation where the seller has NOT replied → 403', async () => {
    h.messages = [] // buyer opened a thread; silence since
    expect((await call()).status).toBe(403)
  })

  it('⚠️ the buyer\'s OWN message does NOT satisfy "the seller replied"', async () => {
    // THE BYPASS THIS FILE EXISTS FOR. If `senderProfileId: { not: user.id }` were relaxed, a
    // harvester would send one message per listing and read the number straight back — the gate
    // would cost them a single POST. Every other test here passes with the `not` removed.
    h.messages = [{ senderProfileId: BUYER }]
    const res = await call()
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ error: 'reply_required' })
  })

  it('once the seller has replied, the number is revealed', async () => {
    // The positive case, so the refusals above cannot be passing for the wrong reason.
    h.messages = [{ senderProfileId: SELLER }]
    const res = await call()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ phone: '+84901234567' })
  })
})

describe('what the reveal records', () => {
  it('logs the reveal against listing and viewer', async () => {
    await call()
    expect(h.reveals).toHaveLength(1)
    expect(h.reveals[0]).toMatchObject({ listingId: LISTING_ID, viewerId: BUYER })
  })

  it('stores ipHash NULL while CONTACT_IP_SALT is unset, rather than a guessable digest', async () => {
    // Pins the 2026-08-05 PII fix: the salt has no default any more, and the route degrades to
    // NULL instead of writing a sha256 whose salt is a literal in a public repo (IPv4 is 2^32, so
    // such a digest is reversible). If someone reintroduces a fallback salt, this fails.
    //
    // ⚠️ stubEnv, NOT `delete` — an earlier version deleted the variable and never put it back,
    // which a reviewer flagged: vitest shares a process across the files in a worker, so a bare
    // delete makes any later test that reads it order-dependent. `vi.unstubAllEnvs` in afterEach
    // restores whatever the environment actually had.
    vi.stubEnv('CONTACT_IP_SALT', '')
    await call()
    expect(h.reveals[0].ipHash).toBeNull()
  })

  it('scopes the listing lookup through the EDITION filter', async () => {
    // The route reveals a phone number, so the listing it resolves must be edition-scoped —
    // `scopedListingWhere` is what stops a licensed-marketplace request resolving a services-only
    // desk listing. It is stubbed to identity here (this file is about the reply-first gate), so
    // assert that it is CALLED rather than pretending to prove the scoping itself. Raised by a
    // reviewer as a coverage gap, and this is the honest amount of it a route test can close.
    await call()
    expect(scopedListingWhere).toHaveBeenCalledWith({ id: LISTING_ID })
  })
})
