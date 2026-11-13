import { describe, expect, it, vi } from 'vitest'
import {
  GOPLUS_AMENITY_VALUES, GOPLUS_EMAIL, amenityOptions, goplusPublishGate, GOPLUS_EXPIRY_GUARD_FLOOR, GOPLUS_MIN_PHOTOS, GOPLUS_PRICE_UNIT, GOPLUS_VIDEO_MAX_BYTES,
  goplusAmenities, goplusApplyExitCode, goplusDistrict, goplusExtras, goplusFees, goplusFloor, goplusPhotoAction,
  goplusPhotoPlan, goplusReadProblem, goplusRoomIdOf, goplusSellerRefusal, goplusSourceKey, goplusStoredPhotoKey,
  goplusStoredVideoHex, goplusUnit, goplusVideoAction, goplusVideoHex, goplusVideoObjectName, goplusVideoVerdict,
  goplusWard, isGoplusImageUrl, isGoplusVideoUrl, mapGoplusRoom, mp4Info, planGoplusExpiry, stageGoplusProject,
  goplusBuildingAmenityKeys, GOPLUS_BUILDING_WIDE_KEYS, goplusPartialTokens, goplusOverlaySlug,
  stageGoplusRoom, type GoplusProject, type GoplusRoom, goplusElectricityGuess, GOPLUS_ELECTRICITY_TYPICAL,
  GOPLUS_ELECTRICITY_GUESS_MAX_OFF, GOPLUS_COMMERCIAL_SUBCAT, goplusRoomPageUrl,
  GOPLUS_FORMER_PROVINCES, GOPLUS_HCMC_CODE, goplusCity, goplusProvince, isGoplusTemplateDescription,
} from './goplus-listing'
import { VN_PROVINCES } from './vn-areas'
import { matchesProvinceRow } from './province-match'
import { parseFacetTokens } from './facet-tokens'
import { ELECTRICITY_ESTIMATED, plausibleFee, rentalCostRows } from './rental-facts'
import { isOverlayImageUrl, overlayImagePath } from './image-mark-url'
import type { VerificationRow } from './compliance/derive-verification'

/**
 * The GoPlus mapper, on the REAL shapes of goplus.com.vn's public API (read 2026-10-19, 2,669 rooms): the sample room
 * is room 25fe4221871ad83039bcd25b exactly as /api/public/apartments/<id> answered — its contact block included, so the
 * whitelist is tested against what the source really sends.
 */
const RAW_ROOM = {
  id: '25fe4221871ad83039bcd25b', _id: '25fe4221871ad83039bcd25b', title: '002 - Duplex', slug: 'trung-my-tay-quan-12-ql1a-002',
  code: '002', maSo: 12038, area: 20, maxTenants: 2, deposit: 3500000, status: { id: '1', title: 'Trống' },
  availableDate: null, floor: { name: 'Tầng Trệt' }, type: { name: 'Duplex' }, apartment: { name: 'Phường Trung Mỹ Tây' },
  region: 'Thành phố Hồ Chí Minh', ward: 'Phường Trung Mỹ Tây', street: 'Ql1a', geo: null, videos: [],
  price: { base: 3500000, electric: 3800, water: 100000, waterUnit: 'person', service: 150000 },
  fees: [
    { id: 'electric', name: 'Tiền điện', price: 3800, unit: 'kWh' },
    { id: 'water', name: 'Tiền nước', price: 100000, unit: 'người' },
    { id: 'service', name: 'Phí dịch vụ', price: 150000, unit: 'tháng' },
    { id: 'parking', name: 'Phí giữ xe', price: 100000, unit: 'xe/tháng' },
  ],
  feesSource: 'building', amenities: [],
  amenityKeys: ['no_landlord', 'free_hours', 'pet', 'window', 'private_wc', 'elevator', 'mezzanine', 'aircon', 'water_heater', 'kitchen', 'wardrobe', 'parking', 'security', 'wifi'],
  negotiable: false, projectId: 'PRJ-9b078ddb12efe4b1632a', featured: true, updatedAt: '2026-10-15T06:41:04.345Z',
  images: [
    'https://goplus.com.vn/images/img/1e603dc4c641112d7f628291f8216ab1.webp',
    'https://goplus.com.vn/images/img/b87bfc7bf7f85fd0c45fe594a04d197c.webp',
    'https://goplus.com.vn/images/img/686f8ed4e170d7f84034f67f5ef9ac1a.webp',
    'https://goplus.com.vn/images/img/e184de42f58fb78035f4f82149608dfc.webp',
    'https://goplus.com.vn/images/img/202015e64243f54b8125ca7bcc85949d.webp',
  ],
  contact: { phone: '0369116666', zalo: 'https://zalo.me/657976829305455817', email: 'contact@goplus.com.vn', hours: '8:00 – 20:00 (T2 – CN)' },
  saleContact: { phone: '0900000000' },
}
const RAW_PROJECT = {
  projectId: 'PRJ-9b078ddb12efe4b1632a', publicName: null, title: 'Ql1a, Phường Trung Mỹ Tây, Quận 12', street: 'Ql1a',
  ward: 'Phường Trung Mỹ Tây', oldWard: null, district: 'Quận 12', region: 'Thành phố Hồ Chí Minh',
  geo: { lat: 10.8598, lng: 106.6209, approx: true }, contact: { phone: '0369116666' },
}
const NOW = Date.parse('2026-10-19T08:00:00Z')
const OPTS = { now: NOW, maxPhotos: 10 }
const room = (patch: Partial<GoplusRoom> = {}): GoplusRoom => ({ ...stageGoplusRoom(RAW_ROOM)!, ...patch })
const project = (patch: Partial<GoplusProject> = {}): GoplusProject => ({ ...stageGoplusProject(RAW_PROJECT)!, ...patch })
const mapped = (r = room(), p: GoplusProject | null = project()) => {
  const m = mapGoplusRoom(r, p, OPTS)
  if (!m.ok) throw new Error(`dropped: ${m.reason}`)
  return m.row
}

describe('stageGoplusRoom / stageGoplusProject — whitelists', () => {
  it('⛔ never stages the hotline, the Zalo link or the email (contact, saleContact)', () => {
    const s = JSON.stringify(stageGoplusRoom(RAW_ROOM))
    for (const leak of ['0369116666', 'zalo', '0900000000', 'contact@goplus', '8:00']) expect(s).not.toContain(leak)
    expect(JSON.stringify(stageGoplusProject(RAW_PROJECT))).not.toContain('0369116666')
  })
  it('keeps the facts, folds status to its id, drops an unknown fee id and a non-numeric fee', () => {
    const r = stageGoplusRoom({ ...RAW_ROOM, fees: [...RAW_ROOM.fees, { id: 'internet', price: 100000, unit: 'tháng' }, { id: 'service', price: 'free' }] })!
    expect(r).toMatchObject({ id: RAW_ROOM.id, area: 20, maxTenants: 2, deposit: 3500000, statusId: '1', floor: 'Tầng Trệt', type: 'Duplex', projectId: 'PRJ-9b078ddb12efe4b1632a' })
    expect(r.fees.map((f) => f.id)).toEqual(['electric', 'water', 'service', 'parking'])
  })
  it('refuses a row without a 24-hex id, and keeps only a YYYY-MM-DD availableDate', () => {
    expect(stageGoplusRoom({ ...RAW_ROOM, id: 'x', _id: undefined })).toBeNull()
    expect(stageGoplusRoom({ ...RAW_ROOM, availableDate: '2026-11-02T00:00:00Z' })!.availableDate).toBe('2026-11-02')
    expect(stageGoplusRoom({ ...RAW_ROOM, availableDate: 'soon' })!.availableDate).toBeNull()
    // Reviewers' catches: a timestamp is read as the day it is in Vietnam; a day that does not exist is no date.
    expect(stageGoplusRoom({ ...RAW_ROOM, availableDate: '2026-11-01T17:00:00.000Z' })!.availableDate).toBe('2026-11-02')
    expect(stageGoplusRoom({ ...RAW_ROOM, availableDate: '2026-02-31' })!.availableDate).toBeNull()
    expect(stageGoplusRoom({ ...RAW_ROOM, availableDate: '2026-99-99' })!.availableDate).toBeNull()
  })
  it('a building: id, its province (region), district, ward, street, its map point — and (only from the detail endpoint) its amenities', () => {
    expect(stageGoplusProject(RAW_PROJECT)).toEqual({ projectId: 'PRJ-9b078ddb12efe4b1632a', region: 'Thành phố Hồ Chí Minh', district: 'Quận 12', ward: 'Phường Trung Mỹ Tây', street: 'Ql1a', geo: { lat: 10.8598, lng: 106.6209, approx: true }, amenityKeys: [], amenitiesComplete: false, roomCount: null })
    expect(stageGoplusProject({ ...RAW_PROJECT, geo: null })!.geo).toBeNull()
    expect(stageGoplusProject({ ...RAW_PROJECT, projectId: 'nope' })).toBeNull()
  })
  it('the region is one line or nothing: whitespace folded, a missing, blank or non-string one is null', () => {
    expect(stageGoplusProject({ ...RAW_PROJECT, region: '  Thành phố\nCần Thơ ' })!.region).toBe('Thành phố Cần Thơ')
    for (const region of [undefined, null, '', '   ', 92, { name: 'Cần Thơ' }]) expect(stageGoplusProject({ ...RAW_PROJECT, region })!.region, JSON.stringify(region)).toBeNull()
  })
})

describe('goplusUnit — the measured types and their typos', () => {
  it.each([
    ['Duplex', 'duplex'], ['duplex', 'duplex'], ['Duplex ', 'duplex'], ['Diplex', 'duplex'],
    ['Studio', 'studio'], ['Studio ', 'studio'], ['Studiô', 'studio'], ['StudioStudio', 'studio'],
    ['1PN', '1br'], ['2PN', '2br'], ['3PN', '3br'], ['Penhouse', 'penthouse'],
    ['Kiot', 'commercial'], ['MB', 'commercial'], [null, 'room'], ['Phòng', 'room'], ['Villa', 'unknown'],
  ] as const)('%s → %s', (t, want) => expect(goplusUnit(t)).toBe(want))
})

describe('goplusFloor — 56 spellings measured', () => {
  it.each([
    ['Tầng Trệt', '0'], ['Tầng Trệt ', '0'], ['Tầngg Trệt', '0'], ['Tầng  Trệt', '0'], ['Tầng Trêt', '0'], ['Trệt', '0'], ['trệt', '0'], ['Tret', '0'],
    ['Tầng G', '0'], ['G', '0'], ['Tầng G`', '0'],
    ['Tầng Lửng', 'mezzanine'], ['lững', 'mezzanine'], ['Tầng Lừng', 'mezzanine'], ['Tầng lững', 'mezzanine'], ['Lửng', 'mezzanine'], ['Tầng L', 'mezzanine'],
    ['Tầng 1', '1'], ['Tầng 1 ', '1'], ['01', '1'], ['1', '1'], ['03', '3'], ['Tâng 4', '4'], ['Tầngv 4', '4'], [' tầng 6', '6'], ['Tầng 9', '9'],
    ['402', null], ['Tầng 41', null], ['Tầng 3A', null], ['Tầng n1', null], [null, null], ['', null],
  ] as const)('%s → %s', (raw, want) => expect(goplusFloor(raw)).toBe(want))
})

