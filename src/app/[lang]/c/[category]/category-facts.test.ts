import { describe, expect, it } from 'vitest'
import { SUBCATEGORIES } from '@/lib/taxonomy'
import { categoryKinds, categoryLead, categoryMetadata, withCategoryFacts } from './category-copy'

// Bing Webmaster Tools, 2026-11-20: the category descriptions were ~90 characters ("Browse jobs for expats in Vietnam. Members
// can report any listing that breaks the rules."). The live count and the first subcategories go between the two sentences.
const run = (slug: string, name: string, live: number, lang: 'en' | 'vi' = 'en', nameVi = name) => {
  const cat = { slug, name, nameVi }
  const { description } = categoryMetadata(cat, 'none', 'eno.vn', lang, live)
  return { plain: description, filled: withCategoryFacts(description, categoryLead(cat, lang), cat, live, lang) }
}

describe('withCategoryFacts', () => {
  it('adds the live count and the kinds, keeps the closing sentence, stays within 160', () => {
    const { plain, filled } = run('furniture-appliances', 'Home', 1234)
    expect(filled).toMatch(/^Browse home for expats in Vietnam\. 1,234 live listings\. Includes .+ and more\. /)
    expect(filled.endsWith(plain.slice(plain.indexOf('. ') + 2))).toBe(true)
    expect(filled.length).toBeGreaterThan(plain.length)
    expect(filled.length).toBeLessThanOrEqual(160)
  })
  it('one listing is singular; none says no number', () => {
    expect(run('baby-kids', 'Baby & Kids', 1).filled).toMatch(/ 1 live listing\. /)
    expect(run('baby-kids', 'Baby & Kids', 0).filled).not.toMatch(/\d/)
  })
  it('Vietnamese counts with dots and keeps its own closing sentence', () => {
    const { plain, filled } = run('furniture-appliances', 'Home', 1234, 'vi', 'Nhà cửa')
    expect(filled).toMatch(/^Xem tin nhà cửa tại Việt Nam\. 1\.234 tin đang đăng\. Gồm .+ và nhiều hơn nữa\. /)
    expect(filled.endsWith(plain.slice(plain.indexOf('. ') + 2))).toBe(true)
    expect(filled.length).toBeLessThanOrEqual(160)
  })
  it('leaves rentals, teachers and an unknown lead alone', () => {
    expect(withCategoryFacts('x', 'Browse', { slug: 'rentals' }, 9, 'en')).toBe('x')
    expect(withCategoryFacts('x', 'Browse', { slug: 'teachers' }, 9, 'en')).toBe('x')
    expect(withCategoryFacts('Other text', 'Browse', { slug: 'jobs' }, 9, 'en')).toBe('Other text')
  })
  it('drops the kinds, then the count, before it would pass 160', () => {
    const lead = 'L'.repeat(60)
    const tail = 'T'.repeat(60)
    const d = withCategoryFacts(`${lead} ${tail}`, lead, { slug: 'furniture-appliances' }, 5, 'en')
    expect(d.length).toBeLessThanOrEqual(160)
    expect(d.endsWith(tail)).toBe(true)
  })
  it('never names a visa or licence-checked aisle — and those aisles do exist in the raw lists it filters', () => {
    expect(SUBCATEGORIES['services'].map((x) => x.slug)).toEqual(expect.arrayContaining(['visa-legal', 'legal-permits']))
    expect(SUBCATEGORIES['tickets-travel'].map((x) => x.slug)).toContain('visa-runs')
    for (const slug of Object.keys(SUBCATEGORIES)) {
      for (const x of categoryKinds(slug)) expect(['visa-legal', 'legal-permits', 'visa-runs']).not.toContain(x.slug)
    }
  })
  it('keeps the taxonomy\'s own capitals', () => {
    const named = Object.keys(SUBCATEGORIES).flatMap((slug) => categoryKinds(slug).slice(0, 3).map((x) => ({ slug, name: x.name })))
    const branded = named.find((n) => /[a-z][A-Z]/.test(n.name))
    if (branded) expect(withCategoryFacts('Browse x. Tail.', 'Browse x.', { slug: branded.slug }, 5, 'en')).toContain(branded.name)
  })
})
