import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The nightly rank sweep (speed plan item 9). What these pin: live rows are re-scored in batches, each its own
 * statement (so a row lock lasts one batch, not the whole sweep — it was 58 s); only live rows; a failed batch does not
 * stop the others; and a failure reaches the cron instead of being swallowed into "0 re-scored".
 */
const h = vi.hoisted(() => ({
  ids: [] as string[],
  selects: [] as string[],
  updates: [] as { text: string; values: unknown[] }[],
  fail: null as Error | null,
  /** 0-based index of the one batch that fails; null ⇒ `fail` (if set) fails every batch. */
  failBatch: null as number | null,
}))

vi.mock('@/lib/db', () => ({
  db: {
    $queryRaw: vi.fn(async (sql: { text?: string; sql?: string }) => {
      h.selects.push(String(sql.text ?? sql.sql ?? ''))
      return h.ids.map((id) => ({ id }))
    }),
    $executeRaw: vi.fn(async (sql: { text?: string; sql?: string; values?: unknown[] }) => {
      const values = sql.values ?? []
      const batch = h.updates.length
      h.updates.push({ text: String(sql.text ?? sql.sql ?? ''), values })
      if (h.fail && (h.failBatch === null || h.failBatch === batch)) throw h.fail
      return values.length
    }),
  },
}))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))

const { recomputeRankScoreAllActive, SWEEP_BATCH } = await import('./ranking')

const flat = (s: string) => s.replace(/\s+/g, ' ')

describe('the nightly rank sweep', () => {
  beforeEach(() => {
    h.ids = []
    h.selects = []
    h.updates = []
    h.fail = null
    h.failBatch = null
  })

  it('re-scores the live rows 500 at a time — one statement per batch, every id exactly once', async () => {
    h.ids = Array.from({ length: 1234 }, (_, i) => `L${String(i).padStart(5, '0')}`)
    expect(SWEEP_BATCH).toBe(500)
    expect(await recomputeRankScoreAllActive()).toBe(1234)
    expect(h.updates.map((u) => u.values.length)).toEqual([500, 500, 234])
    expect(h.updates.flatMap((u) => u.values)).toEqual(h.ids)
  })

  it('reads only live ids, and writes only rows that are still live', async () => {
    h.ids = ['a', 'b']
    await recomputeRankScoreAllActive()
    expect(flat(h.selects[0])).toMatch(/SELECT "id" FROM "Listing" WHERE "verified" = true AND "status" = 'active'/)
    const sql = flat(h.updates[0].text)
    expect(sql).toMatch(/^UPDATE "Listing" SET "rankScore" = /)
    expect(sql).toMatch(/WHERE "id" IN \(.*\) AND "verified" = true AND "status" = 'active'$/)
  })

  it('a failed batch does not stop the later ones — then the sweep throws, naming how many failed', async () => {
    h.ids = Array.from({ length: 1200 }, (_, i) => `L${i}`)
    h.fail = new Error('deadlock detected')
    h.failBatch = 0
    const err = await recomputeRankScoreAllActive().then(() => null, (e: Error) => e)
    expect(h.updates).toHaveLength(3) // batches 2 and 3 still ran
    expect(err?.message).toBe('rank sweep: 1 of 3 batches failed (700 rows re-scored)')
    expect((err as Error & { cause?: unknown }).cause).toBe(h.fail)
  })

  it('no live rows: no UPDATE at all', async () => {
    expect(await recomputeRankScoreAllActive()).toBe(0)
    expect(h.updates).toHaveLength(0)
  })

  it('a failure reaches the caller — the cron logs it; never swallowed into 0', async () => {
    h.ids = ['a']
    h.fail = new Error('deadlock detected')
    await expect(recomputeRankScoreAllActive()).rejects.toThrow('rank sweep: 1 of 1 batches failed (0 rows re-scored)')
  })
})
