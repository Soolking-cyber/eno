import { describe, expect, it, vi } from 'vitest'
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import { CATEGORY_BY_SLUG, facetsFor, subcategoriesFor, type FacetDef } from '@/lib/taxonomy'
import { PROVINCE_PLACES } from '@/lib/teachers/places'
import { VN_PROVINCES } from '@/lib/vn-areas'
import { EDITION_BANNED } from '@/test/edition-words'
import { RETIRED_TRUST_CLAIMS } from '@/lib/copy-rules'
import { TEACHERS_COUNSEL_WORDS } from '@/test/teachers-counsel-words'
import { conciergeCatalog } from './catalog'
import { CONCIERGE_CATEGORIES, CONCIERGE_HIDDEN_SUBCATEGORIES } from './categories'

const catalog = conciergeCatalog()

/** One category's lines in the CATEGORIES section, header excluded, indentation trimmed. */
function block(slug: string): string[] {
  const lines = catalog.split('\n')
  const start = lines.findIndex((l) => l.startsWith(`${slug} (`))
  expect(start, slug).toBeGreaterThan(-1)
  const out: string[] = []
  for (const l of lines.slice(start + 1)) {
    if (!l.startsWith('  ')) break
    out.push(l.trim())
  }
  return out
}
/** The lines of `key` in a category (a key with two definitions has two). */
const keyLines = (slug: string, key: string) => block(slug).filter((l) => l.startsWith(`${key}:`) || l.startsWith(`${key} (`))
/** `key: values [where]` or `key (what it means): values [where]`. */
const KEY_LINE = /^[^\s:(]+(?: \([^)]*\))?: (.*?)(?: \[[^\]]*\])?$/
/** The `a|b|c` values of a key line, each without its gloss. */
const valuesOf = (line: string): string[] => (KEY_LINE.exec(line)?.[1] ?? '').split('|').map((v) => v.replace(/ \(.*\)$/, ''))

const visibleSubs = (slug: string) => subcategoriesFor(slug).map((s) => s.slug).filter((s) => !CONCIERGE_HIDDEN_SUBCATEGORIES.has(s))
/** Offered on some view the concierge may open — facetsFor, the explorer's own rule. */
const offered = (slug: string, f: FacetDef) => [null, ...visibleSubs(slug)].some((v) => facetsFor(slug, v).includes(f))

