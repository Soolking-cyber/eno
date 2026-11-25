import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * eno takes an ad down (src/lib/ads/admin.ts, owner 2026-11-25): the creative removed for good, its runs ended NOW (the
 * unused part returned for the manual pro-rata refund), the audit row in the same transaction, the serving set read again,
 * eno's copy of the picture deleted.
 */
vi.mock('server-only', () => ({}))
type Row = Record<string, any>
const h = vi.hoisted(() => ({ creative: null as Row | null, runs: [] as Row[], audits: [] as Row[], raw: [] as unknown[][], invalidated: 0, removedImages: [] as string[] }))
vi.mock('@/lib/db', () => {
  const tx = {
    adCreative: {
      findUnique: async () => (h.creative ? { ...h.creative } : null),
      updateMany: async ({ data }: { data: Row }) => {
        if (!h.creative || h.creative.status === 'removed') return { count: 0 }
        Object.assign(h.creative, data)
        return { count: 1 }
      },
    },
    listingAd: {
      findMany: async () => h.runs.filter((r) => (r.status === 'active' && r.endsAt > NOW_HOISTED.now) || ['pending', 'unknown', 'review'].includes(r.status)),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        // A bank order of the creative still awaiting its transfer (bank.ts) is closed with it.
        if (where.status === 'awaiting_transfer') {
          const waiting = h.runs.filter((r) => r.creativeId === where.creativeId && r.status === 'awaiting_transfer')
          waiting.forEach((r) => Object.assign(r, data))
          return { count: waiting.length }
        }
        const rows = h.runs.filter((r) => r.creativeId === where.creativeId && r.status === 'active' && r.startsAt <= where.startsAt.lte && r.endsAt > where.endsAt.gt)
        rows.forEach((r) => Object.assign(r, data))
        return { count: rows.length }
      },
    },
    $executeRaw: async (_s: TemplateStringsArray, ...values: unknown[]) => {
      h.raw.push(values)
      if (typeof values[0] === 'string' && values[0].startsWith('creative-ad:')) return 1 // the activation lock
      const [creativeId, now] = values as [string, Date]
      for (const r of h.runs) if (r.creativeId === creativeId && r.status === 'active' && r.startsAt > now) r.endsAt = r.startsAt
      return 1
    },
  }
  return { db: { $transaction: async (fn: (t: unknown) => unknown) => fn(tx) } }
})
const NOW_HOISTED = vi.hoisted(() => ({ now: new Date('2026-11-25T12:00:00Z') }))
vi.mock('@/lib/compliance/audit', () => ({ appendAudit: async (_tx: unknown, row: Row) => { h.audits.push(row) } }))
vi.mock('./serve', () => ({ invalidateAdServeCache: () => { h.invalidated++ } }))
vi.mock('./creative-review', () => ({ removeAdImage: async (url: string) => { h.removedImages.push(url); return true } }))
vi.mock('@/lib/log', () => ({ logError: () => {}, logWarn: () => {} }))
vi.mock('./book', () => ({ adLockKey: (t: { creativeId: string }) => `creative-ad:${t.creativeId}` }))

const { removeAdCreative } = await import('./admin')
const NOW = NOW_HOISTED.now

beforeEach(() => {
  h.creative = { id: 'cr1', sellerId: 's1', status: 'approved', imageUrl: 'https://sb.example/storage/v1/object/public/listings/ads/1.webp' }
  h.runs = [
    // Under way: half of a day's run used.
    { id: 'ad1', creativeId: 'cr1', status: 'active', amount: '537143', startsAt: new Date('2026-11-25T00:00:00Z'), endsAt: new Date('2026-11-26T00:00:00Z') },
    // Stacked after it: never started.
    { id: 'ad2', creativeId: 'cr1', status: 'active', amount: '537143', startsAt: new Date('2026-11-26T00:00:00Z'), endsAt: new Date('2026-11-27T00:00:00Z') },
    // A payment still being confirmed.
    { id: 'ad3', creativeId: 'cr1', status: 'unknown', amount: '22381', startsAt: null, endsAt: null },
  ]
  h.audits = []; h.raw = []; h.invalidated = 0; h.removedImages = []
})

