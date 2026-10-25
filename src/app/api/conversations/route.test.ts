import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    // The status of the offer those threads hold.
    offerKind: 'pending' as 'pending' | 'accepted' | 'declined',
    // Buyers docked by the fixed-price offer guard (recordFixedPriceOfferAttempt).
    docked: [] as string[],
    // Every `where` conversation.findFirst was handed — the P2002 fallback is held to its filter, not just its result.
    findFirstWheres: [] as Row[],
    // The teacher DM ladder (src/lib/teachers/dm-quota.ts), faked at its module in the teacher section below: what it
    // answers, and every question the route asked it.
    dm: {
      /** teacherDmStanding's answer — the route's early check. */
      standing: null as TeacherDmStanding | null,
      /** Set: openTeacherThread's recount under its lock refuses, with this standing. */
      lockedStanding: null as TeacherDmStanding | null,
      /** Set: a concurrent request's thread lands AFTER the route's own lookups, and the lock's re-read finds it. */
      concurrentThread: null as string | null,
      /** mayWriteToTeacher's answer — false: the teacher has not answered and the writer's two messages are in. */
      mayWrite: true,
      /** Set: the guard riding with the insert aborts it — a concurrent send took the last place (sendToTeacherGuarded). */
      guardRefuses: false as false | 'cap' | 'repeat',
      /** openerAgainst's answer about an EXISTING teacher thread: still empty (its opener never landed), or a re-sent opener. */
      tail: { empty: false, repeat: false },
      /** The threads openTeacherThread created. */
      created: [] as string[],
      asked: { standing: [] as Row[], open: [] as Row[], mayWrite: [] as Row[], guarded: [] as Row[], tail: [] as Row[] },
    },
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

/**
 * One branch of the listing-KIND `OR` the route puts on a seller-level lookup (sellerThreads and the P2002 fallback):
 * `{ listingId: null }` or `{ listing: { listingType: { not } } }`. Evaluated the way Postgres would, or a fake that
 * ignored it would retarget a teacher thread by itself and fail correct code: a relation filter needs a listing, and
 * `listingType` defaults to 'sell' (schema.prisma), which is what an unset fixture stands for.
 */
const matchesKind = (c: Row, branch: Row) =>
  (branch.listingId === undefined || c.listingId === branch.listingId) &&
  (branch.listing?.listingType?.not === undefined ||
    (c.listingId != null && (h.state.listings[c.listingId]?.listingType ?? 'sell') !== branch.listing.listingType.not))

const matchesConvo = (c: Row, where: Row) =>
  (where.sellerId === undefined || c.sellerId === where.sellerId) &&
  (where.buyerProfileId === undefined || c.buyerProfileId === where.buyerProfileId) &&
  (where.listingId === undefined || c.listingId === where.listingId) &&
  (where.OR === undefined || (where.OR as Row[]).some((branch) => matchesKind(c, branch)))

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
          where?.kind === 'offer' && h.state.offerThreads.includes(where.conversationId) &&
          (where?.offerStatus === h.state.offerKind || (Array.isArray(where?.offerStatus?.in) && where.offerStatus.in.includes(h.state.offerKind)))
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
      findFirst: ({ where }: Row) => {
        h.state.findFirstWheres.push(where)
        return Promise.resolve(
          [...h.state.convos].sort((a, b) => b.lastMessageAt - a.lastMessageAt).find((c) => matchesConvo(c, where)) ??
            null,
        )
      },
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
    notification: { create: ({ data }: Row) => { ((h.state as Row).notifications ??= []).push(data); return Promise.resolve({}) } },
    // App Store gate `ugc-safety`: the block lookup the route makes once the gate is on (no block here).
    forumUserBlock: { findFirst: () => Promise.resolve(null) },
  },
}))

vi.mock('@/lib/admin', () => ({
  getCurrentProfile: () => Promise.resolve(h.state.profile),
  getCurrentProfileId: () => Promise.resolve(h.state.profile?.id ?? null),
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: () => Promise.resolve({ success: h.state.rateOk }), kv: { incrby: () => Promise.resolve(1) } }))
vi.mock('@/lib/enforcement', () => ({ conversationGate: () => Promise.resolve(h.state.gate) }))
vi.mock('@/lib/push', () => ({ sendPushToProfile: () => Promise.resolve() }))
vi.mock('@/lib/offer-guard', () => ({ recordFixedPriceOfferAttempt: (id: string) => { h.state.docked.push(id); return Promise.resolve() } }))
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
// The MOCKED module (teacher section below): its database-reading functions are fakes, teacherDmRefusal is the real one.
import { teacherDmRefusal, type TeacherDmStanding } from '@/lib/teachers/dm-quota'
import { TEACHER_DM_LIMITS } from '@/lib/teachers/constants'

