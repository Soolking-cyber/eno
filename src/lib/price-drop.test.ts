import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// notifyPriceDrop's audience since price-drop alerts for saved listings (owner, 2026-11-17 — "explicit opt-in"): chat buyers,
// contact revealers, THEN savers whose switch is on (src/lib/price-alerts.ts), deduped, seller out, the 100 cap and the 5-a-day
// cap shared. A saver gets no push 22:00–07:00 ICT (the bell row is still written); everyone else behaves as before.
const h = vi.hoisted(() => ({
  convos: [] as string[],
  reveals: [] as string[],
  savers: [] as string[],
  saversThrow: false,
  saverCalls: [] as unknown[][],
  counts: [] as Array<{ recipientId: string; _count: { _all: number } }>,
  rows: [] as string[],
  pushes: [] as string[],
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w }))
vi.mock('@/lib/push', () => ({ sendPushToProfile: async (rid: string) => { h.pushes.push(rid) } }))
vi.mock('@/lib/price-alerts', () => ({
  priceAlertSavers: async (...a: unknown[]) => { h.saverCalls.push(a); if (h.saversThrow) throw new Error('db down'); return h.savers },
}))
vi.mock('@/lib/db', () => ({
  db: {
    listing: { findFirst: async () => ({ title: 'Bike', currency: 'VND', status: 'active', verified: true, seller: { ownerId: 'seller' } }) },
    conversation: { findMany: async () => h.convos.map((buyerProfileId) => ({ buyerProfileId })) },
    contactReveal: { findMany: async () => h.reveals.map((viewerId) => ({ viewerId })) },
    profile: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id })) },
    notification: {
      groupBy: async () => h.counts,
      createMany: async ({ data }: { data: Array<{ recipientId: string }> }) => { h.rows.push(...data.map((d) => d.recipientId)); return { count: data.length } },
    },
  },
}))

const { notifyPriceDrop, DROP } = await import('./price-drop')
const { ALERTS } = await import('./saved-search-alerts')

const at = (iso: string) => vi.setSystemTime(new Date(iso))
const NIGHT = '2026-11-17T16:00:00Z' // 23:00 ICT
const DAYTIME = '2026-11-17T03:00:00Z' // 10:00 ICT

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  at(DAYTIME)
  Object.assign(h, { convos: [], reveals: [], savers: [], saversThrow: false, saverCalls: [], counts: [], rows: [], pushes: [] })
})
afterEach(() => { vi.useRealTimers() })

describe('notifyPriceDrop — savers who switched alerts on', () => {
  it('adds them after buyers and revealers, deduped, the seller left out', async () => {
    h.convos = ['b1', 'seller']; h.reveals = ['r1', 'b1']; h.savers = ['s1', 'b1', 'seller']
    await notifyPriceDrop('L1', 1_000_000, 800_000)
    expect(h.saverCalls).toEqual([['L1', DROP.AUDIENCE_CAP]])
    expect(h.rows).toEqual(['b1', 'r1', 's1'])
    expect(h.pushes).toEqual(['b1', 'r1', 's1'])
  })

  it('buyers fill the 100 cap first — stronger intent before a heart', async () => {
    h.convos = Array.from({ length: 100 }, (_, i) => `b${i}`); h.savers = ['s1']
    await notifyPriceDrop('L1', 1_000_000, 800_000)
    expect(h.rows).toHaveLength(100)
    expect(h.rows).not.toContain('s1')
  })

  it('a failed consent read sends no saver alert — buyers and revealers are still told', async () => {
    h.convos = ['b1']; h.reveals = ['r1']; h.saversThrow = true
    await notifyPriceDrop('L1', 1_000_000, 800_000)
    expect(h.rows).toEqual(['b1', 'r1'])
  })

  it('a saver counts against the shared 5-a-day cap', async () => {
    h.savers = ['s1', 's2']; h.counts = [{ recipientId: 's1', _count: { _all: DROP.RECIPIENT_DAILY_CAP } }]
    await notifyPriceDrop('L1', 1_000_000, 800_000)
    expect(h.rows).toEqual(['s2'])
  })

  it('⛔ 23:00 ICT: a pure saver gets the bell row but no push; a buyer — even one who also saved — still gets the push', async () => {
    at(NIGHT)
    h.convos = ['b1', 'b2']; h.savers = ['s1', 'b2']
    await notifyPriceDrop('L1', 1_000_000, 800_000)
    expect(h.rows).toEqual(['b1', 'b2', 's1'])
    // b2 is a buyer who also saved: the buyer's push stays at night; only the pure saver (s1) waits for the morning.
    expect(h.pushes).toEqual(['b1', 'b2'])
  })

  it('10:00 ICT: everyone gets a push', async () => {
    h.convos = ['b1']; h.savers = ['s1']
    await notifyPriceDrop('L1', 1_000_000, 800_000)
    expect(h.pushes).toEqual(['b1', 's1'])
  })
})

describe('the numbers /privacy states (a change re-dates /privacy — never a PRICE_ALERT_NOTICE_VERSION bump)', () => {
  it('once a day per listing, no push 22:00–07:00', () => {
    expect(DROP.NOTIFY_COOLDOWN_MS).toBe(24 * 3600_000)
    expect([ALERTS.QUIET_START_HOUR, ALERTS.QUIET_END_HOUR]).toEqual([22, 7])
  })
})

describe('the per-recipient daily cap — an internal best-effort limit, NOT a /privacy promise', () => {
  // It counts deletable bell rows with no lock (clearing the bell or a concurrent fan-out can pass it), so /privacy names
  // only the per-listing limit, which is stamped on the Listing row in the same write as the price change.
  it('at most five price_drop rows per recipient a day, best effort', () => {
    expect(DROP.RECIPIENT_DAILY_CAP).toBe(5)
  })
})
