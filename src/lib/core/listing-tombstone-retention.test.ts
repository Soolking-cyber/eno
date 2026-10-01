import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The retention END of a listing tombstone (src/lib/core/listing-tombstone-retention.ts). Pinned: only
 * a tombstone removed longer ago than the period is touched; the removal date is the audit row's (the
 * row's updatedAt only as a fallback); the investigation hold keeps it; a scrub blanks every personal
 * column, queues the first-party media for the storage sweep and writes one `listing.purged` audit row
 * — all in one transaction — and never deletes the row.
 */

type Row = Record<string, any>
const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2030-06-01T00:00:00Z')
const ago = (days: number) => new Date(NOW.getTime() - days * DAY)
const STORE = 'https://sb.eno.vn/storage/v1/object/public/'

const h = vi.hoisted(() => ({
  listings: [] as Row[],
  audits: [] as Row[],
  reports: [] as Row[],
  appended: [] as Row[],
  storage: [] as Row[],
  deletes: 0,
}))

const isScrubbed = (l: Row) => l.title === '[removed]' && l.description === '' && l.images === '[]' && l.video === null && l.searchText === ''
const openOn = (id: string) => h.reports.some((r) => r.status === 'open' && r.listingId === id)

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => {
  const listing = {
    findMany: async (a: Row) => {
      const w = a.where
      let rows = h.listings.filter((l) =>
        (w.status ? l.status === w.status : true)
        && (w.NOT ? !isScrubbed(l) : true)
        && (w.id?.in ? w.id.in.includes(l.id) : true)
        && (w.reports?.none ? !openOn(l.id) : true))
      rows = rows.sort((x, y) => (x.id < y.id ? -1 : 1))
      if (a.cursor) rows = rows.filter((l) => l.id > a.cursor.id)
      if (a.take) rows = rows.slice(0, a.take)
      return rows.map((l) => ({ ...l, seller: { ownerId: l.ownerId ?? null, owner: l.owner ?? null } }))
    },
    updateManyAndReturn: async (a: Row) => {
      const hit = h.listings.filter((l) => a.where.id.in.includes(l.id) && l.status === a.where.status && !openOn(l.id))
      for (const l of hit) Object.assign(l, a.data)
      return hit.map((l) => ({ id: l.id }))
    },
    deleteMany: async () => { h.deletes++; return { count: 0 } },
  }
  const db: Row = {
    listing,
    complianceAudit: { findMany: async (a: Row) => h.audits.filter((x) => x.action === a.where.action && a.where.subjectId.in.includes(x.subjectId)) },
    report: {
      findMany: async (a: Row) => h.reports.filter((r) => r.status === 'open' && a.where.OR.some((c: Row) =>
        (c.listingId && c.listingId.in.includes(r.listingId)) || (c.targetSellerId && c.targetSellerId.in.includes(r.targetSellerId)) || (c.targetProfileId && c.targetProfileId.in.includes(r.targetProfileId)))),
    },
  }
  db.$transaction = async (fn: (tx: Row) => unknown) => fn(db)
  return { db }
})
vi.mock('@/lib/compliance/audit', () => ({ appendAudit: async (_tx: unknown, input: Row) => { h.appended.push(input) } }))
vi.mock('@/lib/core/storage-tombstones', () => ({ writeTombstones: async (_tx: unknown, refs: Row[], reason: string) => { h.storage.push(...refs.map((r) => ({ ...r, reason }))); return refs.length } }))
vi.mock('@/lib/listing-image', () => ({
  listingObjectKey: (u: string) => {
    for (const bucket of ['listings', 'listing-videos'] as const) if (u.startsWith(`${STORE}${bucket}/`)) return { bucket, key: u.slice(`${STORE}${bucket}/`.length), url: u }
    return null
  },
}))

const { sweepListingTombstoneRetention, LISTING_TOMBSTONE_RETENTION_DAYS } = await import('./listing-tombstone-retention')

const tomb = (id: string, extra: Row = {}): Row => ({
  id, status: 'removed', sellerId: 's1', ownerId: 'p1', owner: { enforcementState: 'good_standing', complianceFlag: null },
  complianceStatus: 'clear', takedownOrderId: null, updatedAt: ago(10),
  title: `Listing ${id} by Nguyễn Văn A`, description: 'Gọi 0901 234 567', images: JSON.stringify([`${STORE}listings/${id}.webp`, 'https://cdn.tiki.vn/x.jpg']),
  video: `${STORE}listing-videos/${id}.mp4`, searchText: 'nguyen van a', location: 'Quận 1', district: 'Quận 1',
  ...extra,
})
const removedAudit = (id: string, at: Date) => ({ action: 'listing.removed', subjectId: id, occurredAt: at })

beforeEach(() => { h.listings = []; h.audits = []; h.reports = []; h.appended = []; h.storage = []; h.deletes = 0 })

