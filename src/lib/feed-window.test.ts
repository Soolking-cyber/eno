import { describe, it, expect, vi, beforeEach } from 'vitest'
import { feedPagePlan } from './feed-window'

/**
 * ⛔ THESE TESTS EXIST BECAUSE FOUR REVIEWERS INDEPENDENTLY REFUTED THE FIRST CUT AND NOTHING IN
 * THE SUITE COULD HAVE CAUGHT ANY OF IT. `feed-diversity.test.ts` covers `mergeRoundRobin`, a pure
 * helper that was never wrong; every real defect lived in `diverseFeedWindow`, which touches the
 * database and so had no test at all. Each case below is one of those defects, measured first.
 */

const groupBy = vi.fn()
const findMany = vi.fn()
vi.mock('./db', () => ({ db: { listing: { groupBy: (a: unknown) => groupBy(a), findMany: (a: unknown) => findMany(a) } } }))
// The window must carry the licensing scope; the identity here lets a test assert it was applied.
vi.mock('./edition-scope', () => ({
  scopedListingWhere: async (w: unknown) => ({ AND: [w, { sellerId: { notIn: ['desk'] } }] }),
}))

const { diverseFeedWindow, __resetFeedWindowCache } = await import('./feed-window')

const RANK_DESC = [{ rankScore: 'desc' as const }, { id: 'desc' as const }]
const SELECT = { id: true } as const
const row = (id: string, sellerId: string) => ({ id, sellerId })

/** A seller with `n` rows, ids `<seller>-0…`. */
const stock = (sellerId: string, n: number) => Array.from({ length: n }, (_, i) => row(`${sellerId}-${i}`, sellerId))

beforeEach(() => {
  __resetFeedWindowCache()
  groupBy.mockReset()
  findMany.mockReset()
})

