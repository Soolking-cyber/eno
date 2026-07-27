import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The saved-trip cap, and the read the picker renders.
 *
 * ⚠️ THE PROPERTY THAT MATTERS is that ONE number and ONE query serve BOTH create paths. A cap
 * enforced at POST /api/itineraries but not at POST /api/itineraries/generate is not a cap — the
 * second path just writes the fourth row. These tests pin the arithmetic; the routes are what call
 * it, and each carries a comment saying so.
 */

const h = vi.hoisted(() => ({
  rows: [] as { id: string; title: string; destinationId: string; days: number; updatedAt: Date }[],
  countCalls: [] as unknown[],
  findManyCalls: [] as unknown[],
}))

vi.mock('./db', () => ({
  db: {
    itinerary: {
      count: async (args: unknown) => {
        h.countCalls.push(args)
        return h.rows.length
      },
      findMany: async (args: { take?: number }) => {
        h.findManyCalls.push(args)
        return h.rows.slice(0, args.take ?? h.rows.length)
      },
    },
  },
}))

const { MAX_SAVED_ITINERARIES, itineraryQuota, listItineraryDrafts } = await import('./itinerary-drafts')

const row = (id: string, days = 5) => ({
  id,
  title: `Trip ${id}`,
  destinationId: 'hcmc',
  days,
  updatedAt: new Date('2026-07-27T00:00:00Z'),
})

beforeEach(() => {
  h.rows = []
  h.countCalls = []
  h.findManyCalls = []
})

describe('the cap is three, and it is reached rather than exceeded', () => {
  it('is 3 — the number the product promises', () => {
    expect(MAX_SAVED_ITINERARIES).toBe(3)
  })

  it.each([
    [0, 3, false],
    [1, 2, false],
    [2, 1, false],
    [3, 0, true],
  ])('with %i saved: %i remaining, full=%s', async (saved, remaining, full) => {
    h.rows = Array.from({ length: saved }, (_, i) => row(`i${i}`))
    const quota = await itineraryQuota('p1')
    expect(quota.used).toBe(saved)
    expect(quota.remaining).toBe(remaining)
    expect(quota.full).toBe(full)
  })

  it('never reports NEGATIVE remaining, even if a row slipped past the cap', async () => {
    // Both create paths check before writing, and neither holds a lock, so two simultaneous saves
    // can overshoot by one — the same accepted soft race the visa ceiling documents. The arithmetic
    // must not then produce "-1 remaining" in the picker.
    h.rows = Array.from({ length: 5 }, (_, i) => row(`i${i}`))
    const quota = await itineraryQuota('p1')
    expect(quota.remaining).toBe(0)
    expect(quota.full).toBe(true)
  })

  it('counts THIS profile only, and EXCLUDES archived rows', async () => {
    await itineraryQuota('profile-abc')
    expect(h.countCalls).toEqual([{ where: { profileId: 'profile-abc', status: { not: 'archived' } } }])
  })
})

/**
 * ⚠️ DELETE IS A SOFT DELETE, AND THE ORIGINAL VERSION OF THIS FILE DID NOT KNOW THAT.
 *
 * `DELETE /api/itineraries/[id]` sets `status = 'archived'` (route.ts:33); it removes nothing. Every
 * other read in the feature filters `status: { not: 'archived' }` — the list, the single GET, the
 * docx export — and the quota was the ONE query that did not, so an archived trip went on occupying
 * a slot forever. With a cap of 3, a traveller who deleted three trips could never save another and
 * nothing on screen would explain why.
 *
 * ⚠️ THE TEST THAT USED TO LIVE HERE PASSED THROUGHOUT, and that is the lesson. It asserted that the
 * quota falls when a row "disappears" — by mutating the mock's array. Rows never disappear under a
 * soft delete, so it exercised a path production cannot reach while the real one stayed broken. A
 * test that models the wrong world is worse than no test: it reports safety. These assert the QUERY,
 * which is the thing that was actually wrong.
 */
