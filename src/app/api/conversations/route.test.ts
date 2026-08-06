import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/conversations — the thread-resolution rules, and the live 500 they used to cause.
 *
 * ⚠️ THE FAKE db ENFORCES `@@unique([listingId, buyerProfileId])` ITSELF, and that is the entire
 * point of this file. A mock that merely records calls would let every assertion below pass
 * against the broken code, because the crash is not in what the route CALLS — it is in what the
 * database answers when it calls it. So `create` and `update` here throw a `P2002` exactly where
 * Postgres does. Verified by running these tests against the pre-fix route: the shared-desk case
 * threw, which is the HTTP 500 the owner hit on production on 2026-07-27.
 *
 * The rule under test is "one thread per buyer↔seller" (2026-07-14): messaging a DIFFERENT listing
 * of a seller you already have a thread with reuses that thread and retargets its listing context.
 * That rule is right for an ordinary storefront and wrong for the eno desk, which sells the e-visa
 * catalogue AND the trip-planning anchor from ONE Seller row (`Seller.ownerId` is @unique).
 */

type Row = Record<string, any>

const BUYER = 'buyer-1'
const SELLER = 'seller-desk'
const OTHER_SELLER = 'seller-shop'
const TRIP_ANCHOR = 'listing-trip-anchor'
const VISA_PRODUCT = 'listing-visa-1H'
const SHOP_A = 'listing-shop-a'
const SHOP_B = 'listing-shop-b'

const h = vi.hoisted(() => ({
  state: {
    profile: { id: 'buyer-1' } as Row | null,
    rateOk: true,
    gate: null as Row | null,
    convos: [] as Row[],
    listings: {} as Record<string, Row>,
    delivered: [] as Row[],
    seq: 0,
    raceLosesThenVanishes: false,
    // Conversation ids holding a PENDING offer. A thread with a live offer must not be
    // retargeted to another listing — an offer is bound to the conversation, not the listing.
    offerThreads: [] as string[],
  },
}))

/** The unique index, modelled. Anything that would violate it throws the code Prisma throws. */
function assertUnique(listingId: string, buyerProfileId: string, exceptId?: string) {
  const clash = h.state.convos.find(
    (c) => c.listingId === listingId && c.buyerProfileId === buyerProfileId && c.id !== exceptId,
  )
  if (clash) {
    const err = new Error('Unique constraint failed on the fields: (`listingId`,`buyerProfileId`)') as Error & {
      code?: string
    }
    err.code = 'P2002'
    throw err
  }
}

const matchesConvo = (c: Row, where: Row) =>
  (where.sellerId === undefined || c.sellerId === where.sellerId) &&
  (where.buyerProfileId === undefined || c.buyerProfileId === where.buyerProfileId) &&
  (where.listingId === undefined || c.listingId === where.listingId)

