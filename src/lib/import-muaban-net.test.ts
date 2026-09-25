import { describe, expect, it, vi } from 'vitest'
import vnUnits from '@/data/vn-units.json'
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import { listingMoneyFor } from '@/lib/taxonomy'
import { matchesProvince } from '@/lib/facet-counts'
import { browseRankScore } from '@/lib/ranking-formula'
import * as sharedPhotoCheck from '@/lib/import-photo-check'
import { localizeImportText } from '@/lib/import-i18n'
import { fold } from '@/lib/fold'
import {
  CITIES, IMAGE_RE, MAX_IMAGES, MAX_STAGE_AGE_HOURS, MIN_DELAY_MS, MIN_SOURCE_POSTED_AT, SELLER_ID, SELLER_NAME,
  adminOnly, affiliateUrlFor, bedroomsAttribute, canonicalDistrict, canonicalWard, compareNewest, countFrom, coverToDetail,
  createOnlyFields, flatnessOf, galleryPlan, imageUrls, imageVerdict, isAdminPart, isChallenge, journalDirProblem, listPageUrl,
  livenessVerdict, locationIsSafe, locationParts, mapRecord, massRetireRefusal, modeRefusal, newestHead, numArg,
  oldestStageAgeHours, parseAreaM2, parseCaps, parseCities, parseDisplayVnd, parseLatLng, parseRunArgs, parseStage, parseTypes,
  postedAtProblem, priceDrop, restageRecord, retireRollbackSql, robotsAllows, robotsRules, sameMutable, sellerRefusal,
  sourcePageUrl, sourcePostedAt, stageAgeRefusal, stageDetail, stageItem, type MuabanDetail, type MuabanListItem,
} from '../../scripts/muaban-net-map'

/** facet-counts.ts is imported ONLY for `matchesProvince`, the documented mirror of the province
 *  predicate in feed-query.ts; its database handle is never touched here. */
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w, DeskResolutionError: class extends Error {} }))

/**
 * The PURE mapping of scripts/import-muaban-net.ts: muaban.net JSON → the row eno would store.
 * Every fixture below is a real record read from muaban.net on 2026-09-24 (list card + detail page
 * of id 70946042), trimmed; the PII fields are included ON PURPOSE so the strip can be asserted.
 */
const CARD = {
  id: 70946042, user_id: 1872568, city_id: 30, district_id: 380, category_id: 33, subcategory_id: 46,
  category_name: 'Nhà mặt tiền', property_type: 2811, property_subtype: 2528,
  title: 'Cho thuê nhà mặt tiền kinh doanh Lũy Bán Bích, Phường Phú Thọ Hòa, HCM',
  covers: [
    'https://cloud.muaban.net/images/thumb-md/2026/06/03/557/743223b5aeee4ce3b97ff602f80feac7.jpg',
    'https://cloud.muaban.net/images/thumb-sm/2026/06/03/558/58a8eb1d6eeb4324896ebcf3955fac2a.jpg',
    'https://cloud.muaban.net/images/thumb-sm/2026/06/03/557/47f7c9080acc4c76a877aadeb8744b91.jpg',
  ],
  total_images: 3, price: 25000000, price_display: '25 triệu/tháng',
  url: '/bat-dong-san/nha-mat-tien-quan-tan-phu-ho-chi-minh/cho-thue-nha-mat-tien-kinh-doanh-luy-ban-bich-phuong-phu-tho-hoa-hcm-id70946042',
  publish_at: '2026-09-24T00:00:02.118+07:00', location: 'Phường Tân Thành, Quận Tân Phú',
  is_company: false, phone_display: '090 288 ****', phone_enc: 'pnxGgb4D9Qpe+zXi16377d7pWAtI5YgIJebUMNTBRZNJaMmArtSooYVE1z9a/o+P',
  attributes: [{ value: '89 m²' }],
  summary: 'CHO THUÊ NHÀ NGUYÊN CĂN MẶT TIỀN LŨY BÁN BÍCH …',
  is_expired: false,
  locations_display: [
    { id: 11161, name: 'Phường Tân Thành', url: '/x' },
    { id: 380, name: 'Quận Tân Phú', url: '/y' },
    { id: 30, name: 'TP.HCM', url: '/z' },
  ],
}
const DETAIL = {
  id: 70946042, category_id: 33, subcategory_id: 46, city_id: 30, district_id: 380, ward_id: 11161,
  url: CARD.url, title: CARD.title, body: 'Địa chỉ: 867 Lũy Bán Bích …', address: '867, Đường Lũy Bán Bích, Phường Tân Thành, Quận Tân Phú, TP.HCM',
  phone_display: '090 288 ****', phone_enc: 'x', contact_name: 'Chị Vân', user_id: 1872568,
  images: [
    { id: 182399799, url: 'https://cloud.muaban.net/images/thumb-detail/2026/06/03/557/743223b5aeee4ce3b97ff602f80feac7.jpg', thumb_url: 'x' },
    { id: 182399801, url: 'https://cloud.muaban.net/images/thumb-detail/2026/06/03/558/58a8eb1d6eeb4324896ebcf3955fac2a.jpg', thumb_url: 'x' },
    { id: 182399800, url: 'https://cloud.muaban.net/images/thumb-detail/2026/06/03/557/47f7c9080acc4c76a877aadeb8744b91.jpg', thumb_url: 'x' },
  ],
  price: 25000000, price_display: '25 triệu/tháng', property_type: 2811, property_subtype: 2528,
  publish: true, is_expired: false, is_outdate: false, lat_lng: '', location: 'Phường Tân Thành, Quận Tân Phú',
  created_at: '2026-06-02T15:35:52.304754+07:00',
  attributes: [{ value: '89 m²' }],
  parameters: [
    { label: 'Loại hình bất động sản', value: 'Nhà mặt tiền', group: false },
    { label: 'Diện tích đất', value: '89 m² (4.3x21.0)', group: false },
    { label: 'Tổng số tầng', value: '1', group: false },
    { label: 'Điểm nổi bật', value: '<ul><li>Mặt tiền</li></ul>', group: true },
  ],
  merge_address: '867, Đường Lũy Bán Bích, Phường Phú Thọ Hòa, TP.HCM',
}
const ALL = { cities: parseCities(null), types: parseTypes(null) }
/** The id-only outbound link for the fixture: muaban's category segment + the id, no title slug. */
const LINK = 'https://muaban.net/bat-dong-san/nha-mat-tien-quan-tan-phu-ho-chi-minh/id70946042'
const card = (over: Partial<MuabanListItem> = {}): MuabanListItem => ({ ...stageItem(CARD), ...over })
const detail = (over: Partial<MuabanDetail> = {}): MuabanDetail => ({ ...stageDetail(DETAIL), ...over })
const HN_CARD = { city_id: 24, locations_display: [{ id: 3906, name: 'Phường Đội Cấn' }, { id: 289, name: 'Quận Ba Đình' }, { id: 24, name: 'Hà Nội' }] }
const DN_CARD = { city_id: 15, locations_display: [{ id: 1, name: 'Phường An Hải Bắc' }, { id: 2, name: 'Quận Sơn Trà' }, { id: 15, name: 'Đà Nẵng' }] }
const mapped = (c: MuabanListItem, d: MuabanDetail | null = detail()) => {
  const m = mapRecord(c, d, ALL)
  if (!m.ok) throw new Error(`fixture dropped: ${m.reason}`)
  return m.row.mutable
}

