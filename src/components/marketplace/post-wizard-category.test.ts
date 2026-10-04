import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { categoryHasBrand, facetsFor, TAXONOMY, isPostableCategory } from '@/lib/taxonomy'
import { UNLINKED_CATEGORIES } from '@/lib/retired-categories'
import { categoryChangeLosesAnswers, categoryChangeReset, orderPostCategories, POST_CATEGORY_RANK, subcategoryChangeReset, type CategoryAnswers } from './post-wizard-category'

const BLANK: CategoryAnswers = { categorySlug: '', subcategorySlug: '', condition: '', attrs: {}, ranges: {}, brand: '', model: '' }

describe('post wizard — a category change', () => {
  it('clears brand and model even when BOTH categories have a brand (Electronics → Vehicles)', () => {
    expect(categoryHasBrand('electronics')).toBe(true)
    expect(categoryHasBrand('vehicles')).toBe(true)
    const reset = categoryChangeReset('vehicles')
    expect(reset.brand).toBe('')
    expect(reset.model).toBe('')
    expect(reset).toMatchObject({ categorySlug: 'vehicles', subcategorySlug: '', condition: '', attrs: {}, ranges: {} })
  })

  it('offers Undo when only a brand/model would be lost, whatever the target category', () => {
    expect(categoryChangeLosesAnswers({ ...BLANK, categorySlug: 'electronics', brand: 'Apple', model: 'iPhone' })).toBe(true)
    expect(categoryChangeLosesAnswers({ ...BLANK, categorySlug: 'electronics', model: 'iPhone' })).toBe(true)
  })

  it('offers no Undo for a first pick or a switch that loses nothing', () => {
    expect(categoryChangeLosesAnswers({ ...BLANK, brand: 'Apple' })).toBe(false)
    expect(categoryChangeLosesAnswers({ ...BLANK, categorySlug: 'electronics', brand: '  ' })).toBe(false)
  })
})

describe('post picker — category order (sell-06)', () => {
  const postable = TAXONOMY.filter((c) => isPostableCategory(c.slug)).map((c) => ({ slug: c.slug, name: c.name }))
  // The page hands them over in ENGLISH-NAME order — the old order — so the test starts from it.
  const byName = [...postable].sort((a, b) => a.name.localeCompare(b.name, 'en'))
  const { primary, more } = orderPostCategories(byName)

  it('leads with the curated rank, in that order', () => {
    expect(primary.slice(0, POST_CATEGORY_RANK.length).map((c) => c.slug)).toEqual(POST_CATEGORY_RANK)
  })

  it('puts the unlinked shelves behind More…, keeps them postable, and loses nothing', () => {
    for (const c of more) expect(UNLINKED_CATEGORIES.has(c.slug), c.slug).toBe(true)
    for (const c of primary.slice(POST_CATEGORY_RANK.length)) expect(UNLINKED_CATEGORIES.has(c.slug), c.slug).toBe(false)
    expect(more.map((c) => c.slug)).toEqual(expect.arrayContaining(['vehicles', 'property', 'pets']))
    expect([...primary, ...more].map((c) => c.slug).sort()).toEqual(postable.map((c) => c.slug).sort())
  })

  it('offers moving-sale up front even though its shelf is unlinked', () => {
    expect(UNLINKED_CATEGORIES.has('moving-sale')).toBe(true)
    expect(primary.map((c) => c.slug)).toContain('moving-sale')
    expect(more.map((c) => c.slug)).not.toContain('moving-sale')
  })

  it('never offers teachers (written by the teacher form only)', () => {
    expect([...primary, ...more].map((c) => c.slug)).not.toContain('teachers')
  })
})

