import { describe, expect, it } from 'vitest'
import {
  DESCRIPTION_MAX, EXTERNAL_ID_PREFIX, NIGHT_VND_BAND, SAIGONCRIBS_EMAIL, SAIGONCRIBS_HANDLE, SAIGONCRIBS_MAX_PHOTOS, SAIGONCRIBS_MIN_PHOTOS,
  TYPE_MAP, bodyProblem, tidyBody, linePrice, buildingsNamed, candidateCount, districtMentions, joinBody, listedDay, mapSaigoncribsListing, orderedKeep,
  photoUses, photoVerdictProblem, readBodies, readPhotoVerdicts, readSaigoncribsRecords, saigoncribsAisle, saigoncribsPhotoPlan,
  saigoncribsPhotoSlug, saigoncribsPlace, saigoncribsPrice, saigoncribsSellerRefusal, wpDateMs,
  type BodyVerdict, type SaigoncribsRecord,
} from './saigoncribs-listing'
import { usdFromDescription, usdToVnd, VND_BAND } from './honeycomb-listing'
import { assertCleanTexts } from './publish-guard'
import { richTextGroups } from './rich-text-blocks'
import { validateHandle } from './handle-format'
import { REVER_BUILDINGS } from '../generated/rever-buildings'

/**
 * FIXTURES ARE REAL ROWS of ~/eno-saigoncribs-2026-11-18/data.json (parse.py, read 2026-11-18), cut to the fields the
 * module reads: descriptionLines keeps only the Location/Address lines (the place evidence), photos the URLs a test needs.
 */
