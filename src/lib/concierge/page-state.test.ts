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

import { FIND_CARDS, pageStateFor, rememberPageState, resetPageStateCache } from './page-state'

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
      { id: 'cl-1', title: 'Anna Smith', price: 'teacher profile', place: 'home: District 1, HCMC', facts: ['Native speaker: Native', 'Experience: 5–10 yrs', 'Can teach in: District 1'] },
      { id: 'cl-2', title: 'Ben Tran', price: 'expected salary 25 million đ/month', place: 'home: District 1, HCMC', facts: [] },
    ])
    expect(s.summary).toBe(
      'Explorer · category teachers · filters workIn=d1, native=native · 14 results · ' +
      '1) Anna Smith — teacher profile — home: District 1, HCMC — Native speaker: Native, Experience: 5–10 yrs, Can teach in: District 1 — id cl-1 · ' +
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

  it('prices in words through vnd.ts — a teacher\'s figure said for what it is: the expected monthly salary, or the hourly rate for cover lessons', async () => {
    h.payload.mockResolvedValue(feed(5, [
      card({ id: 't-salary', price: 30_000_000, priceUnit: 'VND/month' }),
      card({ id: 't-cover', price: 300_000, priceUnit: 'VND/hour' }),
      rental({ id: 'r-month', price: 8_500_000 }),
      rental({ id: 'r-free', price: 0, listingType: 'free', priceUnit: '' }),
      rental({ id: 'r-job', price: 0, listingType: 'job' }),
    ]))
    h.findMany.mockResolvedValue([
      { id: 't-salary', attributes: null, facetTokens: null, teacherProfile: { hideFromSearch: false, coverOpen: false, coverRateVnd: null, expectedSalaryM: 30, jobTypes: ['fulltime'] } },
      { id: 't-cover', attributes: null, facetTokens: null, teacherProfile: { hideFromSearch: false, coverOpen: true, coverRateVnd: 300_000, expectedSalaryM: null, jobTypes: [] } },
    ])
    const s = await pageStateFor('/?q=mixed', { lang: 'en' })
    expect(s.cards.map((c) => [c.id, c.price])).toEqual([
      ['t-salary', 'expected salary 30 million đ/month'],
      ['t-cover', 'hourly rate for cover lessons 300 thousand đ'],
      ['r-month', '8.5 million đ/month'],
      ['r-free', 'free'],
      ['r-job', 'salary not stated'],
    ])
  })

  it('a teacher\'s public figures as facts (owner, 2026-10-28: "it cant see the hourly rates of teachers"): the cover rate an hour when cover is public, the expected salary', async () => {
    h.payload.mockResolvedValue(feed(2, [card({ id: 't-both' }), card({ id: 't-private' })]))
    h.findMany.mockResolvedValue([
      { id: 't-both', attributes: null, facetTokens: '|native:native|workIn:d1|workIn:d3|workIn:d7|workIn:binh-thanh|', teacherProfile: { hideFromSearch: false, coverOpen: true, coverRateVnd: 350_000, expectedSalaryM: 35, jobTypes: ['fulltime'] } },
      { id: 't-private', attributes: null, facetTokens: null, teacherProfile: { hideFromSearch: false, coverOpen: false, coverRateVnd: 500_000, expectedSalaryM: 40, jobTypes: ['private'] } },
    ])
    const s = await pageStateFor('/?category=teachers', { lang: 'en' })
    const both = s.cards.find((c) => c.id === 't-both')!
    expect(both.facts).toContain('Hourly rate for cover lessons: 350 thousand đ')
    expect(both.facts).toContain('Expected salary: 35 million đ/month')
    // a multi-value facet: its first three values, then "and more"
    expect(both.facts).toContain('Can teach in: District 1, District 3, District 7 (Phu My Hung) and more')
    // cover not public: its rate is never said; no position wanted: the stored salary is never said either (commit review, opus)
    const priv = s.cards.find((c) => c.id === 't-private')!
    expect(priv.facts.join(' ')).not.toContain('500')
    expect(priv.facts.join(' ')).not.toContain('salary')
  })

  it('⛔ FULL profiles: the rate is never cut (figures first), and all five cards still fit the page summary — all ten the find\'s', async () => {
    const full = (i: number) => card({ id: `t-full${i}`, title: `Teacher Number ${i} With A Long Name` })
    const tokens = '|native:native|experience:5-10-years|subject:ielts|subject:business|workIn:d1|workIn:d3|workIn:d7|workIn:binh-thanh|ageGroup:adults|jobType:private|degree:bachelor|'
    const prof = { hideFromSearch: false, coverOpen: true, coverRateVnd: 350_000, expectedSalaryM: 35, jobTypes: ['fulltime'] }
    h.payload.mockResolvedValue(feed(30, Array.from({ length: 10 }, (_, i) => full(i))))
    h.findMany.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ id: `t-full${i}`, attributes: null, facetTokens: tokens, teacherProfile: prof })))
    const page = await pageStateFor('/?category=teachers', { lang: 'en' })
    expect(page.cards[0].facts[0]).toBe('Hourly rate for cover lessons: 350 thousand đ')
    expect(page.summary).toContain('5) Teacher Number 4')
    // every card keeps its id, whatever its facts had to give up (commit review, codex)
    for (let i = 0; i < 5; i++) expect(page.summary).toContain(`id t-full${i}`)
    expect(page.summary.length).toBeLessThanOrEqual(2_600)
    resetPageStateCache()
    const found = await pageStateFor('/?category=teachers', { lang: 'en', cards: FIND_CARDS })
    expect(found.summary).toContain('10) Teacher Number 9')
    for (let i = 0; i < 10; i++) expect(found.summary).toContain(`id t-full${i}`)
  })

  it('a FIND\'s read (cards: FIND_CARDS) asks the feed for ten and keeps ten — a longer summary room; a page read stays at five', async () => {
    const many = Array.from({ length: 12 }, (_, i) => rental({ id: `cl-r${i}`, title: `Flat ${i}` }))
    h.payload.mockResolvedValue(feed(40, many))
    h.findMany.mockResolvedValue([])
    const found = await pageStateFor('/?category=rentals&subcategory=apartment-rental', { lang: 'en', cards: FIND_CARDS })
    expect(new URLSearchParams(sent()).get('limit')).toBe(String(FIND_CARDS))
    expect(found.cards).toHaveLength(FIND_CARDS)
    expect(found.summary).toContain(`${FIND_CARDS}) Flat 9`)
    const page = await pageStateFor('/?category=rentals&subcategory=apartment-rental&district=d1', { lang: 'en' })
    expect(page.cards).toHaveLength(5)
  })

  it('⛔ an HOURLY BUDGET (a find\'s rateMax): every teacher open to cover is read and the listed rates that fit are kept, lowest first — past the first ten', async () => {
    // Twelve teachers in the feed's order: the one at 350 thousand is the TWELFTH — ten cards read in that order missed it
    // (commit review, codex + opus, rounds 2–7; 11 native teachers in District 1 on eno.vn, 2026-10-28).
    const ts = Array.from({ length: 12 }, (_, i) => card({ id: `t-r${i}`, title: `Teacher ${i}` }))
    const rateOf = (i: number) => (i === 11 ? 350_000 : i === 3 ? 400_000 : i === 5 ? 100_000 : 500_000)
    h.payload.mockResolvedValue(feed(12, ts))
    h.findMany.mockResolvedValue(ts.map((c, i) => ({
      id: c.id, attributes: null, facetTokens: null,
      // t-r5's 100 thousand is not public (cover closed): never kept
      teacherProfile: { hideFromSearch: false, coverOpen: i !== 5, coverRateVnd: rateOf(i), expectedSalaryM: null, jobTypes: [] },
    })))
    const s = await pageStateFor('/?category=teachers&attr_native=native&attr_workIn=d1', { lang: 'en', cards: FIND_CARDS, rateMax: 400_000 })
    const asked = new URLSearchParams(sent())
    expect(asked.get('limit')).toBe('100')
    expect(asked.get('attr_cover')).toBe('open')
    expect(asked.get('attr_native')).toBe('native')
    expect(s.cards.map((c) => c.id)).toEqual(['t-r11', 't-r3'])
    expect(s.total).toBe(2)
    expect(s.rateMax).toBe(400_000)
    expect(s.summary).toContain('only teachers whose listed hourly rate for cover lessons is at most 400 thousand đ, lowest first')
    expect(s.summary).toContain('· 2 results ·')
    expect(s.summary).not.toContain('checked')
  })

  it('an hourly budget reads PAST the feed\'s page cap (three reads at once): a fitting teacher 201st is found; past 300 it says how many it checked', async () => {
    const prof = (rate: number) => ({ hideFromSearch: false, coverOpen: true, coverRateVnd: rate, expectedSalaryM: null, jobTypes: [] })
    const at: Record<string, SerializedListingCard> = { '0': card({ id: 't-p0' }), '100': card({ id: 't-p1' }), '200': card({ id: 't-p2' }) }
    h.payload.mockImplementation(async (q: URLSearchParams) => feed(350, [at[q.get('offset') ?? '0']]))
    h.findMany.mockResolvedValue([
      { id: 't-p0', attributes: null, facetTokens: null, teacherProfile: prof(500_000) },
      { id: 't-p1', attributes: null, facetTokens: null, teacherProfile: prof(450_000) },
      { id: 't-p2', attributes: null, facetTokens: null, teacherProfile: prof(300_000) },
    ])
    const s = await pageStateFor('/?category=teachers', { lang: 'en', cards: FIND_CARDS, rateMax: 400_000 })
    expect(h.payload.mock.calls.map((c) => (c[0] as URLSearchParams).get('offset')).sort()).toEqual(['0', '100', '200'])
    expect(s.cards.map((c) => c.id)).toEqual(['t-p2'])
    expect(s.summary).toContain('the first 3 of 350 open to cover checked')
  })

  it('an hourly budget read by its corrected spelling reads its later pages by it too; five cards and ten are two reads (commit review, round 10)', async () => {
    h.correct.mockResolvedValue('james')
    h.payload.mockImplementation(async (q: URLSearchParams) => (q.get('q') === 'jmaes' ? feed(0, []) : feed(150, [card({ id: `t-s${q.get('offset')}` })])))
    h.findMany.mockResolvedValue([])
    await pageStateFor('/?category=teachers&q=jmaes', { lang: 'en', cards: FIND_CARDS, rateMax: 400_000 })
    const later = h.payload.mock.calls.map((c) => c[0] as URLSearchParams).filter((q) => q.get('offset') !== '0')
    expect(later.length).toBeGreaterThan(0)
    for (const q of later) expect(q.get('q')).toBe('james')
    h.correct.mockResolvedValue(null)
    h.payload.mockReset().mockResolvedValue(feed(1, [card({ id: 't-k0' })]))
    await pageStateFor('/?category=teachers', { lang: 'en', cards: 5, rateMax: 400_000 })
    await pageStateFor('/?category=teachers', { lang: 'en', cards: FIND_CARDS, rateMax: 400_000 })
    expect(h.payload).toHaveBeenCalledTimes(2)
  })

  it('an hourly budget whose rates could not be read is NOT READ (results not counted) — never "none fits" (commit review, opus, round 9)', async () => {
    h.payload.mockResolvedValue(feed(12, [card({ id: 't-x0' })]))
    h.findMany.mockRejectedValue(new Error('db down'))
    const s = await pageStateFor('/?category=teachers', { lang: 'en', cards: FIND_CARDS, rateMax: 400_000 })
    expect(s.total).toBeNull()
    expect(s.summary).toContain('results not counted')
    expect(s.rateMax).toBe(400_000)
  })

  it('an hourly budget\'s read is its own (another key) — the plain read of the view is asked again, without it; another shelf takes none', async () => {
    h.payload.mockResolvedValue(feed(1, [card({ id: 't-c0' })]))
    h.findMany.mockResolvedValue([{ id: 't-c0', attributes: null, facetTokens: null, teacherProfile: { hideFromSearch: false, coverOpen: true, coverRateVnd: 300_000, expectedSalaryM: null, jobTypes: [] } }])
    const capped = await pageStateFor('/?category=teachers', { lang: 'en', cards: FIND_CARDS, rateMax: 400_000 })
    expect(capped.summary).not.toContain('checked')
    const plain = await pageStateFor('/?category=teachers', { lang: 'en', cards: FIND_CARDS })
    expect(h.payload).toHaveBeenCalledTimes(2)
    expect(new URLSearchParams(sent(1)).get('attr_cover')).toBeNull()
    expect(plain.rateMax).toBeUndefined()
    h.payload.mockResolvedValue(feed(3, [rental()]))
    await pageStateFor('/?category=rentals', { lang: 'en', cards: FIND_CARDS, rateMax: 400_000 })
    expect(new URLSearchParams(sent(2)).get('limit')).toBe(String(FIND_CARDS))
  })

  it('an hourly card says the PROFILE\'s rate — the figure its facts say — when the card\'s copy lags (commit review, codex, round 6)', async () => {
    h.payload.mockResolvedValue(feed(1, [card({ id: 't-lag', price: 300_000, priceUnit: 'VND/hour' })]))
    h.findMany.mockResolvedValue([{ id: 't-lag', attributes: null, facetTokens: null, teacherProfile: { hideFromSearch: false, coverOpen: true, coverRateVnd: 500_000, expectedSalaryM: null, jobTypes: [] } }])
    const s = await pageStateFor('/?category=teachers', { lang: 'en' })
    expect(s.cards[0].price).toBe('hourly rate for cover lessons 500 thousand đ')
    expect(s.cards[0].facts[0]).toBe('Hourly rate for cover lessons: 500 thousand đ')
  })

  it('a card whose one figure is hourly reads "teacher profile" once cover is no longer public (commit review, opus)', async () => {
    h.payload.mockResolvedValue(feed(1, [card({ id: 't-stale', price: 300_000, priceUnit: 'VND/hour' })]))
    h.findMany.mockResolvedValue([{ id: 't-stale', attributes: null, facetTokens: null, teacherProfile: { hideFromSearch: false, coverOpen: false, coverRateVnd: 300_000, expectedSalaryM: null, jobTypes: [] } }])
    const s = await pageStateFor('/?category=teachers', { lang: 'en' })
    expect(s.cards[0].price).toBe('teacher profile')
  })

  it('a rental\'s facts come from its own facet values, labelled as the filter chips label them', async () => {
    h.payload.mockResolvedValue(feed(1, [rental()]))
    h.findMany.mockResolvedValue(rows([{ id: 'cl-r', attributes: '{"bedrooms":"2","furnishing":"fully","rentalPeriod":"monthly","landlordPhone":"0901234567"}' }]))
    const s = await pageStateFor('/?category=rentals', { lang: 'en' })
    expect(s.cards[0].facts).toEqual(['Bedrooms: 2 BR', 'Furnishing: Furnished', 'Rental period: Monthly'])
    expect(s.summary).not.toContain('0901234567')
  })

  it('titles are poster text — one line, at most 80 characters — and the summary has room for all five (never past 2,600)', async () => {
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
    expect(s.summary.length).toBeLessThanOrEqual(2_600)
    expect(s.summary).toContain('5) ')
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

describe('⛔ the viewer\'s blocked shops (App Store 1.2) — never read, described or opened', () => {
  const BLOCKED = ['shop-b', 'shop-a']

  it('an explorer read asks the feed as the viewer\'s own explorer does: `xs`, the blocked shops — so the count is that screen\'s', async () => {
    h.payload.mockResolvedValue(feed(7, []))
    await pageStateFor('/?category=teachers&attr_workIn=d1', { lang: 'en', hidden: BLOCKED })
    expect(sent().get('xs')).toBe('shop-a,shop-b')
    expect(sent().get('category')).toBe('teachers')
  })

  it('a viewer who blocked nothing sends no `xs` and shares the plain read; a blocker\'s read is their own (no shared cache entry)', async () => {
    h.payload.mockResolvedValue(feed(7, []))
    await pageStateFor('/?category=teachers', { lang: 'en' })
    await pageStateFor('/?category=teachers', { lang: 'en', hidden: [] })
    expect(h.payload).toHaveBeenCalledTimes(1)
    expect(sent().has('xs')).toBe(false)
    h.payload.mockResolvedValue(feed(5, []))
    expect((await pageStateFor('/?category=teachers', { lang: 'en', hidden: BLOCKED })).total).toBe(5)
    expect(h.payload).toHaveBeenCalledTimes(2)
    // The same blocks in another order are the same read; the plain read is still the plain one.
    await pageStateFor('/?category=teachers', { lang: 'en', hidden: ['shop-a', 'shop-b'] })
    expect(h.payload).toHaveBeenCalledTimes(2)
    expect((await pageStateFor('/?category=teachers', { lang: 'en' })).total).toBe(7)
  })

  it('an hourly-budget find carries `xs` too; at most MAX_HIDDEN_IN_QUERY, the newest first (the explorer\'s own cut); a malformed id never goes out', async () => {
    h.payload.mockResolvedValue(feed(0, []))
    const many = Array.from({ length: 101 }, (_, i) => `shop-${String(i).padStart(3, '0')}`)
    await pageStateFor('/?category=teachers', { lang: 'en', rateMax: 300_000, hidden: [...many, 'bad id"]'] })
    const xs = sent().get('xs')!.split(',')
    expect(xs).toHaveLength(100)
    expect(xs).not.toContain('shop-100')
    expect(xs.some((id) => id.includes('"'))).toBe(false)
    expect(sent().get('attr_cover')).toBe('open')
  })

  it('⛔ past the `xs` cut (more than MAX_HIDDEN_IN_QUERY blocks) a blocked shop\'s row that comes back is dropped — never described, the next card moves up as on the screen (commit review)', async () => {
    const many = Array.from({ length: 101 }, (_, i) => `shop-${String(i).padStart(3, '0')}`)
    h.payload.mockResolvedValue(feed(3, [rental({ id: 'cl-101', sellerId: 'shop-100' }), rental({ id: 'cl-ok', sellerId: 'shop-z' })]))
    h.findMany.mockResolvedValue(rows([{ id: 'cl-101' }, { id: 'cl-ok' }]))
    const s = await pageStateFor('/?category=rentals', { lang: 'en', hidden: many })
    expect(sent().get('xs')!.split(',')).not.toContain('shop-100')
    expect(s.cards.map((c) => c.id)).toEqual(['cl-ok'])
    expect(s.summary).not.toContain('cl-101')
    expect(s.total).toBe(3)
  })

  it('⛔ two viewers whose first hundred blocks match but whose others differ never share a read — either order (commit review, codex + opus)', async () => {
    const hundred = Array.from({ length: 100 }, (_, i) => `shop-${String(i).padStart(3, '0')}`)
    const viewerA = [...hundred, 'shop-x']
    const rowsX = [rental({ id: 'cl-x', sellerId: 'shop-x' }), rental({ id: 'cl-ok', sellerId: 'shop-z' })]
    for (const order of [['B', 'A'], ['A', 'B']]) {
      resetPageStateCache()
      h.payload.mockReset().mockResolvedValue(feed(2, rowsX))
      h.findMany.mockResolvedValue(rows([{ id: 'cl-x' }, { id: 'cl-ok' }]))
      const seen: Record<string, string[]> = {}
      for (const who of order) {
        const s = await pageStateFor('/?category=rentals', { lang: 'en', hidden: who === 'A' ? viewerA : hundred })
        seen[who] = s.cards.map((c) => c.id)
      }
      expect(seen.A, order.join('→')).toEqual(['cl-ok'])
      expect(seen.B, order.join('→')).toEqual(['cl-x', 'cl-ok'])
      expect(h.payload, order.join('→')).toHaveBeenCalledTimes(2)
    }
  })

  it('an id the query cannot carry (not a shop-id shape) still hides its rows — dropped after the read, never sent', async () => {
    h.payload.mockResolvedValue(feed(2, [rental({ id: 'cl-odd', sellerId: 'odd.id' }), rental({ id: 'cl-ok', sellerId: 'shop-z' })]))
    h.findMany.mockResolvedValue(rows([{ id: 'cl-odd' }, { id: 'cl-ok' }]))
    const s = await pageStateFor('/?category=rentals', { lang: 'en', hidden: ['odd.id'] })
    expect(sent().has('xs')).toBe(false)
    expect(s.cards.map((c) => c.id)).toEqual(['cl-ok'])
  })

  it('…and an hourly-budget find drops it too', async () => {
    const many = Array.from({ length: 101 }, (_, i) => `shop-${String(i).padStart(3, '0')}`)
    h.payload.mockResolvedValue(feed(1, [card({ id: 'cl-101', sellerId: 'shop-100' })]))
    h.findMany.mockResolvedValue([{ id: 'cl-101', attributes: null, facetTokens: null, teacherProfile: { hideFromSearch: false, coverOpen: true, coverRateVnd: 200_000, expectedSalaryM: null, jobTypes: [] } }])
    const s = await pageStateFor('/?category=teachers', { lang: 'en', rateMax: 300_000, hidden: many })
    expect(s.cards).toEqual([])
    expect(s.summary).not.toContain('cl-101')
  })

  it('a listing page of a blocked shop is named, never described — no card, so the guide cannot open it either', async () => {
    h.findFirst.mockResolvedValue({ ...rental({ id: 'cmblocked', sellerId: 'shop-a' }), attributes: null, facetTokens: null, teacherProfile: null })
    const s = await pageStateFor('/listings/cmblocked', { lang: 'en', hidden: BLOCKED })
    expect(s).toMatchObject({ kind: 'listing', cards: [], summary: 'Listing page · Rentals · (not described: a shop the person blocked)' })
    // Another viewer reads the same page described — the blocker's answer was not kept for them.
    const other = await pageStateFor('/listings/cmblocked', { lang: 'en' })
    expect(other.cards.map((c) => c.id)).toEqual(['cmblocked'])
    expect(h.findFirst).toHaveBeenCalledTimes(2)
  })

  it('a listing the viewer did NOT block is described as before, whatever else they blocked', async () => {
    h.findFirst.mockResolvedValue({ ...rental({ id: 'cmfine', sellerId: 'shop-z' }), attributes: null, facetTokens: null, teacherProfile: null })
    expect((await pageStateFor('/listings/cmfine', { lang: 'en', hidden: BLOCKED })).cards.map((c) => c.id)).toEqual(['cmfine'])
  })

  it('a view kept for the next turn (rememberPageState) is kept under the blocker\'s own key — never served to someone else', async () => {
    const mine: PageState = { href: '/?category=teachers', kind: 'explorer', category: 'teachers', subcategory: null, filters: {}, search: '', total: 3, cards: [], summary: 'mine' }
    rememberPageState(mine, { lang: 'en', hidden: BLOCKED })
    h.payload.mockResolvedValue(feed(9, []))
    expect((await pageStateFor('/?category=teachers', { lang: 'en' })).total).toBe(9)
    expect((await pageStateFor('/?category=teachers', { lang: 'en', hidden: BLOCKED })).total).toBe(3)
    expect(h.payload).toHaveBeenCalledTimes(1)
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

