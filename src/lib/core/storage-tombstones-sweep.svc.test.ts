import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE TOMBSTONE SWEEP (services edition). Invariants: (1) it DELETES only what nothing references,
 * DROPS what is referenced, and KEEPS + counts what it could not settle, with attempts/lastError on
 * the row; (2) a failing row backs off in DAYS (1, 2, 4 …) so 200 permanent failures cannot starve
 * the queue under a daily timer; (3) nothing younger than its grace is touched; (4) a row whose
 * clock was refreshed after it was read is NOT judged (the claim fails) and is left for the next
 * run — the race a writer can create mid-batch; (5) it drains more than one batch per run.
 */
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co')

type Row = { id: string; bucket: string; path: string; reason: string; createdAt: Date; notBefore: Date; attempts: number; lastError: string | null }
const h = vi.hoisted(() => ({
  rows: [] as Row[],
  removed: [] as Array<{ bucket: string; paths: string[] }>,
  removeError: null as string | null,
  listingImages: [] as string[],
  visaPaths: [] as string[],
  visaQueryError: false,
  /** Paths a live SellerVerification case still lists in its `documents`. */
  verificationPaths: [] as string[],
  /** Paths a live IdentityVerification still names in its evidence. */
  identityPaths: [] as string[],
  /** Make both business-verification reference reads throw — the "unknown, never delete" case. */
  verificationQueryError: false,
  seq: 0,
  /** A hook run on every storage remove — lets a test refresh a row mid-batch like a concurrent writer would. */
  onRemove: null as null | ((bucket: string, paths: string[]) => void),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/visa/storage', () => ({ VISA_BUCKET: 'visa-documents' }))
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
      findMany: async ({ where, take }: { where: { notBefore: { lt: Date } }; take: number }) =>
        [...h.rows].filter((r) => r.notBefore < where.notBefore.lt).sort((a, b) => +a.notBefore - +b.notBefore).slice(0, take).map((r) => ({ ...r })),
      createMany: async () => { throw new Error('the writer must not use createMany — one upsert statement, see writeTombstones') },
      // the claim, the back-off and the writers' refresh all go through updateMany, each with its own where
      updateMany: async ({ where, data }: { where: { id?: string; notBefore?: Date; OR?: Array<{ bucket: string; path: string }> }; data: { attempts?: { increment: number }; lastError?: string; notBefore?: Date; reason?: string } }) => {
        const rows = h.rows.filter((r) =>
          (where.id ? r.id === where.id : true) &&
          (where.notBefore ? +r.notBefore === +where.notBefore : true) &&
          (where.OR ? where.OR.some((o) => o.bucket === r.bucket && o.path === r.path) : true))
        for (const r of rows) {
          if (data.attempts) r.attempts += data.attempts.increment
          if (data.lastError !== undefined) r.lastError = data.lastError
          if (data.notBefore) r.notBefore = data.notBefore
          if (data.reason) r.reason = data.reason
        }
        return { count: rows.length }
      },
      deleteMany: async ({ where }: { where: { id: string; notBefore?: Date } }) => {
        const before = h.rows.length
        h.rows = h.rows.filter((r) => !(r.id === where.id && (where.notBefore ? +r.notBefore === +where.notBefore : true)))
        return { count: before - h.rows.length }
      },
      count: async ({ where }: { where?: { notBefore: { lt: Date } } } = {}) =>
        where ? h.rows.filter((r) => r.notBefore < where.notBefore.lt).length : h.rows.length,
    },
    listing: { count: async ({ where }: { where: { images?: { contains: string } } }) => where.images ? h.listingImages.filter((u) => u.includes(where.images!.contains)).length : 0 },
    sellerVerification: {
      findFirst: async ({ where }: { where: { documents: { array_contains: Array<{ path: string }> } } }) => {
        if (h.verificationQueryError) throw new Error('db down')
        const path = where.documents.array_contains[0].path
        return h.verificationPaths.includes(path) ? { id: 'case-1' } : null
      },
    },
    identityVerification: {
      findFirst: async ({ where }: { where: { OR: Array<{ evidence: { path: string[]; equals: string } }> } }) => {
        if (h.verificationQueryError) throw new Error('db down')
        const path = where.OR[0].evidence.equals
        return h.identityPaths.includes(path) ? { id: 'iv-1' } : null
      },
    },
    seller: { count: async () => 0 },
    profile: { count: async () => 0 },
  },
}))
vi.mock('@/lib/supabase-admin', () => ({
  LISTINGS_BUCKET: 'listings', LISTING_VIDEOS_BUCKET: 'listing-videos', BUSINESS_VERIFICATION_BUCKET: 'business-verification', EVIDENCE_BUCKET: 'evidence',
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      select: () => ({ eq: (_c: string, path: string) => ({ limit: async () =>
        h.visaQueryError ? { data: null, error: { message: 'down' } } : { data: table === 'visa_documents' && h.visaPaths.includes(path) ? [{ id: 'd' }] : [], error: null } }) }),
    }),
    storage: { from: (bucket: string) => ({ remove: async (paths: string[]) => {
      h.onRemove?.(bucket, paths)
      if (h.removeError) return { data: null, error: { message: h.removeError } }
      h.removed.push({ bucket, paths }); return { data: paths.map((name) => ({ name })), error: null }
    } }) },
  }),
}))