describe('goplusFees', () => {
  it('reads fees[] with their units; parking only exists there', () => {
    expect(goplusFees(room())).toEqual({ electricity: 3800, water: 100000, waterUnit: 'person', service: 150000, parking: 100000 })
  })
  it('water per m³; price.* is the fallback when fees[] lacks a fee', () => {
    expect(goplusFees(room({ fees: [{ id: 'water', price: 28000, unit: 'm³' }] }))).toEqual({ electricity: 3800, water: 28000, waterUnit: 'm3', service: 150000, parking: null })
    expect(goplusFees(room({ fees: [], price: { base: 1, electric: null, water: 100000, waterUnit: 'person', service: null } }))).toEqual({ electricity: null, water: 100000, waterUnit: 'person', service: null, parking: null })
  })
  it('⛔ a zero is never published (it would read as free)', () => {
    expect(goplusFees(room({ fees: [{ id: 'electric', price: 0, unit: 'kWh' }], price: { base: 1, electric: 0, water: 0, waterUnit: 'person', service: 0 } })))
      .toEqual({ electricity: null, water: null, waterUnit: null, service: null, parking: null })
  })
})

/**
 * THE ELECTRICITY GUESS (owner, 2026-10-20: "fix error electricity prices with closest guess"): every impossible rate
 * measured on GoPlus that day (30 rooms) reads as its closest plausible typo, flagged as an estimate; a plausible rate is
 * itself; nothing plausible within reach → null, the rate is not stored (the drop rule as before).
 */
