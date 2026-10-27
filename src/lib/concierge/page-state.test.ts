import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PageState } from '@/lib/concierge/types'
import type { SerializedListingCard } from '@/lib/types'

/**
 * The concierge's PAGE reader (page-state.ts). No database, no network: the feed's builder, the scope and the reads are
 * mocks, and every assertion is on what the reader asks them and what it makes of their answers. The edition is eno.vn's
 * (`/vi` is the explorer's Vietnamese twin only there — lang-pinned.ts).
 */

const h = vi.hoisted(() => ({
  payload: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  scope: vi.fn<(where: unknown, opts?: { teachers?: boolean }) => Promise<unknown>>(async (where) => where),
  logError: vi.fn(),
  /** spell-correct.ts's likely spelling (null = none) — its vocabulary is the database's. */
  correct: vi.fn<(q: string) => Promise<string | null>>(async () => null),
}))

vi.mock('@/lib/edition', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()), EDITION: 'marketplace', IS_SERVICES: false, IS_MARKETPLACE: true, SITE_NAME: 'eno.vn',
}))
vi.mock('@/app/api/listings/feed-payload', () => ({ buildFeedPayload: h.payload }))
vi.mock('@/lib/db', () => ({ db: { listing: { findFirst: h.findFirst, findMany: h.findMany } } }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: h.scope }))
// The listing read's row is handed over already in card shape, so the projection is the identity here.
vi.mock('@/lib/serialize', () => ({ LISTING_CARD_SELECT: {}, serializeListingCard: (row: unknown) => row }))
vi.mock('@/lib/log', () => ({ logError: h.logError }))
vi.mock('@/lib/spell-correct', () => ({ correctQuery: h.correct }))

import { pageStateFor, rememberPageState, resetPageStateCache } from './page-state'

const DEMO_TEACHER = 'cmuzccru60000wvq4mojalida'

function card(over: Partial<SerializedListingCard> = {}): SerializedListingCard {
  return {
    id: 'cl-1', sellerId: 'seller-1', title: 'Anna Smith', titleVi: null, price: 0, priceUnit: 'VND/month', currency: '₫',
    negotiable: false, isPartnerBooking: false, listingType: 'teacher', prevPrice: null, urgent: false, urgentUntil: null,
    location: 'District 1, Ho Chi Minh City', district: 'Quận 1', city: 'Hồ Chí Minh', lat: null, lng: null, images: [],
    brandSlug: null, model: null, condition: null, verified: true, postedAt: '2026-10-20T00:00:00.000Z', savedCount: 0,
    contactCount: 0, subcategorySlug: 'english',
    category: { id: 'cat-t', name: 'Teachers', nameVi: 'Giáo viên', slug: 'teachers', icon: 'GraduationCap', color: 'violet' },
    seller: { trustScore: 60, isBusiness: false },
    ...over,
  }
}

const rental = (over: Partial<SerializedListingCard> = {}) => card({
  id: 'cl-r', title: 'Studio 30m2 near Ben Thanh', listingType: 'rent', price: 12_500_000, subcategorySlug: 'apartment-rental',
  location: 'Hồ Chí Minh', category: { id: 'cat-r', name: 'Rentals', nameVi: 'Cho thuê', slug: 'rentals', icon: 'Home', color: 'sky' },
  ...over,
})

const feed = (total: number, listings: SerializedListingCard[], more: Record<string, unknown> = {}) =>
  ({ body: { total, listings, ...more }, cacheControl: 'public', histogram: false })

/** The cards' own rows (rowExtras): facet values and the teacher's search choice. */
const rows = (list: { id: string; facetTokens?: string; attributes?: string; hidden?: boolean }[]) =>
  list.map((r) => ({ id: r.id, attributes: r.attributes ?? null, facetTokens: r.facetTokens ?? null, teacherProfile: { hideFromSearch: r.hidden ?? false } }))

/** The params the n-th feed read was asked. */
const sent = (n = 0) => h.payload.mock.calls[n][0] as URLSearchParams

