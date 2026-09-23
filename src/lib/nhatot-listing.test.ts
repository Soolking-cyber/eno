import { afterAll, describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import vnUnits from '@/data/vn-units.json'
import { listingMoneyFor } from './taxonomy'
import { matchesProvinceRow } from './province-match'
import { browseRankScore } from './ranking-formula'
import { minPhotosFor } from './publish-guard'
import { imageVerdict } from './import-photo-check'
import {
  NHATOT_CITIES, NHATOT_GAP_MS_DEFAULT, NHATOT_GAP_MS_MIN, NHATOT_MIN_PHOTOS, NHATOT_PHOTO_FLOOR, NHATOT_UA_TOKEN,
  classifyNhatotLiveness, isNhatotAffiliateUrl, isNhatotImageUrl, mapNhatotAd, nhatotAffiliateUrl, nhatotAreaM2,
  nhatotBedroomFacet, nhatotCoords, nhatotDistrict, nhatotJournalDirProblem, nhatotListIdOf, nhatotMonthlyPrice,
  nhatotPhotoPlan, nhatotPostedAt, nhatotRateArg, nhatotRobotsAllows, nhatotSellerRefusal, nhatotShouldRetire,
  nhatotStageAgeProblem, nhatotStartingRank, nhatotStopReason, nhatotStreetName, nhatotWardLabel, parseNhatotCaps,
  NHATOT_LIST_ID_MAX, nhatotApplyExitCode, nhatotCapsProblem, nhatotHostHalt, nhatotProjectName, nhatotRunReadsNetwork, nhatotSliceEnd, NHATOT_TOTAL_CAP,
  readNewestAcross, sliceQuotas, stageNhatotAd, stageNhatotLiveness, type NhatotStagedAd,
} from './nhatot-listing'
import { DOOR_IN_TEXT, checkRow, projectLineProblems, projectValueProblem, slashDoorLineProblems, streetLineProblems, streetValueProblem, type VerifyRow } from '../../scripts/verify-nhatot-import'
import { overlayImagePath } from './image-mark-url'

vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sb.eno.vn/')
// process.env is per WORKER: undo the stub so no later suite in this worker inherits it.
afterAll(() => { vi.unstubAllEnvs() })

/**
 * The pure half of scripts/import-nhatot-com.ts. Each case is a way a reference listing goes wrong
 * silently on a public card: a leaked name, a per-m² price read as the rent, a missing bedroom count
 * filed as a Studio, a pin in the sea, an outbound link to somewhere else.
 */

const NOW = Date.UTC(2026, 8, 24, 0, 0, 0)
const IMG = (h: string) => `https://cdn.chotot.com/SIG_${h}/preset:view/plain/${h}-300343074303565.jpg`

/** Shaped like a live gateway row (gateway.chotot.com, 2026-09-24), with a made-up person on it. */
const RAW = {
  account_id: 24586427,
  account_name: 'NGUYỄN VĂN MẪU',
  account_oid: 'e184836c6d08aeb64c6ffe5994f2a604',
  full_name: 'NGUYỄN VĂN MẪU',
  avatar: 'https://cdn.chotot.com/uac2/24586427',
  seller_info: { full_name: 'NGUYỄN VĂN MẪU', avatar: 'https://cdn.chotot.com/uac2/24586427' },
  shop: { name: 'Nguyễn Văn Mẫu', address: 'Đường Tô Ký, Quận 12' },
  shop_alias: 'giwsdwgx31VOUdG',
  subject: 'Trống 2P căn hộ mới — LH 0909 123 456 gặp Mẫu',
  body: 'SĐT: 0909123456 gặp Mẫu tư vấn',
  phone: '0909123456',
  list_id: 134859113,
  ad_id: 178976798,
  category: 1010,
  type: 'u',
  status: 'active',
  region_v2: 13000,
  area_v2: 13107,
  area_name: 'Quận 12',
  ward_name: 'Phường Đông Hưng Thuận',
  ward_name_v3: 'Phường Đông Hưng Thuận',
  street_name: 'Đường Nguyễn Văn Quá',
  pty_project_name: '',
  price: 4_000_000,
  price_string: '4 triệu/tháng',
  is_price_not_valid: false,
  size: 30,
  size_unit_string: 'm²',
  rooms: 1,
  toilets: 1,
  latitude: 10.836352,
  longitude: 106.62907,
  list_time: NOW - 3 * 60_000,
  company_ad: true,
  images: [IMG('a'), IMG('b'), IMG('c'), 'https://cdn.chotot.com/SIG/preset:listing/plain/thumb.jpg', 'https://evil.example/x.jpg'],
  feature_params: {
    compare: { items: [
      { id: 'apartment_type', label: 'Loại hình', value: 'Căn hộ dịch vụ, mini' },
      { id: 'furnishing_sell', label: 'Tình trạng nội thất', value: 'Nội thất đầy đủ' },
    ] },
  },
}
const staged = () => stageNhatotAd(RAW) as NhatotStagedAd
const OPTS = { now: NOW, maxAgeDays: 30, maxPhotos: 6 }
const mapped = (over: Partial<NhatotStagedAd> = {}) => mapNhatotAd({ ...staged(), ...over }, OPTS)

describe('stageNhatotAd — the personal-data whitelist', () => {
  it('⛔ carries no name, avatar, account id, shop, subject, body or phone', () => {
    const a = staged()
    const json = JSON.stringify(a)
    for (const k of ['account_id', 'account_name', 'account_oid', 'full_name', 'avatar', 'seller_info', 'shop', 'shop_alias', 'subject', 'body', 'phone', 'ad_id']) {
      expect(a).not.toHaveProperty(k)
    }
    expect(json).not.toMatch(/MẪU|Mẫu|0909|uac2/)
  })

  it('keeps the facts, and the type/furnishing labels from feature_params', () => {
    const a = staged()
    expect(a.list_id).toBe(134859113)
    expect(a.kind_label).toBe('Căn hộ dịch vụ, mini')
    expect(a.furnishing_label).toBe('Nội thất đầy đủ')
    expect(a.pty_project_name).toBeNull()   // '' is not a building name
  })

  it('⛔ a staged row re-staged from a file keeps its labels (the --src round trip)', () => {
    const again = stageNhatotAd(JSON.parse(JSON.stringify(staged())))
    expect(again).toEqual(staged())
  })

  it('refuses a row with no usable id', () => {
    expect(stageNhatotAd({ ...RAW, list_id: '134859113' })).toBeNull()
    expect(stageNhatotAd({ ...RAW, list_id: -1 })).toBeNull()
    expect(stageNhatotAd({ ...RAW, list_id: 1.5 })).toBeNull()
    expect(stageNhatotAd(null)).toBeNull()
  })
})

describe('nhatotMonthlyPrice', () => {
  const p = (price: number | null, price_string: string | null, is_price_not_valid = false) =>
    nhatotMonthlyPrice({ price, price_string, is_price_not_valid })

  it('accepts a lump monthly rent', () => {
    expect(p(4_000_000, '4 triệu/tháng')).toBe(4_000_000)
    expect(p(7_500_000, '7,5 triệu/tháng')).toBe(7_500_000)
  })
  it('⛔ drops a per-m² figure even when the number looks like a rent', () => {
    expect(p(1_120_000, '1,12 triệu/m²/tháng')).toBe('pricePerM2')
    expect(p(1_120_000, '1,12 triệu/m2')).toBe('pricePerM2')
  })
  it('⛔ drops a figure that is not monthly', () => {
    expect(p(50_000_000, '50 triệu/năm')).toBe('pricePeriod')
    expect(p(500_000, '500 nghìn/ngày')).toBe('pricePeriod')
    expect(p(5_000_000, null)).toBe('pricePeriod')
  })
  it('⛔ trusts the source’s own "price not valid" flag', () => {
    expect(p(4_000_000, '4 triệu/tháng', true)).toBe('priceInvalid')
  })
  it('⛔ drops out-of-band and non-finite prices', () => {
    expect(p(999_999, '0,9 triệu/tháng')).toBe('priceRange')
    expect(p(2_000_000_001, '2,1 tỷ/tháng')).toBe('priceRange')
    expect(p(NaN, '4 triệu/tháng')).toBe('priceRange')
    expect(p(null, '4 triệu/tháng')).toBe('priceRange')
  })
})

describe('facts', () => {
  it('⛔ a missing bedroom count is NOT a Studio, and offices never get the facet', () => {
    expect(nhatotBedroomFacet(null, 'apartment-rental')).toBeNull()
    expect(nhatotBedroomFacet(0, 'apartment-rental')).toBeNull()
    expect(nhatotBedroomFacet(2, 'office-rental')).toBeNull()
    expect(nhatotBedroomFacet(2, null)).toBeNull()
    expect(nhatotBedroomFacet(1, 'room-rental')).toBe('1')
    expect(nhatotBedroomFacet(8, 'house-rental')).toBe('3')   // '3' = 3+
  })

  it('area: finite, positive, m² only', () => {
    expect(nhatotAreaM2({ size: 30, size_unit_string: 'm²' })).toBe(30)
    expect(nhatotAreaM2({ size: 4.5, size_unit_string: null })).toBe(4.5)
    expect(nhatotAreaM2({ size: 0, size_unit_string: 'm²' })).toBeNull()
    expect(nhatotAreaM2({ size: NaN, size_unit_string: 'm²' })).toBeNull()
    expect(nhatotAreaM2({ size: 3, size_unit_string: 'ha' })).toBeNull()
  })

  it('⛔ coordinates: inside Vietnam or null — never (0,0), a string or a swapped pair; rounded to ~110 m', () => {
    expect(nhatotCoords(10.836352, 106.62907)).toEqual({ lat: 10.836, lng: 106.629 })
    expect(nhatotCoords(0, 0)).toBeNull()
    expect(nhatotCoords(106.62907, 10.836352)).toBeNull()
    expect(nhatotCoords('10.8', '106.6')).toBeNull()
    expect(nhatotCoords(NaN, 106.6)).toBeNull()
  })

  it('ward label: the post-2025 ward in the Batdongsan rows’ style, else the old one verbatim', () => {
    expect(nhatotWardLabel({ ward_name: 'Phường 12', ward_name_v3: 'Phường Bình Thạnh' })).toBe('P. Bình Thạnh mới')
    expect(nhatotWardLabel({ ward_name: 'Thị trấn Nhà Bè', ward_name_v3: 'Xã Nhà Bè' })).toBe('Xã Nhà Bè mới')
    expect(nhatotWardLabel({ ward_name: 'Phường 9', ward_name_v3: null })).toBe('Phường 9')
  })
})

describe('urls', () => {
  it('⛔ the outbound link is built from the id and host-pinned', () => {
    expect(nhatotAffiliateUrl(134859113)).toBe('https://www.nhatot.com/134859113.htm')
    expect(isNhatotAffiliateUrl('https://www.nhatot.com/134859113.htm')).toBe(true)
    expect(isNhatotAffiliateUrl('https://www.nhatot.com.evil.example/134859113.htm')).toBe(false)
    expect(isNhatotAffiliateUrl('http://www.nhatot.com/134859113.htm')).toBe(false)
    expect(isNhatotAffiliateUrl('javascript:alert(1)//www.nhatot.com/1.htm')).toBe(false)
  })
  it('only full-size photos on Chợ Tốt’s CDN', () => {
    expect(isNhatotImageUrl(IMG('a'))).toBe(true)
    expect(isNhatotImageUrl('https://cdn.chotot.com/SIG/preset:listing/plain/thumb.jpg')).toBe(false)
    expect(isNhatotImageUrl('https://cdn.chotot.com.evil.example/SIG/preset:view/plain/a.jpg')).toBe(false)
    expect(isNhatotImageUrl('https://cdn.chotot.com/uac2/24586427')).toBe(false)   // an avatar
  })
})

describe('mapNhatotAd', () => {
  it('composes the reference row the contract requires', () => {
    const m = mapped()
    expect(m.ok).toBe(true)
    if (!m.ok) return
    const r = m.row
    expect(r.externalId).toBe('nhatot:134859113')
    expect(r.images).toEqual([IMG('a'), IMG('b'), IMG('c')])
    expect(r.mutable).toMatchObject({
      price: 4_000_000, priceUnit: 'VND/month', currency: '₫', negotiable: false, listingType: 'rent',
      subcategorySlug: 'apartment-rental', district: 'Quận 12', city: 'Hồ Chí Minh',
      lat: 10.836, lng: 106.629, areaM2: 30, attributes: '{"bedrooms":"1"}',
      affiliateUrl: 'https://www.nhatot.com/134859113.htm',
      location: 'Quận 12 (P. Đông Hưng Thuận mới)',
    })
    expect(r.mutable.title).toBe('Apartment · 1 bed · 1 bath · 30 m² for rent — P. Đông Hưng Thuận mới, Quận 12')
    expect(r.mutable.titleVi).toBe('Cho thuê Căn hộ / Chung cư 1PN 30m² — P. Đông Hưng Thuận mới, Quận 12')
    expect(r.mutable.description.startsWith('Listed on Nhatot.com. eno links to the original')).toBe(true)
    expect(r.mutable.descriptionVi).toContain('Giá thuê: 4.000.000 đ/tháng')
    /** vnd.ts's English grouping — the hand-rolled formatter printed the Vietnamese dots here too. */
    expect(r.mutable.description).toContain('Rent: 4,000,000 đ/month')
    expect(r.mutable.searchText).toContain('quan 12')
  })

  it('⛔ nothing the poster wrote reaches the row', () => {
    const m = mapped()
    expect(JSON.stringify(m)).not.toMatch(/Mẫu|MẪU|0909/)
  })

  it('Hà Nội and Đà Nẵng store the vn-units spelling and say the city in the title', () => {
    const hn = mapped({ region_v2: NHATOT_CITIES.hn.region, area_name: 'Quận Nam Từ Liêm', ward_name_v3: 'Phường Từ Liêm' })
    expect(hn.ok && hn.row.mutable.city).toBe('Hà Nội')
    expect(hn.ok && hn.row.mutable.title).toMatch(/— P\. Từ Liêm mới, Quận Nam Từ Liêm, Hà Nội$/)
    const dn = mapped({ region_v2: NHATOT_CITIES.dn.region })
    expect(dn.ok && dn.row.mutable.city).toBe('Đà Nẵng')
  })

  it('offices get no bedroom facet and no "bed" in the title; land keeps a NULL subcategory', () => {
    const office = mapped({ category: 1030, rooms: 3, kind_label: 'Mặt bằng kinh doanh' })
    expect(office.ok && office.row.mutable.attributes).toBeNull()
    expect(office.ok && office.row.mutable.title).not.toContain('bed')
    expect(office.ok && office.row.mutable.subcategorySlug).toBe('office-rental')
    const land = mapped({ category: 1040, rooms: null })
    expect(land.ok && land.row.mutable.subcategorySlug).toBeNull()
  })

  it('a room with no bedroom count stores no attribute', () => {
    const room = mapped({ category: 1050, rooms: null })
    expect(room.ok && room.row.mutable.attributes).toBeNull()
    expect(room.ok && room.row.mutable.subcategorySlug).toBe('room-rental')
  })

  it('drops with ONE named reason', () => {
    const reason = (over: Partial<NhatotStagedAd>) => { const m = mapped(over); return m.ok ? 'kept' : m.reason }
    expect(reason({ type: 's' })).toBe('notRent')
    expect(reason({ status: 'hidden' })).toBe('notActive')
    expect(reason({ region_v2: 2010 })).toBe('unknownRegion')
    expect(reason({ category: 1000 })).toBe('unknownCategory')
    expect(reason({ price_string: '1,12 triệu/m²' })).toBe('pricePerM2')
    expect(reason({ images: ['https://evil.example/x.jpg'] })).toBe('noImages')
    expect(reason({ list_time: NOW - 31 * 86_400_000 })).toBe('stale')
  })

  it('⛔ a missing list_time FAILS the freshness test instead of passing it (NaN < max is false)', () => {
    const m = mapped({ list_time: null })
    expect(m.ok ? 'kept' : m.reason).toBe('stale')
  })

  it('caps and de-duplicates photos', () => {
    const many = Array.from({ length: 12 }, (_, i) => IMG(`p${i}`))
    const m = mapNhatotAd({ ...staged(), images: [...many, many[0]] }, { ...OPTS, maxPhotos: 6 })
    expect(m.ok && m.row.images).toEqual(many.slice(0, 6))
  })
})

describe('sliceQuotas', () => {
  it('splits a --limit exactly across slices so every slice is sampled', () => {
    const q = sliceQuotas(30, 12)
    expect(q.reduce((a, b) => (a ?? 0) + (b ?? 0), 0)).toBe(30)
    expect(q).toEqual([3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2])
  })
  it('⛔ a 0 share means SKIP, and no limit is null — never confused', () => {
    expect(sliceQuotas(2, 4)).toEqual([1, 1, 0, 0])
    expect(sliceQuotas(0, 3)).toEqual([null, null, null])
  })
})

describe('the fixes from the 2026-09-24 review', () => {
  it('⛔ priceUnit is the app’s rent unit, not bare VND (cards lost "/ month")', () => {
    const m = mapped()
    expect(m.ok && m.row.mutable.priceUnit).toBe('VND/month')
    expect(m.ok && m.row.mutable.priceUnit).toBe(listingMoneyFor({ categorySlug: 'rentals', listingType: 'rent' }).priceUnit)
  })

  it('⛔ city is the vn-units `name` (one spelling per city, as the wizard and ~98k rows store it) — and the filter still finds it', () => {
    const units = vnUnits as { code: string; name: string; nameEn: string }[]
    for (const c of Object.values(NHATOT_CITIES)) {
      const unit = units.find((u) => u.code === c.provinceCode)!
      const m = mapped({ region_v2: c.region })
      expect(m.ok && m.row.mutable.city).toBe(unit.name)
      /** The area filter sends nameEn; province-match.ts matches the Vietnamese name through its aliases. */
      const row = m.ok ? { city: m.row.mutable.city, location: m.row.mutable.location } : {}
      expect(matchesProvinceRow(row, unit.nameEn)).toBe(true)
      for (const other of Object.values(NHATOT_CITIES).filter((o) => o !== c)) {
        expect(matchesProvinceRow(row, units.find((u) => u.code === other.provinceCode)!.nameEn)).toBe(false)
      }
    }
    expect(Object.values(NHATOT_CITIES).map((c) => c.city)).toEqual(['Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng'])
  })

  it("district: 'Thành phố Thủ Đức' is stored as 'TP. Thủ Đức'; 'Quận N' / 'Huyện X' verbatim", () => {
    expect(nhatotDistrict('Thành phố Thủ Đức')).toBe('TP. Thủ Đức')
    expect(nhatotDistrict('Quận 12')).toBe('Quận 12')
    expect(nhatotDistrict('Huyện Nhà Bè')).toBe('Huyện Nhà Bè')
    expect(nhatotDistrict('  ')).toBeNull()
    const m = mapped({ area_name: 'Thành phố Thủ Đức', ward_name_v3: 'Phường Thảo Điền' })
    expect(m.ok && m.row.mutable.district).toBe('TP. Thủ Đức')
    expect(m.ok && m.row.mutable.location).toBe('TP. Thủ Đức (P. Thảo Điền mới)')
  })

  it('serviced/mini flats land in apartment-rental', () => {
    const m = mapped({ category: 1010, kind_label: 'Căn hộ dịch vụ, mini' })
    expect(m.ok && m.row.mutable.subcategorySlug).toBe('apartment-rental')
  })

  it('⛔ a door or alley number never reaches the row — not location, not description, not search', () => {
    const cases: [string, string | null][] = [
      /** The 2026-09-24 review's leaks: a street-kind prefix no longer vouches for the digits after it. */
      ['Đường Kiệt 64 Trần Đình Tri', null],
      ['Đường Nguyễn Trãi 123', null],
      ['Phố Huế 102', null],
      ['Quốc lộ 13 số 250', null],
      /** Leading door / alley numbers: dropped whole, never salvaged. */
      ['506/35 Lạc Long Quân', null],
      ['129/ Lê Đình Cẩn', null],
      ['76 Nguyễn Xí ', null],
      ['37 Đường 882', null],
      ['Hẻm 656 Quang Trung', null],
      ['Ngõ 14 Phố Mễ Trì Hạ', null],
      ['K12/3 Hùng Vương', null],
      ['số nhà 12 Lê Lợi', null],
      ['12A/3B Trần Hưng Đạo', null],
      /** Alley words with no number, a bare number, digits of another script, a trailing number. */
      ['Hẻm Quang Trung', null],
      ['Kiệt Trần Cao Vân', null],
      ['Ngách Láng Hạ', null],
      ['Hẽm Hoàng Diệu', null],   // 'hẻm' misspelt with the ngã tone (agy, 2026-09-24)
      ['Ngỏ Huế', null],
      ['hem Quang Trung', null],
      ['H\u0435m Quang Trung', null],   // Cyrillic 'е' look-alike
      ['Nguy\u0435̃n Trãi', null],
      ['Võ Văn Kiệt', null],   // a name, but 'kiệt' is dropped wherever it stands (fail closed)
      ['8', null],
      ['HT35', null],
      ['3/2', null],
      ['Lê Văn Sỹ 123', null],
      ['Thạnh Xuân 13', null],
      ['Đường ３２', null],
      ['Ngõ Ⅻ Láng', null],
      ['Nguyễn Trãi ²', null],
      ['Lê Lợi #12', null],
      ['Đường Số', null],
      ['Gần chợ Bến Thành đi bộ ra công viên và trung tâm thương mại rất tiện', null],   // a sentence, not a street (> 60)
      /** Genuinely numbered street NAMES, and plain names. */
      ['Đường số 12', 'Đường số 12'],
      ['Đường Số 1A', 'Đường Số 1A'],
      ['Đường 15B', 'Đường 15B'],
      ['Quốc lộ 13', 'Quốc lộ 13'],
      ['QL13', 'QL13'],
      ['Đường Quốc lộ 50', 'Đường Quốc lộ 50'],
      ['3 Tháng 2', '3 Tháng 2'],
      ['Đường 30 Tháng 4', 'Đường 30 Tháng 4'],
      ['Đường 3/2', 'Đường 3/2'],
      ['Phố 8/3', 'Phố 8/3'],
      ['Đường Phan Xích Long', 'Đường Phan Xích Long'],
      ['Xa lộ Hà Nội', 'Xa lộ Hà Nội'],
      ['Ngô Quyền', 'Ngô Quyền'],   // 'ngô' is not the alley word 'ngõ' — only TONES are folded
      ['Sơn Trà Điện Ngọc', 'Sơn Trà Điện Ngọc'],
      ['Đường 102', 'Đường 102'],   // a numbered street in Thủ Đức; no named street for a door to sit on
      ['Nguye\u0302\u0303n Trãi', 'Nguyễn Trãi'],   // decomposed input comes back composed
      ['  Lạc Long Quân, ', 'Lạc Long Quân'],
    ]
    for (const [raw, want] of cases) {
      expect(nhatotStreetName(raw), raw).toBe(want)
      expect(nhatotStreetName(nhatotStreetName(raw)), raw).toBe(want)   // idempotent: the --src round trip
    }
    const a = stageNhatotAd({ ...RAW, street_name: 'Đường Kiệt 64 Trần Đình Tri' })!
    expect(a.street_name).toBeNull()   // the staged FILE never holds the number either
    const m = mapNhatotAd(a, OPTS)
    expect(m.ok).toBe(true)
    expect(JSON.stringify(m)).not.toMatch(/Kiệt|kiet|64/)
    /** A staged file written before this sanitiser is re-cleaned at map time. */
    for (const leak of ['Đường Kiệt 64 Trần Đình Tri', 'Phố Huế 102', '506/35 Lạc Long Quân']) {
      const legacy = mapNhatotAd({ ...a, street_name: leak }, OPTS)
      expect(legacy.ok && legacy.row.mutable.description).not.toMatch(/^Street:/m)
      expect(JSON.stringify(legacy)).not.toMatch(/102|506|\/35|Kiệt 64/)
    }
    const kept = mapNhatotAd({ ...a, street_name: 'Đường số 12' }, OPTS)
    expect(kept.ok && kept.row.mutable.description).toMatch(/^Street: Đường số 12$/m)
    expect(kept.ok && kept.row.mutable.descriptionVi).toMatch(/^Đường: Đường số 12$/m)
  })

  it('⛔ the verify script’s street check is INDEPENDENT and catches what the old sanitiser let through', () => {
    for (const leak of ['Đường Kiệt 64 Trần Đình Tri', 'Đường Nguyễn Trãi 123', 'Phố Huế 102', 'Quốc lộ 13 số 250', 'Lạc Long Quân 506/35', 'Hẻm Quang Trung', 'Đường ３２', 'Nguyễn Trãi Ⅻ', 'Hẽm Hoàng Diệu', 'H\u0435m Quang Trung']) {
      expect(streetValueProblem(leak), leak).not.toBeNull()
    }
    for (const ok of ['Đường số 12', 'Quốc lộ 13', '3 Tháng 2', 'Đường 3/2', 'Đường 15B', 'Lạc Long Quân', 'Xa lộ Hà Nội']) {
      expect(streetValueProblem(ok), ok).toBeNull()
    }
    /** Every value the importer would publish passes the audit — the two never disagree on a clean row… */
    const corpus = ['Đường Phan Xích Long', 'Đường Số 37', 'Đường 65', 'Đường Quốc lộ 50', 'Nguyễn Văn Cừ', "Phố Hàng Bài", 'Đường 30 Tháng 4', 'Phố 8/3', 'QL13', 'Ngô Quyền', 'Sơn Trà Điện Ngọc', 'Phố Ngọc Hà']
    for (const v of corpus) {
      const out = nhatotStreetName(v)
      expect(out, v).not.toBeNull()
      expect(streetValueProblem(out!), v).toBeNull()
    }
    /** …and it reads the facts block the importer writes. */
    const m = mapNhatotAd({ ...staged(), street_name: 'Đường số 12' }, OPTS)
    expect(m.ok && streetLineProblems(m.row.mutable.description)).toEqual([])
    expect(streetLineProblems('Listed…\n\nType: Apartment\nStreet: Phố Huế 102\nWard: X')).toHaveLength(1)
    expect(streetLineProblems('Tin…\n\nĐường: Đường Kiệt 64 Trần Đình Tri')).toHaveLength(1)
    expect(DOOR_IN_TEXT.test('Quận 3 (P. Bàn Cờ mới)')).toBe(false)
    expect(DOOR_IN_TEXT.test('Hẻm 656, Quận 10')).toBe(true)
    expect(DOOR_IN_TEXT.test('Quận 11 (506/35)')).toBe(true)
  })

  it('⛔ the contact screen runs on the composed TEXT (photos are the owner’s watermark call, text is not)', () => {
    const reason = (over: Partial<NhatotStagedAd>) => { const m = mapped(over); return m.ok ? 'kept' : m.reason }
    // A phone in the project name has digits, so nhatotProjectName drops the NAME before the screen
    // sees it: nothing of it is published (the row stays). A digit-free contact still trips the screen.
    for (const v of ['Zalo: 0909123456', 'LH 0909 123 456']) {
      const m = mapped({ pty_project_name: v })
      expect(m.ok && `${m.row.mutable.description}${m.row.mutable.descriptionVi}${m.row.mutable.searchText}`).not.toMatch(/0909/)
    }
    expect(reason({ pty_project_name: 'xem tại www.canho-dep.com' })).toBe('contactInText')
    // A door number in the project name drops the NAME (nhatotProjectName), not the row: nothing of it
    // is published, so there is nothing left for the contact screen to catch.
    const doorInProject = mapped({ street_name: 'Đường Lê Lợi', pty_project_name: 'Toà A — số nhà 12' })
    expect(doorInProject.ok && doorInProject.row.mutable.description).not.toMatch(/số nhà|Building:/)
    /** …while OUR intro paragraph, which names "Nhatot.com", does not trip the link rule on every row. */
    expect(reason({})).toBe('kept')
  })

  it('⛔ a rate argument that does not parse is the default, never NaN = no delay; never below the floor', () => {
    const r = (x: string | null) => nhatotRateArg(x, NHATOT_GAP_MS_DEFAULT, NHATOT_GAP_MS_MIN)
    expect(r('1500ms')).toBe(NHATOT_GAP_MS_DEFAULT)
    expect(r('NaN')).toBe(NHATOT_GAP_MS_DEFAULT)
    expect(r('Infinity')).toBe(NHATOT_GAP_MS_DEFAULT)
    expect(r('')).toBe(NHATOT_GAP_MS_DEFAULT)
    expect(r(null)).toBe(NHATOT_GAP_MS_DEFAULT)
    expect(r('0')).toBe(NHATOT_GAP_MS_MIN)
    expect(r('-5')).toBe(NHATOT_GAP_MS_MIN)
    expect(r('2500')).toBe(2500)
    for (const x of ['1500ms', 'NaN', 'abc', '']) expect(Number.isFinite(r(x))).toBe(true)
  })

  it('⛔ a staged file refuses --apply when stale, garbled, OR future-dated', () => {
    const now = Date.UTC(2026, 8, 24, 12)
    const iso = (h: number) => new Date(now - h * 3_600_000).toISOString()
    expect(nhatotStageAgeProblem(iso(1), now)).toBeNull()
    expect(nhatotStageAgeProblem(iso(71.9), now)).toBeNull()
    expect(nhatotStageAgeProblem(iso(72.1), now)).toMatch(/over 72 h/)
    expect(nhatotStageAgeProblem(iso(-24 * 365), now)).toMatch(/future/)
    expect(nhatotStageAgeProblem('yesterday', now)).toMatch(/not a date/)
    expect(nhatotStageAgeProblem(undefined, now)).toMatch(/no fetchedAt/)
  })

  it('⛔ an import seller that is renamed, owned OR badged is refused (badges were missed before)', () => {
    const ok = { name: 'Nhatot.com', ownerId: null, verified: false, verifiedSeller: false, officialPartner: false }
    expect(nhatotSellerRefusal(null)).toBeNull()
    expect(nhatotSellerRefusal(ok)).toBeNull()
    expect(nhatotSellerRefusal({ ...ok, name: 'Nhà Tốt Official' })).toMatch(/named/)
    expect(nhatotSellerRefusal({ ...ok, ownerId: 'u1' })).toMatch(/ownerId/)
    expect(nhatotSellerRefusal({ ...ok, verified: true })).toMatch(/verified/)
    expect(nhatotSellerRefusal({ ...ok, verifiedSeller: true })).toMatch(/verifiedSeller/)
    expect(nhatotSellerRefusal({ ...ok, officialPartner: true })).toMatch(/officialPartner/)
  })

  it('⛔ the journal dir must be given and durable — a temp root refuses --apply before any request', () => {
    const roots = ['/tmp', '/private/tmp', '/var/folders/xy/T']
    expect(nhatotJournalDirProblem(null, roots)).toMatch(/needs --journal-dir/)
    expect(nhatotJournalDirProblem('/tmp', roots)).toMatch(/cleared on reboot/)
    expect(nhatotJournalDirProblem('/private/tmp/claude/x', roots)).toMatch(/cleared on reboot/)
    expect(nhatotJournalDirProblem('/var/folders/xy/T/j', roots)).toMatch(/cleared on reboot/)
    expect(nhatotJournalDirProblem('/tmpfoo/j', roots)).toBeNull()
    expect(nhatotJournalDirProblem('/Users/me/eno-import-staging', roots)).toBeNull()
  })

  it('⛔ 429, a challenge, or HTML where JSON/an image was expected STOPS the read (images included)', () => {
    expect(nhatotStopReason(429, 'application/json', null)).toMatch(/429/)
    expect(nhatotStopReason(429, 'image/jpeg', null)).toMatch(/429/)
    expect(nhatotStopReason(403, 'text/html; charset=UTF-8', 'challenge')).toMatch(/challenge/)
    expect(nhatotStopReason(200, 'text/html', null)).toMatch(/HTML/)
    expect(nhatotStopReason(404, 'application/json; charset=utf-8', null)).toBeNull()   // the liveness "gone" answer
    expect(nhatotStopReason(200, 'image/jpeg', null)).toBeNull()
    expect(nhatotStopReason(404, 'image/jpeg', null)).toBeNull()   // one missing photo fails one row, not the run
  })
})

describe('photos — the real-photo check and the publish floor (review round 2)', () => {
  it('⛔ the floor is the rentals publish floor, and a row whose candidates cannot reach it is dropped before any fetch', () => {
    expect(NHATOT_MIN_PHOTOS).toBe(minPhotosFor('rentals'))
    expect(NHATOT_MIN_PHOTOS).toBe(3)
    const reason = (images: string[]) => { const m = mapped({ images }); return m.ok ? 'kept' : m.reason }
    expect(reason([IMG('a'), IMG('b')])).toBe('tooFewImages')
    expect(reason([IMG('a'), IMG('a'), IMG('a')])).toBe('tooFewImages')   // one URL three times is one candidate
    expect(reason([])).toBe('noImages')
    expect(reason([IMG('a'), IMG('b'), IMG('c')])).toBe('kept')
    /** --max-photos below the floor would drop every row; the floor wins. */
    const m = mapNhatotAd({ ...staged(), images: [IMG('a'), IMG('b'), IMG('c'), IMG('d')] }, { ...OPTS, maxPhotos: 1 })
    expect(m.ok && m.row.images).toHaveLength(3)
  })

  it('⛔ nhatotPhotoPlan: cards, logos and thumbnails are left out; fewer than 3 real, distinct photos = no row', () => {
    const ok = (hash: string) => ({ outcome: 'ok' as const, hash })
    const H = ['0000000000000000', 'ffffffffffffffff', '0f0f0f0f0f0f0f0f', 'f0f0f0f0f0f0f0f0']
    expect(nhatotPhotoPlan([ok(H[0]), ok(H[1]), ok(H[2])])).toEqual({ decision: 'create', keep: [0, 1, 2], refused: {}, duplicates: 0 })
    /** A text-card cover: left out, and the cover passes to the first real photo. */
    expect(nhatotPhotoPlan([{ outcome: 'placeholder' }, ok(H[0]), ok(H[1]), ok(H[2])])).toMatchObject({ decision: 'create', keep: [1, 2, 3], refused: { placeholder: 1 } })
    /** Only two real photos left → not created, however many candidates there were. */
    expect(nhatotPhotoPlan([{ outcome: 'placeholder' }, ok(H[0]), { outcome: 'tooSmall' }, ok(H[1])]).decision).toBe('tooFewRealPhotos')
    /** The same shot three times is one photo. */
    expect(nhatotPhotoPlan([ok(H[0]), ok(H[0]), ok('0000000000000001'), ok(H[1])])).toMatchObject({ decision: 'tooFewRealPhotos', keep: [0, 3], duplicates: 2 })
    /** A fetch or decode failure fails the row (all-or-nothing; the next run retries it). */
    expect(nhatotPhotoPlan([ok(H[0]), ok(H[1]), ok(H[2]), { outcome: 'fetchFailed' }]).decision).toBe('photoFailed')
    expect(nhatotPhotoPlan([ok(H[0]), ok(H[1]), ok(H[2]), { outcome: 'undecodable' }]).decision).toBe('photoFailed')
  })

  it('the size floor refuses slivers and avatar crops the default (muaban) floor would pass — and keeps small real photos', () => {
    const photo = { entropy: 7.2, flat: 0.2 }
    expect(imageVerdict({ ...photo, width: 1024, height: 768 }, NHATOT_PHOTO_FLOOR)).toBe('ok')
    expect(imageVerdict({ ...photo, width: 575, height: 1024 }, NHATOT_PHOTO_FLOOR)).toBe('ok')
    expect(imageVerdict({ ...photo, width: 304, height: 313 }, NHATOT_PHOTO_FLOOR)).toBe('ok')   // nhatot:133643964's real shopfront, measured
    expect(imageVerdict({ ...photo, width: 232, height: 504 }, NHATOT_PHOTO_FLOOR)).toBe('tooSmall')
    expect(imageVerdict({ ...photo, width: 232, height: 504 })).toBe('ok')
    expect(imageVerdict({ ...photo, width: 280, height: 280 }, NHATOT_PHOTO_FLOOR)).toBe('tooSmall')
  })
})

describe('rank — postedAt is the SOURCE’s own date, never "now" (review round 2)', () => {
  it('⛔ postedAt is list_time, clamped so it is never in the future', () => {
    const m = mapped({ list_time: NOW - 5 * 86_400_000 })
    expect(m.ok && m.row.postedAt.getTime()).toBe(NOW - 5 * 86_400_000)
    const future = mapped({ list_time: NOW + 3 * 86_400_000 })
    expect(future.ok && future.row.postedAt.getTime()).toBe(NOW)
    expect(nhatotPostedAt(null, NOW)).toBeNull()
    expect(nhatotPostedAt(Number.NaN, NOW)).toBeNull()
    expect(nhatotPostedAt(0, NOW)).toBeNull()
  })

  it('⛔ the starting rankScore is browseRankScore at the source date — an old ad starts lower than a fresh one', () => {
    const fresh = mapped({ list_time: NOW - 60_000 }), old = mapped({ list_time: NOW - 20 * 86_400_000 })
    if (!fresh.ok || !old.ok) throw new Error('both rows should map')
    const rFresh = nhatotStartingRank(fresh.row.postedAt, 100, NOW), rOld = nhatotStartingRank(old.row.postedAt, 100, NOW)
    expect(rOld).toBeLessThan(rFresh)
    expect(rOld).toBeCloseTo(browseRankScore({ sellerTrustScore: 100, postedAt: new Date(NOW - 20 * 86_400_000), featured: false }, NOW), 12)
    /** …and NOT the import-time score every row used to get. */
    expect(rOld).toBeLessThan(browseRankScore({ sellerTrustScore: 100, postedAt: new Date(NOW), featured: false }, NOW) - 0.1)
    /** A future-dated ad cannot outrank one posted this second. */
    const future = mapped({ list_time: NOW + 86_400_000 })
    expect(future.ok && nhatotStartingRank(future.row.postedAt, 100, NOW)).toBeCloseTo(nhatotStartingRank(new Date(NOW), 100, NOW), 12)
  })
})

describe('verify-nhatot-import — the per-row audit over a row as the importer stores it', () => {
  const url = (hash: string) => `https://sb.eno.vn/storage/v1/object/public/listings/${overlayImagePath('nhatot-134859113', { cover: 'dark', contain: 'dark' }, 1024, 768, hash, 'mf', 'x1')}`
  const HASHES = ['0000000000000000', 'ffffffffffffffff', '0f0f0f0f0f0f0f0f']
  const stored = (over: Partial<VerifyRow> = {}): VerifyRow => {
    const m = mapped({ list_time: NOW - 2 * 86_400_000 })
    if (!m.ok) throw new Error('row should map')
    const createdAt = new Date(NOW)
    return {
      ...m.row.mutable, images: JSON.stringify(HASHES.map(url)),
      rankScore: nhatotStartingRank(m.row.postedAt, 100, NOW), postedAt: m.row.postedAt, createdAt, ...over,
    }
  }
  it('a row exactly as the importer writes it passes every check', () => {
    expect(checkRow(stored(), NHATOT_MIN_PHOTOS)).toEqual({ failed: [], door: null })
  })
  it('⛔ fails what round 2 fixed: the old city spelling, a door number, too few distinct photos, a future or import-time postedAt', () => {
    expect(checkRow(stored({ city: 'Ho Chi Minh' }), 3).failed).toEqual(['badCity'])
    const door = checkRow(stored({ description: `${stored().description}\nStreet: Phố Huế 102` }), 3)
    expect(door.failed).toEqual(['doorNumber'])
    expect(door.door).toMatch(/Phố Huế 102/)
    expect(checkRow(stored({ images: JSON.stringify([url(HASHES[0]), url(HASHES[0]), url(HASHES[1])]) }), 3).failed).toEqual(['fewPhotos'])
    expect(checkRow(stored({ postedAt: new Date(NOW + 3_600_000) }), 3).failed).toEqual(['futurePost'])
    expect(checkRow(stored({ postedAt: new Date(NOW) }), 3).failed).toEqual(['importTimePost'])
    expect(checkRow(stored({ images: JSON.stringify(['https://cdn.chotot.com/x/preset:view/plain/a.jpg']) }), 3).failed).toEqual(['badImages', 'hotlinks'])
  })
  it('checkRow fails a stored row with a slash door on the ward line', () => {
    const bad = checkRow(stored({ description: `${stored().description}\nWard: Phường 506/35` }), 3)
    expect(bad.failed).toEqual(['doorNumber'])
    expect(bad.door).toMatch(/506\/35/)
  })
  it('the verify script refuses to report on a seller with no ACTIVE row (every check reads active rows)', () => {
    expect(readFileSync('scripts/verify-nhatot-import.ts', 'utf8')).toMatch(/else if \(active === 0\) vacuous = /)
  })
  it('checkRow fails a stored row whose Building line carries a number', () => {
    const bad = checkRow(stored({ description: `${stored().description}\nBuilding: Chung cư 12 Lê Lợi` }), 3)
    expect(bad.failed).toEqual(['doorNumber'])
    expect(bad.door).toMatch(/12 Lê Lợi/)
  })
})

describe('nhatotRobotsAllows — the runtime robots.txt check', () => {
  /** Shaped like www.nhatot.com/robots.txt on 2026-09-24. */
  const NHATOT_ROBOTS = [
    'User-agent: *',
    'Content-Signal: search=yes, ai-input=yes, ai-train=no',
    'Allow: /',
    'Sitemap: https://www.nhatot.com/sitemap-index.xml',
    'Disallow: /user/',
    'Disallow: /*o=',
    'Disallow: /*chatroom*',
    '',
    'User-agent: GPTBot',
    'User-agent: ClaudeBot',
    'User-agent: anthropic-ai',
    'Disallow: /',
  ].join('\n')
  it('the * group applies to our token; a non-rule line does not end it', () => {
    expect(nhatotRobotsAllows(NHATOT_ROBOTS, NHATOT_UA_TOKEN, '/')).toBe(true)
    expect(nhatotRobotsAllows(NHATOT_ROBOTS, NHATOT_UA_TOKEN, '/134859113.htm')).toBe(true)
    expect(nhatotRobotsAllows(NHATOT_ROBOTS, NHATOT_UA_TOKEN, '/user/42')).toBe(false)
    expect(nhatotRobotsAllows(NHATOT_ROBOTS, NHATOT_UA_TOKEN, '/thue-can-ho?o=20')).toBe(false)   // longest match beats "Allow: /"
  })
  it('a group naming a token applies to it alone', () => {
    expect(nhatotRobotsAllows(NHATOT_ROBOTS, 'ClaudeBot', '/')).toBe(false)
    expect(nhatotRobotsAllows(NHATOT_ROBOTS, 'gptbot', '/134859113.htm')).toBe(false)
    const mine = `User-agent: *\nAllow: /\n\nUser-agent: ${NHATOT_UA_TOKEN}\nDisallow: /v1/\n`
    expect(nhatotRobotsAllows(mine, NHATOT_UA_TOKEN, '/v1/public/ad-listing?cg=1010')).toBe(false)
    expect(nhatotRobotsAllows(mine, 'somebot', '/v1/public/ad-listing')).toBe(true)
  })
  it('allow-all file, empty Disallow, "$" anchors, no applicable group', () => {
    expect(nhatotRobotsAllows('User-agent: *\nAllow: /\n', NHATOT_UA_TOKEN, '/anything')).toBe(true)   // cdn.chotot.com
    expect(nhatotRobotsAllows('User-agent: *\nDisallow:\n', NHATOT_UA_TOKEN, '/x')).toBe(true)
    expect(nhatotRobotsAllows('User-agent: *\nDisallow: /*.jpg$\n', NHATOT_UA_TOKEN, '/a.jpg')).toBe(false)
    expect(nhatotRobotsAllows('User-agent: *\nDisallow: /*.jpg$\n', NHATOT_UA_TOKEN, '/a.jpg?x=1')).toBe(true)
    expect(nhatotRobotsAllows('User-agent: otherbot\nDisallow: /\n', NHATOT_UA_TOKEN, '/')).toBe(true)
    expect(nhatotRobotsAllows('User-agent: *\nDisallow: /\n', NHATOT_UA_TOKEN, '/v1/public/ad-listing')).toBe(false)
  })
})

describe('liveness — the --retire pass, from a positive signal only', () => {
  /** A detail answer with the poster on it, as the gateway sends it (made-up person). */
  const body = (over: Record<string, unknown> = {}) => ({
    ad: { list_id: 134859113, status: 'active', phone: '0909123456', account_name: 'NGUYỄN VĂN MẪU', body: 'gọi 0909123456', ...over },
    ad_params: { address: { value: '506/35 Lạc Long Quân' } },
  })
  it('404 "entity not found" and 410 are gone; the gateway’s OTHER 404 (a moved route) is NOT', () => {
    expect(classifyNhatotLiveness(1000000001, 404, { message: 'entity not found - no ad found for list id 1000000001' }).verdict).toBe('gone')
    expect(classifyNhatotLiveness(1, 410, null).verdict).toBe('gone')
    expect(classifyNhatotLiveness(1, 404, { message: 'no Route matched with those values' }).verdict).toBe('unknown')
    expect(classifyNhatotLiveness(1, 404, null).verdict).toBe('unknown')
  })
  it('200 active is live; any other status word is inactive; a mismatched id or a 5xx is unknown', () => {
    expect(classifyNhatotLiveness(134859113, 200, body())).toEqual({ list_id: 134859113, verdict: 'live', http: 200, status: 'active' })
    expect(classifyNhatotLiveness(134859113, 200, body({ status: 'hidden' })).verdict).toBe('inactive')
    expect(classifyNhatotLiveness(134859113, 200, body({ status: 'deleted' })).status).toBe('deleted')
    expect(classifyNhatotLiveness(134859113, 200, body({ list_id: 5 })).verdict).toBe('unknown')
    expect(classifyNhatotLiveness(134859113, 200, body({ status: '' })).verdict).toBe('unknown')
    expect(classifyNhatotLiveness(134859113, 502, body()).verdict).toBe('unknown')
  })
  it('⛔ nothing from the body but list_id and status is kept — no phone, no name, no address', () => {
    for (const st of ['active', 'hidden']) {
      const r = classifyNhatotLiveness(134859113, 200, body({ status: st }))
      expect(Object.keys(r).sort()).toEqual(['http', 'list_id', 'status', 'verdict'])
      expect(JSON.stringify(r)).not.toMatch(/0909|MẪU|Mẫu|506|phone|account/)
    }
  })
  it('a status file record is re-whitelisted on read, and a verdict must match its evidence', () => {
    const ok = { list_id: 7, verdict: 'gone', http: 404, status: null }
    expect(stageNhatotLiveness({ ...ok, phone: '0909123456' })).toEqual(ok)
    expect(stageNhatotLiveness({ ...ok, http: 200 })).toBeNull()   // a hand-set 'gone' on a 200
    expect(stageNhatotLiveness({ list_id: 7, verdict: 'inactive', http: 200, status: 'active' })).toBeNull()
    expect(stageNhatotLiveness({ ...ok, verdict: 'dead' })).toBeNull()
    expect(stageNhatotLiveness({ ...ok, list_id: '7' })).toBeNull()
  })
  it('retires on gone/inactive only', () => {
    expect(nhatotShouldRetire({ list_id: 1, verdict: 'gone', http: 404, status: null })).toBe(true)
    expect(nhatotShouldRetire({ list_id: 1, verdict: 'inactive', http: 200, status: 'hidden' })).toBe(true)
    expect(nhatotShouldRetire({ list_id: 1, verdict: 'unknown', http: 500, status: null })).toBe(false)
    expect(nhatotShouldRetire({ list_id: 1, verdict: 'live', http: 200, status: 'active' })).toBe(false)
  })
  it('externalId → list_id', () => {
    expect(nhatotListIdOf('nhatot:134859113')).toBe(134859113)
    expect(nhatotListIdOf('bds:134859113')).toBeNull()
    expect(nhatotListIdOf('nhatot:0')).toBeNull()
    expect(nhatotListIdOf(null)).toBeNull()
  })
})

describe('--cap: the newest N per city across categories', () => {
  type Ad = { list_id: number; list_time: number | null }
  const lists: Record<string, Ad[]> = {
    a: [100, 90, 50, 10].map((t) => ({ list_id: t, list_time: t })),
    b: [95, 94, 93, 5].map((t) => ({ list_id: 1000 + t, list_time: t })),
    c: [20, 1].map((t) => ({ list_id: 2000 + t, list_time: t })),
  }
  const fetcher = (calls: string[], pageMax: number) => async (k: string, o: number, limit: number) => {
    calls.push(`${k}@${o}`)
    const ads = lists[k].slice(o, o + Math.min(limit, pageMax))
    return { ads, total: lists[k].length }
  }
  it('merges newest-first and reads only the pages the merge needs', async () => {
    const calls: string[] = []
    const r = await readNewestAcross(['a', 'b', 'c'], 5, fetcher(calls, 2), 2)
    expect(r.picked.map((x) => x.list_time)).toEqual([100, 95, 94, 93, 90])
    expect(r.error).toBeNull()
    expect(calls).not.toContain('c@2')   // c's second page is never needed
  })
  it('stops cleanly on a thrown stop and keeps what it had', async () => {
    let n = 0
    const r = await readNewestAcross(['a', 'b'], 10, async (k, o, limit) => {
      if (++n > 2) throw new Error('HTTP 429')
      return { ads: lists[k].slice(o, o + Math.min(limit, 2)), total: lists[k].length }
    }, 2)
    expect((r.error as Error).message).toBe('HTTP 429')
    expect(r.picked.length).toBeGreaterThan(0)
  })
  it('a page whose rows were all dropped while staging still advances the offset', async () => {
    const r = await readNewestAcross(['x'], 2, async (_k, o) => (
      o === 0 ? { ads: [], total: 4, consumed: 2 } : { ads: [{ list_id: o, list_time: 10 - o }], total: 4, consumed: 1 }
    ), 2)
    expect(r.picked.map((x) => x.list_id)).toEqual([2, 3])
  })
  it('parses caps strictly', () => {
    expect(parseNhatotCaps('hcm=3000,hn=1500,dn=1500')).toEqual({ hcm: 3000, hn: 1500, dn: 1500 })
    expect(parseNhatotCaps(null)).toEqual({})
    // An inherited key is not a city: `'constructor' in NHATOT_CITIES` is true, Object.hasOwn is not.
    expect(() => parseNhatotCaps('constructor=5')).toThrow(/cannot read/)
    expect(() => parseNhatotCaps('hcm=3k')).toThrow()
    expect(() => parseNhatotCaps('sg=10')).toThrow()
    expect(() => parseNhatotCaps('hcm=0')).toThrow()
  })
})

/**
 * ⛔ `--cap hcm=3000` ALONE CRAWLED HÀ NỘI AND ĐÀ NẴNG IN FULL. All three cities are the default, and
 * a city with no cap is read the uncapped way; the integrator's review (Opus) caught it. A cap run
 * must cap every city it reads, and cap nothing it does not read.
 */
describe('nhatotCapsProblem', () => {
  it('refuses a cap that leaves a read city uncapped', () => {
    expect(nhatotCapsProblem(['hcm', 'hn', 'dn'], { hcm: 3000 })).toMatch(/also reads hn, dn.*--city hcm/)
  })
  it('refuses a cap on a city --city leaves out', () => {
    expect(nhatotCapsProblem(['hcm'], { hcm: 3000, hn: 100 })).toMatch(/names hn, which --city leaves out/)
  })
  it('accepts a cap on exactly the cities read, and no cap at all', () => {
    expect(nhatotCapsProblem(['hcm'], { hcm: 3000 })).toBeNull()
    expect(nhatotCapsProblem(['hcm', 'hn', 'dn'], { hcm: 3000, hn: 1500, dn: 1500 })).toBeNull()
    expect(nhatotCapsProblem(['hcm', 'hn', 'dn'], {})).toBeNull()
  })
})

/**
 * ⛔ A PAGE WITHOUT `total` ENDED THE SLICE AFTER 50 ADS, AND THE RUN STILL SAID "complete". The
 * missing total was read as 0. It is "unknown": read on to an empty page or the gateway's 10,000 cap.
 */
describe('nhatotSliceEnd', () => {
  it('a missing total reads on until the gateway cap', () => {
    expect(nhatotSliceEnd(50, null)).toBe(false)
    expect(nhatotSliceEnd(NHATOT_TOTAL_CAP - 1, null)).toBe(false)
    expect(nhatotSliceEnd(NHATOT_TOTAL_CAP, null)).toBe(true)
  })
  it('a known total ends the slice at the total, or at the cap when the total is past it', () => {
    expect(nhatotSliceEnd(50, 50)).toBe(true)
    expect(nhatotSliceEnd(50, 3000)).toBe(false)
    expect(nhatotSliceEnd(NHATOT_TOTAL_CAP, 25_000)).toBe(true)
    expect(nhatotSliceEnd(0, 0)).toBe(true)
  })
})

/**
 * ⛔ AN AD WITHOUT THE POST-2025 WARD SAID "Former ward: Phường 9" AND NAMED NO WARD. `ward_name_v3`
 * is the new ward; with it missing, `ward_name` is the only ward and must read as the ward (agy,
 * integrator review). 0 of 330 real ads lacked it on 2026-09-24, so this is the guard, not a fix seen live.
 */
describe('mapNhatotAd — the ward facts', () => {
  const facts = (over: Partial<NhatotStagedAd>) => {
    const m = mapped(over)
    if (!m.ok) throw new Error(`dropped: ${m.reason}`)
    return { en: m.row.mutable.description, vi: m.row.mutable.descriptionVi }
  }
  it('no new ward: the old one is THE ward, never "former"', () => {
    const { en, vi } = facts({ ward_name: 'Phường 9', ward_name_v3: null })
    expect(en).toMatch(/^Ward: Phường 9$/m)
    expect(en).not.toMatch(/Former ward/)
    expect(vi).toMatch(/^Phường\/xã: Phường 9$/m)
    expect(vi).not.toMatch(/Phường cũ/)
  })
  it('a renamed ward: the new one is the ward, the old one is former', () => {
    const { en, vi } = facts({ ward_name: 'Phường 12', ward_name_v3: 'Phường Bình Thạnh' })
    expect(en).toMatch(/^Ward: Phường Bình Thạnh$/m)
    expect(en).toMatch(/^Former ward: Phường 12$/m)
    expect(vi).toMatch(/^Phường cũ: Phường 12$/m)
  })
  it('an unchanged ward is not repeated as former', () => {
    const { en } = facts({ ward_name: 'Phường Bình Thạnh', ward_name_v3: 'Phường Bình Thạnh' })
    expect(en).toMatch(/^Ward: Phường Bình Thạnh$/m)
    expect(en).not.toMatch(/Former ward/)
  })
})

describe('nhatotRunReadsNetwork — when the publisher’s robots.txt must be read', () => {
  it('a live read, an apply and a photo probe all touch the network; a plain replay does not', () => {
    expect(nhatotRunReadsNetwork({ src: false, apply: false, probePhotos: false })).toBe(true)
    expect(nhatotRunReadsNetwork({ src: true, apply: true, probePhotos: false })).toBe(true)
    expect(nhatotRunReadsNetwork({ src: true, apply: false, probePhotos: true })).toBe(true)
    expect(nhatotRunReadsNetwork({ src: true, apply: false, probePhotos: false })).toBe(false)
  })
})

describe('nhatotApplyExitCode', () => {
  it('a stop is 2, an errored row or a failed upload is 1, a clean batch is 0', () => {
    expect(nhatotApplyExitCode({ errored: 0, uploadFailed: 0 }, 'HTTP 429')).toBe(2)
    expect(nhatotApplyExitCode({ errored: 3, uploadFailed: 0 }, null)).toBe(1)
    expect(nhatotApplyExitCode({ errored: 0, uploadFailed: 5 }, null)).toBe(1)
    expect(nhatotApplyExitCode({ errored: 0, uploadFailed: 0 }, null)).toBe(0)
  })
})

/**
 * ⛔ THE BUILDING LINE IS PUBLISHED TOO, AND GETS THE STREET'S CONTRACT. `pty_project_name` reaches
 * "Building:" / "Dự án:" and searchText. A door number cannot be told from a building number, so a
 * value with any digit, an alley word in any tone, or a non-Latin letter is dropped whole (review
 * rounds found '129/35', '76 Nguyễn Xí', 'Chung cư 12 Lê Lợi', 'Toà nhà số 12' in turn).
 */
describe('nhatotProjectName', () => {
  it('drops any digit, alley word (any tone) or look-alike letter', () => {
    for (const v of ['Chung cư 129/35 Lê Đình Cẩn', 'Hẻm Tower', 'Nhà hẽm Lê Lợi', 'Kiệt Trần Đình Tri', '76 Nguyễn Xí', 'Chung cư 12 Lê Lợi', 'Toà nhà số 12', 'Sky 89 An Gia', 'Q7 Boulevard', 'Tháp Ⅻ', 'Hеm Tower', 'x'.repeat(81)]) {
      expect(nhatotProjectName(v), v).toBeNull()
    }
  })
  it('keeps a plain name', () => {
    for (const v of ['Vinhomes Central Park', 'The Sun Avenue', 'Chung cư Ngô Quyền', 'Diamond Riverside (City Gate Towers)']) {
      expect(nhatotProjectName(v), v).toBe(v)
    }
    expect(nhatotProjectName('  ')).toBeNull()
    expect(nhatotProjectName(null)).toBeNull()
  })
  it('the staged file never holds a dropped name (stageNhatotAd applies it too)', () => {
    expect(stageNhatotAd({ ...RAW, pty_project_name: 'Chung cư 12 Lê Lợi' })?.pty_project_name).toBeNull()
    expect(stageNhatotAd({ ...RAW, pty_project_name: 'Vinhomes Central Park' })?.pty_project_name).toBe('Vinhomes Central Park')
  })
  it('the mapper publishes the guarded name only', () => {
    const m = mapped({ pty_project_name: 'Chung cư 129/35 Lê Đình Cẩn' })
    if (!m.ok) throw new Error(m.reason)
    expect(m.row.mutable.description).not.toMatch(/129\/35|Building:/)
    expect(m.row.mutable.descriptionVi).not.toMatch(/129\/35|Dự án:/)
    expect(m.row.mutable.searchText).not.toMatch(/129\/35/)
  })
})

describe('the verify script, independently of the importer', () => {
  it('fails a Building / Dự án line with a digit, an alley word in any tone, or a look-alike letter', () => {
    expect(projectLineProblems('Tin…\n\nBuilding: Chung cư 12 Lê Lợi')).toHaveLength(1)
    expect(projectLineProblems('Tin…\n\nDự án: Nhà hẽm Lê Lợi')).toHaveLength(1)
    expect(projectLineProblems('Tin…\n\nDự án: Ngỏ Láng Hạ')).toHaveLength(1)
    expect(projectValueProblem('Hеm Tower')).toMatch(/non-Latin|alley/)
    expect(projectLineProblems('Tin…\n\nBuilding: Vinhomes Central Park\nDự án: Chung cư Ngô Quyền')).toEqual([])
  })
  it('agrees with the importer on every name it keeps', () => {
    for (const v of ['Vinhomes Central Park', 'The Sun Avenue', 'Chung cư Ngô Quyền', 'Diamond Riverside (City Gate Towers)']) {
      expect(nhatotProjectName(v)).toBe(v)
      expect(projectValueProblem(v), v).toBeNull()
    }
  })
})

/**
 * ⛔ AFTER A 429, NOTHING ON THAT HOST IS REQUESTED AGAIN. The logo probe swallowed the stop and the
 * fallback logo then knocked on the same host (Opus, integrator review). The importer halts a host on
 * a 429 or a challenge, and only those: a robots.txt 404 is often an HTML page and means "no rules".
 */
describe('nhatotHostHalt', () => {
  it('halts on a 429 or a challenge, never on a 404 page or a normal answer', () => {
    expect(nhatotHostHalt(429, null)).toMatch(/429/)
    expect(nhatotHostHalt(403, 'challenge')).toMatch(/challenge/)
    expect(nhatotHostHalt(404, null)).toBeNull()
    expect(nhatotHostHalt(200, null)).toBeNull()
  })
})

/**
 * ⛔ THE ENGLISH BLOCK IS ENGLISH. It printed Chợ Tốt's Vietnamese `kind_label` ('Type: Căn hộ dịch
 * vụ, mini') and any unmapped furnishing label verbatim (Opus, integrator review). And an office or
 * shopfront title does not count toilets as baths.
 */
describe('mapNhatotAd — the English facts', () => {
  const en = (over: Partial<NhatotStagedAd>) => {
    const m = mapped(over)
    if (!m.ok) throw new Error(`dropped: ${m.reason}`)
    return m.row.mutable
  }
  it('translates the kind label, and falls back to the category kind, never to Vietnamese', () => {
    expect(en({ kind_label: 'Căn hộ dịch vụ, mini' }).description).toMatch(/^Type: Serviced \/ mini apartment$/m)
    expect(en({ kind_label: 'Một loại mới' }).description).toMatch(/^Type: Apartment$/m)
    expect(en({ kind_label: 'Chung cư' }).descriptionVi).toMatch(/^Loại hình: Chung cư$/m)
  })
  it('leaves an unmapped furnishing label out of the English block', () => {
    const r = en({ furnishing_label: 'Nội thất kiểu mới' })
    expect(r.description).not.toMatch(/Furnishing:|Nội thất/)
    expect(r.descriptionVi).toMatch(/^Nội thất: Nội thất kiểu mới$/m)
  })
  it('an office title counts no baths; a home title does', () => {
    expect(en({ category: 1030, toilets: 2 }).title).not.toMatch(/bath/)
    expect(en({ category: 1010, toilets: 2 }).title).toMatch(/2 bath/)
  })
})

/**
 * ⛔ NO SOURCE VALUE MAY FORGE A FACT LINE OR CARRY A DOOR ON THE WARD / DISTRICT LINES. Staged strings
 * are one line, and a ward or district with a '506/35' is dropped (Opus, integrator review). The
 * verify script checks every fact line but the street's for a slash door, independently.
 */
describe('ward and district values', () => {
  it('a newline cannot forge a "Street:" line, and a slash door drops the ward', () => {
    const forged = stageNhatotAd({ ...RAW, ward_name: 'Phường Bàn Cờ\nStreet: Lê Lợi' })
    expect(forged?.ward_name).toBe('Phường Bàn Cờ Street: Lê Lợi')
    // Every ad reaches the mapper through stageNhatotAd (a live read, and readStaged re-stages a file).
    const m = mapNhatotAd(stageNhatotAd({ ...RAW, ward_name: 'Phường Bàn Cờ\nStreet: Lê Lợi', ward_name_v3: null })!, OPTS)
    expect(m.ok && m.row.mutable.description.match(/^Street: /gm)?.length).toBe(1)
    expect(stageNhatotAd({ ...RAW, ward_name_v3: 'Phường 506/35' })?.ward_name_v3).toBeNull()
    expect(stageNhatotAd({ ...RAW, area_name: 'Quận 3 506/35' })?.area_name).toBeNull()
    expect(stageNhatotAd({ ...RAW, ward_name: 'Phường 12' })?.ward_name).toBe('Phường 12')
  })
  it('the verify script flags a slash door on any fact line but the street', () => {
    expect(slashDoorLineProblems('Ward: Phường 506/35\nRent: 8,500,000 đ/month')).toHaveLength(1)
    expect(slashDoorLineProblems('Street: Đường 3/2\nWard: Phường 12\nRent: 8,500,000 đ/month')).toEqual([])
    expect(streetValueProblem('Sn Lê Lợi')).toMatch(/alley/)
  })
})

describe('ids and liveness evidence the retire pass can act on', () => {
  it('a list_id wider than the URL and externalId patterns is not staged', () => {
    expect(stageNhatotAd({ ...RAW, list_id: NHATOT_LIST_ID_MAX })?.list_id).toBe(NHATOT_LIST_ID_MAX)
    expect(stageNhatotAd({ ...RAW, list_id: NHATOT_LIST_ID_MAX + 1 })).toBeNull()
    expect(stageNhatotLiveness({ list_id: NHATOT_LIST_ID_MAX + 1, verdict: 'gone', http: 404 })).toBeNull()
  })
  it('a "live" verdict must carry live evidence (200, active); "unknown" retires nothing either way', () => {
    expect(stageNhatotLiveness({ list_id: 7, verdict: 'live', http: 404, status: null })).toBeNull()
    expect(stageNhatotLiveness({ list_id: 7, verdict: 'live', http: 200, status: 'active' })?.verdict).toBe('live')
    expect(stageNhatotLiveness({ list_id: 7, verdict: 'unknown', http: 500, status: null })?.verdict).toBe('unknown')
  })
})