const U = (p: string) => `https://saigoncribs.com/wp-content/uploads/${p}`
const none = { conflicts: [], otherRates: [], range: null, note: null }
const RAW = [
  // Tagged Tân Phú; its own Location line (and body) say Tân Bình — PLAN §0's first place conflict.
  { id: 10017, url: 'https://saigoncribs.com/listing/low-rental-fully-furnished-1br-apartment-65m%C2%B2-near-airport/', title: 'LOW RENTAL! Fully Furnished 1BR Apartment 65m² (Near Airport)', type: 'Apartments', region: 'hcmc_tan_phu', postedAt: '2025-12-02T13:11:28', beds: 1, baths: 1, rooms: null, areaM2: 65, status: null,
    descriptionLines: ['Location: Tan Binh District (Near TSN Airport)'],
    photos: ['2025/12/Saigon-Cribs-1.jpg', '2025/12/Saigon-Cribs-3.jpg', '2025/12/Saigon-Cribs-4.jpg', '2025/12/Saigon-Cribs-5.jpg', '2025/12/Saigon-Cribs-6.jpg', '2025/12/Saigon-Cribs-7.jpg', '2025/12/Saigon-Cribs-8.jpg', '2025/12/Saigon-Cribs-9.jpg', '2025/12/Saigon-Cribs-10.jpg'].map(U),
    price: { amount: 340, per: 'month', raw: '$340 usd/month', source: 'priceBox', perSource: 'priceBox', ...none }, vndHint: null, flags: [] },
  // A serviced apartment by the night.
  { id: 9944, url: 'https://saigoncribs.com/listing/downtown-d1-modern-studio-flexible-stays-in-the-heart-of-the-city/', title: 'DOWNTOWN D1 MODERN STUDIO: Flexible Stays in the Heart of the City', type: 'Serviced Apartments', region: 'hcmc_district_1', postedAt: '2025-11-28T09:35:06', beds: 1, baths: 1, rooms: null, areaM2: 40, status: 'Now Available',
    descriptionLines: ['Location: Dynamic Cultural Hub'], photos: ['2025/11/Saigon-Cribs-Downtown-Serviced-Apartment-1.jpg'].map(U),
    price: { amount: 45, per: 'night', raw: '$45 usd/night', source: 'priceBox', perSource: 'priceBox', ...none }, vndHint: null, flags: [] },
  // A Short Term Stay by the day.
  { id: 10909, url: 'https://saigoncribs.com/listing/vinhomes-staycation-2-bed-park-tower-suite-85day/', title: 'Vinhomes Staycation: 2-Bed Park Tower Suite | $85/Day', type: 'Short Term Stays', region: 'hcmc_binh_thanh', postedAt: '2025-12-27T07:04:01', beds: 2, baths: 2, rooms: null, areaM2: 84, status: 'Open For Viewing',
    descriptionLines: [], photos: ['2025/12/2-Bedroom-Apartment-For-Rent-Vinhomes-Grand-Park-Saigon-Cribs-1_1400x1050.jpg'].map(U),
    price: { amount: 85, per: 'day', raw: '$85 usd/day', source: 'priceBox', perSource: 'priceBox', ...none }, vndHint: null, flags: [] },
  // Landmark 81 (in Bình Thạnh) tagged District 2.
  { id: 9228, url: 'https://saigoncribs.com/listing/landmark-81-2-bed-2-bath-high-floor-luxury-serviced-apartment/', title: 'Landmark 81: 2-Bed, 2-Bath High-Floor Luxury Serviced Apartment', type: 'Short Term Stays', region: 'hcmc_district_2', postedAt: '2025-11-24T09:45:00', beds: 2, baths: 2, rooms: null, areaM2: 100, status: 'Now Available',
    descriptionLines: [], photos: ['2025/11/Landmark-81-Saigon-Cribs-6_800x600.jpg'].map(U),
    price: { amount: 155, per: 'night', raw: '$155 usd/night', source: 'priceBox', perSource: 'priceBox', ...none }, vndHint: null, flags: [] },
  // A house (filed as "Villas Mansions") NEAR a map building — not in it.
  { id: 12040, url: 'https://saigoncribs.com/listing/brand-new-3br-house-near-vinhomes-grand-park-riverside-countryside-living-600mo/', title: 'Brand New 3BR House Near Vinhomes Grand Park | Riverside "Countryside" Living ($600/mo)', type: 'Villas Mansions', region: 'hcmc_district_9', postedAt: '2026-05-19T06:09:12', beds: 3, baths: 3, rooms: null, areaM2: 150, status: 'Now Available',
    descriptionLines: [], photos: ['2026/05/7-Vinhomes-Complex-Near-House-For-Rent-1_788x1050.jpg'].map(U),
    price: { amount: 600, per: 'month', raw: '$600 usd/month', source: 'priceBox', perSource: 'priceBox', ...none }, vndHint: null, flags: [] },
  // An office (commercial space); its Location line names streets — evidence only, never published.
  { id: 9794, url: 'https://saigoncribs.com/listing/prime-d1-corner-commercial-space-120m%C2%B2-fb-venue-3500/', title: 'Prime D1 Corner Commercial Space: 120m² F&B Venue | $3,500', type: 'Offices', region: 'hcmc_district_1', postedAt: '2025-11-26T20:51:42', beds: null, baths: null, rooms: 1, areaM2: 120, status: 'Exclusive Listing',
    descriptionLines: ['Location: Corner Truong Dinh & Ly Tu Trong, District 1'], photos: ['2025/11/Saigon-Cribs-1_800x563.jpg'].map(U),
    price: { amount: 3500, per: 'month', raw: '$3,500 usd/month', source: 'priceBox', perSource: 'priceBox', ...none }, vndHint: null, flags: [] },
  // A bar sold as a business, no price.
  { id: 9799, url: 'https://saigoncribs.com/listing/phu-my-hung-entertainment-lounge-turnkey-bar-gaming-concept-private-sale/', title: 'Phu My Hung Entertainment Lounge: Turnkey Bar & Gaming Concept | Private Sale', type: 'Offices', region: 'hcmc_district_1', postedAt: '2025-11-26T20:58:15', beds: null, baths: null, rooms: 1, areaM2: 100, status: 'Now Available',
    descriptionLines: ['Location: Phu My Hung, District 7 (Korean/Expat Hub)'], photos: ['2025/11/Saigon-Cribs-Business-For-Sale-1.jpg'].map(U),
    price: { amount: null, per: null, raw: 'Private Sale', source: 'title', perSource: null, conflicts: [], otherRates: [], range: null, note: 'Private Sale' }, vndHint: null, flags: ['business sale/transfer, not a plain rental', 'no price (Private Sale)'] },
  // Box "$530 usd/night", title "$30 - $50 / Night", text "Monthly Rate: $530".
  { id: 10582, url: 'https://saigoncribs.com/listing/modern-low-rise-sanctuary-serviced-living-with-juliette-balcony-in-district-7-pmh-30-50-night/', title: 'MODERN LOW-RISE SANCTUARY: Serviced Living with Juliette Balcony in District 7 PMH | $30 - $50 / Night', type: 'Serviced Apartments', region: 'hcmc_district_7', postedAt: '2025-12-20T03:33:24', beds: 1, baths: 1, rooms: null, areaM2: 35, status: 'Now Available',
    descriptionLines: ['Location: Heart of Phu My Hung, District 7 (Korean / Japanese Expats)'], photos: [],
    price: { amount: 530, per: 'month', raw: '$530 usd/night', source: 'priceBox', perSource: 'description (box unit contradicts text)', conflicts: [],
      otherRates: [{ source: 'description', amount: 30, per: 'night', text: 'Daily Rate: $30 – $50 USD / Night' }, { source: 'title', amount: 30, per: 'night', text: 'MODERN LOW-RISE SANCTUARY: Serviced Living with Juliette Balcony in District 7 PMH | $30 - $50 / Night' }],
      range: { min: 30, max: 50, text: 'MODERN LOW-RISE SANCTUARY: Serviced Living with Juliette Balcony in District 7 PMH | $30 - $50 / Night' }, note: null }, vndHint: null, flags: [] },
  // Box "$30 usd/day", title "$300/mo".
  { id: 10962, url: 'https://saigoncribs.com/listing/brand-new-d1-studio-walk-to-ben-thanh-bui-vien-300mo/', title: 'Brand New D1 Studio: Walk to Ben Thanh & Bui Vien | $300/mo', type: 'Serviced Apartments', region: 'hcmc_district_1', postedAt: '2025-12-28T09:06:06', beds: 1, baths: 1, rooms: null, areaM2: 25, status: 'Now Available',
    descriptionLines: [], photos: [],
    price: { amount: 30, per: 'day', raw: '$30 usd/day', source: 'priceBox', perSource: 'priceBox', conflicts: [],
      otherRates: [{ source: 'description', amount: 300, per: 'month', text: '$300 / Month' }, { source: 'title', amount: 300, per: 'month', text: 'Brand New D1 Studio: Walk to Ben Thanh & Bui Vien | $300/mo' }], range: null, note: null }, vndHint: null, flags: [] },
  // Celesta Rise (Nhà Bè) tagged District 7; a bare "$1,100" box.
  { id: 14376, url: 'https://saigoncribs.com/listing/custom-105-sqm-3br-family-suite-celesta-rise-custom-boutique-apartment-district-7-boundary/', title: 'Custom 105 SQM 3BR Family Suite : Celesta Rise Custom Boutique Apartment, District 7 Boundary', type: 'Apartments', region: 'hcmc_district_7', postedAt: '2026-10-18T19:02:57', beds: 3, baths: 2, rooms: null, areaM2: 105, status: null,
    descriptionLines: [], photos: ['2026/10/listing_1792350189_285299.jpg', '2026/10/listing_1792350190_249534.jpg', '2026/10/listing_1792350191_924062.jpg', '2026/10/listing_1792350192_505285.jpg'].map(U),
    price: { amount: 1100, per: 'month', raw: '$1,100', source: 'priceBox', perSource: 'inferred-from-type', ...none }, vndHint: null, flags: [] },
  // Two map buildings in one headline: Masteri Centre Point inside Vinhomes Grand Park.
  { id: 13538, url: 'https://saigoncribs.com/listing/unbeatable-value-68-sqm-2br-2ba-masteri-centre-point-suite-at-vinhomes-grand-park-with-kohler-smart-toilet-450-mo/', title: 'Unbeatable Value: 68 SQM 2BR 2BA Masteri Centre Point Suite at Vinhomes Grand Park with KOHLER Smart Toilet ($450/mo)', type: 'Apartments', region: 'hcmc_district_9', postedAt: '2026-10-12T19:26:34', beds: 2, baths: 2, rooms: null, areaM2: 68, status: null,
    descriptionLines: [], photos: ['2026/10/listing_1791833205_765017.jpg'].map(U),
    price: { amount: 450, per: 'month', raw: '$450', source: 'priceBox', perSource: 'description', ...none }, vndHint: null, flags: [] },
  // A stated range the box sits at the bottom of.
  { id: 11281, url: 'https://saigoncribs.com/listing/grand-opening-brand-new-2-bed-serviced-apartment-in-binh-thanh-no-trang-long-600-700/', title: 'GRAND OPENING: Brand New 2-Bed Serviced Apartment in Binh Thanh (No Trang Long) | $600 - $700', type: 'Apartments', region: 'hcmc_binh_thanh', postedAt: '2025-12-29T19:11:44', beds: 2, baths: 2, rooms: null, areaM2: 65, status: null,
    descriptionLines: [], photos: [],
    price: { amount: 600, per: 'month', raw: '$600 usd/month', source: 'priceBox', perSource: 'priceBox', conflicts: [], otherRates: [], range: { min: 600, max: 700, text: 'GRAND OPENING: Brand New 2-Bed Serviced Apartment in Binh Thanh (No Trang Long) | $600 - $700' }, note: null }, vndHint: null, flags: [] },
  // Box $350/month; title "$30/Night", text "Daily Rate: $30 USD".
  { id: 9237, url: 'https://saigoncribs.com/listing/budget-friendly-serviced-apartment-10-minutes-to-downtown-d1-30night/', title: 'Budget-Friendly Serviced Apartment: 10 Minutes to Downtown D1 - $30/Night', type: 'Serviced Apartments', region: 'hcmc_binh_thanh', postedAt: '2025-11-24T11:10:58', beds: 1, baths: 1, rooms: null, areaM2: 35, status: 'Now Available',
    descriptionLines: [], photos: [],
    price: { amount: 350, per: 'month', raw: '$350 usd/month', source: 'priceBox', perSource: 'priceBox', conflicts: [],
      otherRates: [{ source: 'description', amount: 30, per: 'day', text: 'Daily Rate: $30 USD' }, { source: 'title', amount: 30, per: 'night', text: 'Budget-Friendly Serviced Apartment: 10 Minutes to Downtown D1 - $30/Night' }], range: null, note: null }, vndHint: null, flags: [] },
  // Box $12,000; title and text $12,500 (4.2% — beyond rounding).
  { id: 11321, url: 'https://saigoncribs.com/listing/the-most-expensive-penthouse-in-saigon-600m%C2%B2-private-pool-sanctuary-thao-dien-12500/', title: 'The Most Expensive Penthouse in Saigon: 600m² Private Pool Sanctuary (Thao Dien) | $12,500', type: 'Apartments', region: 'hcmc_district_2_thao_dien', postedAt: '2025-12-30T06:10:22', beds: 6, baths: 6, rooms: null, areaM2: 600, status: null,
    descriptionLines: [], photos: [],
    price: { amount: 12000, per: 'month', raw: '$12,000 usd/month', source: 'priceBox', perSource: 'priceBox',
      conflicts: [{ source: 'description', amount: 12500, per: 'month', text: '$12,500 / Month' }, { source: 'title', amount: 12500, per: null, text: 'The Most Expensive Penthouse in Saigon: 600m² Private Pool Sanctuary (Thao Dien) | $12,500' }], otherRates: [], range: null, note: null }, vndHint: null, flags: ['price figures disagree'] },
  // Let already.
  { id: 10555, url: 'https://saigoncribs.com/listing/downtown-district-3-one-bedroom-premium-tech-seamless-living/', title: 'DOWNTOWN DISTRICT 3 ONE-BEDROOM: Premium Tech & Seamless Living', type: 'Serviced Apartments', region: 'hcmc_district_3', postedAt: '2025-12-19T11:08:53', beds: 1, baths: 1, rooms: null, areaM2: 45, status: 'Leased & Occupied',
    descriptionLines: ['Location: Dynamic Cultural & Transit Hub'], photos: [],
    price: { amount: 499, per: 'month', raw: '$499 usd/month', source: 'priceBox', perSource: 'priceBox', ...none }, vndHint: null, flags: ['status says leased/occupied'] },
  // A bar with its equipment: a business transfer.
  { id: 9786, url: 'https://saigoncribs.com/listing/turnkey-bar-opportunity-prime-d1-frontage-equipment-4500-rent/', title: 'Turnkey Bar Opportunity: Prime D1 Frontage & Equipment | $4,500 Rent', type: 'Offices', region: 'hcmc_district_1', postedAt: '2025-11-26T20:43:09', beds: null, baths: null, rooms: 2, areaM2: 120, status: 'Now Available',
    descriptionLines: ['Address: Huỳnh Thúc Kháng Street, Bến Nghé Ward, District 1'], photos: [],
    price: { amount: 4500, per: 'month', raw: '$4,500 usd/month', source: 'priceBox', perSource: 'priceBox', ...none }, vndHint: null, flags: ['business sale/transfer, not a plain rental'] },
  // Sunrise Riverside (Nhà Bè) "with Landmark 81 View"; the agency's own đồng figure.
  { id: 10052, url: 'https://saigoncribs.com/listing/sunrise-riverside-2-bed-with-landmark-81-view-550/', title: 'Sunrise Riverside: 2-Bed with Landmark 81 View | $550', type: 'Apartments', region: 'hcmc_district_7', postedAt: '2025-12-03T11:35:50', beds: 2, baths: 2, rooms: null, areaM2: 69, status: null,
    descriptionLines: ['Location: Sunrise Riverside (District 7 Border)'], photos: [],
    price: { amount: 550, per: 'month', raw: '$550 usd/month', source: 'priceBox', perSource: 'priceBox', ...none }, vndHint: { amount: 14500000, raw: '14.5 Million VND' }, flags: [] },
  // "near Diamond Island with Quick District 1 Access": neither is where the unit is.
  { id: 13501, url: 'https://saigoncribs.com/listing/high-floor-minimalist-japandi-2-bedroom-haven-near-diamond-island-with-quick-district-1-access/', title: 'High-Floor Minimalist Japandi 2-Bedroom Haven near Diamond Island with Quick District 1 Access', type: 'Apartments', region: 'hcmc_district_2', postedAt: '2026-10-11T22:21:05', beds: 2, baths: 2, rooms: null, areaM2: 69, status: null,
    descriptionLines: [], photos: [],
    price: { amount: 750, per: 'month', raw: '$750', source: 'priceBox', perSource: 'description', ...none }, vndHint: null, flags: ['stated availability date already passed (2026-10-19)'] },
  // Box $2,549, title "$2,550": rounding. Tagged Bình Thạnh, its address District 1.
  { id: 9751, url: 'https://saigoncribs.com/listing/prime-d1-commercial-space-ground-mezzanine-in-japantown-area-2550/', title: 'Prime D1 Commercial Space: Ground + Mezzanine in Japantown Area | $2,550', type: 'Offices', region: 'hcmc_binh_thanh', postedAt: '2025-11-26T19:40:53', beds: null, baths: null, rooms: 4, areaM2: 95, status: 'Now Available',
    descriptionLines: ['Address: 55 Đ. Phạm Viết Chánh, Nguyen Cu Trinh Ward, District 1'], photos: ['2025/11/Saigon-Cribs-5.jpg'].map(U),
    price: { amount: 2549, per: 'month', raw: '$2,549 usd/month', source: 'priceBox', perSource: 'priceBox',
      conflicts: [{ source: 'description', amount: 2550, per: 'month', text: 'Monthly Rent: 65,000,000 VND (Approx. $2,550 USD)' }, { source: 'title', amount: 2550, per: null, text: 'Prime D1 Commercial Space: Ground + Mezzanine in Japantown Area | $2,550' }], otherRates: [], range: null, note: null },
    vndHint: { amount: 65000000, raw: '65,000,000 VND' }, flags: ['price figures disagree', 'fewer than 3 photos'] },
]
const RECS = readSaigoncribsRecords(RAW)
const rec = (id: number): SaigoncribsRecord => { const r = RECS.find((x) => x.id === id); if (!r) throw new Error(`no fixture ${id}`); return r }
const vary = (id: number, patch: Partial<SaigoncribsRecord>): SaigoncribsRecord => ({ ...rec(id), ...patch })
const RATE = 26_300
const NOW = Date.parse('2026-11-18T04:00:00Z')
const BODY: BodyVerdict = { lines: ['A bright corner home on a high floor with views over the river.', '- Two balconies', '- Fully fitted kitchen with an oven'], hold: null }
const map = (r: SaigoncribsRecord, body: BodyVerdict | undefined = BODY, vndPerUsd = RATE) => mapSaigoncribsListing(r, { vndPerUsd, now: NOW, body })
function ok(r: SaigoncribsRecord, body?: BodyVerdict) {
  const m = map(r, body)
  if (!m.ok) throw new Error(`${r.id}: ${m.kind} ${m.reason} — ${m.detail}`)
  return m.mapped
}

