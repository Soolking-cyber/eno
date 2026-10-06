import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/listings/[id]/sale-confirmation — the BUYER's one-tap answer to "did you buy this?".
 *
 * What this pins:
 *   · ONLY THE ATTRIBUTED BUYER — anyone else (the seller included) gets the same 403 in every state.
 *   · IDEMPOTENT — the same answer twice is 200 twice and one write; the other answer once one is
 *     recorded is 409 already_resolved with what IS recorded.
 *   · DECLINE SEMANTICS — the sale stays sold (status, soldAt, the seller's attribution untouched); the
 *     buyer's "No" is stamped and recorded against them for good; nothing about it counts as confirmed.
 *   · THE ANSWER IS TO THE QUESTION SHOWN — a moved price, a closed window, or a seller's change landing
 *     between read and write is never answered blind.
 */

type Row = Record<string, any>

const SELLER_P = '00000000-0000-4000-8000-0000000000aa'
const BUYER = '00000000-0000-4000-8000-000000000001'
const STRANGER = '00000000-0000-4000-8000-000000000009'

const h = vi.hoisted(() => ({
  userId: '' as string | null,
  row: null as Row | null,
  writes: [] as Row[],
  /** Force the next N conditional writes to miss; `onMiss` is what the concurrent writer did. */
  missNext: 0,
  onMiss: null as null | ((row: Row) => void),
  markRead: [] as Row[],
  desk: false,
  rateOk: true,
  afters: [] as Array<() => unknown>,
  recomputed: [] as string[],
  /** ForumUserBlock rows (App Store gate `ugc-safety`), and how many times the table was asked. */
  blocks: [] as Row[],
  blockLookups: 0,
}))

// What the route defers to after the response, and the trust recompute a "No" asks for (owner, 2026-10-06).
vi.mock('next/server', async (orig) => ({ ...(await orig<Record<string, unknown>>()), after: (fn: () => unknown) => { h.afters.push(fn) } }))
vi.mock('@/lib/trust', () => ({ recomputeTrust: async (id: string) => { h.recomputed.push(id); return null } }))
const flushAfter = async () => { for (const fn of h.afters.splice(0)) await fn() }

vi.mock('@/lib/admin', () => ({
  getAdmin: async () => null,
  getCurrentProfile: async () => (h.userId ? { id: h.userId } : null),
  getCurrentProfileId: async () => h.userId,
  isAdminEmail: () => false,
}))
vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findUnique: async () => (h.row ? { ...h.row } : null),
      updateMany: async (a: Row) => {
        h.writes.push(a)
        if (h.missNext > 0) { h.missNext -= 1; h.onMiss?.(h.row!); return { count: 0 } }
        Object.assign(h.row!, a.data)
        return { count: 1 }
      },
    },
    notification: { updateMany: async (a: Row) => { h.markRead.push(a); return { count: 1 } } },
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
vi.mock('@/lib/edition-scope', () => ({ isServicesDeskListing: async () => h.desk, scopedListingWhere: async (w: unknown) => w }))
vi.mock('@/lib/push', () => ({ sendPushToProfile: async () => 0 }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: h.rateOk, resetSec: 60 }) }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))

const { POST } = await import('./route')

