import { describe, expect, it } from 'vitest'
import { CATEGORY_LEAD, categoryLeadRank, leadFirst } from './category-lead'

const slugs = (xs: Array<{ slug: string }>) => xs.map((x) => x.slug)
const cats = (...s: string[]) => s.map((slug) => ({ slug }))

describe('leadFirst', () => {
  it('puts the lead slugs first, in the lead order, wherever they started', () => {
    const footer = cats('rentals', 'furniture-appliances', 'electronics', 'fashion-beauty', 'baby-kids', 'jobs', 'teachers', 'services', 'tickets-travel', 'food-drink')
    expect(slugs(leadFirst(footer))).toEqual([
      'rentals', 'jobs', 'services', 'teachers', 'electronics',
      'furniture-appliances', 'fashion-beauty', 'baby-kids', 'tickets-travel', 'food-drink',
    ])
  })

  it('keeps the incoming order of everything after the lead — each list keeps its own ranking', () => {
    // The /c chips arrive A→Z; the tail must stay A→Z.
    const az = cats('electronics', 'fashion-beauty', 'food-drink', 'furniture-appliances', 'jobs', 'baby-kids', 'rentals', 'services', 'teachers', 'tickets-travel')
    expect(slugs(leadFirst(az)).slice(5)).toEqual(['fashion-beauty', 'food-drink', 'furniture-appliances', 'baby-kids', 'tickets-travel'])
  })

  it('invents nothing: a lead slug the list lacks is simply absent (the page’s own category on /c)', () => {
    expect(slugs(leadFirst(cats('food-drink', 'teachers', 'jobs', 'electronics')))).toEqual(['jobs', 'teachers', 'electronics', 'food-drink'])
  })

  it('returns a new array and leaves the input alone', () => {
    const input = cats('food-drink', 'rentals')
    const out = leadFirst(input)
    expect(out).not.toBe(input)
    expect(slugs(input)).toEqual(['food-drink', 'rentals'])
  })

  it('keeps the objects themselves, so extra fields ride along', () => {
    const rentals = { slug: 'rentals', name: 'Rentals', verifiedCount: 3 }
    expect(leadFirst([{ slug: 'pets', name: 'Pets', verifiedCount: 1 }, rentals])[0]).toBe(rentals)
  })
})

describe('categoryLeadRank', () => {
  it('is the index in the lead, and one past it for every other slug', () => {
    expect(categoryLeadRank('rentals')).toBe(0)
    expect(categoryLeadRank('teachers')).toBe(3)
    expect(categoryLeadRank('electronics')).toBe(4)
    expect(categoryLeadRank('pets')).toBe(CATEGORY_LEAD.length)
    expect(categoryLeadRank('')).toBe(CATEGORY_LEAD.length)
    // A prototype key is not a slug.
    expect(categoryLeadRank('constructor')).toBe(CATEGORY_LEAD.length)
  })
})
