import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * REGRESSION GUARD FOR THE `?ids=` FAST PATH — the endpoint /saved hydrates from.
 *
 * ⛔ THE DEFECT THIS FILE EXISTS FOR WAS SILENT AND DESTRUCTIVE. `idsFastPath` used to
 * `.slice(0, 200)` the caller's id list and answer as if that were the whole question. The caller
 * (FavoritesContext) reads "requested but not returned" as "this listing was deleted" and removes
 * it from the device's saved set — so on a device with 201 saved listings, the 201st was erased on
 * the next load of /saved, permanently, behind a 200 OK. Nothing logged, nothing failed.
 *
 * ⚠️ SO THE ASSERTION THAT MATTERS IS `evaluated`, NOT `listings`. A cap is legitimate; answering
 * beyond it is not. Every test below pins the invariant that the response reports exactly the ids
 * it looked up, so a caller can tell "absent because gone" from "absent because unasked".
 *
 * ⚠️ DATA SAFETY — `@/lib/db` is stubbed with an in-memory store; nothing here can reach Postgres.
 * `@/lib/edition-scope` and `@/lib/translate` are stubbed to keep the test about the id contract
 * rather than about scoping and MT.
 */

const h = vi.hoisted(() => ({
  /** Ids that exist as PUBLIC (verified + active) listings. */
  live: new Set<string>(),
  /** Every `id: { in: [...] }` the fast path actually sent to the database. */
  queried: [] as string[][],
}))

vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findMany: vi.fn(async ({ where }: any) => {
        const asked: string[] = where?.id?.in ?? []
        h.queried.push(asked)
        // ⚠️ RETURNED OUT OF ORDER ON PURPOSE. Postgres makes no promise about the order of rows
        // for an `IN` list, and the route re-orders by the requested sequence. A test that fed
        // rows back in request order would pass even if that re-ordering were deleted.
        return [...asked].reverse().filter((id) => h.live.has(id)).map((id) => ({ id }))
      }),
    },
  },
}))
vi.mock('@/lib/edition-scope', () => ({
  scopedListingWhere: async (w: any) => w,
  marketplaceListingScope: async () => ({}),
}))
vi.mock('@/lib/serialize', () => ({
  LISTING_CARD_SELECT: {},
  serializeListingCard: (r: any) => ({ id: r.id }),
}))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (l: any) => l }))

import { idsFastPath } from './feed-query'
import { IDS_FAST_PATH_MAX } from '@/lib/listing-ids'

/** Deterministic, distinguishable ids: `id-0`, `id-1`, … */
const idsOf = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `id-${i + from}`)

async function call(ids: string[], extra = '') {
  const res = await idsFastPath(new URLSearchParams(`ids=${ids.join(',')}${extra}`))
  expect(res).not.toBeNull()
  return (await res!.json()) as { listings: { id: string }[]; total: number; evaluated: string[]; complete: boolean }
}

beforeEach(() => {
  h.live = new Set()
  h.queried = []
})

describe('idsFastPath — the ids it answers about', () => {
  it('is not the ids fast path at all when ?ids is absent', async () => {
    expect(await idsFastPath(new URLSearchParams('category=cars'))).toBeNull()
  })

  it('0 ids: answers about nothing, and says so rather than reporting an empty catalog', async () => {
    // ⚠️ `?ids=` IS NOT `no ids`. The first is "tell me about this empty set"; the second is a
    // browse request. Reading them as the same thing served the entire catalog to a hydration call.
    const body = await call([])
    expect(body).toMatchObject({ listings: [], total: 0, evaluated: [], complete: true })
    // ⚠️ No database round trip for an empty list.
    expect(h.queried).toHaveLength(0)
  })

  it('1 live id: returns it and reports it evaluated', async () => {
    h.live.add('id-0')
    const body = await call(['id-0'])
    expect(body.listings.map((l) => l.id)).toEqual(['id-0'])
    expect(body.evaluated).toEqual(['id-0'])
    expect(body.complete).toBe(true)
  })

  it('a genuinely deleted id is EVALUATED and absent — the one case a caller may prune', async () => {
    h.live.add('id-0')
    const body = await call(['id-0', 'id-1'])
    expect(body.listings.map((l) => l.id)).toEqual(['id-0'])
    expect(body.evaluated).toEqual(['id-0', 'id-1'])
    expect(body.complete).toBe(true)
  })

  it(`${IDS_FAST_PATH_MAX} ids: the whole list fits, all of it evaluated`, async () => {
    const ids = idsOf(IDS_FAST_PATH_MAX)
    ids.forEach((id) => h.live.add(id))
    const body = await call(ids)
    expect(body.evaluated).toEqual(ids)
    expect(body.complete).toBe(true)
    expect(body.listings).toHaveLength(IDS_FAST_PATH_MAX)
  })

  it(`${IDS_FAST_PATH_MAX + 1} ids: the surplus is UNEVALUATED, never silently absent`, async () => {
    const ids = idsOf(IDS_FAST_PATH_MAX + 1)
    ids.forEach((id) => h.live.add(id))
    const body = await call(ids)
    // The cap still applies — this is not a promise to answer unbounded lists…
    expect(body.evaluated).toHaveLength(IDS_FAST_PATH_MAX)
    // …but the id past the edge must not be reported as "looked at and not found", which is
    // exactly the shape that deleted it from the caller's device.
    const last = ids[IDS_FAST_PATH_MAX]
    expect(body.evaluated).not.toContain(last)
    expect(body.listings.map((l) => l.id)).not.toContain(last)
    expect(body.complete).toBe(false)
  })

  it('500 ids: the caller is told the answer is incomplete', async () => {
    const ids = idsOf(500)
    ids.forEach((id) => h.live.add(id))
    const body = await call(ids)
    expect(body.evaluated).toEqual(ids.slice(0, IDS_FAST_PATH_MAX))
    expect(body.complete).toBe(false)
    expect(h.queried).toEqual([ids.slice(0, IDS_FAST_PATH_MAX)])
  })

  it('preserves the requested order even when the database returns rows in another', async () => {
    const ids = idsOf(5)
    ids.forEach((id) => h.live.add(id))
    const body = await call(ids)
    expect(body.listings.map((l) => l.id)).toEqual(ids)
  })

  it('a duplicated id does not eat a slot and push a real one past the cap', async () => {
    // 199 distinct ids, the first repeated twice → 201 raw entries, all 199 answerable.
    const ids = idsOf(IDS_FAST_PATH_MAX - 1)
    ids.forEach((id) => h.live.add(id))
    const body = await call([...ids, 'id-0', 'id-1'])
    expect(body.evaluated).toEqual(ids)
    expect(body.complete).toBe(true)
    expect(body.listings).toHaveLength(IDS_FAST_PATH_MAX - 1)
  })

  it('ignores blanks and whitespace rather than querying for them', async () => {
    h.live.add('id-0')
    const body = await call(['id-0', '', ' '])
    expect(body.evaluated).toEqual(['id-0'])
    expect(h.queried).toEqual([['id-0']])
  })
})
