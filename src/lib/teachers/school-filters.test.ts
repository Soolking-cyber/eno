import { describe, expect, it, vi } from 'vitest'
import { attrMatcher, attrWhere } from '@/lib/attr-match'
import { CATEGORY_BY_SLUG } from '@/lib/taxonomy'
import { normalizeForSave, normalizeTeacherInput } from '@/lib/teachers/profile'
import { teacherListingProjection } from '@/lib/teachers/projection'
import { ANYWHERE, HUBS, ONLINE } from '@/lib/teachers/places'
import { PROVINCE_NAMES_EN } from '@/lib/province-match'

// facet-counts.ts holds the Area pill's in-memory predicates (district + province, the mirrors of the feed's); it reads
// the database and the edition scope at module level, neither of which these pure predicates touch.
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/edition-scope', () => ({
  DeskResolutionError: class extends Error {},
  scopedListingWhere: async (w: unknown) => w,
  marketplaceListingScope: async () => ({}),
  teacherExclusion: async () => null,
}))
const { districtSlugsFor, matchesProvince } = await import('@/lib/facet-counts')

/**
 * ⛔ WHAT A SCHOOL'S FILTERS FIND (teacher onboarding redesign, owner, 2026-10-08 — plan review B4/B10/C5). Four teachers
 * built by the REAL save path (normalizeTeacherInput → normalizeForSave → teacherListingProjection, the builders publish.ts
 * and the backfill share), each asked every filter a school can tap:
 *   · "Can teach in" — all 65 options of the taxonomy's `workIn` facet, through the feed's predicate (attrWhere, a
 *     Prisma `contains` per needle) AND the Filter panel's counter (attrMatcher), which must agree on every one;
 *   · "In Vietnam now"; the old links (the 14 values the "Wants to work in" facet had, attr_jobType=online);
 *   · "Lives in" — the Area pill's province and district predicates, over the projected Listing city / district /
 *     location (projection.ts teacherHome). A teacher abroad is in no province and no district.
 * Each teacher must be found by EXACTLY the filters listed — a missing one hides a teacher from a school that wants
 * them, an extra one shows a teacher who cannot do the job.
 */

const CATEGORY = { name: 'Teachers', nameVi: 'Giáo viên' }
const BASE = {
  subjects: ['general-english'], ageGroups: ['adults'], experienceBand: '3-5-years', fullName: 'Test Teacher', nationality: 'GB',
  englishLevel: 'native', headline: 'Experienced English teacher', teachAreasConfirmed: true,
}
function teacher(answers: Record<string, unknown>) {
  const t = normalizeForSave(normalizeTeacherInput({ ...BASE, ...answers }))
  const listing = teacherListingProjection(t, CATEGORY)
  return { t, listing, row: { attributes: null, facetTokens: listing.facetTokens } }
}

