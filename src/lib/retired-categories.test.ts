import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RETIRED_NAV_CATEGORIES, categoryBrowsePath, isRetiredNavCategory, retiredCategoryRedirects } from './retired-categories'
import { NAV_CATEGORIES } from './taxonomy-nav'

describe('RETIRED_NAV_CATEGORIES', () => {
  it('names exactly the four shelves the second-hand focus emptied, each a real category', () => {
    expect([...RETIRED_NAV_CATEGORIES].sort()).toEqual(['books-stationery', 'hobbies-sports', 'pets', 'vehicles'])
    for (const slug of RETIRED_NAV_CATEGORIES) expect(NAV_CATEGORIES.some((c) => c.slug === slug), slug).toBe(true)
    expect(isRetiredNavCategory('vehicles')).toBe(true)
    expect(isRetiredNavCategory('electronics')).toBe(false)
    expect(isRetiredNavCategory(null)).toBe(false)
  })
  it('a retired category browses in the explorer, never at a /c/ URL that redirects away', () => {
    expect(categoryBrowsePath('vehicles')).toBe('/?category=vehicles')
    expect(categoryBrowsePath('electronics')).toBe('/c/electronics')
  })
})

/** What next.config's matcher does with a `:param` source. */
function resolve(rules: ReturnType<typeof retiredCategoryRedirects>, path: string) {
  return rules.find((r) => new RegExp(`^${r.source.replace(':district', '[^/]+')}$`).test(path)) ?? null
}

describe('retiredCategoryRedirects', () => {
  const rules = retiredCategoryRedirects()

  it('is permanent and unconditional: one target for every visitor, on both editions', () => {
    expect(rules.length).toBe(3)
    for (const r of rules) {
      expect(r.permanent).toBe(true)
      // ⛔ No language-keyed variant (owner decision V-a; a 308 cached per URL cannot vary by language), and no
      // edition switch: the forum serves the same hub, so it redirects too (verify review, 2026-10-04).
      expect(Object.keys(r).sort()).toEqual(['destination', 'permanent', 'source'])
    }
  })

  it('next.config spreads the rules with no edition argument', () => {
    const cfg = readFileSync(join(__dirname, '../../next.config.ts'), 'utf8')
    expect(cfg).toMatch(/\.\.\.retiredCategoryRedirects\(\),/)
  })

  it.each(['/c/vehicles', '/c/vehicles/quan-1', '/motorbikes-for-sale-vietnam'])('%s → the motorbike-rental hub', (path) => {
    expect(resolve(rules, path)!.destination).toBe('/motorbike-rental-ho-chi-minh-city')
  })

  it('touches no other category', () => {
    expect(resolve(rules, '/c/electronics')).toBeNull()
    expect(resolve(rules, '/c/vehicles-extra')).toBeNull()
  })
})
