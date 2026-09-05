import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE RETENTION SWEEP MUST NOT LOSE TRACK OF A DOCUMENT — the test for review S03 (2026-09-05).
 *
 * Before: `removeVerificationDocs` logged a storage error and returned normally, and the sweep
 * then cleared the row's `documents` anyway — so one object-store blip left business-registration
 * scans in the bucket with no row able to find them again. And nothing called the sweep at all.
 *
 * Invariants under test: (1) a storage failure keeps the row untouched and is COUNTED, so the next
 * run retries it; (2) a successful removal clears `documents` AND `retentionUntil` (the non-null
 * timestamp is the "still holds objects" flag that keeps a swept row out of the next query);
 * (3) a non-terminal case with an early `retentionUntil` is skipped and counted, never stripped.
 */

type Row = { id: string; status: string; documents: unknown; retentionUntil: Date | null }
const DAY = 23 * 60 * 60 * 1000 // the push-back (23h: lands on tomorrow's run, never on the jitter boundary)
const h = vi.hoisted(() => ({
  rows: [] as Row[],
  removed: [] as string[][],
  removeError: null as string | null,
  updates: [] as Array<{ id: string; data: Record<string, unknown> }>,
}))

vi.mock('server-only', () => ({}))
vi.mock('next/server', () => ({ after: (fn: () => unknown) => { void fn() } }))
vi.mock('@/lib/push', () => ({ sendPushToProfile: async () => 1 }))
vi.mock('@/lib/mail', () => ({ sendMail: async () => true }))
vi.mock('@/lib/tax-lookup', () => ({ taxVerdict: () => 'verified' }))
vi.mock('@/lib/edition', () => ({ SITE_NAME: 'eno.vn', IS_SERVICES: false, IS_MARKETPLACE: true, EDITION: 'marketplace' }))
vi.mock('@/lib/supabase-admin', () => ({
  BUSINESS_VERIFICATION_BUCKET: 'business-verification',
  getSupabaseAdmin: () => ({
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          if (h.removeError) return { data: null, error: { message: h.removeError } }
          h.removed.push(paths)
          return { data: paths.map((name) => ({ name })), error: null }
        },
      }),
    },
  }),
}))
vi.mock('@/lib/db', () => ({
  db: {
    sellerVerification: {
      findMany: async ({ where, take }: { where: { retentionUntil: { lt: Date }; status?: { in?: string[]; notIn?: string[] } }; take: number }) =>
        h.rows
          .filter((r) => r.retentionUntil && r.retentionUntil < where.retentionUntil.lt)
          .filter((r) => (where.status?.in ? where.status.in.includes(r.status) : true) && (where.status?.notIn ? !where.status.notIn.includes(r.status) : true))
          .sort((a, b) => +a.retentionUntil! - +b.retentionUntil!)
          .slice(0, take)
          .map((r) => ({ ...r })), // a SNAPSHOT, as Prisma returns — the live row can move underneath it
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        h.updates.push({ id: where.id, data })
        const row = h.rows.find((r) => r.id === where.id)!
        if ('documents' in data) row.documents = data.documents
        if ('retentionUntil' in data) row.retentionUntil = data.retentionUntil as Date | null
        return row
      },
      // the clear is a compare-and-set on status + the retentionUntil that was read
      updateMany: async ({ where, data }: { where: { id: string; status: { in: string[] } }; data: Record<string, unknown> }) => {
        const row = h.rows.find((r) => r.id === where.id && where.status.in.includes(r.status))
        if (!row) return { count: 0 }
        h.updates.push({ id: where.id, data })
        row.documents = data.documents; row.retentionUntil = data.retentionUntil as Date | null
        return { count: 1 }
      },
      count: async ({ where }: { where: { retentionUntil: { lt: Date }; status?: { in?: string[]; notIn?: string[] } } }) =>
        h.rows
          .filter((r) => r.retentionUntil && r.retentionUntil < where.retentionUntil.lt)
          .filter((r) => (where.status?.in ? where.status.in.includes(r.status) : true) && (where.status?.notIn ? !where.status.notIn.includes(r.status) : true))
          .length,
    },
  },
}))

