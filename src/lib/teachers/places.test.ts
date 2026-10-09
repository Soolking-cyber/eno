import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ANYWHERE, CITY_PROVINCE, HCMC, HCMC_DISTRICT_KEYS, HUBS, HUB_PROVINCE, MAX_TEACH_AREAS, ONLINE, PLACE_KEYS, PROVINCE_PLACES,
  TOWN_ALIASES, coverReachOf, homeAreaKeys, homeHasCover, hubsInProvince, isPlaceKey, mirrorCities, normalizeTeachAreas,
  otherCityKeys, placeLabel, provinceKeyOf, relocationAllowed, situationForPlace, workInFilterKeys, type PlaceSituation,
} from './places'
import { COVER_AREAS, COVER_AREA_KEYS, COVER_CITIES } from './cover'
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import { VN_PROVINCES } from '@/lib/vn-areas'

const city = (currentCity: string, jobTypes: string[] = ['fulltime']): PlaceSituation => ({ livesIn: 'city', currentCity, currentProvince: '', jobTypes })
const elsewhere = (currentProvince: string, jobTypes: string[] = ['fulltime']): PlaceSituation => ({ livesIn: 'elsewhere', currentCity: '', currentProvince, jobTypes })
const abroad = (jobTypes: string[] = []): PlaceSituation => ({ livesIn: 'abroad', currentCity: '', currentProvince: '', jobTypes })
const unanswered: PlaceSituation = { livesIn: null, currentCity: '', currentProvince: '', jobTypes: [] }

describe('the place vocabulary', () => {
  it('is Online, the 12 hubs with HCMC\'s 24 districts (cover.ts, imported), 27 provinces and "anywhere" — in one canonical order', () => {
    expect(HUBS).toEqual(COVER_CITIES.map((c) => c.key))
    expect(HCMC_DISTRICT_KEYS).toEqual(DISTRICTS.filter((d) => d.slug !== 'all').map((d) => d.slug))
    expect(HCMC_DISTRICT_KEYS).toHaveLength(24)
    expect(PROVINCE_PLACES).toHaveLength(27)
    expect(PLACE_KEYS).toEqual([ONLINE, ...COVER_AREA_KEYS, ...PROVINCE_PLACES.map((p) => p.key), ANYWHERE])
    expect(new Set(PLACE_KEYS).size).toBe(PLACE_KEYS.length)
  })
  it('takes province codes and names from VN_PROVINCES, offering only the provinces no chip covers whole', () => {
    const chip = ['01', '31', '46', '48', '75', '79', '92'] // Hà Nội, Hải Phòng, Huế, Đà Nẵng, Đồng Nai, HCMC, Cần Thơ
    expect(PROVINCE_PLACES.map((p) => p.code)).toEqual(VN_PROVINCES.map((p) => p.code).filter((c) => !chip.includes(c)))
    for (const p of PROVINCE_PLACES) expect(VN_PROVINCES.find((v) => v.code === p.code)).toMatchObject({ name: p.name, nameEn: p.nameEn })
    // ⚠️ Khánh Hoà, Lâm Đồng and An Giang keep a province key: their chip is one town (Nha Trang, Đà Lạt, Phú Quốc).
    expect(['56', '68', '91'].map(provinceKeyOf)).toEqual(['p-56', 'p-68', 'p-91'])
    expect(provinceKeyOf('79')).toBeNull()
  })
  it('maps every hub to its province — HCMC, Bình Dương and Vũng Tàu are ONE province since the 2025 merger', () => {
    expect(hubsInProvince('79')).toEqual(['ho-chi-minh-city', 'binh-duong', 'vung-tau'])
    expect(CITY_PROVINCE).toEqual({
      'ho-chi-minh-city': 'Hồ Chí Minh', 'ha-noi': 'Hà Nội', 'da-nang': 'Đà Nẵng', 'hai-phong': 'Hải Phòng', 'can-tho': 'Cần Thơ',
      hue: 'Huế', 'khanh-hoa': 'Khánh Hoà', 'lam-dong': 'Lâm Đồng', 'dong-nai': 'Đồng Nai', 'binh-duong': 'Hồ Chí Minh',
      'vung-tau': 'Hồ Chí Minh', 'phu-quoc': 'An Giang',
    })
    for (const h of HUBS) expect(VN_PROVINCES.some((p) => p.code === HUB_PROVINCE[h]), h).toBe(true)
  })
  it('names places without machine translation — Vietnamese for vi, English for every other language', () => {
    expect(placeLabel('d7', 'vi')).toBe('Quận 7 (Phú Mỹ Hưng)')
    expect(placeLabel('d7', 'ko')).toBe('District 7 (Phu My Hung)')
    expect(placeLabel('khanh-hoa', 'en')).toBe('Nha Trang')
    expect(placeLabel('p-52', 'vi')).toBe('Gia Lai')
    expect(placeLabel(ONLINE, 'vi')).toBe('Trực tuyến')
    expect(placeLabel('atlantis', 'en')).toBe('atlantis')
  })
  it('resolves the curated town aliases to a chip or a province (Quy Nhơn is Gia Lai, Hội An is Đà Nẵng since 2025)', () => {
    const to = Object.fromEntries(TOWN_ALIASES.map((a) => [a.nameEn, a.to]))
    expect(to).toEqual({ 'Hoi An': 'da-nang', 'Quy Nhon': 'p-52', Vinh: 'p-40', 'Ha Long': 'p-22', 'Phan Thiet': 'p-68', 'Bien Hoa': 'dong-nai', 'Thu Dau Mot': 'binh-duong' })
    for (const a of TOWN_ALIASES) expect(isPlaceKey(a.to), a.name).toBe(true)
    expect(situationForPlace('da-nang')).toEqual({ livesIn: 'city', currentCity: 'da-nang' })
    expect(situationForPlace('p-52')).toEqual({ livesIn: 'elsewhere', currentProvince: '52' })
    expect(situationForPlace('online')).toBeNull()
  })
})