describe('stageItem / stageDetail — ⛔ the PII strip happens before anything reaches disk', () => {
  it('keeps no phone, encrypted phone, contact name, user id, body, street address or free text', () => {
    const staged = JSON.stringify([stageItem(CARD), stageDetail(DETAIL)])
    for (const leaked of ['090 288', 'pnxGgb4D9Qpe', 'Chị Vân', '1872568', '867', 'Lũy Bán Bích', 'CHO THUÊ NHÀ NGUYÊN CĂN']) {
      expect(staged).not.toContain(leaked)
    }
    // ⛔ nor the title's SLUGIFIED copy: the canonical url's last segment is the free-text title
    expect(staged).not.toContain('luy-ban-bich')
    expect(stageItem(CARD).url).toBe(LINK)
    expect(stageDetail(DETAIL).url).toBe(LINK)
    expect(stageDetail(DETAIL)).not.toHaveProperty('contact_name')
    expect(stageItem(CARD)).not.toHaveProperty('phone_display')
  })

  it('keeps allowlisted parameters only, and never a group (HTML) parameter', () => {
    expect(stageDetail(DETAIL).parameters).toEqual([
      { label: 'Loại hình bất động sản', value: 'Nhà mặt tiền' },
      { label: 'Diện tích đất', value: '89 m² (4.3x21.0)' },
      { label: 'Tổng số tầng', value: '1' },
    ])
  })

  it('⛔ reduces a location string to ward/district/city, so a typed street address is never staged', () => {
    expect(stageItem({ ...CARD, location: '867 Lũy Bán Bích, Phường Tân Thành, Quận Tân Phú' }).location).toBe('Phường Tân Thành, Quận Tân Phú')
    expect(stageDetail({ ...DETAIL, location: 'Số 12 Nguyễn Trãi, Phường 4, Quận 5, TP.HCM' }).location).toBe('Phường 4, Quận 5, TP.HCM')
    expect(stageItem({ ...CARD, locations_display: [{ id: 1, name: '12/3 Hẻm 45' }, ...CARD.locations_display] }).locations_display!.map((l) => l.name))
      .toEqual(['Phường Tân Thành', 'Quận Tân Phú', 'TP.HCM'])
  })
})

describe('--src — ⛔ a staged line goes back through the allowlist on read', () => {
  const line = (over: Record<string, unknown> = {}) => JSON.stringify({
    v: 1, fetchedAt: '2026-09-24T01:00:00.000Z', seed: { city: 'hcm', type: 2811 },
    item: CARD, detail: DETAIL, detailStatus: 200, ...over,
  })

  it('strips PII and unknown fields a hand-edited stage carries', () => {
    const recs = parseStage(`${line({ injected: 'x', operatorNote: '0909123456' })}\n\n`)
    expect(recs).toHaveLength(1)
    const text = JSON.stringify(recs)
    for (const leaked of ['090 288', 'pnxGgb4D9Qpe', 'Chị Vân', '1872568', 'Lũy Bán Bích', '0909123456', 'injected']) {
      expect(text).not.toContain(leaked)
    }
    expect(Object.keys(recs[0]).sort()).toEqual(['detail', 'detailStatus', 'fetchedAt', 'item', 'seed', 'v'])
    expect(mapRecord(recs[0].item, recs[0].detail, ALL).ok).toBe(true)
  })

  it('refuses the whole file on one bad line, naming it', () => {
    expect(() => parseStage(`${line()}\n{not json`)).toThrow(/line 2: not JSON/)
    expect(() => parseStage(line({ v: 2 }))).toThrow(/line 1: not a v1 muaban record/)
    expect(() => parseStage(line({ seed: { city: 'hue', type: 2811 } }))).toThrow(/unknown seed/)
    expect(() => restageRecord({ v: 1, fetchedAt: 'x', seed: { city: 'hcm', type: 2811 }, item: { id: 'abc' } }, 7)).toThrow(/line 7: item has no numeric id/)
    expect(() => parseStage(line({ fetchedAt: 123 }))).toThrow(/no fetchedAt/)
  })
})

describe('mapRecord — the real card + detail page', () => {
  it('produces exactly the reference-listing row the contract requires', () => {
    const m = mapRecord(card(), detail(), ALL)
    expect(m.ok).toBe(true)
    if (!m.ok) return
    expect(m.row.externalId).toBe('muaban:70946042')
    expect(m.row.mutable).toMatchObject({
      price: 25_000_000, priceUnit: 'VND/month', currency: '₫',
      negotiable: false, listingType: 'rent',
      subcategorySlug: 'house-rental',
      city: 'Hồ Chí Minh', district: 'Quận Tân Phú',
      location: 'Phường Tân Thành, Quận Tân Phú, Hồ Chí Minh',
      lat: null, lng: null, areaM2: 89,
      attributes: null,
      affiliateUrl: LINK,
      // ⛔ The English title is English (src/lib/import-i18n.ts); the Vietnamese one keeps the source's place.
      title: 'House · 89 m² for rent — Tân Thành Ward, Tân Phú District',
      titleVi: 'Cho thuê Nhà mặt tiền 89m² — Phường Tân Thành, Quận Tân Phú',
    })
    expect(m.row.mutable.description.startsWith('Listed on Muaban.net. eno links to the original')).toBe(true)
    // English commas on the English rent line; the Vietnamese one keeps its dots.
    expect(m.row.mutable.description).toContain('Rent: 25,000,000 đ/month')
    expect(m.row.mutable.description).toContain('Location: Tân Thành Ward, Tân Phú District, Ho Chi Minh City')
    expect(m.row.mutable.descriptionVi).toContain('Giá thuê: 25.000.000 đ/tháng')
    expect(m.row.mutable.descriptionVi).toContain('Khu vực: Phường Tân Thành, Quận Tân Phú, Hồ Chí Minh')
    expect(m.row.mutable.description).toContain('Floors: 1')
    expect(m.row.mutable.searchText).toContain('tan phu')
    expect(m.row.imageSources).toEqual(DETAIL.images.map((i) => i.url))
    // ⛔ never in the refreshable payload — these are create-only in the importer
    for (const k of ['status', 'verified', 'images', 'rankScore', 'postedAt', 'sellerId']) expect(m.row.mutable).not.toHaveProperty(k)
  })

  it('never copies the free-text title or body into what it stores', () => {
    const m = mapRecord(card(), detail(), ALL)
    expect(JSON.stringify(m)).not.toContain('Lũy Bán Bích')
  })

  it.each([
    ['notRental', card({ subcategory_id: 169 }), detail()],
    ['city', card({ city_id: 13 }), detail()],
    ['type', card({ property_type: 2815 }), detail({ property_type: 2815 })],
    ['detailMismatch', card(), detail({ id: 1 })],
    ['target', card({ url: 'https://evil.example/bat-dong-san/a/b-id70946042' }), detail()],
    ['noPrice', card({ price: 0, price_display: 'Thỏa thuận' }), detail({ price: 0, price_display: 'Thỏa thuận' })],
    ['expired', card(), detail({ is_expired: true })],
    ['expired', card(), detail({ publish: false })],
    ['noImages', card({ covers: [] }), detail({ images: [] })],
    ['location', card({ locations_display: [], location: '' }), detail()],
  ])('drops a %s row', (reason, c, d) => {
    expect(mapRecord(c, d, ALL)).toEqual({ ok: false, reason })
  })

  it('honours --city and --types', () => {
    expect(mapRecord(card(), detail(), { cities: ['hn'], types: ALL.types })).toEqual({ ok: false, reason: 'city' })
    expect(mapRecord(card(), detail(), { cities: ALL.cities, types: [2812] })).toEqual({ ok: false, reason: 'type' })
  })

  it('maps every source type, and warehouse/land to an honest NULL subcategory', () => {
    const sub = (t: number) => {
      const m = mapRecord(card({ property_type: t }), detail({ property_type: t }), { cities: ALL.cities, types: [t] })
      return m.ok ? m.row.mutable.subcategorySlug : m.reason
    }
    expect([2812, 2811, 1614, 2814, 2815].map(sub)).toEqual(['apartment-rental', 'house-rental', 'room-rental', 'office-rental', null])
  })

  it('files serviced / mini apartments (subtype 2531) under apartment-rental, not homestay', () => {
    const m = mapRecord(card({ property_type: 2812, property_subtype: 2531, category_name: 'Căn hộ dịch vụ, mini' }), detail({ property_type: 2812 }), ALL)
    expect(m.ok && m.row.mutable.subcategorySlug).toBe('apartment-rental')
  })

  it('works list-only: covers re-pointed at thumb-detail, in order', () => {
    const m = mapRecord(card(), null, ALL)
    expect(m.ok && m.row.imageSources).toEqual(DETAIL.images.map((i) => i.url))
  })
})