function listing(id: string, sellerId: string, extra: Row = {}) {
  return { id, title: `Listing ${id}`, verified: true, negotiable: true, sellerId, seller: { ownerId: 'desk-owner' }, ...extra }
}

function convo(id: string, listingId: string, sellerId: string, lastMessageAt: number) {
  return { id, listingId, buyerProfileId: BUYER, sellerId, sellerProfileId: 'desk-owner', lastMessageAt }
}

/** The raw response — a teacher refusal is held to its headers as well as its body. */
function postRes(body: Row, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request('http://test/api/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  )
}

async function post(body: Row, headers: Record<string, string> = {}): Promise<{ status: number; json: Row }> {
  const res = await postRes(body, headers)
  return { status: res.status, json: (await res.json()) as Row }
}

/** Any instant ahead of now — the Vietnam midnight teacherDmRefusal turns into Retry-After. */
const RESET_AT = new Date(Date.now() + 6 * 3_600_000).toISOString()

/** The ladder's bottom rung — any account, a personal one included — with `used` of its new teachers spent today. */
function unverifiedDay(used: number): TeacherDmStanding {
  const limit = TEACHER_DM_LIMITS.unverified
  return {
    tier: 'unverified', limit, next: 'verify_identity', nextLimit: TEACHER_DM_LIMITS.identity, needsPhone: false, pooled: true,
    used, remaining: Math.max(0, limit - used), resetAt: RESET_AT, reason: used >= limit ? 'limit' : null, hasThread: false,
  }
}

/** A revoked identity: 0, and no way up. */
const REVOKED: TeacherDmStanding = {
  tier: 'revoked', limit: TEACHER_DM_LIMITS.revoked, next: 'none', nextLimit: null, needsPhone: false, pooled: false,
  used: 0, remaining: 0, resetAt: RESET_AT, reason: 'revoked', hasThread: false,
}

beforeEach(() => {
  h.state.profile = { id: BUYER }
  h.state.rateOk = true
  h.state.gate = null
  h.state.convos = []
  h.state.delivered = []
  h.state.seq = 0
  h.state.raceLosesThenVanishes = false
  h.state.docked = []
  // Reset with the rest: the pending-offer test used to leave its thread id behind for every later test.
  h.state.offerThreads = []
  h.state.offerKind = 'pending'
  h.state.findFirstWheres = []
  h.state.dm = {
    standing: unverifiedDay(0), lockedStanding: null, concurrentThread: null, mayWrite: true, guardRefuses: false,
    tail: { empty: false, repeat: false },
    created: [], asked: { standing: [], open: [], mayWrite: [], guarded: [], tail: [] },
  }
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

  // ⚠️ THE ACCEPTED CASE (sweep, 2026-10-22). actOnOffer allows one accepted offer per conversation, so retargeting a
  // closed deal's thread to the seller's next item made every later offer there unacceptable.
  it('refuses to retarget a thread that holds an ACCEPTED offer too — the next item gets its own thread', async () => {
    h.state.convos = [convo('shop-thread', SHOP_A, OTHER_SELLER, 1000)]
    h.state.offerThreads = ['shop-thread']
    h.state.offerKind = 'accepted'
    const { status, json } = await post({ listingId: SHOP_B, message: 'any discount on this one?' })
    expect(status).toBe(200)
    expect(h.state.convos.find((c) => c.id === 'shop-thread')!.listingId).toBe(SHOP_A)
    expect(json.id).not.toBe('shop-thread')
    expect(h.state.convos.find((c) => c.id === json.id)!.listingId).toBe(SHOP_B)
  })

  it('…but a thread whose offer was DECLINED still moves to the next item (one thread per seller stays the rule)', async () => {
    h.state.convos = [convo('shop-thread', SHOP_A, OTHER_SELLER, 1000)]
    h.state.offerThreads = ['shop-thread']
    h.state.offerKind = 'declined'
    const { json } = await post({ listingId: SHOP_B, message: 'what about this one?' })
    expect(json.id).toBe('shop-thread')
    expect(h.state.convos.find((c) => c.id === 'shop-thread')!.listingId).toBe(SHOP_B)
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

  it('never falls back onto the buyer’s TEACHER thread with that storefront — its lookup carries the non-teacher filter', async () => {
    // ⛔ A storefront can list a teacher card AND products. The fallback's same-seller lookup used to take ANY thread of
    // the seller, so losing this race on a product would have retargeted the teacher thread onto it — out of the teacher
    // DM count, its shares dropped (codex + opus, plan review 2026-10-13). Same filter as the sellerThreads reuse.
    h.state.listings['listing-tutor'] = listing('listing-tutor', 'seller-tutor', { listingType: 'teacher', status: 'active', negotiable: false, seller: { ownerId: 'tutor-owner' } })
    h.state.listings['listing-tutor-book'] = listing('listing-tutor-book', 'seller-tutor', { seller: { ownerId: 'tutor-owner' } })
    h.state.convos = [{ ...convo('tutor-thread', 'listing-tutor', 'seller-tutor', 1000), sellerProfileId: 'tutor-owner' }]
    h.state.raceLosesThenVanishes = true

    const { status, json } = await post({ listingId: 'listing-tutor-book', message: 'Is the workbook still available?' })

    // The fallback's lookup — the only conversation.findFirst on this path — excludes teacher threads in its `where`.
    expect(h.state.findFirstWheres).toEqual([
      expect.objectContaining({
        sellerId: 'seller-tutor',
        buyerProfileId: BUYER,
        OR: [{ listingId: null }, { listing: { listingType: { not: 'teacher' } } }],
      }),
    ])
    // …so the buyer lands in a fresh product thread and the teacher thread keeps its teacher.
    expect(status).toBe(200)
    expect(json.created).toBe(true)
    expect(json.id).not.toBe('tutor-thread')
    expect(h.state.convos.find((c) => c.id === 'tutor-thread')!.listingId).toBe('listing-tutor')
    // A product is not a teacher: the ladder is never asked about it.
    expect(h.state.dm.asked).toEqual({ standing: [], open: [], mayWrite: [], guarded: [], tail: [] })
  })
})

describe('an opening OFFER on a listing that takes none', () => {
  it('a fixed-price listing refuses it AND docks the buyer, as before', async () => {
    h.state.listings[SHOP_A] = listing(SHOP_A, OTHER_SELLER, { negotiable: false, listingType: 'sell', seller: { ownerId: 'shop-owner' } })
    const { status, json } = await post({ listingId: SHOP_A, offerAmount: 1_000_000 })
    expect(status).toBe(409)
    expect(json.error).toBe('not_negotiable')
    expect(h.state.docked).toEqual([BUYER])
  })

  it('a JOB refuses it but does NOT dock the buyer when its stored row still says negotiable', async () => {
    // A job stored before the salary rule (negotiable=true) behind a PDP cached for up to 30 days still
    // shows the offer slider — the site offered it, so the buyer is not penalised for using it.
    h.state.listings[SHOP_A] = listing(SHOP_A, OTHER_SELLER, { negotiable: true, listingType: 'job', seller: { ownerId: 'shop-owner' } })
    const { status, json } = await post({ listingId: SHOP_A, offerAmount: 1_000_000 })
    expect(status).toBe(409)
    expect(json.error).toBe('not_negotiable')
    expect(h.state.docked).toEqual([])
    expect(h.state.convos).toHaveLength(0)
  })
})

// ── App Store gate `ugc-safety` (plan R5): the first message goes through the severe-only word filter ──
describe('the word filter on the message that opens a thread', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('gate OFF: nothing is scanned — the thread opens and the message is delivered as before', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    const { status } = await post({ listingId: SHOP_A, message: 'I will kill you' })
    expect(status).toBe(200)
    expect(h.state.delivered).toHaveLength(1)
  })

  it('gate ON: a threat is refused BEFORE the thread exists — no conversation, no message', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    expect(await post({ listingId: SHOP_A, message: 'tao giết mày' })).toEqual({ status: 400, json: { error: 'objectionable_content' } })
    expect(h.state.convos).toEqual([])
    expect(h.state.delivered).toEqual([])
  })

  it('gate ON: an ordinary first message (and a bare offer) still opens the thread', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    expect((await post({ listingId: SHOP_A, message: 'Còn hàng không bạn? Giá cuối bao nhiêu?' })).status).toBe(200)
    expect((await post({ listingId: SHOP_B, offerAmount: 500000 })).status).toBe(200)
  })
})

