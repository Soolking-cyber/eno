import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ A BANK ORDER IS NOT AN AD (src/lib/ads/bank.ts). Every reader of paid ads is run against ONE table holding a running
 * x402 ad, a running bank-paid ad, an order awaiting its transfer and a cancelled order — through a stand-in that honours
 * each reader's own `where` — and only the paid ads come back: serve (the feed's pick and the beacon's state), reconcile
 * (the cron and a shop's own read), shopAds (list_ads / GET /api/v1/ads), the dashboard's figures and one ad's stats.
 * And once paid, a bank row's money is đồng in every figure (currency.ts): never 99000 read as 0.099 USDC.
 */
vi.mock('server-only', () => ({}))
type Row = Record<string, any>
const h = vi.hoisted(() => ({ ads: [] as Row[], reconciled: [] as string[] }))
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Row[]).some((w) => matches(row, w))
    if (k === 'AND') return (v as Row[]).every((w) => matches(row, w))
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return (v.in as unknown[]).includes(row[k])
      return Object.entries(v).every(([op, x]) => {
        if (row[k] == null) return false
        const d = (row[k] instanceof Date ? row[k].getTime() : row[k]) - (x instanceof Date ? x.getTime() : (x as number))
        return op === 'gt' ? d > 0 : op === 'gte' ? d >= 0 : op === 'lt' ? d < 0 : op === 'lte' ? d <= 0 : false
      })
    }
    return row[k] === v
  })
}
vi.mock('@/lib/db', () => ({
  db: {
    listingAd: {
      findMany: async ({ where }: { where: Row }) => h.ads.filter((a) => matches(a, where)),
      findUnique: async ({ where }: { where: Row }) => h.ads.find((a) => a.id === where.id) ?? null,
      updateMany: async ({ where }: { where: Row }) => { h.reconciled.push(`write:${where.id}`); return { count: 0 } },
    },
    adStat: { findMany: async () => [] },
    adCreative: { findMany: async () => [] },
    listing: {
      // The feed's pick ANDs the request's filter with the running ads' listings; the dashboard asks for its titles.
      findMany: async ({ where }: { where: Row }) => ((where.AND ? where.AND[1].id.in : where.id?.in) ?? []).map((id: string) => ({ id, title: `Listing ${id}` })),
      findUnique: async () => ({ views: 0, contactCount: 0 }),
    },
    listingDailyStat: { findFirst: async () => null },
  },
}))
vi.mock('@/lib/serialize', () => ({ LISTING_CARD_SELECT: {}, serializeListingCard: (l: { id: string; title: string }) => ({ id: l.id, title: l.title }) }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (x: unknown[]) => x, cachedTranslations: async () => ({}) }))
vi.mock('@/lib/log', () => ({ logError: () => {}, logWarn: () => {}, logInfo: () => {} }))
vi.mock('@/app/api/listings/feed-query', () => ({ buildFeedFilters: async () => ({ where: {} }) }))
// reconcileAd would ask the chain about a row it picked up: it must pick up none of the bank rows.
vi.mock('@/lib/x402/chain', () => ({
  findAuthorizationPayment: async (_r: unknown, a: { nonce: string }) => { h.reconciled.push(`chain:${a.nonce}`); return { found: false } },
  authorizationUsed: async () => false,
}))

const serve = await import('./serve')
const { reconcileOpenAds, shopAds } = await import('./book')
const { adFigures, shopAdFigures } = await import('./stats')
const { dashboardAds } = await import('./dashboard')
const { x402Config } = await import('@/lib/x402/config')

