import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `recordPublishOutcome` had NO test at all until 2026-08-22, which is how it shipped calling
 * $queryRaw on a `returns void` function and threw on every single publish attempt for weeks.
 * The whole file's 18 existing tests passed throughout — they cover `publishOutcome`, the pure
 * mapper, and never touch the database boundary. A green suite said nothing about the one line
 * that was broken.
 *
 * ⛔ THESE ASSERT WHICH RAW API IS USED, NOT JUST "IT DID NOT THROW". Swapping $executeRaw back
 * to $queryRaw must FAIL here — otherwise the fix silently regresses and the only symptom is
 * prisma:error in a container log nobody reads.
 */
const executeRaw = vi.fn()
const queryRaw = vi.fn()
vi.mock('@/lib/db', () => ({
  db: {
    $executeRaw: (...a: unknown[]) => executeRaw(...a),
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
  },
}))
vi.mock('server-only', () => ({}))

import { recordPublishOutcome, MAX_OUTCOME_LEN } from './publish-funnel'

beforeEach(() => { executeRaw.mockReset(); queryRaw.mockReset(); executeRaw.mockResolvedValue(1) })

describe('recordPublishOutcome', () => {
  it('⛔ USES $executeRaw — `publish_log` RETURNS void AND $queryRaw CANNOT DESERIALIZE IT', async () => {
    await recordPublishOutcome('published')
    expect(executeRaw).toHaveBeenCalledTimes(1)
    // The precise regression: Postgres `void` has no Prisma type, so $queryRaw always threw
    // "Failed to deserialize column of type 'void'". Same trap as kv_del in ratelimit.ts.
    expect(queryRaw).not.toHaveBeenCalled()
  })

  it('passes the outcome as a BOUND PARAMETER, never interpolated into the SQL', async () => {
    // A tagged template keeps the value out of the statement text. If someone rewrites this as
    // a string concatenation, an outcome code becomes an injection point into a SECURITY
    // DEFINER function — `errorCode` is server-authored today, which is a convention, not a
    // guarantee the next caller inherits.
    await recordPublishOutcome("weird'code")
    const [strings, ...values] = executeRaw.mock.calls[0]
    expect(Array.isArray(strings)).toBe(true)
    expect(values).toContain("weird'code")
    expect((strings as string[]).join('')).not.toContain("weird'code")
  })

  it('truncates a long outcome to EXACTLY the cap, not merely under some number', async () => {
    // ⚠️ THIS ASSERTED `<= 64` AGAINST A CAP OF 40 AND SO PROVED NOTHING — it would have passed
    // with no truncation at all up to 64 characters, and passed just as happily if the value
    // were dropped entirely (length 0 is also <= 64). Two reviewers flagged the shape; the
    // magic number turned out to be wrong as well. Assert equality, against the real constant.
    await recordPublishOutcome('x'.repeat(500))
    const value = executeRaw.mock.calls[0][1] as string
    expect(value).toBe('x'.repeat(MAX_OUTCOME_LEN))
  })

  it('⚠️ SWALLOWS A BACKEND ERROR — instrumentation must never fail a publish', async () => {
    executeRaw.mockRejectedValue(new Error('db down'))
    await expect(recordPublishOutcome('published')).resolves.toBeUndefined()
  })

  it('does nothing at all for an empty outcome', async () => {
    await recordPublishOutcome('')
    expect(executeRaw).not.toHaveBeenCalled()
  })
})