// ── TEACHER THREADS ──────────────────────────────────────────────────────────────────────────────────
// Cover lessons (2026-10-07): a hidden teacher is unreachable; a NEW thread rings the teacher (and the "First interested
// buyer!" milestone no longer fires for a person); a message into a thread that went quiet rings them again.
// The DM ladder (owner, 2026-10-13): "only a business account may message a teacher" is GONE — any signed-in account
// may; the ladder says how many NEW teachers a day, and a teacher who has not answered gets at most two messages.
vi.mock('server-only', () => ({}))
vi.mock('@/lib/teachers/notify', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/teachers/notify')>()
  return { ...mod, notifyTeacherOfSchoolMessage: (a: Row) => { ((h.state as Row).notified ??= []).push(a); return Promise.resolve() } }
})
/**
 * ⚠️ THE LADDER IS FAKED AT ITS MODULE, LIKE notify.ts ABOVE, SO THIS STAYS A ROUTE TEST. Its rules — the tiers, the
 * Vietnam-day count, the advisory lock, the IP pool — belong to src/lib/teachers/dm-quota.ts; what is pinned here is
 * what the ROUTE does with each answer. The three functions that read the database are fakes that record every
 * question; teacherDmRefusal stays REAL, because answering with the refusal exactly as it was built — status, body,
 * Retry-After — is the route's half of the contract the pending page reads (tier / next / reason → dm-limit-copy.ts).
 */
