import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/sellers/[id]/reviews — THE THIRD BRANCH: a review after a seller-confirmed rental, lesson or service
 * (src/lib/service-deal.ts; owner 2026-11-11, superseding rule 1 of 2026-10-25 for these listings only). The Review is
 * written with `basis` and the deal's listing, in ONE transaction with the conditional reviewId lock — so the seller's undo
 * and the review can never both land. The goods path is unchanged and never touches `basis` or the deal table.
 * Spec v3: the review opens only once the 10-minute undo has closed (A2, review_not_open); the lock re-asserts every fact
 * (A3, incl. declinedAt and confirmedAt <= now − 10 min) and a lost lock names what won; a basis review is no trust input
 * (A4 — no positive_review event); a seller this edition hides is a 404 on every path (A7).
 * 2026-11-11 fixes: THE ROW DECIDES (the deal row is read on every listing thread; its kind, listing and storefront decide,
 * never the listing's current type — only a takedown still refuses) and THE OFFER PATH WINS (an accepted offer or a named
 * sale writes the plain review, and a deal in the thread is linked to it).
 */

type Row = Record<string, any>
const DAY = 86_400_000
const BUYER = 'buyer-1'

const h = vi.hoisted(() => ({
  me: 'buyer-1',
  listing: {} as Row,
  acceptedOffers: 0,
  deal: null as Row | null,
  dealReads: 0,
  missingTable: false,
  reviews: [] as Row[],
  events: [] as Row[],
  removed: false,
  /** Runs inside the review transaction, between the Review insert and the lock — a concurrent write landing there. */
  duringTx: null as null | (() => void),
  /** A7: the storefront is hidden on this edition; and how many times the thread was read. */
  hidden: false,
  hiddenAsked: [] as string[],
  convoReads: 0,
  /** recordReview calls (the zero-delta positive_review trust event) — A4: never for a basis review. */
  trustCalls: [] as string[],
  /** The lock's where, as sent. */
  lockWheres: [] as Row[],
  /** The deal's OWN listing (L-deal), read by id because the thread now points at L-now (dealListingCompliance). */
  dealListing: { complianceStatus: null } as Row | null,
  /** A deal read that fails with something other than a missing table. */
  dealReadFails: false,
}))

function matches(row: Row, where: Row): boolean {
  for (const [k, cond] of Object.entries(where)) {
    const v = row[k]
    if (cond === null) { if (v != null) return false; continue }
    if (typeof cond === 'object' && !(cond instanceof Date)) {
      if ('not' in cond && cond.not === null && v == null) return false
      if ('gte' in cond && !(v != null && v >= cond.gte)) return false
      if ('lte' in cond && !(v != null && v <= cond.lte)) return false
      continue
    }
    if (v !== cond) return false
  }
  return true
}

vi.mock('@/lib/admin', () => ({
  getCurrentProfile: async () => ({ id: h.me, displayName: 'Lan', email: 'lan@example.com' }),
  getCurrentProfileId: async () => h.me,
  getAdmin: async () => null,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }), kv: { incrby: async () => 1 } }))
