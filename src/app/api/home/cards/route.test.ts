import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GET /api/home/cards — the home page's Outstanding-businesses cards, which its first paint does not draw and so sends as ids
 * (owner, 2026-11-17 — src/lib/home-lanes.ts slimHomeRails); the rail asks for them when it opens (business-rail.tsx).
 * Pinned: the rail's own public predicate (verified, active, dealt on eno, the edition scope — an id outside it is simply not
 * in the answer), the asked order, the cap, the language from the URL only, a public cache, and nothing for an unknown rail.
 * ⚠️ DATA SAFETY — the database, the edition scope and the translation cache are mocked by name.
 */
type Seller = { id: string; trustScore: number; owner: { accountType: string | null } }
type Row = { id: string; title: string; verified: boolean; status: string; affiliateUrl: string | null; sellerId: string; categoryId: string; seller: Seller }
type Where = Record<string, unknown>

const h = vi.hoisted(() => ({ rows: [] as Row[], wheres: [] as unknown[], langs: [] as Array<string | undefined> }))

/** Does `row` satisfy a WHERE written with equality, `in`, `notIn`, `not`, `gte`, AND, OR and a relation (`is`, or a nested object). */
function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'AND') return (v as Where[]).every((w) => matches(row, w))
    if (k === 'OR') return (v as Where[]).some((w) => matches(row, w))
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

vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findMany: async ({ where }: { where: Where }) => {
        h.wheres.push(where)
        // The database's own order, which is NOT the asked one.
        return h.rows.filter((r) => matches(r, where)).sort((a, b) => b.id.localeCompare(a.id))
      },
    },
  },
}))
// The edition's scope (a desk seller to keep out) and the teachers category, composed as edition-scope.ts scopedListingWhere does.
vi.mock('@/lib/edition-scope', () => ({
  scopedListingWhere: async (w: Where) => ({ AND: [w, { sellerId: { notIn: ['desk'] } }, { categoryId: { not: 'cat-teachers' } }] }),
  marketplaceListingScope: async () => ({ sellerId: { notIn: ['desk'] } }),
  teacherExclusion: async () => ({ categoryId: { not: 'cat-teachers' } }),
}))
vi.mock('@/lib/serialize', () => ({ serializeListing: (r: Row) => ({ id: r.id, title: r.title, description: 'long', descriptionVi: null }) }))
vi.mock('@/lib/translate', () => ({
  localizeListingTitles: async (rows: Array<{ title: string }>, lang?: string) => {
    h.langs.push(lang)
    return lang && lang !== 'en' && lang !== 'vi' ? rows.map((r) => ({ ...r, titleI18n: { [lang]: `${lang}:${r.title}` } })) : rows
  },
}))
vi.mock('@/lib/admin', () => ({ getAdmin: async () => null, getCurrentProfile: async () => null, getCurrentProfileId: async () => null }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))

import { NextRequest } from 'next/server'
const { GET } = await import('./route')

const seller = (id: string, trustScore = 80, accountType: string | null = 'business'): Seller => ({ id, trustScore, owner: { accountType } })
const row = (id: string, over: Partial<Row> = {}): Row =>
  ({ id, title: `Title ${id}`, verified: true, status: 'active', affiliateUrl: null, sellerId: 'shop', categoryId: 'cat-goods', seller: seller('shop'), ...over })

async function ask(query: string) {
  const res = await GET(new NextRequest(`https://eno.vn/api/home/cards${query}`))
  return { res, body: res.status === 200 ? ((await res.json()) as { cards: Array<{ id: string; title: string; titleI18n?: Record<string, string>; description?: string }> }) : null }
}

beforeEach(() => {
  h.wheres = []
  h.langs = []
  h.rows = [
    row('a'), row('b'), row('c'),
    row('sold', { status: 'sold' }),
    row('hidden', { verified: false }),
    row('linked', { affiliateUrl: 'https://partner.example/x' }),
    row('blank-link', { affiliateUrl: '' }),
    row('desk-row', { sellerId: 'desk', seller: seller('desk', 200) }),
    row('teacher', { categoryId: 'cat-teachers' }),
    // The seller pick's own condition: a business account, or trust 110 and above.
    row('personal', { sellerId: 'p', seller: seller('p', 80, 'personal') }),
    row('trusted', { sellerId: 't', seller: seller('t', 110, 'personal') }),
  ]
})

describe('GET /api/home/cards', () => {
  it('answers the asked ids in the ASKED order, as rail cards (no description), publicly cached', async () => {
    const { res, body } = await ask('?rail=businesses&ids=c,a,b&lang=en')
    expect(res.status).toBe(200)
    expect(body!.cards.map((c) => c.id)).toEqual(['c', 'a', 'b'])
    expect(body!.cards.every((c) => !('description' in c))).toBe(true)
    expect(res.headers.get('cache-control')).toBe('public, max-age=120, s-maxage=300, stale-while-revalidate=900')
  })

  it('⛔ the rail\'s public predicate: an id the rail could not show today is simply missing — never an error', async () => {
    const { body } = await ask('?rail=businesses&ids=sold,a,hidden,linked,blank-link,desk-row,teacher,personal,trusted,gone,b&lang=en')
    // '' counts as no link (in-app-listing.ts), so blank-link stays; every other excluded id leaves its place.
    expect(body!.cards.map((c) => c.id)).toEqual(['a', 'blank-link', 'trusted', 'b'])
    const where = JSON.stringify(h.wheres[0])
    expect(where).toContain('"verified":true')
    expect(where).toContain('"status":"active"')
    expect(where).toContain('"affiliateUrl":null')
  })

  it('dedupes, drops junk, and caps the ask at 16 ids', async () => {
    h.rows = Array.from({ length: 30 }, (_, i) => row(`id${String(i).padStart(2, '0')}`))
    const many = h.rows.map((r) => r.id)
    const { body } = await ask(`?rail=businesses&lang=en&ids=${['id00', 'id00', 'bad id', '<x>', ...many].join(',')}`)
    expect(body!.cards.map((c) => c.id)).toEqual(many.slice(0, 16))
    expect((h.wheres[0] as { AND: Array<{ AND: Array<{ id?: { in: string[] } }> }> }).AND[0].AND[0].id!.in).toHaveLength(16)
  })

  it('the reader\'s language from the URL, as one of the site\'s codes; anything else is the every-language answer', async () => {
    const { body } = await ask('?rail=businesses&ids=a&lang=KO')
    expect(body!.cards[0].titleI18n).toEqual({ ko: 'ko:Title a' })
    await ask('?rail=businesses&ids=a&lang=constructor')
    await ask('?rail=businesses&ids=a')
    expect(h.langs).toEqual(['ko', undefined, undefined])
  })

  it('no ids is an empty answer without a read; an unknown or missing rail is a 400', async () => {
    expect((await ask('?rail=businesses&ids=&lang=en')).body!.cards).toEqual([])
    expect(h.wheres).toEqual([])
    expect((await ask('?rail=trending&ids=a')).res.status).toBe(400)
    expect((await ask('?ids=a')).res.status).toBe(400)
    expect(h.wheres).toEqual([])
  })
})