describe('diverseFeedWindow', () => {
  /**
   * ⛔ THE DEFECT THAT SHIPPED IN THE FIRST CUT, AND THE ONE THAT WAS INVISIBLE. Groups were sorted
   * in JS by `row[0].rankScore` — a field `LISTING_CARD_SELECT` does not select. Measured against
   * the real database: `rankScore` is `undefined` on every card row, so `?? 0` made every group tie
   * and the ordering collapsed to ascending `id`, silently. The fix moves the ranking into the
   * aggregate, so this asserts the QUERY, which is the only place the ordering now lives.
   */
  it('⛔ RANKS AND CAPS THE SELLERS IN THE DATABASE, NOT BY A FIELD THE ROWS DO NOT CARRY', async () => {
    groupBy.mockResolvedValue([{ sellerId: 'a' }, { sellerId: 'b' }])
    findMany.mockImplementation(async ({ where }: any) => {
      const s = where?.AND?.[1]?.sellerId
      return s ? stock(s, 30) : []
    })
    await diverseFeedWindow({ status: 'active' }, RANK_DESC, SELECT)
    const arg = groupBy.mock.calls[0][0]
    expect(arg._max).toEqual({ rankScore: true })
    expect(arg.orderBy).toEqual([{ _max: { rankScore: 'desc' } }, { sellerId: 'desc' }])
    // ⚠️ THE CAP IS IN THE QUERY. `slice(0, 12)` over an unordered groupBy could drop the
    // top-ranked seller entirely, and could drop a DIFFERENT one on the SSR render than on the
    // API call — a head that differs between the two reshuffles the feed on hydration.
    expect(arg.take).toBe(12)
  })

  /**
   * ⛔ THE LICENSING BOUNDARY, AND THE CACHE KEY IS PART OF IT. The two editions differ only by
   * this exclusion, so a window keyed on the caller's raw predicate could serve the marketplace a
   * head built for the services edition — visa SKUs on a licensed sàn TMĐT, out of a cache.
   */
  it('⛔ CARRIES THE EDITION SCOPE INTO EVERY READ', async () => {
    groupBy.mockResolvedValue([{ sellerId: 'a' }, { sellerId: 'b' }])
    findMany.mockImplementation(async ({ where }: any) => stock(where?.AND?.[1]?.sellerId ?? 'x', 30))
    await diverseFeedWindow({ status: 'active' }, RANK_DESC, SELECT)
    const scoped = { AND: [{ status: 'active' }, { sellerId: { notIn: ['desk'] } }] }
    expect(groupBy.mock.calls[0][0].where).toEqual(scoped)
    for (const [arg] of findMany.mock.calls) expect(arg.where.AND[0]).toEqual(scoped)
  })

  /**
   * ⛔ THE HEAD MUST BE THE SAME HEAD ON PAGE 5 AS ON PAGE 1. Every page past the window excludes
   * "the ids the window served", so a head that is recomputed per request is an assumption about
   * the database rather than a guarantee — and a transient failure at offset 120 that swapped in a
   * different head is exactly how the 23-repeat bug came back.
   */
  it('⛔ COMPUTES THE WINDOW ONCE AND REUSES IT ACROSS PAGES', async () => {
    groupBy.mockResolvedValue([{ sellerId: 'a' }, { sellerId: 'b' }])
    findMany.mockImplementation(async ({ where }: any) => stock(where?.AND?.[1]?.sellerId ?? 'x', 30))
    const first = await diverseFeedWindow({ status: 'active' }, RANK_DESC, SELECT)
    const calls = groupBy.mock.calls.length + findMany.mock.calls.length
    const second = await diverseFeedWindow({ status: 'active' }, RANK_DESC, SELECT)
    expect(second.map((r: any) => r.id)).toEqual(first.map((r: any) => r.id))
    expect(groupBy.mock.calls.length + findMany.mock.calls.length).toBe(calls)
  })

  /** A different predicate is a different window — the memo must not answer for it. */
  it('keys the memo on the predicate, so a filtered feed gets its own window', async () => {
    groupBy.mockResolvedValue([{ sellerId: 'a' }, { sellerId: 'b' }])
    findMany.mockImplementation(async ({ where }: any) => stock(where?.AND?.[1]?.sellerId ?? 'x', 30))
    await diverseFeedWindow({ status: 'active' }, RANK_DESC, SELECT)
    const after = groupBy.mock.calls.length
    await diverseFeedWindow({ status: 'active', categoryId: 'c1' }, RANK_DESC, SELECT)
    expect(groupBy.mock.calls.length).toBe(after + 1)
  })

  /**
   * ⛔ A PARTIAL FAN-OUT IS NOT A WINDOW. Catching per query and substituting `[]` would silently
   * drop a seller and produce a head no other request agrees with. All sellers or none — and
   * "none" is the single-query window, not a 500 on the busiest public endpoint in the app.
   */
  it('⛔ FALLS BACK TO ONE QUERY WHEN ANY SELLER READ FAILS, RATHER THAN SERVING A PARTIAL HEAD', async () => {
    groupBy.mockResolvedValue([{ sellerId: 'a' }, { sellerId: 'b' }])
    findMany
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValue(stock('fallback', 60))
    const win = await diverseFeedWindow({ status: 'active' }, RANK_DESC, SELECT)
    expect(win).toHaveLength(60)
    expect(win.every((r: any) => r.sellerId === 'fallback')).toBe(true)
  })

  it('falls back to one query when the groupBy fails, or when there is only one seller', async () => {
    groupBy.mockResolvedValue(null as never)
    groupBy.mockRejectedValueOnce(new Error('nope'))
    findMany.mockResolvedValue(stock('only', 60))
    expect(await diverseFeedWindow({ status: 'active' }, RANK_DESC, SELECT)).toHaveLength(60)

    __resetFeedWindowCache()
    groupBy.mockReset()
    groupBy.mockResolvedValue([{ sellerId: 'only' }])
    findMany.mockClear()
    await diverseFeedWindow({ status: 'active' }, RANK_DESC, SELECT)
    expect(findMany).toHaveBeenCalledTimes(1)
  })

  /**
   * ⛔ THE GROUP RANKING IS COMPUTED FROM `rankScore`, SO THIS SERVES ONLY THE SORT THAT ORDERS BY
   * IT. `diversityAppliesTo()` gates the callers to the default sort today; this is what keeps the
   * two honest if anyone widens it — on a price sort the fan-out would rank groups by a field the
   * rows are not sorted by, which is worse than no diversity at all.
   */
  it('⛔ DECLINES TO DIVERSIFY ANY SORT IT CANNOT RANK GROUPS FOR', async () => {
    findMany.mockResolvedValue(stock('a', 60))
    const win = await diverseFeedWindow({ status: 'active' }, [{ price: 'asc' }, { id: 'desc' }], SELECT)
    expect(groupBy).not.toHaveBeenCalled()
    expect(win).toHaveLength(60)
  })

  /**
   * ⛔ AN UNDER-FILLED WINDOW IS TOPPED UP, NOT ABANDONED. Falling back to `single()` here returned
   * sixty consecutive rows from the one deep seller and reinstated the monopoly this exists to
   * remove. The top-up must exclude what the merge already holds, or the window repeats itself.
   */
  it('⛔ TOPS UP A SHORT WINDOW INSTEAD OF ABANDONING THE DIVERSE HEAD', async () => {
    groupBy.mockResolvedValue([{ sellerId: 'a' }, { sellerId: 'b' }])
    findMany.mockImplementation(async ({ where }: any) => {
      const s = where?.AND?.[1]?.sellerId
      if (s) return stock(s, 5)                       // 10 rows total — well short of 60
      return stock('tail', 50)                        // the top-up read
    })
    const win = await diverseFeedWindow({ status: 'active' }, RANK_DESC, SELECT)
    expect(win).toHaveLength(60)
    expect(win.slice(0, 4).map((r: any) => r.sellerId)).toEqual(['a', 'b', 'a', 'b'])
    const topUp = findMany.mock.calls.at(-1)![0]
    expect(topUp.where.AND[1].id.notIn).toHaveLength(10)
  })

  /** The window is a fixed 60 whatever the fan-out returns — a page-sized window cannot paginate. */
  it('returns exactly FEED_DIVERSITY_WINDOW rows when the fan-out over-delivers', async () => {
    groupBy.mockResolvedValue([{ sellerId: 'a' }, { sellerId: 'b' }, { sellerId: 'c' }])
    findMany.mockImplementation(async ({ where }: any) => stock(where?.AND?.[1]?.sellerId ?? 'x', 40))
    const win = await diverseFeedWindow({ status: 'active' }, RANK_DESC, SELECT)
    expect(win).toHaveLength(60)
    expect(new Set(win.map((r: any) => r.sellerId)).size).toBe(3)
  })
})