beforeEach(() => {
  resetPageStateCache()
  h.payload.mockReset()
  h.findFirst.mockReset()
  h.findMany.mockReset().mockResolvedValue([])
  h.scope.mockClear()
  h.logError.mockClear()
})

describe('the href — a same-origin path or nothing', () => {
  it.each([
    ['an absolute URL', 'https://evil.example/?category=teachers'],
    ['a protocol-relative URL', '//evil.example/?category=teachers'],
    ['a backslash path', '/\\evil.example'],
    ['a scheme', 'javascript:alert(1)'],
    ['no leading slash', 'listings/abc'],
    ['an empty string', ''],
    ['whitespace', '/?q=a b'],
    ['a control character', '/?q=a\u0007'],
    ['over 2,000 characters', `/?q=${'a'.repeat(2_000)}`],
  ])('%s → "Page: unknown", nothing read', async (_, href) => {
    expect(await pageStateFor(href, { lang: 'en' })).toEqual({
      href: '', kind: 'other', category: null, subcategory: null, filters: {}, search: '', total: null, cards: [], summary: 'Page: unknown',
    })
    expect(h.payload).not.toHaveBeenCalled()
    expect(h.findFirst).not.toHaveBeenCalled()
  })

  it('any other page is its path — never its query — and nothing is read', async () => {
    const s = await pageStateFor('/teach-in-vietnam/salary?token=abc#top', { lang: 'en' })
    expect(s).toMatchObject({ href: '/teach-in-vietnam/salary?token=abc#top', kind: 'other', total: null, cards: [], summary: 'Page: /teach-in-vietnam/salary' })
    // A listing's sub-page is not the listing, and a /vi twin exists only for the explorer.
    expect((await pageStateFor('/listings/cmabc/edit', { lang: 'en' })).kind).toBe('other')
    expect((await pageStateFor('/vi/listings/cmabc', { lang: 'en' })).kind).toBe('other')
    expect(h.payload).not.toHaveBeenCalled()
    expect(h.findFirst).not.toHaveBeenCalled()
  })
})

