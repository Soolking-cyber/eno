import { describe, expect, it } from 'vitest'
import { parseSearchQuery, REL, scoreRow, wordStart, type RelevanceRow } from './text-relevance'
import { searchScore } from './ranking-formula'

/**
 * GOLDEN ROWS, shaped like the production rows measured 2026-09-29 (S-RANK). q=iphone opened on a
 * Viettel eSIM and an Under Armour tote bag — each mentions an iPhone only in its description — and
 * q=honda on a pressure washer; q=sofa had a mattress vacuum at #3. Relevance reads the title, the
 * Vietnamese title, the model, the brand and the category, never the description, so those rows are
 * WEAK and every row that names the thing is STRONG.
 */
const row = (r: Partial<RelevanceRow> & { title: string; category: RelevanceRow['category'] }): RelevanceRow =>
  ({ titleVi: null, model: null, brandSlug: null, subcategorySlug: null, ...r })

const SERVICES = { slug: 'services', name: 'Services', nameVi: 'Dịch vụ' }
const ELECTRONICS = { slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' }
const SPORTS = { slug: 'sports', name: 'Sports', nameVi: 'Thể thao' }
const HOME = { slug: 'home-living', name: 'Home & Living', nameVi: 'Nhà cửa' }

const esim = row({ title: 'Viettel eSIM 5GB/day — 30 days', subcategorySlug: 'esim', category: SERVICES })
const tote = row({ title: 'Under Armour Tote Bag', brandSlug: 'under-armour', category: SPORTS })
const iphone = row({ title: 'iPhone 18 Pro 256GB', brandSlug: 'apple', model: 'iPhone 18 Pro', subcategorySlug: 'phones-tablets', category: ELECTRONICS })
const lens = row({ title: 'Mipow Camera Lens Protector for iPhone 15', brandSlug: 'mipow', subcategorySlug: 'screen-protectors', category: ELECTRONICS })
const sofa = row({ title: 'Used Sofa Bench', subcategorySlug: 'sofa-seating', category: HOME })
const vacuum = row({ title: 'AQUA mattress vacuum cleaner', brandSlug: 'aqua', category: HOME })
const washerHonda = row({ title: 'HD350A Pressure Washer HONDA engine', brandSlug: 'honda', category: HOME })
const washerOther = row({ title: 'SK9070 Car Washer', category: HOME })
const fridgeVi = row({ title: 'Samsung refrigerator 300L', titleVi: 'Tủ lạnh Samsung 300L', brandSlug: 'samsung', category: HOME })

const score = (r: RelevanceRow, q: string) => scoreRow(r, parseSearchQuery(q))
/** searchScore at equal trust and recency — the order the keyword path serves. */
const at = (r: RelevanceRow, q: string) => searchScore({ relevance: score(r, q).relevance, sellerTrustScore: 100, postedAt: new Date(0) }, 0)

describe('scoreRow — strong means the row itself names the thing', () => {
  it('iphone: the phone and the iPhone accessory are strong; the eSIM and the tote are weak', () => {
    expect(score(iphone, 'iphone').strong).toBe(true)
    expect(score(lens, 'iphone').strong).toBe(true)
    expect(score(esim, 'iphone').strong).toBe(false)
    expect(score(tote, 'iphone').strong).toBe(false)
  })

  it('iphone: the phone outranks the accessory that merely fits it, at equal trust and recency', () => {
    expect(at(iphone, 'iphone')).toBeGreaterThan(at(lens, 'iphone'))
    expect(score(iphone, 'iphone').relevance).toBeLessThanOrEqual(1)
  })

  it('sofa: the sofa is strong, the vacuum is not', () => {
    expect(score(sofa, 'sofa').strong).toBe(true)
    expect(score(vacuum, 'sofa').strong).toBe(false)
  })

  it('honda: the row that says Honda (title or brand) is strong, the washer that only mentions it is not', () => {
    expect(score(washerHonda, 'honda').strong).toBe(true)
    expect(score(washerOther, 'honda').strong).toBe(false)
  })

  it('an accent-free query finds the Vietnamese title ("tu lanh" → "Tủ lạnh Samsung")', () => {
    expect(score(fridgeVi, 'tu lanh').strong).toBe(true)
    // …and its English synonym in the title counts too, a little less than the typed words.
    expect(score(row({ title: 'Fridge Toshiba 180L', category: HOME }), 'tu lanh').strong).toBe(true)
  })

  it('a synonym counts SYNONYM_FACTOR of the typed word, so "condo" prefers a row that says "condo"', () => {
    const rentals = { slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê' }
    const says = row({ title: 'Condo 2BR Thao Dien', category: rentals })
    const synonym = row({ title: 'Apartment 2BR Thao Dien', category: rentals })
    expect(score(synonym, 'condo').strong).toBe(true)
    expect(score(says, 'condo').relevance).toBeGreaterThan(score(synonym, 'condo').relevance)
  })

  it('every unit must find evidence: "honda red" is weak on a Honda that is not red', () => {
    expect(score(washerHonda, 'honda red').strong).toBe(false)
    expect(score(row({ title: 'Honda Vision red 2022', category: HOME }), 'honda red').strong).toBe(true)
  })

  it('a weak unit adds DESC_ONLY, a phrase in order adds PHRASE_BONUS, and relevance stays in [0, 1]', () => {
    expect(score(esim, 'iphone').relevance).toBeCloseTo(REL.DESC_ONLY / REL.MAX_PER_UNIT)
    const inOrder = score(row({ title: 'Honda Vision 2022', category: HOME }), 'honda vision').relevance
    const reversed = score(row({ title: 'Vision by Honda 2022', category: HOME }), 'honda vision').relevance
    expect(inOrder - reversed).toBeGreaterThanOrEqual(REL.PHRASE_BONUS - 1e-9)
    for (const r of [iphone, lens, sofa, fridgeVi]) expect(score(r, 'iphone sofa tu lanh').relevance).toBeLessThanOrEqual(1)
  })

  it('an empty query is never strong', () => {
    expect(score(iphone, '')).toEqual({ relevance: 0, strong: false, matchClass: 'aside' })
  })
})

/**
 * ⛔ home-09 (UX program 2): "tủ lạnh" and "fridge" opened on air conditioners — filed in the aisle the
 * word names, strong on the aisle alone, and lifted by their sellers' trust. The aisle is still
 * evidence (they stay strong), but only a row that NAMES every word is in the 'title' tier.
 */
describe('scoreRow — matchClass', () => {
  const aircon = row({ title: 'Daikin inverter air conditioner 1HP', titleVi: 'Máy lạnh Daikin 1HP', brandSlug: 'daikin', subcategorySlug: 'white-goods', category: HOME })
  const fridge = row({ title: 'Toshiba refrigerator 180L', titleVi: 'Tủ lạnh Toshiba 180L', brandSlug: 'toshiba', subcategorySlug: 'white-goods', category: HOME })

  it('a fridge is title-tier for "tủ lạnh" and "fridge"; an aircon in the same aisle is strong but aside', () => {
    for (const q of ['tủ lạnh', 'tu lanh', 'fridge']) {
      expect(score(fridge, q)).toMatchObject({ strong: true, matchClass: 'title' })
      expect(score(aircon, q)).toMatchObject({ strong: true, matchClass: 'aside' })
    }
  })

  it('a model or brand hit names the thing; a description-only row is aside', () => {
    expect(score(iphone, 'iphone').matchClass).toBe('title')
    expect(score(washerHonda, 'honda').matchClass).toBe('title')
    expect(score(esim, 'iphone').matchClass).toBe('aside')
  })

  /**
   * Review, 2026-10-04: a row filed in the aisle whose NAME is the word names the thing too. Without it
   * "điện thoại" put a phone case above every iPhone in Phones (“Điện thoại”), "laptop" a stand above the
   * MacBooks in Laptops (“Laptop”), "xe máy" rentals and helmets above the motorbikes for sale.
   * The aisle's KEYWORDS still do not count: Appliances (“Điện máy”) lists 'tủ lạnh', and an aircon is
   * not a fridge. Real taxonomy slugs, so the aisle names are the ones production reads.
   */
  describe("the row's own aisle, by name", () => {
    const EL = { slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' }
    const VEH = { slug: 'vehicles', name: 'Vehicles', nameVi: 'Xe cộ' }
    const RENT = { slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê' }
    const HOMECAT = { slug: 'furniture-appliances', name: 'Home', nameVi: 'Nhà cửa' }
    const iphone15 = row({ title: 'iPhone 15 Pro Max 256GB', brandSlug: 'apple', model: 'iPhone 15 Pro Max', subcategorySlug: 'phones-tablets', category: EL })
    const phoneCase = row({ title: 'Ốp lưng điện thoại iPhone 15', subcategorySlug: 'phone-cases', category: EL })
    const macbook = row({ title: 'MacBook Air M2 2022', brandSlug: 'apple', subcategorySlug: 'laptops-pcs', category: EL })
    const stand = row({ title: 'Laptop stand aluminium', subcategorySlug: 'accessories', category: EL })
    const vision = row({ title: 'Honda Vision 2022', brandSlug: 'honda', subcategorySlug: 'motorbike', category: VEH })
    const visionRent = row({ title: 'Thuê xe máy Honda Vision', subcategorySlug: 'motorbike-rental', category: RENT })
    const helmet = row({ title: 'Mũ bảo hiểm xe máy 3/4', subcategorySlug: 'parts-gear', category: VEH })
    const aircon = row({ title: 'Daikin air conditioner 1HP', titleVi: 'Máy lạnh Daikin 1HP', brandSlug: 'daikin', subcategorySlug: 'white-goods', category: HOMECAT })
    const fridge = row({ title: 'Toshiba refrigerator 180L', titleVi: 'Tủ lạnh Toshiba 180L', brandSlug: 'toshiba', subcategorySlug: 'white-goods', category: HOMECAT })

    it('"điện thoại" / "dien thoai" / "phone": an iPhone filed in Phones is title-tier, like the case that says it', () => {
      for (const q of ['điện thoại', 'dien thoai', 'phone']) {
        expect(score(iphone15, q)).toMatchObject({ strong: true, matchClass: 'title' })
      }
      expect(score(phoneCase, 'điện thoại').matchClass).toBe('title')
    })

    it('"laptop": a MacBook filed in Laptops is title-tier, like the stand that says it', () => {
      expect(score(macbook, 'laptop').matchClass).toBe('title')
      expect(score(stand, 'laptop').matchClass).toBe('title')
    })

    it('"xe máy" / "motorbike": the motorbike for sale is title-tier beside the rental and the helmet', () => {
      for (const q of ['xe máy', 'motorbike']) {
        expect(score(vision, q).matchClass).toBe('title')
        expect(score(visionRent, q).matchClass).toBe('title')
      }
      expect(score(helmet, 'xe máy').matchClass).toBe('title')
    })

    it('"tủ lạnh" / "fridge": the aircon filed in Appliances (“Điện máy”) stays aside — a keyword is not a name', () => {
      for (const q of ['tủ lạnh', 'tu lanh', 'fridge']) {
        expect(score(fridge, q)).toMatchObject({ strong: true, matchClass: 'title' })
        expect(score(aircon, q)).toMatchObject({ strong: true, matchClass: 'aside' })
      }
    })

    it('the aisle is read with its category: a slug filed under another category names nothing', () => {
      // AISLE_NAMES is keyed by both slugs ('storage' is an aisle of Furniture and of Electronics), so a
      // row whose subcategory does not belong to its category gets no name from it — still strong, aside.
      const stray = row({ title: 'iPhone 15 Pro Max', brandSlug: 'apple', subcategorySlug: 'phones-tablets', category: VEH })
      expect(score(stray, 'điện thoại')).toMatchObject({ strong: true, matchClass: 'aside' })
    })
  })

  it('every unit must be named: "samsung tủ lạnh" on a Samsung fridge is title, on a Samsung phone aside', () => {
    const phone = row({ title: 'Galaxy S24', brandSlug: 'samsung', model: 'Galaxy S24', category: ELECTRONICS })
    expect(score(fridgeVi, 'samsung tủ lạnh').matchClass).toBe('title')
    expect(score(phone, 'samsung tủ lạnh').matchClass).toBe('aside')
  })
})

describe('wordStart — the regex the search predicate reproduces', () => {
  it('matches at the start of a word, after any non-alphanumeric', () => {
    expect(wordStart('e-scooter 50cc', 'scooter')).toBe(true)
    expect(wordStart('(scooter)', 'scooter')).toBe(true)
    expect(wordStart('dependable', 'pen')).toBe(false)
    expect(wordStart('maybe later', 'may')).toBe(true)
    expect(wordStart('ultimaybe', 'may')).toBe(false)
  })
})

describe('parseSearchQuery', () => {
  it('keeps each unit\'s words as typed, for the title recall ILIKE cannot fold', () => {
    const q = parseSearchQuery('Tủ lạnh Samsung')
    expect(q.units.map((u) => u.terms[0])).toEqual(['tu lanh', 'samsung'])
    expect(q.typed).toEqual(['tủ lạnh', 'samsung'])
    expect(q.phrase).toBe('tu lanh samsung')
  })
})
