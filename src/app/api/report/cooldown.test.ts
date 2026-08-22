import { describe, it, expect } from 'vitest'
import { refileSuppressed, REFILE_COOLDOWN_MS, REFILE_COOLDOWN_STATUSES } from './route'

/**
 * ⛔ IMPORTS THE REAL PREDICATE. The first version of this file re-implemented the
 * branch by hand, so it pinned a copy: the window could change, or the status list
 * could be edited, and these tests would stay green against drifted code. Three
 * reviewers made the same point. `refileSuppressed` is exported for exactly this.
 */
const NOW = new Date('2026-08-22T12:00:00Z').getTime()
const ago = (ms: number) => new Date(NOW - ms)
const row = (resolvedAt: Date | null, createdAt = ago(999_000)) => ({ resolvedAt, createdAt })

describe('report refile cooldown', () => {
  it('⛔ SUPPRESSES A REFILE AFTER A DISMISSAL — the harassment loop', () => {
    // Withdrawing sets status:'dismissed' + resolvedAt (api/disputes/[id]/withdraw),
    // so withdraw-refile-repeat lands here. Every refile used to fire a fresh bell and
    // push at the respondent because the dedupe only matched status:'open'.
    expect(refileSuppressed([row(ago(60_000))], NOW)).toBe(true)
  })

  it('⛔ TAKES THE LATEST SETTLED TIME, NOT THE NEWEST ROW', () => {
    // The bug all three reviewers found: ordering by createdAt while measuring
    // resolvedAt. Here the NEWEST-created row settled long ago and an older row
    // settled a minute ago — the cooldown must still apply.
    const rows = [
      { createdAt: ago(60_000), resolvedAt: ago(COOLED) },      // newest, long settled
      { createdAt: ago(3 * COOLED), resolvedAt: ago(60_000) },  // older, just settled
    ]
    expect(refileSuppressed(rows, NOW)).toBe(true)
  })

  it('lets a genuine second incident through once the window passes', () => {
    expect(refileSuppressed([row(ago(REFILE_COOLDOWN_MS + 1000))], NOW)).toBe(false)
  })

  it('⚠️ FALLS BACK TO createdAt when resolvedAt is null, and that is CONSERVATIVE', () => {
    // Rows predating resolvedAt. createdAt is never later than resolution, so the
    // window it produces can only be SHORTER — it can let a refile through early,
    // never suppress a legitimate one for longer than intended.
    expect(refileSuppressed([row(null, ago(60_000))], NOW)).toBe(true)
    expect(refileSuppressed([row(null, ago(REFILE_COOLDOWN_MS + 1000))], NOW)).toBe(false)
  })

  it('does nothing when the reporter has no rejected case on this surface', () => {
    expect(refileSuppressed([], NOW)).toBe(false)
  })

  it('the boundary is exclusive — exactly one window old no longer suppresses', () => {
    expect(refileSuppressed([row(ago(REFILE_COOLDOWN_MS))], NOW)).toBe(false)
  })

  it('⛔ CONFIRMED IS NOT A COOLDOWN STATUS — being right must not cost you', () => {
    // The query filters on these, so a confirmed report never reaches the predicate.
    // A reporter who was right must be able to report the same surface again, and a
    // repeat offender is exactly the pattern the admin queue needs to see.
    expect([...REFILE_COOLDOWN_STATUSES]).toEqual(['dismissed', 'abusive'])
    expect([...REFILE_COOLDOWN_STATUSES]).not.toContain('confirmed')
  })
})

const COOLED = REFILE_COOLDOWN_MS + 5 * 60 * 1000