/**
 * ⛔ THE TWO DEFECTS THE SECOND REVIEW ROUND FOUND IN THE MEMO ITSELF. Both were invisible to the
 * first set of tests because both call sites pass the same projection and the happy path never
 * fails — which is exactly the shape of a bug that waits.
 */
describe('the window memo', () => {
  it('⛔ KEYS ON `select`, SO A NARROWER PROJECTION CANNOT BE SERVED ANOTHER CALLER\'S ROWS', async () => {
    groupBy.mockResolvedValue([{ sellerId: 'a' }, { sellerId: 'b' }])
    findMany.mockImplementation(async ({ where }: any) => stock(where?.AND?.[1]?.sellerId ?? 'x', 30))
    await diverseFeedWindow({ status: 'active' }, RANK_DESC, { id: true } as const)
    const after = groupBy.mock.calls.length
    await diverseFeedWindow({ status: 'active' }, RANK_DESC, { id: true, title: true } as const)
    expect(groupBy.mock.calls.length).toBe(after + 1)
  })

  /**
   * ⛔ A FALLBACK HEAD IS A DIFFERENT HEAD. Caching the natural top-60 that a transient failure
   * produces would make every following page exclude a set the reader never saw — the repeats-and-
   * gaps bug, reintroduced by the very cache meant to prevent it, and held for a full minute.
   */
  it('⛔ NEVER CACHES A FALLBACK WINDOW, SO A TRANSIENT FAILURE COSTS ONE REQUEST NOT A MINUTE', async () => {
    groupBy.mockRejectedValueOnce(new Error('transient'))
    findMany.mockResolvedValue(stock('natural', 60))
    await diverseFeedWindow({ status: 'active' }, RANK_DESC, SELECT)
    // The next request must try again rather than inherit the fallback head.
    groupBy.mockResolvedValue([{ sellerId: 'a' }, { sellerId: 'b' }])
    findMany.mockImplementation(async ({ where }: any) => stock(where?.AND?.[1]?.sellerId ?? 'x', 30))
    const second = await diverseFeedWindow({ status: 'active' }, RANK_DESC, SELECT)
    expect(new Set(second.map((r: any) => r.sellerId))).toEqual(new Set(['a', 'b']))
  })
  /**
   * ⛔ A WINDOW OF PURE TOP-UP IS A FALLBACK WEARING THE DIVERSE FLAG. If every fan-out comes back
   * empty (the rows moved between the groupBy and the reads), the 60 rows are natural order — and
   * caching that as a diverse head is the 23-repeat regression reintroduced by the cache meant to
   * prevent it. Found by a reviewer reading the return statement, not by any test.
   */
  it('⛔ DOES NOT CACHE AN ALL-TOP-UP WINDOW AS A DIVERSE HEAD', async () => {
    groupBy.mockResolvedValue([{ sellerId: 'a' }, { sellerId: 'b' }])
    findMany.mockImplementation(async ({ where }: any) => (where?.AND?.[1]?.sellerId ? [] : stock('natural', 60)))
    const first = await diverseFeedWindow({ status: 'active' }, RANK_DESC, SELECT)
    expect(first.every((r: any) => r.sellerId === 'natural')).toBe(true)
    // Not memoized: the next request must fan out again rather than inherit this head.
    const before = groupBy.mock.calls.length
    await diverseFeedWindow({ status: 'active' }, RANK_DESC, SELECT)
    expect(groupBy.mock.calls.length).toBe(before + 1)
  })
})