vi.mock('@/lib/enforcement', () => ({ messagingGate: async () => null }))
vi.mock('@/lib/trust', () => ({ recordReview: async (id: string) => { h.trustCalls.push(id) } }))
vi.mock('@/lib/edition-scope', () => ({ isSellerHiddenHere: async (id: string) => { h.hiddenAsked.push(id); return h.hidden } }))
vi.mock('next/server', async (orig) => ({ ...(await orig<Record<string, unknown>>()), after: (fn: () => unknown) => { void fn() } }))
vi.mock('@/lib/db', () => {
  const missing = () => Object.assign(new Error('The table `public.DealConfirmation` does not exist'), { code: 'P2021' })
  const db: Row = {
    conversation: { findUnique: async () => { h.convoReads++; return { id: 'c1', buyerProfileId: BUYER, listing: { id: 'L-now', sellerId: 'shop-1', ...h.listing } } } },
    message: { count: async () => h.acceptedOffers },
    forumModerationAction: { findFirst: async () => (h.removed ? { id: 'mod1' } : null) },
    review: {
      create: async ({ data }: Row) => {
        if (h.reviews.some((r) => r.conversationId === data.conversationId)) throw Object.assign(new Error('Unique'), { code: 'P2002' })
        const r = { id: `r${h.reviews.length + 1}`, ...data }
        h.reviews.push(r)
        return { id: r.id }
      },
      aggregate: async () => ({ _avg: { rating: 5 }, _count: { _all: h.reviews.length } }),
    },
    seller: { findUnique: async () => ({ ownerId: 'seller-p' }), update: async () => ({}) },
    dealConfirmation: {
      findUnique: async () => {
        h.dealReads++
        if (h.missingTable) throw missing()
        if (h.dealReadFails) throw new Error('connection reset')
        return h.deal ? { ...h.deal } : null
      },
      updateMany: async ({ where, data }: Row) => {
        h.lockWheres.push(where)
        if (!h.deal || !matches(h.deal, where)) return { count: 0 }
        Object.assign(h.deal, data)
        return { count: 1 }
      },
    },
    dealConfirmationEvent: { create: async ({ data }: Row) => { h.events.push(data); return {} } },
    // The deal's listing (also re-read under the deal row's lock); null = gone.
    listing: { findUnique: async () => h.dealListing },
  }
  // The review lock judges its window on the DATABASE's clock (dbNow): `h.dbNow` when a test moves it, else the request's.
  db.$queryRaw = async (strings: TemplateStringsArray) => (strings.join('?').includes('clock_timestamp()') ? [{ now: (h as Row).dbNow ?? new Date() }] : [])
  db.$transaction = async (fn: (tx: Row) => Promise<unknown>) => {
    const before = { reviews: h.reviews.length, deal: h.deal ? { ...h.deal } : null }
    const tx: Row = {
      ...db,
      review: { ...db.review, create: async (a: Row) => { const r = await db.review.create(a); h.duringTx?.(); return r } },
    }
    try { return await fn(tx) } catch (e) {
      h.reviews.length = before.reviews
      // A write that committed OUTSIDE this transaction (duringTx) is not ours to roll back.
      if (!h.duringTx) h.deal = before.deal
      throw e
    }
  }
  return { db }
})

const { POST } = await import('./route')

async function review(as = BUYER) {
  h.me = as
  const res = await POST(new Request('https://eno.vn/api/sellers/shop-1/reviews', { method: 'POST', body: JSON.stringify({ conversationId: 'c1', rating: 4, text: 'Great room' }) }) as never, { params: Promise.resolve({ id: 'shop-1' }) } as never)
  return { status: res.status, body: (await res.json()) as Row }
}

const rental = (over: Row = {}): Row => ({
  listingType: 'rent', category: { slug: 'rentals' }, status: 'active', complianceStatus: null, soldChannel: null, soldToProfileId: null,
  soldAt: null, salePrice: null, saleConfirmedAt: null, saleDeclinedAt: null, saleBuyerHistory: null, saleConfirmPromptedAt: null, ...over,
})
const confirmed = (over: Row = {}): Row => ({
  // The deal's OWN listing — not the thread's current one (L-now) — is what the review is filed against.
  conversationId: 'c1', listingId: 'L-deal', sellerId: 'shop-1', sellerProfileId: 'seller-p', buyerProfileId: BUYER, kind: 'rental',
  confirmedAt: new Date(Date.now() - DAY), revokedAt: null, declinedAt: null, confirmCount: 1, reviewId: null, ...over,
})

