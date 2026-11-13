import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/ai-guard', () => ({ chargeAiGlobal: vi.fn() }))
vi.mock('@/lib/gemini', () => ({ getGeminiVertex: () => null, GEMINI_MODEL: 'gemini-4-hydrogen' }))
vi.mock('@/lib/ssrf', () => ({ safeFetch: vi.fn() }))

const { chipSchema, IMPORT_CATEGORIES, textProblem, validChips, validShelf } = await import('./sort')
const { postableSubcategoriesFor, TAXONOMY, LICENCE_CHECK_SUBCATEGORIES } = await import('@/lib/taxonomy')
const { GEMINI_MODEL } = await import('@/lib/gemini-model')

const color = { key: 'color', label: 'Colour', labelVi: 'Màu', options: [{ value: 'red', label: 'Red', labelVi: 'Đỏ' }, { value: 'blue', label: 'Blue', labelVi: 'Xanh' }] }
const amenities = { key: 'amenities', label: 'A', labelVi: 'A', multi: true, options: [{ value: 'pool', label: 'Pool', labelVi: 'Bể' }, { value: 'gym', label: 'Gym', labelVi: 'Gym' }] }
const year = { key: 'year', label: 'Year', labelVi: 'Năm', kind: 'range' as const, options: [], range: { min: 1980, max: 2030, step: 1, column: 'year' as const } }

describe('the model is Gemini 4 Hydrogen, the app’s own', () => it('names it', () => expect(GEMINI_MODEL).toBe('gemini-4-hydrogen')))

describe('validChips: only what the taxonomy has', () => {
  it('keeps real answers, multi ones as lists', () => {
    expect(validChips({ color: 'red', amenities: ['pool', 'gym', 'pool'], year: 2020 }, [color, amenities, year] as never, [year] as never)).toEqual({ attributes: { color: 'red', amenities: ['pool', 'gym'] }, specs: { year: 2020 } })
  })
  it.each([[{ color: 'mauve' }], [{ color: 'unknown' }], [{ color: '' }], [{ color: 5 }], [{ amenities: ['sauna'] }], [{ amenities: 'pool' }], [{ year: 1500 }], [{ year: '2020' }], [{ licence: 'x' }], [null], ['nonsense']])('drops %j', (a) => {
    expect(validChips(a, [color, amenities, year] as never, [year] as never)).toEqual({ attributes: {}, specs: {} })
  })
})

describe('chipSchema', () => {
  it('offers each chip’s own values, and no schema when there is nothing to ask', () => {
    const s = chipSchema([color] as never, [year] as never)!
    expect((s.properties.color as { enum: string[] }).enum).toEqual(['red', 'blue', 'unknown'])
    // Vertex refuses a whole request over an empty enum value.
    expect((s.properties.color as { enum: string[] }).enum).not.toContain('')
    expect(s.properties).toHaveProperty('year')
    expect(chipSchema([], [])).toBeNull()
  })
})

describe('validShelf', () => {
  it('never offers Jobs, Teachers or a category that doesn’t exist', () => {
    expect(IMPORT_CATEGORIES).not.toContain('jobs')
    expect(IMPORT_CATEGORIES).not.toContain('teachers')
    for (const c of ['jobs', 'teachers', 'made-up', '', null]) expect(validShelf({ category: c })).toBeNull()
  })
  it('keeps a real shelf and drops a subcategory that isn’t on it', () => {
    const cat = TAXONOMY.find((c) => IMPORT_CATEGORIES.includes(c.slug) && postableSubcategoriesFor(c.slug).length > 0)!
    const sub = postableSubcategoriesFor(cat.slug).find((s) => !(LICENCE_CHECK_SUBCATEGORIES as readonly string[]).includes(s.slug))!
    expect(validShelf({ category: cat.slug, subcategory: sub.slug, listingType: 'nonsense' })).toEqual({ categorySlug: cat.slug, subcategorySlug: sub.slug, listingType: cat.types[0] })
    expect(validShelf({ category: cat.slug, subcategory: 'made-up' })!.subcategorySlug).toBeNull()
  })
  it('refuses a licence-checked aisle, which needs the provider’s details', () => {
    for (const s of LICENCE_CHECK_SUBCATEGORIES) expect(validShelf({ category: 'services', subcategory: s })).toBeNull()
  })
})

describe('textProblem', () => {
  it('passes clean text', () => expect(textProblem('A good chair', 'Solid wood, some scratches.')).toBeNull())
  it('catches a phone number left in', () => expect(textProblem('A good chair', 'Call 0901234567 today')).toBe('contact_in_text'))
  it('catches a short title', () => expect(textProblem('ab', 'fine')).toBe('title_short'))
})

// Owner, 2026-11-09: "import has to be right category subcategory" — a vending machine went live as Vehicles › Other.
describe('a machine filed as Vehicles › Other gets one more question', () => {
  it('only Vehicles › Other, or Vehicles with no subcategory — never a real vehicle shelf, never another category', async () => {
    const { needsVehicleCheck } = await import('./sort')
    expect(needsVehicleCheck({ categorySlug: 'vehicles', subcategorySlug: 'vehicle-other' })).toBe(true)
    expect(needsVehicleCheck({ categorySlug: 'vehicles', subcategorySlug: null })).toBe(true)
    for (const sub of ['motorbike', 'car', 'parts-gear', 'bicycle', 'ebike-scooter']) expect(needsVehicleCheck({ categorySlug: 'vehicles', subcategorySlug: sub })).toBe(false)
    expect(needsVehicleCheck({ categorySlug: 'furniture-appliances', subcategorySlug: 'white-goods' })).toBe(false)
  })
  it('⛔ "vehicle-other" is the taxonomy\'s real slug (or the check would silently never run)', () => {
    expect(validShelf({ category: 'vehicles', subcategory: 'vehicle-other', listingType: 'sell' })).toMatchObject({ subcategorySlug: 'vehicle-other' })
  })
  it('an item that carries nothing moves to the shelf the check names; a rental stays a rental where it can', async () => {
    const { afterVehicleCheck } = await import('./sort')
    const first = { categorySlug: 'vehicles', subcategorySlug: 'vehicle-other', listingType: 'sell' }
    expect(afterVehicleCheck(first, { transport: false, category: 'furniture-appliances', subcategory: 'white-goods' })).toMatchObject({ categorySlug: 'furniture-appliances', subcategorySlug: 'white-goods' })
    expect(afterVehicleCheck(first, { transport: false, category: 'electronics', subcategory: 'printers' })).toMatchObject({ categorySlug: 'electronics', subcategorySlug: 'printers' })
  })
  it('a means of transport or a part for one stays; an answer that is unclear, invalid or "vehicles" keeps the first filing', async () => {
    const { afterVehicleCheck } = await import('./sort')
    const first = { categorySlug: 'vehicles', subcategorySlug: 'vehicle-other', listingType: 'sell' }
    for (const a of [{ transport: true, category: 'vehicles', subcategory: '' }, { transport: false, category: 'vehicles', subcategory: '' }, { transport: false, category: 'made-up', subcategory: '' }, { transport: 'no' }, null, 'x']) {
      expect(afterVehicleCheck(first, a)).toBe(first)
    }
  })
})
