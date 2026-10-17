import { describe, expect, it, vi } from 'vitest'

/**
 * The nightly ListingDailyStat rollup (speed plan item 9): a failure reaches the cron, which logs it — it used to be
 * swallowed into "0 rows", so a missing day in the partner analytics series left no trace in any log.
 */
const h = vi.hoisted(() => ({ fail: null as Error | null }))

vi.mock('@/lib/db', () => ({
  db: {
    $executeRaw: vi.fn(async () => {
      if (h.fail) throw h.fail
      return 2122
    }),
  },
}))

const { rollupListingDailyStats } = await import('./listing-analytics')

describe('rollupListingDailyStats', () => {
  it('returns the rows it wrote', async () => {
    h.fail = null
    expect(await rollupListingDailyStats()).toBe(2122)
  })

  it('a failure reaches the caller instead of reading as "0 rows"', async () => {
    h.fail = new Error('canceling statement due to statement timeout')
    await expect(rollupListingDailyStats()).rejects.toThrow('statement timeout')
  })
})
