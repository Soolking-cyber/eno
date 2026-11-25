import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Ads bought by VietQR bank transfer (src/lib/ads/bank.ts, bank-config.ts; owner 2026-11-25). The ListingAd table is an
 * in-memory stand-in honouring the guarded writes and the paymentId unique key. ⛔ No real bank account anywhere: the
 * account here is 0000000000.
 */
vi.mock('server-only', () => ({}))
type Row = Record<string, any>
const h = vi.hoisted(() => ({
  ads: [] as Row[],
  listings: [] as Row[],
  /** Listings the public feed shows (buildFeedFilters' `where`). */
  feed: new Set<string>(),
  creatives: [] as Row[],
  profiles: { p_admin: { email: 'owner@eno.vn' }, p_shop: { email: 'shop@example.com' } } as Record<string, { email: string }>,
  sellers: { s1: { id: 's1', name: 'Saigon Bean', ownerId: 'p_shop', owner: { locale: 'vi' } }, s2: { id: 's2', name: 'Other', ownerId: 'p_other', owner: null } } as Record<string, Row>,
  notifications: [] as Row[],
  pushes: [] as Row[],
  rate: new Map<string, number>(),
  rateFail: false,
  locks: [] as string[],
  deferred: [] as Promise<unknown>[],
  refs: [] as string[],
}))

const cmp = (a: unknown, b: unknown) => (a instanceof Date ? a.getTime() : (a as number)) - (b instanceof Date ? b.getTime() : (b as number))
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Row[]).some((w) => matches(row, w))
    if (k === 'AND') return (v as Row[]).every((w) => matches(row, w))
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return (v.in as unknown[]).includes(row[k])
      return Object.entries(v).every(([op, x]) => {
        if (row[k] == null) return false
        if (op === 'gt') return cmp(row[k], x) > 0
        if (op === 'gte') return cmp(row[k], x) >= 0
        if (op === 'lt') return cmp(row[k], x) < 0
        if (op === 'lte') return cmp(row[k], x) <= 0
        if (op === 'not') return row[k] !== x
        throw new Error(`op ${op}`)
      })
    }
    return row[k] === v
  })
}

vi.mock('@/lib/db', () => {
  const listingAd = {
    findUnique: async ({ where }: { where: Row }) => h.ads.find((a) => matches(a, where)) ?? null,
    findUniqueOrThrow: async ({ where }: { where: Row }) => { const a = h.ads.find((x) => matches(x, where)); if (!a) throw new Error('nf'); return a },
    findFirst: async ({ where }: { where: Row }) => h.ads.filter((a) => matches(a, where)).sort((a, b) => b.endsAt - a.endsAt)[0] ?? null,
    findMany: async ({ where }: { where: Row }) => h.ads.filter((a) => matches(a, where)).sort((a, b) => b.createdAt - a.createdAt),
    create: async ({ data }: { data: Row }) => {
      if (h.ads.some((a) => a.paymentId === data.paymentId)) {
        const { Prisma } = await import('@/generated/prisma/client')
        throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' })
      }
      const row = { id: `ad${h.ads.length + 1}`, updatedAt: new Date(), startsAt: null, endsAt: null, txHash: null, settlementJson: null, failReason: null, impressions: 0, clicks: 0, ...data }
      h.ads.push(row)
      return row
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const rows = h.ads.filter((a) => matches(a, where))
      rows.forEach((r) => Object.assign(r, data, { updatedAt: new Date() }))
      return { count: rows.length }
    },
  }
  const db = {
    listingAd,
    listing: {
      findUnique: async ({ where }: { where: Row }) => h.listings.find((l) => l.id === where.id) ?? null,
      count: async ({ where }: { where: { AND: Row[] } }) => h.listings.filter((l) => h.feed.has(l.id) && matches(l, where.AND[1])).length,
      findMany: async ({ where }: { where: Row }) => (where.AND ? h.listings.filter((l) => h.feed.has(l.id) && matches(l, where.AND[1])) : h.listings.filter((l) => matches(l, where))),
    },
    adCreative: {
      findUnique: async ({ where }: { where: Row }) => h.creatives.find((c) => c.id === where.id) ?? null,
      findMany: async ({ where }: { where: Row }) => h.creatives.filter((c) => matches(c, where)),
    },
    profile: { findUnique: async ({ where }: { where: Row }) => h.profiles[where.id] ?? null },
    seller: {
      findUnique: async ({ where }: { where: Row }) => h.sellers[where.id] ?? null,
      findMany: async ({ where }: { where: Row }) => Object.values(h.sellers).filter((s) => matches(s, where)),
    },
    notification: { create: async ({ data }: { data: Row }) => { h.notifications.push(data); return data } },
    $executeRaw: async (_s: TemplateStringsArray, key: string) => { h.locks.push(key); return 1 },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  }
  return { db }
})
vi.mock('@/app/api/listings/feed-query', () => ({ buildFeedFilters: async () => ({ where: {} }) }))
vi.mock('@/lib/admin', () => ({ isAdminEmail: (e?: string | null) => !!e && (process.env.ADMIN_EMAILS ?? '').split(',').includes(e.toLowerCase()) }))
vi.mock('@/lib/log', () => ({ logError: () => {}, logWarn: () => {}, logInfo: () => {} }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async (name: string, key: string, limit: number) => {
    if (h.rateFail) return { success: false }
    const n = (h.rate.get(`${name}:${key}`) ?? 0) + 1
    h.rate.set(`${name}:${key}`, n)
    return { success: n <= limit }
  },
}))
vi.mock('@/lib/push', () => ({ sendPushToProfile: async (id: string, p: Row) => { h.pushes.push({ id, ...p }); return 1 } }))
vi.mock('@/lib/ads/serve', () => ({ invalidateAdServeCache: () => {} }))
vi.mock('next/server', () => ({ after: (fn: () => Promise<unknown>) => { h.deferred.push(fn()) } }))
vi.mock('@/lib/x402/chain', () => ({ findAuthorizationPayment: async () => ({ found: false }), authorizationUsed: async () => false }))

