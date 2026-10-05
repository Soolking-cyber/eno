import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/listings/[id]/sold — the seller says who bought it, and that buyer is ASKED.
 *
 * What this pins (the trade loop's server half, 2026-10-05):
 *   · VALIDATION — a named buyer must have messaged this seller about THIS listing (the same scope the
 *     picker lists); validateMarkSold's refusals reach the wire as their own codes.
 *   · THE PRICE IS STORED — the agreed price rides in the same write; 0 / missing / implausible is stored
 *     as null, never a refused sale.
 *   · THE TRANSITION IS setStatusCore's, unchanged — called exactly as before, plus the sale columns and
 *     a compare-and-swap on the facts the decision read.
 *   · THE BUYER IS TOLD ONCE — one bell row + one push per real ask; a double tap, a re-tap of the same
 *     answer, or a lost compare-and-swap notifies nobody again.
 *
 * The database is one in-memory listing row; the fake setStatusCore applies a write to it only while the
 * caller's `expect` still matches, which is the Postgres semantics the route relies on.
 */

type Row = Record<string, any>

const SELLER_P = '00000000-0000-4000-8000-0000000000aa'
const BUYER = '00000000-0000-4000-8000-000000000001'
const OTHER = '00000000-0000-4000-8000-000000000002'

const h = vi.hoisted(() => ({
  owner: { ok: true, sellerId: 's1', profileId: '' } as Row,
  row: null as Row | null,
  /** Threads the buyer has with this seller (conversation.findMany for the listing scope). */
  threads: [] as Row[],
  threadArgs: [] as Row[],
  offerNotifs: [] as Row[],
  setStatusCalls: [] as Array<{ status: string; meta: Row | undefined }>,
  /** Force the next N setStatusCore writes to miss (a concurrent change landed). */
  missNext: 0,
  /** Mutate the row when a miss happens (what the concurrent writer did). */
  onMiss: null as null | ((row: Row) => void),
  /** A change that commits between the route's read and its write (applied before the swap compares). */
  beforeWrite: null as null | ((row: Row) => void),
  /** A change that commits right after the notification row is written (before it is verified). */
  onCreate: null as null | ((row: Row) => void),
  created: [] as Row[],
  deleted: [] as Row[],
  pushes: [] as Row[],
  afters: [] as Array<() => unknown>,
  rateOk: true,
  desk: false,
}))

vi.mock('@/lib/listing-owner', () => ({ checkListingOwner: async () => h.owner }))

vi.mock('@/lib/core/listings', () => ({
  setStatusCore: async (_id: string, status: string, meta?: Row) => {
    h.setStatusCalls.push({ status, meta })
    const row = h.row
    if (!row || row.status === 'removed') return { ok: false, code: 404, error: 'not_found' }
    if (h.missNext > 0) {
      h.missNext -= 1
      h.onMiss?.(row)
      return { ok: false, code: 404, error: 'not_found' }
    }
    if (h.beforeWrite) { h.beforeWrite(row); h.beforeWrite = null }
    // The compare-and-swap: every expected column must still hold what the caller read.
    for (const [k, v] of Object.entries(meta?.expect ?? {})) {
      const cur = row[k] instanceof Date ? row[k].getTime() : row[k]
      const want = v instanceof Date ? v.getTime() : v
      if (cur !== want) return { ok: false, code: 404, error: 'not_found' }
    }
    const wasSold = row.status === 'sold'
    Object.assign(row, {
      status,
      soldAt: wasSold ? row.soldAt : new Date('2026-10-05T00:00:00Z'),
      soldChannel: meta?.channel === 'external' ? 'external' : meta?.buyerProfileId ? 'eno' : null,
      soldToProfileId: meta?.channel === 'external' ? null : (meta?.buyerProfileId ?? null),
      soldPlatform: meta?.channel === 'external' ? (meta?.platform ?? null) : null,
      ...(meta?.sale ?? {}),
    })
    return { ok: true, status }
  },
}))

vi.mock('@/lib/db', () => ({
  db: {
    listing: { findUnique: async () => (h.row ? { ...h.row } : null) },
    conversation: { findMany: async (a: Row) => { h.threadArgs.push(a); return h.threads } },
    notification: {
      findMany: async () => h.offerNotifs,
      create: async (a: Row) => {
        h.created.push(a.data)
        if (h.onCreate && h.row) { h.onCreate(h.row); h.onCreate = null }
        return { id: 'n1' }
      },
      deleteMany: async (a: Row) => { h.deleted.push(a.where); return { count: 0 } },
    },
  },
}))
vi.mock('@/lib/edition-scope', () => ({ isServicesDeskListing: async () => h.desk, scopedListingWhere: async (w: unknown) => w }))
vi.mock('@/lib/push', () => ({ sendPushToProfile: async (id: string, p: Row) => { h.pushes.push({ id, ...p }); return 1 } }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: h.rateOk }) }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('next/server', async (orig) => ({ ...(await orig<Record<string, unknown>>()), after: (fn: () => unknown) => { h.afters.push(fn) } }))