const { sweepVerificationRetention } = await import('./business-verification-service')

const doc = (path: string) => ({ kind: 'identity', path, mime: 'image/jpeg', sha256: 'x', uploadedAt: '2026-08-01T00:00:00.000Z' })
const past = new Date('2026-08-01T00:00:00.000Z')
const now = new Date('2026-09-05T07:30:00.000Z')

beforeEach(() => {
  h.removed = []; h.updates = []; h.removeError = null
  h.rows = [
    { id: 'c-approved', status: 'approved', documents: [doc('s1/c-approved/reg.jpg'), doc('s1/c-approved/tax.jpg')], retentionUntil: past },
    { id: 'c-rejected', status: 'rejected', documents: [doc('s2/c-rejected/reg.jpg')], retentionUntil: past },
    { id: 'c-pending-early', status: 'pending', documents: [doc('s3/c-pending/reg.jpg')], retentionUntil: past },
    { id: 'c-not-due', status: 'approved', documents: [doc('s4/x.jpg')], retentionUntil: new Date('2026-12-01T00:00:00.000Z') },
  ]
})

describe('business-verification retention sweep (review S03)', () => {
  it('removes the objects of decided cases past their window, then clears documents AND retentionUntil', async () => {
    const r = await sweepVerificationRetention(now, 200)
    expect(h.removed).toEqual([['s1/c-approved/reg.jpg', 's1/c-approved/tax.jpg'], ['s2/c-rejected/reg.jpg']])
    expect(h.updates.map((u) => u.id)).toEqual(['c-approved', 'c-rejected'])
    for (const u of h.updates) expect(u.data).toEqual({ documents: [], retentionUntil: null })
    // `remaining` counts decided rows only; the pending drift row is the separate alarm, never queue work
    expect(r).toEqual({ swept: 2, failed: 0, malformed: 0, skippedNonTerminal: 1, remaining: 0 })
    // the swept rows are OUT of the next query; only the pending drift row remains due
    expect(h.rows.filter((x) => x.retentionUntil && x.retentionUntil < now).map((x) => x.id)).toEqual(['c-pending-early'])
  })

  it('a storage failure keeps the paths, is counted, and PUSHES THE ROW BACK a day — retried, but no longer at the head of the line', async () => {
    h.removeError = 'storage unavailable'
    const r = await sweepVerificationRetention(now, 200)
    // documents untouched; retentionUntil moved to tomorrow (the row is still the queue)
    expect(h.updates.map((u) => u.data)).toEqual([{ retentionUntil: new Date(now.getTime() + DAY) }, { retentionUntil: new Date(now.getTime() + DAY) }])
    expect((h.rows[0].documents as unknown[]).length).toBe(2)
    expect(r).toEqual({ swept: 0, failed: 2, malformed: 0, skippedNonTerminal: 1, remaining: 0 })
    // the blip clears: the same rows sweep on a run after the backoff
    h.removeError = null
    const again = await sweepVerificationRetention(new Date(now.getTime() + 24 * 60 * 60 * 1000), 200)
    expect(again).toMatchObject({ swept: 2, failed: 0 })
  })

  it('a non-terminal row with an early retentionUntil never occupies a slot: 200 of them cannot starve a decided case', async () => {
    h.rows = [
      ...Array.from({ length: 200 }, (_, i) => ({ id: `drift-${i}`, status: 'pending', documents: [doc(`d/${i}.jpg`)], retentionUntil: new Date(past.getTime() - i * 1000) })),
      { id: 'c-decided', status: 'rejected', documents: [doc('s9/reg.jpg')], retentionUntil: past },
    ]
    const r = await sweepVerificationRetention(now, 200)
    expect(h.removed).toEqual([['s9/reg.jpg']])
    expect(r).toEqual({ swept: 1, failed: 0, malformed: 0, skippedNonTerminal: 200, remaining: 0 })
  })

  it('a row with an entry the parser cannot read is a FAILURE, kept and pushed back — never cleared with an object still in the bucket', async () => {
    h.rows = [{ id: 'c-broken', status: 'approved', documents: [doc('s1/ok.jpg'), { kind: 'weird', path: 's1/lost.jpg' }], retentionUntil: past }]
    const r = await sweepVerificationRetention(now, 200)
    expect(h.removed).toEqual([])
    // malformed is its OWN count — pushed back for a human, not a storage failure
    expect(r).toEqual({ swept: 0, failed: 0, malformed: 1, skippedNonTerminal: 0, remaining: 0 })
    expect((h.rows[0].documents as unknown[]).length).toBe(2)
  })

  it('200 malformed rows do not stop the drain: pushed back, they leave the head and the next batch is read', async () => {
    h.rows = [
      ...Array.from({ length: 200 }, (_, i) => ({ id: `bad-${i}`, status: 'rejected', documents: { path: `b/${i}` }, retentionUntil: new Date(past.getTime() - i * 1000) })),
      { id: 'c-good', status: 'approved', documents: [doc('s9/reg.jpg')], retentionUntil: past },
    ]
    const r = await sweepVerificationRetention(now, 200)
    expect(h.removed).toEqual([['s9/reg.jpg']])
    expect(r).toEqual({ swept: 1, failed: 0, malformed: 200, skippedNonTerminal: 0, remaining: 0 })
  })

  it('a documents column that is not an array at all is a failure too — never "swept as empty"', async () => {
    h.rows = [{ id: 'c-object', status: 'rejected', documents: { path: 's1/x.jpg' }, retentionUntil: past }]
    const r = await sweepVerificationRetention(now, 200)
    expect(h.removed).toEqual([]); expect(r.malformed).toBe(1); expect(r.failed).toBe(0)
    expect(h.rows[0].documents).toEqual({ path: 's1/x.jpg' })
  })

  it('the clear is guarded on the decided status (not on the timestamp): a row that left the decided set under the sweep is counted, pushed back, not cleared', async () => {
    h.rows = [{ id: 'c-moved', status: 'approved', documents: [doc('s1/a.jpg')], retentionUntil: past }]
    const orig = h.rows[0]
    const realRemove = h.removed
    h.removed = new Proxy(realRemove, { set(t, k, v) { orig.status = 'draft'; return Reflect.set(t, k, v) } })
    const r = await sweepVerificationRetention(now, 200)
    expect(r).toMatchObject({ swept: 0, failed: 1 })
    expect(orig.documents).toHaveLength(1)
    // …and pushed back, so it cannot sit at the head of the line tomorrow
    expect(orig.retentionUntil).toEqual(new Date(now.getTime() + DAY))
  })

  it('drains a backlog larger than one batch in a single run — a green run never leaves due rows behind', async () => {
    h.rows = Array.from({ length: 450 }, (_, i) => ({ id: `c-${i}`, status: 'approved', documents: [doc(`s/${i}.jpg`)], retentionUntil: new Date(past.getTime() + i * 1000) }))
    const r = await sweepVerificationRetention(now, 200)
    expect(r).toEqual({ swept: 450, failed: 0, malformed: 0, skippedNonTerminal: 0, remaining: 0 })
    expect(h.removed).toHaveLength(450)
  })

  it('a non-terminal case with an early retentionUntil is skipped and counted, never stripped mid-review', async () => {
    await sweepVerificationRetention(now, 200)
    expect(h.removed.flat()).not.toContain('s3/c-pending/reg.jpg')
    expect(h.rows.find((x) => x.id === 'c-pending-early')!.documents).toHaveLength(1)
  })

  it('a decided case whose documents are already empty is swept without a storage call and leaves the queue', async () => {
    h.rows = [{ id: 'c-empty', status: 'rejected', documents: [], retentionUntil: past }]
    const r = await sweepVerificationRetention(now, 200)
    expect(h.removed).toEqual([])
    expect(r).toEqual({ swept: 1, failed: 0, malformed: 0, skippedNonTerminal: 0, remaining: 0 })
  })
})
