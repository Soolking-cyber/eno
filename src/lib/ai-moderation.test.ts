import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── moderateListingById — a REMOVAL THAT LANDS DURING THE CLASSIFY CALL IS NEVER UN-REMOVED (2026-10-01) ─
//
// The function reads the listing (status 'active'), makes a slow Gemini call, then hides it + files an
// admin report + notifies the seller in ONE array transaction. A seller delete, a moderator's "Remove
// listing" or the admin console's bulk remove committing in that window writes the tombstone (status
// 'removed' — src/lib/listing-removed.ts). An unguarded `update({ where: { id } })` turned it back into
// the seller's 'hidden' (relistable, back in "My listings") with an open AI report. The hide now carries
// `status <> 'removed'` in its own WHERE; zero rows → P2025 → the whole transaction rolls back.
//
// The fake db models Prisma's semantics on one row: lazy operations, the array transaction all-or-nothing,
// and `update` with a non-unique filter throwing P2025 when the row no longer matches.

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  /** The one Listing row the database holds. */
  row: null as Row | null,
  /** Run inside the classify call — the race: something commits while Gemini is thinking. */
  duringClassify: null as null | (() => void),
  verdict: { prohibited: true, category: 'weapons', confidence: 0.95, reason: 'a firearm' } as Row,
  reports: [] as Row[],
  notifications: [] as Row[],
  updates: [] as Row[],
  refreshed: [] as string[][],
  /** Make the report insert fail with an ordinary (non-P2025) error. */
  reportFails: false,
}))

function matches(row: Row | null, where: Row): boolean {
  if (!row || row.id !== where.id) return false
  const not = where.status?.not
  return not === undefined || row.status !== not
}

vi.mock('@/lib/db', () => {
  // Lazy like a PrismaPromise: nothing happens until the transaction runs it.
  const op = (run: () => unknown) => ({ run })
  return {
    db: {
      listing: {
        findUnique: async () => (h.row ? { ...h.row, seller: { trustTier: 'standard', ownerId: 'owner-1' } } : null),
        update: (a: Row) => op(() => {
          h.updates.push(a)
          if (!matches(h.row, a.where)) throw Object.assign(new Error('No record was found for an update.'), { code: 'P2025' })
          return { ...a.data }
        }),
      },
      report: { create: (a: Row) => op(() => { if (h.reportFails) throw new Error('connection reset'); return a.data }) },
      notification: { create: (a: Row) => op(() => a.data) },
      // The ARRAY form: run every op; commit only if none threw.
      $transaction: async (ops: Array<{ run: () => unknown }>) => {
        const results = ops.map((o) => o.run())
        const [listing, report, notification] = results as Row[]
        Object.assign(h.row!, listing)
        h.reports.push(report)
        if (notification) h.notifications.push(notification)
        return results
      },
    },
  }
})
vi.mock('@/generated/prisma/client', () => ({ Prisma: {} }))
vi.mock('@/lib/gemini', () => ({
  GEMINI_MODEL: 'test-model',
  getGemini: () => ({
    models: {
      generateContent: async () => {
        h.duringClassify?.()
        return { text: JSON.stringify(h.verdict) }
      },
    },
  }),
}))
vi.mock('@/lib/sharp-lazy', () => ({ getSharp: async () => { throw new Error('no images in these tests') } }))
vi.mock('@/lib/ssrf', () => ({ safeFetch: async () => { throw new Error('no images in these tests') } }))
vi.mock('@/lib/listing-surfaces', () => ({ refreshListingSurfaces: (ids: string[]) => { h.refreshed.push(ids) } }))

const { moderateListingById } = await import('./ai-moderation')

beforeEach(() => {
  h.row = { id: 'L1', title: 'Pistol', description: 'real one', images: '[]', status: 'active', verified: true, identityHold: false }
  h.duringClassify = null
  h.reports = []; h.notifications = []; h.updates = []; h.refreshed = []; h.reportFails = false
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('moderateListingById — the hold', () => {
  it('hides a live prohibited listing, files the report and tells the seller, in one transaction', async () => {
    await moderateListingById('L1')
    expect(h.row).toMatchObject({ status: 'hidden', verified: false, identityHold: false })
    expect(h.reports).toHaveLength(1)
    expect(h.notifications).toHaveLength(1)
    expect(h.refreshed).toEqual([['L1']])
  })

  it('⛔ the hide carries the tombstone guard in its OWN where (atomic with the write)', async () => {
    await moderateListingById('L1')
    expect(h.updates[0].where).toEqual({ id: 'L1', status: { not: 'removed' } })
  })

  it('a row the seller HID meanwhile is still held (only the tombstone is refused)', async () => {
    h.duringClassify = () => { h.row!.status = 'hidden' }
    await moderateListingById('L1')
    expect(h.row).toMatchObject({ status: 'hidden', verified: false })
    expect(h.reports).toHaveLength(1)
  })
})

describe('⛔ a removal that commits DURING the classify call is never overwritten', () => {
  it.each([
    ['seller delete', { status: 'removed', verified: false, identityHold: false, featured: false }],
    ['moderator reject / admin bulk remove', { status: 'removed', verified: false, identityHold: false, featured: false }],
  ])('%s: the tombstone stays removed, and no report or notice is left behind', async (_who, tombstone) => {
    h.duringClassify = () => { Object.assign(h.row!, tombstone) }
    await moderateListingById('L1')
    expect(h.row!.status).toBe('removed')
    expect(h.reports).toHaveLength(0)
    expect(h.notifications).toHaveLength(0)
    expect(h.refreshed).toHaveLength(0)
    // Logged as a skip, not as a failure.
    expect(console.error).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('removed during the check'))
  })

  it('a row already removed before the read is skipped without a classify call', async () => {
    h.row!.status = 'removed'
    const classify = vi.fn()
    h.duringClassify = classify
    await moderateListingById('L1')
    expect(classify).not.toHaveBeenCalled()
    expect(h.updates).toHaveLength(0)
  })

  it('a row erased outright during the call (account erasure) is the same skip', async () => {
    h.duringClassify = () => { h.row = null }
    await expect(moderateListingById('L1')).resolves.toBeUndefined()
    expect(h.reports).toHaveLength(0)
    expect(console.error).not.toHaveBeenCalled()
  })

  it('a non-P2025 failure is still logged as a failure, rolls the hide back, and is never rethrown', async () => {
    h.reportFails = true
    await expect(moderateListingById('L1')).resolves.toBeUndefined()
    expect(h.row!.status).toBe('active')
    expect(console.error).toHaveBeenCalled()
  })
})