const { POST } = await import('./route')

async function post(body: unknown) {
  const res = await POST(
    new Request('https://eno.vn/api/listings/L1/sold', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }) as never,
    { params: Promise.resolve({ id: 'L1' }) },
  )
  return { status: res.status, body: (await res.json()) as Row }
}
/** Run what the route deferred to after the response (the push). */
const flushAfter = async () => { for (const fn of h.afters.splice(0)) await fn() }

function listing(over: Row = {}): Row {
  return {
    status: 'active', complianceStatus: 'clear', soldChannel: null, soldToProfileId: null, soldPlatform: null, soldAt: null,
    salePrice: null, saleConfirmedAt: null, saleDeclinedAt: null, saleBuyerHistory: null, saleConfirmPromptedAt: null,
    price: 12_000_000, currency: '₫', title: 'Honda Vision 2021', listingType: 'sell', sellerId: 's1',
    category: { slug: 'vehicles' }, seller: { ownerId: SELLER_P, name: 'Minh Shop' },
    ...over,
  }
}

beforeEach(() => {
  h.owner = { ok: true, sellerId: 's1', profileId: SELLER_P }
  h.row = listing()
  h.threads = [{ id: 'c-buyer', listingId: 'L1' }]
  h.threadArgs = []
  h.offerNotifs = []
  h.setStatusCalls = []
  h.missNext = 0
  h.onMiss = null
  h.beforeWrite = null
  h.onCreate = null
  h.created = []
  h.deleted = []
  h.pushes = []
  h.afters = []
  h.rateOk = true
  h.desk = false
})