const bank = await import('./bank')
const { bankConfig, bankQr, newAdReference, AD_REFERENCE_RE, createBankOrder, cancelBankOrder, getBankOrder, markBankOrderPaid, adminCancelBankOrder, adminBankOrders, adEligibleListings, shopBankOrders, BANK_ORDERS_PER_HOUR } = bank
const { crc16ccitt, verifyVietQrPayload, emvRecord, parseEmvTlv } = await import('@/lib/payments/vietqr')
const { BANK_PERIOD } = await import('./bank-periods')

/** A calibrated review's key (review-jev.ts adReviewKey shape, not provisional). */
const REVIEWED = 'jev-1.14.0+gemini-4-hydrogen@2026-11-25:t0.5/0.6/0.5'
const FAKE_ACCOUNT = '0000000000'
const NOW = new Date('2026-11-25T03:00:00Z')
const DAY = 86_400_000
const order = (o: Partial<Parameters<typeof createBankOrder>[0]> = {}) =>
  createBankOrder({ sellerId: 's1', profileId: 'p_shop', kind: 'listing', listingId: 'l1', period: 'week', now: NOW, ...o })
const settle = async () => { await Promise.all(h.deferred); h.deferred = [] }

beforeEach(() => {
  vi.stubEnv('ADS_BANK_ACCOUNT', FAKE_ACCOUNT)
  vi.stubEnv('ADS_BANK_ACCOUNT_NAME', 'CONG TY TNHH ENO')
  vi.stubEnv('ADS_BANK_BIN', '')
  vi.stubEnv('ADS_CREATIVE_OPEN', '')
  vi.stubEnv('ADMIN_EMAILS', 'owner@eno.vn')
  h.ads = []
  h.listings = [
    { id: 'l1', title: 'Honda Vision', sellerId: 's1', status: 'active', verified: true, subcategorySlug: 'motorbikes', category: { slug: 'vehicles' } },
    { id: 'l2', title: 'Visa help', sellerId: 's1', status: 'active', verified: true, subcategorySlug: 'visa-legal', category: { slug: 'services' } },
    { id: 'l3', title: 'Held sofa', sellerId: 's1', status: 'active', verified: true, subcategorySlug: null, category: { slug: 'furniture' } },
    { id: 'l9', title: 'Not mine', sellerId: 's2', status: 'active', verified: true, subcategorySlug: null, category: { slug: 'furniture' } },
  ]
  h.feed = new Set(['l1', 'l2', 'l9'])
  h.creatives = [
    { id: 'cr1', sellerId: 's1', status: 'approved', contentHash: 'a', reviewModel: REVIEWED, reviewedAt: new Date(), headline: 'Fresh coffee' },
    { id: 'cr2', sellerId: 's1', status: 'refused', contentHash: 'b', reviewModel: REVIEWED, reviewedAt: new Date(), headline: 'Best coffee' },
  ]
  h.notifications = []
  h.pushes = []
  h.rate = new Map()
  h.rateFail = false
  h.locks = []
  h.deferred = []
})
afterEach(() => vi.unstubAllEnvs())

