import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  COVER_AREAS, COVER_AREA_KEYS, COVER_CITIES, COVER_CONSENT_VERSION, COVER_LIMITS, COVER_SLOTS, coverAreaFilterKeys, coverAreaLabel, coverStamp,
  coverAreasForCities, coverCitiesFor, coverDayShort, coverSlotLabel, mergeStaleCover, parseCoverSlot, type CoverDay, type SavedCover,
} from './cover'
import { coverIsPublic, normalizeTeacherInput, teacherFacetTokens, validateTeacherInput, DRAFT_STEPS, TEACHER_STEP_FIELDS, COVER_FIELDS } from './profile'
import { HUBS, coverReachOf } from './places'
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import { CATEGORY_BY_SLUG } from '@/lib/taxonomy'
import { attrMatcher, attrWhere } from '@/lib/attr-match'
import { parseFacetTokens } from '@/lib/facet-tokens'

/** A v2 teacher living in HCMC who can teach in District 7 and (as a part-time job seeker) in Hanoi. */
const base = {
  fullName: 'Jane Doe', headline: 'CELTA-certified English teacher, 6 years with kids', nationality: 'GB',
  livesIn: 'city', currentCity: 'ho-chi-minh-city', relocate: 'some', teachAreas: ['d7', 'ha-noi'], teachAreasConfirmed: true,
  jobTypes: ['parttime'], ageGroups: ['kids'], subjects: ['general-english'],
}
const coverOn = { coverOpen: true, coverSlots: ['mon-am', 'tue-pm'], coverRateVnd: 300_000, coverConsent: true }

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
  it('COVER_CITIES = the places hubs, and every hub is a "Can teach in" option under its own name', () => {
    const workIn = CATEGORY_BY_SLUG.teachers.facets.find((f) => f.key === 'workIn')!.options
    expect(COVER_CITIES.map((c) => c.key)).toEqual([...HUBS])
    for (const c of COVER_CITIES) expect(workIn.find((o) => o.value === c.key)).toMatchObject({ label: c.en, labelVi: c.vi })
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
  it('never cut a teacher\'s reach: the area cap holds every area there is', () => {
    expect(COVER_AREA_KEYS.length).toBeLessThanOrEqual(COVER_LIMITS.areas)
    // the widest reach (HCMC's every district, Bình Dương, Vũng Tàu) fits the cap and the CHECK
    const widest = coverReachOf(normalizeTeacherInput({ ...base, teachAreas: COVER_AREA_KEYS.filter((k) => k !== 'ho-chi-minh-city') }))
    expect(widest.length).toBeGreaterThan(20)
    expect(widest.length).toBeLessThanOrEqual(COVER_LIMITS.areas)
  })
  it('name places without machine translation', () => {
    expect(coverAreaLabel('d7', 'vi')).toBe('Quận 7 (Phú Mỹ Hưng)')
    expect(coverAreaLabel('d7', 'ru')).toBe('District 7 (Phu My Hung)')
  })
})

