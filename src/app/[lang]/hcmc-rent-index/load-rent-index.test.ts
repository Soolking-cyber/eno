import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RentRow } from '@/lib/rent-index'

/**
 * The loader's one new read (owner decision 9's method fix, 2026-10-20): the names of the OFFICIAL PARTNERS among the
 * sellers the scoped read returned, so the methodology can name the snapshot's sources. Words only — these tests pin
 * that it asks about nobody else, never about an import storefront, and fails the snapshot rather than mislabel it.
 * ⚠️ A FRESH MODULE PER TEST (`vi.resetModules` + a dynamic import): the loader keeps a minute-long failure hold in
 * module state, so a shared instance made these tests pass or fail by their order (opus, gate review — measured with
 * --sequence.shuffle: seeds 1 and 3 failed).
 */
type Seller = { id: string; name: string; officialPartner: boolean }
type SellerQuery = { where: { id: { in: string[] }; officialPartner: boolean }; select: Record<string, boolean> }
const h = vi.hoisted(() => ({
  rows: [] as RentRow[],
  sellers: [] as Seller[],
  queries: [] as SellerQuery[],
  failSellers: false,
}))

vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      // Phase 1 returns the rows; phase 2 (photos, only for cross-post candidates) finds none.
      findMany: async (args: { select: Record<string, boolean> }) => (args.select.images ? [] : h.rows),
    },
    seller: {
      findMany: async (args: SellerQuery) => {
        h.queries.push(args)
        if (h.failSellers) throw new Error('database unreachable')
        return h.sellers
          .filter((s) => args.where.id.in.includes(s.id) && s.officialPartner === args.where.officialPartner)
          .map((s) => Object.fromEntries(Object.keys(args.select).map((k) => [k, s[k as keyof Seller]])))
      },
    },
  },
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: object) => w }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))

const load = async () => (await import('./load-rent-index')).loadRentIndex()

const NHATOT = 'nhatot-import-seller-0001'
let seq = 0
const row = (over: Partial<RentRow> = {}): RentRow => ({
  id: `r-${++seq}`, price: 10_000_000, priceUnit: 'VND/month', currency: '₫', listingType: 'rent',
  subcategorySlug: 'apartment-rental', district: 'Quận 1', areaM2: 40 + seq, sellerId: NHATOT, attributes: '{"bedrooms":"1"}',
  ...over,
})

const info = vi.spyOn(console, 'info').mockImplementation(() => {})
const error = vi.spyOn(console, 'error').mockImplementation(() => {})
afterAll(() => { info.mockRestore(); error.mockRestore() })

beforeEach(() => {
  vi.resetModules()
  error.mockClear() // so the failure case proves its own log line (opus, gate review)
  h.queries = []
  h.failSellers = false
  h.sellers = [
    { id: 'goplus', name: ' GoPlus ', officialPartner: true },
    { id: 'vietkite', name: 'VietKite', officialPartner: true },
    { id: 'member', name: 'A Member Shop', officialPartner: false },
  ]
  h.rows = [
    row(),
    row({ sellerId: 'goplus' }),
    row({ sellerId: 'member' }),
    row({ sellerId: 'vietkite', subcategorySlug: 'office-rental' }), // read, but not a home: never counted
  ]
})

describe('loadRentIndex — the snapshot names its sources', () => {
  it('names an official partner by its storefront name, a member as members, and a partner it did not count not at all', async () => {
    const got = await load()
    expect(got.known).toBe(true)
    if (!got.known) return
    expect(got.index.used).toBe(3)
    expect(got.index.sources).toEqual([{ kind: 'import', name: 'Nhatot.com' }, { kind: 'partner', name: 'GoPlus' }, { kind: 'members' }])
  })

  it('asks only about sellers the scoped read returned — never an import storefront — and only for partners, two columns', async () => {
    await load()
    expect(h.queries).toHaveLength(1)
    expect([...h.queries[0].where.id.in].sort()).toEqual(['goplus', 'member', 'vietkite'])
    expect(h.queries[0].where.officialPartner).toBe(true)
    expect(Object.keys(h.queries[0].select).sort()).toEqual(['id', 'name'])
  })

  it('asks nothing when every row is an import storefront\'s', async () => {
    h.rows = [row(), row()]
    expect((await load()).known).toBe(true)
    expect(h.queries).toHaveLength(0)
  })

  it('keeps a partner with no stored name a partner, never a member', async () => {
    h.rows = [row(), row({ sellerId: 'goplus' })]
    h.sellers = [{ id: 'goplus', name: '   ', officialPartner: true }]
    const got = await load()
    expect(got.known && got.index.sources).toEqual([{ kind: 'import', name: 'Nhatot.com' }, { kind: 'partner', name: '' }])
  })

  it('asks in chunks of at most 5,000 ids, however many sellers the category holds', async () => {
    h.rows = Array.from({ length: 12_001 }, (_, i) => row({ sellerId: `member-${i}`, subcategorySlug: 'office-rental' }))
    expect((await load()).known).toBe(true)
    expect(h.queries.map((q) => q.where.id.in.length)).toEqual([5_000, 5_000, 2_001])
  })

  it('fails the snapshot when the partner read fails — never a snapshot that mislabels a partner as members', async () => {
    h.failSellers = true
    expect(await load()).toEqual({ known: false })
    expect(error).toHaveBeenCalledTimes(1)
    expect(error.mock.calls[0][0]).toBe('[hcmc-rent-index] snapshot failed')
    expect(String(error.mock.calls[0][1])).toContain('database unreachable')
  })
})