describe('goplusElectricityGuess', () => {
  it.each([
    [44_000, 4_000], [33_800, 3_800], [400_000, 4_000], [3_800_000, 3_800], [3_900_000, 3_900], [4_000_000, 4_000],
    [40_000, 4_000], [400, 4_000],
  ])('the measured %i đ/kWh → ≈ %i, estimated', (v, want) => {
    expect(goplusElectricityGuess(v)).toEqual({ value: want, estimated: true })
    expect(plausibleFee('electricityPrice', String(v))).toBeNull()   // each really is outside the page's range
  })
  it('a plausible rate is itself — never "estimated" — up to both edges of the page\'s range', () => {
    expect(goplusElectricityGuess(3_800)).toEqual({ value: 3_800, estimated: false })
    expect(goplusElectricityGuess(500)).toEqual({ value: 500, estimated: false })
    expect(goplusElectricityGuess(10_000)).toEqual({ value: 10_000, estimated: false })
  })
  it('nothing to read: zero, negative, NaN, infinite, missing', () => {
    for (const v of [0, -3_800, -44_000, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) expect(goplusElectricityGuess(v)).toBeNull()
  })
  it('no plausible candidate → null: no trailing zeros to drop and no key struck twice', () => {
    expect(goplusElectricityGuess(123_456_789)).toBeNull()
    expect(goplusElectricityGuess(1e21)).toBeNull()
  })
  it('the candidate nearest the typical 4,000 on a LOG scale wins', () => {
    expect(GOPLUS_ELECTRICITY_TYPICAL).toBe(4_000)
    // 33,800: the doubled 3 dropped (3,800 — 1.05× off) beats ÷10 (3,380 — 1.18×).
    expect(goplusElectricityGuess(33_800)?.value).toBe(3_800)
    // 44,000: the doubled 4 dropped (4,000) beats ÷10 (4,400).
    expect(goplusElectricityGuess(44_000)?.value).toBe(4_000)
    // ÷10^k is a DIVISION: 380,000,000 × 10^-5 is not a whole number in floating point, 380,000,000 / 10^5 is.
    expect(goplusElectricityGuess(380_000_000)).toEqual({ value: 3_800, estimated: true })
  })
  // A reviewer's catch (2026-10-20): deleting ANY digit let a real one go whenever what was left sat nearer 4,000.
  it('⛔ deletes only a digit that REPEATS the one before it — a real digit of the rate is never dropped', () => {
    // 4,300 is a live GoPlus rate (11 rooms, 2026-10-20): 43,000 is it with a zero added, never 4,000 with a stray 3.
    for (const [v, want] of [[43_000, 4_300], [45_000, 4_500], [42_000, 4_200], [34_000, 3_400], [25_000, 2_500]] as const) {
      expect(goplusElectricityGuess(v), String(v)).toEqual({ value: want, estimated: true })
    }
  })
  // A reviewer's catch (2026-10-20): "10", "100", "1,000,000" all printed "≈ 10,000 đ / kWh" — the page's ceiling.
  it('⛔ a reading more than 2× from 4,000 is no reading: null, and the rate is dropped as before', () => {
    expect(GOPLUS_ELECTRICITY_GUESS_MAX_OFF).toBe(2)
    // 1 → 1,000 (4×) · 10, 100, 1,000,000, 10,000,000 → 10,000 (2.5×) · 190 → 1,900 and 19,000 → 1,900 (2.1×) ·
    // 12,000 → 1,200 (3.3×) · 81,000 → 8,100 and 82,000 → 8,200 (2.05×) · 150,000 → 1,500 (2.7×) · 160,000 → 1,600 (2.5×).
    for (const v of [1, 10, 100, 190, 1_000_000, 10_000_000, 12_000, 19_000, 81_000, 82_000, 150_000, 160_000]) {
      expect(goplusElectricityGuess(v), String(v)).toBeNull()
    }
    // Exactly 2× either way is still a reading.
    expect(goplusElectricityGuess(20_000)).toEqual({ value: 2_000, estimated: true })
    expect(goplusElectricityGuess(200)).toEqual({ value: 2_000, estimated: true })
    expect(goplusElectricityGuess(80_000)).toEqual({ value: 8_000, estimated: true })
  })
})

describe('goplusAmenities / goplusExtras', () => {
  it('⛔ the TAXONOMY\'s order and wording (one source with the chips and the PDP); furnished apart; unknown keys reported', () => {
    const a = goplusAmenities(['wifi', 'car_alley', 'furnished', 'no_landlord', 'sauna', 'kitchen'])
    const want = new Set(['no-landlord', 'car-alley', 'kitchen', 'wifi'])
    expect(a.list.map((x) => x.value)).toEqual(amenityOptions().map((o) => o.value).filter((v) => want.has(v)))
    expect(a.list.slice(0, 2).map((x) => x.value)).toEqual(['no-landlord', 'car-alley'])   // GoPlus's headline filters lead
    expect(a.list.find((x) => x.value === 'car-alley')).toEqual({ value: 'car-alley', en: 'Car access', vi: 'Hẻm xe hơi' })
    expect(a.list.find((x) => x.value === 'kitchen')).toEqual({ value: 'kitchen', en: 'Kitchenette', vi: 'Kệ bếp' })
    expect(a).toMatchObject({ furnished: true, unknown: ['sauna'] })
  })
  it('every GoPlus key maps to a value the taxonomy\'s amenities facet OFFERS — no token a chip cannot find', () => {
    const offered = new Map(amenityOptions().map((o) => [o.value, o]))
    for (const [key, value] of Object.entries(GOPLUS_AMENITY_VALUES)) {
      expect(value, key).toMatch(/^[a-z0-9][a-z0-9-]*$/)
      expect(offered.has(value), `${key} → ${value}`).toBe(true)
    }
    expect(GOPLUS_AMENITY_VALUES.pet).toBe('pets')
    expect(GOPLUS_AMENITY_VALUES.balcony).toBe('balcony')
    expect(new Set(Object.values(GOPLUS_AMENITY_VALUES)).size).toBe(Object.keys(GOPLUS_AMENITY_VALUES).length)
    expect(goplusAmenities(Object.keys(GOPLUS_AMENITY_VALUES)).unknown).toEqual([])
  })
  it('extras: split staff lists, no digits (surcharges), no phone, no repeat of a structured amenity, capped at 8', () => {
    const structured = goplusAmenities(['wifi']).list
    expect(goplusExtras(['Bàn ăn,Giường, Máy giặt', 'bếp từ,máy giặt riêng +500k', 'gọi 0909123456', 'wifi', 'Máy giặt riêng'], structured))
      .toEqual(['Bàn ăn', 'Giường', 'Máy giặt', 'Bếp từ', 'Máy giặt riêng'])
    expect(goplusExtras(Array.from({ length: 12 }, (_, i) => `Đồ ${'abcdefghijkl'[i]}`), [])).toHaveLength(8)
    // ⛔ A surcharge is dropped WHOLE — "máy giặt riêng +500k" never publishes "Máy giặt riêng" as included (a reviewer's catch).
    expect(goplusExtras(['máy giặt riêng +500k, bàn ghế'], [])).toEqual(['Bàn ghế'])
    expect(goplusExtras(['tủ lạnh + máy sấy'], [])).toEqual(['Tủ lạnh', 'Máy sấy'])
  })
})

describe('goplusWard / goplusDistrict', () => {
  it('ward in both languages; a numbered ward; a door shape dropped whole', () => {
    expect(goplusWard('Phường Trung Mỹ Tây')).toEqual({ vi: 'Phường Trung Mỹ Tây', en: 'Trung My Tay Ward' })
    expect(goplusWard('Phường 07')).toEqual({ vi: 'Phường 07', en: 'Ward 7' })
    expect(goplusWard('Xã Đông Thạnh')).toEqual({ vi: 'Xã Đông Thạnh', en: 'Dong Thanh Commune' })
    expect(goplusWard('12/4 Phường X')).toBeNull()
  })
  it('the HCMC districts GoPlus sends map to the strings the district chips match (honeycomb districtOf)', () => {
    expect(goplusDistrict('Quận 12')).toEqual({ vi: 'Quận 12', en: 'District 12', canonical: true })
    expect(goplusDistrict('Gò Vấp')).toEqual({ vi: 'Quận Gò Vấp', en: 'Go Vap District', canonical: true })
    expect(goplusDistrict('Thủ Đức')).toEqual({ vi: 'TP. Thủ Đức', en: 'Thu Duc City', canonical: true })
    expect(goplusDistrict('Nhà Bè')).toEqual({ vi: 'Huyện Nhà Bè', en: 'Nha Be District', canonical: true })
    for (const d of ['Tân Bình', 'Bình Thạnh', 'Tân Phú', 'Hóc Môn', 'Bình Tân', 'Quận 1', 'Phú Nhuận', 'Quận 6', 'Quận 10', 'Bình Chánh', 'Quận 11', 'Quận 7', 'Quận 3', 'Quận 8', 'Quận 5']) {
      expect(goplusDistrict(d)?.canonical, d).toBe(true)
    }
  })
  it('⚠️ Bến Cát / Thuận An (old Bình Dương) are not an HCMC district chip: kept as a name, never stored as district', () => {
    expect(goplusDistrict('Bến Cát')).toEqual({ vi: 'Bến Cát', en: 'Ben Cat', canonical: false })
    expect(goplusDistrict(null)).toBeNull()
    const r = mapped(room(), project({ district: 'Bến Cát', ward: 'Phường Bến Cát' }))
    expect(r.mutable.district).toBeNull()
    expect(r.mutable.location).toBe('Phường Trung Mỹ Tây, Bến Cát')
  })
  it('⛔ outside HCMC (hcmc: false) a name an HCMC district shares is kept as a name, never the chip\'s string', () => {
    expect(goplusDistrict('Tân Phú', { hcmc: false })).toEqual({ vi: 'Tân Phú', en: 'Tan Phu', canonical: false })
    expect(goplusDistrict('Tân Phú')).toEqual({ vi: 'Quận Tân Phú', en: 'Tan Phu District', canonical: true })
  })
})

/**
 * THE ROOM'S REAL CITY (owner, 2026-11-12: "deploy and fix do all with recommended"). Every GoPlus room was stored in Hồ
 * Chí Minh: live that day, /c/rentals' "Apartments & houses for rent in Ho Chi Minh City" sat over a Cái Răng card, the
 * Area filter found 0 apartments in Hà Nội, Đà Nẵng and Cần Thơ, and a Ninh Kiều room's page said "Ho Chi Minh City".
 * The city is now the building's own `region`, matched without tone marks; a region that names no province is no city.
 */
describe('goplusProvince / goplusCity — the building\'s own region', () => {
  it.each([
    ['Thành phố Hồ Chí Minh', '79', 'Hồ Chí Minh'], ['TP. Hồ Chí Minh', '79', 'Hồ Chí Minh'], ['TP.HCM', '79', 'Hồ Chí Minh'],
    ['T.P. Hồ Chí Minh', '79', 'Hồ Chí Minh'], ['Tp Cần Thơ', '92', 'Cần Thơ'],
    ['Ho Chi Minh City', '79', 'Hồ Chí Minh'], ['Hồ Chí Minh', '79', 'Hồ Chí Minh'],
    ['Thành phố Cần Thơ', '92', 'Cần Thơ'], ['  thành phố   CẦN THƠ ', '92', 'Cần Thơ'], ['Can Tho', '92', 'Cần Thơ'],
    ['Thành phố Hà Nội', '01', 'Hà Nội'], ['Hanoi', '01', 'Hà Nội'], ['Thành phố Đà Nẵng', '48', 'Đà Nẵng'],
    ['Thành phố Huế', '46', 'Huế'], ['Huế', '46', 'Huế'], ['Tỉnh Đồng Nai', '75', 'Đồng Nai'], ['Tỉnh Đồng Tháp', '82', 'Đồng Tháp'],
    // The tone mark's place: vn-units writes "Khánh Hoà" / "Thanh Hoá"; GoPlus may write "Hòa" / "Hóa".
    ['Tỉnh Khánh Hòa', '56', 'Khánh Hoà'], ['Tỉnh Khánh Hoà', '56', 'Khánh Hoà'], ['Thanh Hóa', '38', 'Thanh Hoá'], ['Thanh Hoá', '38', 'Thanh Hoá'],
    // FORMER provinces (before 1 July 2025) → the unit they merged into; Bình Dương and Bà Rịa–Vũng Tàu are HCMC.
    ['Tỉnh Bình Dương', '79', 'Hồ Chí Minh'], ['Bình Dương', '79', 'Hồ Chí Minh'],
    ['Tỉnh Bà Rịa - Vũng Tàu', '79', 'Hồ Chí Minh'], ['Bà Rịa–Vũng Tàu', '79', 'Hồ Chí Minh'],
    ['Tỉnh Quảng Nam', '48', 'Đà Nẵng'], ['Tỉnh Long An', '80', 'Tây Ninh'], ['Tỉnh Thừa Thiên Huế', '46', 'Huế'],
    ['Tỉnh Hòa Bình', '25', 'Phú Thọ'], ['Tỉnh Hoà Bình', '25', 'Phú Thọ'],
  ])('%s → %s %s', (region, code, city) => {
    expect(goplusProvince(region)).toMatchObject({ code, city })
  })

  it('a region that names no province is NO city — never Ho Chi Minh City, never the district\'s guess', () => {
    for (const r of ['Thủ Đức', 'Bangkok', 'Hồ Chí', 'Tỉnh', 'Thành phố', '—', '', '   ', null, undefined]) expect(goplusProvince(r), String(r)).toBeNull()
    expect(goplusCity('Bangkok', goplusDistrict('Quận 12'))).toBeNull()
  })

  it('NO region: Ho Chi Minh City only by one of HCMC\'s own districts, else none', () => {
    expect(goplusCity(null, goplusDistrict('Quận 12'))).toEqual({ code: GOPLUS_HCMC_CODE, city: 'Hồ Chí Minh', cityVi: 'TP. Hồ Chí Minh', cityEn: 'Ho Chi Minh City' })
    expect(goplusCity('  ', goplusDistrict('Gò Vấp'))?.code).toBe('79')
    expect(goplusCity(null, goplusDistrict('Ninh Kiều'))).toBeNull()
    expect(goplusCity(null, null)).toBeNull()
  })

  it('names for the text: the vn-units name, "Hanoi" in English prose, HCMC exactly as before', () => {
    expect(goplusProvince('Thành phố Hà Nội')).toEqual({ code: '01', city: 'Hà Nội', cityVi: 'Hà Nội', cityEn: 'Hanoi' })
    expect(goplusProvince('Thành phố Cần Thơ')).toEqual({ code: '92', city: 'Cần Thơ', cityVi: 'Cần Thơ', cityEn: 'Can Tho' })
    expect(goplusProvince('Thành phố Hồ Chí Minh')).toEqual({ code: '79', city: 'Hồ Chí Minh', cityVi: 'TP. Hồ Chí Minh', cityEn: 'Ho Chi Minh City' })
  })

  it('every former province names one of the 34 — 29 merged away (63 − 34) + Thừa Thiên Huế renamed Huế', () => {
    expect(Object.keys(GOPLUS_FORMER_PROVINCES)).toHaveLength(30)
    for (const [former, now] of Object.entries(GOPLUS_FORMER_PROVINCES)) {
      const unit = VN_PROVINCES.find((p) => p.name === now)
      expect(unit, `${former} → ${now}`).toBeDefined()
      expect(goplusProvince(former)?.code, former).toBe(unit!.code)
    }
    for (const p of VN_PROVINCES) expect(GOPLUS_FORMER_PROVINCES[p.name], p.name).toBeUndefined()
  })

  // Written out independently of the table (a reviewer's catch: a table checked only against itself proves nothing) —
  // the July 2025 merger, by unit code, each former province as GoPlus would write it ("Tỉnh …").
  it.each([
    ['Hà Giang', '08'], ['Yên Bái', '15'], ['Bắc Kạn', '19'], ['Vĩnh Phúc', '25'], ['Hòa Bình', '25'], ['Bắc Giang', '24'],
    ['Thái Bình', '33'], ['Hải Dương', '31'], ['Hà Nam', '37'], ['Nam Định', '37'], ['Quảng Bình', '44'], ['Thừa Thiên Huế', '46'],
    ['Quảng Nam', '48'], ['Kon Tum', '51'], ['Bình Định', '52'], ['Ninh Thuận', '56'], ['Đắk Nông', '68'], ['Bình Thuận', '68'],
    ['Phú Yên', '66'], ['Bình Dương', '79'], ['Bà Rịa - Vũng Tàu', '79'], ['Bình Phước', '75'], ['Long An', '80'],
    ['Sóc Trăng', '92'], ['Hậu Giang', '92'], ['Bến Tre', '86'], ['Trà Vinh', '86'], ['Tiền Giang', '82'], ['Bạc Liêu', '96'],
    ['Kiên Giang', '91'],
  ])('Tỉnh %s (former) → unit %s', (former, code) => {
    expect(goplusProvince(`Tỉnh ${former}`)?.code).toBe(code)
  })

  it('the other spellings in use (k / c): Đắc Lắc, Đắc Nông, Bắc Cạn', () => {
    expect(goplusProvince('Tỉnh Đắc Lắc')?.code).toBe('66')
    expect(goplusProvince('Daklak')?.code).toBe('66')
    expect(goplusProvince('Tỉnh Đắc Nông')?.code).toBe('68')
    expect(goplusProvince('Bắc Cạn')?.code).toBe('19')
  })

  it('⛔ NO region and an HCMC district name, but a map point far from HCMC → no city (Đồng Nai\'s Tân Phú)', () => {
    const tanPhuDongNai = { lat: 11.268, lng: 107.43 }
    expect(goplusCity(null, goplusDistrict('Tân Phú'), tanPhuDongNai)).toBeNull()
    expect(goplusCity(null, goplusDistrict('Tân Phú'), { lat: 10.79, lng: 106.63 })?.code).toBe('79')   // HCMC's own Tân Phú
    expect(goplusCity(null, goplusDistrict('Tân Phú'), null)?.code).toBe('79')                         // no point: the district decides
    expect(goplusCity(null, goplusDistrict('Bình Tân'), { lat: 10.09, lng: 105.81 })).toBeNull()      // Vĩnh Long's Bình Tân
    // Old HCMC's own far edges stay HCMC: Củ Chi's north-west (~57 km), Cần Giờ's coast (~47 km).
    expect(goplusCity(null, goplusDistrict('Củ Chi'), { lat: 11.16, lng: 106.36 })?.code).toBe('79')
    expect(goplusCity(null, goplusDistrict('Cần Giờ'), { lat: 10.4, lng: 106.9 })?.code).toBe('79')
    // A region always wins over the point (a stated HCMC building with a wrong pin keeps its city; the pin is dropped).
    expect(goplusCity('Thành phố Hồ Chí Minh', goplusDistrict('Quận 12'), { lat: 21.17, lng: 105.931 })?.code).toBe('79')
  })

  it('every one of the 34 is found by its own names, and the stored city is what the Area filter matches (province-match.ts)', () => {
    for (const p of VN_PROVINCES) {
      expect(goplusProvince(p.name)?.code, p.name).toBe(p.code)
      expect(goplusProvince(p.nameEn)?.code, p.nameEn).toBe(p.code)
      expect(matchesProvinceRow({ city: goplusProvince(p.name)!.city, location: '' }, p.nameEn), p.nameEn).toBe(true)
    }
  })
})

describe('mapGoplusRoom — every room in its own city', () => {
  const CAN_THO = { ...RAW_PROJECT, region: 'Thành phố Cần Thơ', district: 'Ninh Kiều', ward: 'Phường Ninh Kiều', street: 'Nguyễn Văn Cừ Nối Dài', geo: { lat: 10.0341, lng: 105.7722, approx: true } }
  const there = (p: Record<string, unknown>) => mapped(room({ ward: null, street: null }), stageGoplusProject(p)!)

  it('a Cần Thơ building → city Cần Thơ, in the place sentence and the search text — no Ho Chi Minh City anywhere', () => {
    const r = there(CAN_THO)
    expect(r.mutable).toMatchObject({ city: 'Cần Thơ', district: null, location: 'Phường Ninh Kiều, Ninh Kiều', lat: null, lng: null })
    expect(r.mutable.title).toBe('Duplex 20 m² · Ninh Kieu Ward, Ninh Kieu')
    expect(r.mutable.description).toBe('Duplex of 20 m² on Nguyễn Văn Cừ Nối Dài, Ninh Kieu Ward, Ninh Kieu, Can Tho.\n\nMessage GoPlus to check availability and book a viewing.')
    expect(r.mutable.descriptionVi).toBe('Duplex 20 m² tại Nguyễn Văn Cừ Nối Dài, Phường Ninh Kiều, Ninh Kiều, Cần Thơ.\n\nNhắn tin cho GoPlus để kiểm tra phòng trống và đặt lịch xem phòng.')
    expect(r.mutable.searchText).toContain('can tho')
    expect(JSON.stringify(r.mutable)).not.toMatch(/ho chi minh|hồ chí minh/i)
  })

  it('an HCMC building is unchanged: Hồ Chí Minh, its district chip string, "Ho Chi Minh City" / "TP. Hồ Chí Minh"', () => {
    const r = mapped()
    expect(r.mutable).toMatchObject({ city: 'Hồ Chí Minh', district: 'Quận 12', location: 'Quận 12 (Phường Trung Mỹ Tây)' })
    expect(r.mutable.description.startsWith('Duplex of 20 m² on Ql1a, Trung My Tay Ward, District 12, Ho Chi Minh City.')).toBe(true)
    expect(r.mutable.searchText).toContain('tp. ho chi minh ho chi minh city goplus')
  })

  it('a former Bình Dương building → Ho Chi Minh City (the 2025 merger), its district kept as a name', () => {
    const r = there({ ...RAW_PROJECT, region: 'Tỉnh Bình Dương', district: 'Thuận An', ward: 'Phường Thuận An', street: null })
    expect(r.mutable).toMatchObject({ city: 'Hồ Chí Minh', district: null, location: 'Phường Thuận An, Thuận An' })
    expect(r.mutable.description.startsWith('Duplex of 20 m² in Thuan An Ward, Thuan An, Ho Chi Minh City.')).toBe(true)
    expect(r.mutable.descriptionVi.startsWith('Duplex 20 m² tại Phường Thuận An, Thuận An, TP. Hồ Chí Minh.')).toBe(true)
    // The Bà Rịa–Vũng Tàu side of the merger too (GoPlus's Phú Mỹ rooms).
    expect(there({ ...RAW_PROJECT, region: 'Tỉnh Bà Rịa - Vũng Tàu', district: 'Phú Mỹ', ward: 'Phường Tân Phước', street: null }).mutable.city).toBe('Hồ Chí Minh')
  })

  it('Hà Nội and Đà Nẵng buildings name their own city ("Hanoi" in English)', () => {
    const hn = there({ ...RAW_PROJECT, region: 'Thành phố Hà Nội', district: 'Hà Đông', ward: 'Phường Hà Đông', street: null })
    expect(hn.mutable.city).toBe('Hà Nội')
    expect(hn.mutable.description.startsWith('Duplex of 20 m² in Ha Dong Ward, Ha Dong, Hanoi.')).toBe(true)
    expect(hn.mutable.descriptionVi.startsWith('Duplex 20 m² tại Phường Hà Đông, Hà Đông, Hà Nội.')).toBe(true)
    const dn = there({ ...RAW_PROJECT, region: 'Thành phố Đà Nẵng', district: 'Liên Chiểu', ward: 'Phường Liên Chiểu', street: null })
    expect(dn.mutable.city).toBe('Đà Nẵng')
    expect(dn.mutable.description.startsWith('Duplex of 20 m² in Lien Chieu Ward, Lien Chieu, Da Nang.')).toBe(true)
  })

  it('⛔ outside HCMC an HCMC district\'s name is not stored as its chip string (Đồng Nai\'s Tân Phú is not Quận Tân Phú)', () => {
    const r = there({ ...RAW_PROJECT, region: 'Tỉnh Đồng Nai', district: 'Tân Phú', ward: 'Xã Tà Lài', street: null })
    expect(r.mutable).toMatchObject({ city: 'Đồng Nai', district: null, location: 'Xã Tà Lài, Tân Phú' })
    expect(r.mutable.title).toBe('Duplex 20 m² · Ta Lai Commune, Tan Phu')
  })

  it('no region: an HCMC district → Ho Chi Minh City as before; anything else → no city claimed, the room still published', () => {
    expect(mapped(room(), project({ region: null })).mutable).toMatchObject({ city: 'Hồ Chí Minh', district: 'Quận 12' })
    // …unless the building's point is far from HCMC: Đồng Nai's Tân Phú is no HCMC room, and keeps no chip string.
    const far = there({ ...RAW_PROJECT, region: null, district: 'Tân Phú', ward: 'Xã Tà Lài', street: null, geo: { lat: 11.268, lng: 107.43, approx: true } })
    // (Its pin stays: ~97 km is inside the 100 km map rule, which this change leaves as it was.)
    // …and its point goes with the city it was refused: a room stored outside HCMC (or in no city) carries no pin (commit review).
    expect(far.mutable).toMatchObject({ city: '', district: null, location: 'Xã Tà Lài, Tân Phú', lat: null, lng: null })
    const r = there({ ...CAN_THO, region: undefined })
    expect(r.mutable.city).toBe('')
    expect(r.mutable.description.startsWith('Duplex of 20 m² on Nguyễn Văn Cừ Nối Dài, Ninh Kieu Ward, Ninh Kieu.\n\n')).toBe(true)
    expect(r.mutable.descriptionVi.startsWith('Duplex 20 m² tại Nguyễn Văn Cừ Nối Dài, Phường Ninh Kiều, Ninh Kiều.\n\n')).toBe(true)
    expect(r.mutable.searchText).not.toMatch(/ho chi minh/)
  })

  it('⛔ a point is kept only for a room stored IN HCMC: a Hà Nội room pinned near District 1 by a bad GoPlus point gets no pin (commit review, codex + opus)', () => {
    const r = there({ ...RAW_PROJECT, region: 'Thành phố Hà Nội', district: 'Cầu Giấy', ward: 'Phường Dịch Vọng', street: null, geo: { lat: 10.78, lng: 106.70, approx: false } })
    expect(r.mutable).toMatchObject({ city: 'Hà Nội', lat: null, lng: null })
    // An HCMC room keeps its point exactly as before.
    expect(mapped(room(), project()).mutable.lat).not.toBeNull()
  })

  it('a neighbour inside the radius keeps its genuine point: a Biên Hòa (Đồng Nai) room pinned 25 km from District 1 (commit review round 2)', () => {
    const r = there({ ...RAW_PROJECT, region: 'Tỉnh Đồng Nai', district: 'Biên Hòa', ward: 'Phường Tân Phong', street: null, geo: { lat: 10.957, lng: 106.843, approx: false } })
    expect(r.mutable).toMatchObject({ city: 'Đồng Nai', lat: 10.957, lng: 106.843 })
  })

  it('a region that names no province: no city — even over an HCMC district, whose chip string then goes too', () => {
    const r = mapped(room(), project({ region: 'Thành phố Thủ Đức' }))
    expect(r.mutable).toMatchObject({ city: '', district: null, location: 'Phường Trung Mỹ Tây, Quận 12' })
    expect(r.mutable.description.startsWith('Duplex of 20 m² on Ql1a, Trung My Tay Ward, Quan 12.')).toBe(true)
  })
})

describe('mapGoplusRoom — the sample room as it would be stored', () => {
  const r = mapped()
  it('identity, money, place', () => {
    expect(r.externalId).toBe('goplus:25fe4221871ad83039bcd25b')
    expect(goplusRoomIdOf(r.externalId)).toBe('25fe4221871ad83039bcd25b')
    expect(r.mutable).toMatchObject({
      title: 'Duplex 20 m² · Trung My Tay Ward, District 12',
      titleVi: 'Duplex 20 m² · Phường Trung Mỹ Tây, Quận 12',
      price: 3500000, priceUnit: GOPLUS_PRICE_UNIT, currency: '₫', negotiable: false, listingType: 'rent',
      subcategorySlug: 'apartment-rental', district: 'Quận 12', city: 'Hồ Chí Minh', location: 'Quận 12 (Phường Trung Mỹ Tây)',
      lat: 10.86, lng: 106.621, areaM2: 20,
    })
    expect(GOPLUS_PRICE_UNIT).toBe('VND/month')
    expect(r.sourceAt.toISOString()).toBe('2026-10-15T06:41:04.345Z')
    expect(r.images).toHaveLength(5)
  })
  it('⛔ attributes are ALL STRINGS (the filter is a substring match on "key":"value")', () => {
    expect(JSON.parse(r.mutable.attributes)).toEqual({
      bedrooms: '1', aptType: 'duplex', deposit: '3500000', maxTenants: '2', floor: '0',
      electricityPrice: '3800', waterPrice: '100000', waterUnit: 'person', serviceFee: '150000', parkingFee: '100000',
    })
    expect(r.mutable.attributes).toContain('"aptType":"duplex"')
  })
  it('amenities go to facetTokens, in the taxonomy\'s order', () => {
    const sent = new Set(RAW_ROOM.amenityKeys.map((k) => GOPLUS_AMENITY_VALUES[k]))
    expect(parseFacetTokens(r.mutable.facetTokens).map((p) => p.value)).toEqual(amenityOptions().map((o) => o.value).filter((v) => sent.has(v)))
    expect(parseFacetTokens(r.mutable.facetTokens)).toHaveLength(RAW_ROOM.amenityKeys.length)
    expect(r.mutable.facetTokens).toContain('|amenities:no-landlord|')
  })
  it('⛔ the description is SHORT — what, where, and how to reach GoPlus; the costs, amenities and details live in their own PDP sections — and never a contact', () => {
    expect(r.mutable.description).toBe('Duplex of 20 m² on Ql1a, Trung My Tay Ward, District 12, Ho Chi Minh City.\n\nMessage GoPlus to check availability and book a viewing.')
    expect(r.mutable.descriptionVi).toBe('Duplex 20 m² tại Ql1a, Phường Trung Mỹ Tây, Quận 12, TP. Hồ Chí Minh.\n\nNhắn tin cho GoPlus để kiểm tra phòng trống và đặt lịch xem phòng.')
    for (const repeat of ['3.500.000', '3,500,000', 'kWh', 'Wifi', 'Không chung chủ']) {
      expect(r.mutable.description, repeat).not.toContain(repeat)
      expect(r.mutable.descriptionVi, repeat).not.toContain(repeat)
    }
    for (const leak of ['0369116666', 'zalo', '@goplus', '8:00']) expect(JSON.stringify(r)).not.toContain(leak)
  })
  it('search finds it by an amenity, in either language and without accents', () => {
    expect(r.mutable.searchText).toContain('khong chung chu')
    expect(r.mutable.searchText).toContain('no live-in landlord')
    expect(r.mutable.searchText.startsWith('duplex 20 m² · trung my tay ward, district 12 duplex 20 m² · phuong trung my tay, quan 12')).toBe(true)
  })
})

describe('mapGoplusRoom — the variants', () => {
  it('a 2PN serviced flat, furnished, water per m³, negotiable, moving in later — all in the attributes, none in the text', () => {
    const r = mapped(room({ type: '2PN', area: 45, amenityKeys: ['furnished', 'balcony'], fees: [{ id: 'water', price: 28000, unit: 'm³' }], negotiable: true, availableDate: '2026-11-02' }))
    expect(JSON.parse(r.mutable.attributes)).toMatchObject({ bedrooms: '2', aptType: 'serviced', furnishing: 'fully', waterPrice: '28000', waterUnit: 'm3', availableFrom: '2026-11-02' })
    expect(r.mutable.negotiable).toBe(true)
    expect(r.mutable.titleVi).toBe('Căn hộ 2 phòng ngủ 45 m² · Phường Trung Mỹ Tây, Quận 12')
    expect(r.mutable.description.startsWith('2-bedroom apartment of 45 m² on Ql1a, Trung My Tay Ward, District 12, Ho Chi Minh City.')).toBe(true)
    expect(r.mutable.searchText).toContain('fully furnished')
  })
  it('a past availableDate is not published; nonsense sizes and occupancies are left out', () => {
    const r = mapped(room({ availableDate: '2026-10-02', area: 1820, maxTenants: 0 }))
    const a = JSON.parse(r.mutable.attributes)
    expect(a.availableFrom).toBeUndefined()
    expect(a.maxTenants).toBeUndefined()
    expect(r.mutable.areaM2).toBeNull()
    expect(r.mutable.titleVi).toBe('Duplex · Phường Trung Mỹ Tây, Quận 12')
  })
  // GoPlus's own outliers (2026-10-19): 4,000,000 đ "per kWh", 10,000,000 đ parking, a 3,500 đ deposit — never stored
  // as stated (rental-facts.ts plausibleFee, the page's own test); a water price without a unit is not stored either.
  // ⚠️ Since 2026-10-20 the electricity rate alone is GUESSED rather than dropped — flagged (goplusElectricityGuess).
  it('stores no fee outside its plausible range (electricity: its closest guess, flagged), and no water price without its unit', () => {
    // The water fee's unit is unknown AND the room's own price block names none (the mapper falls back to it).
    const r = mapped(room({ deposit: 3500, price: { ...room().price, waterUnit: null }, fees: [{ id: 'electric', price: 4_000_000, unit: 'kWh' }, { id: 'parking', price: 10_000_000, unit: 'xe/tháng' }, { id: 'service', price: 150_000, unit: 'tháng' }, { id: 'water', price: 100_000, unit: 'thùng' }] }))
    const a = JSON.parse(r.mutable.attributes)
    expect(a.deposit).toBeUndefined()
    expect(a.electricityPrice).toBe('4000')
    expect(a.electricityEstimated).toBe('4000')
    expect(a.parkingFee).toBeUndefined()
    expect(a.serviceFee).toBe('150000')
    expect(a.waterPrice).toBeUndefined()
    expect(a.waterUnit).toBeUndefined()
  })
  // Owner, 2026-10-20: "fix error electricity prices with closest guess" — and a guess is never stated as fact.
  it('an impossible electricity rate is stored as its closest guess WITH the estimate flag — strings only — and the page reads it so', () => {
    for (const [stated, want] of [[44_000, '4000'], [33_800, '3800'], [3_900_000, '3900'], [400, '4000']] as const) {
      const a = JSON.parse(mapped(room({ fees: [{ id: 'electric', price: stated, unit: 'kWh' }] })).mutable.attributes) as Record<string, unknown>
      expect(a.electricityPrice, String(stated)).toBe(want)
      // The flag is the guessed figure itself, so a rate corrected later is no longer read as the guess.
      expect(a[ELECTRICITY_ESTIMATED], String(stated)).toBe(want)
      expect(Object.values(a).every((v) => typeof v === 'string')).toBe(true)
      expect(rentalCostRows(a).find((c) => c.key === 'electricityPrice')).toMatchObject({ amount: Number(want), estimated: true })
    }
    // The price block's figure is guessed the same way when fees[] has no electricity line.
    expect(JSON.parse(mapped(room({ fees: [], price: { ...room().price, electric: 44_000 } })).mutable.attributes))
      .toMatchObject({ electricityPrice: '4000', electricityEstimated: '4000' })
  })
  it('a plausible electricity rate carries no flag; one with no plausible reading stores neither key', () => {
    const plain = JSON.parse(mapped().mutable.attributes) as Record<string, unknown>
    expect(plain.electricityPrice).toBe('3800')
    expect(Object.hasOwn(plain, ELECTRICITY_ESTIMATED)).toBe(false)
    for (const stated of [123_456_789, 10]) {   // nothing to read · a reading 2.5× off (GOPLUS_ELECTRICITY_GUESS_MAX_OFF)
      const none = JSON.parse(mapped(room({ fees: [{ id: 'electric', price: stated, unit: 'kWh' }], price: { ...room().price, electric: null } })).mutable.attributes) as Record<string, unknown>
      expect(none.electricityPrice, String(stated)).toBeUndefined()
      expect(none[ELECTRICITY_ESTIMATED], String(stated)).toBeUndefined()
    }
  })
  // A reviewer's catch (2026-10-19): a fees[] water line with an unreadable unit never borrows the price block's unit.
  it('a fees[] line priced 0 does not hide the price block\'s real figure', () => {
    const r = mapped(room({ price: { ...room().price, electric: 3800, service: 150000 }, fees: [{ id: 'electric', price: 0, unit: 'kWh' }, { id: 'service', price: 0, unit: 'tháng' }] }))
    const a = JSON.parse(r.mutable.attributes)
    expect(a.electricityPrice).toBe('3800')
    expect(a.serviceFee).toBe('150000')
  })
  it('takes the water unit only from where the water price came from', () => {
    const r = mapped(room({ price: { ...room().price, waterUnit: 'person' }, fees: [{ id: 'water', price: 28000, unit: 'm3/tháng' }] }))
    const a = JSON.parse(r.mutable.attributes)
    expect(a.waterPrice).toBeUndefined()
    expect(a.waterUnit).toBeUndefined()
  })
  it('judges a move-in date in Vietnam\'s calendar — 01:00 on the 20th in HCMC is already the 20th', () => {
    const at = Date.parse('2026-10-19T18:00:00Z')
    const r = mapGoplusRoom(room({ availableDate: '2026-10-20' }), project(), { now: at, maxPhotos: 10 })
    expect(r.ok && JSON.parse(r.row.mutable.attributes).availableFrom).toBeUndefined()
    const later = mapGoplusRoom(room({ availableDate: '2026-10-21' }), project(), { now: at, maxPhotos: 10 })
    expect(later.ok && JSON.parse(later.row.mutable.attributes).availableFrom).toBe('2026-10-21')
  })
  it('a plain "Phòng" (no type): no aptType, no bedroom count', () => {
    const r = mapped(room({ type: null }))
    expect(JSON.parse(r.mutable.attributes).aptType).toBeUndefined()
    expect(JSON.parse(r.mutable.attributes).bedrooms).toBeUndefined()
    expect(r.mutable.title.startsWith('Room 20 m²')).toBe(true)
  })
  it('⛔ a door number in the street is dropped whole (Nhà Tốt\'s street rule); a numbered street name stays', () => {
    const door = mapped(room({ street: '237/38A1 Phạm Văn Chiêu' }), project({ street: null }))
    expect(door.mutable.descriptionVi.startsWith('Duplex 20 m² tại Phường Trung Mỹ Tây, Quận 12, TP. Hồ Chí Minh.')).toBe(true)
    expect(door.mutable.description.startsWith('Duplex of 20 m² in Trung My Tay Ward, District 12, Ho Chi Minh City.')).toBe(true)
    expect(JSON.stringify(mapped(room({ street: 'A75 Bạch Đằng, Tân Sơn Hòa' }), project({ street: null })).mutable)).not.toContain('A75')
    expect(mapped(room({ street: 'Đường Số 9' })).mutable.descriptionVi).toContain('tại Đường Số 9, Phường Trung Mỹ Tây')
  })
  it('free-text extras appear in Vietnamese only (the language they were typed in), and are searchable', () => {
    const r = mapped(room({ amenities: ['Máy giặt riêng'] }))
    expect(r.mutable.descriptionVi).toBe('Duplex 20 m² tại Ql1a, Phường Trung Mỹ Tây, Quận 12, TP. Hồ Chí Minh. Tiện ích khác: Máy giặt riêng.\n\nNhắn tin cho GoPlus để kiểm tra phòng trống và đặt lịch xem phòng.')
    expect(r.mutable.description).not.toContain('Máy giặt riêng')
    expect(r.mutable.searchText).toContain('may giat rieng')
  })
  it('only GoPlus\'s own image and video folders, deduped, twice maxPhotos as CANDIDATES (the plan keeps maxPhotos)', () => {
    const imgs = [...RAW_ROOM.images, RAW_ROOM.images[0], 'https://evil.example/x.webp', 'https://goplus.com.vn/images/thumb/1e603dc4c641112d7f628291f8216ab1.webp']
    const r = mapped(room({ images: imgs, videos: ['https://goplus.com.vn/images/video/e56a4b5e2e4e7ed5e2349408.mp4', 'https://cdn.example/v.mp4'] }))
    expect(r.images).toEqual(RAW_ROOM.images)
    expect(r.videos).toEqual(['https://goplus.com.vn/images/video/e56a4b5e2e4e7ed5e2349408.mp4'])
    expect(mapGoplusRoom(room({ images: Array.from({ length: 15 }, (_, i) => `https://goplus.com.vn/images/img/${String(i).padStart(32, 'a')}.jpg`) }), project(), { now: NOW, maxPhotos: 4 })).toMatchObject({ ok: true, row: { images: { length: 8 } } })
    expect(isGoplusImageUrl('https://goplus.com.vn/images/img/1e603dc4c641112d7f628291f8216ab1.jpg')).toBe(true)
    expect(isGoplusVideoUrl('https://goplus.com.vn/images/video/e56a4b5e2e4e7ed5e2349408.webm')).toBe(false)
  })
  it.each([
    ['let ("Đã thuê")', { statusId: '2', statusTitle: 'Đã thuê' }, 'notVacant'],
    ['an unseen type', { type: 'Villa' }, 'unknownType'],
    ['no rent', { price: { base: null, electric: 1, water: 1, waterUnit: 'person', service: 1 } }, 'noPrice'],
    ['a rent under 1 M', { price: { base: 500000, electric: 1, water: 1, waterUnit: 'person', service: 1 } }, 'priceRange'],
    ['no photo', { images: [] }, 'noImages'],
    ['two photos', { images: RAW_ROOM.images.slice(0, 2) }, 'tooFewImages'],
    ['a phone number in the ward', { ward: 'Phường 0909123456' }, 'contactInText'],
    ['a banned word in the ward', { ward: 'Phường ma túy' }, 'bannedWords'],
  ] as [string, Partial<GoplusRoom>, string][])('drops %s', (_, patch, reason) => {
    expect(mapGoplusRoom(room(patch), project(), OPTS)).toEqual({ ok: false, reason })
  })
  it('drops a room whose building is unknown, or that has neither a district nor a ward', () => {
    expect(mapGoplusRoom(room(), null, OPTS)).toEqual({ ok: false, reason: 'noProject' })
    expect(mapGoplusRoom(room({ ward: null }), project({ district: null, ward: null }), OPTS)).toEqual({ ok: false, reason: 'noDistrict' })
  })
  // Owner, 2026-10-29: "import all their inventory" — GoPlus sends no district for its former-Bình Dương buildings.
  it('a room with a ward but no district (former Bình Dương) is published, district NULL, the ward in its place', () => {
    const r = mapped(room({ ward: 'Phường Dĩ An' }), project({ district: null, ward: 'Phường Dĩ An' }))
    expect(r.mutable.district).toBeNull()
    expect(r.mutable.location).toBe('Phường Dĩ An')
    expect(r.mutable.titleVi).toMatch(/· Phường Dĩ An$/)
    expect(r.mutable.description).toContain('Di An Ward, Ho Chi Minh City.')
  })
  // Owner, 2026-10-29: "Yes, as commercial rentals" (Kiot, MB — mặt bằng).
  it.each([['a kiosk', 'Kiot'], ['a shop floor (MB = mặt bằng)', 'MB'], ['"Mặt Bằng"', 'Mặt Bằng']])('files %s as commercial space', (_, type) => {
    const r = mapped(room({ type }))
    expect(r.mutable.subcategorySlug).toBe(GOPLUS_COMMERCIAL_SUBCAT)
    expect(r.mutable.title.startsWith('Commercial space')).toBe(true)
    expect(r.mutable.titleVi.startsWith('Mặt bằng')).toBe(true)
    expect(JSON.parse(r.mutable.attributes)).not.toHaveProperty('bedrooms')
    expect(r.mutable.facetTokens).toBeNull() // commercial space has no amenities facet
  })
  // Owner, 2026-10-29: "many apartments have wron area like 3 bedroom 20 meter square" → "Hide size + tell GoPlus".
  it.each([['2PN', 20], ['3PN', 29], ['Penhouse', 25]])('a %s of %i m² is published with NO size (it contradicts the room)', (type, area) => {
    const r = mapped(room({ type, area }))
    expect(r.mutable.areaM2).toBeNull()
    expect(r.mutable.titleVi).not.toContain('m²')
  })
  it('a 2PN from 30 m², and a studio or 1PN of 20 m², keep their size', () => {
    expect(mapped(room({ type: '2PN', area: 30 })).mutable.areaM2).toBe(30)
    expect(mapped(room({ type: 'Studio', area: 20 })).mutable.areaM2).toBe(20)
    expect(mapped(room({ type: '1PN', area: 20 })).mutable.areaM2).toBe(20)
  })
  it('the room\'s own page on goplus.com.vn, from its stored externalId only', () => {
    expect(goplusRoomPageUrl('goplus:d1c036ae6826f5254ba9e8d9')).toBe('https://goplus.com.vn/phong/d1c036ae6826f5254ba9e8d9')
    for (const bad of [null, '', 'goplus:', 'goplus:XYZ', 'nhatot:123', 'goplus:d1c036ae6826f5254ba9e8d9/../x']) expect(goplusRoomPageUrl(bad)).toBeNull()
  })
  it('a future updatedAt is clamped to now', () => {
    expect(mapped(room({ updatedAt: '2027-01-01T00:00:00Z' })).sourceAt.getTime()).toBe(NOW)
  })
})

describe('goplusPhotoPlan', () => {
  it('keeps real distinct photos; a deleted, undecodable or placeholder photo is left out, not the room', () => {
    expect(goplusPhotoPlan([{ outcome: 'ok', hash: 'aaaaaaaaaaaaaaaa' }, { outcome: 'gone' }, { outcome: 'ok', hash: '0000000000000000' }, { outcome: 'undecodable' }, { outcome: 'placeholder' }, { outcome: 'ok', hash: 'ffffffffffffffff' }]))
      .toEqual({ decision: 'create', keep: [0, 2, 5], refused: { gone: 1, undecodable: 1, placeholder: 1 }, duplicates: 0 })
  })
  it('a photo that never answered fails the row (retried next run); too few left is not created', () => {
    expect(goplusPhotoPlan([{ outcome: 'ok' }, { outcome: 'fetchFailed' }]).decision).toBe('photoFailed')
    // The cap applies AFTER judging: placeholders first, then real photos — the first `maxKeep` real ones are kept.
    const many = [{ outcome: 'placeholder' as const }, { outcome: 'placeholder' as const }, ...Array.from({ length: 6 }, (_, i) => ({ outcome: 'ok' as const, hash: (i * 0x2a2a2a2a2a2a).toString(16).padStart(16, '0').slice(-16) }))]
    const capped = goplusPhotoPlan(many, 3, 4)
    expect(capped.decision).toBe('create')
    expect(capped.keep.length).toBeLessThanOrEqual(4)
    expect(capped.keep.every((i) => i >= 2)).toBe(true)
    expect(goplusPhotoPlan([{ outcome: 'ok', hash: '0000000000000000' }, { outcome: 'ok', hash: '0000000000000001' }, { outcome: 'ok', hash: 'ffffffffffffffff' }]))
      .toMatchObject({ decision: 'tooFewRealPhotos', duplicates: 1 })
    expect(GOPLUS_MIN_PHOTOS).toBe(3)
  })
})

describe('stored media — names that say which source they came from', () => {
  const SB = 'https://sb.eno.vn'
  const src = RAW_ROOM.images[0]
  const key = goplusSourceKey(src)
  // The overlay folder (the app-drawn eno.vn mark — image-mark-url.ts overlayImagePath), under goplusOverlaySlug.
  const ours = `${SB}/storage/v1/object/public/listings/${overlayImagePath(goplusOverlaySlug(key), { cover: 'dark', contain: 'light' }, 1280, 960, '0123456789abcdef', 'mgx1abc', 'q7k2z')}`
  // The first import's unmarked copies (2026-10-20).
  const legacy = `${SB}/storage/v1/object/public/listings/partner/goplus/${key}-h0123456789abcdef.webp`
  it('the source key is stable, 16 hex, and read back from the stored URL — overlay or legacy', () => {
    expect(key).toMatch(/^[0-9a-f]{16}$/)
    expect(goplusSourceKey(src)).toBe(key)
    expect(goplusStoredPhotoKey(ours, SB)).toBe(key)
    expect(goplusStoredPhotoKey(legacy, SB)).toBe(key)
    // Another import's overlay photo (no goplus- slug) is NOT ours.
    expect(goplusStoredPhotoKey(`${SB}/storage/v1/object/public/listings/affiliate/m/x-ild-1x1.webp`, SB)).toBeNull()
    expect(goplusStoredPhotoKey(`${SB}/storage/v1/object/public/listings/affiliate/m/sofa-mgx1abc-q7k2z-idl-800x800.webp`, SB)).toBeNull()
  })
  it('⛔ an overlay photo is one the app MARKS with eno.vn (owner 2026-10-20: "why goplus apartments dont have eno.vn wordmark")', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SB)
    try {
      expect(isOverlayImageUrl(ours)).toBe(true)
      expect(isOverlayImageUrl(legacy)).toBe(false)
    } finally { vi.unstubAllEnvs() }
  })
  it('photos: a person\'s own upload stands; a gallery still all in the source is unchanged; a removed one is re-hosted', () => {
    expect(goplusPhotoAction([ours, `${SB}/storage/v1/object/public/listings/1760000000000-abc123-h0123456789abcdef.webp`], RAW_ROOM.images, SB, false)).toBe('human')
    expect(goplusPhotoAction([ours], RAW_ROOM.images, SB, false)).toBe('unchanged')
    expect(goplusPhotoAction([ours], RAW_ROOM.images.slice(1), SB, false)).toBe('rehost')
    expect(goplusPhotoAction([ours], RAW_ROOM.images, SB, true)).toBe('rehost')
    expect(goplusPhotoAction([], RAW_ROOM.images, SB, false)).toBe('rehost')
    // ⛔ A LEGACY (unmarked) gallery is re-hosted ONCE into the overlay folder, even with nothing changed at GoPlus.
    expect(goplusPhotoAction([legacy], RAW_ROOM.images, SB, false)).toBe('rehost')
    expect(goplusPhotoAction([ours, legacy], RAW_ROOM.images, SB, false)).toBe('rehost')
  })
  it('video: the minted shape the listing editor accepts (core/media.ts VIDEO_PATH_RE), its tail naming the source', () => {
    const v = 'https://goplus.com.vn/images/video/e56a4b5e2e4e7ed5e2349408.mp4'
    const at = Date.parse('2026-10-19T08:00:00Z')
    const name = goplusVideoObjectName(v, at)
    expect(name).toMatch(/^\d{10,16}-[a-z0-9]{4,12}\.(mp4|webm|mov)$/)
    expect(name).toBe(`${at}-gp${goplusVideoHex(v)}.mp4`)
    const stored = `${SB}/storage/v1/object/public/listing-videos/${name}`
    expect(goplusStoredVideoHex(stored, SB)).toBe(goplusVideoHex(v))
    expect(goplusVideoAction(stored, [v], SB)).toBe('unchanged')
    expect(goplusVideoAction(stored, ['https://goplus.com.vn/images/video/ffff4b5e2e4e7ed5e2349408.mp4'], SB)).toBe('fetch')
    expect(goplusVideoAction(stored, [], SB)).toBe('clear')
    expect(goplusVideoAction(null, [v], SB)).toBe('fetch')
    expect(goplusVideoAction(null, [], SB)).toBe('unchanged')
    expect(goplusVideoAction(`${SB}/storage/v1/object/public/listing-videos/1760000000000-k3j9x2.mp4`, [v], SB)).toBe('human')
    // ⛔ An all-hex 8-character tail without the `gp` marker is a PERSON's upload, never this importer's (a reviewer's catch).
    expect(goplusStoredVideoHex(`${SB}/storage/v1/object/public/listing-videos/1760000000000-deadbeef.mp4`, SB)).toBeNull()
    // Ownership is the PATH, not the host — a storage domain move must not orphan the importer's own clips.
    expect(goplusStoredVideoHex(`https://cdn.example.vn/storage/v1/object/public/listing-videos/${name}`, SB)).toBe(goplusVideoHex(v))
  })
})