// The edition scope is identity here: these tests are about thread routing, not about which
// edition is running. scopedListingWhere passes the predicate straight through.
vi.mock('@/lib/edition-scope', () => ({
  scopedListingWhere: async (w: unknown) => w,
  marketplaceListingScope: async () => ({}),
  deskSellerIds: async () => [],
}))
vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      // ⚠️ findFirst, because the route converted from findUnique when the edition scope landed:
      // scopedListingWhere returns an { AND: [...] } wrapper, which ListingWhereUniqueInput rejects.
      // The scope is a no-op in these tests (edition-scope is mocked to pass the predicate through),
      // so the id still arrives at the top level.
      findFirst: ({ where }: Row) => Promise.resolve(h.state.listings[where.id] ?? null),
      findUnique: ({ where }: Row) => Promise.resolve(h.state.listings[where.id] ?? null),
    },
    message: {
      findFirst: ({ where }: Row) =>
        Promise.resolve(
          where?.kind === 'offer' && where?.offerStatus === 'pending' && h.state.offerThreads.includes(where.conversationId)
            ? { id: `offer-on-${where.conversationId}` }
            : null,
        ),
    },
    conversation: {
      findUnique: ({ where }: Row) => {
        const key = where.listingId_buyerProfileId
        if (key) {
          return Promise.resolve(
            h.state.convos.find((c) => c.listingId === key.listingId && c.buyerProfileId === key.buyerProfileId) ?? null,
          )
        }
        return Promise.resolve(h.state.convos.find((c) => c.id === where.id) ?? null)
      },
      findFirst: ({ where }: Row) =>
        Promise.resolve(
          [...h.state.convos].sort((a, b) => b.lastMessageAt - a.lastMessageAt).find((c) => matchesConvo(c, where)) ??
            null,
        ),
      findMany: ({ where, take }: Row) => {
        const rows = [...h.state.convos]
          .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
          .filter((c) => matchesConvo(c, where ?? {}))
        return Promise.resolve(take ? rows.slice(0, take) : rows)
      },
      update: ({ where, data }: Row) => {
        const row = h.state.convos.find((c) => c.id === where.id)
        if (!row) throw new Error('record not found')
        if (data.listingId !== undefined) {
          assertUnique(data.listingId, row.buyerProfileId, row.id)
          row.listingId = data.listingId
        }
        return Promise.resolve(row)
      },
      updateMany: ({ where, data }: Row) => {
        const rows = h.state.convos.filter(
          (c) => c.id === where.id && (!where.NOT || c.listingId !== where.NOT.listingId),
        )
        for (const row of rows) {
          assertUnique(data.listingId, row.buyerProfileId, row.id)
          row.listingId = data.listingId
        }
        return Promise.resolve({ count: rows.length })
      },
      create: ({ data }: Row) => {
        // ⚠️ THE RACE, MODELLED AT THE ONLY PLACE IT CAN HAPPEN. `raceLosesThenVanishes` makes this
        // create lose to a concurrent writer that then deletes its own row before our catch block
        // can refetch it — so the constraint fires for a thread that no longer exists. Every
        // lookup before this point already ran and saw nothing, which is exactly the ordering
        // that puts the handler in its P2002 catch with both fallbacks empty.
        if (h.state.raceLosesThenVanishes) {
          h.state.raceLosesThenVanishes = false
          const err = new Error('Unique constraint failed on the fields: (`listingId`,`buyerProfileId`)') as Error & { code?: string }
          err.code = 'P2002'
          throw err
        }
        assertUnique(data.listingId, data.buyerProfileId)
        const row = { id: `convo-${++h.state.seq}`, lastMessageAt: Date.now(), ...data }
        h.state.convos.push(row)
        return Promise.resolve(row)
      },
    },
    notification: { create: () => Promise.resolve({}) },
  },
}))

vi.mock('@/lib/admin', () => ({
  getCurrentProfile: () => Promise.resolve(h.state.profile),
  getCurrentProfileId: () => Promise.resolve(h.state.profile?.id ?? null),
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: () => Promise.resolve({ success: h.state.rateOk }) }))
vi.mock('@/lib/enforcement', () => ({ conversationGate: () => Promise.resolve(h.state.gate) }))
vi.mock('@/lib/push', () => ({ sendPushToProfile: () => Promise.resolve() }))
vi.mock('@/lib/offer-guard', () => ({ recordFixedPriceOfferAttempt: () => Promise.resolve() }))
vi.mock('@/lib/messages', () => ({
  insertMessage: (conv: Row, senderId: string, body: string, opts?: Row) => {
    h.state.delivered.push({ conversationId: conv.id, listingId: conv.listingId, senderId, body, ...opts })
    return Promise.resolve({ id: `msg-${h.state.delivered.length}`, body, createdAt: new Date().toISOString() })
  },
}))

// ⚠️ The DESK'S OWN RULE, mocked at the module that owns it rather than restated as a listing-id
// comparison here. `threadKind` decides by the ANCHOR listing (trip anchor id / membership of the
// visa catalogue) and never by the seller — see src/lib/thread-kind.ts. Mocking it keeps this file
// from needing the desk resolvers (and their four DB reads) while still exercising the real
// question the route asks it.
vi.mock('@/lib/thread-kind', () => ({
  threadKind: (convo: { listingId: string | null }) =>
    Promise.resolve(
      convo.listingId === TRIP_ANCHOR
        ? 'itinerary'
        // ⚠️ MEMBERSHIP OF THE CATALOGUE, not equality with one product — the desk sells 14 visa
        // listings (2 entry types × 7 speeds) and every one of them is a 'visa' thread. An earlier
        // version of this mock recognised a single id, and the "reuse across two visa products"
        // test failed against CORRECT code because the mock, not the route, disagreed.
        : convo.listingId?.startsWith('listing-visa') ? 'visa'
        : 'listing',
    ),
}))

