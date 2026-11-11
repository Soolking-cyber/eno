import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/conversations/[id]/deal — the service-deal loop's one write path (src/lib/service-deal.ts; owner 2026-11-11,
 * spec v2 + v3 amendments). Auth, scope (by thread kind, desk seller AND desk listing), the dialog's listing snapshot, a
 * two-way thread, the generic buyer-account refusal (a VERIFIED phone, never Profile.phone), both caps (the daily one
 * re-counted under a per-seller advisory lock inside the transaction), a block, the 10-minute undo (A2: the window alone),
 * idempotency, the buyer's "No" (A2: only once the undo closed; A3: a conditional update), and the migration tolerance —
 * against an in-memory DealConfirmation with the conditional-write semantics the route relies on.
 */

type Row = Record<string, any>
const MIN = 60_000
const DAY = 86_400_000
const SELLER = 'seller-p'
const BUYER = 'buyer-p'
/** BUYER, for the hoisted mock (it cannot read a module const). */
const BUYER_ID = 'buyer-p'

const h = vi.hoisted(() => ({
  /** Runs once when a row lock is taken: another write landing while this request waited for it. */
  whileLocked: null as (() => void) | null,
  /** The database's clock inside a transaction (dbNow); unset = the request's clock. */
  dbNow: undefined as Date | undefined,
  /** The thread's listing as the row lock re-reads it; unset = the thread's own. */
  lockedListingId: undefined as string | null | undefined,
  me: 'seller-p' as string | null,
  rateOk: true,
  gates: {} as Record<string, Row | null>,
  convo: null as Row | null,
  hidden: false,
  threadKind: 'listing',
  blocked: false,
  deal: null as Row | null,
  events: [] as Row[],
  messages: [] as Row[],
  review: null as Row | null,
  inserted: [] as Row[],
  missingTable: false,
  /** The next create loses to a concurrent tap that committed the same row first (P2002). */
  createRace: false,
  /** What that concurrent tap committed — outside our transaction, so it survives our rollback. */
  otherCommit: null as Row | null,
  /** The deal's own listing when it is not the thread's (dealListingCompliance's read by id). */
  dealListing: null as Row | null,
  flags: [] as Row[],
  visaListingIds: [] as string[],
  tripAnchor: null as string | null,
  deskSellers: [] as string[],
  /** The buyer holds the 'phone_verified' trust event (written only for an eno-confirmed phone). */
  phoneVerified: false,
  /** Every advisory-lock key taken, in order, and what each lock does on acquisition (a concurrent commit landing). */
  lockKeys: [] as string[],
  onLock: null as null | (() => void),
  /** The order of the cap's reads and the lock inside the confirm transaction. */
  txLog: [] as string[],
  inTx: false,
  /** Every conditional update the route sent, with its where. */
  updates: [] as Row[],
  /** The NEXT dealConfirmation read answers this (a stale read that a concurrent write has since overtaken). */
  staleRead: null as Row | null,
}))

/** Prisma's where, as far as the route uses it on these rows. */
function matches(row: Row, where: Row): boolean {
  for (const [k, cond] of Object.entries(where)) {
    const v = row[k]
    if (cond === null) { if (v != null) return false; continue }
    if (cond instanceof Date) { if (!(v instanceof Date) || v.getTime() !== cond.getTime()) return false; continue }
    if (typeof cond === 'object') {
      if ('not' in cond && cond.not === null && v == null) return false
      if ('lt' in cond && !(v < cond.lt)) return false
      if ('lte' in cond && !(v != null && v <= cond.lte)) return false
      if ('gte' in cond && !(v != null && v >= cond.gte)) return false
      if ('gt' in cond && !(v != null && v > cond.gt)) return false
      if ('equals' in cond && !(v instanceof Date && v.getTime() === cond.equals.getTime())) return false
      if ('in' in cond && !cond.in.includes(v)) return false
      continue
    }
    if (v !== cond) return false
  }
  return true
}
const missing = () => Object.assign(new Error('The table `public.DealConfirmation` does not exist in the current database.'), { code: 'P2021' })

vi.mock('@/lib/admin', () => ({
  getCurrentProfile: async () => (h.me ? { id: h.me, displayName: 'Me', email: 'me@example.com' } : null),
  getCurrentProfileId: async () => h.me,
  getAdmin: async () => null,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: h.rateOk, resetSec: 60 }), kv: { incrby: async () => 1 } }))