/** A minimal ISO-BMFF file: ftyp, then (mdat before moov when `moovLast`) moov(mvhd + trak(tkhd + mdia(hdlr))). */
function mp4(o: { scale: number; dur: number; handler?: string; w?: number; h?: number; v1?: boolean; moovLast?: boolean }): Uint8Array {
  const box = (type: string, ...parts: Uint8Array[]) => {
    const body = Buffer.concat(parts)
    const head = Buffer.alloc(8); head.writeUInt32BE(8 + body.length); head.write(type, 4, 'latin1')
    return Buffer.concat([head, body])
  }
  const u32 = (...xs: number[]) => { const b = Buffer.alloc(4 * xs.length); xs.forEach((x, i) => b.writeUInt32BE(x >>> 0, i * 4)); return b }
  const mvhd = o.v1
    ? box('mvhd', Buffer.from([1, 0, 0, 0]), Buffer.alloc(16), u32(o.scale), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(o.dur)); return b })(), Buffer.alloc(80))
    : box('mvhd', u32(0, 0, 0, o.scale, o.dur), Buffer.alloc(80))
  const tkhd = box('tkhd', Buffer.alloc(76), u32((o.w ?? 480) * 65536, (o.h ?? 854) * 65536))
  const hdlr = box('hdlr', u32(0, 0), Buffer.from(o.handler ?? 'vide', 'latin1'), Buffer.alloc(12))
  const moov = box('moov', mvhd, box('trak', tkhd, box('mdia', hdlr)))
  const ftyp = box('ftyp', Buffer.from('isom', 'latin1'), u32(512), Buffer.from('isomiso2', 'latin1'))
  const mdat = box('mdat', Buffer.alloc(64))
  return new Uint8Array(o.moovLast ? Buffer.concat([ftyp, mdat, moov]) : Buffer.concat([ftyp, moov, mdat]))
}

