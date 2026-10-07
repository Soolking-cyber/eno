import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  COVER_AREAS, COVER_AREA_KEYS, COVER_CITIES, COVER_LIMITS, COVER_SLOTS, coverAreaFilterKeys, coverAreaLabel, coverStamp,
  coverAreasForCities, coverCitiesFor, coverSlotLabel, parseCoverSlot,
} from './cover'
import { coverIsPublic, normalizeTeacherInput, teacherFacetTokens, validateTeacherInput, DRAFT_STEPS, TEACHER_STEP_FIELDS } from './profile'
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import { CATEGORY_BY_SLUG } from '@/lib/taxonomy'
import { attrMatcher, attrWhere } from '@/lib/attr-match'
import { parseFacetTokens } from '@/lib/facet-tokens'

const base = {
  fullName: 'Jane Doe', headline: 'CELTA-certified English teacher, 6 years with kids', nationality: 'GB',
  currentCity: 'ho-chi-minh-city', preferredCities: ['ho-chi-minh-city', 'ha-noi'],
  jobTypes: ['parttime'], ageGroups: ['kids'], subjects: ['general-english'],
}
const coverOn = { coverOpen: true, coverSlots: ['mon-am', 'tue-pm'], coverAreas: ['d7', 'ha-noi'], coverRateVnd: 300_000, coverConsent: true }

describe('cover slots', () => {
  it('are 21 combined day-part keys — never a day token and a part token apart', () => {
    expect(COVER_SLOTS).toHaveLength(21)
    expect(new Set(COVER_SLOTS).size).toBe(21)
    for (const s of COVER_SLOTS) expect(parseCoverSlot(s), s).not.toBeNull()
    expect(parseCoverSlot('mon')).toBeNull()
    expect(parseCoverSlot('funday-am')).toBeNull()
  })
  it('read naturally in both languages', () => {
    expect(coverSlotLabel('mon-am', 'en')).toBe('Monday morning')
    expect(coverSlotLabel('sun-eve', 'vi')).toBe('Tối Chủ nhật')
  })
})

describe('cover areas', () => {
  it('cover exactly the taxonomy workIn cities (minus anywhere/online)', () => {
    const workIn = CATEGORY_BY_SLUG.teachers.facets.find((f) => f.key === 'workIn')!.options
    expect(COVER_CITIES.map((c) => c.key)).toEqual(workIn.map((o) => o.value).filter((v) => v !== 'anywhere' && v !== 'online'))
    for (const c of COVER_CITIES) expect(workIn.find((o) => o.value === c.key)?.label).toBe(c.en)
  })
  it('reuse the curated HCMC district table verbatim, with Thủ Đức as the umbrella of d2/d9', () => {
    const hcmc = COVER_AREAS.filter((a) => a.city === 'ho-chi-minh-city' && !a.cityWide)
    expect(hcmc.map((a) => a.key)).toEqual(DISTRICTS.filter((d) => d.slug !== 'all').map((d) => d.slug))
    expect(COVER_AREAS.find((a) => a.key === 'thu-duc')?.parts).toEqual(['d2', 'd9'])
    expect(new Set(COVER_AREA_KEYS).size).toBe(COVER_AREA_KEYS.length)
  })
  it('only split HCMC into districts — every other city is city-wide only', () => {
    for (const c of COVER_CITIES.filter((x) => x.key !== 'ho-chi-minh-city')) {
      expect(COVER_AREAS.filter((a) => a.city === c.key).map((a) => a.key)).toEqual([c.key])
    }
  })
  it('expand a school filter the way people mean it', () => {
    expect(coverAreaFilterKeys('d7')).toEqual(['d7', 'ho-chi-minh-city'])
    expect(coverAreaFilterKeys('d2')).toEqual(expect.arrayContaining(['d2', 'thu-duc', 'ho-chi-minh-city']))
    expect(coverAreaFilterKeys('thu-duc')).toEqual(expect.arrayContaining(['thu-duc', 'd2', 'd9', 'ho-chi-minh-city']))
    expect(coverAreaFilterKeys('ho-chi-minh-city')).toEqual(['ho-chi-minh-city', ...DISTRICTS.filter((d) => d.slug !== 'all').map((d) => d.slug)])
    expect(coverAreaFilterKeys('ha-noi')).toEqual(['ha-noi'])
    expect(coverAreaFilterKeys('atlantis')).toEqual(['atlantis'])
    // d9 never finds a d2-only teacher
    expect(coverAreaFilterKeys('d9')).not.toContain('d2')
  })
  it('offer the teacher only their own cities, and every city when they will work anywhere', () => {
    expect(coverCitiesFor('ho-chi-minh-city', ['da-nang'])).toEqual(['ho-chi-minh-city', 'da-nang'])
    expect(coverCitiesFor('ha-noi', ['anywhere'])).toHaveLength(COVER_CITIES.length)
    expect(coverAreasForCities(['da-nang']).map((a) => a.key)).toEqual(['da-nang'])
  })
  it('never cut a teacher\'s picks: the area cap holds every area there is', () => {
    expect(COVER_AREA_KEYS.length).toBeLessThanOrEqual(COVER_LIMITS.areas)
    const all = normalizeTeacherInput({ ...base, preferredCities: ['anywhere'], ...coverOn, coverAreas: [...COVER_AREA_KEYS] })
    expect(all.coverAreas).toHaveLength(COVER_AREA_KEYS.length)
  })
  it('name places without machine translation', () => {
    expect(coverAreaLabel('d7', 'vi')).toBe('Quận 7 (Phú Mỹ Hưng)')
    expect(coverAreaLabel('d7', 'ru')).toBe('District 7 (Phu My Hung)')
  })
})