describe('the storefront constants', () => {
  it('one eno-held account under a valid handle, the rentals floor, externalId by post id', () => {
    expect(validateHandle(SAIGONCRIBS_HANDLE)).toBeNull()
    expect(SAIGONCRIBS_EMAIL).toBe(`support+${SAIGONCRIBS_HANDLE}@eno.vn`)
    expect(SAIGONCRIBS_MIN_PHOTOS).toBe(3)
    expect(SAIGONCRIBS_MAX_PHOTOS).toBe(10)
    expect(ok(rec(14376)).row.externalId).toBe(`${EXTERNAL_ID_PREFIX}14376`)
  })
})

describe('readSaigoncribsRecords', () => {
  it('reads the fixtures (real data.json rows)', () => {
    expect(RECS).toHaveLength(RAW.length)
    expect(rec(10017).price.raw).toBe('$340 usd/month')
    expect(rec(10052).vndHint).toEqual({ amount: 14500000, raw: '14.5 Million VND' })
  })
  it('refuses the whole file on a shape it cannot vouch for', () => {
    expect(() => readSaigoncribsRecords({})).toThrow(/not an array/)
    expect(() => readSaigoncribsRecords([{ ...RAW[0], id: 'x' }])).toThrow(/post id/)
    expect(() => readSaigoncribsRecords([RAW[0], RAW[0]])).toThrow(/twice/)
    expect(() => readSaigoncribsRecords([{ ...RAW[0], title: ' ' }])).toThrow(/no title/)
    expect(() => readSaigoncribsRecords([{ ...RAW[0], price: null }])).toThrow(/price/)
  })
})