vi.mock('@/lib/enforcement', async () => ({
  messagingGate: async (id: string) => h.gates[id] ?? null,
  flagForReview: async (profileId: string, reason: string) => { h.flags.push({ profileId, reason }); return true },
  // The real slugs (the pure machine), so the flag's reason is the one the admin console labels.
  ENFORCEMENT_REASON: (await import('@/lib/enforcement-machine')).ENFORCEMENT_REASON,
}))
vi.mock('@/lib/edition-scope', () => ({ isSellerHiddenHere: async () => h.hidden, deskSellerIds: async () => h.deskSellers }))
vi.mock('@/lib/visa-shop', () => ({ getVisaShopListings: async () => h.visaListingIds.map((id) => ({ id })) }))
vi.mock('@/lib/trips/dm-thread', () => ({ getTripAssistanceListingId: async () => h.tripAnchor }))
vi.mock('@/lib/thread-kind', () => ({ threadKind: async () => h.threadKind }))
vi.mock('@/lib/user-blocks', () => ({ isBlockedBetween: async () => h.blocked }))
vi.mock('@/lib/messages', () => ({
  insertMessage: async (convo: Row, senderId: string, text: string, opts?: Row) => { h.inserted.push({ conversationId: convo.id, senderId, text, kind: opts?.kind }); return { id: `m${h.inserted.length}` } },
}))
vi.mock('next/server', async (orig) => ({ ...(await orig<Record<string, unknown>>()), after: (fn: () => unknown) => { void fn() } }))
vi.mock('@/lib/db', () => {
  const pick = (r: Row | null, select?: Row) => (r && select ? Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])) : r)
  const db: Row = {
    conversation: { findUnique: async () => h.convo },
    review: { findUnique: async () => h.review },
    trustEvent: {
      findFirst: async ({ where }: Row) => (where.subjectProfileId === BUYER_ID && where.reason === 'phone_verified' && h.phoneVerified ? { id: 'te1' } : null),
    },
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join('?').includes('pg_advisory_xact_lock')) {
        h.lockKeys.push(String(values[0]))
        if (h.inTx) h.txLog.push('lock')
        h.onLock?.()
      }
      return 1
    },
    dealConfirmation: {
      findUnique: async ({ select }: Row) => {
        if (h.missingTable) throw missing()
        if (h.staleRead) { const r = h.staleRead; h.staleRead = null; return pick(r, select) }
        return pick(h.deal, select)
      },
      create: async ({ data }: Row) => {
        if (h.missingTable) throw missing()
        if (h.createRace) {
          h.createRace = false
          h.otherCommit = { ...data, revokedAt: null, declinedAt: null, reviewId: null }
          throw Object.assign(new Error('Unique constraint failed on the fields: (`conversationId`)'), { code: 'P2002' })
        }
        if (h.deal) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
        h.deal = { ...data, revokedAt: null, declinedAt: null, reviewId: null }
        return { id: 'd1' }
      },
      updateMany: async ({ where, data }: Row) => {
        if (h.missingTable) throw missing()
        h.updates.push({ where, data })
        if (!h.deal || !matches(h.deal, where)) return { count: 0 }
        for (const [k, v] of Object.entries(data)) h.deal[k] = v && typeof v === 'object' && 'increment' in (v as Row) ? h.deal[k] + (v as Row).increment : v
        return { count: 1 }
      },
      // ⛔ NO `count` HERE ON PURPOSE: the decline flag counts the 'declined' EVENTS (they survive erasure), never these rows.
    },
    // The deal's own listing, read only when it is not the thread's (dealListingCompliance).
    // The deal's own listing when a test sets it; otherwise the thread's (the confirm re-reads it under the thread's lock).
    listing: { findUnique: async ({ where }: Row) => h.dealListing ?? ((h.convo as Row | null)?.listing?.id === where.id ? (h.convo as Row).listing : null) },
    dealConfirmationEvent: {
      count: async ({ where }: Row) => {
        if (h.missingTable) throw missing()
        if (h.inTx) h.txLog.push('recount')
        return h.events.filter((e) => matches(e, where)).length
      },
      create: async ({ data }: Row) => { h.events.push({ createdAt: new Date(), ...data }); return {} },
    },
    message: {
      groupBy: async ({ where }: Row) => {
        const rows = h.messages.filter((m) => matches(m, { deletedAt: null, kind: where.kind, senderProfileId: where.senderProfileId }))
        const by = new Map<string, number>()
        for (const m of rows) by.set(m.senderProfileId, (by.get(m.senderProfileId) ?? 0) + 1)
        return [...by].map(([senderProfileId, n]) => ({ senderProfileId, _count: { _all: n } }))
      },
      count: async ({ where }: Row) => h.messages.filter((m) => matches(m, { senderProfileId: where.senderProfileId, createdAt: where.createdAt })).length,
    },
  }
  // The two raw reads the writes make inside a transaction: the DATABASE's clock (dbNow — `h.dbNow` when a test moves it past
  // the request's clock) and the thread's row lock with its listing re-read (`h.lockedListingId` when a retarget moved it).
  db.$queryRaw = async (strings: TemplateStringsArray) => {
    const q = strings.join('?')
    if (q.includes('clock_timestamp()')) return [{ now: h.dbNow ?? new Date() }]
    if (q.includes('FOR UPDATE')) {
      // A write that commits while this request waits for the row lock (`h.whileLocked`: a review, a takedown…).
      const run = h.whileLocked; h.whileLocked = null; run?.()
      return [{ listingId: h.lockedListingId === undefined ? (h.convo as Row | null)?.listingId ?? null : h.lockedListingId }]
    }
    return []
  }
  // An interactive transaction: everything it wrote is undone when it throws.
  db.$transaction = async (fn: (tx: Row) => Promise<unknown>) => {
    const before = { deal: h.deal ? { ...h.deal } : null, events: h.events.length }
    h.inTx = true
    try { return await fn(db) } catch (e) {
      // A row committed OUTSIDE this transaction (`external` — a parallel request's) is not ours to roll back.
      h.deal = before.deal; h.events = h.events.filter((e, i) => i < before.events || e.external)
      if (h.otherCommit) { h.deal = h.otherCommit; h.otherCommit = null }
      throw e
    } finally { h.inTx = false }
  }
  return { db }
})