describe('validation — a named buyer must have messaged this seller ABOUT THIS LISTING', () => {
  it('⛔ a buyer with no thread about this listing → 400 buyer_not_in_conversations, and NOTHING is written', async () => {
    h.threads = []
    const r = await post({ buyerProfileId: BUYER, salePrice: 11_000_000 })
    expect(r).toEqual({ status: 400, body: { error: 'buyer_not_in_conversations' } })
    expect(h.setStatusCalls).toEqual([])
    expect(h.created).toEqual([])
  })

  it('the scope is the picker\'s own: threads anchored here, plus threads that carried an offer about it before a retarget', async () => {
    h.offerNotifs = [{ conversationId: 'c-moved' }]
    h.threads = [{ id: 'c-moved', listingId: 'L-other' }]
    const r = await post({ buyerProfileId: BUYER, salePrice: 11_000_000 })
    expect(r.status).toBe(200)
    expect(h.threadArgs[0].where).toEqual({ sellerId: 's1', OR: [{ listingId: 'L1' }, { id: { in: ['c-moved'] } }], buyerProfileId: BUYER })
  })

  it('a non-UUID buyer id → 400 invalid_buyer (it feeds a @db.Uuid column)', async () => {
    expect(await post({ buyerProfileId: 'not-a-uuid' })).toEqual({ status: 400, body: { error: 'invalid_buyer' } })
  })

  it('⛔ a buyer who said "No" about this listing cannot be named again → 409 buyer_declined', async () => {
    h.row = listing({ saleBuyerHistory: JSON.stringify([{ i: BUYER, a: 1, d: 2 }]) })
    expect(await post({ buyerProfileId: BUYER, salePrice: 11_000_000 })).toEqual({ status: 409, body: { error: 'buyer_declined' } })
    expect(h.setStatusCalls).toEqual([])
  })

  it('⛔ a sale the buyer CONFIRMED cannot be re-marked to someone else → 409 already_confirmed', async () => {
    h.row = listing({ status: 'sold', soldChannel: 'eno', soldToProfileId: BUYER, soldAt: new Date(), salePrice: 11_000_000, saleConfirmedAt: new Date() })
    h.threads = [{ id: 'c-other', listingId: 'L1' }]
    expect(await post({ buyerProfileId: OTHER, salePrice: 11_000_000 })).toEqual({ status: 409, body: { error: 'already_confirmed' } })
    expect(await post({ channel: 'external' })).toEqual({ status: 409, body: { error: 'already_confirmed' } })
  })

  it('⛔ a listing taken down by authority order is not "sold" → 409 listing_unavailable', async () => {
    h.row = listing({ complianceStatus: 'taken_down' })
    expect(await post({ channel: 'external' })).toEqual({ status: 409, body: { error: 'listing_unavailable' } })
  })

  it('⛔ …and a takedown landing BETWEEN the read and the write is refused too — the swap carries complianceStatus', async () => {
    h.beforeWrite = (row) => { row.complianceStatus = 'taken_down' }
    expect(await post({ buyerProfileId: BUYER, salePrice: 11_000_000 })).toEqual({ status: 409, body: { error: 'listing_unavailable' } })
    expect(h.row).toMatchObject({ status: 'active', soldToProfileId: null })
    expect(h.setStatusCalls[0].meta?.expect).toMatchObject({ complianceStatus: 'clear' })
    expect(h.created).toEqual([])
  })

  it('the owner check still comes first (401 / 403 / 404 straight from checkListingOwner)', async () => {
    h.owner = { ok: false, code: 403, error: 'forbidden' }
    expect(await post({ buyerProfileId: BUYER })).toEqual({ status: 403, body: { error: 'forbidden' } })
    expect(h.setStatusCalls).toEqual([])
  })
})

describe('the agreed price is STORED', () => {
  it('a named buyer at 11.000.000 đ → salePrice in the same write', async () => {
    await post({ buyerProfileId: BUYER, salePrice: 11_000_000 })
    expect(h.setStatusCalls[0].meta?.sale.salePrice).toBe(11_000_000)
    expect(h.row!.salePrice).toBe(11_000_000)
  })

  it('an off-eno sale keeps its price too', async () => {
    await post({ channel: 'external', platform: 'Chợ Tốt', salePrice: 10_000_000 })
    expect(h.row).toMatchObject({ status: 'sold', soldChannel: 'external', soldPlatform: 'Chợ Tốt', salePrice: 10_000_000 })
  })

  it('a giveaway\'s 0 (sent as null) and a missing price are stored as null — "did not say"', async () => {
    await post({ channel: 'external', salePrice: null })
    expect(h.row!.salePrice).toBeNull()
    h.row = listing()
    await post({ channel: 'external', salePrice: 0 })
    expect(h.row!.salePrice).toBeNull()
  })

  it('⚠️ an IMPLAUSIBLE figure is stored as null — the sale itself still lands (never a refused sale)', async () => {
    const r = await post({ buyerProfileId: BUYER, salePrice: 120_000_000_000 })
    expect(r.status).toBe(200)
    expect(h.row).toMatchObject({ status: 'sold', soldToProfileId: BUYER, salePrice: null })
  })
})

