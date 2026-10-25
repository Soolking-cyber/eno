import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── indexAndCheckProvenance — a REMOVAL THAT LANDS DURING THE HASH QUERIES IS NEVER UN-REMOVED (2026-10-01) ─
//
// Same race as ai-moderation.test.ts: the function reads the listing (status 'active'), runs one ANN
// query per photo plus the re-index writes, and only then hides it + files a "stolen photos" report +
// notifies the seller. A tombstone (status 'removed' — src/lib/listing-removed.ts) committed in between
// must not be turned back into the seller's 'hidden'. The hide carries `status <> 'removed'` in its own
// WHERE; zero rows → P2025 → the whole array transaction rolls back.

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  row: null as Row | null,
  /** Run during the hash queries — the race. */
  duringQueries: null as null | (() => void),
  reports: [] as Row[],
  notifications: [] as Row[],
  updates: [] as Row[],
  refreshed: [] as string[][],
  /** The options each refreshListingSurfaces call carried (`home`, `teachers`). */
  refreshOpts: [] as Row[],
  /** Every listing read's arguments. */
  reads: [] as Row[],
}))

function matches(row: Row | null, where: Row): boolean {
  if (!row || row.id !== where.id) return false
  const not = where.status?.not
  return not === undefined || row.status !== not
}

vi.mock('@/lib/db', () => {
  const op = (run: () => unknown) => ({ run })
  return {
    db: {
      listing: {
        findUnique: async (a: Row) => { h.reads.push(a); return h.row ? { ...h.row, seller: { ownerId: 'owner-1' } } : null },
        update: (a: Row) => op(() => {
          h.updates.push(a)
          if (!matches(h.row, a.where)) throw Object.assign(new Error('No record was found for an update.'), { code: 'P2025' })
          return { ...a.data }
        }),
      },
      report: { create: (a: Row) => op(() => a.data) },
      notification: { create: (a: Row) => op(() => a.data) },
      // Every one of my photos matches the same other-seller listing → a strict-majority match.
      $queryRaw: async () => { h.duringQueries?.(); return [{ listingId: 'ORIGINAL' }] },
      $executeRaw: async () => 0,
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
vi.mock('@/generated/prisma/client', () => ({ Prisma: { sql: (...a: unknown[]) => a, join: (a: unknown[]) => a } }))
vi.mock('@/lib/image-hash', () => ({ hashFromUrl: (u: string) => `hex:${u}`, hexToBits: (x: string) => x }))
vi.mock('@/lib/listing-surfaces', () => ({ refreshListingSurfaces: (ids: string[], _op: string, opts: Row) => { h.refreshed.push(ids); h.refreshOpts.push(opts) } }))

const { indexAndCheckProvenance } = await import('./image-provenance')

beforeEach(() => {
  h.row = { id: 'COPY', images: JSON.stringify(['a.jpg', 'b.jpg', 'c.jpg']), status: 'active', sellerId: 's2', verified: true }
  h.duringQueries = null
  h.reports = []; h.notifications = []; h.updates = []; h.refreshed = []; h.refreshOpts = []; h.reads = []
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('indexAndCheckProvenance — the hold', () => {
  it('hides a listing reusing another seller\'s photos, with its report and notice, in one transaction', async () => {
    await indexAndCheckProvenance('COPY')
    expect(h.row).toMatchObject({ status: 'hidden', verified: false, identityHold: false })
    expect(h.reports).toHaveLength(1)
    // ⚠️ Filed against the seller, as /api/report files it — or confirming docked nobody (sweep, 2026-10-22).
    expect(h.reports[0]).toMatchObject({ listingId: 'COPY', targetSellerId: 's2', reason: 'stolen_photos' })
    expect(h.notifications).toHaveLength(1)
    expect(h.refreshed).toEqual([['COPY']])
  })

  // ⛔ /c/teachers' 6h-ISR HTML names every live teacher profile (its grid and the "More teachers" list — 2026-10-20): a
  // held profile leaves that page as it leaves the home page.
  it('a held TEACHER profile purges /c/teachers too — its type read with the row the check already reads', async () => {
    h.row!.listingType = 'teacher'
    await indexAndCheckProvenance('COPY')
    expect(h.refreshOpts).toEqual([{ home: true, teachers: true }])
    expect(h.reads[0].select).toMatchObject({ listingType: true })
  })

  it('a held listing of any other kind purges no /c/teachers', async () => {
    h.row!.listingType = 'sell'
    await indexAndCheckProvenance('COPY')
    expect(h.refreshOpts).toEqual([{ home: true, teachers: false }])
  })

  it('⛔ the hide carries the tombstone guard in its OWN where (atomic with the write)', async () => {
    await indexAndCheckProvenance('COPY')
    expect(h.updates[0].where).toEqual({ id: 'COPY', status: { not: 'removed' } })
  })
})

describe('⛔ a removal that commits DURING the hash queries is never overwritten', () => {
  it('the tombstone stays removed, and no report or notice is left behind', async () => {
    h.duringQueries = () => { Object.assign(h.row!, { status: 'removed', verified: false, identityHold: false, featured: false }) }
    await indexAndCheckProvenance('COPY')
    expect(h.row!.status).toBe('removed')
    expect(h.reports).toHaveLength(0)
    expect(h.notifications).toHaveLength(0)
    expect(h.refreshed).toHaveLength(0)
    expect(console.error).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('removed during the check'))
  })

  it('a row already removed before the read is skipped without a single hash query', async () => {
    h.row!.status = 'removed'
    const q = vi.fn()
    h.duringQueries = q
    await indexAndCheckProvenance('COPY')
    expect(q).not.toHaveBeenCalled()
    expect(h.updates).toHaveLength(0)
  })
})