beforeEach(() => {
  h.me = BUYER; h.listing = rental(); h.acceptedOffers = 0; h.deal = confirmed(); h.dealReads = 0; h.missingTable = false
  h.reviews = []; h.events = []; h.removed = false; h.duringTx = null
  h.hidden = false; h.hiddenAsked = []; h.convoReads = 0; h.trustCalls = []; h.lockWheres = []
  h.dealListing = { complianceStatus: null }; h.dealReadFails = false
})

describe('a review after a confirmed rental / lesson / service', () => {
  it('201: Review.basis = the kind, Review.listingId = the deal\'s listing, the deal locked to the review in the same transaction', async () => {
    const res = await review()
    expect(res.status).toBe(201)
    expect(h.reviews).toHaveLength(1)
    expect(h.reviews[0]).toMatchObject({ sellerId: 'shop-1', authorProfileId: BUYER, conversationId: 'c1', listingId: 'L-deal', basis: 'rental', rating: 4 })
    expect(h.deal!.reviewId).toBe(h.reviews[0]!.id)
    expect(h.events).toEqual([{ conversationId: 'c1', listingId: 'L-deal', sellerId: 'shop-1', actorProfileId: BUYER, buyerProfileId: BUYER, action: 'reviewed' }])
  })

  it('a lesson and a service carry their own basis', async () => {
    h.listing = rental({ listingType: 'teacher', category: { slug: 'teachers' } })
    h.deal = confirmed({ kind: 'lesson' })
    await review()
    expect(h.reviews[0]!.basis).toBe('lesson')
  })

  it('⛔ withdrawn: 403 deal_withdrawn, nothing written', async () => {
    h.deal = confirmed({ confirmedAt: null, revokedAt: new Date() })
    expect(await review()).toEqual({ status: 403, body: { error: 'deal_withdrawn' } })
    expect(h.reviews).toEqual([])
  })

  it('⛔ past 30 days: 403 review_window_closed', async () => {
    h.deal = confirmed({ confirmedAt: new Date(Date.now() - 31 * DAY) })
    expect(await review()).toEqual({ status: 403, body: { error: 'review_window_closed' } })
  })

  it('⛔ A3: declined by the buyer — 403 deal_declined (its own code); never confirmed — not_transacted (the goods answer)', async () => {
    h.deal = confirmed({ declinedAt: new Date() })
    expect(await review()).toEqual({ status: 403, body: { error: 'deal_declined' } })
    h.deal = null
    expect(await review()).toEqual({ status: 403, body: { error: 'not_transacted' } })
    expect(h.reviews).toEqual([])
  })

  it('⛔ A2: not while the seller\'s undo is open — 403 review_not_open, nothing written; open from confirmedAt + 10 min', async () => {
    h.deal = confirmed({ confirmedAt: new Date(Date.now() - 9 * 60_000) })
    expect(await review()).toEqual({ status: 403, body: { error: 'review_not_open' } })
    expect(h.reviews).toEqual([])
    expect(h.deal!.reviewId).toBeNull()
    h.deal = confirmed({ confirmedAt: new Date(Date.now() - 10 * 60_000 - 1_000) })
    expect((await review()).status).toBe(201)
  })

  it('⛔ A3: the lock re-asserts every fact — reviewId, revokedAt, declinedAt null; confirmedAt set, <= now − 10 min, inside 30 days', async () => {
    await review()
    const w = h.lockWheres[0]!
    expect(w).toMatchObject({ conversationId: 'c1', buyerProfileId: BUYER, reviewId: null, revokedAt: null, declinedAt: null })
    expect(w.confirmedAt.not).toBeNull()
    expect(Math.abs(w.confirmedAt.lte.getTime() - (Date.now() - 10 * 60_000))).toBeLessThan(5_000)
    expect(Math.abs(w.confirmedAt.gte.getTime() - (Date.now() - 30 * DAY))).toBeLessThan(5_000)
  })

  it('⛔ A4: a basis review moves the shown rating but writes NO trust event; a goods review still does', async () => {
    expect((await review()).status).toBe(201)
    expect(h.trustCalls).toEqual([])
    h.reviews = []; h.deal = null
    h.listing = rental({ listingType: 'sell', category: { slug: 'electronics' }, status: 'sold', soldChannel: 'eno', soldToProfileId: BUYER, soldAt: new Date() })
    expect((await review()).status).toBe(201)
    expect(h.trustCalls).toEqual(['seller-p'])
  })

  it('⛔ the seller or a stranger: 403 forbidden, before anything about the deal is read', async () => {
    expect(await review('seller-p')).toEqual({ status: 403, body: { error: 'forbidden' } })
    expect(await review('stranger')).toEqual({ status: 403, body: { error: 'forbidden' } })
    expect(h.dealReads).toBe(0)
  })

  it('one review per conversation (P2002 → 409) and the removed-review memory (409) hold as before', async () => {
    expect((await review()).status).toBe(201)
    h.deal!.reviewId = null // even with the lock somehow open, the unique index refuses a second one
    expect(await review()).toEqual({ status: 409, body: { error: 'already_reviewed' } })
    h.reviews = []; h.deal = confirmed(); h.removed = true
    expect(await review()).toEqual({ status: 409, body: { error: 'already_reviewed' } })
  })
})