describe('post wizard — a SUBCATEGORY change (the picker and the "Gợi ý" suggestion alike)', () => {
  const storage = facetsFor('electronics', 'phones-tablets').find((f) => f.key === 'storage')!.options[0].value
  const phone = { categorySlug: 'electronics', attrs: { storage }, ranges: {} as Record<string, number | null>, condition: 'used', brand: 'Apple', model: 'iPhone 13' }

  it('drops the answers the new shelf does not ask, keeps the ones it does, and says something was lost', () => {
    const r = subcategoryChangeReset(phone, 'laptops', { brandShown: true })
    expect(r.attrs).toEqual({}) // laptops are not asked a phone's storage
    expect(r).toMatchObject({ condition: 'used', brand: 'Apple', model: 'iPhone 13', lost: true })
  })

  it('loses nothing — so offers no Undo — when every answer still applies', () => {
    expect(subcategoryChangeReset({ ...phone, attrs: {} }, 'laptops', { brandShown: true }).lost).toBe(false)
  })

  it('rentals: an apartment’s rooms, furnishing and size go; the rental period stays', () => {
    const flat = { categorySlug: 'rentals', attrs: { rentalPeriod: 'monthly', bedrooms: '2', furnishing: 'fully' }, ranges: { areaM2: 45 } as Record<string, number | null>, condition: '', brand: '', model: '' }
    const r = subcategoryChangeReset(flat, 'motorbike-rental', { brandShown: true })
    expect(r.attrs).toEqual({ rentalPeriod: 'monthly' })
    expect(r.ranges).toEqual({})
    expect(r.lost).toBe(true)
  })

  it('⛔ a free-text fact (a book’s author) stays only on a shelf that carries it — never as a hidden value', () => {
    const novel = { categorySlug: 'books-stationery', attrs: { author: 'Nguyễn Nhật Ánh', publisher: 'NXB Trẻ' }, ranges: {} as Record<string, number | null>, condition: 'used', brand: '', model: '' }
    // Another BOOK shelf carries author/publisher: they stay, nothing is lost.
    expect(subcategoryChangeReset(novel, 'textbooks-exam', { brandShown: false })).toMatchObject({ attrs: novel.attrs, lost: false })
    // A non-book shelf does not: they go, and the seller is offered Undo.
    const pens = subcategoryChangeReset(novel, 'stationery-office', { brandShown: false })
    expect(pens.attrs).toEqual({})
    expect(pens.lost).toBe(true)
    // Nor anywhere outside books — e.g. a "sizes" run left on a phone.
    expect(subcategoryChangeReset({ ...phone, attrs: { sizes: 'S–XXL' } }, 'laptops', { brandShown: true }).attrs).toEqual({})
  })

  it('brand and model go only when the new shelf HIDES the Brand field (a vehicle rental → an apartment)', () => {
    const bike = { categorySlug: 'rentals', attrs: { rentalPeriod: 'daily' }, ranges: {} as Record<string, number | null>, condition: '', brand: 'Honda', model: 'Vision' }
    expect(subcategoryChangeReset(bike, 'apartment-rental', { brandShown: false })).toMatchObject({ brand: '', model: '', lost: true })
    expect(subcategoryChangeReset(bike, 'car-rental', { brandShown: true })).toMatchObject({ brand: 'Honda', model: 'Vision', lost: false })
  })

  it('is the ONE path: the subcategory chips and the suggestion chip both call chooseSubcategory', () => {
    const src = readFileSync(join(__dirname, 'post-wizard.tsx'), 'utf8')
    expect(src).toContain('subcategoryChangeReset({ categorySlug, attrs, ranges, condition, brand, model }, next, { brandShown: brandShownFor(next) })')
    // Every subcategory write that a SELLER makes goes through it — the remaining direct setter calls are
    // the category change, restore, AI fill and the sale→rent switch, which reset everything themselves.
    expect(src.match(/chooseSubcategory\(/g)?.length).toBeGreaterThanOrEqual(2) // the picker + the suggestion
    expect(src).toMatch(/const next = v === subcategorySlug \? '' : v\s+chooseSubcategory\(next\)/)
    expect(src).toMatch(/chooseSubcategory\(subSuggestion\.slug\)/)
    expect(src).not.toMatch(/onClick=\{\(\) => setSubcategorySlug\(subSuggestion\.slug\)\}/)
  })
})
