import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The paid-ad money path (src/lib/ads/book.ts, owner 2026-11-23; codex plan review 2026-11-23). The facilitator is a fake
 * fetch; the ListingAd table is an in-memory stand-in honouring the guarded updates and the paymentId unique key.
 */
vi.mock('server-only', () => ({}))
type Ad = Record<string, any>
const h = vi.hoisted(() => ({
  ads: [] as Ad[],
  listing: { id: 'l1', title: 'Honda Vision', sellerId: 's1', subcategorySlug: 'motorbikes', category: { slug: 'vehicles' } } as Record<string, any> | null,
  live: 1,
  chain: { found: false } as { found: boolean; txHash?: string; cancelled?: boolean },
  used: false,
}))
const matches = (row: Ad, where: Ad): boolean => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('in' in v) return (v.in as unknown[]).includes(row[k])
    if ('gt' in v) return row[k] != null && row[k] > v.gt
    if ('lte' in v) return row[k] != null && row[k] <= v.lte
  }
  return row[k] === v
})
vi.mock('@/lib/db', () => {
  const listingAd = {
    findUnique: async ({ where }: { where: Ad }) => h.ads.find((a) => matches(a, where)) ?? null,
    findUniqueOrThrow: async ({ where }: { where: Ad }) => { const a = h.ads.find((x) => matches(x, where)); if (!a) throw new Error('nf'); return a },
    findFirst: async ({ where }: { where: Ad }) => h.ads.filter((a) => matches(a, where)).sort((a, b) => b.endsAt - a.endsAt)[0] ?? null,
    findMany: async ({ where }: { where: Ad }) => h.ads.filter((a) => matches(a, where)),
    create: async ({ data }: { data: Ad }) => {
      if (h.ads.some((a) => a.paymentId === data.paymentId)) {
        const { Prisma } = await import('@/generated/prisma/client')
        throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' })
      }
      const row = { id: `ad${h.ads.length + 1}`, createdAt: new Date(), updatedAt: new Date(), startsAt: null, endsAt: null, txHash: null, settlementJson: null, failReason: null, impressions: 0, clicks: 0, ...data }
      h.ads.push(row)
      return row
    },
    updateMany: async ({ where, data }: { where: Ad; data: Ad }) => {
      const rows = h.ads.filter((a) => matches(a, where))
      rows.forEach((r) => Object.assign(r, data, { updatedAt: new Date() }))
      return { count: rows.length }
    },
  }
  const db = {
    listingAd,
    listing: { findUnique: async () => h.listing, count: async () => h.live },
    listingDailyStat: { findFirst: async () => null },
    $executeRaw: async () => 1,
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  }
  return { db }
})
vi.mock('@/app/api/listings/feed-query', () => ({ buildFeedFilters: async () => ({ where: {} }) }))
vi.mock('@/lib/log', () => ({ logError: () => {}, logWarn: () => {} }))
vi.mock('@/lib/x402/chain', () => ({ findAuthorizationPayment: async () => h.chain, authorizationUsed: async () => h.used }))

const { bookAd, reconcileAd, reconcileOpenAds } = await import('./book')
const { x402Config, adRequirements } = await import('@/lib/x402/config')

const PAY_TO = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C'
const cfg = x402Config({ X402_PAY_TO: PAY_TO, X402_NETWORK: 'eip155:84532', X402_FACILITATOR_URL: 'https://x402.org/facilitator' } as unknown as NodeJS.ProcessEnv)!
const TX = `0x${'c'.repeat(64)}`

function payload(nonceByte = 'f3') {
  const ours = adRequirements(cfg)
  return {
    x402Version: 2,
    accepted: ours,
    payload: {
      signature: `0x${'ab'.repeat(65)}`,
      authorization: { from: '0x857b06519E91e3A54538791bDbb0E22373e36b66', to: PAY_TO, value: ours.amount, validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 240), nonce: `0x${nonceByte.repeat(32)}` },
    },
  }
}

type Step = { verify?: object | 'throw'; settle?: object | 'throw' | { status: number; body: object } }
function facilitator(step: Step, hours = 168) {
  const calls: string[] = []
  const f = (async (url: URL | string, init?: RequestInit) => {
    const op = String(url).endsWith('/verify') ? 'verify' : 'settle'
    calls.push(op)
    const body = JSON.parse(String(init?.body))
    // ⛔ OUR requirements go to the facilitator, never the buyer's copy.
    // ⛔ OUR requirements for the length bought go to the facilitator, never the buyer's copy.
    expect(body.paymentRequirements).toEqual(adRequirements(cfg, hours))
    const v = step[op]
    if (v === 'throw' || v === undefined) throw new Error('timeout')
    if ('status' in (v as object)) { const s = v as { status: number; body: object }; return new Response(JSON.stringify(s.body), { status: s.status }) }
    return new Response(JSON.stringify(v), { status: 200 })
  }) as typeof fetch
  return { f, calls }
}