describe('the explorer — the page\'s own count, through the page\'s own request', () => {
  it('the owner\'s example: teachers who can teach in District 1, native — catalog filters and the explorer\'s request', async () => {
    h.payload.mockResolvedValue(feed(14, [card({ id: 'cl-1' }), card({ id: 'cl-2', title: ' Ben \n  Tran ', price: 25_000_000 })]))
    h.findMany.mockResolvedValue(rows([{ id: 'cl-1', facetTokens: '|workIn:d1|native:native|experience:5-10-years|' }, { id: 'cl-2' }]))
    const s = await pageStateFor('/?category=teachers&attr_workIn=d1&attr_native=native', { lang: 'en' })
    expect(s).toMatchObject({ href: '/?category=teachers&attr_workIn=d1&attr_native=native', kind: 'explorer', category: 'teachers', subcategory: null, search: '', total: 14 })
    expect(s.filters).toEqual({ workIn: 'd1', native: 'native' })
    expect(Object.fromEntries(sent())).toEqual({
      category: 'teachers', sort: 'newest', attr_workIn: 'd1', attr_native: 'native', limit: '5', offset: '0', facets: '0', lang: 'en',
    })
    expect(s.cards).toEqual([
      { id: 'cl-1', title: 'Anna Smith', price: 'teacher profile', place: 'home: District 1, HCMC', facts: ['Native speaker: Native', 'Experience: 5–10 yrs'] },
      { id: 'cl-2', title: 'Ben Tran', price: 'expected salary 25 million đ/month', place: 'home: District 1, HCMC', facts: [] },
    ])
    expect(s.summary).toBe(
      'Explorer · category teachers · filters workIn=d1, native=native · 14 results · ' +
      '1) Anna Smith — teacher profile — home: District 1, HCMC — Native speaker: Native, Experience: 5–10 yrs — id cl-1 · ' +
      '2) Ben Tran — expected salary 25 million đ/month — home: District 1, HCMC — id cl-2',
    )
    // The cards' own rows are read through the edition scope, teachers in.
    expect(h.scope).toHaveBeenCalledWith({ id: { in: ['cl-1', 'cl-2'] } }, { teachers: true })
  })

  it('a province code goes out as its English name (a code matches no row) and stays a code in the filters; a ward too', async () => {
    h.payload.mockResolvedValue(feed(3, []))
    const s = await pageStateFor('/?category=jobs&province=79&ward=25747', { lang: 'en' })
    expect(sent().get('province')).toBe('Ho Chi Minh')
    expect(sent().get('ward')).toBe('Thu Dau Mot')
    expect(s.filters).toEqual({ province: '79' })
    expect(s.summary).toBe('Explorer · category jobs · filters province=79 (Ho Chi Minh) · ward Thu Dau Mot · 3 results')
  })

  it('an HCMC district under another province is dropped, as the explorer drops it on mount; an unknown code is no place', async () => {
    h.payload.mockResolvedValue(feed(2, []))
    const s = await pageStateFor('/?category=services&province=01&district=d1', { lang: 'en' })
    expect(sent().get('district')).toBeNull()
    expect(sent().get('province')).toBe('Ha Noi')
    expect(s.filters).toEqual({ province: '01' })
    const t = await pageStateFor('/?category=services&province=99&district=d1', { lang: 'en' })
    expect(sent(1).get('province')).toBeNull()
    expect(sent(1).get('district')).toBe('d1')
    expect(t.filters).toEqual({ district: 'd1' })
  })

  it('a brand without a model or a subcategory BOOSTS its category, exactly as the explorer sends it', async () => {
    h.payload.mockResolvedValue(feed(0, []))
    await pageStateFor('/?category=electronics&brand=apple', { lang: 'en' })
    expect(sent().get('priorityCategory')).toBe('electronics')
    expect(sent().get('category')).toBeNull()
    await pageStateFor('/?category=electronics&subcategory=phones-tablets&brand=apple', { lang: 'en' })
    expect([sent(1).get('category'), sent(1).get('priorityCategory')]).toEqual(['electronics', null])
    const s = await pageStateFor('/?category=electronics&brand=apple&model=iPhone+15&line=iPhone', { lang: 'en' })
    expect(Object.fromEntries(sent(2))).toMatchObject({ category: 'electronics', brand: 'apple', model: 'iPhone 15', line: 'iPhone' })
    // Not catalog words — the summary names them.
    expect(s.filters).toEqual({})
    expect(s.summary).toBe('Explorer · category electronics · brand apple iPhone 15 iPhone · 0 results')
  })

  it('a facet the view does not offer is dropped from the filters AND the request (bedrooms need a subcategory)', async () => {
    h.payload.mockResolvedValue(feed(100, []))
    const a = await pageStateFor('/?category=rentals&attr_bedrooms=2', { lang: 'en' })
    expect(a.filters).toEqual({})
    expect(sent().get('attr_bedrooms')).toBeNull()
    const b = await pageStateFor(
      '/?category=rentals&subcategory=apartment-rental&attr_bedrooms=2&range_areaM2=50-&priceMax=15000000&sort=price-low&type=rent&condition=used&deal=good',
      { lang: 'en' },
    )
    expect(b.filters).toEqual({ bedrooms: '2', areaM2: '50-', priceMax: '15000000', sort: 'price-low', type: 'rent', condition: 'used' })
    expect(Object.fromEntries(sent(1))).toMatchObject({
      category: 'rentals', subcategory: 'apartment-rental', attr_bedrooms: '2', range_areaM2: '50-', priceMax: '15000000',
      sort: 'price-low', type: 'rent', condition: 'used', deal: 'good',
    })
    expect(b.subcategory).toBe('apartment-rental')
    expect(b.summary).toContain('good prices only')
  })

  it('the search words as the box reads them, and a district the feed read out of them', async () => {
    h.payload.mockResolvedValue(feed(5, [], { inferredDistrict: 'd7' }))
    const s = await pageStateFor('/?q=apartment+in+district+7', { lang: 'en' })
    expect(s.search).toBe('apartment in district 7')
    expect(sent().get('q')).toBe('apartment in district 7')
    expect(s.summary).toBe('Explorer · all categories · district d7 read from the search words · search "apartment in district 7" · 5 results')
  })

  it('⛔ the demo teacher and a teacher hidden from search engines are counted, never described — numbering stays the screen\'s', async () => {
    h.payload.mockResolvedValue(feed(9, [card({ id: DEMO_TEACHER, title: 'Demo Profile' }), card({ id: 'cl-2', title: 'Hidden Teacher' }), card({ id: 'cl-3', title: 'Cara Le' })]))
    h.findMany.mockResolvedValue(rows([{ id: DEMO_TEACHER }, { id: 'cl-2', hidden: true }, { id: 'cl-3' }]))
    const s = await pageStateFor('/?category=teachers', { lang: 'en' })
    expect(s.total).toBe(9)
    expect(s.cards.map((c) => c.id)).toEqual(['cl-3'])
    expect(s.summary).toContain('9 results · 1) (not described) · 2) (not described) · 3) Cara Le')
    expect(s.summary).not.toMatch(/Demo Profile|Hidden Teacher|cl-2|cmuzccru/)
  })

  it('⛔ when the cards\' rows cannot be read, no teacher is described; other cards keep what the card itself shows', async () => {
    h.payload.mockResolvedValue(feed(2, [card({ id: 'cl-1' }), rental({ condition: 'Used', brandSlug: 'ikea', goodPrice: true })]))
    h.findMany.mockRejectedValue(new Error('db down'))
    const s = await pageStateFor('/?q=desk', { lang: 'en' })
    expect(s.cards).toEqual([{ id: 'cl-r', title: 'Studio 30m2 near Ben Thanh', price: '12.5 million đ/month', place: 'District 1, HCMC', facts: ['Condition: Used', 'Brand: ikea', 'Good price'] }])
    expect(h.logError).toHaveBeenCalledWith(expect.any(Error), { op: 'concierge.page-state' })
  })

  it('prices in words through vnd.ts — a teacher\'s only figure is the expected monthly salary, never the cover rate', async () => {
    h.payload.mockResolvedValue(feed(5, [
      card({ id: 't-salary', price: 30_000_000, priceUnit: 'VND/month' }),
      card({ id: 't-cover', price: 300_000, priceUnit: 'VND/hour' }),
      rental({ id: 'r-month', price: 8_500_000 }),
      rental({ id: 'r-free', price: 0, listingType: 'free', priceUnit: '' }),
      rental({ id: 'r-job', price: 0, listingType: 'job' }),
    ]))
    h.findMany.mockResolvedValue(rows([{ id: 't-salary' }, { id: 't-cover' }]))
    const s = await pageStateFor('/?q=mixed', { lang: 'en' })
    expect(s.cards.map((c) => [c.id, c.price])).toEqual([
      ['t-salary', 'expected salary 30 million đ/month'],
      ['t-cover', 'teacher profile'],
      ['r-month', '8.5 million đ/month'],
      ['r-free', 'free'],
      ['r-job', 'salary not stated'],
    ])
  })

  it('a rental\'s facts come from its own facet values, labelled as the filter chips label them', async () => {
    h.payload.mockResolvedValue(feed(1, [rental()]))
    h.findMany.mockResolvedValue(rows([{ id: 'cl-r', attributes: '{"bedrooms":"2","furnishing":"fully","rentalPeriod":"monthly","landlordPhone":"0901234567"}' }]))
    const s = await pageStateFor('/?category=rentals', { lang: 'en' })
    expect(s.cards[0].facts).toEqual(['Bedrooms: 2 BR', 'Furnishing: Furnished', 'Rental period: Monthly'])
    expect(s.summary).not.toContain('0901234567')
  })

  it('titles are poster text — one line, at most 80 characters — and the summary never passes 900', async () => {
    const long = 'Căn hộ   cao cấp\nview sông '.repeat(12)
    const ids = ['cl-0', 'cl-1', 'cl-2', 'cl-3', 'cl-4']
    h.payload.mockResolvedValue(feed(50, ids.map((id) => rental({ id, title: long }))))
    h.findMany.mockResolvedValue(rows(ids.map((id) => ({ id, attributes: '{"bedrooms":"2","furnishing":"fully","rentalPeriod":"monthly"}' }))))
    const s = await pageStateFor('/?category=rentals', { lang: 'en' })
    expect(s.cards).toHaveLength(5)
    for (const c of s.cards) {
      expect(c.title.length).toBeLessThanOrEqual(80)
      expect(c.title).not.toMatch(/\s{2}|\n/)
      expect(c.title.endsWith('…')).toBe(true)
    }
    expect(s.summary.length).toBeLessThanOrEqual(900)
    expect(s.summary.endsWith(' · …')).toBe(true)
  })

  it('/vi is the explorer too, in Vietnamese: titles in the page\'s own column, a teacher\'s name never translated', async () => {
    h.payload.mockResolvedValue(feed(2, [rental({ id: 'r', title: 'Studio near Ben Thanh', titleVi: 'Studio gần Bến Thành' }), card({ id: 't', titleVi: 'Anna Xmít' })]))
    h.findMany.mockResolvedValue(rows([{ id: 't' }]))
    // The path pins the page's language (lang-pinned.ts), whatever the reader's own.
    const s = await pageStateFor('/vi?category=rentals', { lang: 'en' })
    expect(s.kind).toBe('explorer')
    expect(sent().get('lang')).toBe('vi')
    expect(s.cards.map((c) => c.title)).toEqual(['Studio gần Bến Thành', 'Anna Smith'])
  })
})