const { writeTombstones, TOMBSTONE_GRACE_MS } = await import('./storage-tombstones')
const { sweepTombstones } = await import('./storage-tombstones-sweep.svc')
const { db } = await import('@/lib/db')
const DAY = 24 * 60 * 60 * 1000
const t0 = new Date('2026-09-05T08:00:00.000Z')
const later = new Date(t0.getTime() + TOMBSTONE_GRACE_MS + 1)
const P = 'https://proj.supabase.co/storage/v1/object/public/listings/'

beforeEach(() => { h.rows = []; h.removed = []; h.removeError = null; h.listingImages = []; h.visaPaths = []; h.visaQueryError = false; h.onRemove = null; h.verificationPaths = []; h.identityPaths = []; h.verificationQueryError = false })

describe('the tombstone sweep', () => {
  it('touches nothing younger than its grace', async () => {
    await writeTombstones(db, [{ bucket: 'listings', path: 'fresh.webp' }], 'account_deleted', t0)
    const r = await sweepTombstones(new Date(t0.getTime() + 60_000))
    expect(r).toEqual({ removed: 0, dropped: 0, failed: 0, skipped: 0, remaining: 0, queued: 1 })
    expect(h.removed).toEqual([]); expect(h.rows).toHaveLength(1)
  })

  it('public bucket: deletes an unreferenced object, DROPS the tombstone of one another row still uses', async () => {
    await writeTombstones(db, [{ bucket: 'listings', path: 'mine.webp' }, { bucket: 'listings', path: 'shared.webp' }], 'account_deleted', t0)
    h.listingImages = [`${P}shared.webp`]
    const r = await sweepTombstones(later)
    expect(h.removed).toEqual([{ bucket: 'listings', paths: ['mine.webp'] }])
    expect(r).toEqual({ removed: 1, dropped: 1, failed: 0, skipped: 0, remaining: 0, queued: 0 })
    expect(h.rows).toEqual([])
  })

  it('visa bucket: a committed upload (row exists) is dropped; a replaced or deleted document (no row) is removed', async () => {
    await writeTombstones(db, [{ bucket: 'visa-documents', path: 'u1/app/passport.jpg' }, { bucket: 'visa-documents', path: 'u1/app/old-passport.jpg' }], 'visa_upload_intent', t0)
    h.visaPaths = ['u1/app/passport.jpg']
    const r = await sweepTombstones(later)
    expect(h.removed).toEqual([{ bucket: 'visa-documents', paths: ['u1/app/old-passport.jpg'] }])
    expect(r).toMatchObject({ removed: 1, dropped: 1, failed: 0 })
  })

  it('private business-verification bucket: an unreferenced object is removed', async () => {
    await writeTombstones(db, [{ bucket: 'business-verification', path: 'p1/identity/selfie-x.jpg' }], 'account_deleted', t0)
    const r = await sweepTombstones(later)
    expect(h.removed).toEqual([{ bucket: 'business-verification', paths: ['p1/identity/selfie-x.jpg'] }])
    expect(r.removed).toBe(1)
  })

  /**
   * ⛔ THIS BUCKET USED TO SKIP THE REFERENCE CHECK ENTIRELY — it returned "unreferenced" for every
   * path on the reasoning that only a decided account erasure ever wrote a tombstone here. That
   * stopped being true when a FAILED verification upload started tombstoning its own object: an
   * intent that skips the check is a delete-anything primitive aimed at the private bucket holding
   * identity documents. The three tests below are the contract that replaced the assumption.
   */
  it('drops a business-verification tombstone whose object a live case still lists', async () => {
    h.verificationPaths = ['p1/bank/statement.pdf']
    await writeTombstones(db, [{ bucket: 'business-verification', path: 'p1/bank/statement.pdf' }], 'verification_doc_orphaned', t0)
    const r = await sweepTombstones(later)
    expect(h.removed).toEqual([])
    expect(r).toMatchObject({ removed: 0, dropped: 1 })
  })

  it('drops one whose object is still an identity verification’s evidence', async () => {
    h.identityPaths = ['p1/identity/passport.jpg']
    await writeTombstones(db, [{ bucket: 'business-verification', path: 'p1/identity/passport.jpg' }], 'account_deleted', t0)
    const r = await sweepTombstones(later)
    expect(h.removed).toEqual([])
    expect(r).toMatchObject({ removed: 0, dropped: 1 })
  })

  it('keeps the row when the reference check itself fails — unknown never deletes', async () => {
    h.verificationQueryError = true
    await writeTombstones(db, [{ bucket: 'business-verification', path: 'p1/identity/passport.jpg' }], 'account_deleted', t0)
    const r = await sweepTombstones(later)
    expect(h.removed).toEqual([])
    expect(r).toMatchObject({ removed: 0, dropped: 0, failed: 1 })
  })

  it('a storage failure, a failed reference check and an unknown bucket all KEEP the row — counted, attempts/lastError set, backed off a DAY', async () => {
    await writeTombstones(db, [{ bucket: 'listings', path: 'a.webp' }, { bucket: 'visa-documents', path: 'v.jpg' }, { bucket: 'mystery', path: 'm' }], 'account_deleted', t0)
    h.removeError = 'storage unavailable'; h.visaQueryError = true
    const r = await sweepTombstones(later)
    // remaining counts what is still DUE; the three failures are backed off, but `queued` still shows them
    expect(r).toEqual({ removed: 0, dropped: 0, failed: 3, skipped: 0, remaining: 0, queued: 3 })
    expect(h.rows.map((x) => [x.attempts, x.lastError])).toEqual([
      [1, 'storage_remove_failed: storage unavailable'], [1, 'reference_check_failed'], [1, 'unknown_bucket'],
    ])
    for (const x of h.rows) expect(x.notBefore).toEqual(new Date(later.getTime() + DAY))
    // the blip clears: the same rows settle on a run after the back-off; the unknown bucket backs off two days now
    h.removeError = null; h.visaQueryError = false
    const again = await sweepTombstones(new Date(later.getTime() + DAY + 1))
    expect(again).toMatchObject({ removed: 2, failed: 1 })
    expect(h.rows[0].notBefore).toEqual(new Date(later.getTime() + DAY + 1 + 2 * DAY))
  })

  it('200 permanently failing rows cannot starve the queue: they back off, and the row behind them is reached the next day', async () => {
    await writeTombstones(db, Array.from({ length: 200 }, (_, i) => ({ bucket: 'mystery', path: `m${i}` })), 'account_deleted', t0)
    await writeTombstones(db, [{ bucket: 'business-verification', path: 'p1/identity/x.jpg' }], 'account_deleted', new Date(t0.getTime() + 1))
    const first = await sweepTombstones(new Date(later.getTime() + 10), 200)
    expect(first).toMatchObject({ failed: 200, removed: 1 }) // the drain reads a second batch in the same run
    const second = await sweepTombstones(new Date(later.getTime() + DAY - 1), 200)
    expect(second).toMatchObject({ failed: 0, removed: 0, queued: 200 }) // still backed off
  })

  it('a row whose clock was refreshed after it was read is NOT judged: the claim fails and it waits for the next run', async () => {
    await writeTombstones(db, [{ bucket: 'listings', path: 'first.webp' }, { bucket: 'listings', path: 'reused.webp' }], 'account_deleted', t0)
    // while the first row is being removed, a writer re-tombstones the second path with a fresh clock
    h.onRemove = (_b, paths) => { if (paths[0] === 'first.webp') void writeTombstones(db, [{ bucket: 'listings', path: 'reused.webp' }], 'visa_upload_intent', later) }
    const r = await sweepTombstones(later)
    expect(h.removed.map((x) => x.paths[0])).toEqual(['first.webp'])
    expect(r).toMatchObject({ removed: 1, skipped: 1, queued: 1 })
    expect(h.rows[0]).toMatchObject({ path: 'reused.webp', reason: 'visa_upload_intent', notBefore: new Date(later.getTime() + TOMBSTONE_GRACE_MS) })
  })

  it('drains more than one batch per run', async () => {
    await writeTombstones(db, Array.from({ length: 450 }, (_, i) => ({ bucket: 'business-verification', path: `p/${i}.jpg` })), 'account_deleted', t0)
    const r = await sweepTombstones(later, 200)
    expect(r).toMatchObject({ removed: 450, remaining: 0, queued: 0 })
  })
})