describe('type → aisle (PLAN §3)', () => {
  it('maps the five agency types; a night is stored per day (eno has no VND/night)', () => {
    expect(Object.keys(TYPE_MAP).sort()).toEqual(['Apartments', 'Offices', 'Serviced Apartments', 'Short Term Stays', 'Villas Mansions'])
    expect(saigoncribsAisle('apartment', 'month')).toEqual({ subcategorySlug: 'apartment-rental', priceUnit: 'VND/month', daily: false })
    expect(saigoncribsAisle('serviced', 'month')).toEqual({ subcategorySlug: 'apartment-rental', priceUnit: 'VND/month', daily: false })
    expect(saigoncribsAisle('villa', 'month')).toEqual({ subcategorySlug: 'house-rental', priceUnit: 'VND/month', daily: false })
    expect(saigoncribsAisle('office', 'month')).toEqual({ subcategorySlug: 'office-rental', priceUnit: 'VND/month', daily: false })
    expect(saigoncribsAisle('serviced', 'night')).toEqual({ subcategorySlug: 'homestay-serviced', priceUnit: 'VND/day', daily: true })
    expect(saigoncribsAisle('shortStay', 'day')).toEqual({ subcategorySlug: 'homestay-serviced', priceUnit: 'VND/day', daily: true })
  })
  it('drops a type it does not know rather than guessing an aisle', () => {
    const m = map(vary(10017, { type: 'For Sale' }))
    expect(m.ok === false && m.kind === 'drop' && m.reason).toBe('unknownType')
  })
})

describe('saigoncribsPrice — two guards, conflicts held', () => {
  it('reads the box: monthly, nightly, daily, a bare monthly figure', () => {
    expect(saigoncribsPrice(rec(10017), 'apartment')).toEqual({ ok: true, usd: 340, period: 'month', range: null })
    expect(saigoncribsPrice(rec(9944), 'serviced')).toEqual({ ok: true, usd: 45, period: 'night', range: null })
    expect(saigoncribsPrice(rec(10909), 'shortStay')).toEqual({ ok: true, usd: 85, period: 'day', range: null })
    expect(saigoncribsPrice(rec(14376), 'apartment')).toEqual({ ok: true, usd: 1100, period: 'month', range: null })
    expect(saigoncribsPrice(vary(10017, { price: { ...rec(10017).price, raw: '$1,200usd/month', amount: 1200 }, title: 'x' }), 'apartment')).toMatchObject({ ok: true, usd: 1200 })
  })
  it('no price box (Private Sale, Price Upon Request) is DROPPED', () => {
    expect(saigoncribsPrice(rec(9799), 'office')).toMatchObject({ ok: false, kind: 'drop', reason: 'noPrice', detail: 'Private Sale' })
  })
  it.each([
    [10582, 'serviced', /another unit|outside the stated/],
    [10962, 'serviced', /300/],
    [9237, 'serviced', /30/],
    [11321, 'apartment', /12,500/],
  ] as const)('PLAN §0 conflict %s is HELD', (id, kind, detail) => {
    const p = saigoncribsPrice(rec(id), kind)
    expect(p).toMatchObject({ ok: false, kind: 'hold', reason: 'priceConflict' })
    expect(p.ok === false && p.detail).toMatch(detail)
  })
  it('rounding is not a conflict ($2,549 box, "$2,550" title)', () => {
    expect(saigoncribsPrice(rec(9751), 'office')).toEqual({ ok: true, usd: 2549, period: 'month', range: null })
  })
  it('a range the box is inside is kept, and reported', () => {
    expect(saigoncribsPrice(rec(11281), 'apartment')).toEqual({ ok: true, usd: 600, period: 'month', range: { min: 600, max: 700 } })
  })
  it('reads every dollar figure in the title itself, not only parse.py\'s', () => {
    const r = vary(10017, { title: 'Modern 2-Bed at Masteri An Phu (D2) | $750 (Promo)', price: { ...rec(10017).price, amount: 850, raw: '$850 usd/month' } })
    expect(saigoncribsPrice(r, 'apartment')).toMatchObject({ ok: false, reason: 'priceConflict' })
  })
  it('a unit the type does not rent by, or a bare figure on a nightly type / beside a night word, is HELD', () => {
    const night = { ...rec(10017).price, amount: 45, raw: '$45 usd/night' }
    expect(saigoncribsPrice(vary(10017, { price: night }), 'apartment')).toMatchObject({ ok: false, reason: 'priceConflict' })
    expect(saigoncribsPrice(vary(9228, { price: { ...rec(9228).price, raw: '$155' } }), 'shortStay')).toMatchObject({ ok: false, reason: 'priceConflict' })
    expect(saigoncribsPrice(vary(9228, { price: { ...rec(9228).price, raw: '$155 usd/month' } }), 'shortStay')).toMatchObject({ ok: false, reason: 'priceConflict' })
    expect(saigoncribsPrice(vary(14376, { title: 'Studio by the night in District 1' }), 'serviced')).toMatchObject({ ok: false, reason: 'priceConflict' })
  })
  it('a figure outside the band is HELD (a sale price, a per-m² figure)', () => {
    expect(saigoncribsPrice(vary(10017, { price: { ...rec(10017).price, amount: 90, raw: '$90 usd/month' }, title: 'x' }), 'apartment')).toMatchObject({ ok: false, reason: 'usdBand' })
    expect(saigoncribsPrice(vary(9944, { price: { ...rec(9944).price, amount: 5000, raw: '$5,000 usd/night' } }), 'serviced')).toMatchObject({ ok: false, reason: 'usdBand' })
  })
  it('a box parse.py read differently is HELD, not trusted', () => {
    expect(saigoncribsPrice(vary(10017, { price: { ...rec(10017).price, amount: 345 } }), 'apartment')).toMatchObject({ ok: false, reason: 'priceConflict' })
    expect(saigoncribsPrice(vary(10017, { price: { ...rec(10017).price, raw: '340 USD a month' } }), 'apartment')).toMatchObject({ ok: false, reason: 'priceConflict' })
  })
})

