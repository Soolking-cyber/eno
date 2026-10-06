import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GET /api/conversations/[id]/sale-question — what this thread's seller is asking the caller to confirm.
 *
 * Pins: only the thread's BUYER sees it (and a thread this edition hides answers 404, like the thread
 * itself); questions are found by SELLER (a retargeted thread shows another listing), edition-scoped,
 * and only the ones the answer route would accept are listed — open, inside the window, a sale of goods,
 * not the services desk — each carrying the price the buyer was ASKED about.
 */

type Row = Record<string, any>

const SELLER_P = '00000000-0000-4000-8000-0000000000aa'
const BUYER = '00000000-0000-4000-8000-000000000001'

const h = vi.hoisted(() => ({
  userId: '' as string | null,
  convo: null as Row | null,
  rows: [] as Row[],
  findManyArgs: [] as Row[],
  hidden: false,
  desk: false,
  scoped: [] as unknown[],
  /** ForumUserBlock rows (App Store gate `ugc-safety`), and how many times the table was asked. */
  blocks: [] as Row[],
  blockLookups: 0,
}))

vi.mock('@/lib/admin', () => ({
  getAdmin: async () => null,
  getCurrentProfile: async () => (h.userId ? { id: h.userId } : null),
  getCurrentProfileId: async () => h.userId,
  isAdminEmail: () => false,
}))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: { findUnique: async () => h.convo },
    listing: { findMany: async (a: Row) => { h.findManyArgs.push(a); return h.rows } },
    // The real gate check, a stubbed table: the gate decides whether the lookup runs at all.
    forumUserBlock: {
      findFirst: async ({ where }: { where: { OR: Row[] } }) => {
        h.blockLookups += 1
        return h.blocks.find((b) => where.OR.some((c) => c.blockerProfileId === b.blockerProfileId && c.blockedProfileId === b.blockedProfileId)) ?? null
      },
    },
    profile: { findUnique: async () => ({ email: 'someone@example.com' }) },
  },
}))
vi.mock('@/lib/edition-scope', () => ({
  isSellerHiddenHere: async () => h.hidden,
  isServicesDeskListing: async () => h.desk,
  // Marked, so the test can see the predicate went THROUGH the edition scope.
  scopedListingWhere: async (w: unknown) => { h.scoped.push(w); return { AND: [w, { sellerId: { notIn: ['desk'] } }] } },
}))
vi.mock('@/lib/push', () => ({ sendPushToProfile: async () => 0 }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))

const { GET } = await import('./route')

async function get() {
  const res = await GET(new Request('https://eno.vn/api/conversations/c1/sale-question'), { params: Promise.resolve({ id: 'c1' }) })
  return { status: res.status, body: (await res.json()) as Row }
}

const askedAt = Date.now() - 86_400_000
function sale(over: Row = {}): Row {
  return {
    id: 'L1', title: 'Honda Vision 2021', currency: '₫', listingType: 'sell', category: { slug: 'vehicles' },
    status: 'sold', complianceStatus: 'clear', soldChannel: 'eno', soldToProfileId: BUYER, soldAt: new Date(askedAt),
    salePrice: 11_200_000, saleConfirmedAt: null, saleDeclinedAt: null,
    saleBuyerHistory: JSON.stringify([{ i: BUYER, a: askedAt, p: 11_200_000, n: 1 }]), saleConfirmPromptedAt: new Date(askedAt),
    ...over,
  }
}

beforeEach(() => {
  h.userId = BUYER
  h.convo = { buyerProfileId: BUYER, seller: { id: 's1', ownerId: SELLER_P } }
  h.rows = [sale()]
  h.findManyArgs = []
  h.hidden = false
  h.desk = false
  h.scoped = []
  h.blocks = []
  h.blockLookups = 0
})
afterEach(() => vi.unstubAllEnvs())

describe('who may ask', () => {
  it('the thread\'s BUYER gets the open question — with the price they were asked about, and the sale\'s own id', async () => {
    expect(await get()).toEqual({
      status: 200,
      body: { questions: [{ saleId: `L1:${askedAt}`, listingId: 'L1', title: 'Honda Vision 2021', price: 11_200_000, currency: '₫' }] },
    })
  })

  it('⛔ the seller (or anyone else in the thread\'s place) → 403, and nothing is read', async () => {
    h.userId = SELLER_P
    expect(await get()).toEqual({ status: 403, body: { error: 'forbidden' } })
    expect(h.findManyArgs).toEqual([])
  })

  it('a thread this edition hides → 404 (the thread GET\'s own answer); an unknown one → 404; a guest → 401', async () => {
    h.hidden = true
    expect((await get()).status).toBe(404)
    h.hidden = false
    h.convo = null
    expect((await get()).status).toBe(404)
    h.userId = null
    expect((await get()).status).toBe(401)
  })
})