describe('the budget', () => {
  it('a read that misses it leaves what the URL says — total null, no cards — and lands in the cache for the next turn', async () => {
    const late = Promise.withResolvers<ReturnType<typeof feed>>()
    h.payload.mockReturnValue(late.promise)
    const s = await pageStateFor('/?category=teachers&attr_workIn=d1', { lang: 'en', timeoutMs: 5 })
    expect(s).toEqual({
      href: '/?category=teachers&attr_workIn=d1', kind: 'explorer', category: 'teachers', subcategory: null, filters: { workIn: 'd1' },
      search: '', keep: {}, total: null, cards: [], summary: 'Explorer · category teachers · filters workIn=d1 · results not counted',
    })
    late.resolve(feed(4, []))
    expect((await pageStateFor('/?category=teachers&attr_workIn=d1', { lang: 'en' })).total).toBe(4)
    expect(h.payload).toHaveBeenCalledTimes(1)
  })

  it('a read that fails is logged, answered with what the URL says, and asked again next turn', async () => {
    h.payload.mockRejectedValueOnce(new Error('desk unresolved')).mockResolvedValueOnce(feed(1, []))
    expect((await pageStateFor('/?category=rentals', { lang: 'en' })).total).toBeNull()
    expect(h.logError).toHaveBeenCalledWith(expect.any(Error), { op: 'concierge.page-state' })
    expect((await pageStateFor('/?category=rentals', { lang: 'en' })).total).toBe(1)
    expect(h.payload).toHaveBeenCalledTimes(2)
  })
})