describe('the VietQR payload — EMVCo / NAPAS 247, built locally', () => {
  /**
   * ⛔ THE EXPECTED STRING WAS BUILT OUTSIDE THIS CODEBASE: the TLV by hand and the checksum by Python's binascii.crc_hqx
   * (CRC-CCITT, poly 0x1021) seeded with 0xFFFF — a second implementation, so this cannot pass by agreeing with itself.
   * Same structure as the real bank-accepted code vietqr.test.ts pins (00 01 · 01 12 · 38 {A000000727, BIN + account,
   * QRIBFTTA} · 53 704 · 54 amount · 58 VN · 62 {08 memo} · 63 CRC). The account is the fake 0000000000.
   */
  const KNOWN = '00020101021238540010A00000072701240006970416011000000000000208QRIBFTTA53037045405990005802VN62160812ENOAD 7K3F9Q6304603B'

  it('⛔ ACB, the week\'s price and the reference: byte for byte the independently built code, its CRC included', () => {
    const cfg = bankConfig()!
    expect(cfg).toEqual({ bin: '970416', bankName: 'ACB', account: FAKE_ACCOUNT, accountName: 'CONG TY TNHH ENO' })
    const qr = bankQr(cfg, BANK_PERIOD.week.priceVnd, 'ENOAD 7K3F9Q')!
    expect(qr.payload).toBe(KNOWN)
    expect(verifyVietQrPayload(qr.payload)).toBe(true)
    // The checksum routine itself, on the CRC-16/CCITT-FALSE catalogue's check value.
    expect(crc16ccitt('123456789')).toBe('29B1')
  })

  it('the fields a banking app reads: NAPAS GUID, the BIN, the account, QRIBFTTA, đồng, the amount, the reference', () => {
    const qr = bankQr(bankConfig()!, 349_000, 'ENOAD ABCDEF')!
    const top = emvRecord(qr.payload)
    const merchant = emvRecord(top['38'])
    expect(merchant['00']).toBe('A000000727')
    expect(emvRecord(merchant['01'])).toEqual({ '00': '970416', '01': FAKE_ACCOUNT })
    expect(merchant['02']).toBe('QRIBFTTA')
    expect(top['53']).toBe('704')
    expect(top['54']).toBe('349000')
    expect(emvRecord(top['62'])['08']).toBe('ENOAD ABCDEF')
    expect(parseEmvTlv(qr.payload).at(-1)![0]).toBe('63')
    // Drawn as an inline SVG by the site's own renderer (qr-svg.ts), no image service.
    expect(qr.svg).toMatch(/^<svg [^>]*aria-hidden="true"/)
    expect(qr.svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/)
  })

  it('⛔ no account, no name, a bad account or an unknown bank → not on sale (null)', () => {
    expect(bankConfig({} as NodeJS.ProcessEnv)).toBeNull()
    expect(bankConfig({ ADS_BANK_ACCOUNT: FAKE_ACCOUNT } as unknown as NodeJS.ProcessEnv)).toBeNull()
    expect(bankConfig({ ADS_BANK_ACCOUNT: '12ab', ADS_BANK_ACCOUNT_NAME: 'ENO' } as unknown as NodeJS.ProcessEnv)).toBeNull()
    expect(bankConfig({ ADS_BANK_ACCOUNT: FAKE_ACCOUNT, ADS_BANK_ACCOUNT_NAME: 'ENO', ADS_BANK_BIN: '123456' } as unknown as NodeJS.ProcessEnv)).toBeNull()
    expect(bankConfig({ ADS_BANK_ACCOUNT: FAKE_ACCOUNT, ADS_BANK_ACCOUNT_NAME: 'ENO', ADS_BANK_BIN: '970436' } as unknown as NodeJS.ProcessEnv)?.bankName).toBe('Vietcombank')
  })
})

