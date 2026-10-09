import { describe, expect, it } from 'vitest'
import {
  availableMonthLabel, availableStart, homeLocationName, livesInLine, msUntilStart, publicSituation, startHasBegun, teachAreaRows,
  type PublicSituation,
} from './profile-view'
import { teacherHome } from './projection'

/**
 * THE PUBLIC PROFILE'S PLACE LINES (teacher onboarding redesign, owner, 2026-10-08) — what a school reads about where a
 * teacher lives and can teach. ⛔ Never an empty city, never the old Hồ Chí Minh fallback, never a city the teacher does
 * not live in; place names in the page's language and never machine-translated.
 */
const at = (s: Partial<PublicSituation>): PublicSituation => ({
  livesIn: null, currentCity: '', currentDistrictKey: '', currentProvince: '', teachAreas: [], ...s,
})
const hcmcD7 = at({ livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7', teachAreas: ['online', 'd4', 'd7', 'ha-noi', 'da-nang'] })
const giaLai = at({ livesIn: 'elsewhere', currentProvince: '52', teachAreas: ['online', 'p-52', 'da-nang'] })
const abroad = at({ livesIn: 'abroad', teachAreas: ['online', 'anywhere'] })
const nhaTrang = at({ livesIn: 'city', currentCity: 'khanh-hoa', teachAreas: ['khanh-hoa', 'p-56'] })
const binhDuong = at({ livesIn: 'city', currentCity: 'binh-duong', teachAreas: ['ho-chi-minh-city', 'binh-duong', 'vung-tau'] })

describe('livesInLine — "Lives in …"', () => {
  it('a district in HCMC by its curated name, then the city — in the page language', () => {
    expect(livesInLine(hcmcD7, 'en')).toEqual({ kind: 'place', place: 'District 7 (Phu My Hung), Ho Chi Minh City' })
    expect(livesInLine(hcmcD7, 'vi')).toEqual({ kind: 'place', place: 'Quận 7 (Phú Mỹ Hưng), TP. Hồ Chí Minh' })
  })
  it('a city without a district ("Prefer not to say") is the city alone; a district outside HCMC is never shown', () => {
    expect(livesInLine(at({ livesIn: 'city', currentCity: 'ho-chi-minh-city' }), 'en')).toEqual({ kind: 'place', place: 'Ho Chi Minh City' })
    expect(livesInLine(at({ livesIn: 'city', currentCity: 'ha-noi', currentDistrictKey: 'd7' }), 'en')).toEqual({ kind: 'place', place: 'Hanoi' })
  })
  it('"somewhere else in Vietnam" is the province — never a city they do not live in', () => {
    expect(livesInLine(giaLai, 'en')).toEqual({ kind: 'place', place: 'Gia Lai' })
    expect(livesInLine(at({ livesIn: 'elsewhere', currentProvince: '68' }), 'vi')).toEqual({ kind: 'place', place: 'Lâm Đồng' })
  })
  it('abroad is its own line, with Online when they teach online — no city at all', () => {
    expect(livesInLine(abroad, 'en')).toEqual({ kind: 'abroad', online: true })
    expect(livesInLine(at({ livesIn: 'abroad', teachAreas: ['ha-noi'] }), 'en')).toEqual({ kind: 'abroad', online: false })
  })
  it('⛔ says nothing rather than an empty or a guessed place: unanswered, or an answer that does not hold together', () => {
    expect(livesInLine(at({ currentCity: 'ho-chi-minh-city' }), 'en')).toBeNull() // livesIn NULL — never the old fallback
    expect(livesInLine(at({ livesIn: 'city', currentCity: '' }), 'en')).toBeNull()
    expect(livesInLine(at({ livesIn: 'elsewhere', currentProvince: '79' }), 'en')).toBeNull() // a chip province is not "elsewhere"
  })
  it('agrees with the card (Listing.location, projection.ts teacherHome) in English, wherever the teacher lives', () => {
    for (const s of [hcmcD7, giaLai, nhaTrang, binhDuong, at({ livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'thu-duc' })]) {
      const line = livesInLine(s, 'en')
      expect(line?.kind).toBe('place')
      expect(line && line.kind === 'place' ? line.place : '').toBe(teacherHome({ ...s, teachAreas: [...s.teachAreas] }).location)
    }
  })
})

describe('teachAreaRows — "Can teach in" (near home + Online) and "Would move to"', () => {
  it('HCMC: Online and its districts near home; Hanoi and Da Nang are a move', () => {
    expect(teachAreaRows(hcmcD7)).toEqual({ canTeachIn: ['online', 'd4', 'd7'], wouldMoveTo: ['ha-noi', 'da-nang'] })
  })
  it('the home PROVINCE is near — Bình Dương with HCMC and Vũng Tàu (one province since 2025), Nha Trang with Khánh Hoà', () => {
    expect(teachAreaRows(binhDuong)).toEqual({ canTeachIn: ['ho-chi-minh-city', 'binh-duong', 'vung-tau'], wouldMoveTo: [] })
    expect(teachAreaRows(nhaTrang)).toEqual({ canTeachIn: ['khanh-hoa', 'p-56'], wouldMoveTo: [] })
  })
  it('a province teacher: the province near, another city a move', () => {
    expect(teachAreaRows(giaLai)).toEqual({ canTeachIn: ['online', 'p-52'], wouldMoveTo: ['da-nang'] })
  })
  it('abroad: only Online is "can teach in" — every place in Vietnam is a move', () => {
    expect(teachAreaRows(abroad)).toEqual({ canTeachIn: ['online'], wouldMoveTo: ['anywhere'] })
  })
  it('unanswered: one list, nothing called a move (there is no home to move from)', () => {
    expect(teachAreaRows(at({ teachAreas: ['online', 'ha-noi'] }))).toEqual({ canTeachIn: ['online', 'ha-noi'], wouldMoveTo: [] })
  })
})

describe('homeLocationName — the JSON-LD home, only for a teacher who lives in Vietnam', () => {
  it('the city (never the district), or the province', () => {
    expect(homeLocationName(hcmcD7)).toBe('Ho Chi Minh City')
    expect(homeLocationName(nhaTrang)).toBe('Nha Trang')
    expect(homeLocationName(giaLai)).toBe('Gia Lai')
  })
  it('⛔ none abroad, none unanswered, none for an answer that does not hold together', () => {
    expect(homeLocationName(abroad)).toBeNull()
    expect(homeLocationName(at({ currentCity: 'ho-chi-minh-city' }))).toBeNull()
    expect(homeLocationName(at({ livesIn: 'elsewhere', currentProvince: '' }))).toBeNull()
  })
})

describe('publicSituation — a stored row, NULL-safe', () => {
  it('reads NULL columns as empty, an unknown livesIn as unanswered, and drops an unknown place key', () => {
    expect(publicSituation({ livesIn: 'moon', currentCity: null, teachAreas: null })).toEqual(at({}))
    expect(publicSituation({ livesIn: 'city', currentCity: 'ha-noi', teachAreas: ['ha-noi', 'atlantis'] }).teachAreas).toEqual(['ha-noi'])
  })
})

describe('"Available from" — a month, and "now" only on the reader\'s clock', () => {
  it('reads the stored start as a day (a Date or YYYY-MM[-DD]) — the month\'s 1st when there is no day', () => {
    expect(availableStart(new Date('2026-11-01T00:00:00Z'))).toBe('2026-11-01')
    expect(availableStart('2026-11-01')).toBe('2026-11-01')
    expect(availableStart('2026-11')).toBe('2026-11-01')
    expect(availableStart(null)).toBeNull()
    expect(availableStart('soon')).toBeNull()
    expect(availableStart(new Date(Number.NaN))).toBeNull()
  })
  it('⛔ keeps an old row\'s DAY — the old form saved any day and the backfill never rewrites it (gate review, 2026-10-08)', () => {
    expect(availableStart(new Date('2026-11-20T00:00:00Z'))).toBe('2026-11-20')
  })
  it('names it in the reader\'s language, from a table for en / vi (no Intl in an ISR first render)', () => {
    expect(availableMonthLabel('2026-11', 'en')).toBe('November 2026')
    expect(availableMonthLabel('2026-11', 'vi')).toBe('tháng 11/2026')
    expect(availableMonthLabel('2026-11', 'fr')).toMatch(/novembre 2026/i)
    expect(availableMonthLabel('garbage', 'en')).toBe('garbage')
  })
  it('has begun on Vietnam\'s calendar (UTC+7) — the 1st of the month at 01:00 in Hanoi is still the 31st in UTC', () => {
    const vn1Nov0100 = Date.UTC(2026, 9, 31, 18) // 2026-10-31 18:00 UTC = 2026-11-01 01:00 in Vietnam
    expect(startHasBegun('2026-11-01', vn1Nov0100)).toBe(true)
    expect(startHasBegun('2026-11-01', vn1Nov0100 - 2 * 3600_000)).toBe(false)
    expect(startHasBegun('2026-09-01', vn1Nov0100)).toBe(true)
    expect(startHasBegun('nonsense', vn1Nov0100)).toBe(false)
  })
  it('⛔ an old row\'s mid-month day has NOT begun on the 1st — only on that day (gate review, 2026-10-08)', () => {
    const vn5Nov = Date.UTC(2026, 10, 5, 3) // 5 November, 10:00 in Vietnam
    expect(startHasBegun('2026-11-20', vn5Nov)).toBe(false)
    expect(startHasBegun('2026-11-20', Date.UTC(2026, 10, 19, 17))).toBe(true) // 20 November, 00:00 in Vietnam
  })
  it('msUntilStart is the wait for Vietnam\'s midnight on that day — none once it has begun, exactly as startHasBegun says', () => {
    const vn31Oct2359 = Date.UTC(2026, 9, 31, 16, 59) // 2026-10-31 23:59 in Vietnam
    expect(msUntilStart('2026-11-01', vn31Oct2359)).toBe(60_000)
    expect(msUntilStart('2026-11-01', vn31Oct2359 + 60_000)).toBeNull()
    expect(msUntilStart('nonsense', vn31Oct2359)).toBeNull()
    for (const now of [vn31Oct2359, vn31Oct2359 + 59_999, vn31Oct2359 + 60_000, Date.UTC(2027, 0, 1)]) {
      expect(msUntilStart('2026-11-01', now) === null).toBe(startHasBegun('2026-11-01', now))
    }
  })
})