describe('⛔ A7 — the edition boundary on EVERY path', () => {
  it('a storefront this edition hides: 404 not_found — service path, goods path, offer path — before the thread is even read', async () => {
    h.hidden = true
    expect(await review()).toEqual({ status: 404, body: { error: 'not_found' } })
    h.deal = null; h.acceptedOffers = 1
    expect(await review()).toEqual({ status: 404, body: { error: 'not_found' } })
    h.listing = rental({ listingType: 'sell', category: { slug: 'electronics' }, status: 'sold', soldChannel: 'eno', soldToProfileId: BUYER, soldAt: new Date() })
    expect(await review()).toEqual({ status: 404, body: { error: 'not_found' } })
    expect(h.hiddenAsked).toEqual(['shop-1', 'shop-1', 'shop-1'])
    expect(h.convoReads).toBe(0)
    expect(h.dealReads).toBe(0)
    expect(h.reviews).toEqual([])
  })

  it('…and a stranger or the seller hears the same 404 there (identity cannot be probed across editions)', async () => {
    h.hidden = true
    expect(await review('stranger')).toEqual({ status: 404, body: { error: 'not_found' } })
    expect(await review('seller-p')).toEqual({ status: 404, body: { error: 'not_found' } })
  })
})

describe('⛔ the race with the seller\'s undo — exactly one wins', () => {
  it('the undo lands between the insert and the lock: rollback, 403 deal_withdrawn, NO Review whose deal is revoked', async () => {
    h.duringTx = () => { Object.assign(h.deal!, { confirmedAt: null, revokedAt: new Date() }) }
    expect(await review()).toEqual({ status: 403, body: { error: 'deal_withdrawn' } })
    expect(h.reviews).toEqual([])
    expect(h.deal!.reviewId).toBeNull()
  })

  it('…an accepted offer never enters the race: the plain review (no basis) is written outside any deal lock', async () => {
    h.acceptedOffers = 1
    h.duringTx = () => { Object.assign(h.deal!, { confirmedAt: null, revokedAt: new Date() }) }
    expect((await review()).status).toBe(201)
    expect(h.reviews).toHaveLength(1)
    expect(h.reviews[0]).not.toHaveProperty('basis')
    expect(h.reviews[0]!.listingId).toBe('L-now')
  })

  it('⛔ A3: the buyer\'s "No" (another device) lands between the insert and the lock: rollback, 403 deal_declined, no Review', async () => {
    h.duringTx = () => { Object.assign(h.deal!, { declinedAt: new Date() }) }
    expect(await review()).toEqual({ status: 403, body: { error: 'deal_declined' } })
    expect(h.reviews).toEqual([])
    expect(h.deal!.reviewId).toBeNull()
  })

  it('⛔ A3: the row was withdrawn and re-confirmed a minute ago under a stale read: the lock\'s confirmedAt <= now − 10 min refuses — 403 review_not_open', async () => {
    h.duringTx = () => { Object.assign(h.deal!, { confirmedAt: new Date(Date.now() - 60_000), confirmCount: 2 }) }
    expect(await review()).toEqual({ status: 403, body: { error: 'review_not_open' } })
    expect(h.reviews).toEqual([])
    expect(h.deal!.reviewId).toBeNull()
  })

  it('the review landed first: the deal is locked to it (the deal route then answers already_reviewed)', async () => {
    await review()
    expect(h.deal!.reviewId).toBe('r1')
  })
})

