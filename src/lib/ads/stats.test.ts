import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The ad figures (src/lib/ads/stats.ts, owner 2026-11-25: "realtime stats … to industry standard"): counted in memory,
 * deduplicated per browser session for 30 minutes, invalid traffic counted apart, flushed as one transaction per ad.
 */
vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ txs: [] as { sql: string; values: unknown[] }[][], fail: 0 }))
vi.mock('@/lib/db', () => ({
  db: {
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings.join('?').replace(/\s+/g, ' '), values }),
    $transaction: async (writes: { sql: string; values: unknown[] }[]) => {
      if (h.fail > 0) { h.fail--; throw new Error('db down') }
      h.txs.push(writes)
      return writes.map(() => 1)
    },
  },
}))
vi.mock('@/lib/log', () => ({ logError: () => {}, logInfo: () => {} }))

const s = await import('./stats')
const T0 = Date.parse('2026-11-25T08:10:00Z')
const ev = (over: Partial<Parameters<typeof s.recordAdEvent>[0]> = {}) => ({ adId: 'ad1', kind: 'i' as const, sid: 'sess1', ip: '1.2.3.4', givt: false, running: true, now: T0, ...over })

beforeEach(() => {
  s.__resetAdStats()
  h.txs = []
  h.fail = 0
})

describe('counting', () => {
  it('a viewable impression and a click count once per session per ad per kind for 30 minutes', () => {
    expect(s.recordAdEvent(ev())).toBe('valid')
    expect(s.recordAdEvent(ev({ now: T0 + 60_000 }))).toBe('duplicate')
    expect(s.recordAdEvent(ev({ kind: 'c' }))).toBe('valid')
    expect(s.recordAdEvent(ev({ kind: 'c', now: T0 + 29 * 60_000 }))).toBe('duplicate')
    expect(s.recordAdEvent(ev({ now: T0 + 31 * 60_000 }))).toBe('valid')
    // Another session behind the SAME address (a carrier NAT) is another viewer.
    expect(s.recordAdEvent(ev({ sid: 'sess2' }))).toBe('valid')
    const p = s.pendingFor('ad1').get(Date.parse('2026-11-25T08:00:00Z'))!
    expect(p).toEqual({ impressions: 3, clicks: 1, invalid: 0, reachNew: 2 })
  })

  it('no session id → the address stands in for it', () => {
    expect(s.recordAdEvent(ev({ sid: null }))).toBe('valid')
    expect(s.recordAdEvent(ev({ sid: null }))).toBe('duplicate')
    expect(s.recordAdEvent(ev({ sid: null, ip: '5.6.7.8' }))).toBe('valid')
  })

  it('GIVT — a bot, a prefetch, an ad not running — is counted as invalid, never as valid, and deduplicated too', () => {
    expect(s.recordAdEvent(ev({ givt: true }))).toBe('invalid')
    expect(s.recordAdEvent(ev({ givt: true }))).toBe('duplicate')
    expect(s.recordAdEvent(ev({ running: false, sid: 'x' }))).toBe('invalid')
    expect(s.recordAdEvent(ev({ kind: 'c', givt: true }))).toBe('invalid')
    expect([...s.pendingFor('ad1').values()][0]).toEqual({ impressions: 0, clicks: 0, invalid: 3, reachNew: 0 })
  })

  it('past the per-(IP, ad, kind) cap, more sessions from one address are invalid (the abuse guard minted ids cannot pass)', () => {
    for (let i = 0; i < s.IP_CAP.i; i++) expect(s.recordAdEvent(ev({ sid: `s${i}` }))).toBe('valid')
    expect(s.recordAdEvent(ev({ sid: 'one-too-many' }))).toBe('invalid')
    // Another ad, or clicks, from the same address have their own allowance (a carrier NAT is many real people).
    expect(s.recordAdEvent(ev({ sid: 'other-ad', adId: 'ad2' }))).toBe('valid')
    expect(s.recordAdEvent(ev({ sid: 's1', kind: 'c' }))).toBe('valid')
    // …and the window passes.
    expect(s.recordAdEvent(ev({ sid: 'later', now: T0 + s.IP_WINDOW_MS + 1 }))).toBe('valid')
  })

  it('reach: a session counts once per UTC day; the next day it is new again', () => {
    s.recordAdEvent(ev())
    s.recordAdEvent(ev({ now: T0 + 40 * 60_000 }))
    s.recordAdEvent(ev({ now: Date.parse('2026-11-26T01:00:00Z') }))
    const reach = [...s.pendingFor('ad1').values()].reduce((n, d) => n + d.reachNew, 0)
    const imps = [...s.pendingFor('ad1').values()].reduce((n, d) => n + d.impressions, 0)
    expect({ reach, imps }).toEqual({ reach: 2, imps: 3 })
  })
})