const NOW = new Date('2026-11-25T08:00:00Z')
const RUN = { startsAt: new Date('2026-11-24T08:00:00Z'), endsAt: new Date('2026-12-01T08:00:00Z') }
const base = { sellerId: 's1', creativeId: null, impressions: 0, clicks: 0, txHash: null, settlementJson: null, failReason: null, durationSec: 604_800, createdAt: new Date('2026-11-24T00:00:00Z'), updatedAt: new Date('2026-11-24T00:00:00Z') }
const cfg = x402Config({ X402_PAY_TO: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C', X402_NETWORK: 'eip155:84532', X402_FACILITATOR_URL: 'https://x402.org/facilitator' } as unknown as NodeJS.ProcessEnv)!

beforeEach(() => {
  serve.__resetAdServeCache()
  vi.stubEnv('ADS_CREATIVE_OPEN', '1')
  h.reconciled = []
  h.ads = [
    { ...base, id: 'x402', listingId: 'l1', via: 'http', status: 'active', ...RUN, amount: '3760000', asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', network: 'eip155:84532', authNonce: '0xabc' },
    { ...base, id: 'paid', listingId: 'l2', via: 'bank', status: 'active', ...RUN, amount: '99000', asset: 'VND', network: 'vietqr', authNonce: 'ENOAD PAID22' },
    { ...base, id: 'waiting', listingId: 'l3', via: 'bank', status: 'awaiting_transfer', startsAt: null, endsAt: null, amount: '99000', asset: 'VND', network: 'vietqr', authNonce: 'ENOAD WAIT22' },
    { ...base, id: 'gone', listingId: 'l4', via: 'bank', status: 'cancelled', failReason: 'cancelled_by_shop', startsAt: null, endsAt: null, amount: '349000', asset: 'VND', network: 'vietqr', authNonce: 'ENOAD GONE22' },
  ]
})
afterEach(() => vi.unstubAllEnvs())

describe('⛔ no reader picks up an order awaiting its transfer, or a cancelled one', () => {
  it('serve: the feed picks among the paid ads only, and the beacon knows nothing of an order', async () => {
    const picked = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const p = await serve.pickAd({}, undefined, NOW)
      if (p.listing?.adId) picked.add(p.listing.adId)
    }
    expect([...picked].sort()).toEqual(['paid', 'x402'])
    expect(await serve.adEventState('paid', NOW)).toBe('running')
    expect(await serve.adEventState('waiting', NOW)).toBe('unknown')
    expect(await serve.adEventState('gone', NOW)).toBe('unknown')
  })

  it('reconcile: the cron sweep and a shop\'s read look at no bank row, and never ask the chain about one', async () => {
    h.ads.push({ ...base, id: 'lost', listingId: 'l5', via: 'http', status: 'unknown', startsAt: null, endsAt: null, amount: '3760000', asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', network: 'eip155:84532', payTo: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C', authFrom: '0x1', authNonce: '0xlost', authValidBefore: String(Math.floor(NOW.getTime() / 1000) + 3600), payloadJson: {} })
    const out = await reconcileOpenAds(cfg, { resettle: false })
    expect(out.checked).toBe(1)
    expect(h.reconciled.filter((x) => !x.endsWith('lost'))).toEqual([])
    expect(h.reconciled).toContain('chain:0xlost')
  })

  it('shopAds (list_ads, GET /api/v1/ads): the paid ads only — each in its own currency', async () => {
    const ads = await shopAds('s1', 50, null)
    expect(ads.map((a) => a.id).sort()).toEqual(['paid', 'x402'])
    expect(ads.find((a) => a.id === 'x402')).toMatchObject({ currency: 'USDC', amount_usdc_atomic: '3760000', amount_vnd: null })
    expect(ads.find((a) => a.id === 'paid')).toMatchObject({ currency: 'VND', amount_usdc_atomic: null, amount_vnd: 99_000, network: 'vietqr' })
  })

  it('stats: one ad\'s figures answer null (404) for an order; the dashboard\'s figures list the paid ads only', async () => {
    expect(await shopAdFigures('waiting', 's1', NOW)).toBeNull()
    expect(await shopAdFigures('gone', 's1', NOW)).toBeNull()
    expect((await shopAdFigures('paid', 's1', NOW))?.ad_id).toBe('paid')
    expect((await dashboardAds('s1', NOW)).map((a) => a.ad_id).sort()).toEqual(['paid', 'x402'])
  })
})

describe('⛔ currency-aware figures', () => {
  it('a bank-paid ad: spend, price, eCPM and eCPC in whole đồng; the USDC fields null', () => {
    // Half of its week elapsed (3.5 days), 1,000 viewable impressions and 10 clicks.
    const ad = { ...h.ads[1]!, impressions: 1000, clicks: 10 }
    const t = adFigures(ad as never, [], new Date('2026-11-27T20:00:00Z')).totals
    expect(t).toMatchObject({ currency: 'VND', spend_vnd: 49_500, paid_vnd: 99_000, ecpm_vnd: 49_500, ecpc_vnd: 4_950, spend_usdc: null, paid_usdc: null, ecpm_usdc: null, ecpc_usdc: null })
  })

  it('an x402 ad: in USDC as before; the đồng fields null', () => {
    const ad = { ...h.ads[0]!, impressions: 1000, clicks: 10 }
    const t = adFigures(ad as never, [], new Date('2026-11-27T20:00:00Z')).totals
    expect(t).toMatchObject({ currency: 'USDC', spend_usdc: '1.88', paid_usdc: '3.76', ecpm_usdc: '1.88', ecpc_usdc: '0.188', spend_vnd: null, paid_vnd: null, ecpm_vnd: null, ecpc_vnd: null })
  })
})