describe('mp4Info / goplusVideoVerdict', () => {
  it('reads brand, duration, track handlers and the picture size — moov first or last, mvhd v0 or v1', () => {
    expect(mp4Info(mp4({ scale: 1000, dur: 33400 }))).toEqual({ brand: 'isom', durationS: 33.4, tracks: ['vide'], width: 480, height: 854 })
    expect(mp4Info(mp4({ scale: 600, dur: 600 * 21, moovLast: true }))?.durationS).toBe(21)
    expect(mp4Info(mp4({ scale: 90000, dur: 90000 * 35, v1: true }))?.durationS).toBe(35)
  })
  it('is null for anything that is not ISO-BMFF, and survives a truncated file', () => {
    expect(mp4Info(new Uint8Array(Buffer.from('<html>nope</html>xxxxxxxx')))).toBeNull()
    const cut = mp4({ scale: 1000, dur: 1000 }).slice(0, 40)
    expect(mp4Info(cut)).toEqual({ brand: 'isom', durationS: null, tracks: [], width: null, height: null })
  })
  it('the listing-video rules', () => {
    expect(goplusVideoVerdict(5e6, mp4Info(mp4({ scale: 1000, dur: 33400 })))).toBe('ok')
    expect(goplusVideoVerdict(5e6, mp4Info(mp4({ scale: 1000, dur: 61000 })))).toBe('tooLong')
    expect(goplusVideoVerdict(5e6, mp4Info(mp4({ scale: 1000, dur: 20000, handler: 'soun' })))).toBe('noVideoTrack')
    expect(goplusVideoVerdict(GOPLUS_VIDEO_MAX_BYTES + 1, mp4Info(mp4({ scale: 1000, dur: 1000 })))).toBe('tooBig')
    expect(goplusVideoVerdict(5e6, null)).toBe('notMp4')
    expect(goplusVideoVerdict(5e6, mp4Info(mp4({ scale: 1000, dur: 1000 }).slice(0, 40)))).toBe('noDuration')
  })
})