const OK = { verify: { isValid: true, payer: '0x857b' }, settle: { success: true, transaction: TX, network: 'eip155:84532', payer: '0x857b' } }
const book = (raw: unknown, f: typeof fetch, listingId = 'l1', sellerId = 's1') => bookAd({ cfg, keyId: 'k1', sellerId, listingId, rawPayload: raw, via: 'http', fetchImpl: f })

beforeEach(() => {
  h.ads = []
  h.listing = { id: 'l1', title: 'Honda Vision', sellerId: 's1', subcategorySlug: 'motorbikes', category: { slug: 'vehicles' } }
  h.live = 1
  h.chain = { found: false }
  h.used = false
})

describe('bookAd', () => {
  it('a paid booking: verify, pending row with the whole authorization, settle, active for 7 days', async () => {
    const { f, calls } = facilitator(OK)
    const r = await book(payload(), f)
    expect(calls).toEqual(['verify', 'settle'])
    expect(r.kind).toBe('booked')
    const ad = h.ads[0]
    expect(ad).toMatchObject({ status: 'active', txHash: TX, listingId: 'l1', sellerId: 's1', amount: '3760000', payTo: PAY_TO, authNonce: `0x${'f3'.repeat(32)}` })
    expect(ad.endsAt.getTime() - ad.startsAt.getTime()).toBe(7 * 86_400_000)
  })

  it('the same payment again returns the same ad and calls nobody (a retry or a replay is never a second ad)', async () => {
    await book(payload(), facilitator(OK).f)
    const again = facilitator(OK)
    const r = await book(payload(), again.f)
    expect(r).toMatchObject({ kind: 'booked', replay: true })
    expect(again.calls).toEqual([])
    expect(h.ads).toHaveLength(1)
  })

  it('the same payment for another listing is refused (409), never re-used', async () => {
    await book(payload(), facilitator(OK).f)
    h.listing = { ...h.listing!, id: 'l2' }
    expect(await book(payload(), facilitator(OK).f, 'l2')).toMatchObject({ kind: 'refused', status: 409, code: 'payment_already_used' })
  })

  it('a payload that is not our offer is refused before anything is called', async () => {
    const { f, calls } = facilitator(OK)
    const p = payload()
    p.accepted = { ...p.accepted, amount: '1' }
    expect((await book(p, f)).kind).toBe('payment_invalid')
    expect(calls).toEqual([])
    expect(h.ads).toHaveLength(0)
  })

  it('another shop\'s listing, a listing not live, or a held aisle: refused BEFORE the facilitator', async () => {
    const { f, calls } = facilitator(OK)
    expect(await book(payload(), f, 'l1', 's2')).toMatchObject({ kind: 'refused', status: 404 })
    h.live = 0
    expect(await book(payload(), f)).toMatchObject({ kind: 'refused', code: 'not_public' })
    h.live = 1
    h.listing = { ...h.listing!, subcategorySlug: 'visa-legal' }
    expect(await book(payload(), f)).toMatchObject({ kind: 'refused', code: 'ads_not_allowed' })
    expect(calls).toEqual([])
  })

  it('a verify the facilitator refuses or cannot answer writes nothing', async () => {
    expect((await book(payload(), facilitator({ verify: { isValid: false, invalidReason: 'insufficient_funds' } }).f))).toEqual({ kind: 'payment_invalid', reason: 'insufficient_funds' })
    expect((await book(payload(), facilitator({ verify: 'throw' }).f)).kind).toBe('unavailable')
    expect(h.ads).toHaveLength(0)
  })

  it('⛔ a refused settlement: the buyer hears "refused", the row stays open for the contract to decide (shows nothing)', async () => {
    const r = await book(payload(), facilitator({ ...OK, settle: { success: false, errorReason: 'insufficient_funds', transaction: '', network: 'eip155:84532' } }).f)
    expect(r).toMatchObject({ kind: 'payment_failed', reason: 'insufficient_funds' })
    expect(h.ads[0]).toMatchObject({ status: 'unknown', failReason: 'insufficient_funds' })
    // Past validBefore: never used → failed; used and paid to us (someone submitted it after all) → active.
    const later = new Date((Number(h.ads[0].authValidBefore) + 601) * 1000)
    expect((await reconcileAd(cfg, { ...h.ads[0] } as never, facilitator(OK).f, later)).status).toBe('failed')
  })

  it('a refused settlement that was paid on chain after all → the ad starts', async () => {
    await book(payload(), facilitator({ ...OK, settle: { success: false, errorReason: 'invalid_exact_evm_payload_signature', transaction: '', network: 'eip155:84532' } }).f)
    h.chain = { found: true, txHash: TX }
    expect((await reconcileAd(cfg, h.ads[0] as never, facilitator(OK).f)).status).toBe('active')
  })

  it('a row handed to the owner (review) answers the buyer plainly, never "pending" forever', async () => {
    await book(payload(), facilitator({ ...OK, settle: 'throw' }).f)
    h.ads[0].status = 'review'
    expect(await book(payload(), facilitator(OK).f)).toMatchObject({ kind: 'refused', status: 409, code: 'payment_under_review' })
  })

  it('⛔ a LOST settlement answer is never shown and never forgotten: unknown → found on chain → active', async () => {
    const r = await book(payload(), facilitator({ ...OK, settle: 'throw' }).f)
    expect(r.kind).toBe('pending')
    expect(h.ads[0].status).toBe('unknown')
    // The buyer repeats the same payment: the chain now shows the transfer.
    h.chain = { found: true, txHash: TX }
    const again = facilitator(OK)
    const r2 = await book(payload(), again.f)
    expect(r2).toMatchObject({ kind: 'booked', replay: true })
    expect(again.calls).toEqual([]) // never settled twice
    expect(h.ads[0]).toMatchObject({ status: 'active', txHash: TX })
  })

  it('a 5xx on settle is "unknown", not a refusal (the transfer may have gone out)', async () => {
    const r = await book(payload(), facilitator({ ...OK, settle: { status: 502, body: {} } }).f)
    expect(r.kind).toBe('pending')
    expect(h.ads[0].status).toBe('unknown')
  })

  it('two different payments for one listing run back to back, never overlapping', async () => {
    await book(payload('f3'), facilitator(OK).f)
    await book(payload('e4'), facilitator({ ...OK, settle: { ...OK.settle, transaction: `0x${'d'.repeat(64)}` } }).f)
    const [a, b] = h.ads
    expect(b.startsAt.getTime()).toBe(a.endsAt.getTime())
    expect(b.endsAt.getTime() - b.startsAt.getTime()).toBe(7 * 86_400_000)
  })

  it('⛔ a request that died between its row and the settlement: the stale pending row is settled again with the stored payload', async () => {
    // The crash: a pending row exists, nothing was settled.
    await book(payload(), facilitator({ ...OK, settle: 'throw' }).f)
    const row = h.ads[0]
    row.status = 'pending'
    row.updatedAt = new Date(Date.now() - 120_000)
    const again = facilitator(OK)
    const r = await reconcileAd(cfg, row as never, again.f)
    expect(again.calls).toEqual(['settle'])
    expect(r).toMatchObject({ status: 'active', txHash: TX })
  })

  it('a re-settle the facilitator refuses is NOT a failure (the first broadcast may still be mining): the row becomes unknown', async () => {
    await book(payload(), facilitator({ ...OK, settle: 'throw' }).f)
    const row = h.ads[0]
    row.status = 'pending'
    row.updatedAt = new Date(Date.now() - 120_000)
    const r = await reconcileAd(cfg, row as never, facilitator({ ...OK, settle: { success: false, errorReason: 'invalid_transaction_state', transaction: '', network: 'eip155:84532' } }).f)
    expect(r.status).toBe('unknown')
  })

  it('past validBefore and never on chain → failed for good (the authorization can no longer move money)', async () => {
    await book(payload(), facilitator({ ...OK, settle: 'throw' }).f)
    const row = h.ads[0]
    const later = new Date((Number(row.authValidBefore) + 601) * 1000)
    const none = facilitator(OK)
    const r = await reconcileAd(cfg, row as never, none.f, later)
    expect(r).toMatchObject({ status: 'failed', failReason: 'authorization_expired_unpaid' })
    expect(none.calls).toEqual([])
  })

  it('a price changed since the payment does not stop its recovery: the same payment still finds its paid ad', async () => {
    await book(payload(), facilitator(OK).f)
    const dearer = x402Config({ X402_PAY_TO: PAY_TO, X402_NETWORK: 'eip155:84532', X402_FACILITATOR_URL: 'https://x402.org/facilitator', X402_AD_PRICE_ATOMIC: '5000000' } as unknown as NodeJS.ProcessEnv)!
    const r = await bookAd({ cfg: dearer, keyId: 'k1', sellerId: 's1', listingId: 'l1', rawPayload: payload(), via: 'http', fetchImpl: facilitator(OK).f })
    expect(r).toMatchObject({ kind: 'booked', replay: true })
  })

  it('⛔ past validBefore but the contract says the authorization WAS used and no transfer was found: stays unknown, never "failed"', async () => {
    await book(payload(), facilitator({ ...OK, settle: 'throw' }).f)
    const row = h.ads[0]
    h.used = true
    const r = await reconcileAd(cfg, row as never, facilitator(OK).f, new Date((Number(row.authValidBefore) + 601) * 1000))
    expect(r).toMatchObject({ status: 'unknown', failReason: 'used_no_transfer_found' })
  })

  it('a read (list_ads → resettle: false) only looks up; it never asks the facilitator to settle', async () => {
    await book(payload(), facilitator({ ...OK, settle: 'throw' }).f)
    h.ads[0].status = 'pending'
    h.ads[0].updatedAt = new Date(Date.now() - 120_000)
    const read = facilitator(OK)
    await reconcileOpenAds(cfg, { sellerId: 's1', resettle: false }, read.f)
    expect(read.calls).toEqual([])
    expect(h.ads[0].status).toBe('pending')
  })

  it('a settle refusal that does not prove nothing was broadcast (unexpected_settle_error) is NOT failed: unknown, the chain decides', async () => {
    const r = await book(payload(), facilitator({ ...OK, settle: { success: false, errorReason: 'unexpected_settle_error', transaction: '', network: 'eip155:84532' } }).f)
    expect(r.kind).toBe('pending')
    expect(h.ads[0]).toMatchObject({ status: 'unknown', failReason: 'unexpected_settle_error' })
  })

  it('a CANCELLED authorization (used in the contract, its cancel event on chain, no transfer) is unpaid for good', async () => {
    await book(payload(), facilitator({ ...OK, settle: 'throw' }).f)
    const row = h.ads[0]
    h.used = true
    h.chain = { found: false, cancelled: true }
    const r = await reconcileAd(cfg, row as never, facilitator(OK).f, new Date((Number(row.authValidBefore) + 601) * 1000))
    expect(r).toMatchObject({ status: 'failed', failReason: 'authorization_cancelled' })
  })

  it('a retry that finds its payment now unpaid for good answers payment_failed, not "still confirming"', async () => {
    await book(payload(), facilitator({ ...OK, settle: 'throw' }).f)
    vi.useFakeTimers({ now: (Number(h.ads[0].authValidBefore) + 601) * 1000, toFake: ['Date'] })
    try {
      const r = await book(payload(), facilitator(OK).f)
      expect(r).toMatchObject({ kind: 'payment_failed', reason: 'authorization_expired_unpaid' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('⛔ an `unknown` row (refused or lost — its buyer was told) is NEVER re-sent to the facilitator, only looked up', async () => {
    await book(payload(), facilitator({ ...OK, settle: { success: false, errorReason: 'insufficient_funds', transaction: '', network: 'eip155:84532' } }).f)
    const row = h.ads[0]
    row.updatedAt = new Date(Date.now() - 120_000)
    const sweep = facilitator(OK)
    await reconcileOpenAds(cfg, {}, sweep.f)
    expect(sweep.calls).toEqual([])
    expect(h.ads[0].status).toBe('unknown')
  })

  it('an ad bought for 1 hour costs the hourly price and runs exactly one hour', async () => {
    const ours = adRequirements(cfg, 1)
    const p = payload()
    p.accepted = ours
    p.payload.authorization.value = ours.amount
    const r = await bookAd({ cfg, keyId: 'k1', sellerId: 's1', listingId: 'l1', rawPayload: p, via: 'mcp', hours: 1, fetchImpl: facilitator({ verify: OK.verify, settle: OK.settle }, 1).f })
    expect(r.kind).toBe('booked')
    expect(h.ads[0]).toMatchObject({ amount: '22381', durationSec: 3600 })
    expect(h.ads[0].endsAt.getTime() - h.ads[0].startsAt.getTime()).toBe(3_600_000)
    // A week's payment offered for an hour-long ad is the wrong amount: refused before anything is called.
    expect((await bookAd({ cfg, keyId: 'k1', sellerId: 's1', listingId: 'l1', rawPayload: payload('e4'), via: 'mcp', hours: 1, fetchImpl: facilitator(OK).f })).kind).toBe('payment_invalid')
  })
})

