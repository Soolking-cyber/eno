import { describe, expect, it } from 'vitest'
import { facetsFor } from '@/lib/taxonomy'
import { customFilterChipLabel, facetOptionLabel } from './facet-chip-label'

/**
 * E-ACTIVE (2026-09-29): an applied custom filter's chip is named by the taxonomy, never by its state
 * key — "bedrooms: 2" and "areaM2: 30-80" were printed on the result line and the saved-search receipt.
 */
const en = (e: string) => e
const vi = (_e: string, v: string) => v
const apt = facetsFor('rentals', 'apartment-rental')
const facet = (key: string) => apt.find((f) => f.key === key)

describe('customFilterChipLabel', () => {
  it('names a range by the facet and its unit, never by the column key', () => {
    expect(customFilterChipLabel(facet('areaM2'), 'areaM2', '30-80', 'en', en)).toBe('Size 30–80 m²')
    expect(customFilterChipLabel(facet('areaM2'), 'areaM2', '30-80', 'vi', vi)).toBe('Diện tích 30–80 m²')
  })

  it('says which side of an open range is set', () => {
    expect(customFilterChipLabel(facet('areaM2'), 'areaM2', '30-', 'en', en)).toBe('Size ≥ 30 m²')
    expect(customFilterChipLabel(facet('areaM2'), 'areaM2', '-80', 'en', en)).toBe('Size ≤ 80 m²')
  })

  it('groups a large range by the reader\'s language, and never a year', () => {
    const car = facetsFor('vehicles', 'car')
    const mileage = car.find((f) => f.range?.column === 'mileageKm')
    const year = car.find((f) => f.range?.column === 'year')
    if (mileage) {
      expect(customFilterChipLabel(mileage, mileage.key, '-50000', 'en', en)).toMatch(/≤ 50,000 km$/)
      expect(customFilterChipLabel(mileage, mileage.key, '-50000', 'vi', vi)).toMatch(/≤ 50\.000 km$/)
    }
    if (year) expect(customFilterChipLabel(year, year.key, '2020-', 'en', en)).toMatch(/≥ 2020$/)
  })

  it('an option that names its own unit is the whole chip; a bare one is prefixed by its facet', () => {
    expect(customFilterChipLabel(facet('bedrooms'), 'bedrooms', '2', 'en', en)).toBe('2 BR')
    expect(customFilterChipLabel(facet('bedrooms'), 'bedrooms', '2', 'vi', vi)).toBe('2 PN')
    expect(customFilterChipLabel(facet('bedrooms'), 'bedrooms', '0', 'en', en)).toBe('Bedrooms: Studio')
    expect(customFilterChipLabel(facet('bathrooms'), 'bathrooms', '2', 'en', en)).toBe('Bathrooms: 2')
    expect(customFilterChipLabel(facet('furnishing'), 'furnishing', 'fully', 'en', en)).toBe('Furnishing: Furnished')
  })

  it('falls back to the raw pair rather than dropping a filter the taxonomy no longer describes', () => {
    expect(customFilterChipLabel(undefined, 'gone', 'x', 'en', en)).toBe('gone: x')
    expect(customFilterChipLabel(facet('bedrooms'), 'bedrooms', '99', 'en', en)).toBe('Bedrooms: 99')
    expect(customFilterChipLabel(facet('areaM2'), 'areaM2', 'abc-def', 'en', en)).toBe('areaM2: abc-def')
  })

  it('no label contains a state key', () => {
    for (const f of apt) {
      const v = f.kind === 'range' ? '1-2' : f.options[0]?.value ?? ''
      if (!v) continue
      expect(customFilterChipLabel(f, f.key, v, 'en', en)).not.toContain(`${f.key}:`)
    }
  })
})

// ── The teachers browse (teacher onboarding redesign, owner, 2026-10-08) ─────────────────────────────────────────────
describe('customFilterChipLabel — "Can teach in" and "In Vietnam now"', () => {
  const teachers = facetsFor('teachers', null)
  const t = (key: string) => teachers.find((f) => f.key === key)
  /** A machine translation that marks what it touched — a place must never pass through it. */
  const mt = (e: string) => `‹${e}›`

  it('a place is its own name in the page language, never machine-translated', () => {
    expect(customFilterChipLabel(t('workIn'), 'workIn', 'd7', 'en', en)).toBe('Can teach in: District 7 (Phu My Hung)')
    expect(customFilterChipLabel(t('workIn'), 'workIn', 'd7', 'vi', vi)).toBe('Có thể dạy tại: Quận 7 (Phú Mỹ Hưng)')
    expect(customFilterChipLabel(t('workIn'), 'workIn', 'p-52', 'vi', vi)).toBe('Có thể dạy tại: Gia Lai')
    // A machine-translated language: the facet's name is translated, the place is not.
    expect(customFilterChipLabel(t('workIn'), 'workIn', 'ha-noi', 'ko', mt)).toBe('‹Can teach in›: Hanoi')
  })
  it('Online and "Will move anywhere" are WORDS — translated like any copy', () => {
    expect(customFilterChipLabel(t('workIn'), 'workIn', 'online', 'ko', mt)).toBe('‹Can teach in›: ‹Online›')
    expect(customFilterChipLabel(t('workIn'), 'workIn', 'anywhere', 'vi', vi)).toBe('Có thể dạy tại: Sẵn sàng chuyển đến bất kỳ đâu')
  })
  it('every old attr_workIn value still has its chip (B10)', () => {
    for (const v of ['ho-chi-minh-city', 'ha-noi', 'da-nang', 'hai-phong', 'can-tho', 'hue', 'khanh-hoa', 'lam-dong', 'dong-nai', 'binh-duong', 'vung-tau', 'phu-quoc', 'anywhere', 'online']) {
      // A named chip — never the raw `key: value` fallback a value the taxonomy lost would get.
      expect(customFilterChipLabel(t('workIn'), 'workIn', v, 'en', en), v).not.toBe(`Can teach in: ${v}`)
    }
  })
  it('"In Vietnam now" is the whole chip — never "In Vietnam now: In Vietnam now"', () => {
    expect(customFilterChipLabel(t('inVietnam'), 'inVietnam', 'yes', 'en', en)).toBe('In Vietnam now')
    expect(customFilterChipLabel(t('inVietnam'), 'inVietnam', 'yes', 'vi', vi)).toBe('Đang ở Việt Nam')
  })
})

describe('facetOptionLabel — one rule for every reader of an option', () => {
  const workIn = facetsFor('teachers', null).find((f) => f.key === 'workIn')!
  const opt = (v: string) => workIn.options.find((o) => o.value === v)!
  const mt = (e: string) => `‹${e}›`
  it('places by name, words through tr(), other facets through tr()', () => {
    expect(facetOptionLabel(workIn, opt('khanh-hoa'), 'fr', mt)).toBe('Nha Trang')
    expect(facetOptionLabel(workIn, opt('online'), 'fr', mt)).toBe('‹Online›')
    expect(facetOptionLabel(facet('furnishing')!, facet('furnishing')!.options[0], 'fr', mt)).toMatch(/^‹.*›$/)
  })
})