describe('the home area — "Near you", and the only places cover reaches', () => {
  it('is every place in the home province', () => {
    expect(homeAreaKeys(city(HCMC))).toEqual([HCMC, ...HCMC_DISTRICT_KEYS, 'binh-duong', 'vung-tau'])
    // a Bình Dương resident lives in the same province: HCMC and its districts are near home
    expect(homeAreaKeys(city('binh-duong'))).toEqual(homeAreaKeys(city(HCMC)))
    expect(homeAreaKeys(city('ha-noi'))).toEqual(['ha-noi'])
    // ⛔ Đồng Nai stands alone (owner, 2026-10-08) — Biên Hòa is not "near" Thủ Đức
    expect(homeAreaKeys(city('dong-nai'))).toEqual(['dong-nai'])
  })
  it('ties a town chip and its province together both ways (B5): Nha Trang ↔ Khánh Hoà', () => {
    expect(homeAreaKeys(city('khanh-hoa'))).toEqual(['khanh-hoa', 'p-56'])
    expect(homeAreaKeys(elsewhere('56'))).toEqual(['khanh-hoa', 'p-56'])
    expect(homeAreaKeys(elsewhere('52'))).toEqual(['p-52'])
  })
  it('is empty abroad, unanswered, or for a province no chip leaves out', () => {
    expect(homeAreaKeys(abroad())).toEqual([])
    expect(homeAreaKeys(unanswered)).toEqual([])
    expect(homeAreaKeys(elsewhere('01'))).toEqual([]) // Hà Nội is a chip — not a "somewhere else" province
  })
  it('offers the Cover step only where the home area holds a cover area', () => {
    expect(homeHasCover(city(HCMC))).toBe(true)
    expect(homeHasCover(elsewhere('56'))).toBe(true) // Cam Ranh: Nha Trang is in the home province (B5)
    expect(homeHasCover(elsewhere('52'))).toBe(false) // Gia Lai: no cover city in v1
    expect(homeHasCover(abroad(['fulltime']))).toBe(false)
  })
})