describe('saigoncribsPlace — building first, never a guessed pin', () => {
  it('Celesta Rise tagged District 7 → Huyện Nhà Bè, pinned on the building, the override reported', () => {
    const p = saigoncribsPlace(rec(14376), [])
    const celesta = REVER_BUILDINGS['celesta-rise']
    expect(p).toEqual({ ok: true, district: { vi: 'Huyện Nhà Bè', en: 'Nha Be District' }, area: null,
      building: { slug: 'celesta-rise', name: 'Celesta Rise', lat: celesta.lat, lng: celesta.lng }, buildingNames: ['Celesta Rise'], overrode: 'Quận 7' })
  })
  it('Sunrise Riverside → Nhà Bè; "with Landmark 81 View" is a view, not a place', () => {
    expect(saigoncribsPlace(rec(10052), [])).toMatchObject({ ok: true, district: { vi: 'Huyện Nhà Bè' }, building: { slug: 'sunrise-riverside' }, overrode: 'Quận 7' })
  })
  it('two buildings (Masteri Centre Point inside Vinhomes Grand Park): the agreed district, NO pin', () => {
    const p = saigoncribsPlace(rec(13538), [])
    expect(p).toMatchObject({ ok: true, district: { vi: 'Quận 9' }, building: null, overrode: null })
    expect(p.ok && [...p.buildingNames].sort()).toEqual(['Masteri Centre Point', 'Vinhomes Grand Park'])
  })
  it('a building the unit is NEAR is not its building (12040, 13501)', () => {
    expect(saigoncribsPlace(rec(12040), [])).toMatchObject({ ok: true, district: { vi: 'Quận 9' }, building: null, buildingNames: [] })
    expect(saigoncribsPlace(rec(13501), [])).toMatchObject({ ok: true, district: { vi: 'Quận 2' }, building: null, buildingNames: [] })
  })
  it('the text naming another district, with no building to settle it, is HELD (10017 Tân Phú → Tân Bình, Landmark 81 in "D2", 9751)', () => {
    expect(saigoncribsPlace(rec(10017), [])).toMatchObject({ ok: false, kind: 'hold', reason: 'placeConflict' })
    expect(saigoncribsPlace(rec(10017), []).ok === false && (saigoncribsPlace(rec(10017), []) as { detail: string }).detail).toMatch(/Tân Bình/)
    expect(saigoncribsPlace(rec(9228), [])).toMatchObject({ ok: false, reason: 'placeConflict' })
    expect(saigoncribsPlace(rec(9751), [])).toMatchObject({ ok: false, reason: 'placeConflict' })
  })
  it('a Location line in the reviewed body counts too', () => {
    const r = vary(9944, { descriptionLines: [] })
    expect(saigoncribsPlace(r, ['Location: Phu Nhuan District, by the park'])).toMatchObject({ ok: false, reason: 'placeConflict' })
    expect(saigoncribsPlace(r, ['Location: District 1, a short walk from the market'])).toMatchObject({ ok: true, district: { vi: 'Quận 1' } })
  })
  it('the region\'s neighbourhood is kept when no building names the place', () => {
    const p = saigoncribsPlace(vary(11321, { title: 'Penthouse with a private pool' }), [])
    expect(p).toMatchObject({ ok: true, district: { vi: 'Quận 2', en: 'District 2' }, area: { vi: 'Thảo Điền', en: 'Thao Dien' }, building: null })
  })
  it('outside HCMC is DROPPED; an unknown HCMC tag is HELD', () => {
    expect(saigoncribsPlace(vary(10017, { region: 'hanoi' }), [])).toMatchObject({ ok: false, kind: 'drop', reason: 'notHcmc' })
    expect(saigoncribsPlace(vary(10017, { region: null }), [])).toMatchObject({ ok: false, kind: 'drop', reason: 'notHcmc' })
    expect(saigoncribsPlace(vary(10017, { region: 'hcmc_cu_chi' }), [])).toMatchObject({ ok: false, kind: 'hold', reason: 'unknownRegion' })
  })
})

describe('districtMentions / buildingsNamed', () => {
  it('a street, a ward, a commute or a border is not where the unit is', () => {
    expect(districtMentions('2BR River-View Apartment at Masteri Centre Point, D1 Street, Thu Duc').map((x) => x.district)).toEqual(['TP. Thủ Đức'])
    expect(districtMentions('Spacious Studio on River Canal (D4): 5 Mins to D1 & Seafood Street').map((x) => x.district)).toEqual(['Quận 4'])
    expect(districtMentions('Villa on Tan Phu Ward, Phu My Hung').map((x) => x.district)).toEqual(['Quận 7'])
    expect(districtMentions('Sunrise Riverside, District 7 (Nha Be border)').map((x) => x.district)).toEqual(['Quận 7'])
    expect(districtMentions('Rapid District 1 Commute near Diamond Island')).toEqual([])
    expect(districtMentions('Location: Quận Bình Thạnh').map((x) => x.district)).toEqual(['Quận Bình Thạnh'])
  })
  it('longest name first; a plural; a view or a "near" is not a building', () => {
    expect(buildingsNamed('Brand new unit at The Beverly Solari tower').map((b) => b.slug)).toEqual(['the-beverly-solari'])
    expect(buildingsNamed('Saigon South Residences (Nha Be / D7 border)').map((b) => b.slug)).toEqual(['saigon-south-residence'])
    expect(buildingsNamed('2-Bed with Vinhomes Central Park View')).toEqual([])
    expect(buildingsNamed('Haven near Diamond Island')).toEqual([])
    expect(buildingsNamed('Masteri Thảo Điền tower 4').map((b) => b.slug)).toEqual(['masteri-thao-dien'])
  })
})