describe('a listing page', () => {
  it('its public card, only when the edition scope admits it — teachers included', async () => {
    h.findFirst.mockResolvedValue({ ...rental({ id: 'cmlisting01' }), attributes: '{"bedrooms":"2","furnishing":"fully"}', facetTokens: null, teacherProfile: null })
    const s = await pageStateFor('/listings/cmlisting01', { lang: 'en' })
    expect(h.scope).toHaveBeenCalledWith({ id: 'cmlisting01', verified: true, status: 'active' }, { teachers: true })
    expect(s).toMatchObject({ href: '/listings/cmlisting01', kind: 'listing', category: null, filters: {}, total: null })
    expect(s.cards).toEqual([
      { id: 'cmlisting01', title: 'Studio 30m2 near Ben Thanh', price: '12.5 million đ/month', place: 'District 1, HCMC', facts: ['Bedrooms: 2 BR', 'Furnishing: Furnished'] },
    ])
    expect(s.summary).toBe('Listing page · Rentals · Studio 30m2 near Ben Thanh — 12.5 million đ/month — District 1, HCMC — Bedrooms: 2 BR, Furnishing: Furnished — id cmlisting01')
  })

  it('a listing the public cannot open here is only its path', async () => {
    h.findFirst.mockResolvedValue(null)
    expect(await pageStateFor('/listings/cmgone', { lang: 'en' })).toMatchObject({ kind: 'other', cards: [], summary: 'Page: /listings/cmgone' })
  })

  it('⛔ a teacher who asked search engines not to list them: the page is named, never described', async () => {
    h.findFirst.mockResolvedValue({ ...card({ id: 'cmteacher' }), attributes: null, facetTokens: '|native:native|', teacherProfile: { hideFromSearch: true } })
    expect(await pageStateFor('/listings/cmteacher', { lang: 'en' })).toMatchObject({ kind: 'listing', cards: [], summary: 'Listing page · Teachers · (not described)' })
  })
})