describe('⛔ THE OFFER PATH WINS over a confirmed deal in the same thread', () => {
  it('accepted offer + confirmed deal: the PLAIN review (basis null — trust Q, "Verified buyer"), recordReview called, the deal linked to it', async () => {
    h.acceptedOffers = 1
    expect((await review()).status).toBe(201)
    expect(h.reviews).toHaveLength(1)
    expect(h.reviews[0]).not.toHaveProperty('basis')
    expect(h.reviews[0]!.listingId).toBe('L-now')
    expect(h.trustCalls).toEqual(['seller-p'])
    // The deal reads 'reviewed' — linked by a CONDITIONAL update (reviewId still null), never the service lock.
    expect(h.deal!.reviewId).toBe(h.reviews[0]!.id)
    expect(h.lockWheres).toEqual([{ conversationId: 'c1', reviewId: null }])
    expect(h.events).toEqual([])
  })

  it('…the same when 5 qualifies by a sale named to this buyer — any thread holding a row gets it linked', async () => {
    h.listing = rental({ listingType: 'sell', category: { slug: 'electronics' }, status: 'sold', soldChannel: 'eno', soldToProfileId: BUYER, soldAt: new Date() })
    expect((await review()).status).toBe(201)
    expect(h.reviews[0]).not.toHaveProperty('basis')
    expect(h.deal!.reviewId).toBe(h.reviews[0]!.id)
  })

  it('…a lost link race (the row already names another review) leaves the review standing', async () => {
    h.acceptedOffers = 1
    h.deal = confirmed({ reviewId: 'r-other' })
    expect((await review()).status).toBe(201)
    expect(h.deal!.reviewId).toBe('r-other')
  })

  it('⛔ …but the review and its link are ONE transaction (codex, round 3): a failed link writes no review, so a reviewed thread never keeps an open deal', async () => {
    h.acceptedOffers = 1
    h.reviews = []; h.deal = confirmed()
    const { db } = await import('@/lib/db') as unknown as { db: Row }
    const updateMany = db.dealConfirmation.updateMany
    db.dealConfirmation.updateMany = async () => { throw new Error('connection reset') }
    try {
      expect((await review()).status).toBe(500)
    } finally {
      db.dealConfirmation.updateMany = updateMany
    }
    expect(h.reviews).toHaveLength(0)
    expect(h.deal!.reviewId ?? null).toBeNull()
  })

  it('…a declined or withdrawn deal does not stop the offer review either (5 is its own fact)', async () => {
    h.acceptedOffers = 1
    h.deal = confirmed({ declinedAt: new Date() })
    expect((await review()).status).toBe(201)
    expect(h.reviews[0]).not.toHaveProperty('basis')
  })
})