describe('priceUnit — ⛔ the app\'s own rent unit, so a card says "/ month"', () => {
  it('is VND/month, exactly what taxonomy.ts listingMoneyFor gives a rent listing', () => {
    const unit = mapped(card()).priceUnit
    expect(unit).toBe('VND/month')
    expect(unit).toBe(listingMoneyFor({ categorySlug: 'rentals', listingType: 'rent' }).priceUnit)
  })
})

describe('city — ⛔ ONE spelling per city: the vn-units Vietnamese name, like every other row', () => {
  const unit = (code: string) => (vnUnits as { code: string; name: string; nameEn: string }[]).find((p) => p.code === code)!
  /** What the explorer sends: activeProvince.nameEn (listings-explorer.tsx:1235) from vn-units.json. */
  const sent = (code: string) => unit(code).nameEn

  it.each([
    ['hcm', card(), '79', 'Hồ Chí Minh'],
    ['hn', card(HN_CARD), '01', 'Hà Nội'],
    ['dn', card(DN_CARD), '48', 'Đà Nẵng'],
  ] as const)('%s rows store %s — the post wizard\'s string — and still match that province chip', (_k, c, code, expected) => {
    const row = mapped(c, null)
    expect(row.city).toBe(expected)
    expect(row.city).toBe(unit(code).name)
    expect(row.city).not.toBe(unit(code).nameEn)
    // the filter sends the English name and matches both spellings (province-match.ts)
    expect(matchesProvince(row, sent(code))).toBe(true)
    expect(matchesProvince(row, unit(code).name)).toBe(true)
  })

  it('does not leak into the other two provinces', () => {
    const hn = mapped(card(HN_CARD), null)
    expect(matchesProvince(hn, sent('79'))).toBe(false)
    expect(matchesProvince(hn, sent('48'))).toBe(false)
    const hcm = mapped(card(), null)
    expect(matchesProvince(hcm, sent('01'))).toBe(false)
  })

  it('names the city in the title outside HCMC, and in the human location everywhere', () => {
    const hn = mapped(card(HN_CARD), null)
    expect([hn.district, hn.location]).toEqual(['Quận Ba Đình', 'Phường Đội Cấn, Quận Ba Đình, Hà Nội'])
    expect(hn.title).toMatch(/— Phường Đội Cấn, Quận Ba Đình, Hà Nội$/)
    expect(hn.searchText).toContain('hanoi')
    expect(hn.searchText).toContain('ha noi')
    expect(CITIES.dn.city).toBe('Đà Nẵng')
  })
})