describe('mapSaigoncribsListing — the row', () => {
  it('Celesta Rise apartment: titles in both languages, Nhà Bè, pinned, đồng price, dated, English only', () => {
    const m = ok(rec(14376))
    const celesta = REVER_BUILDINGS['celesta-rise']
    expect(m.row).toMatchObject({
      externalId: 'saigoncribs:14376',
      title: '3-bedroom apartment, 105 m² · Celesta Rise, Nha Be District',
      titleVi: 'Căn hộ 3PN 105 m² · Celesta Rise, Huyện Nhà Bè',
      descriptionVi: null,
      price: usdToVnd(1100, RATE), priceUnit: 'VND/month', currency: '₫', negotiable: false, listingType: 'rent',
      subcategorySlug: 'apartment-rental', city: 'Hồ Chí Minh', district: 'Huyện Nhà Bè', location: 'Huyện Nhà Bè',
      lat: celesta.lat, lng: celesta.lng, buildingKey: 'celesta-rise', areaM2: 105, facetTokens: null,
    })
    expect(JSON.parse(m.row.attributes!)).toEqual({ bedrooms: '3', bathrooms: '2' })
    expect(m.postedAt.toISOString()).toBe('2026-10-18T19:02:57.000Z')
    expect(m.usd).toBe(1100)
    const d = m.row.description
    expect(d.startsWith('A bright corner home on a high floor with views over the river.\n\n- Two balconies\n- Fully fitted kitchen with an oven')).toBe(true)
    expect(d).toContain('# Price\n- Rent: US$1,100/month\n- The đồng price on eno is converted from US dollars (26,300 đ per US$, 18 November 2026) and is approximate.')
    expect(d).toContain('Listed by Saigon Cribs on 18 October 2026.')
    expect(d.endsWith('Message Saigon Cribs here on eno to check availability and book a viewing.')).toBe(true)
    // The honeycomb contract: the dollar figure a stored description was written from.
    expect(usdFromDescription(d)).toBe(1100)
    expect(m.row.searchText.startsWith('3-bedroom apartment, 105 m² · celesta rise, nha be district can ho 3pn')).toBe(true)
    expect(m.row.searchText).toContain('saigon cribs')
  })
  it('a serviced apartment by the night → homestay-serviced at VND/day, the night price in the text', () => {
    const m = ok(rec(9944))
    expect(m.row).toMatchObject({
      title: 'Studio serviced apartment by the night, 40 m² · District 1',
      titleVi: 'Căn hộ dịch vụ studio 40 m² theo ngày · Quận 1',
      subcategorySlug: 'homestay-serviced', priceUnit: 'VND/day', price: usdToVnd(45, RATE), district: 'Quận 1', location: 'Quận 1',
      lat: null, lng: null, buildingKey: null,
    })
    expect(JSON.parse(m.row.attributes!)).toEqual({ rentalPeriod: 'daily' })
    expect(m.row.description).toContain('- Rent: US$45 a night')
  })
  it('a short stay by the day (a $30 night is not refused by the monthly đồng band)', () => {
    const m = ok(rec(10909))
    expect(m.row).toMatchObject({ title: '2-bedroom short-stay apartment by the day, 84 m² · Binh Thanh District', titleVi: 'Căn hộ ngắn hạn 2PN 84 m² theo ngày · Quận Bình Thạnh', priceUnit: 'VND/day' })
    const cheap = ok(vary(10909, { title: 'Vinhomes Staycation', price: { ...rec(10909).price, amount: 30, raw: '$30 usd/day' } }))
    expect(cheap.row.price).toBeLessThan(VND_BAND.min)
    expect(cheap.row.price).toBeGreaterThanOrEqual(NIGHT_VND_BAND.min)
  })
  it('a serviced apartment by the month is an apartment, typed "serviced"', () => {
    const m = ok(vary(10555, { status: null }))
    expect(m.row.subcategorySlug).toBe('apartment-rental')
    expect(JSON.parse(m.row.attributes!)).toEqual({ bedrooms: '1', bathrooms: '1', aptType: 'serviced' })
    expect(m.row.title).toBe('1-bedroom serviced apartment, 45 m² · District 3')
  })
  it('a house the agency files as a villa is a house; a villa headline is a villa', () => {
    const house = ok(rec(12040))
    expect(house.row).toMatchObject({ title: '3-bedroom house, 150 m² · District 9', titleVi: 'Nhà nguyên căn 3PN 150 m² · Quận 9', subcategorySlug: 'house-rental' })
    const villa = ok(vary(12040, { title: 'Ultra-Luxury 4-Bed Villa in Thanh My Loi (D9)', beds: 4 }))
    expect(villa.row).toMatchObject({ title: '4-bedroom villa, 150 m² · District 9', titleVi: 'Biệt thự 4PN 150 m² · Quận 9' })
  })
  it('an office: commercial space, no room attributes, the street never published', () => {
    const m = ok(rec(9794))
    expect(m.row).toMatchObject({ title: 'Commercial space, 120 m² · District 1', titleVi: 'Mặt bằng 120 m² · Quận 1', subcategorySlug: 'office-rental', attributes: null, location: 'Quận 1' })
    expect(`${m.row.title} ${m.row.location} ${m.row.description}`).not.toMatch(/Truong Dinh|Ly Tu Trong/)
  })
  it('a range the box is inside is written with the range said', () => {
    expect(ok(rec(11281)).row.description).toContain('- Saigon Cribs quotes US$600 to US$700 a month, depending on the unit.')
  })
  it('the neighbourhood is in the location and titles', () => {
    const m = ok(vary(11321, { title: 'Penthouse with a private pool', price: { ...rec(11321).price, conflicts: [] } }))
    expect(m.row).toMatchObject({ location: 'Quận 2 (Thảo Điền)', title: '6-bedroom apartment, 600 m² · Thao Dien, District 2', titleVi: 'Căn hộ 6PN 600 m² · Thảo Điền, Quận 2' })
  })
  it('an empty reviewed body gets a code-written sentence, never the agency\'s headline', () => {
    const m = ok(rec(13538), { lines: [], hold: null })
    expect(m.row.description.startsWith('2-bedroom apartment of 68 m² in District 9, Ho Chi Minh City.\n\n# Price')).toBe(true)
    expect(m.row.description).not.toMatch(/Unbeatable|KOHLER/)
    expect(ok(rec(9944), { lines: [], hold: null }).row.description.startsWith('Studio serviced apartment of 40 m² in District 1, Ho Chi Minh City, rented by the night.')).toBe(true)
    expect(ok(rec(14376), { lines: [], hold: null }).row.description.startsWith('3-bedroom apartment of 105 m² at Celesta Rise, Nha Be District, Ho Chi Minh City.')).toBe(true)
  })
  it('postedAt is the agency\'s own date, clamped to now; none → HELD', () => {
    expect(ok(vary(14376, { postedAt: '2027-01-01T00:00:00' })).postedAt.getTime()).toBe(NOW)
    expect(map(vary(14376, { postedAt: null }))).toMatchObject({ ok: false, kind: 'hold', reason: 'noDate' })
    expect(map(vary(14376, { postedAt: 'yesterday' }))).toMatchObject({ ok: false, reason: 'noDate' })
  })
  it('drops and holds: let already, no price, a business transfer, conflicts', () => {
    expect(map(rec(10555))).toMatchObject({ ok: false, kind: 'drop', reason: 'leased' })
    expect(map(rec(9799))).toMatchObject({ ok: false, kind: 'drop', reason: 'noPrice' })
    expect(map(rec(9786))).toMatchObject({ ok: false, kind: 'hold', reason: 'businessTransfer' })
    expect(map(rec(10582))).toMatchObject({ ok: false, reason: 'priceConflict' })
    expect(map(rec(10962))).toMatchObject({ ok: false, reason: 'priceConflict' })
    expect(map(rec(10017))).toMatchObject({ ok: false, reason: 'placeConflict' })
  })
  it('the agency\'s own đồng figure must agree with the conversion', () => {
    expect(map(rec(10052)).ok).toBe(true) // 14.5 Million VND ≈ US$550 × 26,300
    expect(map(rec(10052), BODY, 30_000)).toMatchObject({ ok: false, reason: 'priceConflict' })
  })
  it('the verdict files: no body entry, or a hold in it, is HELD', () => {
    expect(mapSaigoncribsListing(rec(14376), { vndPerUsd: RATE, now: NOW, body: undefined })).toMatchObject({ ok: false, kind: 'hold', reason: 'noBodyVerdict' })
    expect(map(rec(14376), { lines: BODY.lines, hold: 'unit number in every line' })).toMatchObject({ ok: false, reason: 'bodyHold', detail: 'unit number in every line' })
  })
})

