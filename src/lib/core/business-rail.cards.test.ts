import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE BY-ID READ IS THE RAIL'S OWN PREDICATE (commit gate, 2026-11-17 — business-rail.ts businessRailCards). The home page sends
 * "Outstanding businesses" as ids and the rail asks GET /api/home/cards for them; an id may answer only while its listing is one
 * topBusinessListings could pick. Pinned against ONE fake database that applies every WHERE the way Postgres would (equality,
 * in / notIn / not / gte, AND / OR, the seller relation and `listings.some`), on a fixture that fails each of the rail's
 * conditions once: the by-id read answers exactly the listings the rail's own two reads accept, and its WHERE is built from the
 * very objects those reads use.
 * ⚠️ DATA SAFETY — the database, the edition scope and the serializer are mocked by name.
 */
type Where = Record<string, unknown>
type Seller = { id: string; trustScore: number; reviewCount: number; owner: { accountType: string | null } }
type Row = { id: string; sellerId: string; categoryId: string; verified: boolean; status: string; views: number; affiliateUrl: string | null; seller?: Seller }

const h = vi.hoisted(() => ({
  sellers: [] as Seller[], listings: [] as Row[], sellerWhere: null as unknown, flagshipWheres: [] as unknown[], byIdWhere: null as unknown,
  /** The edition's listing scope (marketplaceListingScope): the desk's seller out, and an allow-list when one is set. */
  scope: {} as { sellerId?: { in?: string[]; notIn: string[] } },
}))

function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'AND') return (v as Where[]).every((w) => matches(row, w))
    if (k === 'OR') return (v as Where[]).some((w) => matches(row, w))
    if (k === 'listings') return h.listings.some((l) => l.sellerId === row.id && matches(l, (v as { some: Where }).some))
    if (v && typeof v === 'object') {
      const o = v as { in?: unknown[]; notIn?: unknown[]; not?: unknown; gte?: number; is?: Where }
      if (o.is) return matches(row[k] as Record<string, unknown>, o.is)
      if (o.in || o.notIn) return (!o.in || o.in.includes(row[k])) && (!o.notIn || !o.notIn.includes(row[k]))
      if ('not' in o) return row[k] !== o.not
      if (o.gte !== undefined) return (row[k] as number) >= o.gte
      return matches(row[k] as Record<string, unknown>, v as Where)
    }
    return row[k] === v
  })
}
const withSeller = (l: Row) => ({ ...l, seller: h.sellers.find((s) => s.id === l.sellerId)! })

vi.mock('@/lib/edition-scope', () => {
  const marketplaceListingScope = async () => h.scope
  const teacherExclusion = async () => ({ categoryId: { not: 'cat-teachers' } })
  // edition-scope.ts scopedListingWhere's own composition: the caller's where, then every part of the scope, then the teachers.
  const scopedListingWhere = async (w: Where) => ({ AND: [w, ...(h.scope.sellerId ? [{ sellerId: h.scope.sellerId }] : []), await teacherExclusion()] })
  return { marketplaceListingScope, teacherExclusion, scopedListingWhere }
})
vi.mock('@/lib/serialize', () => ({ serializeListing: (l: Row) => ({ id: l.id, sellerId: l.sellerId, description: 'Long text', descriptionVi: null }) }))
vi.mock('@/lib/db', () => ({
  db: {
    seller: {
      findMany: async ({ where, take }: { where: Where; take: number }) => {
        h.sellerWhere = where
        return h.sellers.filter((s) => matches(s, where)).sort((a, b) => b.trustScore - a.trustScore).slice(0, take).map((s) => ({ id: s.id }))
      },
    },
    listing: {
      findFirst: async ({ where }: { where: Where }) => {
        h.flagshipWheres.push(where)
        return h.listings.map(withSeller).filter((l) => matches(l, where)).sort((a, b) => b.views - a.views)[0] ?? null
      },
      findMany: async ({ where }: { where: Where }) => {
        h.byIdWhere = where
        return h.listings.map(withSeller).filter((l) => matches(l, where))
      },
    },
  },
}))

const { topBusinessListings, businessRailCards } = await import('./business-rail')

const listing = (id: string, sellerId: string, over: Partial<Row> = {}): Row =>
  ({ id, sellerId, categoryId: 'cat-goods', verified: true, status: 'active', views: 10, affiliateUrl: null, ...over })

