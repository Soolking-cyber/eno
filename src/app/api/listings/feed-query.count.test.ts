import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The feed-total cache (audit M2 + #362). The whole-feed COUNT was the most expensive statement in
 * the database — 13% of all DB time — and it ran on every infinite-scroll page for a number the
 * client already had. These pin what makes the cache safe: it serves an answer under a minute old,
 * identical concurrent counts share ONE query, a key being read survives a burst of other filters,
 * and a failure is never remembered.
 *
 * ⚠️ DATA SAFETY — `@/lib/db` is stubbed; nothing here can reach Postgres. The cache is module
 * state, so every test uses its own `where` and cannot read another test's entry.
 */

const h = vi.hoisted(() => ({
  calls: [] as unknown[],
  /** What the next count resolves to — a number, or an Error to reject with. */
  next: 0 as number | Error,
  /** When set, counts wait on this before answering (to hold two callers in flight together). */
  gate: null as Promise<void> | null,
}))

vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      count: vi.fn(async ({ where }: { where: unknown }) => {
        h.calls.push(where)
        if (h.gate) await h.gate
        if (h.next instanceof Error) throw h.next
        return h.next
      }),
    },
  },
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w, marketplaceListingScope: async () => ({}) }))
vi.mock('@/lib/serialize', () => ({ LISTING_CARD_SELECT: {}, serializeListingCard: (r: unknown) => r }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (l: unknown) => l }))

import { countListingsCached } from './feed-query'

const T0 = new Date('2026-09-23T10:00:00Z').getTime()
const whereFor = (tag: string) => ({ AND: [{ verified: true }, { status: 'active' }, { title: { contains: tag } }] })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  h.calls = []
  h.next = 0
  h.gate = null
})
afterEach(() => vi.useRealTimers())

describe('countListingsCached', () => {
  it('a second ask within a minute is answered from the cache', async () => {
    h.next = 98_755
    expect(await countListingsCached(whereFor('fresh'))).toBe(98_755)
    vi.setSystemTime(T0 + 59_000)
    expect(await countListingsCached(whereFor('fresh'))).toBe(98_755)
    expect(h.calls).toHaveLength(1)
  })

  it('past a minute a first-page ask counts again', async () => {
    h.next = 10
    await countListingsCached(whereFor('expire'))
    vi.setSystemTime(T0 + 61_000)
    h.next = 11
    expect(await countListingsCached(whereFor('expire'))).toBe(11)
    expect(h.calls).toHaveLength(2)
  })

  it('identical counts in flight together share ONE query', async () => {
    let open!: () => void
    h.gate = new Promise<void>((r) => { open = r })
    h.next = 42
    const a = countListingsCached(whereFor('together'))
    const b = countListingsCached(whereFor('together'))
    open()
    expect(await Promise.all([a, b])).toEqual([42, 42])
    expect(h.calls).toHaveLength(1)
  })

  it('different filters are different counts', async () => {
    h.next = 1
    await countListingsCached(whereFor('one'))
    await countListingsCached(whereFor('two'))
    expect(h.calls).toHaveLength(2)
  })

  it('a key being READ survives a burst of other filters (LRU on read, not insertion order)', async () => {
    vi.resetModules()
    const fresh = (await import('./feed-query')).countListingsCached
    h.next = 1
    await fresh(whereFor('hot'))
    for (let i = 0; i < 499; i++) await fresh(whereFor(`burst-${i}`)) // the cache is now full (500)
    await fresh(whereFor('hot')) // read — moves 'hot' to the young end
    await fresh(whereFor('one-more')) // forces one eviction: must be burst-0, not 'hot'
    const before = h.calls.length
    await fresh(whereFor('hot'))
    expect(h.calls.length).toBe(before) // still cached
    await fresh(whereFor('burst-0'))
    expect(h.calls.length).toBe(before + 1) // was evicted
  })

  it('a failed count is not remembered — the next ask queries again', async () => {
    h.next = new Error('db down')
    await expect(countListingsCached(whereFor('fail'))).rejects.toThrow('db down')
    h.next = 7
    expect(await countListingsCached(whereFor('fail'))).toBe(7)
    expect(h.calls).toHaveLength(2)
  })
})