describe('the status / soldAt transition is setStatusCore\'s, exactly as before', () => {
  it('one call: status "sold", the attribution as before, plus the sale columns and the compare-and-swap', async () => {
    await post({ buyerProfileId: BUYER, salePrice: 11_000_000 })
    expect(h.setStatusCalls).toHaveLength(1)
    const { status, meta } = h.setStatusCalls[0]
    expect(status).toBe('sold')
    expect(meta).toMatchObject({ channel: 'eno', buyerProfileId: BUYER, platform: null })
    expect(Object.keys(meta!.sale).sort()).toEqual(['saleBuyerHistory', 'saleConfirmPromptedAt', 'saleConfirmedAt', 'saleDeclinedAt', 'salePrice'])
    // validateMarkSold's own soldAt is NOT passed — the transition keeps setStatusCore's rule.
    expect(meta!.sale).not.toHaveProperty('soldAt')
    expect(meta!.expect).toMatchObject({ status: 'active', complianceStatus: 'clear', soldToProfileId: null, saleBuyerHistory: null, saleConfirmedAt: null })
  })

  it('an empty body is still a plain sold with no attribution (the native default)', async () => {
    const r = await post(undefined)
    expect(r).toEqual({ status: 200, body: { ok: true, asked: false } })
    expect(h.row).toMatchObject({ status: 'sold', soldChannel: null, soldToProfileId: null })
  })
})