describe('removeAdCreative', () => {
  it('removes the creative for good, ends every run now, records it, re-reads the serving set and deletes the picture', async () => {
    const r = await removeAdCreative('cr1', 'admin@eno.vn', 'Unlicensed medicine on the landing page', NOW)
    expect(h.creative).toMatchObject({ status: 'removed', removedReason: 'Unlicensed medicine on the landing page', imageUrl: '', removedAt: NOW })
    expect(h.runs[0]!.endsAt).toEqual(NOW)
    expect(h.runs[1]!.endsAt).toEqual(h.runs[1]!.startsAt)
    expect(h.audits).toEqual([expect.objectContaining({ actorType: 'admin', actorId: 'admin@eno.vn', action: 'ad.creative.removed', subjectType: 'seller', subjectId: 's1' })])
    expect(h.invalidated).toBe(1)
    // The same advisory lock activation takes, first.
    expect(h.raw[0]).toEqual(['creative-ad:cr1'])
    expect(h.removedImages).toEqual(['https://sb.example/storage/v1/object/public/listings/ads/1.webp'])
    // The unused part of each run, for the manual pro-rata refund: half of the first, all of the second.
    // A payment still being confirmed is listed too: if it settles, it never runs and is refunded whole.
    expect(r).toEqual({ alreadyRemoved: false, refunds: [
      { adId: 'ad1', paid_usdc: '0.537143', unused_usdc: '0.268572', settled: true },
      { adId: 'ad2', paid_usdc: '0.537143', unused_usdc: '0.537143', settled: true },
      { adId: 'ad3', paid_usdc: '0.022381', unused_usdc: '0.022381', settled: false },
    ] })
    expect(h.audits[0]!.detail.refunds).toEqual(r!.refunds)
  })

  it('⛔ a run paid by bank transfer is refunded in đồng, never read as USDC; an order still awaiting its transfer is closed', async () => {
    h.runs = [
      // A month bought by bank transfer (bank.ts), a quarter of it used.
      { id: 'ad4', creativeId: 'cr1', status: 'active', amount: '349000', asset: 'VND', startsAt: new Date('2026-11-18T00:00:00Z'), endsAt: new Date('2026-12-18T00:00:00Z') },
      { id: 'ad5', creativeId: 'cr1', status: 'awaiting_transfer', amount: '99000', asset: 'VND', startsAt: null, endsAt: null },
    ]
    const r = await removeAdCreative('cr1', 'admin@eno.vn', 'Unlicensed medicine', NOW)
    expect(r!.refunds).toEqual([{ adId: 'ad4', paid_vnd: 349_000, unused_vnd: 261_750, settled: true }])
    expect(h.runs[1]).toMatchObject({ status: 'cancelled', failReason: 'creative_removed' })
  })

  it('two admins at once: one removes, the other is told it already was (one audit row, one refund list)', async () => {
    const [a, b] = await Promise.all([removeAdCreative('cr1', 'a@eno.vn', 'r', NOW), removeAdCreative('cr1', 'b@eno.vn', 'r', NOW)])
    expect([a!.alreadyRemoved, b!.alreadyRemoved].sort()).toEqual([false, true])
    expect(h.audits).toHaveLength(1)
  })

  it('an unknown creative → null; one already removed → nothing changes again', async () => {
    h.creative = null
    expect(await removeAdCreative('nope', 'a', 'r', NOW)).toBeNull()
    h.creative = { id: 'cr1', sellerId: 's1', status: 'removed', imageUrl: '' }
    expect(await removeAdCreative('cr1', 'a', 'r', NOW)).toEqual({ alreadyRemoved: true, refunds: [] })
    expect(h.audits).toEqual([])
    expect(h.removedImages).toEqual([])
  })
})
