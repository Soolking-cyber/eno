import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * B8-GONE-LANDERS — the layout's half of the decision (`isListingViewable`, which `layout.tsx` 404s on).
 * A gone row must get past it, or the gone page would never render; everything else hidden must not.
 * ⚠️ AND ONLY A VERIFIED HIDDEN ROW PAYS FOR THE SECOND READ: active, sold, stale and unverified rows are
 * decided on the three-column probe alone, as before.
 */
const findFirst = vi.hoisted(() => vi.fn())
// Every fixture id is journaled, so the 404 tests reach the guard they name (owner, listing type…).
vi.mock('@/lib/gone-listing-ids', () => ({ isJournaledGone: () => true }))
vi.mock('@/lib/db', () => ({ db: { listing: { findFirst } } }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w }))

const { isListingViewable } = await import('./get-listing')

const IMPORT_ROW = {
  id: 'L1', title: 'OPPO A6c 4GB 128GB', titleVi: 'OPPO A6c 4GB 128GB', verified: true, status: 'hidden', listingType: 'sell',
  complianceStatus: 'clear', affiliateUrl: 'https://go.isclix.com/deep_link/x', subcategorySlug: 'phones-tablets', brandSlug: 'oppo', model: 'A6c', updatedAt: new Date('2026-10-02T20:04:00+07:00'),
  category: { slug: 'electronics' },
  seller: { id: 'cmt78nvif0000gpq48kvzmxjw', ownerId: null, officialPartner: false, name: 'CellphoneS' },
}
/** The probe (a `select`) gets the three columns; the full read (an `include`) gets the row. */
const serve = (full: Record<string, unknown>) =>
  findFirst.mockImplementation(async (a: { select?: unknown }) => (a.select ? { verified: full.verified, status: full.status } : full))
const reads = () => findFirst.mock.calls.length

beforeEach(() => { findFirst.mockReset() })

describe('isListingViewable — what the layout lets through', () => {
  it('a hidden import-shop goods row: through, on the full row', async () => {
    serve(IMPORT_ROW)
    expect(await isListingViewable('L1')).toBe(true)
    expect(reads()).toBe(2)
    expect(findFirst.mock.calls[1][0]).toMatchObject({ include: { category: true, seller: expect.anything() } })
  })

  it('⛔ a person’s hidden post: 404', async () => {
    serve({ ...IMPORT_ROW, affiliateUrl: null, seller: { id: 'seller-minh', ownerId: '6f1c2c1e-0000-4000-8000-000000000001', officialPartner: false, name: 'Minh' } })
    expect(await isListingViewable('L2')).toBe(false)
  })

  it('⛔ an import shop’s hidden rental: 404', async () => {
    serve({ ...IMPORT_ROW, listingType: 'rent' })
    expect(await isListingViewable('L3')).toBe(false)
  })

  it('active and sold: through on the probe alone, as before', async () => {
    for (const status of ['active', 'sold']) {
      findFirst.mockReset()
      serve({ ...IMPORT_ROW, status })
      expect(await isListingViewable(`L-${status}`), status).toBe(true)
      expect(reads(), status).toBe(1)
    }
  })

  it('stale, expired, held and unverified: 404 on the probe alone — no second read', async () => {
    for (const over of [{ status: 'stale' }, { status: 'expired' }, { status: 'held' }, { verified: false }]) {
      findFirst.mockReset()
      serve({ ...IMPORT_ROW, ...over })
      expect(await isListingViewable(`L-${JSON.stringify(over)}`), JSON.stringify(over)).toBe(false)
      expect(reads(), JSON.stringify(over)).toBe(1)
    }
  })

  it('a missing row: 404', async () => {
    findFirst.mockResolvedValue(null)
    expect(await isListingViewable('nope')).toBe(false)
    expect(reads()).toBe(1)
  })
})