beforeEach(() => {
  h.flagshipWheres = []
  h.scope = { sellerId: { notIn: ['desk'] } }
  h.sellers = [
    { id: 'biz', trustScore: 60, reviewCount: 0, owner: { accountType: 'business' } }, // a business account, any trust
    { id: 'trusted', trustScore: 120, reviewCount: 0, owner: { accountType: 'personal' } }, // Exceptional trust, personal
    { id: 'plain', trustScore: 100, reviewCount: 0, owner: { accountType: 'personal' } }, // neither: never featured
    { id: 'desk', trustScore: 200, reviewCount: 0, owner: { accountType: 'business' } }, // out of this edition's scope
  ]
  h.listings = [
    listing('biz-top', 'biz', { views: 50 }),
    listing('biz-other', 'biz', { views: 5 }), // live, a featured seller's — not its flagship, still a card the rail may show
    listing('biz-sold', 'biz', { status: 'sold', views: 99 }),
    listing('biz-hidden', 'biz', { verified: false, views: 98 }),
    listing('biz-linked', 'biz', { affiliateUrl: 'https://partner.example/x', views: 97 }),
    listing('biz-blank-link', 'biz', { affiliateUrl: '', views: 1 }),
    listing('biz-teacher', 'biz', { categoryId: 'cat-teachers', views: 96 }),
    listing('trusted-top', 'trusted', { views: 40 }),
    listing('plain-top', 'plain', { views: 30 }),
    listing('desk-top', 'desk', { views: 20 }),
  ]
})

describe('businessRailCards — the rail\'s own predicate, piece for piece', () => {
  it('answers exactly the listings the rail\'s two reads accept: every flagship, and nothing that fails one of its conditions', async () => {
    const top = await topBusinessListings()
    expect(top.map((l) => l.id)).toEqual(['trusted-top', 'biz-top'])
    const all = h.listings.map((l) => l.id)
    const cards = await businessRailCards(all)
    // Every flagship answers, as the same card…
    for (const t of top) expect(cards).toContainEqual(t)
    // …and exactly the listings that pass the flagship read's conditions AND the seller pick's (rank aside).
    expect(cards.map((c) => c.id)).toEqual(['biz-top', 'biz-other', 'biz-blank-link', 'trusted-top'])
    expect(cards.every((c) => !('description' in c))).toBe(true)
  })

  it("its WHERE is the rail's own objects, inside the WHOLE edition scope (scopedListingWhere's full output, at the listing level)", async () => {
    await topBusinessListings()
    await businessRailCards(['biz-top'])
    const flagship = (h.flagshipWheres[0] as { AND: unknown[] }).AND // [sellerId, LIVE, the teacher exclusion]
    const { listings: _some, id: _scope, ...featured } = h.sellerWhere as Where // { OR: FEATURED }
    expect(h.byIdWhere).toEqual({
      AND: [
        { AND: [{ id: { in: ['biz-top'] } }, flagship[1], { seller: { is: featured } }] },
        { sellerId: { notIn: ['desk'] } }, // marketplaceListingScope, whole
        flagship[2], // the teacher exclusion
      ],
    })
    // …and the seller pick's `listings.some` is exactly what this card itself meets.
    expect((h.sellerWhere as { listings: { some: unknown } }).listings.some).toEqual({ AND: [flagship[1], flagship[2]] })
  })

  it("⛔ an id outside the edition's scope is refused, whatever else it passes — the desk, and anything off an allow-list", async () => {
    // desk-top is live, in-app, a featured business's (trust 200): only the scope keeps it out.
    expect(await businessRailCards(['desk-top', 'biz-top'])).toEqual([{ id: 'biz-top', sellerId: 'biz' }])
    // An allow-list (MARKETPLACE_ALLOWED_OWNER_EMAILS) narrows it further: trusted-top is out too.
    h.scope = { sellerId: { in: ['biz'], notIn: ['desk'] } }
    expect((await businessRailCards(['trusted-top', 'desk-top', 'biz-top'])).map((c) => c.id)).toEqual(['biz-top'])
    expect((h.byIdWhere as { AND: unknown[] }).AND[1]).toEqual({ sellerId: { in: ['biz'], notIn: ['desk'] } })
  })

  it('keeps the asked order and reads nothing for no ids', async () => {
    expect((await businessRailCards(['trusted-top', 'biz-top'])).map((c) => c.id)).toEqual(['trusted-top', 'biz-top'])
    h.byIdWhere = null
    expect(await businessRailCards([])).toEqual([])
    expect(h.byIdWhere).toBeNull()
  })
})