// `after()` runs the first-lead milestone off the hot path; run it inline so a throw in it would
// surface here rather than being swallowed by the test runner.
vi.mock('next/server', async (importOriginal) => {
  const mod = await importOriginal<typeof import('next/server')>()
  return { ...mod, after: (fn: () => unknown) => { void fn() } }
})

import { POST } from './route'

function listing(id: string, sellerId: string, extra: Row = {}) {
  return { id, title: `Listing ${id}`, verified: true, negotiable: true, sellerId, seller: { ownerId: 'desk-owner' }, ...extra }
}

function convo(id: string, listingId: string, sellerId: string, lastMessageAt: number) {
  return { id, listingId, buyerProfileId: BUYER, sellerId, sellerProfileId: 'desk-owner', lastMessageAt }
}

async function post(body: Row): Promise<{ status: number; json: Row }> {
  const res = await POST(
    new Request('http://test/api/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  return { status: res.status, json: (await res.json()) as Row }
}

beforeEach(() => {
  h.state.profile = { id: BUYER }
  h.state.rateOk = true
  h.state.gate = null
  h.state.convos = []
  h.state.delivered = []
  h.state.seq = 0
  h.state.raceLosesThenVanishes = false
  h.state.listings = {
    [TRIP_ANCHOR]: listing(TRIP_ANCHOR, SELLER),
    [VISA_PRODUCT]: listing(VISA_PRODUCT, SELLER),
    [SHOP_A]: listing(SHOP_A, OTHER_SELLER, { seller: { ownerId: 'shop-owner' } }),
    [SHOP_B]: listing(SHOP_B, OTHER_SELLER, { seller: { ownerId: 'shop-owner' } }),
  }
})

describe('the shared desk: a visa thread and a trip thread must coexist', () => {
  it('does not 500 when a buyer with BOTH desk threads opens the trip one', async () => {
    // ⚠️ THE PRODUCTION REPRO, 2026-07-27. Both threads already exist — the visa and trip DM
    // modules create them server-side, bypassing this route — and the visa one is newer, so the
    // seller-level lookup returns it. The old code then retargeted visa → tripAnchor, hit the
    // unique index against the trip thread that was already there, and threw a bare P2002.
    h.state.convos = [
      convo('trip-thread', TRIP_ANCHOR, SELLER, 1000),
      convo('visa-thread', VISA_PRODUCT, SELLER, 2000), // newest → what findFirst returns
    ]

    const { status, json } = await post({ listingId: TRIP_ANCHOR, message: 'can you book this?' })

    expect(status).toBe(200)
    // …and into the RIGHT thread. Landing in the visa thread would be a 200 that silently posts a
    // booking request into a conversation about a passport application.
    expect(json.id).toBe('trip-thread')
    expect(json.created).toBe(false)
    expect(h.state.delivered).toEqual([
      expect.objectContaining({ conversationId: 'trip-thread', body: 'can you book this?' }),
    ])
  })

  it('leaves the visa thread anchored on its own product', async () => {
    // The other half of the same bug: even without a collision, retargeting turns a thread full of
    // visa cards into an itinerary thread — `threadKind` would start answering 'itinerary' for it.
    h.state.convos = [
      convo('trip-thread', TRIP_ANCHOR, SELLER, 1000),
      convo('visa-thread', VISA_PRODUCT, SELLER, 2000),
    ]

    await post({ listingId: TRIP_ANCHOR, message: 'hello' })

    expect(h.state.convos.find((c) => c.id === 'visa-thread')!.listingId).toBe(VISA_PRODUCT)
  })

  it('opens a NEW trip thread rather than swallowing the buyer’s only visa thread', async () => {
    // No trip thread yet, so there is no collision and the old code would not have thrown — it
    // would have quietly retargeted the visa thread onto the trip anchor. Nothing would have
    // failed; the buyer would simply have lost the visa conversation's anchor.
    h.state.convos = [convo('visa-thread', VISA_PRODUCT, SELLER, 2000)]

    const { status, json } = await post({ listingId: TRIP_ANCHOR, message: 'plan my trip' })

    expect(status).toBe(200)
    expect(json.created).toBe(true)
    expect(json.id).not.toBe('visa-thread')
    expect(h.state.convos.find((c) => c.id === 'visa-thread')!.listingId).toBe(VISA_PRODUCT)
    expect(h.state.convos).toHaveLength(2)
  })

  it('still reuses the visa thread for ANOTHER visa product — same kind, so retargeting is right', async () => {
    // Kind-scoping must not become "never reuse". Two visa products are the same kind of
    // conversation, and collapsing them into one thread is the intended behaviour.
    h.state.listings['listing-visa-2H'] = listing('listing-visa-2H', SELLER)
    h.state.convos = [convo('visa-thread', VISA_PRODUCT, SELLER, 2000)]

    const { json } = await post({ listingId: 'listing-visa-2H', message: 'this one instead' })

    expect(json.id).toBe('visa-thread')
    expect(json.created).toBe(false)
    expect(h.state.convos.find((c) => c.id === 'visa-thread')!.listingId).toBe('listing-visa-2H')
  })
})

describe('ordinary storefronts keep the one-thread-per-seller rule exactly as before', () => {
  it('reuses and retargets the existing thread for a different listing of the same seller', async () => {
    h.state.convos = [convo('shop-thread', SHOP_A, OTHER_SELLER, 1000)]

    const { status, json } = await post({ listingId: SHOP_B, message: 'is this still available?' })

    expect(status).toBe(200)
    expect(json.id).toBe('shop-thread')
    expect(json.created).toBe(false)
    expect(h.state.convos.find((c) => c.id === 'shop-thread')!.listingId).toBe(SHOP_B)
    expect(h.state.convos).toHaveLength(1)
  })

  // ⚠️ THE MONEY CASE. An offer row carries conversationId and NO listingId (schema.prisma:838), so
  // retargeting a thread that holds a pending offer silently re-points that offer at a different
  // item: the seller's Accept on the still-pending card would sell listing B at the price the buyer
  // offered for listing A. actOnOffer cannot catch it — its predicate is
  // { id, conversationId, kind, offerStatus }, all of which still match after the move.
  it('refuses to retarget a thread that holds a PENDING offer, and delivers to a fresh thread', async () => {
    h.state.convos = [convo('shop-thread', SHOP_A, OTHER_SELLER, 1000)]
    h.state.offerThreads = ['shop-thread']

    const { status, json } = await post({ listingId: SHOP_B, message: 'is this still available?' })

    expect(status).toBe(200)
    // The offer thread keeps its listing — this is the assertion that matters.
    expect(h.state.convos.find((c) => c.id === 'shop-thread')!.listingId).toBe(SHOP_A)
    // …and the buyer still gets through, on a different thread bound to the listing they asked about.
    expect(json.id).not.toBe('shop-thread')
    expect(h.state.convos).toHaveLength(2)
    expect(h.state.convos.find((c) => c.id === json.id)!.listingId).toBe(SHOP_B)
  })

  it('creates the first thread with a seller and reports created:true', async () => {
    // `created` drives the "contact seller" conversion event, so a wrong value here is a wrong
    // number in the funnel, not just a wrong flag.
    const { json } = await post({ listingId: SHOP_A, message: 'hi' })
    expect(json.created).toBe(true)
    expect(h.state.convos).toHaveLength(1)
  })

  it('delivers into the buyer’s existing thread for the SAME listing without touching it', async () => {
    h.state.convos = [convo('shop-thread', SHOP_A, OTHER_SELLER, 1000)]
    const { json } = await post({ listingId: SHOP_A, message: 'still me' })
    expect(json.id).toBe('shop-thread')
    expect(json.created).toBe(false)
    expect(h.state.convos.find((c) => c.id === 'shop-thread')!.listingId).toBe(SHOP_A)
  })
})

describe('the create race: the constraint fires for a thread that is already gone', () => {
  it('retries the create instead of 500ing when both fallback lookups miss', async () => {
    // ⚠️ agy REFUTED THE FIRST FIX ON EXACTLY THIS PATH. Every lookup missed, so the handler
    // reached `create`; the create lost to a concurrent writer that then deleted its own row, so
    // the catch block's findUnique AND its same-seller findFirst both came back empty — and the
    // old code rethrew, turning a conflict that had already resolved itself into an HTTP 500.
    h.state.raceLosesThenVanishes = true

    const { status, json } = await post({ listingId: SHOP_A, message: 'hi' })

    expect(status).toBe(200)
    expect(json.created).toBe(true)
    expect(h.state.delivered).toEqual([expect.objectContaining({ body: 'hi' })])
    expect(h.state.convos).toHaveLength(1)
  })
})