describe('normalizeTeachAreas — no double selection, and only what the situation allows', () => {
  it('drops unknown keys and keeps the canonical order', () => {
    expect(normalizeTeachAreas(['d7', ONLINE, 'atlantis', 7, 'd1', 'd7'], city(HCMC))).toEqual([ONLINE, 'd1', 'd7'])
    expect(normalizeTeachAreas('d7', city(HCMC))).toEqual([])
  })
  it('lets "all of HCMC" absorb its districts — the whole city wins (B2: a stated reach never shrinks)', () => {
    expect(normalizeTeachAreas(['d1', HCMC, 'd3'], city(HCMC))).toEqual([HCMC])
  })
  it('lets Thủ Đức absorb District 2 and 9', () => {
    expect(normalizeTeachAreas(['d2', 'thu-duc', 'd9', 'd7'], city(HCMC))).toEqual(['thu-duc', 'd7'])
  })
  it('lets "anywhere" absorb the other cities, never the home ones', () => {
    expect(normalizeTeachAreas(['d7', 'ha-noi', 'da-nang', ANYWHERE], city(HCMC))).toEqual(['d7', ANYWHERE])
  })
  it('allows other cities and "anywhere" only to full-time / part-time job seekers in Vietnam, and to teachers abroad', () => {
    const picks = [ONLINE, HCMC, 'ha-noi', ANYWHERE]
    expect(normalizeTeachAreas(picks, city(HCMC, ['private']))).toEqual([ONLINE, HCMC])
    expect(normalizeTeachAreas(picks, city(HCMC, []))).toEqual([ONLINE, HCMC]) // cover only
    expect(normalizeTeachAreas(['ha-noi'], city(HCMC, ['parttime']))).toEqual(['ha-noi'])
    expect(normalizeTeachAreas(['ha-noi', 'da-nang'], abroad())).toEqual(['ha-noi', 'da-nang'])
    expect(relocationAllowed(abroad())).toBe(true)
    expect(relocationAllowed(unanswered)).toBe(false)
  })
  it('keeps districts and province keys at home only — relocation cities are whole-city only', () => {
    expect(normalizeTeachAreas(['d7', 'ha-noi'], city('ha-noi'))).toEqual(['ha-noi'])
    expect(normalizeTeachAreas(['d7'], abroad())).toEqual([])
    expect(normalizeTeachAreas(['p-52', 'p-56'], elsewhere('52'))).toEqual(['p-52'])
    expect(normalizeTeachAreas(['p-56', 'khanh-hoa'], city('khanh-hoa', []))).toEqual(['khanh-hoa', 'p-56'])
  })
  it('keeps every known key while "Where are you now?" is unanswered (a restored old draft), pruning on the answer', () => {
    const draft = [ONLINE, 'ha-noi', 'd7', 'd2', 'thu-duc']
    expect(normalizeTeachAreas(draft, unanswered)).toEqual([ONLINE, 'thu-duc', 'd7', 'ha-noi'])
    expect(normalizeTeachAreas(draft, city('ha-noi', ['private']))).toEqual([ONLINE, 'ha-noi'])
  })
  it('never cuts a legal list: the longest reachable one fits the cap', () => {
    const most = [ONLINE, ...HCMC_DISTRICT_KEYS.filter((k) => k !== 'thu-duc'), ...HUBS.filter((h) => h !== HCMC)]
    const kept = normalizeTeachAreas(most, city(HCMC))
    expect(kept).toHaveLength(35)
    expect(kept.length).toBeLessThanOrEqual(MAX_TEACH_AREAS)
  })
})