describe('the body — held, never edited', () => {
  // The footer and promo lines 10017 and its siblings carried (data.json removedLines, 2026-11-18).
  it.each([
    ['Hassle-free arrival with smart lock access and VIP airport pickup included.', 'bodyForbidden'],
    ['✈️ VIP Arrival: Free Immigration Skip-the-Line Service & Private Airport Pickup.', 'bodyForbidden'],
    ['We can help with your visa extension too.', 'bodyForbidden'],
    ['Use promo code #NEWPADCASH for 50% Cash Back on your first month.', 'bodyForbidden'],
    ['Free internet setup on arrival.', 'bodyForbidden'],
    ['Complete the booking form', 'bodyForbidden'],
    ['For only $340/month, you get a massive 65m² one-bedroom apartment.', 'bodyPrice'],
    ['Rent is 15 Million VND a month.', 'bodyPrice'],
    ['13,000,000 VND / Month', 'bodyPrice'],
    ['お問い合わせはこちら', 'bodyNotEnglish'],
    ['Unfurnished 3BR Countryside-View Suite at Celesta Rise T4 0508.', 'bodyUnitNumber'],
    ['Brand New 2-Bed Serviced Apartment #202 (No Trang Long).', 'bodyUnitNumber'],
  ])('"%s" → %s', (line, reason) => {
    expect(bodyProblem(['A quiet one-bedroom home.', line])?.reason).toBe(reason)
    expect(map(rec(14376), { lines: ['A quiet one-bedroom home.', line], hold: null })).toMatchObject({ ok: false, kind: 'hold', reason })
  })
  it('a phone, an email or a link reaches the publish screen and is HELD', () => {
    const footer = 'YOUR SEAMLESS START IN SAIGON: Contact us via WhatsApp: +84-90-333-6130'
    expect(map(rec(14376), { lines: ['A quiet home.', footer], hold: null })).toMatchObject({ ok: false, reason: 'contactInText' })
    expect(map(rec(14376), { lines: ['A quiet home.', 'Email: hi@example.com'], hold: null })).toMatchObject({ ok: false, reason: 'contactInText' })
    expect(map(rec(14376), { lines: ['A quiet home.', 'Tour: www.youtube.com/watch'], hold: null })).toMatchObject({ ok: false, reason: 'contactInText' })
  })
  it('a fact sheet of Label: value lines is HELD (it renders as a table); a utility rate and free Wi-Fi are fine', () => {
    expect(bodyProblem(['Size: 65 Sq Meters', 'Status: Available', 'Furnishing: Full'])?.reason).toBe('bodyFactTable')
    expect(bodyProblem(['Electricity is 4,000 VND/kWh at the state rate.', 'Free high-speed internet and weekly cleaning.', 'Move-in ready with new linens.', 'Pool on the 5th floor; 2 bedrooms and 2 bathrooms.'])).toBeNull()
  })
  it('a claim of time is cut out, never published ("JUST LISTED", "Available Now")', () => {
    const r = map(rec(14376), { lines: ['A quiet one-bedroom home.', '🚨 NEW PAD ALERT: JUST LISTED! 🚨', 'Available Now for a long lease.'], hold: null })
    expect(r.ok).toBe(true)
    const d = r.ok ? r.mapped.row.description : ''
    expect(d).not.toMatch(/just listed|available now|pad alert/i)
    expect(d).toContain('for a long lease.')
  })
  it('a description an edit would cut (over 5,000 characters) loses its last body lines, never the price or the date', () => {
    const long = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1} describes the light, the wood floors and the quiet street in some detail.`)
    const r = map(rec(14376), { lines: long, hold: null })
    expect(r.ok).toBe(true)
    const d = r.ok ? r.mapped.row.description : ''
    expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX)
    expect(d).toContain('# Price')
    expect(d).toContain('Listed by Saigon Cribs on')
    expect(DESCRIPTION_MAX).toBe(5000)
  })
  it('one line, one paragraph; consecutive bullets stay one list — and no table', () => {
    expect(joinBody(['One.', 'Two.', '- a', '- b', 'Three.'])).toBe('One.\n\nTwo.\n\n- a\n- b\n\nThree.')
    const g = richTextGroups(ok(rec(14376)).row.description)
    expect(g.map((x) => x.kind)).toEqual(['p', 'ul', 'h', 'ul', 'p', 'p'])
  })
  it('every row the fixtures write passes the publish screen and carries no agency perk', () => {
    for (const r of RECS) {
      const m = map(r)
      if (!m.ok) continue
      const t = m.mapped.row
      expect(() => assertCleanTexts([t.title, t.titleVi, t.location, t.description]), String(r.id)).not.toThrow()
      expect(`${t.title} ${t.titleVi} ${t.description}`).not.toMatch(/visa|immigration|airport|cash ?back|promo/i)
    }
  })
})

describe('dates', () => {
  it('reads the WordPress date as UTC (the site clock is UTC) and prints the calendar day it shows', () => {
    expect(wpDateMs('2025-11-28T09:35:06')).toBe(Date.parse('2025-11-28T09:35:06Z'))
    expect(wpDateMs('2025-11-28T09:35:06+07:00')).toBe(Date.parse('2025-11-28T02:35:06Z'))
    expect(wpDateMs('28/11/2025')).toBeNull()
    expect(listedDay('2026-10-18T21:08:20')).toBe('18 October 2026')
    expect(listedDay('2025-12-02T13:11:28')).toBe('2 December 2025')
  })
})

describe('photos', () => {
  const all = (n: number) => Array.from({ length: n }, (_, i) => i + 1)
  it('a verdict must judge every candidate exactly once', () => {
    const r = rec(10017) // 9 photos
    expect(candidateCount(r)).toBe(9)
    expect(photoVerdictProblem(r, { keep: [1, 2, 3, 4, 5, 6, 7], drop: [{ n: 8, reason: 'flyer' }, { n: 9, reason: 'phone number' }], hold: null })).toBeNull()
    expect(photoVerdictProblem(r, { keep: [1, 2, 3], drop: [], hold: null })).toMatch(/photo 4 has no verdict/)
    expect(photoVerdictProblem(r, { keep: all(9), drop: [{ n: 2, reason: 'x' }], hold: null })).toMatch(/twice/)
    expect(photoVerdictProblem(r, { keep: all(10), drop: [], hold: null })).toMatch(/photo 10 is judged/)
    expect(candidateCount({ photos: Array.from({ length: 83 }, (_, i) => `u${i}`) })).toBe(20)
  })
  it('readPhotoVerdicts / readBodies refuse a malformed file', () => {
    expect(readPhotoVerdicts({ 10017: { keep: [2, 1], drop: [{ n: 3, reason: 'face' }], hold: null } })).toEqual({ 10017: { keep: [2, 1], drop: [{ n: 3, reason: 'face' }], hold: null } })
    expect(() => readPhotoVerdicts({ 10017: { keep: [21], drop: [] } })).toThrow(/photo number/)
    expect(() => readPhotoVerdicts({ 10017: { keep: [1.5], drop: [] } })).toThrow(/photo number/)
    expect(() => readPhotoVerdicts({ abc: { keep: [], drop: [] } })).toThrow(/post id/)
    expect(() => readPhotoVerdicts({ 10017: { keep: [], drop: [], hold: '' } })).toThrow(/hold/)
    expect(() => readPhotoVerdicts([])).toThrow()
    expect(readBodies({ 10017: { lines: [' One. ', '', 'Two.'], hold: 'check the unit number' } })).toEqual({ 10017: { lines: ['One.', 'Two.'], hold: 'check the unit number' } })
    expect(() => readBodies({ 10017: { lines: [1] } })).toThrow(/lines/)
  })
  it('building shots (a URL on 3+ listings) go after the unit\'s own photos, so the cover is the unit', () => {
    const pool = U('2025/12/Saigon-Cribs-Apartment-Amenities-5_800x533.jpg')
    const a = { photos: [pool, U('a1.jpg'), U('a2.jpg')] }
    const uses = photoUses([a, { photos: [pool] }, { photos: [pool, pool] }])
    expect(uses.get(pool)).toBe(3)
    expect(orderedKeep(a, { keep: [1, 3, 2], drop: [], hold: null }, uses)).toEqual([{ n: 3, shared: false }, { n: 2, shared: false }, { n: 1, shared: true }])
  })
  it('the plan: only real photos, a near-duplicate once, at most 10, at least 3, and the unit itself', () => {
    const j = (n: number, outcome: 'ok' | 'placeholder' | 'tooSmall' = 'ok', hash: string | null = null, shared = false) => ({ n, shared, outcome, hash })
    // 14 dHashes at least 32 bits apart from each other (Walsh-like patterns): every pair is a different angle.
    const H = ['0000000000000000', 'ffffffffffffffff', '00000000ffffffff', 'ffffffff00000000', '0f0f0f0f0f0f0f0f', 'f0f0f0f0f0f0f0f0', '00ff00ff00ff00ff',
      'ff00ff00ff00ff00', '3333333333333333', 'cccccccccccccccc', '5555555555555555', 'aaaaaaaaaaaaaaaa', '0000ffff0000ffff', 'ffff0000ffff0000']
    const h = (i: number) => H[i - 1]
    expect(saigoncribsPhotoPlan([j(1, 'ok', h(1)), j(2, 'placeholder'), j(3, 'ok', h(3)), j(4, 'ok', h(1)), j(5, 'ok', h(5))]))
      .toEqual({ decision: 'create', keep: [1, 3, 5], refused: { placeholder: 1 }, duplicates: 1 })
    expect(saigoncribsPhotoPlan([j(1), j(2, 'tooSmall'), j(3)])).toMatchObject({ decision: 'tooFewPhotos', keep: [1, 3] })
    expect(saigoncribsPhotoPlan(all(14).map((n) => j(n, 'ok', h(n)))).keep).toEqual(all(10))
    expect(saigoncribsPhotoPlan([j(1, 'ok', h(1), true), j(2, 'ok', h(2), true), j(3, 'ok', h(3), true)]).decision).toBe('noOwnPhoto')
  })
  it('the hosted slug is the bytes\' hash under the handle', () => {
    expect(saigoncribsPhotoSlug('0123456789abcdef0123456789abcdef01234567')).toBe('saigoncribs-0123456789abcdef')
  })
})

describe('saigoncribsSellerRefusal — handle AND owner email AND an owner AND chat-only', () => {
  const s = { id: 'seller1', ownerId: 'p1', ownerEmail: SAIGONCRIBS_EMAIL, officialPartner: true, trustScore: 100 }
  it('refuses each missing piece, accepts the whole', () => {
    expect(saigoncribsSellerRefusal(null)).toMatch(/register it first/)
    expect(saigoncribsSellerRefusal({ ...s, ownerId: null })).toMatch(/reach nobody/)
    expect(saigoncribsSellerRefusal({ ...s, ownerEmail: 'someone@example.com' })).toMatch(/owned by someone@example.com/)
    expect(saigoncribsSellerRefusal({ ...s, officialPartner: false })).toMatch(/official partner/)
    expect(saigoncribsSellerRefusal({ ...s, ownerEmail: SAIGONCRIBS_EMAIL.toUpperCase() })).toBeNull()
    expect(saigoncribsSellerRefusal(s)).toBeNull()
  })
})

describe('tidyBody — tidy what loses no fact, hold only a real price conflict', () => {
  const p = { usd: 750, vndPerUsd: 25_704 }
  it('drops a line that only restates the rent, keeps a fee line, holds a different rent', () => {
    expect(tidyBody(['Price: $750 USD / month', 'Bright 2-bedroom.'], p)).toEqual(['Bright 2-bedroom.'])
    const fee = 'Price: $750 USD / month (excluding management fee of approx. $50 USD/month)'
    expect(tidyBody([fee], p)).toEqual([`- ${fee}`])
    expect(bodyProblem([fee], p)).toBeNull()
    expect(linePrice('Short-term: $900 / month', p)).toBe('conflict')
    expect(bodyProblem(['Short-term: $900 / month'], p)?.reason).toBe('bodyPrice')
    expect(linePrice('Rent is 19.3 million VND a month.', p)).toBe('same')
  })
  it('cuts "Available now" out, and drops a line left with nothing', () => {
    expect(tidyBody(['Available now.', 'Availability: Available now', 'Status: Brand New / Available Now'], p)).toEqual(['- Status: Brand New'])
  })
  it("turns 'Label: value' runs into list items, so no second fact sheet", () => {
    const out = tidyBody(['Location: District 7', 'Layout: 2 bedrooms', 'View: river'], p)
    expect(out).toEqual(['- Location: District 7', '- Layout: 2 bedrooms', '- View: river'])
    expect(bodyProblem(out, p)).toBeNull()
  })
  it('a bus route number is not a unit number', () => {
    expect(bodyProblem(['Bus Routes Nearby (No Trang Long): #31, #64, #161.', '✓ Transport: Bus Route #46 stop is one block away.'], p)).toBeNull()
    expect(bodyProblem(['Serviced Apartment #202 (No Trang Long).'], p)?.reason).toBe('bodyUnitNumber')
  })
})