describe('goplusPublishGate — the seller identity gate, the app\'s own rules (publish-held.ts\'s wiring)', () => {
  const NOW_D = new Date('2026-10-19T08:00:00Z')
  const OWNER = '6f1e2d3c-0000-4000-8000-000000000001'
  const NEW_ACCOUNT = new Date('2026-10-19T07:00:00Z')      // registered for the partnership — after the 2026-09-28 cutoff
  const OLD_ACCOUNT = new Date('2026-09-01T00:00:00Z')      // existed before it — grace until 2026-12-31
  const row = (p: Partial<VerificationRow>): VerificationRow => ({ id: 'v1', tier: 'basic', method: 'passport', status: 'verified', decidedAt: new Date('2026-10-01T00:00:00Z'), documentExpiresAt: new Date('2030-01-01T00:00:00Z'), assuranceLevel: null, ...p })
  const never = () => { throw new Error('identity_verifications must not be read') }
  it('⛔ gate OFF: publishes, and reads nothing (the kill switch)', () => {
    expect(goplusPublishGate({ enforced: false, ownerId: OWNER, accountCreatedAt: NEW_ACCOUNT, now: NOW_D }, never)).toEqual({ ok: true })
  })
  it('gate ON, the new GoPlus account not verified → REFUSED identity_unverified (no grace after the cutoff) — the importer writes HELD', () => {
    expect(goplusPublishGate({ enforced: true, ownerId: OWNER, accountCreatedAt: NEW_ACCOUNT, now: NOW_D }, () => [])).toEqual({ ok: false, code: 'identity_unverified' })
    expect(goplusPublishGate({ enforced: true, ownerId: OWNER, accountCreatedAt: NEW_ACCOUNT, now: NOW_D }, () => [row({ status: 'pending', decidedAt: null })])).toEqual({ ok: false, code: 'identity_pending' })
  })
  it('gate ON, verified → publishes; a lapsed document or a revocation → refused, even inside an old account\'s grace', () => {
    expect(goplusPublishGate({ enforced: true, ownerId: OWNER, accountCreatedAt: NEW_ACCOUNT, now: NOW_D }, () => [row({})])).toEqual({ ok: true })
    expect(goplusPublishGate({ enforced: true, ownerId: OWNER, accountCreatedAt: OLD_ACCOUNT, now: NOW_D }, () => [row({ documentExpiresAt: new Date('2026-10-01T00:00:00Z') })])).toEqual({ ok: false, code: 'identity_expired' })
    expect(goplusPublishGate({ enforced: true, ownerId: OWNER, accountCreatedAt: OLD_ACCOUNT, now: NOW_D }, () => [row({ status: 'revoked' })])).toEqual({ ok: false, code: 'identity_suspended' })
  })
  it('gate ON, an account that existed before 2026-09-28 is inside its grace until the end of 2026; an unknown creation date gets none', () => {
    expect(goplusPublishGate({ enforced: true, ownerId: OWNER, accountCreatedAt: OLD_ACCOUNT, now: NOW_D }, () => [])).toEqual({ ok: true })
    expect(goplusPublishGate({ enforced: true, ownerId: OWNER, accountCreatedAt: OLD_ACCOUNT, now: new Date('2027-01-02T00:00:00Z') }, () => [])).toEqual({ ok: false, code: 'identity_unverified' })
    expect(goplusPublishGate({ enforced: true, ownerId: OWNER, accountCreatedAt: null, now: NOW_D }, () => [])).toEqual({ ok: false, code: 'identity_unverified' })
  })
})