describe('the reference', () => {
  it('"ENOAD " + 6 of uppercase base32 without O/0/I/1: ASCII, ≤ 25 characters, unchanged by the memo cleaner', () => {
    const refs = Array.from({ length: 2000 }, () => newAdReference())
    for (const r of refs) {
      expect(r).toMatch(AD_REFERENCE_RE)
      expect(r.length).toBeLessThanOrEqual(25)
      expect(r.slice(6)).not.toMatch(/[O0I1]/)
      expect(r).toMatch(/^[ -~]+$/)
    }
    // 2,000 draws from 32^6 (about a billion): a repeat here would mean the draw is not random.
    expect(new Set(refs).size).toBe(refs.length)
    expect(new Set(refs.flatMap((r) => [...r.slice(6)])).size).toBe(32)
  })

  it('⛔ unique: a reference already used draws another (paymentId is unique)', async () => {
    h.ads.push({ id: 'old', paymentId: 'bank:ENOAD AAAAAA', status: 'cancelled', createdAt: new Date(0) })
    // References come from crypto.randomBytes: the first draw is forced onto the used one.
    const crypto = await import('crypto')
    const real = crypto.randomBytes
    let n = 0
    const rb = vi.spyOn(crypto.default, 'randomBytes').mockImplementation(((size: number) => (n++ === 0 ? Buffer.alloc(size, 0) : real(size))) as typeof crypto.randomBytes)
    const out = await order()
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.order.reference).not.toBe('ENOAD AAAAAA')
    expect(n).toBe(2)
    rb.mockRestore()
  })
})

describe('createBankOrder', () => {
  it('a listing ad: a ListingAd row awaiting its transfer, the bank in payTo (never the account), the QR and the details', async () => {
    const out = await order({ period: 'month' })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const row = h.ads[0]!
    expect(row).toMatchObject({
      listingId: 'l1', creativeId: null, sellerId: 's1', via: 'bank', status: 'awaiting_transfer', asset: 'VND', network: 'vietqr',
      amount: '349000', payTo: 'ACB', paymentId: `bank:${out.order.reference}`, authNonce: out.order.reference, authFrom: 's1',
      authValidBefore: new Date(NOW.getTime() + 7 * DAY).toISOString(), signature: '', durationSec: 30 * 86_400, bookedByKeyId: 'dashboard:p_shop',
      payloadJson: { period: 'month', priceVnd: 349_000, createdBy: 'p_shop' },
    })
    expect(JSON.stringify(row)).not.toContain(FAKE_ACCOUNT)
    expect(out.order).toMatchObject({ status: 'awaiting_transfer', kind: 'listing', period: 'month', amount_vnd: 349_000, expires_at: row.authValidBefore })
    expect(out.order.pay).toMatchObject({ bank: 'ACB', account_name: 'CONG TY TNHH ENO', account_number: FAKE_ACCOUNT })
    expect(out.order.pay!.qr_svg).toMatch(/^<svg/)
  })

  it('the three periods run a week, 30 days and 90 days at their prices', async () => {
    for (const [period, sec, price] of [['week', 604_800, '99000'], ['month', 2_592_000, '349000'], ['quarter', 7_776_000, '899000']] as const) {
      const out = await order({ period })
      expect(out.ok).toBe(true)
      expect(h.ads.at(-1)).toMatchObject({ durationSec: sec, amount: price })
    }
  })

  it('⛔ bank details unset → no order at all', async () => {
    vi.stubEnv('ADS_BANK_ACCOUNT', '')
    expect(await order()).toEqual({ ok: false, status: 503, code: 'bank_unavailable' })
    expect(h.ads).toHaveLength(0)
  })

  it('kinds: an unknown kind, a missing target or an unknown period is refused', async () => {
    expect(await order({ kind: 'banner' })).toMatchObject({ ok: false, code: 'bad_request' })
    expect(await order({ listingId: undefined })).toMatchObject({ ok: false, code: 'bad_request' })
    expect(await order({ period: 'year' })).toMatchObject({ ok: false, code: 'bad_request' })
    expect(await order({ sellerId: null })).toMatchObject({ ok: false, code: 'no_shop' })
    expect(h.ads).toHaveLength(0)
  })

  it('⛔ ownership: another shop\'s listing or creative is not found — no order', async () => {
    expect(await order({ listingId: 'l9' })).toMatchObject({ ok: false, code: 'target_refused', reason: 'not_found', status: 404 })
    vi.stubEnv('ADS_CREATIVE_OPEN', '1')
    expect(await order({ kind: 'creative', creativeId: 'cr1', sellerId: 's2' })).toMatchObject({ ok: false, code: 'target_refused', reason: 'not_found' })
    expect(h.ads).toHaveLength(0)
  })

  it('⛔ eligibility (book.ts checkAdListing): an excluded aisle, or a listing not in the public feed, is refused', async () => {
    expect(await order({ listingId: 'l2' })).toMatchObject({ ok: false, code: 'target_refused', reason: 'ads_not_allowed' })
    expect(await order({ listingId: 'l3' })).toMatchObject({ ok: false, code: 'target_refused', reason: 'not_public' })
    expect(h.ads).toHaveLength(0)
  })

  it('⛔ the private test (creative-gate.ts): "My own ad" is an admin\'s only while ADS_CREATIVE_OPEN is unset', async () => {
    expect(await order({ kind: 'creative', creativeId: 'cr1' })).toEqual({ ok: false, status: 403, code: 'creative_ads_not_open' })
    expect(h.ads).toHaveLength(0)
    const admin = await order({ kind: 'creative', creativeId: 'cr1', profileId: 'p_admin' })
    expect(admin.ok).toBe(true)
    expect(h.ads[0]).toMatchObject({ creativeId: 'cr1', listingId: null })
    vi.stubEnv('ADS_CREATIVE_OPEN', '1')
    expect((await order({ kind: 'creative', creativeId: 'cr1' })).ok).toBe(true)
  })

  it('⛔ an unapproved creative, a removed one, or one whose review does not count here is refused', async () => {
    vi.stubEnv('ADS_CREATIVE_OPEN', '1')
    expect(await order({ kind: 'creative', creativeId: 'cr2' })).toMatchObject({ ok: false, code: 'target_refused', reason: 'creative_refused' })
    h.creatives.push({ id: 'cr3', sellerId: 's1', status: 'removed', reviewModel: REVIEWED, reviewedAt: new Date() })
    expect(await order({ kind: 'creative', creativeId: 'cr3' })).toMatchObject({ ok: false, code: 'target_refused', reason: 'creative_removed' })
    h.creatives.push({ id: 'cr4', sellerId: 's1', status: 'approved', reviewModel: 'jev-1.14.0+g@provisional:t', reviewedAt: new Date() })
    expect(await order({ kind: 'creative', creativeId: 'cr4' })).toMatchObject({ ok: false, code: 'target_refused', reason: 'creative_review_stale' })
    h.creatives.push({ id: 'cr5', sellerId: 's1', status: 'approved', reviewModel: REVIEWED, reviewedAt: new Date(Date.now() - 8 * DAY) })
    expect(await order({ kind: 'creative', creativeId: 'cr5' })).toMatchObject({ ok: false, code: 'target_refused', reason: 'creative_review_stale' })
    expect(h.ads).toHaveLength(0)
  })

  it('⛔ the rate limit: 10 orders an hour a shop, failing closed', async () => {
    for (let i = 0; i < BANK_ORDERS_PER_HOUR; i++) expect((await order()).ok).toBe(true)
    expect(await order()).toEqual({ ok: false, status: 429, code: 'rate_limited' })
    expect(h.ads).toHaveLength(BANK_ORDERS_PER_HOUR)
    h.rate = new Map()
    h.rateFail = true
    expect(await order()).toMatchObject({ ok: false, code: 'rate_limited' })
  })
})

