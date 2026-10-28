import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * "Outstanding businesses" never shows a teacher profile (2026-10-13). The rail reads the edition scope directly, not
 * through scopedListingWhere, so the default teacher exclusion never reached it: a business account's teacher profile
 * (the owner's demo is one) could be its flagship, and with the home page's "Find a teacher" shelf the same person
 * could be on the page twice. Pinned against a small fake that applies the WHERE the way Postgres would — a teacher
 * row is never a flagship, and a storefront whose only live listing is a teacher profile takes no slot.
 * ⛔ AND ONLY LISTINGS DEALT ON eno (owner, 2026-10-28 — in-app-listing.ts): the rail is drawn on the home page alone, so a
 * listing booked on a partner's site is never a flagship, and a storefront with nothing else takes no slot.
 */
type Row = { id: string; sellerId: string; categoryId: string; verified: boolean; status: string; views: number; affiliateUrl: string | null }
type Seller = { id: string; trustScore: number; business: boolean }

const h = vi.hoisted(() => ({
  teachersId: 'cat-teachers' as string | null,
  sellers: [] as Seller[],
  listings: [] as Row[],
  sellerWheres: [] as unknown[],
  listingWheres: [] as unknown[],
}))

/** Does `row` satisfy a listing WHERE built from equality keys, `{ not }`, `AND` and `OR` — the shapes the rail writes. */
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'AND') return (v as Record<string, unknown>[]).every((w) => matches(row, w))
    if (k === 'OR') return (v as Record<string, unknown>[]).some((w) => matches(row, w))
    if (v && typeof v === 'object' && 'not' in (v as object)) return row[k] !== (v as { not: unknown }).not
    return row[k] === v
  })
}

vi.mock('@/lib/edition-scope', () => ({
  marketplaceListingScope: async () => ({ sellerId: { notIn: ['desk'] } }),
  teacherExclusion: async () => (h.teachersId ? { categoryId: { not: h.teachersId } } : null),
}))
vi.mock('@/lib/serialize', () => ({ serializeListing: (l: Row) => ({ id: l.id, sellerId: l.sellerId }) }))
vi.mock('@/lib/db', () => ({
  db: {
    seller: {
      findMany: async ({ where }: { where: Record<string, any> }) => {
        h.sellerWheres.push(where)
        const some = where.listings.some as Record<string, unknown>
        return h.sellers
          .filter((s) => s.business || s.trustScore >= 110)
          .filter((s) => !where.id?.notIn?.includes(s.id))
          .filter((s) => h.listings.some((l) => l.sellerId === s.id && matches(l, some)))
          .sort((a, b) => b.trustScore - a.trustScore)
          .slice(0, 12)
          .map((s) => ({ id: s.id }))
      },
    },
    listing: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        h.listingWheres.push(where)
        return h.listings.filter((l) => matches(l, where)).sort((a, b) => b.views - a.views)[0] ?? null
      },
    },
  },
}))

const { topBusinessListings } = await import('./business-rail')

const listing = (id: string, sellerId: string, over: Partial<Row> = {}): Row =>
  ({ id, sellerId, categoryId: 'cat-goods', verified: true, status: 'active', views: 10, affiliateUrl: null, ...over })

beforeEach(() => {
  h.teachersId = 'cat-teachers'
  h.sellerWheres = []
  h.listingWheres = []
  h.sellers = [
    { id: 'eno-co', trustScore: 140, business: true }, // the owner's business: goods AND the demo teacher profile
    { id: 'school', trustScore: 130, business: true }, // a business whose ONLY live listing is a teacher profile
    { id: 'shop', trustScore: 120, business: true },
  ]
  h.listings = [
    listing('demo-teacher', 'eno-co', { categoryId: 'cat-teachers', views: 999 }), // the most viewed — still never the flagship
    listing('eno-goods', 'eno-co', { views: 5 }),
    listing('school-teacher', 'school', { categoryId: 'cat-teachers', views: 50 }),
    listing('shop-goods', 'shop'),
  ]
})

describe('topBusinessListings — no teacher profile on the businesses rail', () => {
  it('a teacher listing is never a flagship, however viewed: the business shows its goods instead', async () => {
    const rows = await topBusinessListings()
    expect(rows.map((r) => r.id)).toEqual(['eno-goods', 'shop-goods'])
    // …because every flagship read carries the exclusion as its OWN AND element, beside the seller and live keys.
    for (const w of h.listingWheres) expect((w as { AND: unknown[] }).AND).toContainEqual({ categoryId: { not: 'cat-teachers' } })
  })

  it('a storefront whose only live listing is a teacher profile takes no slot — the seller pick excludes it', async () => {
    await topBusinessListings()
    expect(h.sellerWheres[0]).toMatchObject({ id: { notIn: ['desk'] } }) // the desk exclusion is still there, beside it
    expect((h.sellerWheres[0] as { listings: { some: { AND: unknown[] } } }).listings.some.AND).toContainEqual({ categoryId: { not: 'cat-teachers' } })
    // …so no flagship is even looked for there: the slot went to a storefront with goods.
    expect(h.listingWheres.some((w) => JSON.stringify(w).includes('"school"'))).toBe(false)
  })

  it('no teachers category yet: nothing to exclude — the teacher profile can be a flagship again', async () => {
    h.teachersId = null
    const rows = await topBusinessListings()
    expect(rows.map((r) => r.id)).toEqual(['demo-teacher', 'school-teacher', 'shop-goods'])
    expect(JSON.stringify(h.sellerWheres[0])).not.toContain('cat-teachers')
  })
})

describe('topBusinessListings — only listings dealt on eno (owner, 2026-10-28)', () => {
  it('a partner-link listing is never a flagship, however viewed: the business shows an in-app one', async () => {
    h.listings.push(listing('shop-tickets', 'shop', { views: 5_000, affiliateUrl: 'https://partner.example/t' }))
    const rows = await topBusinessListings()
    expect(rows.map((r) => r.id)).toEqual(['eno-goods', 'shop-goods'])
  })

  it('a storefront whose every live listing carries a partner link takes no slot; an empty link counts as none', async () => {
    h.sellers.push({ id: 'parks', trustScore: 125, business: true }, { id: 'blank', trustScore: 115, business: true })
    h.listings.push(
      listing('park-1', 'parks', { affiliateUrl: 'https://partner.example/1' }),
      listing('park-2', 'parks', { affiliateUrl: 'https://partner.example/2' }),
      listing('blank-1', 'blank', { affiliateUrl: '' }),
    )
    const rows = await topBusinessListings()
    expect(rows.map((r) => r.id)).toEqual(['eno-goods', 'shop-goods', 'blank-1'])
    expect(h.listingWheres.some((w) => JSON.stringify(w).includes('"parks"'))).toBe(false)
  })
})
