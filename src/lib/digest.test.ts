import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The weekly digest had two defects that both showed up in the SAME email:
 *  1. It sent the same six listings every week — `top` ordered by rankScore across every active
 *     listing with no recency bound, and rankScore barely moves.
 *  2. It rendered a red "−25%" pill for drops the site had already retired, because it checked
 *     `previousPrice > price` with no badge window, and previousPrice is only ever cleared on a
 *     price RAISE.
 * Both are outbound-email defects: nobody sees them in the app, so only a test holds them.
 */

const h = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], calls: [] as Record<string, unknown>[] }))

vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: object) => ({ ...w }) }))
vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findMany: (args: Record<string, unknown>) => {
        h.calls.push(args)
        const where = args.where as Record<string, unknown>
        const gte = (where?.createdAt as { gte?: Date } | undefined)?.gte
        // Only the `top` query filters on createdAt; the sales query is matched by its OR clause.
        if (!gte) return Promise.resolve(h.rows.filter((r) => (r as { isSale?: boolean }).isSale))
        return Promise.resolve(
          h.rows
            .filter((r) => !(r as { isSale?: boolean }).isSale && (r.createdAt as Date) >= gte)
            .sort((a, b) => (b.rankScore as number) - (a.rankScore as number))
            .slice(0, args.take as number),
        )
      },
    },
  },
}))

import { getDigestContent } from './digest'

const DAY = 24 * 60 * 60 * 1000
const row = (id: string, o: Record<string, unknown> = {}) => ({
  id, title: id, price: 1_000_000, currency: '₫', images: '["https://x/i.jpg"]',
  district: 'D1', city: 'HCMC', previousPrice: null, priceDropAt: null, urgentUntil: null,
  seller: { trustScore: 100 }, rankScore: 1, createdAt: new Date(), ...o,
})

beforeEach(() => { h.rows = []; h.calls = [] })

describe('the digest sends the LATEST listings, not the same winners forever', () => {
  it('prefers a NEW listing over an older one with a much higher rankScore', async () => {
    h.rows = [
      row('ancient-champion', { rankScore: 9999, createdAt: new Date(Date.now() - 200 * DAY) }),
      row('posted-yesterday', { rankScore: 1, createdAt: new Date(Date.now() - 1 * DAY) }),
    ]
    const { top } = await getDigestContent()
    // The old query returned ancient-champion first, every single week.
    expect(top.map((t) => t.id)).toEqual(['posted-yesterday'])
  })

  it('widens the window rather than falling back to all-time when a week is quiet', async () => {
    h.rows = [row('from-three-weeks-ago', { createdAt: new Date(Date.now() - 21 * DAY) })]
    const { top } = await getDigestContent()
    expect(top.map((t) => t.id)).toEqual(['from-three-weeks-ago'])
    // It must have TRIED the tighter windows first — otherwise "latest" means nothing.
    const windows = h.calls
      .map((c) => ((c.where as Record<string, unknown>)?.createdAt as { gte?: Date } | undefined)?.gte)
      .filter(Boolean) as Date[]
    expect(windows.length).toBeGreaterThan(1)
    expect(windows[0].getTime()).toBeGreaterThan(windows[1].getTime()) // 7d before 14d
  })

  it('stops widening as soon as a window is full', async () => {
    h.rows = Array.from({ length: 6 }, (_, i) => row(`fresh-${i}`, { rankScore: 10 - i }))
    const { top } = await getDigestContent()
    expect(top).toHaveLength(6)
    const windowed = h.calls.filter((c) => ((c.where as Record<string, unknown>)?.createdAt))
    expect(windowed).toHaveLength(1) // the 7-day window satisfied it; no widening
  })
})

describe('the digest never advertises a discount the site has retired', () => {
  it('drops the pill once the 3-day badge window has lapsed', async () => {
    h.rows = [row('lapsed', {
      previousPrice: 2_000_000, price: 1_500_000,
      priceDropAt: new Date(Date.now() - 5 * DAY), // badge expired 2 days ago
    })]
    const { top } = await getDigestContent()
    expect(top[0].drop).toBeNull()
  })

  it('still shows a pill for a drop inside the window', async () => {
    h.rows = [row('live', {
      previousPrice: 2_000_000, price: 1_500_000,
      priceDropAt: new Date(Date.now() - 1 * DAY),
    })]
    const { top } = await getDigestContent()
    expect(top[0].drop).toBeTruthy()
  })

  it('shows no pill when previousPrice lingers with no priceDropAt at all', async () => {
    // previousPrice is cleared only on a RAISE, so a legacy row can carry it with a null timestamp.
    h.rows = [row('no-timestamp', { previousPrice: 2_000_000, price: 1_500_000, priceDropAt: null })]
    const { top } = await getDigestContent()
    expect(top[0].drop).toBeNull()
  })
})