describe('cover on the teacher profile', () => {
  it('is its own draft step, before qualifications (the teacher.eno.vn hand-off fires at the end of qualifications)', () => {
    const order = Object.keys(TEACHER_STEP_FIELDS)
    expect(order.indexOf('cover')).toBe(order.indexOf('experience') + 1)
    expect(order.indexOf('cover')).toBeLessThan(order.indexOf('qualifications'))
    expect(DRAFT_STEPS).toContain('cover')
  })
  it('cannot set the server-written cover columns from a body or the #d= fragment', () => {
    const t = normalizeTeacherInput({ ...base, ...coverOn, coverConfirmedAt: '2020-01-01', coverConsentAt: '2020-01-01', coverConsentVersion: 'x', coverWithdrawnAt: 'x' })
    for (const k of ['coverConfirmedAt', 'coverConsentAt', 'coverConsentVersion', 'coverWithdrawnAt']) expect(k in t, k).toBe(false)
  })
  it('drops slots and areas outside the lists and keeps a canonical order — but never an area for being outside the teacher\'s cities', () => {
    const t = normalizeTeacherInput({ ...base, ...coverOn, coverSlots: ['tue-pm', 'mon-am', 'mon', 'x-am', 'mon-am'], coverAreas: ['ha-noi', 'd7', 'da-nang', 'atlantis'] })
    expect(t.coverSlots).toEqual(['mon-am', 'tue-pm'])
    // da-nang is not one of this teacher's cities, and stays: the form shows every city, so the pick stays visible
    expect(t.coverAreas).toEqual(['d7', 'ha-noi', 'da-nang'].sort((a, b) => COVER_AREA_KEYS.indexOf(a) - COVER_AREA_KEYS.indexOf(b)))
  })
  it('never silently raises a typo to the minimum rate', () => {
    const t = normalizeTeacherInput({ ...base, ...coverOn, coverRateVnd: 30_000 })
    expect(t.coverRateVnd).toBe(30_000)
    expect(validateTeacherInput(t, ['cover']).coverRateVnd).toBe('rate_range')
    expect(validateTeacherInput(normalizeTeacherInput({ ...base, ...coverOn, coverRateVnd: 3_000_000 }), ['cover']).coverRateVnd).toBe('rate_range')
  })
  it('asks nothing while cover is off, and everything — including its OWN consent — once it is on', () => {
    expect(validateTeacherInput(normalizeTeacherInput(base), ['cover'])).toEqual({})
    const e = validateTeacherInput(normalizeTeacherInput({ ...base, coverOpen: true }), ['cover'])
    expect(e).toMatchObject({ coverSlots: 'required', coverAreas: 'required', coverRateVnd: 'required', coverConsent: 'required' })
    expect(validateTeacherInput(normalizeTeacherInput({ ...base, ...coverOn }), ['cover'])).toEqual({})
    // the public-profile consent is not the cover consent
    expect(validateTeacherInput(normalizeTeacherInput({ ...base, ...coverOn, coverConsent: false, consentPublic: true }), ['cover']).coverConsent).toBe('required')
  })
  it('emits cover tokens only while cover is on, consented and complete — and switching off drops every one', () => {
    const on = parseFacetTokens(teacherFacetTokens(normalizeTeacherInput({ ...base, ...coverOn })))
    expect(on).toEqual(expect.arrayContaining([
      { key: 'cover', value: 'open' }, { key: 'coverSlot', value: 'mon-am' }, { key: 'coverSlot', value: 'tue-pm' },
      { key: 'coverArea', value: 'd7' }, { key: 'coverArea', value: 'ha-noi' },
    ]))
    for (const off of [{ ...coverOn, coverOpen: false }, { ...coverOn, coverConsent: false }, { ...coverOn, coverRateVnd: null }]) {
      const pairs = parseFacetTokens(teacherFacetTokens(normalizeTeacherInput({ ...base, ...off })))
      expect(pairs.filter((p) => p.key.startsWith('cover')), JSON.stringify(off)).toEqual([])
    }
    // the saved data stays on the profile for later
    const kept = normalizeTeacherInput({ ...base, ...coverOn, coverOpen: false })
    expect(kept.coverSlots).toEqual(['mon-am', 'tue-pm'])
    expect(coverIsPublic(kept)).toBe(false)
  })
})