describe('the read, the storefront, the expiry, the exit code', () => {
  it('⛔ a read is whole only when every page saw one total and exactly that many distinct rooms came back', () => {
    expect(goplusReadProblem({ totals: [2669, 2669], collected: 2669, pages: 14, lastPageSize: 69 })).toBeNull()
    expect(goplusReadProblem({ totals: [2669, 2670], collected: 2669, pages: 14, lastPageSize: 69 })).toMatch(/total moved/)
    expect(goplusReadProblem({ totals: [2669], collected: 2668, pages: 14, lastPageSize: 69 })).toMatch(/collected 2668/)
    // The paging itself must add up (reviewers' catch): 14 pages of 200, the last holding the 69 left.
    expect(goplusReadProblem({ totals: [2669], collected: 2669, pages: 1, lastPageSize: 200 })).toMatch(/1 pages for 2669/)
    expect(goplusReadProblem({ totals: [2669], collected: 2669, pages: 14, lastPageSize: 200 })).toMatch(/last page held 200/)
    expect(goplusReadProblem({ totals: [], collected: 0, pages: 0, lastPageSize: 0 })).toMatch(/no page/)
    expect(goplusReadProblem({ totals: [0], collected: 0, pages: 1, lastPageSize: 0 })).toMatch(/not a catalogue/)
  })
  it('⛔ writes only into the storefront the handle names AND contact@goplus.com.vn owns', () => {
    const ok = { id: 's1', name: 'GoPlus', ownerId: 'u1', ownerEmail: GOPLUS_EMAIL, officialPartner: true, trustScore: 100 }
    expect(goplusSellerRefusal(ok)).toBeNull()
    expect(goplusSellerRefusal({ ...ok, ownerEmail: 'CONTACT@GOPLUS.COM.VN' })).toBeNull()
    expect(goplusSellerRefusal(null)).toMatch(/register-partner-seller\.mjs goplus/)
    expect(goplusSellerRefusal({ ...ok, ownerId: null })).toMatch(/no owning account/)
    expect(goplusSellerRefusal({ ...ok, ownerEmail: 'someone@else.vn' })).toMatch(/someone else's shop/)
    // Chat-only before a single room: the official-partner flag first (set-official-partner.mjs goplus).
    expect(goplusSellerRefusal({ ...ok, officialPartner: false })).toMatch(/set-official-partner\.mjs goplus/)
  })
  const live = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `l${i}`, externalId: `goplus:${String(i).padStart(24, '0')}` }))
  it('expires every live row the available set no longer holds', () => {
    const rows = live(10)
    const plan = planGoplusExpiry({ live: rows, available: new Set(rows.slice(0, 7).map((r) => r.externalId)), force: false })
    expect(plan).toEqual({ expire: ['l7', 'l8', 'l9'], keep: 7, refusal: null })
  })
  it('⛔ refuses when under 60% of the live rows would SURVIVE (from 20 live), or EVERY row going (from 3) — unless forced', () => {
    const rows = live(100)
    const half = new Set(rows.slice(0, 50).map((r) => r.externalId))
    expect(planGoplusExpiry({ live: rows, available: half, force: false }).refusal).toMatch(/only 50 of the 100/)
    expect(planGoplusExpiry({ live: rows, available: half, force: true }).refusal).toBeNull()
    // ⛔ The SURVIVORS count, not the size of the read (both reviewers, 2026-10-19): 100 rooms read, only 50 already live.
    const churn = new Set([...rows.slice(0, 50).map((r) => r.externalId), ...Array.from({ length: 50 }, (_, i) => `goplus:new${i}`)])
    expect(planGoplusExpiry({ live: rows, available: churn, force: false }).refusal).toMatch(/only 50 of the 100/)
    // From GOPLUS_EXPIRY_GUARD_FLOOR (20): 99 live and a broken read keeping 1 refuses (a reviewer's catch).
    expect(GOPLUS_EXPIRY_GUARD_FLOOR).toBe(20)
    expect(planGoplusExpiry({ live: live(99), available: new Set([live(1)[0].externalId]), force: false }).refusal).toMatch(/only 1 of the 99/)
    expect(planGoplusExpiry({ live: live(12), available: new Set(['goplus:x']), force: false }).refusal).toMatch(/every one of the 12/)
    expect(planGoplusExpiry({ live: live(3), available: new Set(), force: false }).refusal).toMatch(/every one of the 3/)
    expect(planGoplusExpiry({ live: live(2), available: new Set(), force: false }).refusal).toBeNull()
    expect(planGoplusExpiry({ live: [], available: new Set(), force: false })).toEqual({ expire: [], keep: 0, refusal: null })
  })
  it('⛔ never touches a row this importer did not write — a room GoPlus staff posted by hand (no goplus: id)', () => {
    const rows = [...live(3), { id: 'hand', externalId: null }, { id: 'other', externalId: 'nhatot:123' }]
    const plan = planGoplusExpiry({ live: rows, available: new Set(rows.slice(0, 2).map((r) => r.externalId!)), force: false })
    expect(plan.expire).toEqual(['l2'])
    expect(plan.keep).toBe(2)
  })
  it('exit codes: a stop 2, a refused expiry 3, our own failure 1, else 0', () => {
    const clean = { errored: 0, uploadFailed: 0, tombstoneFailed: false }
    expect(goplusApplyExitCode(clean, 'HTTP 429', false)).toBe(2)
    expect(goplusApplyExitCode(clean, null, true)).toBe(3)
    expect(goplusApplyExitCode({ ...clean, uploadFailed: 1 }, null, false)).toBe(1)
    expect(goplusApplyExitCode({ ...clean, tombstoneFailed: true }, null, false)).toBe(1)
    expect(goplusApplyExitCode(clean, null, false)).toBe(0)
  })
})