const { POST } = await import('./route')

async function post(body: Row, as: string | null = SELLER) {
  h.me = as
  const res = await POST(new Request('https://eno.vn/api/conversations/c1/deal', { method: 'POST', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: 'c1' }) } as never)
  return { status: res.status, body: (await res.json()) as Row }
}
const confirm = (as: string | null = SELLER, listingId = 'L1') => post({ action: 'confirm', listingId }, as)
const withdraw = (as: string | null = SELLER) => post({ action: 'withdraw' }, as)
const decline = (as: string | null = BUYER) => post({ action: 'decline' }, as)

/** Move the standing confirmation `ms` into the past — A2: the buyer's "No" opens only once the 10-minute undo closed. */
const age = (ms = 11 * MIN) => { h.deal!.confirmedAt = new Date(Date.now() - ms) }
const msg = (senderProfileId: string, over: Row = {}): Row => ({ senderProfileId, kind: 'text', deletedAt: null, createdAt: new Date(Date.now() - 60 * MIN), ...over })
const rental = (over: Row = {}): Row => ({ id: 'L1', sellerId: 'shop-1', listingType: 'rent', status: 'active', complianceStatus: null, category: { slug: 'rentals' }, ...over })

beforeEach(() => {
  h.me = SELLER; h.rateOk = true; h.gates = {}; h.hidden = false; h.threadKind = 'listing'; h.blocked = false
  h.deal = null; h.events = []; h.review = null; h.inserted = []; h.missingTable = false; h.createRace = false; h.otherCommit = null
  h.dealListing = null; h.flags = []; h.visaListingIds = []; h.tripAnchor = null; h.deskSellers = []
  h.phoneVerified = false; h.lockKeys = []; h.onLock = null; h.txLog = []; h.inTx = false; h.updates = []; h.staleRead = null
  h.dbNow = undefined; h.lockedListingId = undefined; h.whileLocked = null
  h.messages = [msg(BUYER), msg(BUYER), msg(SELLER)]
  h.convo = {
    id: 'c1', listingId: 'L1', buyerProfileId: BUYER, sellerProfileId: SELLER,
    listing: rental(), seller: { id: 'shop-1', ownerId: SELLER }, buyer: { createdAt: new Date(Date.now() - 30 * DAY) },
  }
})

describe('who may confirm', () => {
  it('401 for a guest', async () => {
    expect((await confirm(null)).status).toBe(401)
  })

  it('⛔ 403 forbidden for the buyer, a stranger, or a seller profile that does not own the storefront — before anything is read about the deal', async () => {
    expect(await confirm(BUYER)).toEqual({ status: 403, body: { error: 'forbidden' } })
    expect(await confirm('stranger')).toEqual({ status: 403, body: { error: 'forbidden' } })
    h.convo!.seller.ownerId = null
    expect(await confirm()).toEqual({ status: 403, body: { error: 'forbidden' } })
    expect(h.deal).toBeNull()
    expect(h.inserted).toEqual([])
  })

  it('404 for a thread whose seller this edition hides (the thread GET\'s rule), and for an unknown thread', async () => {
    h.hidden = true
    expect((await confirm()).status).toBe(404)
    h.hidden = false; h.convo = null
    expect((await confirm()).status).toBe(404)
  })

  it('403 account_suspended (the gate\'s own body) for a suspended seller', async () => {
    h.gates[SELLER] = { error: 'account_suspended' }
    expect(await confirm()).toEqual({ status: 403, body: { error: 'account_suspended' } })
  })

  it('400 for an unknown action, or a confirm without the dialog\'s listing', async () => {
    expect((await post({ action: 'sell' })).status).toBe(400)
    expect((await post({ action: 'confirm' })).status).toBe(400)
  })

  it('409 listing_changed when the thread now points at another listing than the dialog showed', async () => {
    expect(await confirm(SELLER, 'L-other')).toEqual({ status: 409, body: { error: 'listing_changed' } })
  })
})