describe('deleting frees a slot — but only because archived rows are excluded', () => {
  it('asks the database to exclude archived rows when counting', async () => {
    await itineraryQuota('p1')
    expect(h.countCalls[0]).toMatchObject({ where: { status: { not: 'archived' } } })
  })

  it('excludes archived rows from the picker too, so a deleted trip cannot be reopened', async () => {
    await listItineraryDrafts('p1')
    expect(h.findManyCalls[0]).toMatchObject({ where: { status: { not: 'archived' } } })
  })

  it('still frees the slot arithmetically once the row stops being counted', async () => {
    h.rows = [row('a'), row('b'), row('c')]
    expect((await itineraryQuota('p1')).full).toBe(true)
    // The archived row is gone from the COUNT (the query excludes it), which is what the filter buys.
    h.rows = [row('a'), row('b')]
    const after = await itineraryQuota('p1')
    expect(after.full).toBe(false)
    expect(after.remaining).toBe(1)
  })
})

describe('the drafts read', () => {
  it('returns the counts alongside the list, so the picker does not derive them', async () => {
    h.rows = [row('a'), row('b')]
    const out = await listItineraryDrafts('p1')
    expect(out.used).toBe(2)
    expect(out.limit).toBe(3)
    expect(out.remaining).toBe(1)
    expect(out.drafts.map((d) => d.id)).toEqual(['a', 'b'])
  })

  it('summarises without leaking trip CONTENT — destination and length only', async () => {
    h.rows = [row('a', 5)]
    const [draft] = (await listItineraryDrafts('p1')).drafts
    expect(draft.summary).toBe('hcmc · 5 days')
    expect(draft.updatedAt).toBe('2026-07-27T00:00:00.000Z')
  })

  it('says "1 day", not "1 days"', async () => {
    h.rows = [row('a', 1)]
    const [draft] = (await listItineraryDrafts('p1')).drafts
    expect(draft.summary).toBe('hcmc · 1 day')
  })

  it('stays bounded — cap + 1, never the whole table', async () => {
    // ⚠️ THIS ASSERTION USED TO SAY `MAX_SAVED_ITINERARIES`, and that was the bug: capping the
    // picker at exactly the limit hid the very row an over-cap traveller had to delete to recover.
    // The bound still matters (this is a picker, not a paginated list) — it is just one higher, so
    // an overshoot is visible instead of invisible.
    h.rows = Array.from({ length: 9 }, (_, i) => row(`i${i}`))
    expect((await listItineraryDrafts('p1')).drafts).toHaveLength(MAX_SAVED_ITINERARIES + 1)
  })
})

/**
 * ⚠️ FOUND BY EXTERNAL REVIEW (agy, 2026-07-27) AFTER THE ARCHIVED-FILTER FIX HAD ALREADY SHIPPED.
 *
 * The picker used to `take: MAX_SAVED_ITINERARIES`, justified as "a traveller cannot have more".
 * They can: this file's own quota notes record that neither create path holds a lock, so two
 * simultaneous saves overshoot by one. At 4 trips the quota reports full — correctly — and the
 * traveller is locked out of creating; but a picker capped at 3 hid the fourth row, so the ONE trip
 * they had to delete in order to recover was the one they could not see. A permanent lockout with
 * nothing on screen to explain it.
 */
describe('an over-cap trip stays VISIBLE, or the lockout it causes cannot be undone', () => {
  it('asks for one MORE row than the cap', async () => {
    await listItineraryDrafts('p1')
    expect(h.findManyCalls[0]).toMatchObject({ take: MAX_SAVED_ITINERARIES + 1 })
  })

  it('returns the 4th trip when a race overshot the cap, so it can be deleted', async () => {
    h.rows = Array.from({ length: 4 }, (_, i) => row(`i${i}`))
    const res = await listItineraryDrafts('p1')
    expect(res.drafts).toHaveLength(4)
    expect(res.used).toBe(4)
    expect(res.remaining).toBe(0)
  })
})