describe('expiry — lazy', () => {
  it('⛔ after 7 days an unpaid order reads as expired (no QR, off the shop\'s list); the next write stores cancelled/expired', async () => {
    const out = await order()
    if (!out.ok) throw new Error('no order')
    const id = out.order.id
    const later = new Date(NOW.getTime() + 7 * DAY + 1)
    expect(await getBankOrder(id, 's1', new Date(NOW.getTime() + 6 * DAY))).toMatchObject({ status: 'awaiting_transfer' })
    const read = await getBankOrder(id, 's1', later)
    expect(read).toMatchObject({ status: 'expired', pay: null })
    expect(h.ads[0]!.status).toBe('awaiting_transfer') // a read writes nothing
    expect(await shopBankOrders('s1', later)).toEqual([])
    // The next write: the shop's next order closes it.
    expect((await order({ now: later })).ok).toBe(true)
    expect(h.ads[0]).toMatchObject({ status: 'cancelled', failReason: 'expired' })
    expect(h.ads[1]).toMatchObject({ status: 'awaiting_transfer' })
  })

  it('the shop\'s Cancel, even of a lapsed order: cancelled by the shop, no QR, off its list', async () => {
    const out = await order()
    if (!out.ok) throw new Error('no order')
    const later = new Date(NOW.getTime() + 8 * DAY)
    expect(await cancelBankOrder(out.order.id, 's1', later)).toMatchObject({ ok: true, order: { status: 'cancelled', pay: null } })
    expect(h.ads[0]).toMatchObject({ status: 'cancelled', failReason: 'cancelled_by_shop' })
    expect(await shopBankOrders('s1', NOW)).toEqual([])
  })
})

