import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE DURABLE HALF OF ERASURE — the writers (2026-09-05 review: S02/S04/S05 "shared durable cleanup
 * foundation"). Under test: a tombstone is written with a grace hour and never duplicated; a repeat
 * write for the same object REFRESHES its clock and reason (a leftover from a failed attempt must
 * not give a fresh upload zero grace); blanks are ignored; clearing removes exactly the settled
 * objects. The sweep has its own test (storage-tombstones-sweep.svc.test.ts).
 */
type Row = { id: string; bucket: string; path: string; reason: string; createdAt: Date; notBefore: Date; attempts: number; lastError: string | null }
const h = vi.hoisted(() => ({ rows: [] as Row[], seq: 0 }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({
  db: {
    $executeRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      // The one upsert: values arrive flattened as (bucket, path, reason, notBefore) per row (the id is raw SQL).
      const flat = values.flatMap((v) => (v && typeof v === 'object' && 'values' in (v as object) ? (v as { values: unknown[] }).values : [v]))
      let affected = 0
      for (let i = 0; i + 3 < flat.length; i += 4) {
        const [bucket, path, reason, notBefore] = flat.slice(i, i + 4) as [string, string, string, Date]
        const existing = h.rows.find((r) => r.bucket === bucket && r.path === path)
        if (existing) { existing.reason = reason; existing.notBefore = notBefore; existing.lastError = null; existing.attempts = 0 }
        else h.rows.push({ id: `t${++h.seq}`, bucket, path, reason, notBefore, createdAt: new Date(), attempts: 0, lastError: null })
        affected++
      }
      return affected
    },
    storageTombstone: {
      createMany: async () => { throw new Error('the writer must not use createMany — one upsert statement, see writeTombstones') },
      updateMany: async ({ where, data }: { where: { OR: Array<{ bucket: string; path: string }> }; data: { reason: string; notBefore: Date } }) => {
        const rows = h.rows.filter((r) => where.OR.some((o) => o.bucket === r.bucket && o.path === r.path))
        for (const r of rows) { r.reason = data.reason; r.notBefore = data.notBefore }
        return { count: rows.length }
      },
      deleteMany: async ({ where }: { where: { OR: Array<{ bucket: string; path: string }> } }) => {
        const before = h.rows.length
        h.rows = h.rows.filter((r) => !where.OR.some((o) => o.bucket === r.bucket && o.path === r.path))
        return { count: before - h.rows.length }
      },
    },
  },
}))

const { writeTombstones, clearTombstones, TOMBSTONE_GRACE_MS } = await import('./storage-tombstones')
const { db } = await import('@/lib/db')
const t0 = new Date('2026-09-05T08:00:00.000Z')
const later = new Date(t0.getTime() + TOMBSTONE_GRACE_MS + 1)

beforeEach(() => { h.rows = [] })

describe('storage tombstones — the writers', () => {
  it('writes each object once, with a grace hour, and ignores blanks', async () => {
    const n = await writeTombstones(db, [
      { bucket: 'listings', path: 'a.webp' }, { bucket: 'listings', path: 'a.webp' }, { bucket: '', path: 'x' }, { bucket: 'listings', path: '' },
    ], 'account_deleted', t0)
    expect(n).toBe(1)
    expect(h.rows[0]).toMatchObject({ bucket: 'listings', path: 'a.webp', reason: 'account_deleted', notBefore: new Date(t0.getTime() + TOMBSTONE_GRACE_MS) })
  })

  it('a second write for the same object creates no second row but REFRESHES the clock and the reason (one upsert statement)', async () => {
    await writeTombstones(db, [{ bucket: 'listings', path: 'a.webp' }], 'account_deleted', t0)
    expect(await writeTombstones(db, [{ bucket: 'listings', path: 'a.webp' }], 'visa_upload_intent', later)).toBe(1)
    expect(h.rows).toHaveLength(1)
    expect(h.rows[0]).toMatchObject({ reason: 'visa_upload_intent', notBefore: new Date(later.getTime() + TOMBSTONE_GRACE_MS) })
  })

  it('clearTombstones removes exactly the settled objects', async () => {
    await writeTombstones(db, [{ bucket: 'listings', path: 'a.webp' }, { bucket: 'listings', path: 'b.webp' }, { bucket: 'listing-videos', path: 'a.webp' }], 'account_deleted', t0)
    expect(await clearTombstones([{ bucket: 'listings', path: 'a.webp' }, { bucket: 'listings', path: 'nope.webp' }])).toBe(1)
    expect(h.rows.map((r) => `${r.bucket}/${r.path}`)).toEqual(['listings/b.webp', 'listing-videos/a.webp'])
  })
})