describe('conciergeCatalog', () => {
  it('is the same string on every call, whatever the clock says, and from a fresh module', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2031-06-01T00:00:00Z'))
    try {
      expect(conciergeCatalog()).toBe(catalog)
    } finally {
      vi.useRealTimers()
    }
    vi.resetModules()
    const fresh = await import('./catalog')
    expect(fresh.conciergeCatalog()).toBe(catalog)
  })

  it('fits its share of the cached prompt: at most 3,500 tokens (≈ characters / 4)', () => {
    expect(Math.ceil(catalog.length / 4)).toBeLessThanOrEqual(3_500)
  })

  it("says nothing eno.vn may not: no EDITION_BANNED word, retired trust claim or counsel-pending teacher word", () => {
    const text = catalog.normalize('NFC')
    expect(text.match(EDITION_BANNED)).toBeNull()
    expect(RETIRED_TRUST_CLAIMS.filter((re) => re.test(text))).toEqual([])
    expect(text.match(TEACHERS_COUNSEL_WORDS)).toBeNull()
  })

  it('no label it could print breaks the edition rule — every name and option label of what it offers', () => {
    const labels: string[] = []
    for (const slug of CONCIERGE_CATEGORIES) {
      const cat = CATEGORY_BY_SLUG[slug]
      labels.push(cat.name, ...subcategoriesFor(slug).filter((s) => !CONCIERGE_HIDDEN_SUBCATEGORIES.has(s.slug)).map((s) => s.name))
      for (const f of cat.facets.filter((x) => offered(slug, x))) labels.push(f.label, ...f.options.map((o) => o.label))
    }
    expect(labels.filter((l) => EDITION_BANNED.test(l))).toEqual([])
  })

  it('lists every concierge category in order, with its English name — and no hidden aisle or its facets', () => {
    const at = CONCIERGE_CATEGORIES.map((slug) => catalog.indexOf(`\n${slug} (${CATEGORY_BY_SLUG[slug].name})\n`))
    expect(at.every((i) => i > 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    for (const hidden of CONCIERGE_HIDDEN_SUBCATEGORIES) expect(catalog).not.toContain(hidden)
    expect(catalog).not.toMatch(/visaSpeed|visaEntryType/)
    // the unlinked shelves (retired-categories.ts) are not offered
    for (const gone of ['property', 'moving-sale', 'community-events', 'sports', 'pets']) expect(catalog).not.toMatch(new RegExp(`^${gone} \\(`, 'm'))
  })

  it('every subcategory it may open, and every offered facet key with each of its values', () => {
    for (const slug of CONCIERGE_CATEGORIES) {
      const subLine = block(slug).find((l) => l.startsWith('sub: '))!
      expect(subLine.slice(5).split(', ').map((s) => s.replace(/ \(.*\)$/, '')), slug).toEqual(visibleSubs(slug))
      for (const f of CATEGORY_BY_SLUG[slug].facets.filter((x) => offered(slug, x))) {
        if (slug === 'services' && f.key === 'foreigners') continue // OMIT: its key reads "foreign" (catalog.ts)
        const lines = keyLines(slug, f.key)
        expect(lines.length, `${slug}/${f.key}`).toBeGreaterThan(0)
        if (f.kind === 'range' || f.placeNames || f.key === 'coverSlot') continue // their own tests below
        const values = lines.flatMap(valuesOf)
        for (const o of f.options) {
          if (slug === 'rentals' && f.key === 'bedrooms' && o.value === '0') continue
          expect(values, `${slug}/${f.key}=${o.value}`).toContain(o.value)
        }
      }
    }
  })

  it('a range says its bounds and unit; a facet tied to subcategories says which (facetsFor decides)', () => {
    expect(keyLines('teachers', 'salary')[0]).toContain('range 0-150 in million dong a month')
    expect(keyLines('teachers', 'salary')[0]).toMatch(/expected MONTHLY salary/)
    expect(keyLines('jobs', 'salary')[0]).toContain('range 0-100 in million dong a month')
    expect(keyLines('rentals', 'areaM2')).toEqual(['areaM2 (Size): range 0-500 in square metres [sub: apartment-rental, house-rental, room-rental, office-rental]'])
    expect(keyLines('vehicles', 'engineL')[0]).toContain('range 0.8-6 in litres [sub: car]')
    expect(keyLines('rentals', 'bedrooms')).toEqual(['bedrooms: 1|2|3|4|5|6 (or more) [sub: apartment-rental, house-rental, room-rental]'])
    expect(keyLines('rentals', 'posted')[0]).toMatch(/\[not with: motorbike-rental, car-rental, bicycle-rental, ebike-rental\]$/)
    // the hidden e-Visa aisle is never named, even as an exception
    expect(keyLines('services', 'serviceLocation')[0]).toMatch(/\[not with: legal-permits, esim\]$/)
    // one key, two definitions: merged when the values agree, one line each when they do not
    expect(keyLines('rentals', 'transmission')).toEqual(['transmission: automatic|manual [sub: motorbike-rental, car-rental]'])
    expect(keyLines('electronics', 'storage')).toHaveLength(2)
  })

  it('teachers: where they can teach is workIn — cities, every district key, provinces by name, online, anywhere; no price or district key', () => {
    const workIn = keyLines('teachers', 'workIn')
    expect(workIn).toHaveLength(1)
    expect(workIn[0]).toMatch(/^workIn \(where they can teach\): a city: ho-chi-minh-city, ha-noi, /)
    expect(workIn[0]).toContain('khanh-hoa (Nha Trang)')
    expect(workIn[0]).toContain('; any district key; ')
    for (const p of PROVINCE_PLACES) expect(workIn[0]).toContain(`${p.key} ${p.nameEn}`)
    expect(workIn[0]).toMatch(/; online; anywhere$/)
    expect(block('teachers')).toContain('no priceMin, priceMax, district, province or price sort here: a place is workIn, a monthly budget is salary; an hourly budget is rateMax, on find only, whole dong an hour (under 400 thousand = rateMax 400000)')
    expect(keyLines('teachers', 'native')[0]).toMatch(/: native\|non-native$/)
    expect(keyLines('teachers', 'jobType')[0]).toMatch(/private = regular private lessons.*: fulltime\|parttime\|private$/)
    expect(keyLines('teachers', 'coverSlot')[0]).toContain('<mon|tue|wed|thu|fri|sat|sun>-<am|pm|eve>')
  })

  it('type only where it splits a shelf, condition only where the shelf has it', () => {
    expect(keyLines('rentals', 'type')).toEqual(['type: rent (places and vehicles offered)|wanted (people looking to rent)'])
    expect(keyLines('jobs', 'type')).toEqual(['type: job (employers hiring)|wanted (people seeking a job)'])
    for (const slug of CONCIERGE_CATEGORIES) {
      if (slug !== 'rentals' && slug !== 'jobs') expect(keyLines(slug, 'type'), slug).toEqual([])
      const hasCondition = facetsFor(slug, null).some((f) => f.key === 'condition')
      expect(keyLines(slug, 'condition'), slug).toEqual(hasCondition ? ['condition: new|used'] : [])
    }
  })

  it('a studio is aptType, never the empty bedrooms Studio chip; the eSIM `foreigners` facet is left out', () => {
    expect(valuesOf(keyLines('rentals', 'aptType')[0])).toContain('studio')
    expect(valuesOf(keyLines('rentals', 'bedrooms')[0])).not.toContain('0')
    expect(block('services').join('\n')).not.toMatch(/foreigners/)
  })

  it('every curated district once, with the names people say — the owner example "District 1" is d1', () => {
    for (const d of DISTRICTS.filter((x) => x.slug !== 'all')) expect(catalog.split(`${d.slug} = `).length - 1, d.slug).toBe(1)
    expect(catalog).toContain('d1 = District 1 / Quận 1;')
    expect(catalog).toContain('d2 = District 2 / Quận 2 / Thảo Điền / An Phú (in thu-duc);')
    expect(catalog).toContain('d7 = District 7 / Quận 7 / Phú Mỹ Hưng;')
    expect(catalog).toContain('thu-duc = Thu Duc City / TP Thủ Đức (covers d2, d9);')
    expect(catalog).toContain('binh-thanh = Binh Thanh District / Bình Thạnh;')
  })

  it('every province code once — Ho Chi Minh City, Ha Noi and Da Nang first — with the towns people name inside it', () => {
    const line = catalog.split('\n').find((l) => l.startsWith('province codes: '))!
    expect(line).toMatch(/^province codes: 79 Ho Chi Minh City \(also Binh Duong, Vung Tau, Thu Dau Mot\), 01 Ha Noi, 48 Da Nang \(also Hoi An\), /)
    for (const p of VN_PROVINCES) expect(line.split(new RegExp(`(?:: |, )${p.code} `)).length - 1, p.code).toBe(1)
    expect(line).toContain('56 Khanh Hoa (also Nha Trang)')
    expect(line).toContain('91 An Giang (also Phu Quoc)')
  })
})

describe('NEARBY_DISTRICTS (owner, 2026-10-28: "offer nearby districts if apartment hunting")', () => {
  it('names only the catalog\'s own district keys, both sides — and is in the catalog the brain reads', async () => {
    const { NEARBY_DISTRICTS, conciergeCatalog } = await import('./catalog')
    const keys = new Set(conciergeCatalog().split('\n').find((l) => l.startsWith('district keys:'))!.replace('district keys: ', '').split('; ').map((x) => x.split(' = ')[0]))
    for (const [d, near] of Object.entries(NEARBY_DISTRICTS)) {
      expect(keys.has(d), d).toBe(true)
      for (const n of near) {
        expect(keys.has(n), `${d} → ${n}`).toBe(true)
        // both sides: a neighbour is one both ways (commit review, opus, round 10 — D5 → D1 but not D1 → D5)
        expect(NEARBY_DISTRICTS[n], `${n} → ${d}`).toContain(d)
      }
      expect(new Set(near).size, d).toBe(near.length)
    }
    // the city d2 and d9 are IN is never their neighbour; D7 does not border D1
    expect(NEARBY_DISTRICTS.d2).not.toContain('thu-duc')
    expect(NEARBY_DISTRICTS.d9).not.toContain('thu-duc')
    expect(NEARBY_DISTRICTS.d7).not.toContain('d1')
    expect(conciergeCatalog()).toContain('NEARBY (to widen a place): d1: d3, d4, d5, binh-thanh, d2, thu-duc; ')
    expect(conciergeCatalog()).toContain('; d2 and d9 also widen to thu-duc, the city they are in')
  })
})