async function answer(body: unknown) {
  const res = await POST(
    new Request('https://eno.vn/api/listings/L1/sale-confirmation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: 'L1' }) },
  )
  return { status: res.status, body: (await res.json()) as Row }
}

const askedAt = Date.now() - 2 * 86_400_000 // two days ago — well inside the 14-day window
/** A sale the seller attributed to BUYER at 11.200.000 đ, and asked them about. */
function sold(over: Row = {}): Row {
  return {
    status: 'sold', complianceStatus: 'clear', soldChannel: 'eno', soldToProfileId: BUYER, soldAt: new Date(askedAt),
    salePrice: 11_200_000, saleConfirmedAt: null, saleDeclinedAt: null,
    saleBuyerHistory: JSON.stringify([{ i: BUYER, a: askedAt, p: 11_200_000, n: 1 }]),
    saleConfirmPromptedAt: new Date(askedAt),
    sellerId: 's1', listingType: 'sell', category: { slug: 'vehicles' }, seller: { ownerId: SELLER_P },
    ...over,
  }
}

beforeEach(() => {
  h.userId = BUYER
  h.row = sold()
  h.writes = []
  h.missNext = 0
  h.onMiss = null
  h.markRead = []
  h.desk = false
  h.rateOk = true
  h.afters = []
  h.recomputed = []
  h.blocks = []
  h.blockLookups = 0
})
afterEach(() => vi.unstubAllEnvs())

describe('⛔ only the attributed buyer may answer', () => {
  it('a stranger → 403 forbidden, nothing written', async () => {
    h.userId = STRANGER
    expect(await answer({ answer: 'confirm', price: 11_200_000 })).toEqual({ status: 403, body: { error: 'forbidden' } })
    expect(h.writes).toEqual([])
  })

  it('the SELLER cannot confirm their own sale → 403', async () => {
    h.userId = SELLER_P
    expect((await answer({ answer: 'confirm', price: 11_200_000 })).status).toBe(403)
    expect(h.writes).toEqual([])
  })

  it('⛔ identity BEFORE outcome: a stranger gets the same 403 for a confirmed, a declined and an off-eno sale', async () => {
    h.userId = STRANGER
    for (const over of [{ saleConfirmedAt: new Date() }, { saleDeclinedAt: new Date() }, { soldChannel: 'external', soldToProfileId: null }]) {
      h.row = sold(over)
      expect(await answer({ answer: 'decline', price: 11_200_000 })).toEqual({ status: 403, body: { error: 'forbidden' } })
    }
  })

  it('a relisted listing has no question left — the former buyer gets 403', async () => {
    h.row = sold({ status: 'active', soldChannel: null, soldToProfileId: null })
    expect((await answer({ answer: 'confirm', price: 11_200_000 })).status).toBe(403)
  })

  it('a listing the trade loop never asks about (a rental; the services desk) → 403', async () => {
    h.row = sold({ listingType: 'rent' })
    expect((await answer({ answer: 'confirm', price: 11_200_000 })).status).toBe(403)
    h.row = sold()
    h.desk = true
    expect((await answer({ answer: 'confirm', price: 11_200_000 })).status).toBe(403)
    expect(h.writes).toEqual([])
  })

  it('a guest → 401; a malformed body → 400 invalid_body; an unknown or removed listing → 404', async () => {
    h.userId = null
    expect((await answer({ answer: 'confirm', price: 1 })).status).toBe(401)
    h.userId = BUYER
    expect(await answer({ answer: 'maybe', price: 1 })).toEqual({ status: 400, body: { error: 'invalid_body' } })
    expect(await answer({ answer: 'confirm' })).toEqual({ status: 400, body: { error: 'invalid_body' } })
    h.row = null
    expect(await answer({ answer: 'confirm', price: 11_200_000 })).toEqual({ status: 404, body: { error: 'not_found' } })
    h.row = sold({ status: 'removed' })
    expect((await answer({ answer: 'confirm', price: 11_200_000 })).status).toBe(404)
  })
})

describe('confirm — and it is idempotent', () => {
  it('Yes → 200 confirmed: saleConfirmedAt stamped, as a CONDITIONAL write bound to the question asked', async () => {
    expect(await answer({ answer: 'confirm', price: 11_200_000 })).toEqual({ status: 200, body: { ok: true, status: 'confirmed' } })
    expect(h.writes).toHaveLength(1)
    const w = h.writes[0]
    expect(w.data.saleConfirmedAt).toBeInstanceOf(Date)
    expect(w.data.saleDeclinedAt).toBeNull()
    // The precondition carries the buyer, the channel, both answers still empty, the price, the history —
    // and the compliance status, by equality.
    expect(w.where).toMatchObject({
      id: 'L1', status: 'sold', soldChannel: 'eno', soldToProfileId: BUYER, saleConfirmedAt: null, saleDeclinedAt: null,
      salePrice: 11_200_000, saleBuyerHistory: sold().saleBuyerHistory, complianceStatus: 'clear',
    })
    // The bell row that asked them is answered.
    expect(h.markRead).toEqual([{ where: { recipientId: BUYER, type: 'sale_confirm', listingId: 'L1', read: false }, data: { read: true } }])
  })

  it('Yes again → 200 confirmed, and NOTHING is written the second time (a double tap, a retried request)', async () => {
    await answer({ answer: 'confirm', price: 11_200_000 })
    expect(await answer({ answer: 'confirm', price: 11_200_000 })).toEqual({ status: 200, body: { ok: true, status: 'confirmed' } })
    expect(h.writes).toHaveLength(1)
  })

  it('two taps RACING (the second write misses) → the re-read sees the first, and it is still 200 — one write', async () => {
    h.missNext = 1
    h.onMiss = (row) => { row.saleConfirmedAt = new Date() }
    expect(await answer({ answer: 'confirm', price: 11_200_000 })).toEqual({ status: 200, body: { ok: true, status: 'confirmed' } })
    expect(h.writes).toHaveLength(1)
  })

  it('⛔ "No" after "Yes" → 409 already_resolved WITH what is recorded — never a second, contradicting answer', async () => {
    await answer({ answer: 'confirm', price: 11_200_000 })
    expect(await answer({ answer: 'decline', price: 11_200_000 })).toEqual({ status: 409, body: { error: 'already_resolved', status: 'confirmed' } })
    expect(h.writes).toHaveLength(1)
  })
})

describe('decline — the sale stays sold; it is simply not confirmed', () => {
  it('No → 200 declined: ONLY the answer columns move — status, soldAt and the seller\'s attribution stay', async () => {
    const before = sold()
    expect(await answer({ answer: 'decline', price: 11_200_000 })).toEqual({ status: 200, body: { ok: true, status: 'declined' } })
    const data = h.writes[0].data
    expect(Object.keys(data).sort()).toEqual(['saleBuyerHistory', 'saleConfirmedAt', 'saleDeclinedAt'])
    expect(data.saleDeclinedAt).toBeInstanceOf(Date)
    expect(data.saleConfirmedAt).toBeNull()
    expect(h.row).toMatchObject({ status: 'sold', soldAt: before.soldAt, soldChannel: 'eno', soldToProfileId: BUYER, salePrice: 11_200_000 })
  })

  it('⛔ the "No" is recorded AGAINST THIS BUYER for good — the seller can never name them for this listing again', async () => {
    await answer({ answer: 'decline', price: 11_200_000 })
    const history = JSON.parse(h.row!.saleBuyerHistory) as Row[]
    expect(history).toEqual([expect.objectContaining({ i: BUYER, d: expect.any(Number) })])
  })

  it('⛔ a "No" recomputes the SELLER’s trust (the disputed sale leaves their record); a "Yes" does not', async () => {
    await answer({ answer: 'decline', price: 11_200_000 })
    await flushAfter()
    expect(h.recomputed).toEqual([SELLER_P])
    h.row = sold()
    h.writes = []
    h.recomputed = []
    await answer({ answer: 'confirm', price: 11_200_000 })
    await flushAfter()
    expect(h.recomputed).toEqual([])
  })

  it('No again → 200 declined, no second write; Yes after No → 409 already_resolved {status: declined}', async () => {
    await answer({ answer: 'decline', price: 11_200_000 })
    expect(await answer({ answer: 'decline', price: 11_200_000 })).toEqual({ status: 200, body: { ok: true, status: 'declined' } })
    expect(await answer({ answer: 'confirm', price: 11_200_000 })).toEqual({ status: 409, body: { error: 'already_resolved', status: 'declined' } })
    expect(h.writes).toHaveLength(1)
  })
})

describe('the answer is to the question SHOWN', () => {
  it('⛔ the seller changed the price since the buyer opened it → 409 not_actionable, nothing written', async () => {
    h.row = sold({ salePrice: 10_000_000, saleBuyerHistory: JSON.stringify([{ i: BUYER, a: askedAt, p: 10_000_000, n: 2 }]) })
    expect(await answer({ answer: 'confirm', price: 11_200_000 })).toEqual({ status: 409, body: { error: 'not_actionable' } })
    expect(h.writes).toEqual([])
  })

  it('a question asked with NO price is answered with price null', async () => {
    h.row = sold({ salePrice: null, saleBuyerHistory: JSON.stringify([{ i: BUYER, a: askedAt, p: null, n: 1 }]) })
    expect((await answer({ answer: 'confirm', price: null })).status).toBe(200)
  })

  it('the 14-day window has closed → 409 not_actionable', async () => {
    const old = Date.now() - 20 * 86_400_000
    h.row = sold({ soldAt: new Date(old), saleBuyerHistory: JSON.stringify([{ i: BUYER, a: old, p: 11_200_000, n: 1 }]) })
    expect(await answer({ answer: 'confirm', price: 11_200_000 })).toEqual({ status: 409, body: { error: 'not_actionable' } })
  })

  it('⛔ taken down by authority order → 409 listing_unavailable (no trust, no price, for removed goods)', async () => {
    h.row = sold({ complianceStatus: 'taken_down' })
    expect(await answer({ answer: 'confirm', price: 11_200_000 })).toEqual({ status: 409, body: { error: 'listing_unavailable' } })
    expect(h.writes).toEqual([])
  })

  it('⛔ a TAKEDOWN landing between the read and the write makes it miss — the re-read answers listing_unavailable', async () => {
    h.missNext = 1
    h.onMiss = (row) => { row.complianceStatus = 'taken_down' }
    expect(await answer({ answer: 'confirm', price: 11_200_000 })).toEqual({ status: 409, body: { error: 'listing_unavailable' } })
    expect(h.row!.saleConfirmedAt).toBeNull()
  })

  it('a seller RE-ATTRIBUTING between the read and the write makes it miss — the re-read then says it is not theirs', async () => {
    h.missNext = 1
    h.onMiss = (row) => { row.soldToProfileId = STRANGER }
    expect(await answer({ answer: 'confirm', price: 11_200_000 })).toEqual({ status: 403, body: { error: 'forbidden' } })
    expect(h.row!.saleConfirmedAt).toBeNull()
  })

  it('rate limited → 429', async () => {
    h.rateOk = false
    expect((await answer({ answer: 'confirm', price: 11_200_000 })).status).toBe(429)
  })
})

/**
 * ⛔ NO CONFIRM CROSSES A BLOCK (App Store gate `ugc-safety`, audit 1.6), either way: sale-question lists nothing
 * then, and this refuses alike — the "no question to answer" 403, which the prompt reads as "no longer open".
 * A DECLINE still goes through: it is the buyer's only way to keep an invented sale out of the seller's trust.
 * An answer already on record still reads back. Off: unchanged, and no lookup.
 */
describe('⛔ no confirm crosses a block (App Store gate `ugc-safety`)', () => {
  it('gate OFF: a stored block changes nothing and is never looked up', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    h.blocks = [{ blockerProfileId: BUYER, blockedProfileId: SELLER_P }]
    expect(await answer({ answer: 'confirm', price: 11_200_000 })).toEqual({ status: 200, body: { ok: true, status: 'confirmed' } })
    expect(h.blockLookups).toBe(0)
  })

  it.each([
    ['the buyer blocked the seller', BUYER, SELLER_P],
    ['the seller blocked the buyer', SELLER_P, BUYER],
  ])('gate ON, %s: Yes → 403 forbidden — nothing written, the bell row left alone, no trust recompute', async (_case, blocker, blocked) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.blocks = [{ blockerProfileId: blocker, blockedProfileId: blocked }]
    expect(await answer({ answer: 'confirm', price: 11_200_000 })).toEqual({ status: 403, body: { error: 'forbidden' } })
    expect(h.writes).toEqual([])
    expect(h.markRead).toEqual([])
    await flushAfter()
    expect(h.recomputed).toEqual([])
  })

  it.each([
    ['the buyer blocked the seller', BUYER, SELLER_P],
    ['the seller blocked the buyer', SELLER_P, BUYER],
  ])('gate ON, %s: No still goes through — a falsely named buyer can always deny the sale', async (_case, blocker, blocked) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.blocks = [{ blockerProfileId: blocker, blockedProfileId: blocked }]
    expect(await answer({ answer: 'decline', price: 11_200_000 })).toEqual({ status: 200, body: { ok: true, status: 'declined' } })
    expect(h.row!.saleDeclinedAt).not.toBeNull()
  })

  it('gate ON, blocked: an answer already ON RECORD reads back exactly as before (200 / 409 already_resolved), writing nothing', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.row = sold({ saleConfirmedAt: new Date() })
    h.blocks = [{ blockerProfileId: BUYER, blockedProfileId: SELLER_P }]
    expect(await answer({ answer: 'confirm', price: 11_200_000 })).toEqual({ status: 200, body: { ok: true, status: 'confirmed' } })
    expect(await answer({ answer: 'decline', price: 11_200_000 })).toEqual({ status: 409, body: { error: 'already_resolved', status: 'confirmed' } })
    expect(h.writes).toEqual([])
  })

  it('gate ON, no block between these two: answered as before', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.blocks = [{ blockerProfileId: BUYER, blockedProfileId: STRANGER }]
    expect(await answer({ answer: 'confirm', price: 11_200_000 })).toEqual({ status: 200, body: { ok: true, status: 'confirmed' } })
    expect(h.blockLookups).toBe(1)
  })

  it('gate ON: identity still comes first — a stranger gets the same 403 with no block lookup', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.userId = STRANGER
    h.blocks = [{ blockerProfileId: STRANGER, blockedProfileId: SELLER_P }]
    expect(await answer({ answer: 'confirm', price: 11_200_000 })).toEqual({ status: 403, body: { error: 'forbidden' } })
    expect(h.blockLookups).toBe(0)
  })
})