describe('district + location — the stored forms, and ⛔ never a house number', () => {
  it('collapses muaban\'s Thủ Đức spellings to the one stored form, and unpads numbers', () => {
    expect(canonicalDistrict('TP. Thủ Đức - Quận 9')).toBe('TP. Thủ Đức')
    expect(canonicalDistrict('TP. Thủ Đức - Quận 2')).toBe('TP. Thủ Đức')
    expect(canonicalDistrict('Thành phố Thủ Đức')).toBe('TP. Thủ Đức')
    expect(canonicalDistrict('Quận 01')).toBe('Quận 1')
    expect(canonicalDistrict('Q. Bình Thạnh')).toBe('Quận Bình Thạnh')
    expect(canonicalDistrict('Huyện Thanh Trì')).toBe('Huyện Thanh Trì')
    expect(canonicalDistrict('867 Lũy Bán Bích')).toBeNull()
    expect(canonicalWard('P. Thảo Điền')).toBe('Phường Thảo Điền')
    expect(canonicalWard('Phường 04')).toBe('Phường 4')
    expect(canonicalWard('Số 12 Nguyễn Trãi')).toBeNull()
  })

  it('every HCMC district muaban uses lands on an explorer chip', () => {
    const muabanHcm = [
      'Quận 1', 'Quận 3', 'Quận 4', 'Quận 5', 'Quận 6', 'Quận 7', 'Quận 8', 'Quận 10', 'Quận 11', 'Quận 12',
      'Quận Bình Tân', 'Quận Bình Thạnh', 'Quận Gò Vấp', 'Quận Phú Nhuận', 'Quận Tân Bình', 'Quận Tân Phú',
      'TP. Thủ Đức - Quận 2', 'TP. Thủ Đức - Quận 9', 'TP. Thủ Đức - Quận Thủ Đức',
      'Huyện Bình Chánh', 'Huyện Cần Giờ', 'Huyện Củ Chi', 'Huyện Hóc Môn', 'Huyện Nhà Bè',
    ]
    const chips = DISTRICTS.flatMap((d) => d.match ?? [])
    for (const raw of muabanHcm) {
      const d = canonicalDistrict(raw)
      expect(d, raw).not.toBeNull()
      expect(chips.some((m) => d!.includes(m)), `${raw} → ${d}`).toBe(true)
    }
  })

  it('maps muaban\'s hybrid Thủ Đức row to TP. Thủ Đức end to end', () => {
    const row = mapped(card({ locations_display: [{ id: 1, name: 'Phường Phú Hữu' }, { id: 2, name: 'TP. Thủ Đức - Quận 9' }, { id: 30, name: 'TP.HCM' }] }))
    expect([row.district, row.location]).toEqual(['TP. Thủ Đức', 'Phường Phú Hữu, TP. Thủ Đức, Hồ Chí Minh'])
  })

  it('isAdminPart / locationIsSafe refuse anything that looks like a street address', () => {
    for (const ok of ['Phường 15', 'Phường Tân Thành', 'Xã Tân Tạo', 'Thị trấn Nhà Bè', 'Quận 11', 'Quận Tân Phú', 'Huyện Thanh Trì', 'Thị xã Sơn Tây', 'TP. Thủ Đức', 'TP.HCM', 'Hà Nội']) {
      expect(isAdminPart(ok), ok).toBe(true)
    }
    for (const bad of ['867 Lũy Bán Bích', 'Số 12 Nguyễn Trãi', '12/3 Hẻm 45', 'Đường Lũy Bán Bích', 'Phường 123', 'Quận 1, 45']) {
      expect(isAdminPart(bad), bad).toBe(false)
    }
    expect(locationIsSafe('Phường 15, Quận 11, Hồ Chí Minh', 'Hồ Chí Minh')).toBe(true)
    expect(locationIsSafe('867 Lũy Bán Bích, Quận 11, Hồ Chí Minh', 'Hồ Chí Minh')).toBe(false)
    expect(locationIsSafe('Phường 15, Quận 11, 12/3', 'Hồ Chí Minh')).toBe(false)
    expect(adminOnly('Hẻm 45/12, Phường 15, Quận 11')).toBe('Phường 15, Quận 11')
  })

  it('a street hiding in the fallback location string never reaches the stored row', () => {
    const c = { ...card(), locations_display: [], location: '867 Lũy Bán Bích, Phường Tân Thành, Quận Tân Phú' }
    const row = mapped(c)
    expect(row.location).toBe('Phường Tân Thành, Quận Tân Phú, Hồ Chí Minh')
    expect(JSON.stringify(row)).not.toContain('867')
  })
})

describe('priceDrop — ⛔ two signals must agree before a number is a monthly rent', () => {
  it.each([
    [25_000_000, '25 triệu/tháng', null],
    [4_300_000, '4,3 triệu/tháng', null],
    [1_200_000_000, '1,2 tỷ/tháng', null],
    [25_000_000, '25.000.000 đ/tháng', null],
    [0, 'Thỏa thuận', 'noPrice'],
    [NaN, '25 triệu/tháng', 'noPrice'],
    [200_000, '200 nghìn/m²', 'perM2'],
    [1_120_000, '1,12 triệu/m2/tháng', 'perM2'],
    [300_000_000, '300 triệu/năm', 'pricePeriod'],
    [500_000, '500 nghìn/ngày', 'pricePeriod'],
    [20_000_000, '20 triệu', 'pricePeriod'],
    [45_000_000, '4,5 triệu/tháng', 'priceMismatch'],   // the Rever '4.5 tr' → 45,000,000 class
    [900_000, '900 nghìn/tháng', 'priceRange'],
    [2_500_000_000, '2,5 tỷ/tháng', 'priceRange'],
  ])('%s + %j → %s', (price, display, expected) => {
    expect(priceDrop(price, display)).toBe(expected)
  })

  it('parses the display amount in VND', () => {
    expect(parseDisplayVnd('4,3 triệu/tháng')).toBe(4_300_000)
    expect(parseDisplayVnd('Thỏa thuận')).toBeNull()
  })
})

describe('parseAreaM2 — ⛔ the Vietnamese thousands dot', () => {
  it.each([
    ['2.550 m²', 2550], ['3.500 m²', 3500], ['89 m²', 89], ['4,5 m²', 4.5], ['4.5 m²', 4.5],
    ['89 m² (4.3x21.0)', 89], ['120 m2', 120], ['0 m²', null], ['', null], [undefined, null], ['5 PN', null],
  ])('%j → %s', (raw, expected) => {
    expect(parseAreaM2(raw)).toBe(expected)
  })
})

describe('bedrooms — ⛔ a missing count is NOT a Studio', () => {
  it('reads PN from the card, caps the facet at 6+, and omits it when absent', () => {
    expect(countFrom([{ value: '60 m²' }, { value: '1 PN' }, { value: '1 WC' }], undefined, 'bed')).toBe(1)
    expect(countFrom([{ value: '60 m²' }, { value: '1 PN' }, { value: '1 WC' }], undefined, 'bath')).toBe(1)
    expect(countFrom([{ value: '50 m²' }], [{ label: 'Số phòng ngủ', value: '2 phòng' }], 'bed')).toBe(2)
    expect(countFrom([{ value: '100 m²' }], undefined, 'bed')).toBeNull()
    expect(bedroomsAttribute(5)).toBe('{"bedrooms":"5"}')
    expect(bedroomsAttribute(9)).toBe('{"bedrooms":"6"}')
    expect(bedroomsAttribute(3, 2)).toBe('{"bedrooms":"3","bathrooms":"2"}')
    expect(bedroomsAttribute(1)).toBe('{"bedrooms":"1"}')
    expect(bedroomsAttribute(null)).toBeNull()
    expect(bedroomsAttribute(0)).toBeNull()
  })

  it('carries through mapRecord as the facet JSON', () => {
    const m = mapRecord(card({ attributes: [{ value: '50 m²' }, { value: '5 PN' }] }), detail({ attributes: [{ value: '50 m²' }, { value: '5 PN' }] }), ALL)
    expect(m.ok && m.row.mutable.attributes).toBe('{"bedrooms":"5"}')
    expect(m.ok && m.row.mutable.title).toBe('House · 5 bed · 50 m² for rent — Tân Thành Ward, Tân Phú District')
  })
})

describe('locationParts', () => {
  it('skips the city entry by id, even when it looks like a district ("TP.HCM")', () => {
    expect(locationParts(card())).toEqual({ ward: 'Phường Tân Thành', district: 'Quận Tân Phú' })
  })
  it('falls back to the location string, ignoring a trailing city', () => {
    expect(locationParts({ city_id: 30, locations_display: [], location: 'Phường 4, Quận Tân Bình, TP.HCM' }))
      .toEqual({ ward: 'Phường 4', district: 'Quận Tân Bình' })
    expect(locationParts({ city_id: 30, locations_display: [], location: 'Phường Linh Tây, Thành phố Thủ Đức' }))
      .toEqual({ ward: 'Phường Linh Tây', district: 'TP. Thủ Đức' })
  })
})