describe('the cache', () => {
  it('two spellings of one view share one read; a minute later the view is read again', async () => {
    h.payload.mockResolvedValue(feed(3, []))
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-10-27T05:00:00Z'))
      await pageStateFor('/?category=teachers&attr_workIn=d1', { lang: 'en' })
      const again = await pageStateFor('/?attr_workIn=d1&category=teachers&utm_source=zalo#listings', { lang: 'en' })
      expect(again.href).toBe('/?attr_workIn=d1&category=teachers&utm_source=zalo#listings')
      expect(again.total).toBe(3)
      expect(h.payload).toHaveBeenCalledTimes(1)
      vi.setSystemTime(new Date('2026-10-27T05:01:01Z'))
      await pageStateFor('/?category=teachers&attr_workIn=d1', { lang: 'en' })
      expect(h.payload).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a listing page is kept per language (its title column follows the reader there)', async () => {
    h.findFirst.mockResolvedValue(null)
    await pageStateFor('/listings/cmx', { lang: 'en' })
    await pageStateFor('/listings/cmx', { lang: 'en' })
    await pageStateFor('/listings/cmx', { lang: 'vi' })
    expect(h.findFirst).toHaveBeenCalledTimes(2)
  })

  it('rememberPageState makes the next read of that page instant; an uncounted view is not kept', async () => {
    const warmed: PageState = {
      href: '/?category=teachers&attr_native=native', kind: 'explorer', category: 'teachers', subcategory: null, filters: { native: 'native' },
      search: '', total: 7, cards: [], summary: 'Explorer · category teachers · filters native=native · 7 results',
    }
    // No language needed for an explorer view: its path pins the page's (`/` English, `/vi` Vietnamese).
    rememberPageState(warmed)
    expect(await pageStateFor('/?attr_native=native&category=teachers', { lang: 'vi' })).toEqual({ ...warmed, href: '/?attr_native=native&category=teachers' })
    expect(h.payload).not.toHaveBeenCalled()
    rememberPageState({ ...warmed, href: '/?category=rentals', total: null })
    h.payload.mockResolvedValue(feed(1, []))
    await pageStateFor('/?category=rentals', { lang: 'en' })
    expect(h.payload).toHaveBeenCalledTimes(1)
  })

  it('a listing page is kept only under a language the caller names (its titles follow the reader there)', async () => {
    const listing: PageState = {
      href: '/listings/cmkept', kind: 'listing', category: null, subcategory: null, filters: {}, search: '', total: null, cards: [], summary: 'kept',
    }
    h.findFirst.mockResolvedValue(null)
    rememberPageState(listing)
    expect((await pageStateFor('/listings/cmkept', { lang: 'en' })).summary).toBe('Page: /listings/cmkept')
    rememberPageState(listing, { lang: 'vi' })
    expect((await pageStateFor('/listings/cmkept', { lang: 'vi' })).summary).toBe('kept')
    expect(h.findFirst).toHaveBeenCalledTimes(1)
  })

  it('a caller cannot change what the cache holds', async () => {
    h.payload.mockResolvedValue(feed(1, [rental()]))
    const first = await pageStateFor('/?category=rentals', { lang: 'en' })
    first.cards[0].title = 'changed'
    first.filters.district = 'd9'
    const second = await pageStateFor('/?category=rentals', { lang: 'en' })
    expect(second.cards[0].title).toBe('Studio 30m2 near Ben Thanh')
    expect(second.filters).toEqual({})
  })

  it('holds 200 pages at most, the oldest dropped first', async () => {
    const page = (i: number): PageState => ({
      href: `/listings/cm${i}`, kind: 'listing', category: null, subcategory: null, filters: {}, search: '', total: null, cards: [], summary: `kept ${i}`,
    })
    for (let i = 0; i <= 200; i++) rememberPageState(page(i), { lang: 'en' })
    h.findFirst.mockResolvedValue(null)
    expect((await pageStateFor('/listings/cm200', { lang: 'en' })).summary).toBe('kept 200')
    expect((await pageStateFor('/listings/cm1', { lang: 'en' })).summary).toBe('kept 1')
    expect(h.findFirst).not.toHaveBeenCalled()
    expect((await pageStateFor('/listings/cm0', { lang: 'en' })).summary).toBe('Page: /listings/cm0')
    expect(h.findFirst).toHaveBeenCalledTimes(1)
  })
})