describe('the flush', () => {
  it('one transaction per ad: one UPDATE of the totals and one upsert per ad-hour — never a row per event', async () => {
    for (let i = 0; i < 5; i++) s.recordAdEvent(ev({ sid: `a${i}` }))
    s.recordAdEvent(ev({ kind: 'c' }))
    s.recordAdEvent(ev({ sid: 'b', now: T0 + 3_600_000 }))
    s.recordAdEvent(ev({ adId: 'ad2', givt: true }))
    await s.flushAdStats(T0 + 3_600_000)
    expect(h.txs).toHaveLength(2)
    const [ad1, ad2] = h.txs
    expect(ad1).toHaveLength(3)
    expect(ad1![0]!.sql).toMatch(/^UPDATE "ListingAd" SET "impressions" = "impressions" \+ \?, "clicks" = "clicks" \+ \? WHERE "id" = \?$/)
    expect(ad1![0]!.values).toEqual([6, 1, 'ad1'])
    expect(ad1![1]!.sql).toMatch(/INSERT INTO "AdStat" .* ON CONFLICT \("adId", "bucket"\) DO UPDATE SET "impressions" = "AdStat"\."impressions" \+ EXCLUDED\."impressions"/)
    expect(ad1![1]!.values).toEqual(['ad1', new Date('2026-11-25T08:00:00Z'), 5, 1, 0, 5])
    expect(ad1![2]!.values).toEqual(['ad1', new Date('2026-11-25T09:00:00Z'), 1, 0, 0, 1])
    // Only invalid traffic: no totals to add, the hour still records it.
    expect(ad2).toHaveLength(1)
    expect(ad2![0]!.values).toEqual(['ad2', new Date('2026-11-25T08:00:00Z'), 0, 0, 1, 0])
    expect(s.pendingFor('ad1').size).toBe(0)
  })

  it('a failed flush is put back (added to what came meanwhile) and written once it succeeds — nothing doubled', async () => {
    s.recordAdEvent(ev())
    h.fail = 1
    await s.flushAdStats(T0)
    expect(h.txs).toHaveLength(0)
    s.recordAdEvent(ev({ sid: 'other' }))
    await s.flushAdStats(T0)
    expect(h.txs).toHaveLength(1)
    expect(h.txs[0]![0]!.values).toEqual([2, 0, 'ad1'])
  })

  it('before the AdStat table exists, the totals are still written (the hourly rows are not)', async () => {
    const { db } = await import('@/lib/db')
    const spy = vi.spyOn(db, '$transaction').mockImplementationOnce((async () => { throw new Error('relation "AdStat" does not exist') }) as never)
    s.recordAdEvent(ev())
    await s.flushAdStats(T0)
    expect(h.txs).toHaveLength(1)
    expect(h.txs[0]).toHaveLength(1)
    expect(h.txs[0]![0]!.sql).toMatch(/^UPDATE "ListingAd"/)
    spy.mockRestore()
  })

  it('after three failures in a row it is dropped (logged), so a missing table cannot grow memory for ever', async () => {
    s.recordAdEvent(ev())
    h.fail = 3
    for (let i = 0; i < 3; i++) await s.flushAdStats(T0)
    expect(s.pendingFor('ad1').size).toBe(0)
  })
})

describe('the figures', () => {
  const AD = {
    id: 'ad1', listingId: null, creativeId: 'cr1', status: 'active', amount: '537143',
    startsAt: new Date('2026-11-25T00:00:00Z'), endsAt: new Date('2026-11-26T00:00:00Z'),
  } as never
  it('totals, CTR, reach, frequency, spend pro rata, eCPM and eCPC; hourly in UTC with ICT labels; unflushed counts included', () => {
    const rows = [
      { bucket: new Date('2026-11-25T08:00:00Z'), impressions: 1000, clicks: 20, invalid: 7, reachNew: 400 },
      { bucket: new Date('2026-11-25T09:00:00Z'), impressions: 500, clicks: 5, invalid: 0, reachNew: 100 },
    ]
    s.recordAdEvent(ev({ now: Date.parse('2026-11-25T10:05:00Z') }))
    const f = s.adFigures(AD, rows, new Date('2026-11-25T12:00:00Z'))
    expect(f.totals).toEqual({
      impressions: 1501, clicks: 25, invalid: 7, ctr: 0.0167, reach: 501, frequency: 3,
      // Half the day has run: half the price.
      spend_usdc: '0.268571', paid_usdc: '0.537143', ecpm_usdc: '0.178928', ecpc_usdc: '0.010742',
    })
    expect(f.hourly.map((x) => [x.hour_utc, x.hour_ict, x.impressions])).toEqual([
      ['2026-11-25T08:00:00.000Z', '2026-11-25 15:00 ICT', 1000],
      ['2026-11-25T09:00:00.000Z', '2026-11-25 16:00 ICT', 500],
      ['2026-11-25T10:00:00.000Z', '2026-11-25 17:00 ICT', 1],
    ])
  })
  it('nothing seen yet: CTR, frequency, eCPM and eCPC are null; spend never exceeds the price, never goes below 0', () => {
    expect(s.adFigures(AD, [], new Date('2026-11-24T12:00:00Z')).totals).toMatchObject({ ctr: null, frequency: null, ecpm_usdc: null, ecpc_usdc: null, spend_usdc: '0' })
    expect(s.adFigures(AD, [], new Date('2026-12-30T00:00:00Z')).totals.spend_usdc).toBe('0.537143')
    expect(s.spendAtomic({ ...(AD as object), status: 'review' } as never, new Date('2026-11-25T12:00:00Z'))).toBe(BigInt(0))
  })
})
