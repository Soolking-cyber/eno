import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LISTING_REMOVED, NOT_REMOVED, isRemovedStatus } from '@/lib/listing-removed'
import { listingIsViewable } from '@/app/[lang]/listings/[id]/(pdp)/get-listing'

/**
 * THE TOMBSTONE WRITER (src/lib/core/listing-tombstone.ts) — the one replacement for every hard delete
 * a person could trigger. Pinned: what it writes, that it is conditional and idempotent, that the
 * audit row commits with it and says who and why, and that a tombstone is invisible on the PDP.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({ rows: [] as Row[], audits: [] as Row[], calls: [] as Array<{ m: string; args: any }> }))

vi.mock('@/lib/compliance/audit', () => ({ appendAudit: async (_tx: unknown, input: Row) => { h.audits.push(input) } }))

const { tombstoneListingsTx, TOMBSTONE_DATA, PERSONAL_SCRUB_DATA } = await import('./listing-tombstone')

/** A fake transaction client over `h.rows`, honouring id-in + status-not/equals + the extra guard (AND-ed). */
const matches = (r: Row, where: Row): boolean =>
  (where.id?.in ? where.id.in.includes(r.id) : true)
  && (where.status?.not ? r.status !== where.status.not : true)
  && (typeof where.status === 'string' ? r.status === where.status : true)
  && (where.reports?.none?.status === 'open' ? !r.openReport : true)
  && ((where.AND as Row[] | undefined) ?? []).every((w) => matches(r, w))
const tx = {
  listing: {
    findMany: async (a: Row) => { h.calls.push({ m: 'findMany', args: a }); return h.rows.filter((r) => matches(r, a.where)).map((r) => ({ ...r })) },
    updateManyAndReturn: async (a: Row) => {
      h.calls.push({ m: 'updateManyAndReturn', args: a })
      const hit = h.rows.filter((r) => matches(r, a.where))
      for (const r of hit) Object.assign(r, a.data)
      return hit.map((r) => ({ id: r.id }))
    },
  },
} as never

beforeEach(() => {
  h.rows = [
    { id: 'A', status: 'active', verified: true, identityHold: false, featured: true, externalId: 'sku-a', sellerId: 's1', brandSlug: 'apple', video: null },
    { id: 'B', status: 'sold', verified: true, identityHold: false, featured: false, externalId: null, sellerId: 's1', brandSlug: null, video: 'v.mp4' },
    { id: 'C', status: LISTING_REMOVED, verified: false, identityHold: false, featured: false, externalId: null, sellerId: 's1', brandSlug: null, video: null },
  ]
  h.audits = []
  h.calls = []
})

describe('tombstoneListingsTx', () => {
  it('writes status removed + unpublished, keeps every other column, and returns only the rows it changed', async () => {
    const out = await tombstoneListingsTx(tx, ['A', 'B', 'C', 'missing'], { actor: { kind: 'admin', email: 'mod@eno.vn' }, reason: 'admin_removed' })
    expect(out.map((r) => r.id)).toEqual(['A', 'B'])
    expect(out[0]).toMatchObject({ priorStatus: 'active', brandSlug: 'apple' })
    for (const id of ['A', 'B']) expect(h.rows.find((r) => r.id === id)).toMatchObject(TOMBSTONE_DATA)
    // The evidence stays: externalId (moderation keeps it), the video, the seller.
    expect(h.rows.find((r) => r.id === 'A')).toMatchObject({ externalId: 'sku-a', sellerId: 's1' })
    expect(h.rows.find((r) => r.id === 'B')).toMatchObject({ video: 'v.mp4' })
  })

  it('one audit row per removed listing, naming the actor, the reason and the prior state — none for a skip', async () => {
    await tombstoneListingsTx(tx, ['A', 'C'], { actor: { kind: 'moderator', email: 'mod@eno.vn' }, reason: 'moderation_rejected', note: 'counterfeit goods' })
    expect(h.audits).toEqual([{
      actorType: 'admin', actorId: 'mod@eno.vn', action: 'listing.removed', subjectType: 'listing', subjectId: 'A', legalBasis: 'ecommerceLaw',
      detail: { by: 'moderator', reason: 'moderation_rejected', priorStatus: 'active', priorVerified: true, sellerId: 's1', externalId: 'sku-a', note: 'counterfeit goods' },
    }])
  })

  it('a seller\'s delete releases the externalId (the audit keeps it) and is audited as the owner', async () => {
    await tombstoneListingsTx(tx, ['A'], { actor: { kind: 'seller', profileId: 'p1', sellerId: 's1' }, reason: 'seller_deleted', releaseExternalId: true })
    expect(h.rows.find((r) => r.id === 'A')).toMatchObject({ status: LISTING_REMOVED, externalId: null })
    expect(h.audits[0]).toMatchObject({ actorType: 'user', actorId: 'p1', detail: { by: 'seller', externalId: 'sku-a' } })
  })

  it('the extra guard is part of the WRITE (atomic), not only of the read', async () => {
    h.rows[0].openReport = true
    const out = await tombstoneListingsTx(tx, ['A'], { actor: { kind: 'seller', profileId: null, sellerId: 's1' }, reason: 'seller_deleted', where: { reports: { none: { status: 'open' } } } })
    expect(out).toEqual([])
    expect(h.rows[0].status).toBe('active')
    expect(h.audits).toEqual([])
  })

  it('a caller\'s guard can never REPLACE the not-removed filter — it is AND-ed, not spread', async () => {
    // `{ status: { not: 'removed' }, ...{ status: 'removed' } }` would have re-stamped and re-audited C.
    const out = await tombstoneListingsTx(tx, ['C'], { actor: { kind: 'admin', email: 'a@eno.vn' }, reason: 'admin_removed', where: { status: LISTING_REMOVED } })
    expect(out).toEqual([])
    expect(h.audits).toEqual([])
    const read = h.calls.find((c) => c.m === 'findMany')!.args.where
    expect(read).toMatchObject({ status: { not: LISTING_REMOVED }, AND: [{ status: LISTING_REMOVED }] })
  })

  it('never re-stamps a tombstone, and an empty id list does nothing at all', async () => {
    expect(await tombstoneListingsTx(tx, ['C'], { actor: { kind: 'admin', email: 'a@eno.vn' }, reason: 'admin_removed' })).toEqual([])
    expect(await tombstoneListingsTx(tx, [], { actor: { kind: 'admin', email: 'a@eno.vn' }, reason: 'admin_removed' })).toEqual([])
    expect(h.calls.filter((c) => c.m === 'updateManyAndReturn')).toHaveLength(0)
    expect(h.audits).toEqual([])
  })
})