describe('parseLatLng — ⛔ Vietnam or nothing', () => {
  it.each([
    ['10.7769,106.7009', { lat: 10.7769, lng: 106.7009 }],
    ['0,0', null], ['106.7009,10.7769', null], ['', null], ['abc,def', null], [undefined, null],
  ])('%j', (raw, expected) => {
    expect(parseLatLng(raw)).toEqual(expected)
  })
})

describe('affiliateUrlFor — ⛔ host AND listing pinned, and linked BY ID, never by the poster\'s title slug', () => {
  it('accepts only this listing on muaban.net over https', () => {
    expect(affiliateUrlFor(70946042, CARD.url)).toBe(LINK)
    expect(affiliateUrlFor(70946042, 'https://muaban.net' + CARD.url)).toBe(LINK)
    expect(affiliateUrlFor(1, CARD.url)).toBeNull()                                        // another listing's id
    expect(affiliateUrlFor(70946042, 'http://muaban.net' + CARD.url)).toBeNull()
    expect(affiliateUrlFor(70946042, '//evil.example/bat-dong-san/a/b-id70946042')).toBeNull()
    expect(affiliateUrlFor(70946042, 'https://evil.example/bat-dong-san/a/b-id70946042')).toBeNull()
    expect(affiliateUrlFor(70946042, '/viec-lam/a/b-id70946042')).toBeNull()               // not property
    expect(affiliateUrlFor(70946042, '/bat-dong-san/a/b-id70946042?x=https://evil.example')).toBeNull()
    expect(affiliateUrlFor(70946042, '/bat-dong-san/a/bid70946042')).toBeNull()            // 'id' must start the segment or follow '-'
  })

  it('⛔ drops the title slug: a house number, a room number or a phone never reaches the stored link', () => {
    // real canonical URLs, 2026-09-24: '172' is the house number on Trưng Nữ Vương, 'p304' a room
    expect(affiliateUrlFor(71245081, '/bat-dong-san/nha-mat-tien-quan-hai-chau-da-nang/172-cho-thue-nha-nguyen-can-mat-tien-trung-nu-vuong-id71245081'))
      .toBe('https://muaban.net/bat-dong-san/nha-mat-tien-quan-hai-chau-da-nang/id71245081')
    expect(affiliateUrlFor(71226111, '/bat-dong-san/cho-thue-nha-tro-phong-tro-quan-thanh-khe-da-nang/phong-trong-san-kinh-duong-vuong-p304-id71226111'))
      .toBe('https://muaban.net/bat-dong-san/cho-thue-nha-tro-phong-tro-quan-thanh-khe-da-nang/id71226111')
    // a phone in the title no longer drops the row — it simply is not in the link
    expect(affiliateUrlFor(71, '/bat-dong-san/cho-thue-nha/nha-lh-0909123456-id71')).toBe('https://muaban.net/bat-dong-san/cho-thue-nha/id71')
    const row = mapped(card({ url: '/bat-dong-san/nha-mat-tien-quan-tan-phu-ho-chi-minh/867-luy-ban-bich-lh-0909123456-id70946042' }))
    expect(row.affiliateUrl).toBe(LINK)
    expect(JSON.stringify(row)).not.toMatch(/867|0909123456|luy-ban-bich/)
  })

  it('keeps muaban\'s own category segment (a 1–2 digit district number at most) and is idempotent', () => {
    expect(affiliateUrlFor(71255953, '/bat-dong-san/cho-thue-can-ho-chung-cu-quan-12-ho-chi-minh/thue-chung-cu-70m-id71255953'))
      .toBe('https://muaban.net/bat-dong-san/cho-thue-can-ho-chung-cu-quan-12-ho-chi-minh/id71255953')
    expect(affiliateUrlFor(70946042, LINK)).toBe(LINK)                                     // what verify compares a stored row with
    expect(affiliateUrlFor('70946042', LINK)).toBe(LINK)
    expect(affiliateUrlFor(70946042, '/bat-dong-san/nha-172-tran-phu/x-id70946042')).toBeNull() // not a muaban category segment
  })

  it('sourcePageUrl: the canonical page to fetch in memory, under the same pins', () => {
    expect(sourcePageUrl(70946042, CARD.url)).toBe('https://muaban.net' + CARD.url)
    expect(sourcePageUrl(1, CARD.url)).toBeNull()
    expect(sourcePageUrl(70946042, 'https://evil.example' + CARD.url)).toBeNull()
  })
})

describe('postedAt + rankScore — ⛔ the SOURCE\'s own post date, clamped to now, never the import time', () => {
  const now = Date.parse('2026-09-24T12:00:00Z')
  const opts = { ...ALL, now }

  it('sourcePostedAt reads publish_at, clamps a future date to now, refuses an unreadable one', () => {
    expect(sourcePostedAt('2026-09-14T08:00:00+07:00', now)?.toISOString()).toBe('2026-09-14T01:00:00.000Z')
    expect(sourcePostedAt('2026-09-30T00:00:00Z', now)?.getTime()).toBe(now)              // future → now, never later
    expect(sourcePostedAt(undefined, now)).toBeNull()
    expect(sourcePostedAt('', now)).toBeNull()
    expect(sourcePostedAt('yesterday', now)).toBeNull()
    expect(sourcePostedAt('1970-01-01T00:00:00Z', now)).toBeNull()                         // an unset field, not a date
    expect(sourcePostedAt(new Date(MIN_SOURCE_POSTED_AT).toISOString(), now)?.getTime()).toBe(MIN_SOURCE_POSTED_AT)
  })

  it('mapRecord carries publish_at as postedAt, and drops a row with no readable date instead of dating it today', () => {
    const m = mapRecord(card({ publish_at: '2026-09-14T08:00:00+07:00' }), detail(), opts)
    expect(m.ok && m.row.postedAt.toISOString()).toBe('2026-09-14T01:00:00.000Z')
    expect(mapRecord(card({ publish_at: undefined }), detail(), opts)).toEqual({ ok: false, reason: 'postDate' })
    expect(mapRecord(card({ publish_at: 'garbage' }), detail(), opts)).toEqual({ ok: false, reason: 'postDate' })
    const future = mapRecord(card({ publish_at: '2027-01-01T00:00:00Z' }), detail(), opts)
    expect(future.ok && future.row.postedAt.getTime()).toBe(now)
  })

  it('createOnlyFields: the importer\'s own formula, from the source date — a 10-day-old ad does not start as new', () => {
    const postedAt = new Date(now - 10 * 86_400_000)
    const f = createOnlyFields({ postedAt }, 100, now)
    expect(f.postedAt).toBe(postedAt)
    expect(f.rankScore).toBe(browseRankScore({ sellerTrustScore: 100, postedAt, featured: false }, now))
    const stampedNow = browseRankScore({ sellerTrustScore: 100, postedAt: new Date(now), featured: false }, now)
    expect(f.rankScore).toBeLessThan(stampedNow - 0.05)
    expect(stampedNow).toBeCloseTo(0.5786, 4)                                             // the value every row used to start at
  })

  it('end to end: the mapped row\'s create-only fields are the card\'s publish_at and its rank', () => {
    const m = mapRecord(card({ publish_at: '2026-09-10T00:00:00Z' }), detail(), opts)
    if (!m.ok) throw new Error(m.reason)
    const f = createOnlyFields(m.row, 100, now)
    expect(f.postedAt.toISOString()).toBe('2026-09-10T00:00:00.000Z')
    expect(f.rankScore).toBeCloseTo(browseRankScore({ sellerTrustScore: 100, postedAt: new Date('2026-09-10T00:00:00Z') }, now), 12)
  })

  it('postedAtProblem (verify): later than createdAt, or implausibly old, is a failure', () => {
    const created = new Date(now)
    expect(postedAtProblem(new Date(now - 3_600_000), created)).toBeNull()
    expect(postedAtProblem(created, created)).toBeNull()
    expect(postedAtProblem(new Date(now + 60_000), created)).toBeNull()                    // a minute of clock skew is not a failure
    expect(postedAtProblem(new Date(now + 6 * 60_000), created)).toBe('future')
    expect(postedAtProblem(new Date(0), created)).toBe('implausible')
  })
})