describe('⛔ THE ROW DECIDES — the seller switched the listing after confirming', () => {
  it.each([
    ['wanted', { listingType: 'wanted', category: { slug: 'rentals' } }],
    ['sell (an unsold goods listing — no named buyer, no offer)', { listingType: 'sell', category: { slug: 'electronics' } }],
    ['job', { listingType: 'job', category: { slug: 'jobs' } }],
  ])('switched to %s: the review still lands on the deal — basis = the ROW\'s kind, listingId = the ROW\'s listing', async (_what, over) => {
    h.listing = rental(over)
    expect((await review()).status).toBe(201)
    expect(h.reviews[0]).toMatchObject({ basis: 'rental', listingId: 'L-deal' })
    expect(h.deal!.reviewId).toBe(h.reviews[0]!.id)
  })

  it('a lesson stays a lesson whatever the listing says now', async () => {
    h.listing = rental({ listingType: 'sell', category: { slug: 'electronics' } })
    h.deal = confirmed({ kind: 'lesson' })
    expect((await review()).status).toBe(201)
    expect(h.reviews[0]!.basis).toBe('lesson')
  })

  it('⛔ a takedown of the DEAL\'s listing (or the listing gone) still refuses — 403 not_transacted, nothing written', async () => {
    h.dealListing = { complianceStatus: 'taken_down' }
    expect(await review()).toEqual({ status: 403, body: { error: 'not_transacted' } })
    h.dealListing = null
    expect(await review()).toEqual({ status: 403, body: { error: 'not_transacted' } })
    expect(h.reviews).toEqual([])
  })

  it('⛔ a row of an unknown kind opens nothing', async () => {
    h.deal = confirmed({ kind: 'goods' })
    expect(await review()).toEqual({ status: 403, body: { error: 'not_transacted' } })
  })
})

describe('the goods path is unchanged', () => {
  it('a goods listing reads the deal row (tolerantly) but never writes basis', async () => {
    h.deal = null
    h.listing = rental({ listingType: 'sell', category: { slug: 'electronics' }, status: 'sold', soldChannel: 'eno', soldToProfileId: BUYER, soldAt: new Date() })
    expect((await review()).status).toBe(201)
    expect(h.dealReads).toBe(1)
    expect(h.reviews[0]).not.toHaveProperty('basis')
    expect(h.events).toEqual([])
  })

  it('⛔ a failed deal read never costs a goods / offer review; with no other way in it is the retryable 500, never "can\'t review"', async () => {
    h.dealReadFails = true
    h.listing = rental({ listingType: 'sell', category: { slug: 'electronics' }, status: 'sold', soldChannel: 'eno', soldToProfileId: BUYER, soldAt: new Date() })
    expect((await review()).status).toBe(201)
    h.reviews = []; h.listing = rental()
    const res = await review()
    expect(res.status).toBe(500)
    expect(res.body.error).not.toBe('not_transacted')
    expect(h.reviews).toEqual([])
  })

  it('⛔ migration tolerance: the deal table missing reads as "no deal" — the offer path still reviews, no 500', async () => {
    h.missingTable = true
    expect(await review()).toEqual({ status: 403, body: { error: 'not_transacted' } })
    h.acceptedOffers = 1
    expect((await review()).status).toBe(201)
    expect(h.reviews[0]).not.toHaveProperty('basis')
  })
})

describe('⛔ review round 4', () => {
  it('a listing closed while the review waited for the deal row\'s lock: 403 not_transacted (the card\'s own refusal), no review', async () => {
    h.deal = confirmed()
    let reads = 0
    const { db } = await import('@/lib/db') as unknown as { db: Row }
    const findUnique = db.listing.findUnique
    // The rule reads the listing open; the re-read under the lock finds it licence-held.
    db.listing.findUnique = async (...a: unknown[]) => (++reads > 1 ? { complianceStatus: null, verified: false, verificationNotes: 'licence:held' } : (findUnique as (...x: unknown[]) => unknown)(...a))
    try {
      const res = await review()
      expect(res.status).toBe(403)
      expect(res.body.error).toBe('not_transacted')
    } finally {
      db.listing.findUnique = findUnique
    }
    expect(h.reviews).toHaveLength(0)
  })
})