describe('a tombstone is invisible', () => {
  it('the PDP\'s own viewability rule 404s it (verified false AND status removed — either alone suffices)', () => {
    expect(listingIsViewable({ verified: TOMBSTONE_DATA.verified, status: TOMBSTONE_DATA.status })).toBe(false)
    expect(listingIsViewable({ verified: true, status: LISTING_REMOVED })).toBe(false)
  })

  it('NOT_REMOVED is the owner-scoped reads\' filter, and isRemovedStatus names it', () => {
    expect(NOT_REMOVED).toEqual({ status: { not: 'removed' } })
    expect(isRemovedStatus('removed')).toBe(true)
    for (const s of ['active', 'sold', 'hidden', 'stale', null, undefined]) expect(isRemovedStatus(s)).toBe(false)
  })
})

/**
 * ⛔ THE SCRUB NEVER WRITES NULL INTO A NOT NULL COLUMN (2026-10-01, review). PERSONAL_SCRUB_DATA runs
 * TODAY, on every teacher-profile delete; a null into a NOT NULL column would throw inside the
 * delete's transaction and the profile could not be deleted at all. Checked against the schema text
 * here (prisma/schema.prisma, model Listing) — and against the live database once by hand on
 * 2026-10-01 (information_schema.columns, read-only): every column below set to null is nullable
 * there too, and the five NOT NULL ones (title, description, images, searchText, location) get a valid
 * empty value.
 */
describe('PERSONAL_SCRUB_DATA fits the Listing columns', () => {
  const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8')
  const model = schema.match(/^model Listing \{([\s\S]*?)^\}/m)?.[1] ?? ''
  /** field → { type, optional } for every scalar line of model Listing. */
  const fields = new Map<string, { type: string; optional: boolean }>()
  for (const line of model.split('\n')) {
    const m = line.match(/^\s+(\w+)\s+(\w+)(\?|\[\])?/)
    if (m) fields.set(m[1], { type: m[2], optional: m[3] === '?' })
  }

  it('finds the model (the parse is not vacuous)', () => {
    expect(fields.get('title')).toEqual({ type: 'String', optional: false })
    expect(fields.get('titleVi')).toEqual({ type: 'String', optional: true })
    expect(fields.size).toBeGreaterThan(50)
  })

  it.each(Object.entries(PERSONAL_SCRUB_DATA))('%s', (column, value) => {
    const f = fields.get(column)
    expect(f, `${column} is not a column of model Listing`).toBeDefined()
    if (value === null) expect(f!.optional, `${column} is NOT NULL — scrub it to an empty value, not null`).toBe(true)
    else if (typeof value === 'string') expect(f!.type).toBe('String')
  })

  it('the NOT NULL columns get a valid empty value (images is a JSON array)', () => {
    expect(PERSONAL_SCRUB_DATA).toMatchObject({ title: '[removed]', description: '', images: '[]', searchText: '', location: '' })
    expect(JSON.parse(PERSONAL_SCRUB_DATA.images)).toEqual([])
  })
})