const PEOPLE = {
  /** lives in HCMC, District 7; teaches near home only — "Only some districts": D7 and D4 */
  hcmcD7: teacher({ livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7', jobTypes: ['private'], teachAreas: ['d7', 'd4'] }),
  /** "Somewhere else in Vietnam": Gia Lai (a province key), part-time, won't move — teaches there and online */
  giaLai: teacher({ livesIn: 'elsewhere', currentProvince: '52', jobTypes: ['parttime'], relocate: 'no', teachAreas: ['online', 'p-52'] }),
  /** not in Vietnam yet, online only */
  abroadOnline: teacher({ livesIn: 'abroad', jobTypes: ['private'], relocate: 'online-only', teachAreas: ['online'] }),
  /** lives in Hanoi, full-time, "Yes, anywhere in Vietnam" */
  hanoiAnywhere: teacher({ livesIn: 'city', currentCity: 'ha-noi', jobTypes: ['fulltime'], relocate: 'anywhere', teachAreas: ['ha-noi', 'anywhere'] }),
}
type Who = keyof typeof PEOPLE

const WORK_IN = CATEGORY_BY_SLUG.teachers!.facets.find((f) => f.key === 'workIn')!.options.map((o) => o.value)
/** The feed's own predicate evaluated in JS: one `contains` per needle over the row's columns — what attrWhere asks Postgres. */
function feedFinds(key: string, value: string, row: { attributes: string | null; facetTokens: string | null }): boolean {
  const where = attrWhere(key, value) as { OR: { attributes?: { contains: string }; facetTokens?: { contains: string } }[] }
  return where.OR.some((c) => (c.facetTokens ? (row.facetTokens ?? '').includes(c.facetTokens.contains) : false)
    || (c.attributes ? (row.attributes ?? '').includes(c.attributes.contains) : false))
}
/** Every value of `key` among `values` that finds the teacher — asserting on the way that the feed and the counts agree. */
function foundBy(who: Who, key: string, values: readonly string[]): string[] {
  const { row } = PEOPLE[who]
  return values.filter((v) => {
    const feed = feedFinds(key, v, row)
    expect(attrMatcher(key, v)(row), `${who}: attr_${key}=${v} — the count disagrees with the feed`).toBe(feed)
    return feed
  })
}

describe('the four teachers are what the save path makes of them', () => {
  it('teach areas, home and location — no HCMC fallback, no empty place', () => {
    expect(PEOPLE.hcmcD7.t.teachAreas).toEqual(['d4', 'd7'])
    expect(PEOPLE.hcmcD7.listing).toMatchObject({ city: 'Hồ Chí Minh', district: 'Quận 7 (Phú Mỹ Hưng)', location: 'District 7 (Phu My Hung), Ho Chi Minh City' })
    expect(PEOPLE.giaLai.t.teachAreas).toEqual(['online', 'p-52'])
    expect(PEOPLE.giaLai.listing).toMatchObject({ city: 'Gia Lai', district: null, location: 'Gia Lai' })
    expect(PEOPLE.abroadOnline.t.teachAreas).toEqual(['online'])
    expect(PEOPLE.abroadOnline.listing).toMatchObject({ city: '', district: null, location: 'Not in Vietnam yet · Online' })
    expect(PEOPLE.hanoiAnywhere.t.teachAreas).toEqual(['ha-noi', 'anywhere'])
    expect(PEOPLE.hanoiAnywhere.listing).toMatchObject({ city: 'Hà Nội', district: null, location: 'Hanoi' })
  })
})

describe('"Can teach in" — every one of the 65 options, feed and count alike', () => {
  it('has the 65 places the plan promised (12 cities, 24 HCMC districts, 27 provinces, Online, anywhere)', () => {
    expect(WORK_IN).toHaveLength(65)
  })
  it('HCMC D7 (D7 + D4): found by HCMC and by its own two districts — never by another district, Bình Dương, Online or "anywhere"', () => {
    expect(foundBy('hcmcD7', 'workIn', WORK_IN).sort()).toEqual(['d4', 'd7', 'ho-chi-minh-city'])
  })
  it('Gia Lai (p-52 + Online): found by its province and by Online — no city covers Gia Lai', () => {
    expect(foundBy('giaLai', 'workIn', WORK_IN).sort()).toEqual(['online', 'p-52'])
  })
  it('abroad, online only: found by Online alone', () => {
    expect(foundBy('abroadOnline', 'workIn', WORK_IN)).toEqual([ONLINE])
  })
  it('Hanoi + "anywhere": found by every place in Vietnam — and not by Online, which they did not pick', () => {
    expect(foundBy('hanoiAnywhere', 'workIn', WORK_IN).sort()).toEqual(WORK_IN.filter((v) => v !== ONLINE).sort())
  })
})

describe('"In Vietnam now"', () => {
  it('finds the three who answered a place in Vietnam, never the teacher abroad', () => {
    const found = (Object.keys(PEOPLE) as Who[]).filter((w) => foundBy(w, 'inVietnam', ['yes']).length > 0)
    expect(found).toEqual(['hcmcD7', 'giaLai', 'hanoiAnywhere'])
  })
})

describe('old links still filter (plan review B10)', () => {
  const OLD = [...HUBS, ANYWHERE, ONLINE]
  it('the 14 values of the old "Wants to work in" facet', () => {
    expect(OLD).toHaveLength(14)
    expect(foundBy('hcmcD7', 'workIn', OLD)).toEqual(['ho-chi-minh-city'])
    expect(foundBy('giaLai', 'workIn', OLD)).toEqual([ONLINE])
    expect(foundBy('abroadOnline', 'workIn', OLD)).toEqual([ONLINE])
    expect(foundBy('hanoiAnywhere', 'workIn', OLD)).toEqual(OLD.filter((v) => v !== ONLINE))
  })
  it('attr_jobType=online finds whoever teaches Online (a place now, the token is derived)', () => {
    const found = (Object.keys(PEOPLE) as Who[]).filter((w) => foundBy(w, 'jobType', ['online']).length > 0)
    expect(found).toEqual(['giaLai', 'abroadOnline'])
  })
})

describe('"Lives in" — the Area pill reads where the teacher lives', () => {
  const provincesOf = (w: Who) => PROVINCE_NAMES_EN.filter((p) => matchesProvince(PEOPLE[w].listing, p))
  it('each teacher is in their own province only — and the teacher abroad in none', () => {
    expect(provincesOf('hcmcD7')).toEqual(['Ho Chi Minh'])
    expect(provincesOf('giaLai')).toEqual(['Gia Lai'])
    expect(provincesOf('abroadOnline')).toEqual([])
    expect(provincesOf('hanoiAnywhere')).toEqual(['Ha Noi'])
  })
  it('a district finds the teacher who lives there — never one who only TEACHES there, never one abroad', () => {
    expect(districtSlugsFor(PEOPLE.hcmcD7.listing)).toEqual(['d7'])
    for (const w of ['giaLai', 'abroadOnline', 'hanoiAnywhere'] as const) expect(districtSlugsFor(PEOPLE[w].listing), w).toEqual([])
  })
})