describe('cover on the teacher profile', () => {
  it('DRAFT_STEPS need no account and come before cover and finish; the hand-off fires after about', () => {
    const order = Object.keys(TEACHER_STEP_FIELDS)
    expect(DRAFT_STEPS).toEqual(['plans', 'where', 'teaching', 'about'])
    expect(order.slice(0, 4)).toEqual([...DRAFT_STEPS])
    expect(order.indexOf('cover')).toBe(order.indexOf('about') + 1)
    expect(order.indexOf('finish')).toBe(order.indexOf('cover') + 1)
    expect(DRAFT_STEPS).not.toContain('cover')
  })
  it('cannot set the server-written cover columns — the areas now among them — from a body or the #d= fragment', () => {
    const t = normalizeTeacherInput({ ...base, ...coverOn, coverAreas: ['d1'], coverConfirmedAt: '2020-01-01', coverConsentAt: '2020-01-01', coverConsentVersion: 'x', coverWithdrawnAt: 'x' })
    for (const k of ['coverAreas', 'coverConfirmedAt', 'coverConsentAt', 'coverConsentVersion', 'coverWithdrawnAt']) expect(k in t, k).toBe(false)
    expect([...COVER_FIELDS]).toEqual(['coverOpen', 'coverSlots', 'coverRateVnd', 'coverConsent'])
  })
  it('drops slots outside the list and keeps a canonical order; the reach is the teach areas near home', () => {
    const t = normalizeTeacherInput({ ...base, ...coverOn, coverSlots: ['tue-pm', 'mon-am', 'mon', 'x-am', 'mon-am'] })
    expect(t.coverSlots).toEqual(['mon-am', 'tue-pm'])
    // Hanoi is a teach area of this HCMC teacher, but not near home: cover never reaches it (owner, 2026-10-08)
    expect(coverReachOf(t)).toEqual(['d7'])
  })
  it('never silently raises a typo to the minimum rate', () => {
    const t = normalizeTeacherInput({ ...base, ...coverOn, coverRateVnd: 30_000 })
    expect(t.coverRateVnd).toBe(30_000)
    expect(validateTeacherInput(t, ['cover']).coverRateVnd).toBe('rate_range')
    expect(validateTeacherInput(normalizeTeacherInput({ ...base, ...coverOn, coverRateVnd: 3_000_000 }), ['cover']).coverRateVnd).toBe('rate_range')
  })
  it('asks nothing while cover is off, and everything — including its OWN consent and a reach — once it is on', () => {
    expect(validateTeacherInput(normalizeTeacherInput(base), ['cover'])).toEqual({})
    const e = validateTeacherInput(normalizeTeacherInput({ ...base, coverOpen: true, teachAreas: ['ha-noi'] }), ['cover'])
    expect(e).toMatchObject({ coverSlots: 'required', coverOpen: 'reach_required', coverRateVnd: 'required', coverConsent: 'required' })
    expect(validateTeacherInput(normalizeTeacherInput({ ...base, ...coverOn }), ['cover'])).toEqual({})
    // the Publish consent is not the cover consent
    expect(validateTeacherInput(normalizeTeacherInput({ ...base, ...coverOn, coverConsent: false, publishNotice: 'x' }), ['cover']).coverConsent).toBe('required')
  })
  it('emits cover tokens only while cover is on, consented and complete — and switching off drops every one', () => {
    const on = parseFacetTokens(teacherFacetTokens(normalizeTeacherInput({ ...base, ...coverOn })))
    expect(on).toEqual(expect.arrayContaining([
      { key: 'cover', value: 'open' }, { key: 'coverSlot', value: 'mon-am' }, { key: 'coverSlot', value: 'tue-pm' },
      { key: 'coverArea', value: 'd7' },
    ]))
    // the relocation city is a "Can teach in" token, never a cover area
    expect(on).not.toContainEqual({ key: 'coverArea', value: 'ha-noi' })
    expect(on).toContainEqual({ key: 'workIn', value: 'ha-noi' })
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
  // The teacher lives where the area is (cover reaches the home province only).
  const row = (areas: string[]) => ({
    attributes: null,
    facetTokens: teacherFacetTokens(normalizeTeacherInput({ ...base, currentCity: areas[0] === 'ha-noi' ? 'ha-noi' : 'ho-chi-minh-city', relocate: 'no', ...coverOn, teachAreas: areas })),
  })
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
    expect(coverIsPublic(normalizeTeacherInput({ ...base, ...coverOn }))).toBe(true)
    expect(attrMatcher('coverSlot', 'mon-am')(r)).toBe(false)
    expect(attrMatcher('coverSlot', 'mon-pm')(r)).toBe(true)
  })
})