vi.mock('@/lib/teachers/dm-quota', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/teachers/dm-quota')>()
  return {
    ...mod,
    teacherDmStanding: (profileId: string, opts: Row) => {
      h.state.dm.asked.standing.push({ profileId, opts })
      return Promise.resolve(h.state.dm.standing)
    },
    openTeacherThread: (a: Row) => {
      h.state.dm.asked.open.push(a)
      // A concurrent request's thread, landing AFTER the route's own lookups — what the lock's re-read is there to find.
      if (h.state.dm.concurrentThread) {
        h.state.convos.push({ id: h.state.dm.concurrentThread, listingId: a.listingId, buyerProfileId: a.profileId, sellerId: a.sellerId, sellerProfileId: a.sellerProfileId, lastMessageAt: Date.now() })
        h.state.dm.concurrentThread = null
      }
      const existing = h.state.convos.find((c) => c.listingId === a.listingId && c.buyerProfileId === a.profileId)
      if (existing) return Promise.resolve({ outcome: 'existing', id: existing.id })
      if (h.state.dm.lockedStanding) return Promise.resolve({ outcome: 'refused', standing: h.state.dm.lockedStanding })
      const row = { id: `ladder-thread-${++h.state.seq}`, listingId: a.listingId, buyerProfileId: a.profileId, sellerId: a.sellerId, sellerProfileId: a.sellerProfileId, lastMessageAt: Date.now() }
      h.state.convos.push(row)
      h.state.dm.created.push(row.id)
      return Promise.resolve({ outcome: 'created', id: row.id })
    },
    mayWriteToTeacher: (conversationId: string, buyerProfileId: string, teacherProfileId: string | null) => {
      h.state.dm.asked.mayWrite.push({ conversationId, buyerProfileId, teacherProfileId })
      return Promise.resolve(h.state.dm.mayWrite)
    },
    // The guard's statements are the ladder's (unit-tested there); what is pinned here is that every insert into a
    // teacher thread carries them, and what the route does when they abort it.
    openerAgainst: (conversationId: string, writerProfileId: string, teacherProfileId: string | null, text: string | null) => {
      h.state.dm.asked.tail.push({ conversationId, writerProfileId, teacherProfileId, text })
      return Promise.resolve(h.state.dm.tail)
    },
    sendToTeacherGuarded: async (thread: Row, send: (alongside: unknown[]) => Promise<unknown>) => {
      h.state.dm.asked.guarded.push(thread)
      if (h.state.dm.guardRefuses) return { sent: false, reason: h.state.dm.guardRefuses }
      return { sent: true, value: await send(['teacher-unanswered-guard']) }
    },
  }
})