describe('images — ⛔ the fetch allowlist is also the SSRF guard', () => {
  it('re-points covers at thumb-detail and admits only cloud.muaban.net thumb-detail files', () => {
    expect(coverToDetail(CARD.covers[1])).toBe(DETAIL.images[1].url)
    expect(IMAGE_RE.test(DETAIL.images[0].url)).toBe(true)
    expect(IMAGE_RE.test(CARD.covers[0])).toBe(false)                                        // thumb-md, not detail
    expect(IMAGE_RE.test('https://cloud.muaban.net.evil.example/images/thumb-detail/2026/06/03/557/743223b5aeee4ce3b97ff602f80feac7.jpg')).toBe(false)
    expect(IMAGE_RE.test('http://169.254.169.254/latest/meta-data')).toBe(false)
  })
  it('dedupes and caps at MAX_IMAGES', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ url: DETAIL.images[0].url.replace('743223b5', `74322${i}b5`) }))
    expect(imageUrls(card(), { images: [...many, many[0]] })).toHaveLength(MAX_IMAGES)
    expect(imageUrls(card(), { images: [DETAIL.images[0], DETAIL.images[0]] })).toEqual([DETAIL.images[0].url])
  })
})

describe('text cards — ⛔ never a cover, never counted as a photo', () => {
  it('is the SHARED rule (src/lib/import-photo-check.ts), not a local copy that can drift', () => {
    expect(imageVerdict).toBe(sharedPhotoCheck.imageVerdict)
    expect(flatnessOf).toBe(sharedPhotoCheck.flatnessOf)
    expect(galleryPlan).toBe(sharedPhotoCheck.galleryPlan)
  })

  it('judges decoded pixels, failing closed', () => {
    expect(imageVerdict({ width: 378, height: 504, entropy: 7.6, flat: 0.24 })).toBe('ok')
    expect(imageVerdict({ width: 232, height: 504, entropy: 7.16, flat: 0.2 })).toBe('ok')           // a real portrait, refused by the first cut
    expect(imageVerdict({ width: 343, height: 193, entropy: 3.19, flat: 0.8 })).toBe('placeholder')
    expect(imageVerdict({ width: 672, height: 504, entropy: 3.86, flat: 0.74 })).toBe('placeholder') // muaban:71117474's "CHO THUÊ NHÀ" cover, measured
    expect(imageVerdict({ width: 672, height: 504, entropy: 3.86, flat: 0.5 })).toBe('placeholder')  // … and by entropy alone
    expect(imageVerdict({ width: 672, height: 504, entropy: 5.81, flat: 0.57 })).toBe('ok')          // muaban:71255957, a real white-tiled room
    expect(imageVerdict({ width: 200, height: 200, entropy: 7, flat: 0.2 })).toBe('tooSmall')
    expect(imageVerdict({ width: 800, height: 600, entropy: NaN, flat: 0.2 })).toBe('undecodable')
    expect(imageVerdict({ width: 800, height: 600, entropy: 7 })).toBe('undecodable')               // no flatness measured → fail closed
    expect(imageVerdict(null)).toBe('undecodable')
  })

  it('refuses a card whose entropy clears 5.0 when three colours fill the frame', () => {
    expect(imageVerdict({ width: 672, height: 504, entropy: 6.2, flat: 0.82 })).toBe('placeholder')
  })

  it('flatnessOf: one flat colour is 1.0, noise is near 0', () => {
    const flat = new Uint8Array(64 * 64 * 3).fill(250)
    expect(flatnessOf(flat, 3)).toBe(1)
    let seed = 7 // xorshift32 — deterministic, and its low byte is not periodic like an LCG's
    const noise = Uint8Array.from({ length: 64 * 64 * 4 }, () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) & 255 })
    expect(flatnessOf(noise, 4)).toBeLessThan(0.05)
    expect(Number.isNaN(flatnessOf(new Uint8Array(0), 3))).toBe(true)
  })

  it('galleryPlan: a text-card cover hands the cover to the first real photo; all cards = no row', () => {
    expect(galleryPlan(['placeholder', 'ok', 'ok'])).toEqual({ keep: [1, 2], refused: { placeholder: 1 }, failed: false })
    expect(galleryPlan(['placeholder'])).toEqual({ keep: [], refused: { placeholder: 1 }, failed: false })
    expect(galleryPlan(['ok', 'tooSmall', 'placeholder'])).toEqual({ keep: [0], refused: { tooSmall: 1, placeholder: 1 }, failed: false })
    expect(galleryPlan(['ok', 'fetchFailed']).failed).toBe(true)
    expect(galleryPlan(['ok', 'undecodable']).failed).toBe(true)
  })
})