describe('cancelBankOrder — the owner, while awaiting only', () => {
  it('the owner cancels: cancelled by the shop, and the QR is gone', async () => {
    const out = await order()
    if (!out.ok) throw new Error('no order')
    const c = await cancelBankOrder(out.order.id, 's1', NOW)
    expect(c).toMatchObject({ ok: true, order: { status: 'cancelled', pay: null } })
    expect(h.ads[0]).toMatchObject({ status: 'cancelled', failReason: 'cancelled_by_shop' })
  })

  it('⛔ another shop: not found, nothing changed', async () => {
    const out = await order()
    if (!out.ok) throw new Error('no order')
    expect(await cancelBankOrder(out.order.id, 's2', NOW)).toEqual({ ok: false, status: 404, code: 'not_found' })
    expect(h.ads[0]!.status).toBe('awaiting_transfer')
  })

  it('⛔ not awaiting (paid, already cancelled): order_closed', async () => {
    const out = await order()
    if (!out.ok) throw new Error('no order')
    await markBankOrderPaid(out.order.id, 'owner@eno.vn', NOW)
    expect(await cancelBankOrder(out.order.id, 's1', NOW)).toEqual({ ok: false, status: 409, code: 'order_closed' })
    expect(h.ads[0]!.status).toBe('active')
    const two = await order()
    if (!two.ok) throw new Error('no order')
    await cancelBankOrder(two.order.id, 's1', NOW)
    expect(await cancelBankOrder(two.order.id, 's1', NOW)).toMatchObject({ ok: false, code: 'order_closed' })
  })

  it('an x402 ad is no bank order: not found', async () => {
    h.ads.push({ id: 'x1', sellerId: 's1', via: 'http', status: 'pending', createdAt: NOW })
    expect(await cancelBankOrder('x1', 's1', NOW)).toMatchObject({ ok: false, code: 'not_found' })
    expect(await getBankOrder('x1', 's1', NOW)).toBeNull()
  })
})