describe('teacher threads', () => {
  const TEACHER = 'listing-teacher-1'
  const TEACHER_SELLER = 'seller-teacher-1'
  const HOUR = 3_600_000
  /** The buyer's thread with the teacher, its last message `quietFor` ago. */
  const teacherThread = (id: string, quietFor: number) => ({ ...convo(id, TEACHER, TEACHER_SELLER, Date.now() - quietFor), sellerProfileId: 'teacher-owner' })
  const notified = () => (h.state as Row).notified as Row[]

  beforeEach(() => {
    // A PERSONAL account. Until 2026-10-13 only a business could write to a teacher; now anyone can, and the ladder
    // (faked: an unverified day with nothing spent yet) decides how many new teachers a day.
    h.state.profile = { id: BUYER, accountType: 'individual' }
    ;(h.state as Row).notified = []
    ;(h.state as Row).notifications = []
    h.state.listings[TEACHER] = listing(TEACHER, TEACHER_SELLER, { listingType: 'teacher', status: 'active', negotiable: false, seller: { ownerId: 'teacher-owner' } })
  })
  afterEach(() => vi.unstubAllEnvs())

  describe('cover lessons (2026-10-07): a hidden teacher, and when the teacher is rung', () => {
    it('refuses a HIDDEN teacher with the same 404 as an unverified row, creates nothing — and the ladder never answers first', async () => {
      // An account with nothing left today still gets the 404: a ladder refusal here would reveal the hidden profile.
      h.state.dm.standing = unverifiedDay(TEACHER_DM_LIMITS.unverified)
      h.state.listings[TEACHER].status = 'hidden'
      const { status, json } = await post({ listingId: TEACHER, message: 'Can you cover Monday?' })
      expect(status).toBe(404)
      expect(json.error).toBe('not_found')
      expect(h.state.convos).toHaveLength(0)
      expect(h.state.dm.asked.standing).toEqual([])
      expect(h.state.dm.asked.open).toEqual([])
    })

    it('lets an account that already has its thread reach a HIDDEN teacher — the same thread, and no ring', async () => {
      h.state.listings[TEACHER].status = 'hidden'
      h.state.convos = [teacherThread('t-thread', 7 * HOUR)]
      const { status, json } = await post({ listingId: TEACHER, message: 'Still free on Monday?' })
      expect(status).toBe(200)
      expect(json.id).toBe('t-thread')
      expect(h.state.convos).toHaveLength(1)
      expect(notified()).toEqual([])
    })

    it('rings again only when the existing thread had gone quiet — a personal account’s message too', async () => {
      h.state.convos = [teacherThread('t-thread', 7 * HOUR)]
      await post({ listingId: TEACHER, message: 'Another cover this week?' })
      expect(notified()).toEqual([{ teacherProfileId: 'teacher-owner', conversationId: 't-thread', listingId: TEACHER }])

      ;(h.state as Row).notified = []
      h.state.convos = [teacherThread('t-thread', HOUR)]
      await post({ listingId: TEACHER, message: 'And Thursday?' })
      expect(notified()).toEqual([])
    })
  })

  describe('the DM ladder (owner, 2026-10-13): anyone may write, the ladder counts NEW teachers', () => {
    it('a personal account under its limit gets its thread from openTeacherThread — with the client IP for the pool — and the teacher is rung', async () => {
      // As Cloudflare forwards it: the edge proof clientIp() checks, then the visitor's address. The address must reach
      // BOTH ladder calls — without it the unverified rung's shared per-connection pool never applies.
      vi.stubEnv('EDGE_SECRET', 'edge-proof')
      const { status, json } = await post(
        { listingId: TEACHER, message: 'Can you cover Monday?' },
        { 'x-eno-edge': 'edge-proof', 'cf-connecting-ip': '203.0.113.7' },
      )
      expect(status).toBe(200)
      expect(json.created).toBe(true)
      expect(h.state.dm.asked.standing).toEqual([{ profileId: BUYER, opts: expect.objectContaining({ ip: '203.0.113.7' }) }])
      expect(h.state.dm.asked.open).toEqual([
        expect.objectContaining({ profileId: BUYER, listingId: TEACHER, sellerId: TEACHER_SELLER, sellerProfileId: 'teacher-owner', ip: '203.0.113.7' }),
      ])
      // The thread is the one made under the ladder's lock — never by the route's own create.
      expect(h.state.dm.created).toEqual([json.id])
      expect(h.state.convos.map((c) => c.id)).toEqual([json.id])
      expect(h.state.delivered).toEqual([expect.objectContaining({ conversationId: json.id, body: 'Can you cover Monday?' })])
      expect(notified()).toEqual([{ teacherProfileId: 'teacher-owner', conversationId: json.id, listingId: TEACHER }])
      // A teacher is a person, not a listing: no "First interested buyer!" milestone.
      expect(((h.state as Row).notifications as Row[]).filter((n) => n.type === 'milestone')).toEqual([])
    })

    it('⛔ a NEW teacher thread opens only with its first message: an empty open is 400, spends nothing, rings nobody (gate 2026-10-13)', async () => {
      const { status, json } = await post({ listingId: TEACHER })
      expect(status).toBe(400)
      expect(json.error).toBe('empty')
      expect(h.state.dm.asked.standing).toEqual([])
      expect(h.state.dm.asked.open).toEqual([])
      expect(h.state.convos).toHaveLength(0)
      expect(notified()).toEqual([])
    })

    it('a double tap at the last slot is never refused: the early check sees the first tap’s thread (hasThread) and the lock reuses it', async () => {
      h.state.dm.standing = { ...unverifiedDay(TEACHER_DM_LIMITS.unverified), hasThread: true }
      h.state.dm.concurrentThread = 'first-tap-thread'
      const { status, json } = await post({ listingId: TEACHER, message: 'hi' })
      expect(status).toBe(200)
      expect(json).toMatchObject({ id: 'first-tap-thread', created: false })
      expect(h.state.dm.asked.standing).toEqual([{ profileId: BUYER, opts: expect.objectContaining({ listingId: TEACHER }) }])
      expect(notified()).toEqual([])
    })

    it('⛔ the new-account cap is waived for a TEACHER thread only (the ladder governs those); an ordinary listing keeps it', async () => {
      h.state.gate = { error: 'probation_conversation_cap', limit: 15 }
      expect(await post({ listingId: TEACHER, message: 'hi' })).toMatchObject({ status: 200, json: { created: true } })
      const { status, json } = await post({ listingId: SHOP_A, message: 'hi' })
      expect(status).toBe(403)
      expect(json.error).toBe('probation_conversation_cap')
    })

    it('suspension is never waived, teacher thread or not', async () => {
      h.state.gate = { error: 'account_suspended' }
      const { status, json } = await post({ listingId: TEACHER, message: 'hi' })
      expect(status).toBe(403)
      expect(json.error).toBe('account_suspended')
      expect(h.state.dm.asked.open).toEqual([])
    })

    it('an unverified PERSONAL account opens a thread under its limit and is refused with the ladder’s body over it (was: business accounts only)', async () => {
      expect(await post({ listingId: TEACHER, message: 'hi' })).toMatchObject({ status: 200, json: { created: true } })

      const TEACHER_2 = 'listing-teacher-2'
      h.state.listings[TEACHER_2] = listing(TEACHER_2, 'seller-teacher-2', { listingType: 'teacher', status: 'active', negotiable: false, seller: { ownerId: 'teacher-2-owner' } })
      const spent = unverifiedDay(TEACHER_DM_LIMITS.unverified)
      h.state.dm.standing = spent
      ;(h.state as Row).notified = []
      const res = await postRes({ listingId: TEACHER_2, message: 'hi' })
      const body = await res.json()
      // teacherDmRefusal's own response, untouched: its status, its body (what the pending page words), its Retry-After.
      const refusal = teacherDmRefusal(spent, { error: 'teacher_thread_cap' })
      expect(res.status).toBe(429)
      expect(res.status).toBe(refusal.status)
      expect(body).toEqual(await refusal.json())
      expect(body).toMatchObject({ error: 'teacher_thread_cap', tier: 'unverified', remaining: 0, next: 'verify_identity', reason: 'limit' })
      expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
      // Nothing behind it: no thread, no message, no ring — the lock is never even taken.
      expect(h.state.dm.asked.open.map((a) => a.listingId)).toEqual([TEACHER])
      expect(h.state.convos.filter((c) => c.listingId === TEACHER_2)).toEqual([])
      expect(h.state.delivered.filter((d) => d.listingId === TEACHER_2)).toEqual([])
      expect(notified()).toEqual([])
    })

    it('a revoked identity is answered with the refusal’s own 403 — the route does not choose the status', async () => {
      h.state.dm.standing = REVOKED
      const res = await postRes({ listingId: TEACHER, message: 'hi' })
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual(await teacherDmRefusal(REVOKED, { error: 'teacher_thread_cap' }).json())
      expect(h.state.convos).toEqual([])
      expect(h.state.dm.asked.open).toEqual([])
    })

    it('an existing teacher thread never asks the ladder — not even with nothing left today', async () => {
      h.state.dm.standing = unverifiedDay(TEACHER_DM_LIMITS.unverified)
      h.state.convos = [teacherThread('t-thread', HOUR)]
      const { status, json } = await post({ listingId: TEACHER, message: 'And Thursday?' })
      expect(status).toBe(200)
      expect(json).toMatchObject({ id: 't-thread', created: false })
      expect(h.state.delivered).toEqual([expect.objectContaining({ conversationId: 't-thread', body: 'And Thursday?' })])
      expect(h.state.dm.asked.standing).toEqual([])
      expect(h.state.dm.asked.open).toEqual([])
    })

    it('the recount under the lock refuses what the early check let through — with the LOCKED standing, and nothing is written', async () => {
      // Two taps at once: the early check saw one chat left; the other tap's thread spent it before this one took the lock.
      h.state.dm.standing = unverifiedDay(TEACHER_DM_LIMITS.unverified - 1)
      const locked = unverifiedDay(TEACHER_DM_LIMITS.unverified)
      h.state.dm.lockedStanding = locked
      const res = await postRes({ listingId: TEACHER, message: 'Can you cover Monday?' })
      const body = await res.json()
      expect(res.status).toBe(429)
      expect(body).toEqual(await teacherDmRefusal(locked, { error: 'teacher_thread_cap' }).json())
      expect(body.used).toBe(TEACHER_DM_LIMITS.unverified) // the locked count, not the early one
      expect(h.state.dm.asked.open).toHaveLength(1)
      expect(h.state.convos).toEqual([])
      expect(h.state.delivered).toEqual([])
      expect(notified()).toEqual([])
    })

    it('a concurrent request’s thread found under the lock is reused: created:false, the opener goes into it, no second ring', async () => {
      h.state.dm.concurrentThread = 'raced-thread'
      const { status, json } = await post({ listingId: TEACHER, message: 'Can you cover Monday?' })
      expect(status).toBe(200)
      // `created` drives the contact conversion event — the request that made the thread already counted it, and rang.
      expect(json).toMatchObject({ id: 'raced-thread', created: false })
      expect(h.state.convos.map((c) => c.id)).toEqual(['raced-thread'])
      expect(h.state.delivered).toEqual([expect.objectContaining({ conversationId: 'raced-thread', body: 'Can you cover Monday?' })])
      expect(notified()).toEqual([])
    })

    it('a PRODUCT thread with the same storefront is never retargeted onto its teacher — the teacher thread still comes from the ladder', async () => {
      // Retargeting would walk around the ladder — its count is threads CREATED today on a teacher listing, and the lock
      // is only taken by openTeacherThread — as well as drop the teacher strip (Opus, commit gate 09-30).
      h.state.listings['listing-teacher-book'] = listing('listing-teacher-book', TEACHER_SELLER, { seller: { ownerId: 'teacher-owner' } })
      h.state.convos = [{ ...convo('book-thread', 'listing-teacher-book', TEACHER_SELLER, Date.now() - HOUR), sellerProfileId: 'teacher-owner' }]
      const { status, json } = await post({ listingId: TEACHER, message: 'Can you cover Monday?' })
      expect(status).toBe(200)
      expect(json.created).toBe(true)
      expect(h.state.dm.created).toEqual([json.id])
      expect(h.state.convos.find((c) => c.id === 'book-thread')!.listingId).toBe('listing-teacher-book')
    })
  })

  describe('two messages until the teacher answers (owner, 2026-10-13)', () => {
    it('⛔ an opener into a thread already holding the writer\'s two unanswered messages OPENS it — nothing sent, nobody rung, and `held` says why (Opus, gate 2026-10-13)', async () => {
      // The profile's Message button sends its opener into the existing thread. At the cap it must still reach the chat:
      // a bare 429 carries no thread to go to. The thread is quiet: a delivered message WOULD have rung.
      h.state.convos = [teacherThread('t-thread', 7 * HOUR)]
      h.state.dm.mayWrite = false
      const { status, json } = await post({ listingId: TEACHER, message: 'Hello, are you open to talking?' })
      expect(status).toBe(200)
      expect(json).toEqual({ id: 't-thread', created: false, message: null, held: 'teacher_awaiting_reply' })
      expect(h.state.dm.asked.mayWrite).toEqual([{ conversationId: 't-thread', buyerProfileId: BUYER, teacherProfileId: 'teacher-owner' }])
      expect(h.state.delivered).toEqual([])
      expect(notified()).toEqual([])
    })

    it('holds a thread found under the lock to the same cap — opened, nothing sent', async () => {
      h.state.dm.concurrentThread = 'raced-thread'
      h.state.dm.mayWrite = false
      const { status, json } = await post({ listingId: TEACHER, message: 'Hello again' })
      expect(status).toBe(200)
      expect(json).toEqual({ id: 'raced-thread', created: false, message: null, held: 'teacher_awaiting_reply' })
      expect(h.state.dm.asked.mayWrite).toEqual([{ conversationId: 'raced-thread', buyerProfileId: BUYER, teacherProfileId: 'teacher-owner' }])
      expect(h.state.delivered).toEqual([])
    })

    it('⛔ every insert into a teacher thread carries the guard — the checks above are reads (codex, gate 2026-10-13)', async () => {
      h.state.convos = [teacherThread('t-thread', HOUR)]
      expect(await post({ listingId: TEACHER, message: 'Hello' })).toMatchObject({ status: 200 })
      expect(h.state.dm.asked.guarded).toEqual([{ conversationId: 't-thread', buyerProfileId: BUYER, teacherProfileId: 'teacher-owner', repeatOf: 'Hello' }])
      expect(h.state.delivered).toEqual([expect.objectContaining({ conversationId: 't-thread', body: 'Hello', alongside: ['teacher-unanswered-guard'] })])
    })

    it('⛔ a concurrent send that took the last place between the check and the insert: the thread opens `held`, nothing delivered, nobody rung', async () => {
      h.state.convos = [teacherThread('t-thread', 7 * HOUR)]
      h.state.dm.guardRefuses = 'cap'
      const { status, json } = await post({ listingId: TEACHER, message: 'Hello' })
      expect(status).toBe(200)
      expect(json).toEqual({ id: 't-thread', created: false, message: null, held: 'teacher_awaiting_reply' })
      expect(h.state.delivered).toEqual([])
      expect(notified()).toEqual([])
    })

    it('⛔ the double tap on a NEW teacher: the guard finds the other tap\'s identical opener — this tap opens the thread, sends nothing, rings nobody (codex + Opus, gate 2026-10-13)', async () => {
      h.state.dm.concurrentThread = 'raced-thread'
      h.state.dm.tail = { empty: true, repeat: false } // its read ran before the other tap's opener committed
      h.state.dm.guardRefuses = 'repeat'
      const { status, json } = await post({ listingId: TEACHER, message: 'Hello' })
      expect(status).toBe(200)
      expect(json).toEqual({ id: 'raced-thread', created: false, message: null })
      expect(h.state.dm.asked.guarded).toEqual([{ conversationId: 'raced-thread', buyerProfileId: BUYER, teacherProfileId: 'teacher-owner', repeatOf: 'Hello' }])
      expect(notified()).toEqual([])
    })

    it('⛔ a re-sent opener (the thread\'s newest message is this writer\'s own, word for word) opens the thread and sends nothing — even at the cap (Opus, gate 2026-10-13)', async () => {
      // The profile's Message button tapped again: the opener already sits in the thread, and the teacher has not answered.
      h.state.convos = [teacherThread('t-thread', 7 * HOUR)]
      h.state.dm.tail = { empty: false, repeat: true }
      h.state.dm.mayWrite = false
      expect(await post({ listingId: TEACHER, message: 'Hello, are you open to talking?' })).toEqual({ status: 200, json: { id: 't-thread', created: false, message: null } })
      expect(h.state.dm.asked.tail).toEqual([{ conversationId: 't-thread', writerProfileId: BUYER, teacherProfileId: 'teacher-owner', text: 'Hello, are you open to talking?' }])
      expect(h.state.dm.asked.mayWrite).toEqual([]) // asked BEFORE the cap: a repeat never reaches a refusal
      expect(h.state.delivered).toEqual([])
      expect(notified()).toEqual([])
    })

    it('the same for a thread found under the ladder\'s lock', async () => {
      h.state.dm.concurrentThread = 'raced-thread'
      h.state.dm.tail = { empty: false, repeat: true }
      expect(await post({ listingId: TEACHER, message: 'Hello' })).toEqual({ status: 200, json: { id: 'raced-thread', created: false, message: null } })
      expect(h.state.delivered).toEqual([])
    })

    it('a thread still EMPTY (its opener never landed) rings the teacher on the first message into it, though it is not quiet', async () => {
      h.state.convos = [teacherThread('t-thread', 0)]
      h.state.dm.tail = { empty: true, repeat: false }
      expect(await post({ listingId: TEACHER, message: 'Hello' })).toMatchObject({ status: 200, json: { id: 't-thread' } })
      expect(notified()).toEqual([{ teacherProfileId: 'teacher-owner', conversationId: 't-thread', listingId: TEACHER }])
      ;(h.state as Row).notified = []
      h.state.convos = []
      h.state.dm.concurrentThread = 'raced-thread'
      await post({ listingId: TEACHER, message: 'Hello' })
      expect(notified()).toEqual([{ teacherProfileId: 'teacher-owner', conversationId: 'raced-thread', listingId: TEACHER }])
    })

    it('a NEW thread\'s opener carries the guard too; an ordinary listing\'s message never does', async () => {
      const { json } = await post({ listingId: TEACHER, message: 'Hi' })
      expect(h.state.dm.asked.guarded).toEqual([{ conversationId: json.id, buyerProfileId: BUYER, teacherProfileId: 'teacher-owner', repeatOf: 'Hi' }])
      h.state.dm.asked.guarded = []
      h.state.delivered = []
      await post({ listingId: SHOP_A, message: 'Still available?' })
      expect(h.state.dm.asked.guarded).toEqual([])
      expect(h.state.delivered).toEqual([expect.not.objectContaining({ alongside: expect.anything() })])
    })

    it('opening the thread with nothing to send is not a message: the cap is not asked and the thread comes back', async () => {
      h.state.convos = [teacherThread('t-thread', HOUR)]
      h.state.dm.mayWrite = false
      expect(await post({ listingId: TEACHER })).toEqual({ status: 200, json: { id: 't-thread', created: false, message: null } })
      expect(h.state.dm.asked.mayWrite).toEqual([])
    })
  })
})