describe('the school filter', () => {
  const row = (areas: string[]) => ({ attributes: null, facetTokens: teacherFacetTokens(normalizeTeacherInput({ ...base, preferredCities: ['anywhere'], ...coverOn, coverAreas: areas })) })
  const cases: [string, string[], boolean][] = [
    ['d7', ['d7'], true],
    ['d7', ['ho-chi-minh-city'], true], // "anywhere in HCMC" covers District 7
    ['d2', ['thu-duc'], true], // Thủ Đức covers its old District 2
    ['thu-duc', ['d9'], true],
    ['d9', ['d2'], false],
    ['ho-chi-minh-city', ['binh-thanh'], true],
    ['d7', ['ha-noi'], false],
    ['ha-noi', ['d7'], false],
  ]
  it('finds the same rows in the feed predicate and in the Filter panel count (one expansion, attrNeedles)', () => {
    for (const [filter, areas, expected] of cases) {
      const r = row(areas)
      expect(attrMatcher('coverArea', filter)(r), `${filter} vs ${areas}`).toBe(expected)
      const where = attrWhere('coverArea', filter) as { OR: { facetTokens?: { contains: string } }[] }
      const sqlish = where.OR.some((c) => c.facetTokens && (r.facetTokens ?? '').includes(c.facetTokens.contains))
      expect(sqlish, `feed: ${filter} vs ${areas}`).toBe(expected)
    }
  })
  it('a Monday-morning filter never matches a teacher free on Monday afternoon and Tuesday morning', () => {
    const r = { attributes: null, facetTokens: teacherFacetTokens(normalizeTeacherInput({ ...base, ...coverOn, coverSlots: ['mon-pm', 'tue-am'] })) }
    expect(attrMatcher('coverSlot', 'mon-am')(r)).toBe(false)
    expect(attrMatcher('coverSlot', 'mon-pm')(r)).toBe(true)
  })
})

describe('the database CHECK (scripts/teachers-ddl.mjs)', () => {
  it('uses the same numbers as COVER_LIMITS', () => {
    const sql = readFileSync(join(process.cwd(), 'scripts/teachers-ddl.mjs'), 'utf8')
    expect(sql).toContain(`coalesce(cardinality("coverSlots"), 0) <= ${COVER_LIMITS.slots}`)
    expect(sql).toContain(`coalesce(cardinality("coverAreas"), 0) <= ${COVER_LIMITS.areas}`)
    expect(sql).toContain(`coalesce("coverRateVnd", 0) between ${COVER_LIMITS.rateMin} and ${COVER_LIMITS.rateMax}`)
  })
})

describe('coverStamp (the stale-window check)', () => {
  const a = { coverOpen: true, coverSlots: ['tue-pm', 'mon-am'], coverAreas: ['d7', 'd1'], coverRateVnd: 300_000 }
  it('ignores order — the form keeps tap order, the server canonical order', () => {
    expect(coverStamp(a)).toBe(coverStamp({ ...a, coverSlots: ['mon-am', 'tue-pm'], coverAreas: ['d1', 'd7'] }))
  })
  it('sees every real difference: on/off, a period, an area, the rate', () => {
    for (const b of [{ ...a, coverOpen: false }, { ...a, coverSlots: ['mon-am'] }, { ...a, coverAreas: ['d7'] }, { ...a, coverRateVnd: 350_000 }]) {
      expect(coverStamp(b)).not.toBe(coverStamp(a))
    }
  })
})