describe('pageStateFor — the explorer\'s spelling retry (commit review, codex)', () => {
  it('a search that finds nothing is counted for its likely spelling — the set the screen shows', async () => {
    resetPageStateCache()
    h.correct.mockResolvedValueOnce('iphone')
    h.payload.mockImplementation(async (p: URLSearchParams) => (p.get('q') === 'iphone' ? feed(3, []) : feed(0, [])))
    const s = await pageStateFor('/?q=iphnoe', { lang: 'en' })
    expect(s.total).toBe(3)
    expect(s.search).toBe('iphnoe')
    expect(s.summary).toContain('nothing found as typed — the screen shows the results for "iphone"')
    h.payload.mockReset()
  })

  it('no retry when the search finds something, names a district, or has no better spelling — and a retry that finds nothing is the zero', async () => {
    for (const [href, total, fixed] of [['/?q=iphone', 4, 'x'], ['/?q=quan+7', 0, 'x'], ['/?q=zzzq', 0, null], ['/?q=iphnoe', 0, 'iphone']] as const) {
      resetPageStateCache()
      h.correct.mockReset()
      h.correct.mockResolvedValue(fixed)
      h.payload.mockReset()
      h.payload.mockResolvedValue(feed(total, []))
      const s = await pageStateFor(href, { lang: 'en' })
      expect(s.total, href).toBe(total)
      expect(s.summary, href).not.toContain('nothing found as typed')
    }
    expect(h.correct).toHaveBeenCalledTimes(1) // only the last: the others never asked
    h.correct.mockReset()
    h.correct.mockResolvedValue(null)
    h.payload.mockReset()
  })
})

describe('pageStateFor — "any of the words" travels in keep (review round 3, codex)', () => {
  it('match=any → keep.match', async () => {
    resetPageStateCache()
    h.payload.mockResolvedValue(feed(2, []))
    expect((await pageStateFor('/?q=red+bike&match=any', { lang: 'en' })).keep).toMatchObject({ match: 'any' })
    resetPageStateCache()
    expect((await pageStateFor('/?q=red+bike', { lang: 'en' })).keep?.match).toBeUndefined()
    h.payload.mockReset()
  })
})