describe('sweepListingTombstoneRetention', () => {
  it('the period is at least three years', () => {
    expect(LISTING_TOMBSTONE_RETENTION_DAYS).toBeGreaterThanOrEqual(3 * 365)
  })

  it('scrubs a tombstone removed longer ago than the period — and only that one; never deletes a row', async () => {
    h.listings = [tomb('old'), tomb('young'), { ...tomb('live'), status: 'active' }]
    h.audits = [removedAudit('old', ago(LISTING_TOMBSTONE_RETENTION_DAYS + 1)), removedAudit('young', ago(LISTING_TOMBSTONE_RETENTION_DAYS - 1)), removedAudit('live', ago(5000))]
    const r = await sweepListingTombstoneRetention(NOW)
    expect(r).toEqual({ scrubbed: 1, held: 0, remaining: 0, noAuditRow: 0 })
    const old = h.listings.find((l) => l.id === 'old')!
    expect(old).toMatchObject({ status: 'removed', title: '[removed]', description: '', images: '[]', video: null, searchText: '', location: '', district: null })
    expect(JSON.stringify(old)).not.toMatch(/Nguyễn|0901/)
    expect(h.listings.find((l) => l.id === 'young')!.title).toMatch(/Nguyễn/)
    expect(h.listings.find((l) => l.id === 'live')!.title).toMatch(/Nguyễn/)
    expect(h.deletes).toBe(0)
  })

  it('journals each scrub in the audit chain (no PII) and queues ONLY first-party media for the sweep', async () => {
    h.listings = [tomb('old')]
    h.audits = [removedAudit('old', ago(LISTING_TOMBSTONE_RETENTION_DAYS + 30))]
    await sweepListingTombstoneRetention(NOW)
    expect(h.appended).toEqual([expect.objectContaining({
      actorType: 'system', action: 'listing.purged', subjectType: 'listing', subjectId: 'old',
      detail: expect.objectContaining({ reason: 'retention_expired', retentionDays: LISTING_TOMBSTONE_RETENTION_DAYS, mediaQueued: 2 }),
    })])
    expect(JSON.stringify(h.appended)).not.toMatch(/Nguyễn|0901/)
    expect(h.storage).toEqual([
      { bucket: 'listings', path: 'old.webp', reason: 'listing_retention_expired' },
      { bucket: 'listing-videos', path: 'old.mp4', reason: 'listing_retention_expired' },
    ])
  })

  it('the INVESTIGATION HOLD keeps it: an open report (listing, shop or owner), a held/suspended or flagged owner, a takedown', async () => {
    const due = ago(LISTING_TOMBSTONE_RETENTION_DAYS + 1)
    h.listings = [
      tomb('a'), tomb('b', { sellerId: 's2' }), tomb('c', { ownerId: 'p3' }),
      tomb('d', { owner: { enforcementState: 'suspended', complianceFlag: null } }),
      tomb('e', { owner: { enforcementState: 'good_standing', complianceFlag: 'authority_hold' } }),
      tomb('f', { complianceStatus: 'taken_down' }), tomb('g', { takedownOrderId: 'order-1' }),
      tomb('z'),
    ]
    h.audits = h.listings.map((l) => removedAudit(l.id, due))
    h.reports = [
      { status: 'open', listingId: 'a' }, { status: 'open', targetSellerId: 's2' }, { status: 'open', targetProfileId: 'p3' },
      { status: 'dismissed', listingId: 'z' }, // a resolved report is no hold
    ]
    const r = await sweepListingTombstoneRetention(NOW)
    expect(r).toMatchObject({ scrubbed: 1, held: 7 })
    expect(h.listings.filter((l) => l.title === '[removed]').map((l) => l.id)).toEqual(['z'])
  })

  it('the removal date is the AUDIT row\'s; a tombstone with none falls back to updatedAt (never earlier than the removal)', async () => {
    h.listings = [
      tomb('bumped', { updatedAt: ago(10) }), // removed long ago, updatedAt touched since — the audit row decides
      tomb('noaudit', { updatedAt: ago(LISTING_TOMBSTONE_RETENTION_DAYS + 2) }),
      tomb('noaudit-young', { updatedAt: ago(100) }),
    ]
    h.audits = [removedAudit('bumped', ago(LISTING_TOMBSTONE_RETENTION_DAYS + 5))]
    const r = await sweepListingTombstoneRetention(NOW)
    expect(r).toMatchObject({ scrubbed: 2, noAuditRow: 1 })
    expect(h.listings.filter((l) => l.title === '[removed]').map((l) => l.id).sort()).toEqual(['bumped', 'noaudit'])
  })

  it('is idempotent: an already-scrubbed tombstone is not re-read, re-audited or re-queued', async () => {
    h.listings = [tomb('old')]
    h.audits = [removedAudit('old', ago(LISTING_TOMBSTONE_RETENTION_DAYS + 1))]
    await sweepListingTombstoneRetention(NOW)
    h.appended = []; h.storage = []
    expect(await sweepListingTombstoneRetention(NOW)).toEqual({ scrubbed: 0, held: 0, remaining: 0, noAuditRow: 0 })
    expect(h.appended).toEqual([])
    expect(h.storage).toEqual([])
  })
})