describe('arguments — ⛔ a typo never switches the rate limit off', () => {
  it('numArg: finite or the default, then clamped', () => {
    expect(numArg('1500ms', 1500, { min: 1200 })).toBe(1500)
    expect(numArg('abc', 100, { min: 1, integer: true })).toBe(100)
    expect(numArg('Infinity', 1500, { min: 1200 })).toBe(1500)
    expect(numArg('', 1500, { min: 1200 })).toBe(1500)
    expect(numArg(null, 100)).toBe(100)
    expect(numArg('500', 1500, { min: 1200 })).toBe(1200)
    expect(numArg('3.7', 100, { min: 1, integer: true })).toBe(3)
  })

  it('⛔ a valued flag with no value is refused — `--limit --apply` is not "no limit"', () => {
    expect(() => parseRunArgs(['--src', 's.jsonl', '--limit', '--apply'])).toThrow(/--limit needs a value/)
    expect(() => parseRunArgs(['--cap', '--city', 'hcm'])).toThrow(/--cap needs a value/)
    expect(() => parseRunArgs(['--src'])).toThrow(/--src needs a value/)
    expect(parseRunArgs(['--src', 's.jsonl', '--limit', '5']).limit).toBe(5)
  })

  it('parseRunArgs is what the importer runs: NaN delay/max-pages fall back, the floor holds', () => {
    const base = ['node', 'import-muaban-net.ts']
    expect(parseRunArgs([...base, '--delay-ms', '1500ms']).delayMs).toBe(1500)
    expect(parseRunArgs([...base, '--delay-ms', '10']).delayMs).toBe(MIN_DELAY_MS)
    expect(MIN_DELAY_MS).toBeGreaterThanOrEqual(1200)
    expect(parseRunArgs([...base, '--delay-ms', '2000']).delayMs).toBe(2000)
    expect(parseRunArgs([...base, '--max-pages', 'lots']).maxPages).toBe(100)
    expect(parseRunArgs([...base, '--max-pages', '0']).maxPages).toBe(1)
    expect(parseRunArgs([...base, '--max-pages', '25']).maxPages).toBe(25)
    for (const v of [...Object.values(parseRunArgs(base))].filter((x) => typeof x === 'number')) expect(Number.isFinite(v)).toBe(true)
  })

  it('a bad --limit or --cap THROWS instead of meaning "everything"', () => {
    const base = ['node', 'x']
    expect(() => parseRunArgs([...base, '--limit', '30x'])).toThrow(/--limit/)
    expect(() => parseRunArgs([...base, '--limit', '-1'])).toThrow(/--limit/)
    expect(parseRunArgs([...base, '--limit', '30']).limit).toBe(30)
    expect(parseCaps('hcm=3000,hn=1000,dn=1000')).toEqual({ hcm: 3000, hn: 1000, dn: 1000 })
    expect(() => parseCaps('hcm=lots')).toThrow(/--cap/)
    expect(() => parseCaps('hue=10')).toThrow(/--cap/)
    expect(() => parseCaps('hcm=0')).toThrow(/positive/)
  })

  it('modeRefusal: --apply only from --src (or --retire) and always with --journal', () => {
    const p = (...a: string[]) => modeRefusal(parseRunArgs(['node', 'x', ...a]))
    expect(p()).toBeNull()
    expect(p('--apply')).toMatch(/REVIEWED stage/)
    expect(p('--src', 's.jsonl', '--apply')).toMatch(/--journal/)
    expect(p('--src', 's.jsonl', '--apply', '--journal', '/Users/x/j')).toBeNull()
    expect(p('--retire', '--apply')).toMatch(/--journal/)
    expect(p('--retire', '--src', 's.jsonl')).toMatch(/its own pass/)
    expect(p('--src', 's.jsonl', '--stage', 't.jsonl')).toMatch(/already is a staged file/)
  })

  it('journalDirProblem: a temp root the OS clears is refused, a lookalike prefix is not', () => {
    const roots = ['/tmp', '/private/tmp', '/var/folders']
    expect(journalDirProblem('/private/tmp/claude/j', roots)).toMatch(/clears/)
    expect(journalDirProblem('/tmp', roots)).toMatch(/clears/)
    expect(journalDirProblem('/tmpfoo/j', roots)).toBeNull()
    expect(journalDirProblem('/Users/me/eno-import-journals/muaban', roots)).toBeNull()
  })
})

describe('stage freshness — ⛔ 72 h, from each record, never the file mtime; unreadable = stale', () => {
  const now = Date.parse('2026-09-24T12:00:00Z')
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString()
  it('measures the OLDEST record, in hours', () => {
    expect(oldestStageAgeHours([{ fetchedAt: hoursAgo(1) }, { fetchedAt: hoursAgo(30) }], now)).toBeCloseTo(30)
  })
  it('refuses past 72 h — a 4-day-old stage the first cut\'s 7-day limit allowed', () => {
    expect(MAX_STAGE_AGE_HOURS).toBe(72)
    expect(stageAgeRefusal([{ fetchedAt: hoursAgo(71) }], now)).toBeNull()
    expect(stageAgeRefusal([{ fetchedAt: hoursAgo(73) }], now)).toMatch(/73\.0 h old/)
    expect(stageAgeRefusal([{ fetchedAt: hoursAgo(96) }], now)).not.toBeNull()
  })
  it('fails closed on a bad, future or missing timestamp', () => {
    expect(oldestStageAgeHours([{ fetchedAt: 'yesterday-ish' }], now)).toBe(Infinity)
    expect(oldestStageAgeHours([], now)).toBe(Infinity)
    expect(oldestStageAgeHours([{ fetchedAt: hoursAgo(-1) }], now)).toBe(Infinity)           // an hour in the future
    expect(stageAgeRefusal([{ fetchedAt: hoursAgo(-1) }], now)).toMatch(/unknown age/)
  })
})

describe('sellerRefusal — ⛔ never write into a seller that is not plainly ours', () => {
  const ours = { name: SELLER_NAME, ownerId: null, verified: false, verifiedSeller: false, officialPartner: false }
  it.each([
    ['renamed', { ...ours, name: 'Chị Vân' }, /named "Chị Vân"/],
    ['owned', { ...ours, ownerId: 'u1' }, /ownerId u1/],
    ['verified', { ...ours, verified: true }, /verified/],
    ['verifiedSeller', { ...ours, verifiedSeller: true }, /verifiedSeller/],
    ['officialPartner', { ...ours, officialPartner: true }, /officialPartner/],
  ])('refuses a %s seller', (_k, s, re) => {
    expect(sellerRefusal(s)).toMatch(re)
  })
  it('accepts our own unbadged, ownerless seller, and a missing one (it will be created)', () => {
    expect(sellerRefusal(ours)).toBeNull()
    expect(sellerRefusal(null)).toBeNull()
  })
})

describe('--retire — ⛔ hide only on a positive signal, and never on a mass 404', () => {
  const page = (c: Record<string, unknown>) => ({ props: { pageProps: { classified: { id: 70946042, ...c } } } })
  it.each([
    [404, null, 'gone'], [410, null, 'gone'],
    [200, page({ is_expired: true }), 'inactive'], [200, page({ is_outdate: true }), 'inactive'], [200, page({ publish: false }), 'inactive'],
    [200, page({ is_expired: false, is_outdate: false, publish: true }), 'alive'],
    [200, page({ id: 1, is_expired: true }), 'unknown'],            // another listing's page says nothing about ours
    [200, null, 'unknown'], [500, null, 'unknown'], [0, null, 'unknown'], [301, null, 'unknown'],
  ])('HTTP %s → %s', (status, data, verdict) => {
    expect(livenessVerdict(70946042, status as number, data).verdict).toBe(verdict)
  })
  it('massRetireRefusal: churn passes, a site-wide 404 does not', () => {
    expect(massRetireRefusal(5, 100)).toBeNull()
    expect(massRetireRefusal(10, 12)).toBeNull()                    // below the sample floor
    expect(massRetireRefusal(90, 100)).toMatch(/site change/)
  })
  it('the rollback re-activates exactly the hidden ids, and only while still hidden', () => {
    expect(retireRollbackSql(['cm1', 'cm2'])).toBe(`UPDATE "Listing" SET status = 'active' WHERE "sellerId" = '${SELLER_ID}' AND status = 'hidden' AND id IN ('cm1', 'cm2');\n`)
    expect(retireRollbackSql(["x'; DROP TABLE"])).toBeNull()
    expect(retireRollbackSql([])).toBeNull()
  })
})

