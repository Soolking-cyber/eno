import { existsSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { ConciergeAction, PageState } from '@/lib/concierge/types'
import { EDITION_BANNED } from '@/test/edition-words'
import { TEACHERS_COUNSEL_WORDS } from '@/test/teachers-counsel-words'

/**
 * THE CONCIERGE'S ACTION VALIDATOR (PLAN §3, §10; owner, 2026-10-27: "i say I need a teacher in district 1 it should open
 * right category select right filter"). Every worked example of the nav research (nav.md §6), built from an action, lands
 * on that URL; whatever the explorer would silently drop or empty is dropped here first; the caption names only what the
 * href carries.
 *
 * ⚠️ eno.vn's EDITION, IMPORTED AFTER THE STUB. The `/vi` twin exists only on the marketplace build (lang-pinned.ts
 * VI_PILOT) and vitest.config.ts pins 'services'. edition.ts reads the variable once, when it is first imported, so every
 * repo module comes in below the stub (the two word lists above import none of the repo).
 */
vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
const { CONCIERGE_PAGES, resolveAction } = await import('@/lib/concierge/actions')
const { CONCIERGE_CATEGORIES, CONCIERGE_HIDDEN_SUBCATEGORIES } = await import('@/lib/concierge/categories')
const { CONDITION_FACET, facetParamName, facetsFor, subcategoriesFor } = await import('@/lib/taxonomy')

const kv = (o: Record<string, string>) => Object.entries(o).map(([key, value]) => ({ key, value }))
const act = (a: Partial<ConciergeAction>): ConciergeAction => ({
  kind: 'browse', mode: 'replace', category: '', subcategory: '', filters: [], search: '', target: '', ...a,
})
/** A page that is not the explorer (a guide, the help center). */
const OFF: PageState = {
  href: '/help', kind: 'other', category: null, subcategory: null, filters: {}, search: '', total: null, cards: [], summary: '',
}
const explorer = (category: string, filters: Record<string, string> = {}, more: Partial<PageState> = {}): PageState => ({
  ...OFF, href: `/?category=${category}`, kind: 'explorer', category, filters, ...more,
})
const EN = { lang: 'en', listingIds: new Set<string>() }
const go = (a: Partial<ConciergeAction>, page: PageState = OFF, opts = EN) => resolveAction(act(a), page, opts)
const hrefOf = (a: Partial<ConciergeAction>, page: PageState = OFF) => go(a, page)?.href ?? null
/** An href as its path and its params: the order of the params is not part of the contract. */
const parsed = (href: string) => {
  const u = new URL(href, 'https://eno.vn')
  return { path: u.pathname, params: [...u.searchParams].sort(([a, x], [b, y]) => a.localeCompare(b) || x.localeCompare(y)) }
}
/**
 * nav.md's URL as the concierge builds it: a brand is not a catalog word (the brand list is data, validated only against
 * the database), so the brand's words travel as the search instead of `brand=` / `line=`.
 */
const brandAsWords = (url: string, q: string) => {
  const u = new URL(url, 'https://eno.vn')
  for (const k of ['brand', 'model', 'line']) u.searchParams.delete(k)
  u.searchParams.set('q', q)
  return `${u.pathname}?${u.searchParams}`
}

describe('find — the same view as a browse, read instead of opened (turn.ts)', () => {
  it('resolves exactly as the browse with the same fields would — and is refused where that browse is', () => {
    const fields: Partial<ConciergeAction> = { category: 'rentals', subcategory: 'apartment-rental', filters: kv({ district: 'd2', bedrooms: '2', sort: 'price-low' }) }
    expect(go({ ...fields, kind: 'find' })).toEqual(go({ ...fields, kind: 'browse' }))
    expect(parsed(go({ ...fields, kind: 'find' })!.href)).toEqual(parsed('/?category=rentals&subcategory=apartment-rental&district=d2&attr_bedrooms=2&sort=price-low'))
    expect(go({ kind: 'find', category: 'property-for-sale' })).toBeNull()
  })
})

describe('rateMax — a teacher\'s hourly budget, a find\'s key only (no explorer filter takes it)', () => {
  const NATIVE_D1 = { native: 'native', workIn: 'd1' }
  it('a find carries it, whole — never in the href, which is the browse\'s without it', () => {
    const r = go({ kind: 'find', category: 'teachers', filters: kv({ ...NATIVE_D1, rateMax: '400000' }) })!
    expect(r.rateMax).toBe(400_000)
    expect(r.partial).toBeUndefined()
    expect(r.href).not.toContain('rateMax')
    expect(parsed(r.href)).toEqual(parsed(go({ kind: 'browse', category: 'teachers', filters: kv(NATIVE_D1) })!.href))
  })

  it('a browse cannot apply it: partial — the find\'s own list shown again too (its words would claim the budget over every teacher)', () => {
    expect(go({ kind: 'browse', category: 'teachers', filters: kv({ ...NATIVE_D1, rateMax: '400000' }) })!.partial).toBe(true)
    const found = explorer('teachers', NATIVE_D1, { rateMax: 400_000 })
    const again = go({ kind: 'browse', category: 'teachers', filters: kv({ ...NATIVE_D1, rateMax: '400000' }) }, found)!
    expect(again.partial).toBe(true)
    expect(again.rateMax).toBeUndefined()
    // …and "any" removes nothing the screen had: whole
    expect(go({ kind: 'browse', category: 'teachers', filters: kv({ ...NATIVE_D1, rateMax: 'any' }) }, found)!.partial).toBeUndefined()
  })

  it('teachers only, whole dong in reach only — as the brain may write it', () => {
    expect(go({ kind: 'find', category: 'rentals', filters: kv({ rateMax: '400000' }) })!.partial).toBe(true)
    for (const v of ['400000', '400.000', '400,000', '400 000', '400k', '400K']) {
      expect(go({ kind: 'find', category: 'teachers', filters: kv({ ...NATIVE_D1, rateMax: v }) })!.rateMax, v).toBe(400_000)
    }
    for (const v of ['400', '0', '99000000', 'cheap', '4e5', '400.00']) {
      const r = go({ kind: 'find', category: 'teachers', filters: kv({ ...NATIVE_D1, rateMax: v }) })!
      expect(r.rateMax, v).toBeUndefined()
      expect(r.partial, v).toBe(true)
    }
  })
})

describe('browse — the worked examples of the nav research (nav.md §6)', () => {
  const EXAMPLES: { said: string; action: Partial<ConciergeAction>; url: string }[] = [
    {
      said: '1. I need a teacher in District 1, native, budget 30-40 million a month, for IELTS',
      action: { category: 'teachers', filters: kv({ district: 'd1', native: 'native', subject: 'ielts', salary: '30-40' }) },
      url: '/?category=teachers&attr_workIn=d1&attr_native=native&attr_subject=ielts&range_salaryM=30-40',
    },
    {
      said: '2. 2-bedroom apartment in District 2 under 15 million',
      action: { category: 'rentals', subcategory: 'apartment-rental', filters: kv({ district: 'd2', bedrooms: '2', priceMax: '15000000' }) },
      url: '/?category=rentals&subcategory=apartment-rental&district=d2&attr_bedrooms=2&priceMax=15000000',
    },
    {
      said: '3. Full-time English teaching job in Saigon paying at least 25 million',
      action: { category: 'jobs', subcategory: 'teaching', filters: kv({ type: 'job', jobtype: 'fulltime', salary: '25-', province: '79' }) },
      url: '/?category=jobs&subcategory=teaching&type=job&attr_jobtype=fulltime&range_salaryM=25-&province=79',
    },
    {
      said: '4. Honda scooter for sale under 20 million',
      action: { category: 'vehicles', subcategory: 'motorbike', filters: kv({ type: 'sell', bikeType: 'scooter', priceMax: '20000000' }), search: 'honda' },
      url: brandAsWords('/?category=vehicles&subcategory=motorbike&type=sell&brand=honda&attr_bikeType=scooter&priceMax=20000000', 'honda'),
    },
    {
      said: '5. Automatic motorbike to rent by the week near District 1',
      action: { category: 'rentals', subcategory: 'motorbike-rental', filters: kv({ transmission: 'automatic', rentalPeriod: 'weekly', district: 'd1' }) },
      url: '/?category=rentals&subcategory=motorbike-rental&attr_transmission=automatic&attr_rentalPeriod=weekly&district=d1',
    },
    {
      said: '6. Used iPhone 15 with 256GB under 15 million, cheapest first',
      action: {
        category: 'electronics', subcategory: 'phones-tablets', search: 'iphone 15',
        filters: kv({ storage: '256', condition: 'used', priceMax: '15000000', sort: 'price-low' }),
      },
      url: brandAsWords('/?category=electronics&subcategory=phones-tablets&brand=apple&line=iPhone%2015&attr_storage=256&condition=used&priceMax=15000000&sort=price-low', 'iphone 15'),
    },
    {
      said: '7. A cleaner who comes to my place in District 7, paid hourly',
      action: { category: 'services', subcategory: 'cleaning', filters: kv({ serviceLocation: 'at-customer', priceBasis: 'hourly', district: 'd7' }) },
      url: '/?category=services&subcategory=cleaning&attr_serviceLocation=at-customer&attr_priceBasis=hourly&district=d7',
    },
    {
      said: '8. A cover teacher free Monday evening in District 7',
      action: { category: 'teachers', filters: kv({ cover: 'open', coverSlot: 'mon-eve', coverArea: 'd7' }) },
      url: '/?category=teachers&attr_cover=open&attr_coverSlot=mon-eve&attr_coverArea=d7',
    },
    {
      // The owner, 2026-10-28: "if someone asks furnished apartment under 8 millions in district 1 it should filter and show
      // available" — "furnished" is the facet's own label (its value is `fully`).
      said: '9. A furnished apartment under 8 million in District 1',
      action: { category: 'rentals', subcategory: 'apartment-rental', filters: kv({ furnishing: 'Furnished', priceMax: '8000000', district: 'd1' }) },
      url: '/?category=rentals&subcategory=apartment-rental&district=d1&attr_furnishing=fully&priceMax=8000000',
    },
  ]

  it.each(EXAMPLES)('$said', ({ action, url }) => {
    const r = go(action)
    expect(r?.kind).toBe('browse')
    expect(parsed(r!.href)).toEqual(parsed(url))
  })

  it('⛔ the owner\'s acceptance test: "I need a teacher in District 1" → can teach in D1, with its caption', () => {
    expect(go({ category: 'teachers', filters: kv({ district: 'd1' }) })).toEqual({
      kind: 'browse', href: '/?category=teachers&attr_workIn=d1', label: 'Teachers · Can teach in: District 1', category: 'teachers',
    })
  })

  it('the caption names what the explorer\'s chips name: places by their names, money through vnd.ts, units in English', () => {
    expect(go(EXAMPLES[0].action)?.label).toBe(
      'Teachers · Can teach in: District 1 · Native speaker: Native · Subject: IELTS · Expected salary 30–40 million đ/month',
    )
    expect(go(EXAMPLES[1].action)?.label).toBe('Rentals · Apartment · District 2 (Thu Duc) · 2 BR · Price ≤ 15,000,000 đ')
    expect(go(EXAMPLES[2].action)?.label).toBe('Jobs · Teaching · Job · Ho Chi Minh · Type: Full-time · Salary ≥ 25 million đ/month')
    expect(go(EXAMPLES[3].action)?.label).toBe('Vehicles · Motorbike · For sale · "honda" · Bike type: Scooter · Price ≤ 20,000,000 đ')
    expect(go(EXAMPLES[7].action)?.label).toBe(
      'Teachers · Cover lessons: Available for cover · Free for cover: Monday evening · Cover area: District 7 (Phu My Hung)',
    )
    expect(go({ category: 'jobs', filters: kv({ priceMin: '5000000', priceMax: '9000000', sort: 'price-high' }) })?.label)
      .toBe('Jobs · Salary 5,000,000–9,000,000 đ · Salary: high to low')
  })
})

describe('browse — refine or replace (PLAN §10)', () => {
  const D1_NATIVE = explorer('teachers', { workIn: 'd1', native: 'native' })

  it('refine merges into the filters of the shelf already open: "native" after District 1 keeps both', () => {
    const r = go({ mode: 'refine', filters: kv({ native: 'native' }) }, explorer('teachers', { workIn: 'd1' }))
    expect(r?.href).toBe('/?category=teachers&attr_workIn=d1&attr_native=native')
    expect(r?.label).toBe('Teachers · Can teach in: District 1 · Native speaker: Native')
  })

  it('a value of `any` removes that filter (and so does the explorer\'s own `all`)', () => {
    expect(hrefOf({ mode: 'refine', filters: kv({ native: 'any' }) }, D1_NATIVE)).toBe('/?category=teachers&attr_workIn=d1')
    expect(hrefOf({ mode: 'refine', category: 'teachers', filters: kv({ native: 'all' }) }, D1_NATIVE)).toBe('/?category=teachers&attr_workIn=d1')
  })

  it('replace starts from the category: the old filters go', () => {
    expect(hrefOf({ mode: 'replace', category: 'teachers', filters: kv({ experience: '3-5-years' }) }, D1_NATIVE))
      .toBe('/?category=teachers&attr_experience=3-5-years')
    expect(hrefOf({ mode: 'replace', category: 'teachers' }, D1_NATIVE)).toBe('/?category=teachers')
  })

  it('refine onto ANOTHER shelf starts empty; refine off the explorer needs a category of its own', () => {
    expect(hrefOf({ mode: 'refine', category: 'rentals' }, D1_NATIVE)).toBe('/?category=rentals')
    expect(hrefOf({ mode: 'refine', category: 'teachers', filters: kv({ native: 'native' }) })).toBe('/?category=teachers&attr_native=native')
    expect(go({ mode: 'refine' })).toBeNull()
  })

  it('the page\'s subcategory and search ride along a refine; `any` clears either', () => {
    const page = explorer('rentals', { bedrooms: '2', rentalPeriod: 'monthly' }, { subcategory: 'apartment-rental', search: "levi's   loft" })
    expect(parsed(hrefOf({ mode: 'refine', filters: kv({ furnishing: 'fully' }) }, page)!)).toEqual(parsed(
      "/?category=rentals&subcategory=apartment-rental&q=levi's+loft&attr_bedrooms=2&attr_rentalPeriod=monthly&attr_furnishing=fully",
    ))
    // Leaving the subcategory prunes the facets that needed it (bedrooms); the shelf-wide one stays.
    expect(hrefOf({ mode: 'refine', subcategory: 'any', search: 'any' }, page)).toBe('/?category=rentals&attr_rentalPeriod=monthly')
  })

  it('⛔ nothing valid asked of the shelf already open → null (no navigation, the refusal line); elsewhere the shelf opens', () => {
    expect(go({ mode: 'refine', filters: kv({ native: 'yes' }) }, explorer('teachers'))).toBeNull()
    expect(go({ mode: 'refine', filters: kv({ priceMax: '20000000' }) }, explorer('teachers'))).toBeNull()
    expect(go({ mode: 'refine', subcategory: 'apartment-rental' }, explorer('teachers'))).toBeNull()
    expect(hrefOf({ category: 'teachers', filters: kv({ native: 'yes' }) })).toBe('/?category=teachers')
    // A no-op that refused nothing still answers (the screen already shows it).
    expect(hrefOf({ mode: 'refine' }, explorer('teachers', { workIn: 'd1' }))).toBe('/?category=teachers&attr_workIn=d1')
  })
})

describe('browse — commit review, round 1 (codex)', () => {
  it('a refine keeps what the catalog cannot name: brand, model, line, good prices, a ward with its province', () => {
    const phones = explorer('electronics', { condition: 'used' }, { subcategory: 'phones-tablets', keep: { brand: 'apple', line: 'iPhone 15', deal: 'good' } })
    const r = parsed(hrefOf({ mode: 'refine', filters: kv({ sort: 'price-low' }) }, phones)!)
    expect(r.params).toEqual(expect.arrayContaining([['brand', 'apple'], ['line', 'iPhone 15'], ['deal', 'good'], ['sort', 'price-low']]))
    const ward = explorer('rentals', { province: '79' }, { href: '/?category=rentals&subcategory=apartment-rental&province=79&ward=26734', subcategory: 'apartment-rental', keep: { ward: '26734' } })
    expect(parsed(hrefOf({ mode: 'refine', filters: kv({ furnishing: 'fully' }) }, ward)!).params).toEqual(expect.arrayContaining([['ward', '26734'], ['province', '79']]))
  })

  it('a replace, or another shelf, starts clean — nothing kept', () => {
    const phones = explorer('electronics', {}, { subcategory: 'phones-tablets', keep: { brand: 'apple' } })
    expect(parsed(hrefOf({ mode: 'replace', category: 'electronics', filters: kv({ sort: 'price-low' }) }, phones)!).params.map(([k]) => k)).not.toContain('brand')
    expect(parsed(hrefOf({ mode: 'refine', category: 'rentals' }, phones)!).params.map(([k]) => k)).not.toContain('brand')
  })

  it('⛔ a ward is kept only while its place is unchanged (codex, round 2: HCMC → Hanoi kept an HCMC ward)', () => {
    const ward = explorer('rentals', { province: '79' }, { href: '/?category=rentals&province=79&ward=26734', subcategory: 'apartment-rental', keep: { ward: '26734' } })
    const params = (a: Partial<ConciergeAction>) => parsed(hrefOf(a, ward)!).params
    expect(params({ mode: 'refine', filters: kv({ furnishing: 'fully' }) })).toEqual(expect.arrayContaining([['ward', '26734']]))
    expect(params({ mode: 'refine', filters: kv({ province: '01' }) }).map(([k]) => k)).not.toContain('ward')
    expect(params({ mode: 'refine', filters: kv({ province: 'any' }) }).map(([k]) => k)).not.toContain('ward')
  })

  it('a search the person typed that eno.vn may not say stays in the URL, off the caption (codex + opus, round 2)', () => {
    const r = go({ mode: 'refine', filters: kv({ sort: 'price-low' }) }, explorer('services', {}, { href: '/?category=services&q=visa', search: 'visa' }))
    expect(new URL(r!.href, 'https://eno.vn').searchParams.get('q')).toBe('visa')
    expect(r!.label.toLowerCase()).not.toContain('visa')
  })

  it('a resolve that dropped part of the action says so (`partial`); a whole one does not (review round 3)', () => {
    expect(go({ category: 'teachers', filters: kv({ workIn: 'd1' }) })?.partial).toBeUndefined()
    expect(go({ category: 'teachers', filters: kv({ workIn: 'd1', spaceship: 'yes' }) })).toMatchObject({ partial: true })
    expect(go({ category: 'services', search: 'visa' })).toMatchObject({ partial: true })
  })

  it('review round 4: a dropped multi pick, the page\'s e-Visa aisle left behind — both `partial`; all picks known — not', () => {
    expect(go({ category: 'rentals', subcategory: 'apartment-rental', filters: kv({ amenities: 'pool, balcony, jacuzzi' }) })).toMatchObject({ partial: true })
    expect(go({ category: 'rentals', subcategory: 'apartment-rental', filters: kv({ amenities: 'pool, balcony, Pool' }) })?.partial).toBeUndefined()
    expect(go({ mode: 'refine', filters: kv({ sort: 'price-low' }) }, explorer('services', {}, { subcategory: 'visa-legal' }))).toMatchObject({
      href: '/?category=services&sort=price-low', partial: true,
    })
  })

  it('brand, model and line stay only on their own aisle (review round 4, codex); good prices travel anywhere', () => {
    const phones = explorer('electronics', {}, { href: '/?category=electronics&subcategory=phones-tablets&brand=apple&line=iPhone+15&deal=good', subcategory: 'phones-tablets', keep: { brand: 'apple', line: 'iPhone 15', deal: 'good' } })
    const keys = (a: Partial<ConciergeAction>) => parsed(hrefOf(a, phones)!).params.map(([k]) => k)
    expect(keys({ mode: 'refine', filters: kv({ sort: 'price-low' }) })).toEqual(expect.arrayContaining(['brand', 'line', 'deal']))
    const other = subcategoriesFor('electronics').find((s) => s.slug !== 'phones-tablets')!.slug
    const moved = keys({ mode: 'refine', subcategory: other })
    expect(moved).not.toContain('brand')
    expect(moved).not.toContain('line')
    expect(moved).toContain('deal')
  })

  it('a refine keeps "any of the words" (match=any — review round 3, codex)', () => {
    const loose = explorer('electronics', {}, { href: '/?category=electronics&q=red+bike&match=any', search: 'red bike', keep: { match: 'any' } })
    expect(parsed(hrefOf({ mode: 'refine', filters: kv({ sort: 'price-low' }) }, loose)!).params).toEqual(expect.arrayContaining([['match', 'any'], ['q', 'red bike']]))
  })

  it('a search for a word eno.vn may not say is refused ("visa", "itinerary", "PayPal")', () => {
    for (const search of ['visa', 'e-visa services', 'itinerary', 'paypal']) {
      expect(hrefOf({ category: 'services', search }), search).toBe('/?category=services')
    }
  })
})

describe('browse — what the explorer would silently drop or empty is dropped here', () => {
  it('⛔ teachers: `district` is where they CAN TEACH (attr_workIn), any spelling of a place', () => {
    for (const d of ['d1', 'District 1', 'district-1', 'quận 1', 'quan-1']) {
      expect(hrefOf({ category: 'teachers', filters: kv({ district: d }) })).toBe('/?category=teachers&attr_workIn=d1')
    }
    expect(hrefOf({ category: 'teachers', filters: kv({ district: 'thao-dien' }) })).toBe('/?category=teachers&attr_workIn=d2')
    expect(hrefOf({ category: 'teachers', filters: kv({ district: 'Nha Trang' }) })).toBe('/?category=teachers&attr_workIn=khanh-hoa')
    expect(hrefOf({ category: 'teachers', filters: kv({ workIn: 'online' }) })).toBe('/?category=teachers&attr_workIn=online')
    // A comma list on a single facet matches nothing in the feed.
    expect(hrefOf({ category: 'teachers', filters: kv({ district: 'd1,d3' }) })).toBe('/?category=teachers')
  })

  it('⛔ teachers: a lives-in place on the page is replaced by the place the concierge sets, never ANDed with it', () => {
    const lives = explorer('teachers', { district: 'd1', native: 'native' })
    expect(go({ mode: 'refine', filters: kv({ subject: 'ielts' }) }, lives)?.label)
      .toBe('Teachers · Lives in District 1 · Native speaker: Native · Subject: IELTS')
    expect(hrefOf({ mode: 'refine', filters: kv({ district: 'd3' }) }, lives)).toBe('/?category=teachers&attr_native=native&attr_workIn=d3')
    expect(hrefOf({ mode: 'refine', filters: kv({ district: 'any' }) }, lives)).toBe('/?category=teachers&attr_native=native')
    // "Lives in" is not offered to the model.
    expect(hrefOf({ category: 'teachers', filters: kv({ province: '79' }) })).toBe('/?category=teachers')
  })

  it('⛔ teachers: never a price and never a price order — the budget is the expected salary', () => {
    expect(hrefOf({ category: 'teachers', filters: kv({ district: 'd1', priceMax: '20000000', priceMin: '1' }) }))
      .toBe('/?category=teachers&attr_workIn=d1')
    expect(hrefOf({ category: 'teachers', filters: kv({ sort: 'price-low' }) })).toBe('/?category=teachers')
    expect(hrefOf({ category: 'teachers', filters: kv({ sort: 'popular', salary: '-30' }) })).toBe('/?category=teachers&sort=popular&range_salaryM=-30')
  })

  it('a value outside the facet\'s options is dropped; a label or a spaced form of an option is that option', () => {
    expect(hrefOf({ category: 'teachers', filters: kv({ district: 'd1', native: 'yes' }) })).toBe('/?category=teachers&attr_workIn=d1')
    expect(hrefOf({ category: 'teachers', filters: kv({ native: 'Non native', experience: '1-3 years', cert: 'CELTA' }) }))
      .toBe('/?category=teachers&attr_native=non-native&attr_experience=1-3-years&attr_cert=celta')
    expect(hrefOf({ category: 'rentals', subcategory: 'apartment-rental', filters: kv({ furnishing: 'Furnished' }) }))
      .toBe('/?category=rentals&subcategory=apartment-rental&attr_furnishing=fully')
  })

  it('⚠️ keys are case-sensitive in the explorer: the case the view uses is the one written', () => {
    expect(hrefOf({ category: 'teachers', filters: kv({ jobtype: 'fulltime' }) })).toBe('/?category=teachers&attr_jobType=fulltime')
    expect(hrefOf({ category: 'jobs', filters: kv({ jobType: 'fulltime' }) })).toBe('/?category=jobs&attr_jobtype=fulltime')
    expect(hrefOf({ category: 'jobs', filters: kv({ colour: 'red' }) })).toBe('/?category=jobs')
  })

  it('⛔ a facet that needs a subcategory is dropped without it (rentals bedrooms needs apartment, house or room)', () => {
    expect(hrefOf({ category: 'rentals', filters: kv({ bedrooms: '2' }) })).toBe('/?category=rentals')
    expect(hrefOf({ category: 'rentals', subcategory: 'apartment-rental', filters: kv({ bedrooms: '2' }) }))
      .toBe('/?category=rentals&subcategory=apartment-rental&attr_bedrooms=2')
    expect(hrefOf({ category: 'rentals', subcategory: 'house-rental', filters: kv({ amenities: 'pool' }) }))
      .toBe('/?category=rentals&subcategory=house-rental')
  })

  it('ranges: min-max inside the facet\'s own bounds, either side open', () => {
    const salary = (v: string) => hrefOf({ category: 'teachers', filters: kv({ salary: v }) })
    expect(salary('30 - 40')).toBe('/?category=teachers&range_salaryM=30-40')
    expect(salary('25-')).toBe('/?category=teachers&range_salaryM=25-')
    for (const bad of ['200-', '40-30', '-', '30', '30-40 million', '30000000-40000000']) expect(salary(bad)).toBe('/?category=teachers')
    expect(hrefOf({ category: 'vehicles', subcategory: 'car', filters: kv({ engineL: '1.5-2.0' }) }))
      .toBe('/?category=vehicles&subcategory=car&range_engineL=1.5-2')
  })

  it('the one multi facet takes a list: its known options, canonical order, the rest dropped; one caption part per pick', () => {
    expect(go({ category: 'rentals', subcategory: 'apartment-rental', filters: kv({ amenities: 'pool, balcony, jacuzzi' }) })).toMatchObject({
      href: '/?category=rentals&subcategory=apartment-rental&attr_amenities=balcony%2Cpool',
      label: 'Rentals · Apartment · Amenities: Balcony · Amenities: Pool',
    })
    expect(hrefOf({ category: 'rentals', subcategory: 'apartment-rental', filters: kv({ amenities: 'jacuzzi' }) }))
      .toBe('/?category=rentals&subcategory=apartment-rental')
  })

  it('⛔ condition is the top-level param, only where the shelf has one; the intent must be the shelf\'s', () => {
    expect(hrefOf({ category: 'electronics', filters: kv({ condition: 'Used' }) })).toBe('/?category=electronics&condition=used')
    expect(hrefOf({ category: 'vehicles', filters: kv({ condition: 'used' }) })).toBe('/?category=vehicles')
    expect(hrefOf({ category: 'rentals', filters: kv({ type: 'rent' }) })).toBe('/?category=rentals&type=rent')
    expect(hrefOf({ category: 'rentals', filters: kv({ type: 'sell' }) })).toBe('/?category=rentals')
    expect(hrefOf({ category: 'rentals', filters: kv({ sort: 'cheapest' }) })).toBe('/?category=rentals')
  })

  it('prices are whole đồng (grouped digits are read); places are curated keys and VN_PROVINCES codes', () => {
    const rentals = (f: Record<string, string>) => hrefOf({ category: 'rentals', filters: kv(f) })
    expect(rentals({ priceMax: '15,000,000' })).toBe('/?category=rentals&priceMax=15000000')
    expect(rentals({ priceMin: '5.000.000' })).toBe('/?category=rentals&priceMin=5000000')
    for (const bad of ['15.5', '15 million', '-1', '15tr']) expect(rentals({ priceMax: bad })).toBe('/?category=rentals')
    expect(rentals({ province: 'Hà Nội' })).toBe('/?category=rentals&province=01')
    expect(rentals({ province: 'Ho Chi Minh', district: 'quan-7' })).toBe('/?category=rentals&district=d7&province=79')
    expect(rentals({ district: 'cau-giay' })).toBe('/?category=rentals')
    // A page's own place outside the curated list (a /c/rentals/cau-giay landing) rides along a refine; the reader's
    // `all` is no place at all.
    expect(hrefOf({ mode: 'refine', filters: kv({ type: 'rent' }) }, explorer('rentals', { district: 'cau-giay' })))
      .toBe('/?category=rentals&district=cau-giay&type=rent')
    expect(go({ mode: 'refine', filters: kv({ type: 'rent' }) }, explorer('rentals', { district: 'all', condition: 'all' })))
      .toMatchObject({ href: '/?category=rentals&type=rent', label: 'Rentals · For rent' })
  })

  it('⚠️ a place replaces a place, and a newer price bound a contradicting older one (both are empty feeds together)', () => {
    const page = explorer('rentals', { district: 'd1', province: '79', priceMin: '20000000' })
    expect(hrefOf({ mode: 'refine', filters: kv({ province: '01' }) }, page)).toBe('/?category=rentals&province=01&priceMin=20000000')
    expect(hrefOf({ mode: 'refine', filters: kv({ district: 'd3' }) }, explorer('rentals', { province: '01' })))
      .toBe('/?category=rentals&district=d3')
    expect(hrefOf({ mode: 'refine', filters: kv({ priceMax: '10000000' }) }, page))
      .toBe('/?category=rentals&district=d1&province=79&priceMax=10000000')
  })

  it('the model\'s search: ≤ 60 letters, digits, spaces and hyphens, else dropped', () => {
    expect(hrefOf({ category: 'vehicles', search: '  Honda   Air-Blade ' })).toBe('/?category=vehicles&q=Honda+Air-Blade')
    expect(hrefOf({ category: 'vehicles', search: 'xe máy cũ' })).toBe('/?category=vehicles&q=xe+m%C3%A1y+c%C5%A9')
    for (const bad of ['under 15,000,000', '<script>', 'x'.repeat(61)]) expect(hrefOf({ category: 'vehicles', search: bad })).toBe('/?category=vehicles')
  })

  it('⛔ unknown or unlinked categories open nothing', () => {
    expect(go({ category: 'spaceships' })).toBeNull()
    expect(go({ category: 'property' })).toBeNull()
    expect(go({ category: '' })).toBeNull()
  })

  it('⛔ a hidden (visa) subcategory is never opened or carried on', () => {
    expect(hrefOf({ category: 'services', subcategory: 'visa-legal' })).toBe('/?category=services')
    expect(hrefOf({ category: 'services', subcategory: 'e-Visa' })).toBe('/?category=services')
    expect(hrefOf({ category: 'tickets-travel', subcategory: 'visa-runs' })).toBe('/?category=tickets-travel')
    expect(hrefOf({ mode: 'refine', filters: kv({ sort: 'price-low' }) }, explorer('services', {}, { subcategory: 'visa-legal' })))
      .toBe('/?category=services&sort=price-low')
    // A subcategory by its name is that subcategory; another shelf's is none.
    expect(hrefOf({ category: 'rentals', subcategory: 'Apartment' })).toBe('/?category=rentals&subcategory=apartment-rental')
    expect(hrefOf({ category: 'rentals', subcategory: 'laptops-pcs' })).toBe('/?category=rentals')
  })

  it('every option of every facet the concierge may open round-trips, and no caption names a banned word', () => {
    const lost: string[] = []
    const banned: string[] = []
    for (const category of CONCIERGE_CATEGORIES) {
      const subs = ['', ...subcategoriesFor(category).map((s) => s.slug).filter((s) => !CONCIERGE_HIDDEN_SUBCATEGORIES.has(s))]
      for (const subcategory of subs) {
        for (const f of facetsFor(category, subcategory || null)) {
          const values = f.kind === 'range' && f.range ? [`${f.range.min}-${f.range.max}`] : f.options.map((o) => o.value)
          for (const value of values) {
            const r = go({ category, subcategory, filters: [{ key: f.key, value }] })
            const param = f.key === CONDITION_FACET.key ? 'condition' : facetParamName(f.key, category, subcategory)
            const got = r && new URL(r.href, 'https://eno.vn').searchParams.get(param)
            if (got !== value) lost.push(`${category}/${subcategory || '*'} ${f.key}=${value} → ${r?.href}`)
            const words = r?.label ?? ''
            if (EDITION_BANNED.test(words) || (category === 'teachers' && TEACHERS_COUNSEL_WORDS.test(words.normalize('NFC')))) banned.push(words)
          }
        }
      }
    }
    expect(lost).toEqual([])
    expect(banned).toEqual([])
  })
})

describe('listing and page', () => {
  const ID = 'cmh2x9k3a0001qz8l5v7b2n4d'
  const WITH_IDS = { lang: 'en', listingIds: new Set([ID, '../admin']) }

  it('⛔ a listing only by an id this turn\'s PAGE carried, and only a cuid', () => {
    expect(resolveAction(act({ kind: 'listing', target: ID }), OFF, WITH_IDS))
      .toEqual({ kind: 'listing', href: `/listings/${ID}`, label: 'Listing details' })
    expect(resolveAction(act({ kind: 'listing', target: 'cmh2x9k3a0001qz8l5v7b2n4e' }), OFF, WITH_IDS)).toBeNull()
    expect(resolveAction(act({ kind: 'listing', target: '../admin' }), OFF, WITH_IDS)).toBeNull()
  })

  it('a page from the fixed list; the ones the window cannot live on say so (the host closes it after navigating)', () => {
    expect(go({ kind: 'page', target: 'post' })).toEqual({ kind: 'page', href: '/post', label: 'Post a listing', closes: true })
    expect(go({ kind: 'page', target: 'teacher-join' })).toMatchObject({ href: '/teachers/join', closes: true })
    expect(go({ kind: 'page', target: 'messages' })).toMatchObject({ href: '/messages', closes: true })
    expect(go({ kind: 'page', target: 'help' })).toEqual({ kind: 'page', href: '/help', label: 'Help center', closes: false })
    for (const t of ['admin', 'visa', 'constructor', '__proto__', 'toString', '']) expect(go({ kind: 'page', target: t })).toBeNull()
  })

  it('every page path is a page of the app, on both editions (a page.tsx under src/app/[lang]/, not a forum-only .svc. file)', () => {
    for (const { path } of Object.values(CONCIERGE_PAGES)) {
      expect(existsSync(`src/app/[lang]${path === '/' ? '/(home)' : path}/page.tsx`), path).toBe(true)
    }
  })

  it('no page label is a banned or counsel word', () => {
    for (const { label } of Object.values(CONCIERGE_PAGES)) {
      expect(label).not.toMatch(EDITION_BANNED)
      expect(label).not.toMatch(TEACHERS_COUNSEL_WORDS)
    }
  })

  it('`none` is nothing to follow', () => {
    expect(go({ kind: 'none', category: 'teachers', target: 'post' })).toBeNull()
  })
})

describe('language', () => {
  const VI = { lang: 'vi', listingIds: new Set(['cmh2x9k3a0001qz8l5v7b2n4d']) }

  it('a Vietnamese reader on eno.vn gets the explorer\'s `/vi` twin; every other path negotiates and is never prefixed', () => {
    expect(resolveAction(act({ category: 'teachers', filters: kv({ district: 'd1' }) }), OFF, VI)?.href).toBe('/vi?category=teachers&attr_workIn=d1')
    expect(resolveAction(act({ kind: 'page', target: 'home' }), OFF, VI)?.href).toBe('/vi')
    expect(resolveAction(act({ kind: 'page', target: 'help' }), OFF, VI)?.href).toBe('/help')
    expect(resolveAction(act({ kind: 'listing', target: 'cmh2x9k3a0001qz8l5v7b2n4d' }), OFF, VI)?.href).toBe('/listings/cmh2x9k3a0001qz8l5v7b2n4d')
  })

  it('the machine-translated languages read the English variant', () => {
    for (const lang of ['ko', 'zh-Hans', 'xx']) {
      expect(resolveAction(act({ category: 'teachers' }), OFF, { lang, listingIds: new Set() })?.href).toBe('/?category=teachers')
    }
  })

  it('⛔ eno.forum has no `/vi` twin (its /vi is a 404): a Vietnamese reader there gets the plain URL', async () => {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'services')
    const forum = await import('@/lib/concierge/actions')
    expect(forum.resolveAction(act({ category: 'teachers', filters: kv({ district: 'd1' }) }), OFF, VI)?.href)
      .toBe('/?category=teachers&attr_workIn=d1')
    expect(forum.resolveAction(act({ kind: 'page', target: 'home' }), OFF, VI)?.href).toBe('/')
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
  })
})