describe('coverReachOf — where schools find the teacher for cover', () => {
  it('is the teach areas near home that are cover areas — never another city, Online or "anywhere"', () => {
    expect(coverReachOf({ ...city(HCMC), teachAreas: [ONLINE, 'd4', 'd7', 'ha-noi', ANYWHERE] })).toEqual(['d4', 'd7'])
    expect(coverReachOf({ ...city('binh-duong'), teachAreas: ['binh-duong', 'd7'] })).toEqual(['d7', 'binh-duong'])
    expect(coverReachOf({ ...elsewhere('56'), teachAreas: ['khanh-hoa', 'p-56'] })).toEqual(['khanh-hoa'])
    expect(coverReachOf({ ...abroad(['fulltime']), teachAreas: [HCMC, 'ha-noi'] })).toEqual([])
  })
  it('follows COVER_AREA_KEYS order, so the derived coverAreas column is stable', () => {
    const reach = coverReachOf({ ...city(HCMC), teachAreas: ['vung-tau', 'd7', 'binh-duong', 'd1'] })
    expect(reach).toEqual([...reach].sort((a, b) => COVER_AREA_KEYS.indexOf(a) - COVER_AREA_KEYS.indexOf(b)))
  })
})

describe('workInFilterKeys — a school\'s "Can teach in" filter', () => {
  it('expands a city to its districts, its province key (B5) and "anywhere"', () => {
    expect(workInFilterKeys(HCMC)).toEqual([HCMC, ...HCMC_DISTRICT_KEYS, ANYWHERE])
    expect(workInFilterKeys('khanh-hoa')).toEqual(['khanh-hoa', 'p-56', ANYWHERE])
    expect(workInFilterKeys('ha-noi')).toEqual(['ha-noi', ANYWHERE])
  })
  it('expands a district through its umbrella to the whole city, and "anywhere"', () => {
    expect(workInFilterKeys('d2')).toEqual(expect.arrayContaining(['d2', 'thu-duc', HCMC, ANYWHERE]))
    expect(workInFilterKeys('d9')).not.toContain('d2')
  })
  it('expands a province key to the towns inside it, and "anywhere"', () => {
    expect(workInFilterKeys('p-56')).toEqual(['p-56', 'khanh-hoa', ANYWHERE])
    expect(workInFilterKeys('p-52')).toEqual(['p-52', ANYWHERE])
  })
  it('matches Online and "anywhere" exactly', () => {
    expect(workInFilterKeys(ONLINE)).toEqual([ONLINE])
    expect(workInFilterKeys(ANYWHERE)).toEqual([ANYWHERE])
    expect(workInFilterKeys('atlantis')).toEqual(['atlantis'])
  })
})

describe('mirrorCities — the preferredCities mirror the old readers and the matcher keep reading', () => {
  it('is the city level: a district → HCMC, province keys dropped, anywhere and online kept, in the old workIn order', () => {
    expect(mirrorCities([ONLINE, 'd7', 'thu-duc', 'ha-noi', 'p-56', ANYWHERE])).toEqual([HCMC, 'ha-noi', ANYWHERE, ONLINE])
    expect(mirrorCities([])).toEqual([])
  })
  it('round-trips the old vocabulary unchanged', () => {
    expect(mirrorCities([...HUBS, ANYWHERE, ONLINE])).toEqual([...HUBS, ANYWHERE, ONLINE])
  })
})

describe('the database CHECK (scripts/teachers-ddl.mjs)', () => {
  it('holds the same bounds as MAX_TEACH_AREAS and the taught-language limit', () => {
    const sql = readFileSync(join(process.cwd(), 'scripts/teachers-ddl.mjs'), 'utf8')
    expect(sql).toContain(`coalesce(cardinality("teachAreas"), 0) <= ${MAX_TEACH_AREAS}`)
    expect(sql).toContain('coalesce(cardinality("teachLanguages"), 0) <= 8')
    expect(COVER_AREAS.length).toBeLessThanOrEqual(MAX_TEACH_AREAS)
  })
})

describe('other cities', () => {
  it('are the hubs outside the home area', () => {
    expect(otherCityKeys(city(HCMC))).toEqual(HUBS.filter((h) => !['ho-chi-minh-city', 'binh-duong', 'vung-tau'].includes(h)))
    expect(otherCityKeys(abroad())).toEqual(HUBS)
  })
})