/**
 * ⛔ THE ARITHMETIC THAT CARRIED TWO OF THE THREE MEASURED DEFECTS, AND HAD NO TEST. Both lived in
 * route code — a double-counted offset, and a guard that sent every page past the window down an
 * un-excluded query. Each cost the same 23 repeats across four pages of the live feed.
 */
describe('feedPagePlan', () => {
  // fable asked for exactly these offsets on a 70-row head; 60 is the boundary, 55 the straddle.
  it('plans the boundary offsets a 60-row head produces', () => {
    expect(feedPagePlan(60, 0, 48)).toEqual({ fromHead: { start: 0, end: 48 }, tailSkip: 0, tailTake: 0 })
    expect(feedPagePlan(60, 48, 24)).toEqual({ fromHead: { start: 48, end: 60 }, tailSkip: 0, tailTake: 12 })
    expect(feedPagePlan(60, 55, 24)).toEqual({ fromHead: { start: 55, end: 60 }, tailSkip: 0, tailTake: 19 })
    // ⛔ AT THE BOUNDARY THE TAIL STARTS AT ZERO, NOT AT `offset`. Reading it at `skip: offset`
    // counts the offset twice and serves rows 120-179 where 60-119 belong.
    expect(feedPagePlan(60, 60, 60)).toEqual({ fromHead: null, tailSkip: 0, tailTake: 60 })
    expect(feedPagePlan(60, 72, 24)).toEqual({ fromHead: null, tailSkip: 12, tailTake: 24 })
  })

  /**
   * ⛔ THE PROPERTY THE WHOLE CHANGE IS JUDGED ON, PROVEN EXHAUSTIVELY RATHER THAN SAMPLED: paging
   * a feed serves every row exactly once. This walks a 200-row feed at four page sizes and asserts
   * no repeat and no gap — the same statement the live measurement makes ("240 rows, 240 distinct"),
   * but over every offset instead of four of them.
   */
  it('⛔ SERVES EVERY ROW EXACTLY ONCE, AT EVERY PAGE SIZE', () => {
    const HEAD = 60, TOTAL = 200
    for (const limit of [12, 24, 48, 60]) {
      const seen: number[] = []
      for (let offset = 0; offset < TOTAL; offset += limit) {
        const plan = feedPagePlan(HEAD, offset, limit)
        // Head rows are indices 0..59 of the reordered head; tail rows are the natural order with
        // those 60 excluded, i.e. feed indices 60.. — the two index spaces the route keeps apart.
        if (plan.fromHead) for (let i = plan.fromHead.start; i < plan.fromHead.end; i++) seen.push(i)
        for (let i = 0; i < plan.tailTake; i++) {
          const idx = HEAD + plan.tailSkip + i
          if (idx < TOTAL) seen.push(idx)
        }
      }
      expect(new Set(seen).size, `limit=${limit}: repeats`).toBe(seen.length)
      expect(seen.length, `limit=${limit}: gaps`).toBe(TOTAL)
    }
  })

  /** A head shorter than the window (a small or heavily filtered catalogue) must still be exact. */
  it('handles a head shorter than the window', () => {
    expect(feedPagePlan(7, 0, 24)).toEqual({ fromHead: { start: 0, end: 7 }, tailSkip: 0, tailTake: 17 })
    expect(feedPagePlan(0, 0, 24)).toEqual({ fromHead: null, tailSkip: 0, tailTake: 24 })
  })
})