describe('THE BUYER IS TOLD — once', () => {
  it('naming a buyer: ONE bell row into their thread with the seller, ONE push, and saleConfirmPromptedAt stamped', async () => {
    const r = await post({ buyerProfileId: BUYER, salePrice: 11_200_000 })
    expect(r).toEqual({ status: 200, body: { ok: true, asked: true } })
    expect(h.created).toEqual([{
      recipientId: BUYER,
      type: 'sale_confirm',
      title: 'Xác nhận đã mua · Confirm your purchase',
      body: 'Minh Shop: Honda Vision 2021 · 11.200.000 đ',
      actorName: 'Minh Shop',
      conversationId: 'c-buyer',
      listingId: 'L1',
    }])
    // A re-ask replaces rather than stacks: that buyer's earlier row for this listing goes first.
    expect(h.deleted).toEqual([{ recipientId: BUYER, type: 'sale_confirm', listingId: 'L1' }])
    expect(h.row!.saleConfirmPromptedAt).toBeInstanceOf(Date)
    await flushAfter()
    expect(h.pushes).toEqual([{ id: BUYER, title: 'Xác nhận đã mua · Confirm your purchase', body: 'Minh Shop: Honda Vision 2021 · 11.200.000 đ', url: '/messages/c-buyer', tag: 'sale-confirm-L1' }])
  })

  it('⛔ a DOUBLE TAP (the same answer again) notifies nobody a second time', async () => {
    await post({ buyerProfileId: BUYER, salePrice: 11_000_000 })
    const again = await post({ buyerProfileId: BUYER, salePrice: 11_000_000 })
    expect(again).toEqual({ status: 200, body: { ok: true, asked: false } })
    expect(h.created).toHaveLength(1)
  })

  it('⛔ two requests RACING (the second\'s write misses the swap) — it re-reads, sees the first, and notifies nobody', async () => {
    // Request 2 decided on the pre-sale row; request 1 committed in between. The miss, then the re-read.
    h.missNext = 1
    h.onMiss = (row) => {
      Object.assign(row, {
        status: 'sold', soldChannel: 'eno', soldToProfileId: BUYER, soldAt: new Date(), salePrice: 11_000_000,
        saleBuyerHistory: JSON.stringify([{ i: BUYER, a: Date.now(), p: 11_000_000, n: 1 }]), saleConfirmPromptedAt: new Date(),
      })
    }
    const r = await post({ buyerProfileId: BUYER, salePrice: 11_000_000 })
    expect(r).toEqual({ status: 200, body: { ok: true, asked: false } })
    expect(h.setStatusCalls).toHaveLength(2)
    expect(h.created).toEqual([])
  })

  it('a corrected PRICE re-asks — replacing the earlier row, never stacking a second question', async () => {
    await post({ buyerProfileId: BUYER, salePrice: 11_000_000 })
    await post({ buyerProfileId: BUYER, salePrice: 10_500_000 })
    expect(h.created.map((n) => n.body)).toEqual(['Minh Shop: Honda Vision 2021 · 11.000.000 đ', 'Minh Shop: Honda Vision 2021 · 10.500.000 đ'])
    expect(h.deleted).toHaveLength(2)
  })

  it('re-attributing AWAY from a buyer withdraws THEIR question', async () => {
    await post({ buyerProfileId: BUYER, salePrice: 11_000_000 })
    h.deleted = []
    await post({ channel: 'external', salePrice: 11_000_000 })
    expect(h.deleted).toEqual([{ recipientId: BUYER, type: 'sale_confirm', listingId: 'L1' }])
  })

  it('off-eno and unattributed sales ask nobody', async () => {
    await post({ channel: 'external' })
    h.row = listing()
    await post({})
    expect(h.created).toEqual([])
  })

  it('⛔ NOT a sale of goods (a rental marked sold with a buyer): the attribution is recorded, the question is not', async () => {
    h.row = listing({ listingType: 'rent' })
    const r = await post({ buyerProfileId: BUYER, salePrice: 11_000_000 })
    expect(r.body).toEqual({ ok: true, asked: false })
    expect(h.row).toMatchObject({ soldChannel: 'eno', soldToProfileId: BUYER, saleBuyerHistory: null, saleConfirmPromptedAt: null })
    expect(h.created).toEqual([])
  })

  it('⛔ the services desk is never asked (the bell is shared with eno.vn)', async () => {
    h.desk = true
    await post({ buyerProfileId: BUYER, salePrice: 11_000_000 })
    expect(h.created).toEqual([])
    expect(h.row!.saleConfirmPromptedAt).toBeNull()
  })

  it('the daily bound (relist → re-mark loops): over it, no NEW bell row and no push — but the OLD row still goes, and `asked` says so', async () => {
    h.rateOk = false
    const r = await post({ buyerProfileId: BUYER, salePrice: 11_000_000 })
    // The sale lands and the question is recorded (the thread shows it) — the buyer was just not notified.
    expect(r).toEqual({ status: 200, body: { ok: true, asked: false } })
    expect(h.row).toMatchObject({ status: 'sold', soldToProfileId: BUYER, salePrice: 11_000_000 })
    // ⛔ The earlier row (an older price) is withdrawn FIRST — never left in the bell beside a new question.
    expect(h.deleted).toEqual([{ recipientId: BUYER, type: 'sale_confirm', listingId: 'L1' }])
    expect(h.created).toEqual([])
    await flushAfter()
    expect(h.pushes).toEqual([])
  })

  it('⛔ a change landing right after the row is written (a relist, a re-attribution) → the row is VERIFIED, removed again, and no push', async () => {
    // The relist's own withdrawal ran before this row existed; the post-write check is what catches it.
    h.onCreate = (row) => { Object.assign(row, { status: 'active', soldChannel: null, soldToProfileId: null, saleBuyerHistory: null }) }
    const r = await post({ buyerProfileId: BUYER, salePrice: 11_000_000 })
    expect(r).toEqual({ status: 200, body: { ok: true, asked: false } })
    expect(h.created).toHaveLength(1)
    expect(h.deleted).toEqual([{ recipientId: BUYER, type: 'sale_confirm', listingId: 'L1' }, { id: 'n1' }])
    await flushAfter()
    expect(h.pushes).toEqual([])
  })

  it('…and the same when a second correction moved the PRICE first — a row must describe the question being asked', async () => {
    h.onCreate = (row) => { row.saleBuyerHistory = JSON.stringify([{ i: BUYER, a: Date.now(), p: 10_000_000, n: 2 }]); row.salePrice = 10_000_000 }
    expect((await post({ buyerProfileId: BUYER, salePrice: 11_000_000 })).body).toEqual({ ok: true, asked: false })
    expect(h.deleted).toContainEqual({ id: 'n1' })
  })
})

describe('a write that keeps missing', () => {
  it('a listing removed mid-request → 404 not_found (the re-read tells it from a race)', async () => {
    h.missNext = 1
    h.onMiss = (row) => { row.status = 'removed' }
    expect(await post({ channel: 'external' })).toEqual({ status: 404, body: { error: 'not_found' } })
  })

  it('a row that changes under every attempt → 409 not_actionable, never a blind write', async () => {
    h.missNext = 3
    expect(await post({ channel: 'external' })).toEqual({ status: 409, body: { error: 'not_actionable' } })
    expect(h.setStatusCalls).toHaveLength(3)
  })
})