/**
 * THE BUILDING'S SHARED AMENITIES (field QA of the live import, 2026-10-20 — three verifiers): GoPlus's room page lists the
 * building's "Tiện ích chung của toà" beside the room's own, and only /api/public/projects/<id> carries them in full. The
 * import read rooms alone, and ~31% of rooms lost "No live-in landlord", "Car access", "No curfew", a fingerprint lock…
 */
describe('building amenities', () => {
  const tokens = (r: ReturnType<typeof mapped>) => parseFacetTokens(r.mutable.facetTokens).map((t) => t.value)
  const DETAIL = { ...RAW_PROJECT, roomCount: 24, amenityKeys: ['no_landlord', 'free_hours', 'car_alley', 'pet', 'window', 'private_wc', 'elevator', 'fingerprint', 'parking', 'security', 'wifi'] }

  it('stages the detail endpoint\'s full list as complete, and the list endpoint\'s 4-key preview as partial', () => {
    const full = stageGoplusProject(DETAIL)!
    expect(full.amenitiesComplete).toBe(true)
    expect(full.amenityKeys).toContain('fingerprint')
    expect(full.roomCount).toBe(24)
    const preview = stageGoplusProject({ ...RAW_PROJECT, feats: ['no_landlord', 'free_hours', 'car_alley', 'pet'], amenityKeys: null })!
    expect(preview.amenitiesComplete).toBe(false)
    expect(preview.amenityKeys).toEqual(['no_landlord', 'free_hours', 'car_alley', 'pet'])
    expect(stageGoplusProject(RAW_PROJECT)!.amenityKeys).toEqual([])
    // A changed shape (objects, renamed keys) is never read as "no amenities".
    expect(stageGoplusProject({ ...DETAIL, amenityKeys: [{ key: 'wifi' }] })!.amenitiesComplete).toBe(false)
    expect(stageGoplusProject({ ...DETAIL, amenityKeys: [] })!.amenitiesComplete).toBe(true)
  })

  it('adds the building-wide ones to a room of a many-room building — never a room-kind key like a private bathroom', () => {
    const r = mapped(room({ amenityKeys: ['aircon', 'kitchen'] }), stageGoplusProject(DETAIL)!)
    const t = tokens(r)
    for (const v of ['no-landlord', 'free-hours', 'car-alley', 'pets', 'elevator', 'fingerprint-lock', 'parking', 'security', 'wifi']) expect(t).toContain(v)
    expect(t).toContain('aircon')
    expect(t).not.toContain('private-wc')
    expect(t).not.toContain('window')
    expect(r.amenitiesPartial).toBe(false)
  })

  it('passes every key of a ONE-room building (it is the room) — furnished becomes the furnishing attribute', () => {
    const r = mapped(room({ amenityKeys: [] }), stageGoplusProject({ ...DETAIL, roomCount: 1, amenityKeys: ['private_wc', 'aircon', 'furnished', 'no_landlord'] })!)
    expect(tokens(r)).toEqual(expect.arrayContaining(['private-wc', 'aircon', 'no-landlord']))
    expect(JSON.parse(r.mutable.attributes).furnishing).toBe('fully')
  })

  it('marks a room whose building list was only the preview as partial (the importer then keeps its stored tokens)', () => {
    const r = mapped(room(), stageGoplusProject({ ...RAW_PROJECT, feats: ['no_landlord'], amenityKeys: null })!)
    expect(r.amenitiesPartial).toBe(true)
    expect(tokens(r)).toContain('no-landlord')
  })

  it('a partial week keeps the stored BUILDING-WIDE amenities and takes the room\'s own as read now — in taxonomy order', () => {
    const stored = '|amenities:no-landlord|amenities:private-wc|amenities:fingerprint-lock|amenities:aircon|'
    const now = '|amenities:car-alley|amenities:aircon|amenities:balcony|'
    // fingerprint-lock + no-landlord (building-wide) kept; private-wc (room-kind, no longer the room's) dropped; balcony added.
    expect(goplusPartialTokens(now, stored)).toBe('|amenities:no-landlord|amenities:car-alley|amenities:aircon|amenities:balcony|amenities:fingerprint-lock|')
    expect(goplusPartialTokens(null, null)).toBeNull()
  })

  it('the building-wide set is building facts only, and every one of them maps to a filter chip', () => {
    expect([...GOPLUS_BUILDING_WIDE_KEYS].sort()).toEqual(['car_alley', 'drying_yard', 'elevator', 'ev_parking', 'fingerprint', 'free_hours', 'no_landlord', 'parking', 'pet', 'security', 'washer', 'wifi'])
    expect(goplusAmenities([...GOPLUS_BUILDING_WIDE_KEYS]).unknown).toEqual([])
    expect(goplusBuildingAmenityKeys(null)).toEqual([])
  })
})

/**
 * ⚠️ A BUILDING POINT FAR FROM HO CHI MINH CITY IS DROPPED (sweep, 2026-10-22). One HCMC rental came pinned in Hà Nội, and
 * the Rentals map fitted the whole country with every other pin stacked at its edge. A point more than 100 km from
 * District 1 is stored as no point (the page shows the district's area instead); all of the city merged in 2025 stays.
 */
describe('mapGoplusRoom — the building point must be near HCMC', () => {
  it('a Hà Nội or Đà Lạt point → no point; points across merged HCMC are kept', () => {
    expect(mapped(room(), project({ geo: { lat: 21.17, lng: 105.931, approx: false } })).mutable).toMatchObject({ lat: null, lng: null })
    expect(mapped(room(), project({ geo: { lat: 11.94, lng: 108.44, approx: false } })).mutable).toMatchObject({ lat: null, lng: null }) // Đà Lạt
    expect(mapped(room(), project({ geo: { lat: 10.86, lng: 106.621, approx: true } })).mutable).toMatchObject({ lat: 10.86, lng: 106.621 })
    for (const [lat, lng] of [[10.973, 106.493], [10.411, 106.954], [10.346, 107.084], [10.98, 106.65], [11.27, 106.36]]) {
      // Củ Chi, Cần Giờ, Vũng Tàu, Thủ Dầu Một, Dầu Tiếng
      expect(mapped(room(), project({ geo: { lat, lng, approx: false } })).mutable, `${lat},${lng}`).toMatchObject({ lat, lng })
    }
  })
})

describe('isGoplusTemplateDescription — the description the listing page does not show (batch 83)', () => {
  const tpl = (r: ReturnType<typeof mapped>, vi = true) => isGoplusTemplateDescription({
    description: r.mutable.description, title: r.mutable.title, ...(vi ? { descriptionVi: r.mutable.descriptionVi, titleVi: r.mutable.titleVi } : {}),
  })
  const hanoi = () => mapped(room(), stageGoplusProject({ ...RAW_PROJECT, region: 'Thành phố Hà Nội', district: 'Hà Đông', ward: 'Phường Hà Đông', street: null })!)
  const noArea = () => mapped(room({ area: null } as Partial<GoplusRoom>))
  it("the importer's own text is the template, in both columns, for every shape it writes", () => {
    for (const r of [mapped(), mapped(room({ street: 'Đường Số 9' })), mapped(room({ street: null } as Partial<GoplusRoom>)), hanoi(), noArea()]) {
      expect(tpl(r), r.mutable.description).toBe(true)
      expect(tpl(r, false)).toBe(true)
    }
  })
  it('⛔ a room whose staff typed extras keeps its Vietnamese Description — "Tiện ích khác:" appears nowhere else', () => {
    const r = mapped(room({ amenities: ['Máy giặt riêng'] }))
    expect(r.mutable.descriptionVi).toContain('Tiện ích khác:')
    expect(tpl(r)).toBe(false)
    expect(tpl(r, false)).toBe(true) // the English column never carries them
  })
  it('⛔ an edited sentence is not the template, even with our closing line kept (commit review)', () => {
    const r = mapped()
    const [sentence, outro] = r.mutable.description.split('\n\n')
    const edit = (first: string) => isGoplusTemplateDescription({ description: `${first}\n\n${outro}`, title: r.mutable.title })
    expect(edit(sentence)).toBe(true)
    expect(edit(sentence.replace(/\.$/, ', newly renovated.'))).toBe(false)
    expect(edit('Studio in District 7, newly renovated, pets allowed, balcony.')).toBe(false)
    expect(edit(sentence.replace(/^Duplex/, 'Penthouse'))).toBe(false)
    expect(edit(sentence.replace('20 m²', '25 m²'))).toBe(false)
    expect(edit(sentence.replace(/ on [^,]+, /, ' on Pets welcome. Quiet, '))).toBe(false)
    const [vSentence, vOutro] = r.mutable.descriptionVi.split('\n\n')
    const editVi = (first: string) => isGoplusTemplateDescription({ description: r.mutable.description, title: r.mutable.title, descriptionVi: `${first}\n\n${vOutro}`, titleVi: r.mutable.titleVi })
    expect(editVi(vSentence)).toBe(true)
    expect(editVi(vSentence.replace(/\.$/, ', mới sửa.'))).toBe(false)
  })
  it('any other shape is not the template: a third paragraph, another closing line, an empty text', () => {
    const r = mapped()
    expect(isGoplusTemplateDescription({ description: `${r.mutable.description}\n\nPets welcome.`, title: r.mutable.title })).toBe(false)
    expect(isGoplusTemplateDescription({ description: r.mutable.description.replace('book a viewing', 'visit'), title: r.mutable.title })).toBe(false)
    expect(isGoplusTemplateDescription({ description: '', title: r.mutable.title })).toBe(false)
    expect(isGoplusTemplateDescription({ description: r.mutable.description, title: 'Studio for rent' })).toBe(false)
  })
})
