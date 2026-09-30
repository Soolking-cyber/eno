import { describe, it, expect } from 'vitest'
import {
  isPostableSubcategory,
  postableSubcategoriesFor,
  subcategoriesFor,
  VISA_CATEGORY_SLUG,
  VISA_SUBCATEGORY_SLUG,
} from './taxonomy'

// O-34 (owner, 2026-09-30): the marketplace edition's POST picker stops offering "Visa runs".
// Browse keeps it (subcategoriesFor is untouched) and eno.forum keeps offering it.

const slugs = (xs: { slug: string }[]) => xs.map((s) => s.slug)

describe('post picker — visa runs on the marketplace edition', () => {
  it('drops tickets-travel/visa-runs from the marketplace picker', () => {
    expect(slugs(postableSubcategoriesFor('tickets-travel', null, true))).not.toContain('visa-runs')
    expect(isPostableSubcategory('tickets-travel', 'visa-runs', true)).toBe(false)
  })

  it('keeps every other travel subcategory, in taxonomy order', () => {
    const all = slugs(subcategoriesFor('tickets-travel'))
    expect(slugs(postableSubcategoriesFor('tickets-travel', null, true))).toEqual(all.filter((s) => s !== 'visa-runs'))
  })

  it('still offers it on the services edition (eno.forum)', () => {
    expect(slugs(postableSubcategoriesFor('tickets-travel', null, false))).toContain('visa-runs')
    expect(isPostableSubcategory('tickets-travel', 'visa-runs', false)).toBe(true)
  })

  it('keeps the value an EDITED listing already has (the wizard passes keep only when editing)', () => {
    expect(slugs(postableSubcategoriesFor('tickets-travel', 'visa-runs', true))).toContain('visa-runs')
  })

  it('leaves browse taxonomy untouched', () => {
    expect(slugs(subcategoriesFor('tickets-travel'))).toContain('visa-runs')
  })

  it('does not hide services/visa-legal (VietKite / GMBR) or anything outside travel', () => {
    expect(isPostableSubcategory(VISA_CATEGORY_SLUG, VISA_SUBCATEGORY_SLUG, true)).toBe(true)
    expect(slugs(postableSubcategoriesFor(VISA_CATEGORY_SLUG, null, true))).toEqual(slugs(subcategoriesFor(VISA_CATEGORY_SLUG)))
    for (const cat of ['electronics', 'vehicles', 'rentals', 'services']) {
      expect(postableSubcategoriesFor(cat, null, true)).toEqual(subcategoriesFor(cat))
    }
  })
})