describe('what is listed — exactly what the answer route would accept', () => {
  it('found BY SELLER (not by the listing the thread shows now), edition-scoped, open answers only', async () => {
    await get()
    expect(h.scoped).toEqual([{
      sellerId: 's1', soldToProfileId: BUYER, status: 'sold', soldChannel: 'eno',
      saleConfirmedAt: null, saleDeclinedAt: null, complianceStatus: { not: 'taken_down' },
    }])
    expect(h.findManyArgs[0].where).toEqual({ AND: [h.scoped[0], { sellerId: { notIn: ['desk'] } }] })
  })

  it('a re-asked question carries the NEW price (the one in the buyer\'s history, not a stale column)', async () => {
    h.rows = [sale({ salePrice: 10_500_000, saleBuyerHistory: JSON.stringify([{ i: BUYER, a: askedAt, p: 10_500_000, n: 2 }]) })]
    expect((await get()).body.questions[0].price).toBe(10_500_000)
  })

  it('a question asked with no price lists price null', async () => {
    h.rows = [sale({ salePrice: null, saleBuyerHistory: JSON.stringify([{ i: BUYER, a: askedAt, p: null, n: 1 }]) })]
    expect((await get()).body.questions[0].price).toBeNull()
  })

  it('⛔ a question whose 14-day window has closed is not listed', async () => {
    const old = Date.now() - 20 * 86_400_000
    h.rows = [sale({ soldAt: new Date(old), saleBuyerHistory: JSON.stringify([{ i: BUYER, a: old, p: 11_200_000, n: 1 }]) })]
    expect((await get()).body.questions).toEqual([])
  })

  it('⛔ a listing the trade loop never asks about (a rental) is not listed', async () => {
    h.rows = [sale({ listingType: 'rent' })]
    expect((await get()).body.questions).toEqual([])
  })

  it('⛔ the services desk asks nobody — nothing is listed, and its sales are not even read', async () => {
    h.desk = true
    expect((await get()).body).toEqual({ questions: [] })
    expect(h.findManyArgs).toEqual([])
  })

  it('an ownerless storefront has nobody to confirm with → nothing listed', async () => {
    h.convo = { buyerProfileId: BUYER, seller: { id: 's1', ownerId: null } }
    expect((await get()).body).toEqual({ questions: [] })
  })
})

/**
 * ⛔ NOTHING IS ASKED ACROSS A BLOCK (App Store gate `ugc-safety`, audit 1.6), either way: the thread is closed, and
 * the answer route refuses alike. Off: unchanged, and no lookup.
 */
describe('⛔ nothing is asked across a block (App Store gate `ugc-safety`)', () => {
  it('gate OFF: a stored block changes nothing and is never looked up', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    h.blocks = [{ blockerProfileId: BUYER, blockedProfileId: SELLER_P }]
    expect((await get()).body.questions).toHaveLength(1)
    expect(h.blockLookups).toBe(0)
  })

  it.each([
    ['the buyer blocked the seller', BUYER, SELLER_P],
    ['the seller blocked the buyer', SELLER_P, BUYER],
  ])('gate ON, %s → 200 {questions: []}, and the sales are not even read', async (_case, blocker, blocked) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.blocks = [{ blockerProfileId: blocker, blockedProfileId: blocked }]
    expect(await get()).toEqual({ status: 200, body: { questions: [] } })
    expect(h.findManyArgs).toEqual([])
  })

  it('gate ON, no block between these two: the question is listed as before', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.blocks = [{ blockerProfileId: BUYER, blockedProfileId: '00000000-0000-4000-8000-000000000009' }]
    expect((await get()).body.questions).toHaveLength(1)
    expect(h.blockLookups).toBe(1)
  })

  it('gate ON: not the thread\'s buyer is still 403 — before any block lookup', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.userId = SELLER_P
    h.blocks = [{ blockerProfileId: SELLER_P, blockedProfileId: BUYER }]
    expect(await get()).toEqual({ status: 403, body: { error: 'forbidden' } })
    expect(h.blockLookups).toBe(0)
  })
})