describe('markBankOrderPaid — the admin confirms the transfer', () => {
  it('⛔ activates now, for the period, recording who confirmed and when', async () => {
    const out = await order({ period: 'quarter' })
    if (!out.ok) throw new Error('no order')
    const r = await markBankOrderPaid(out.order.id, 'owner@eno.vn', NOW)
    expect(r).toEqual({ ok: true, already: false, status: 'active', startsAt: NOW.toISOString(), endsAt: new Date(NOW.getTime() + 90 * DAY).toISOString() })
    expect(h.ads[0]).toMatchObject({ status: 'active', failReason: null, payloadJson: { period: 'quarter', priceVnd: 899_000, createdBy: 'p_shop', confirmedBy: 'owner@eno.vn', confirmedAt: NOW.toISOString() } })
    // The x402 path's own lock (book.ts adLockKey).
    expect(h.locks).toEqual(['listing-ad:l1'])
  })

  it('⛔ stacks behind the target\'s running ad (the same per-target stacking as x402)', async () => {
    const runningEnd = new Date(NOW.getTime() + 3 * DAY)
    h.ads.push({ id: 'run', listingId: 'l1', creativeId: null, sellerId: 's1', via: 'http', status: 'active', startsAt: new Date(NOW.getTime() - DAY), endsAt: runningEnd, createdAt: new Date(NOW.getTime() - DAY), asset: 'x', amount: '1' })
    const out = await order()
    if (!out.ok) throw new Error('no order')
    const r = await markBankOrderPaid(out.order.id, 'owner@eno.vn', NOW)
    expect(r).toMatchObject({ ok: true, startsAt: runningEnd.toISOString(), endsAt: new Date(runningEnd.getTime() + 7 * DAY).toISOString() })
  })

  it('⛔ idempotent: a second Mark paid changes nothing and sends no second bell', async () => {
    const out = await order()
    if (!out.ok) throw new Error('no order')
    await markBankOrderPaid(out.order.id, 'owner@eno.vn', NOW)
    await settle()
    const before = JSON.stringify(h.ads[0])
    const again = await markBankOrderPaid(out.order.id, 'other@eno.vn', new Date(NOW.getTime() + DAY))
    await settle()
    expect(again).toMatchObject({ ok: true, already: true, status: 'active' })
    expect(JSON.stringify(h.ads[0])).toBe(before)
    expect(h.notifications).toHaveLength(1)
  })

  it('⛔ sends the advertiser the bilingual "Your ad is live" bell, in their language', async () => {
    const out = await order()
    if (!out.ok) throw new Error('no order')
    await markBankOrderPaid(out.order.id, 'owner@eno.vn', NOW)
    await settle()
    expect(h.notifications).toEqual([{ recipientId: 'p_shop', type: 'system', title: 'Quảng cáo của bạn đã chạy', body: expect.stringContaining('Chúng tôi đã nhận chuyển khoản'), actorName: expect.any(String), url: '/dashboard/ads' }])
    expect(h.pushes[0]).toMatchObject({ id: 'p_shop', title: 'Quảng cáo của bạn đã chạy', url: '/dashboard/ads' })
    h.sellers.s1!.owner = { locale: 'en' }
    const two = await order()
    if (!two.ok) throw new Error('no order')
    await markBankOrderPaid(two.order.id, 'owner@eno.vn', NOW)
    await settle()
    // Stacked behind the first: paid, and says it starts when the current one ends.
    expect(h.notifications[1]).toMatchObject({ title: 'Your ad is live', body: 'We received your transfer. It starts when your current ad ends.' })
    h.sellers.s1!.owner = { locale: 'vi' }
  })

  it('a late transfer on an expired order is still honoured (lapsed, or closed by the sweep); one eno closed is not', async () => {
    const out = await order()
    const lapsedOnly = await order({ now: new Date(NOW.getTime() + 1000) })
    if (!out.ok || !lapsedOnly.ok) throw new Error('no order')
    const later = new Date(NOW.getTime() + 9 * DAY)
    expect(await markBankOrderPaid(lapsedOnly.order.id, 'owner@eno.vn', later)).toMatchObject({ ok: true, already: false, status: 'active' })
    // The shop's next order sweeps the other lapsed one: cancelled with failReason 'expired', still payable.
    expect((await order({ now: later })).ok).toBe(true)
    expect(h.ads[0]).toMatchObject({ status: 'cancelled', failReason: 'expired' })
    expect((await markBankOrderPaid(out.order.id, 'owner@eno.vn', later))).toMatchObject({ ok: true, already: false, status: 'active' })
    h.ads.splice(0, h.ads.length)
    const two = await order()
    if (!two.ok) throw new Error('no order')
    await adminCancelBankOrder(two.order.id, 'owner@eno.vn')
    expect(await markBankOrderPaid(two.order.id, 'owner@eno.vn', NOW)).toEqual({ ok: false, status: 409, code: 'order_closed' })
    expect(h.ads[0]!.status).toBe('cancelled')
  })

  it('⛔ paid, then the shop pressed Cancel: the transfer is not lost — the admin can still Mark paid it', async () => {
    const out = await order()
    if (!out.ok) throw new Error('no order')
    await cancelBankOrder(out.order.id, 's1', NOW)
    expect((await adminBankOrders(NOW)).map((o) => [o.reference, o.status])).toEqual([[out.order.reference, 'cancelled']])
    expect(await markBankOrderPaid(out.order.id, 'owner@eno.vn', NOW)).toMatchObject({ ok: true, already: false, status: 'active' })
    await settle()
    expect(h.notifications).toHaveLength(1)
  })

  it('⛔ a listing no longer live when the money lands: never active — review, for a refund by hand, and no "live" bell', async () => {
    const out = await order()
    if (!out.ok) throw new Error('no order')
    h.feed.delete('l1') // sold or hidden since the order
    expect(await markBankOrderPaid(out.order.id, 'owner@eno.vn', NOW)).toMatchObject({ ok: true, already: false, status: 'review' })
    await settle()
    expect(h.ads[0]).toMatchObject({ status: 'review', failReason: 'listing_not_live_after_payment', startsAt: null, payloadJson: { confirmedBy: 'owner@eno.vn' } })
    expect(h.notifications).toHaveLength(0)
    // A second press changes nothing.
    expect(await markBankOrderPaid(out.order.id, 'owner@eno.vn', NOW)).toMatchObject({ ok: true, already: true, status: 'review' })
  })

  it('a creative eno removed after the order: never runs — review, for a refund by hand, and no "live" bell', async () => {
    const out = await order({ kind: 'creative', creativeId: 'cr1', profileId: 'p_admin' })
    if (!out.ok) throw new Error('no order')
    h.creatives[0]!.status = 'removed'
    expect(await markBankOrderPaid(out.order.id, 'owner@eno.vn', NOW)).toMatchObject({ ok: true, status: 'review' })
    await settle()
    expect(h.ads[0]).toMatchObject({ status: 'review', failReason: 'creative_removed_after_payment' })
    expect(h.notifications).toHaveLength(0)
  })

  it('not a bank order, or no such row: not found', async () => {
    h.ads.push({ id: 'x1', sellerId: 's1', via: 'http', status: 'pending', createdAt: NOW })
    expect(await markBankOrderPaid('x1', 'owner@eno.vn', NOW)).toMatchObject({ ok: false, code: 'not_found' })
    expect(await markBankOrderPaid('nope', 'owner@eno.vn', NOW)).toMatchObject({ ok: false, code: 'not_found' })
  })
})

