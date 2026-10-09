import { describe, expect, it } from 'vitest'
import { CATEGORY_BY_SLUG } from './taxonomy'
import { PLACE_KEYS, placeLabel } from './teachers/places'

// The teachers category's facets after the onboarding redesign (owner, 2026-10-08).
const facet = (key: string) => CATEGORY_BY_SLUG.teachers.facets.find((f) => f.key === key)!

describe('teachers facets', () => {
  it('"Can teach in" keeps the workIn KEY, and its options are exactly the place vocabulary', () => {
    const f = facet('workIn')
    expect(f).toMatchObject({ label: 'Can teach in', labelVi: 'Có thể dạy tại', derived: true, placeNames: true })
    expect(new Set(f.options.map((o) => o.value))).toEqual(new Set(PLACE_KEYS))
    expect(f.options).toHaveLength(PLACE_KEYS.length)
    // place names are never machine-translated: each option carries its own two names
    for (const o of f.options.filter((x) => x.value.startsWith('d') || x.value.startsWith('p-'))) {
      expect([o.label, o.labelVi]).toEqual([placeLabel(o.value, 'en'), placeLabel(o.value, 'vi')])
    }
  })
  it('adds the derived "In Vietnam now" toggle', () => {
    expect(facet('inVietnam')).toMatchObject({ kind: 'toggle', derived: true, options: [{ value: 'yes', label: 'In Vietnam now', labelVi: 'Đang ở Việt Nam' }] })
  })
  it('offers no Online job type any more (a place now) and keeps Business as a derived-only age group', () => {
    expect(facet('jobType').options.map((o) => o.value)).toEqual(['fulltime', 'parttime', 'private'])
    expect(facet('ageGroup').options.map((o) => o.value)).toContain('business')
  })
  it('leaves the cover facets as they were', () => {
    expect(facet('coverArea').options).toHaveLength(36)
    expect(facet('cover').options.map((o) => o.value)).toEqual(['open'])
  })
})
