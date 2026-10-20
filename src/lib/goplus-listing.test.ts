import { describe, expect, it } from 'vitest'
import {
  GOPLUS_AMENITY_VALUES, GOPLUS_EMAIL, amenityOptions, goplusPublishGate, GOPLUS_EXPIRY_GUARD_FLOOR, GOPLUS_MIN_PHOTOS, GOPLUS_PRICE_UNIT, GOPLUS_VIDEO_MAX_BYTES,
  goplusAmenities, goplusApplyExitCode, goplusDistrict, goplusExtras, goplusFees, goplusFloor, goplusPhotoAction,
  goplusPhotoPlan, goplusReadProblem, goplusRoomIdOf, goplusSellerRefusal, goplusSourceKey, goplusStoredPhotoKey,
  goplusStoredVideoHex, goplusUnit, goplusVideoAction, goplusVideoHex, goplusVideoObjectName, goplusVideoVerdict,
  goplusWard, isGoplusImageUrl, isGoplusVideoUrl, mapGoplusRoom, mp4Info, planGoplusExpiry, stageGoplusProject,
  goplusBuildingAmenityKeys, GOPLUS_BUILDING_WIDE_KEYS, goplusPartialTokens,
  stageGoplusRoom, type GoplusProject, type GoplusRoom,
} from './goplus-listing'
import { parseFacetTokens } from './facet-tokens'
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
  it('a building: id, district, ward, street, its map point — and (only from the detail endpoint) its amenities', () => {
    expect(stageGoplusProject(RAW_PROJECT)).toEqual({ projectId: 'PRJ-9b078ddb12efe4b1632a', district: 'Quận 12', ward: 'Phường Trung Mỹ Tây', street: 'Ql1a', geo: { lat: 10.8598, lng: 106.6209, approx: true }, amenityKeys: [], amenitiesComplete: false, roomCount: null })
    expect(stageGoplusProject({ ...RAW_PROJECT, geo: null })!.geo).toBeNull()
    expect(stageGoplusProject({ ...RAW_PROJECT, projectId: 'nope' })).toBeNull()
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
    const r = mapped(room({ type: '2PN', amenityKeys: ['furnished', 'balcony'], fees: [{ id: 'water', price: 28000, unit: 'm³' }], negotiable: true, availableDate: '2026-11-02' }))
    expect(JSON.parse(r.mutable.attributes)).toMatchObject({ bedrooms: '2', aptType: 'serviced', furnishing: 'fully', waterPrice: '28000', waterUnit: 'm3', availableFrom: '2026-11-02' })
    expect(r.mutable.negotiable).toBe(true)
    expect(r.mutable.titleVi).toBe('Căn hộ 2 phòng ngủ 20 m² · Phường Trung Mỹ Tây, Quận 12')
    expect(r.mutable.description.startsWith('2-bedroom apartment of 20 m² on Ql1a, Trung My Tay Ward, District 12, Ho Chi Minh City.')).toBe(true)
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
  // (rental-facts.ts plausibleFee, the page's own test); a water price without a unit is not stored either.
  it('stores no fee outside its plausible range, and no water price without its unit', () => {
    // The water fee's unit is unknown AND the room's own price block names none (the mapper falls back to it).
    const r = mapped(room({ deposit: 3500, price: { ...room().price, waterUnit: null }, fees: [{ id: 'electric', price: 4_000_000, unit: 'kWh' }, { id: 'parking', price: 10_000_000, unit: 'xe/tháng' }, { id: 'service', price: 150_000, unit: 'tháng' }, { id: 'water', price: 100_000, unit: 'thùng' }] }))
    const a = JSON.parse(r.mutable.attributes)
    expect(a.deposit).toBeUndefined()
    expect(a.electricityPrice).toBeUndefined()
    expect(a.parkingFee).toBeUndefined()
    expect(a.serviceFee).toBe('150000')
    expect(a.waterPrice).toBeUndefined()
    expect(a.waterUnit).toBeUndefined()
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
    ['a kiosk', { type: 'Kiot' }, 'commercial'],
    ['a shop floor (MB = mặt bằng)', { type: 'MB' }, 'commercial'],
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
  it('drops a room whose building is unknown, or whose building has no district', () => {
    expect(mapGoplusRoom(room(), null, OPTS)).toEqual({ ok: false, reason: 'noProject' })
    expect(mapGoplusRoom(room(), project({ district: null }), OPTS)).toEqual({ ok: false, reason: 'noDistrict' })
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
  const ours = `${SB}/storage/v1/object/public/listings/partner/goplus/${key}-h0123456789abcdef.webp`
  it('the source key is stable, 16 hex, and read back from the stored URL', () => {
    expect(key).toMatch(/^[0-9a-f]{16}$/)
    expect(goplusSourceKey(src)).toBe(key)
    expect(goplusStoredPhotoKey(ours, SB)).toBe(key)
    expect(goplusStoredPhotoKey(`${SB}/storage/v1/object/public/listings/affiliate/m/x-ild-1x1.webp`, SB)).toBeNull()
  })
  it('photos: a person\'s own upload stands; a gallery still all in the source is unchanged; a removed one is re-hosted', () => {
    expect(goplusPhotoAction([ours, `${SB}/storage/v1/object/public/listings/1760000000000-abc123-h0123456789abcdef.webp`], RAW_ROOM.images, SB, false)).toBe('human')
    expect(goplusPhotoAction([ours], RAW_ROOM.images, SB, false)).toBe('unchanged')
    expect(goplusPhotoAction([ours], RAW_ROOM.images.slice(1), SB, false)).toBe('rehost')
    expect(goplusPhotoAction([ours], RAW_ROOM.images, SB, true)).toBe('rehost')
    expect(goplusPhotoAction([], RAW_ROOM.images, SB, false)).toBe('rehost')
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