describe('adminCancelBankOrder', () => {
  it('closes an awaiting or shop-cancelled order for good; a second cancel is a no-op; a paid one is refused', async () => {
    const out = await order()
    if (!out.ok) throw new Error('no order')
    expect(await adminCancelBankOrder(out.order.id, 'owner@eno.vn')).toEqual({ ok: true, already: false })
    expect(h.ads[0]).toMatchObject({ status: 'cancelled', failReason: 'cancelled_by_eno' })
    expect(await adminCancelBankOrder(out.order.id, 'owner@eno.vn')).toEqual({ ok: true, already: true })
    expect(await markBankOrderPaid(out.order.id, 'owner@eno.vn', NOW)).toMatchObject({ ok: false, code: 'order_closed' })
    const two = await order()
    if (!two.ok) throw new Error('no order')
    await markBankOrderPaid(two.order.id, 'owner@eno.vn', NOW)
    expect(await adminCancelBankOrder(two.order.id, 'owner@eno.vn')).toEqual({ ok: false, status: 409, code: 'order_closed' })
    const three = await order()
    if (!three.ok) throw new Error('no order')
    await cancelBankOrder(three.order.id, 's1', NOW)
    expect(await adminCancelBankOrder(three.order.id, 'owner@eno.vn')).toEqual({ ok: true, already: false })
    // Who closed it, and that the shop had cancelled it first, stay on the row.
    expect(h.ads[2]).toMatchObject({ status: 'cancelled', failReason: 'cancelled_by_eno', payloadJson: { period: 'week', cancelledBy: 'owner@eno.vn', before: 'cancelled_by_shop' } })
    expect(await adminBankOrders(NOW)).toEqual([])
  })
})

describe('the lists', () => {
  it('the form\'s picker: the shop\'s own listings in the public feed, never an excluded aisle', async () => {
    expect(await adEligibleListings('s1')).toEqual([{ id: 'l1', title: 'Honda Vision' }])
  })

  it('the shop\'s awaiting orders, with what each advertises (no QR in the list)', async () => {
    await order()
    const list = await shopBankOrders('s1', NOW)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ status: 'awaiting_transfer', target: 'Honda Vision', amount_vnd: 99_000, period: 'week' })
    expect(list[0]).not.toHaveProperty('pay')
    expect(await shopBankOrders('s2', NOW)).toEqual([])
  })

  it('the admin\'s: awaiting, recently expired and shop-cancelled orders, with reference, kind, target, shop, period, amount and time', async () => {
    await order()
    const two = await order({ kind: 'creative', creativeId: 'cr1', profileId: 'p_admin', period: 'month', now: new Date(NOW.getTime() + 1000) })
    const gone = await order({ now: new Date(NOW.getTime() + 2000) })
    const closed = await order({ now: new Date(NOW.getTime() + 3000) })
    if (!two.ok || !gone.ok || !closed.ok) throw new Error('no order')
    await cancelBankOrder(gone.order.id, 's1', NOW)
    await adminCancelBankOrder(closed.order.id, 'owner@eno.vn')
    const list = await adminBankOrders(NOW)
    // The orders still awaiting first (read on their own: cancelled ones can never push them off), newest first.
    expect(list.map((o) => [o.kind, o.target, o.shop, o.period, o.amountVnd, o.status])).toEqual([
      ['creative', 'Fresh coffee', 'Saigon Bean', 'month', 349_000, 'awaiting_transfer'],
      ['listing', 'Honda Vision', 'Saigon Bean', 'week', 99_000, 'awaiting_transfer'],
      ['listing', 'Honda Vision', 'Saigon Bean', 'week', 99_000, 'cancelled'],
    ])
    expect(list[0]!.reference).toMatch(AD_REFERENCE_RE)
    expect((await adminBankOrders(new Date(NOW.getTime() + 8 * DAY))).map((o) => o.status)).toEqual(['expired', 'expired', 'cancelled'])
    // 30 days past their week, they leave the list.
    expect(await adminBankOrders(new Date(NOW.getTime() + 36 * DAY))).toHaveLength(3)
    expect(await adminBankOrders(new Date(NOW.getTime() + 38 * DAY))).toEqual([])
  })
})