describe('the cover notice version', () => {
  it('was bumped for the switch-as-consent and the derived areas (2026-10-08)', () => {
    expect(COVER_CONSENT_VERSION).toBe('2026-10-08')
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

describe('coverDayShort — weekday names never go through machine translation (preview check, 2026-10-07)', () => {
  it('keeps the authored English and Vietnamese labels', () => {
    expect(['mon', 'sun'].map((d) => coverDayShort(d as CoverDay, 'en'))).toEqual(['Mon', 'Sun'])
    expect(['mon', 'sun'].map((d) => coverDayShort(d as CoverDay, 'vi'))).toEqual(['T2', 'CN'])
  })
  it('gives every other UI language its own weekday names from Intl — ko read a bare "Mon" as "my" and "Sun" as "the sun"', () => {
    expect(coverDayShort('mon', 'ko')).toBe('월')
    expect(coverDayShort('sun', 'ko')).toBe('일')
    expect(coverDayShort('wed', 'ja')).toBe('水')
    expect(coverDayShort('mon', 'zh-Hans')).toBe('周一')
    expect(coverDayShort('mon', 'ru').toLowerCase()).toBe('пн')
  })
  it('falls back to English for a code Intl does not take', () => {
    expect(coverDayShort('mon', 'not a locale!')).toBe('Mon')
  })
})

// ── A stale window's re-read (gate reviews, 2026-10-07): field by field, and the tick never across a withdrawal ──────
describe('mergeStaleCover', () => {
  const saved = (o: Partial<SavedCover> = {}): SavedCover => ({ coverOpen: true, coverSlots: ['mon-am'], coverAreas: ['hcm-d1'], coverRateVnd: 300000, consentCurrent: true, ...o })
  const form = (b: SavedCover, o: Partial<Parameters<typeof mergeStaleCover>[0]> = {}) => ({ coverOpen: b.coverOpen, coverSlots: b.coverSlots, coverRateVnd: b.coverRateVnd, coverConsent: b.coverOpen && b.consentCurrent, ...o })

  it('an edited rate stays; the periods another window saved come in', () => {
    const base = saved()
    const r = mergeStaleCover(form(base, { coverRateVnd: 350000 }), base, saved({ coverSlots: ['wed-pm'] }))
    expect(r.cover).toEqual({ coverRateVnd: 350000, coverSlots: ['wed-pm'], coverOpen: true, coverConsent: true })
    expect(r.untouched).toBe(false)
  })
  it('the areas are derived, never merged — a reach another window moved leaves the form untouched', () => {
    const base = saved()
    const r = mergeStaleCover(form(base), base, saved({ coverAreas: ['hcm-d3'] }))
    expect('coverAreas' in r.cover).toBe(false)
    expect(r.untouched).toBe(true)
  })
  it('untouched: a withdrawal elsewhere switches it off here, tick and all', () => {
    const base = saved()
    const r = mergeStaleCover(form(base), base, saved({ coverOpen: false, consentCurrent: false }))
    expect(r.cover).toMatchObject({ coverOpen: false, coverConsent: false })
    expect(r).toMatchObject({ untouched: true, reconsent: false })
  })
  it('edited slots over a withdrawal: the slots stay, cover follows the withdrawal, the tick goes', () => {
    const base = saved()
    const r = mergeStaleCover(form(base, { coverSlots: ['tue-pm'] }), base, saved({ coverOpen: false, consentCurrent: false }))
    expect(r.cover).toMatchObject({ coverOpen: false, coverSlots: ['tue-pm'], coverConsent: false })
    expect(r.untouched).toBe(false)
  })
  it('a tick re-given here to an updated notice survives a change that withdrew nothing', () => {
    const base = saved({ consentCurrent: false })
    const r = mergeStaleCover(form(base, { coverConsent: true }), base, saved({ consentCurrent: false, coverSlots: ['wed-am'] }))
    expect(r.cover).toMatchObject({ coverConsent: true, coverSlots: ['wed-am'] })
    // The tick is the teacher's change here: "edited", so the line says a save applies it — never "the saved version".
    expect(r).toMatchObject({ untouched: false, reconsent: false })
  })
  it('…and never crosses a withdrawal', () => {
    const base = saved({ consentCurrent: false })
    const r = mergeStaleCover(form(base, { coverConsent: true }), base, saved({ coverOpen: false, consentCurrent: false }))
    expect(r.cover).toMatchObject({ coverOpen: false, coverConsent: false })
  })
  it('a tick removed here is never put back', () => {
    const base = saved()
    const r = mergeStaleCover(form(base, { coverConsent: false }), base, saved({ coverSlots: ['fri-pm'] }))
    expect(r.cover.coverConsent).toBe(false)
    expect(r.reconsent).toBe(false)
  })
  it('cover switched on and ticked here stays so over another window\'s edit while it was off', () => {
    const base = saved({ coverOpen: false, consentCurrent: false, coverSlots: [], coverAreas: [] })
    const r = mergeStaleCover(form(base, { coverOpen: true, coverSlots: ['mon-am'], coverConsent: true }), base, { ...base, coverRateVnd: 250000 })
    expect(r.cover).toMatchObject({ coverOpen: true, coverConsent: true, coverRateVnd: 250000 })
  })
  it('the saved consent no longer standing under a cover still on: the tick goes and the line asks for it', () => {
    const base = saved()
    const r = mergeStaleCover(form(base, { coverSlots: ['sat-am'] }), base, saved({ consentCurrent: false }))
    expect(r.cover).toMatchObject({ coverOpen: true, coverConsent: false })
    expect(r.reconsent).toBe(true)
  })
  it('no base (an edit form that loaded no profile): an untouched form takes the saved cover whole', () => {
    const empty = { coverOpen: false, coverSlots: [], coverRateVnd: null, coverConsent: false }
    const r = mergeStaleCover(empty, null, saved())
    expect(r.cover).toEqual({ coverOpen: true, coverSlots: ['mon-am'], coverRateVnd: 300000, coverConsent: true })
    expect(r.untouched).toBe(true)
  })
})