describe('crawl guards', () => {
  const ROBOTS = 'User-agent: *\nAllow: /\nDisallow: /dashboard/\nDisallow: /8zr2/\nSitemap: https://muaban.net/sitemaps/index.xml\n'
  it('reads muaban robots.txt as allowing the property paths only', () => {
    expect(robotsAllows(ROBOTS, '/bat-dong-san/cho-thue-nha-dat')).toBe(true)
    expect(robotsAllows(ROBOTS, '/dashboard/tin-dang')).toBe(false)
    expect(robotsAllows('User-agent: *\nDisallow: /\n', '/bat-dong-san/x')).toBe(false)
    expect(robotsAllows('User-agent: eno-property-import\nDisallow: /bat-dong-san/\n\nUser-agent: *\nAllow: /\n', '/bat-dong-san/x')).toBe(false)
  })
  it('robotsRules: a missing file allows, an unreachable one forbids (RFC 9309)', () => {
    expect(robotsRules(200, ROBOTS)).toBe(ROBOTS)
    expect(robotsRules(404, 'nf')).toBe('')
    expect(robotsRules(503, '')).toBeNull()
    expect(robotsRules(0, '')).toBeNull()
  })
  it('does not mistake the passive Cloudflare script on every page for a challenge', () => {
    const normal = '<title>Cho thuê nhà đất - Muaban.net</title><script>a.src=\'/cdn-cgi/challenge-platform/scripts/jsd/main.js\'</script>'
    expect(isChallenge(200, normal, null)).toBe(false)
    expect(isChallenge(403, '<title>Just a moment...</title>', null)).toBe(true)
    expect(isChallenge(200, 'x', 'challenge')).toBe(true)
  })
  it('builds the per-city, per-type seed URL in muaban\'s newest-first order', () => {
    expect(listPageUrl(1614, 'dn', 1)).toBe('https://muaban.net/bat-dong-san/cho-thue-nha-tro-phong-tro-da-nang?sort=1')
    expect(listPageUrl(2812, 'hcm', 3)).toBe('https://muaban.net/bat-dong-san/cho-thue-can-ho-ho-chi-minh?sort=1&page=3')
    expect(() => parseCities('hue')).toThrow()
    expect(parseTypes('office,room')).toEqual([2814, 1614])
  })
  it('merges type lists newest-first', () => {
    const a = { id: 1, publish_at: '2026-09-24T01:00:00+07:00' }
    const b = { id: 2, publish_at: '2026-09-24T02:00:00+07:00' }
    const c = { id: 3, publish_at: 'garbage' }
    expect(newestHead([a, b, undefined, c])).toBe(1)
    expect(newestHead([undefined])).toBe(-1)
    expect([a, c, b].sort(compareNewest).map((x) => x.id)).toEqual([2, 1, 3])
    expect(compareNewest({ id: 5, publish_at: a.publish_at }, { id: 9, publish_at: a.publish_at })).toBeGreaterThan(0)
  })
  it('pins the seller by a fixed id', () => {
    expect(SELLER_ID).toBe('muaban-net-import-seller-0001')
  })
})

describe('sameMutable — a re-run skips unchanged rows so updatedAt (the sitemap key) stays put', () => {
  it('matches a stored row field for field, and notices a price or unit change', () => {
    const m = mapRecord(card(), detail(), ALL)
    if (!m.ok) throw new Error('fixture must map')
    const stored = { ...m.row.mutable, status: 'active' }
    expect(sameMutable(m.row.mutable, stored)).toBe(true)
    expect(sameMutable(m.row.mutable, { ...stored, price: 26_000_000 })).toBe(false)
    expect(sameMutable(m.row.mutable, { ...stored, lat: 10.7 })).toBe(false)
    expect(sameMutable(m.row.mutable, { ...stored, priceUnit: 'VND' })).toBe(false)
  })
})

/**
 * ⛔ THE ENGLISH TEXT IS MADE ENGLISH IN THE MAPPER (src/lib/import-i18n.ts), because every text field
 * is refreshed (sameMutable) and a database-only fix would be reverted by the next run.
 */
describe('mapRecord — the English text is English (import-i18n)', () => {
  it('localizes the title, Type, Facing and Location, and gives the English rent English commas', () => {
    const m = mapRecord(card(), detail({ parameters: [...DETAIL.parameters, { label: 'Hướng cửa chính', value: 'Đông Nam', group: false }] }), ALL)
    if (!m.ok) throw new Error(m.reason)
    const r = m.row.mutable
    expect(r.title).toBe('House · 89 m² for rent — Tân Thành Ward, Tân Phú District')
    expect(r.description).toMatch(/^Type: Street-front house$/m)
    expect(r.description).toMatch(/^Facing: Southeast$/m)
    expect(r.description).toMatch(/^Location: Tân Thành Ward, Tân Phú District, Ho Chi Minh City$/m)
    expect(r.description).toMatch(/^Rent: 25,000,000 đ\/month$/m)
    expect(r.description).not.toMatch(/Phường|Quận|25\.000\.000/)
    // The Vietnamese text keeps the source's names and the Vietnamese number format.
    expect(r.descriptionVi).toMatch(/^Loại hình: Nhà mặt tiền$/m)
    expect(r.descriptionVi).toMatch(/^Hướng: Đông Nam$/m)
    expect(r.descriptionVi).toMatch(/^Giá thuê: 25\.000\.000 đ\/tháng$/m)
    // searchText is folded from the LOCALIZED titles (title first — rebaseSearchText relies on it).
    expect(r.searchText.startsWith(fold(`${r.title} ${r.titleVi} `))).toBe(true)
    expect(r.searchText).toContain('tan thanh ward, tan phu district')
    expect(r.searchText).toContain('quan tan phu')
    expect(m.row.untranslated).toEqual([])
    const again = localizeImportText(r)
    expect([again.title, again.titleVi, again.description, again.descriptionVi]).toEqual([r.title, r.titleVi, r.description, r.descriptionVi])
  })

  it('a property type the dictionary lacks stays as the source wrote it, and is reported', () => {
    const m = mapRecord(card({ category_name: 'Loại chưa dịch' }), detail(), ALL)
    if (!m.ok) throw new Error(m.reason)
    expect(m.row.mutable.description).toMatch(/^Type: Loại chưa dịch$/m)
    expect(m.row.untranslated).toEqual([{ target: 'en', kind: 'desc:Type', src: 'Loại chưa dịch' }])
  })
})