describe('⛔ scope — never a desk, never goods / job / wanted', () => {
  it.each([
    ['a visa thread kind', () => { h.threadKind = 'visa' }],
    ['an itinerary thread kind', () => { h.threadKind = 'itinerary' }],
    ['a rental-desk seller', () => { h.convo!.seller.id = 'eno-rental-desk'; h.convo!.listing.sellerId = 'eno-rental-desk' }],
    ['the visa / trip desk storefront', () => { h.deskSellers = ['shop-1'] }],
    ['a visa-shop listing', () => { h.visaListingIds = ['L1'] }],
    ['the trip anchor', () => { h.tripAnchor = 'L1' }],
    ['a goods listing', () => { h.convo!.listing = rental({ listingType: 'sell', category: { slug: 'electronics' } }) }],
    ['a job', () => { h.convo!.listing = rental({ listingType: 'job', category: { slug: 'jobs' } }) }],
    ['a wanted post in rentals', () => { h.convo!.listing = rental({ listingType: 'wanted' }) }],
    ['a taken-down listing', () => { h.convo!.listing = rental({ complianceStatus: 'taken_down' }) }],
  ])('403 not_reviewable for %s', async (_what, set) => {
    set()
    if (h.convo!.seller.id === 'eno-rental-desk') {
      const { RENTAL_DESK_SELLER_IDS } = await import('@/lib/rental-check/desk-ids')
      h.convo!.seller.id = RENTAL_DESK_SELLER_IDS[0]
    }
    expect(await confirm()).toEqual({ status: 403, body: { error: 'not_reviewable' } })
    expect(h.deal).toBeNull()
  })

  it('a lesson (teacher thread) and a service are in scope', async () => {
    h.convo!.listing = rental({ listingType: 'teacher', category: { slug: 'teachers' } })
    expect((await confirm()).body.deal.kind).toBe('lesson')
    h.deal = null; h.inserted = []
    h.convo!.listing = rental({ listingType: 'service', category: { slug: 'services' } })
    expect((await confirm()).body.deal.kind).toBe('service')
  })
})

describe('confirm refusals', () => {
  it('403 too_few_messages until the buyer wrote twice and the seller once (recalled messages and deal lines do not count)', async () => {
    h.messages = [msg(BUYER), msg(BUYER, { deletedAt: new Date() }), msg(SELLER), msg(SELLER, { kind: 'deal_withdrawn' })]
    expect(await confirm()).toEqual({ status: 403, body: { error: 'too_few_messages' } })
    h.messages = [msg(BUYER), msg(BUYER), msg(SELLER, { kind: 'call' })]
    expect(await confirm()).toEqual({ status: 403, body: { error: 'too_few_messages' } })
  })

  it('⛔ 403 not_yet_confirmable — ONE generic answer for a young account with no verified phone and for a suspended buyer', async () => {
    h.convo!.buyer = { createdAt: new Date(Date.now() - 6 * DAY) }
    const young = await confirm()
    h.convo!.buyer = { createdAt: new Date(Date.now() - 400 * DAY) }
    h.phoneVerified = true
    h.gates[BUYER] = { error: 'account_suspended' }
    const suspended = await confirm()
    expect(young).toEqual({ status: 403, body: { error: 'not_yet_confirmable' } })
    expect(suspended).toEqual(young)
    // a VERIFIED phone (the 'phone_verified' trust event) waives the age
    h.gates = {}
    h.convo!.buyer = { createdAt: new Date(Date.now() - 1 * DAY) }
    expect((await confirm()).status).toBe(200)
  })

  it('⛔ a typed Profile.phone is NOT a verified phone: a 1-day-old account with a phone on the row but no phone_verified event is refused', async () => {
    h.convo!.buyer = { createdAt: new Date(Date.now() - 1 * DAY), phone: '+84900000000' }
    h.phoneVerified = false
    expect(await confirm()).toEqual({ status: 403, body: { error: 'not_yet_confirmable' } })
    expect(h.deal).toBeNull()
    // …and the route never asks the row for it
    const src = (await import('node:fs')).readFileSync('src/app/api/conversations/[id]/deal/route.ts', 'utf8')
    expect(src).not.toMatch(/buyer: \{ select: \{[^}]*phone/)
    expect(src).toMatch(/db\.trustEvent\.findFirst\(\{ where: \{ subjectProfileId: convo\.buyerProfileId, reason: 'phone_verified' \}/)
  })

  it('403 blocked on confirm', async () => {
    h.blocked = true
    expect(await confirm()).toEqual({ status: 403, body: { error: 'blocked' } })
  })

  it('429 when the limiter trips', async () => {
    h.rateOk = false
    expect((await confirm()).status).toBe(429)
  })

  it('⛔ 429 confirm_cap from the DB count when the (fail-open) limiter lets the 21st through', async () => {
    h.events = Array.from({ length: 20 }, (_, i) => ({ actorProfileId: SELLER, action: 'confirm', createdAt: new Date(Date.now() - (i + 1) * MIN) }))
    expect(await confirm()).toEqual({ status: 429, body: { error: 'confirm_cap' } })
    // …a rolling 24 h: events older than that do not count
    h.events = Array.from({ length: 20 }, () => ({ actorProfileId: SELLER, action: 'confirm', createdAt: new Date(Date.now() - 25 * 3_600_000) }))
    expect((await confirm()).status).toBe(200)
  })

  it('⛔ THE CAP RACE: a confirm committed on another thread while this one waited for the per-seller advisory lock — the recount under the lock refuses the 21st and rolls back', async () => {
    // 19 standing — the count BEFORE the transaction lets this one through…
    h.events = Array.from({ length: 19 }, (_, i) => ({ actorProfileId: SELLER, action: 'confirm', createdAt: new Date(Date.now() - (i + 1) * MIN) }))
    // …but a parallel confirm (another thread of this seller) commits its event before we hold the lock.
    h.onLock = () => { h.events.push({ actorProfileId: SELLER, action: 'confirm', createdAt: new Date(), external: true }) }
    expect(await confirm()).toEqual({ status: 429, body: { error: 'confirm_cap' } })
    expect(h.deal).toBeNull()
    expect(h.inserted).toEqual([])
    expect(h.events).toHaveLength(20) // ours rolled back; only the parallel one stands
    // the lock is per SELLER, taken first, and the recount runs under it
    expect(h.lockKeys).toEqual([`deal-confirm:${SELLER}`])
    expect(h.txLog).toEqual(['lock', 'recount'])
  })

  it('…the 20th still passes the recount (>= 20 refuses, 19 + this one is fine)', async () => {
    h.events = Array.from({ length: 19 }, (_, i) => ({ actorProfileId: SELLER, action: 'confirm', createdAt: new Date(Date.now() - (i + 1) * MIN) }))
    expect((await confirm()).status).toBe(200)
    expect(h.events.filter((e) => e.action === 'confirm')).toHaveLength(20)
    expect(h.txLog).toEqual(['lock', 'recount'])
  })

  it('409 already_reviewed when an (offer-path) review already exists for the thread', async () => {
    h.review = { id: 'r1' }
    expect(await confirm()).toEqual({ status: 409, body: { error: 'already_reviewed' } })
  })
})

describe('confirm', () => {
  it('writes exactly one row, one confirm event and one deal_confirmed line; a re-tap is a no-op', async () => {
    const res = await confirm()
    expect(res.status).toBe(200)
    expect(res.body.deal).toMatchObject({ kind: 'rental', state: 'confirmed', confirmsLeft: 1 })
    expect(typeof res.body.deal.withdrawUntil).toBe('string')
    expect(h.deal).toMatchObject({ conversationId: 'c1', listingId: 'L1', sellerId: 'shop-1', sellerProfileId: SELLER, buyerProfileId: BUYER, kind: 'rental', confirmCount: 1 })
    expect(h.events.filter((e) => e.action === 'confirm')).toHaveLength(1)
    expect(h.inserted).toEqual([{ conversationId: 'c1', senderId: SELLER, text: '✅ Đã xác nhận cho thuê · Rental confirmed', kind: 'deal_confirmed' }])
    expect((await confirm()).status).toBe(200)
    expect(h.events.filter((e) => e.action === 'confirm')).toHaveLength(1)
    expect(h.inserted).toHaveLength(1)
  })

  it('a double tap that both read "no row" (P2002 on create): still one row, one line, an idempotent 200', async () => {
    h.createRace = true
    const res = await confirm()
    expect(res.status).toBe(200)
    expect(res.body.deal.state).toBe('confirmed')
    expect(h.inserted).toEqual([])
    expect(h.events).toEqual([])
  })

  it('⛔ migration tolerance: before the DDL a confirm answers 503 migration_pending, never a 500', async () => {
    h.missingTable = true
    expect(await confirm()).toEqual({ status: 503, body: { error: 'migration_pending' } })
  })
})

describe('withdraw — the 10-minute undo (spec v3 A2: the window alone)', () => {
  it('inside the window: revoked, a withdraw event, a deal_withdrawn line', async () => {
    await confirm()
    const res = await withdraw()
    expect(res.status).toBe(200)
    expect(res.body.deal).toMatchObject({ state: 'none', confirmsLeft: 1 })
    expect(h.deal).toMatchObject({ confirmedAt: null, confirmCount: 1 })
    expect(h.deal!.revokedAt).toBeInstanceOf(Date)
    expect(h.events.map((e) => e.action)).toEqual(['confirm', 'withdraw'])
    expect(h.inserted.map((m) => m.kind)).toEqual(['deal_confirmed', 'deal_withdrawn'])
    expect(h.inserted[1]!.text).toBe('↩️ Đã rút lại xác nhận · Confirmation withdrawn')
  })

  it('⛔ 409 withdraw_window_closed past 10 minutes', async () => {
    h.deal = { conversationId: 'c1', listingId: 'L1', sellerId: 'shop-1', sellerProfileId: SELLER, buyerProfileId: BUYER, kind: 'rental', confirmedAt: new Date(Date.now() - 11 * MIN), revokedAt: null, declinedAt: null, confirmCount: 1, reviewId: null }
    expect(await withdraw()).toEqual({ status: 409, body: { error: 'withdraw_window_closed' } })
    expect(h.deal.revokedAt).toBeNull()
  })

  it('⛔ A2: the buyer writing after the confirm NO LONGER closes the undo — inside the 10 minutes it still lands', async () => {
    await confirm()
    h.deal!.confirmedAt = new Date(Date.now() - 2 * MIN)
    h.messages.push(msg(BUYER, { createdAt: new Date(Date.now() - MIN) }))
    expect((await withdraw()).status).toBe(200)
    expect(h.deal!.revokedAt).toBeInstanceOf(Date)
  })

  it('⛔ the conditional withdraw re-asserts the window in its WHERE: confirmedAt > now − 10 min (the review\'s WHERE asks <=)', async () => {
    await confirm()
    await withdraw()
    const w = h.updates.find((u) => u.data.revokedAt)!.where
    expect(w).toMatchObject({ conversationId: 'c1', revokedAt: null, reviewId: null, declinedAt: null })
    expect(Math.abs(w.confirmedAt.gt.getTime() - (Date.now() - 10 * MIN))).toBeLessThan(5_000)
    expect(w.confirmedAt).not.toHaveProperty('gte')
  })

  it('⛔ a stale read inside the window, but the row\'s confirm is already past it: the conditional update refuses (withdraw_window_closed)', async () => {
    await confirm()
    h.staleRead = { ...h.deal!, confirmedAt: new Date(Date.now() - 2 * MIN) }
    h.deal!.confirmedAt = new Date(Date.now() - 11 * MIN)
    // the read and the row disagree on the instant, so the WHERE's `equals` already misses — and its `gt` alone would too
    expect(await withdraw()).toEqual({ status: 409, body: { error: 'withdraw_window_closed' } })
    expect(h.deal!.revokedAt).toBeNull()
  })

  it('⛔ 409 already_reviewed once the buyer reviewed — a withdrawal cannot erase a review that is in', async () => {
    await confirm()
    h.deal!.reviewId = 'r1'
    expect(await withdraw()).toEqual({ status: 409, body: { error: 'already_reviewed' } })
  })

  it('⛔ withdraw is NOT exempt from a block (spec v2)', async () => {
    await confirm()
    h.blocked = true
    expect(await withdraw()).toEqual({ status: 403, body: { error: 'blocked' } })
  })

  it('⛔ a third confirm: 409 confirm_budget_spent', async () => {
    await confirm(); await withdraw()
    await confirm(); await withdraw()
    expect(h.deal!.confirmCount).toBe(2)
    expect(await confirm()).toEqual({ status: 409, body: { error: 'confirm_budget_spent' } })
    expect(h.inserted.map((m) => m.kind)).toEqual(['deal_confirmed', 'deal_withdrawn', 'deal_confirmed', 'deal_withdrawn'])
  })

  it('409 not_confirmed with nothing standing; 403 forbidden for the buyer', async () => {
    expect(await withdraw()).toEqual({ status: 409, body: { error: 'not_confirmed' } })
    await confirm()
    expect(await withdraw(BUYER)).toEqual({ status: 403, body: { error: 'forbidden' } })
  })
})

describe('decline — the buyer\'s "No, I didn\'t"', () => {
  it('marks the deal declined with an event; the seller cannot confirm it again', async () => {
    await confirm()
    age()
    expect(await decline()).toEqual({ status: 200, body: { ok: true, state: 'declined' } })
    expect(h.deal!.declinedAt).toBeInstanceOf(Date)
    expect(h.events.map((e) => e.action)).toEqual(['confirm', 'declined'])
    expect(await decline()).toEqual({ status: 200, body: { ok: true, state: 'declined' } })
    // the undo window has nothing to undo, and a re-confirm is refused
    expect((await withdraw()).body).toEqual({ error: 'deal_declined' })
    expect(await confirm()).toEqual({ status: 409, body: { error: 'deal_declined' } })
  })

  it('⛔ only the thread\'s buyer; nothing to decline before a confirmation', async () => {
    expect(await decline()).toEqual({ status: 403, body: { error: 'forbidden' } })
    await confirm()
    expect(await decline(SELLER)).toEqual({ status: 403, body: { error: 'forbidden' } })
    expect(await decline('stranger')).toEqual({ status: 403, body: { error: 'forbidden' } })
  })

  it('⛔ A2: not while the seller\'s undo is open — 403 review_not_open, nothing written; open from confirmedAt + 10 min', async () => {
    await confirm()
    age(9 * MIN)
    expect(await decline()).toEqual({ status: 403, body: { error: 'review_not_open' } })
    expect(h.deal!.declinedAt).toBeNull()
    expect(h.events.map((e) => e.action)).toEqual(['confirm'])
    age(10 * MIN + 1_000)
    expect((await decline()).status).toBe(200)
  })

  it('⛔ A3: the decline is CONDITIONAL — reviewId, declinedAt and revokedAt null, confirmedAt set and <= now − 10 min', async () => {
    await confirm()
    age()
    await decline()
    const w = h.updates.find((u) => u.data.declinedAt)!.where
    expect(w).toMatchObject({ conversationId: 'c1', buyerProfileId: BUYER, reviewId: null, declinedAt: null, revokedAt: null })
    expect(w.confirmedAt.not).toBeNull()
    expect(Math.abs(w.confirmedAt.lte.getTime() - (Date.now() - 10 * MIN))).toBeLessThan(5_000)
  })

  it('⛔ A3 race: the read saw an open card, but the row was re-confirmed 2 minutes ago — the conditional update refuses (review_not_open), nothing written', async () => {
    await confirm()
    h.staleRead = { ...h.deal!, confirmedAt: new Date(Date.now() - 11 * MIN) }
    h.deal!.confirmedAt = new Date(Date.now() - 2 * MIN)
    expect(await decline()).toEqual({ status: 403, body: { error: 'review_not_open' } })
    expect(h.deal!.declinedAt).toBeNull()
    expect(h.events.map((e) => e.action)).toEqual(['confirm'])
  })

  it('⛔ A3 race: another tab said "No" between the read and the write — idempotent 200, and NO second declined event', async () => {
    await confirm()
    age()
    const firstNo = new Date(Date.now() - MIN)
    h.staleRead = { ...h.deal! }
    h.deal!.declinedAt = firstNo
    expect(await decline()).toEqual({ status: 200, body: { ok: true, state: 'declined' } })
    expect(h.deal!.declinedAt).toBe(firstNo)
    expect(h.events.filter((e) => e.action === 'declined')).toHaveLength(0)
  })

  it('⛔ A3 race: the buyer\'s review locked the row first — 409 already_reviewed, the review stands', async () => {
    await confirm()
    age()
    h.staleRead = { ...h.deal! }
    h.deal!.reviewId = 'r1'
    expect(await decline()).toEqual({ status: 409, body: { error: 'already_reviewed' } })
    expect(h.deal!.declinedAt).toBeNull()
  })

  it('⛔ A3: a declined deal is never confirmed again — and the seller\'s answer shows no confirm left', async () => {
    await confirm()
    age()
    await decline()
    expect(await confirm()).toEqual({ status: 409, body: { error: 'deal_declined' } })
    expect(h.deal!.confirmCount).toBe(1)
    expect(h.inserted.filter((m) => m.kind === 'deal_confirmed')).toHaveLength(1)
  })

  it('⛔ a third decline of one storefront\'s deals in 90 days raises the SILENT flag — its OWN reason, counted from the EVENTS', async () => {
    const declined = (over: Row = {}): Row => ({ conversationId: 'other', listingId: 'Lx', sellerId: 'shop-1', actorProfileId: 'b-x', buyerProfileId: 'b-x', action: 'declined', createdAt: new Date(Date.now() - 10 * DAY), ...over })
    // One earlier 'declined' event in the window, and three that must NOT count: outside 90 days, another storefront, a
    // different action. (No DealConfirmation row stands behind the earlier one — erasure deleted it; the event survives.)
    h.events = [
      declined(),
      declined({ createdAt: new Date(Date.now() - 91 * DAY) }),
      declined({ sellerId: 'shop-2' }),
      declined({ action: 'confirm' }),
    ]
    await confirm()
    age()
    await decline()
    expect(h.flags).toEqual([]) // 2 in the window
    h.deal!.declinedAt = null
    await decline()
    expect(h.flags).toEqual([{ profileId: SELLER, reason: 'deal_declines' }]) // 3 in the window
  })
})

describe('⛔ THE ROW DECIDES — the buyer\'s "No" after the seller switched the listing', () => {
  it.each([
    ['wanted', { listingType: 'wanted' }],
    ['sell (goods)', { listingType: 'sell', category: { slug: 'electronics' } }],
    ['job', { listingType: 'job', category: { slug: 'jobs' } }],
  ])('switched to %s after confirming: the "No" still lands', async (_what, over) => {
    await confirm()
    age()
    h.convo!.listing = rental(over)
    expect(await decline()).toEqual({ status: 200, body: { ok: true, state: 'declined' } })
    expect(h.deal!.declinedAt).toBeInstanceOf(Date)
  })

  it('⛔ a takedown of the deal\'s listing still closes it — 403 not_reviewable, nothing written', async () => {
    await confirm()
    age()
    h.convo!.listing = rental({ complianceStatus: 'taken_down' })
    expect(await decline()).toEqual({ status: 403, body: { error: 'not_reviewable' } })
    expect(h.deal!.declinedAt).toBeNull()
  })

  it('…measured on the DEAL\'s listing when the thread somehow points elsewhere (read by id; a vanished one is unavailable)', async () => {
    await confirm()
    age()
    h.convo!.listing = rental({ id: 'L-other' })
    h.dealListing = { complianceStatus: 'taken_down' }
    expect(await decline()).toEqual({ status: 403, body: { error: 'not_reviewable' } })
    h.dealListing = null
    expect(await decline()).toEqual({ status: 403, body: { error: 'not_reviewable' } })
    h.dealListing = { complianceStatus: null }
    expect((await decline()).status).toBe(200)
  })
})

/** The review round of 2026-11-11 (codex + opus on the full diff). */
describe('⛔ review round — clock, lock, stored-deal undo, licence hold', () => {
  it.each([
    ['an unpublished listing', { verified: false }],
    ['a licence-held listing (the e-Visa / legal aisles\' check)', { verified: false, verificationNotes: 'licence:held' }],
  ])('%s is out of scope: 403 not_reviewable, nothing written', async (_what, over) => {
    h.convo!.listing = rental(over)
    const res = await confirm()
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('not_reviewable')
    expect(h.deal).toBeNull()
    expect(h.events).toEqual([])
  })

  it('the confirm re-reads the thread\'s listing under its row lock: moved meanwhile → 409 listing_changed, nothing written', async () => {
    h.lockedListingId = 'L2'
    const res = await confirm()
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('listing_changed')
    expect(h.deal).toBeNull()
    expect(h.events).toEqual([])
    expect(h.inserted).toEqual([])
  })

  it('the undo is judged on the DATABASE\'s clock at the write: a request read inside the window, the write after it loses', async () => {
    await confirm()
    h.dbNow = new Date(Date.now() + 11 * MIN)
    const res = await withdraw()
    expect(res.body.error).toBe('withdraw_window_closed')
    expect(h.deal!.confirmedAt).toBeInstanceOf(Date)
    expect(h.deal!.revokedAt ?? null).toBeNull()
  })

  it('the undo follows the STORED deal: a confirmed rental switched to goods inside the 10 minutes can still be undone', async () => {
    await confirm()
    h.convo!.listing = rental({ listingType: 'sell', category: { slug: 'electronics' } })
    const res = await withdraw()
    expect(res.status).toBe(200)
    expect(res.body.deal).toMatchObject({ kind: 'rental', state: 'none' })
    expect(h.events.map((e) => e.action)).toEqual(['confirm', 'withdraw'])
  })
})

describe('⛔ review round 3 — re-checks under the locks', () => {
  it('a plain review that lands while the "No" waits for the deal row: 409 already_reviewed, no declined event, no flag', async () => {
    await confirm(); age()
    h.whileLocked = () => { h.review = { id: 'r-offer' } }
    const res = await decline()
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('already_reviewed')
    expect(h.events.map((e) => e.action)).toEqual(['confirm'])
    expect(h.flags).toEqual([])
  })
  it('a takedown that commits while the confirm waits for the thread lock: 403 not_reviewable, nothing written', async () => {
    h.whileLocked = () => { (h.convo as Row).listing.complianceStatus = 'taken_down' }
    const res = await confirm()
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('not_reviewable')
    expect(h.deal).toBeNull()
  })
  it('a plain review that lands while the confirm waits: 409 already_reviewed, nothing written', async () => {
    h.whileLocked = () => { h.review = { id: 'r-offer' } }
    const res = await confirm()
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('already_reviewed')
    expect(h.deal).toBeNull()
  })
  it('the audit times are the database clock\'s: declinedAt is the write\'s clock, not the request\'s', async () => {
    await confirm(); age()
    const at = new Date(Date.now() + 5_000)
    h.dbNow = at
    await decline()
    expect((h.deal!.declinedAt as Date).getTime()).toBe(at.getTime())
  })
})

