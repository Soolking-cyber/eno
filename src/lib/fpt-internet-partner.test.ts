import { describe, expect, it } from 'vitest'
import {
  FPT, FPT_CITIES, FPT_EXTERNAL_PREFIX, FPT_FEES, FPT_PLANS, fptInternetListings, fptSellerRefusal, soldPackages,
} from './fpt-internet-partner'
import { CITY_NAME } from './honeycomb-listing'
import { MONTHLY_UNIT, priceUnitSuffix } from './price-unit'
import { ONE_PHOTO_IMPORT_PREFIXES, assertCleanTexts, isOnePhotoImport } from './publish-guard'
import { isPostableSubcategory, servicePriceBasisApplies, subcategoriesFor, suggestSubcategory } from './taxonomy'

const rows = fptInternetListings()
const texts = (r: (typeof rows)[number]) => [r.title, r.titleVi, r.description, r.descriptionVi]
const plan = (key: string) => FPT_PLANS.find((p) => p.key === key)!

describe('FPT Telecom home internet — the table', () => {
  it('holds the sheet\'s monthly prices exactly (November 2026 sales policy, inner city)', () => {
    expect(plan('giga').monthly).toEqual({ internet: 255_000, camera: 255_000, 'vvip-app': null, 'vvip-box': null, 'triple-app': null, 'triple-box': null })
    expect(plan('sky').monthly).toEqual({ internet: 265_000, camera: 265_000, 'vvip-app': 269_000, 'vvip-box': 269_000, 'triple-app': 304_000, 'triple-box': 304_000 })
    expect(plan('meta').monthly).toEqual({ internet: 345_000, camera: 345_000, 'vvip-app': 369_000, 'vvip-box': 369_000, 'triple-app': 404_000, 'triple-box': 404_000 })
    expect(FPT_FEES).toEqual({ installation: 300_000, tvBox: 550_000, extraCamera: 400_000 })
    expect(FPT_PLANS.map((p) => [p.name, p.speed])).toEqual([['GIGA', '300 Mbps'], ['SKY', '1 Gbps'], ['META', '1 Gbps']])
  })
})

describe('FPT Telecom home internet — the nine listings', () => {
  it('one per plan per city, Services › Internet & TV, at the plan\'s lowest monthly, per month, city-level', () => {
    expect(rows.map((r) => r.externalId)).toEqual(FPT_CITIES.flatMap((c) => ['giga', 'sky', 'meta'].map((p) => `${FPT_EXTERNAL_PREFIX}${c.key}:${p}`)))
    expect(new Set(rows.map((r) => r.externalId)).size).toBe(9)
    for (const r of rows) {
      const [, cityKey, planKey] = r.externalId.split(':') as [string, keyof typeof CITY_NAME, string]
      expect(r.price, r.externalId).toBe(Math.min(...soldPackages(plan(planKey)).map((s) => s.monthly)))
      expect([r.priceUnit, priceUnitSuffix(r.priceUnit), r.currency, r.negotiable, r.listingType, r.condition]).toEqual([MONTHLY_UNIT, 'month', '₫', false, 'service', null])
      expect([r.categorySlug, r.subcategorySlug]).toEqual(['services', 'internet-tv'])
      expect([r.city, r.location, r.district]).toEqual([CITY_NAME[cityKey], CITY_NAME[cityKey], null])
      expect(JSON.parse(r.attributes)).toEqual({ serviceLocation: 'at-customer', providerType: 'business' })
    }
    expect(rows.filter((r) => r.externalId.endsWith(':giga')).map((r) => r.price)).toEqual([255_000, 255_000, 255_000])
    expect(rows.filter((r) => r.externalId.endsWith(':sky')).map((r) => r.price)).toEqual([265_000, 265_000, 265_000])
    expect(rows.filter((r) => r.externalId.endsWith(':meta')).map((r) => r.price)).toEqual([345_000, 345_000, 345_000])
  })

  it('every package line carries its monthly price, in both languages, through vnd.ts (dots in Vietnamese)', () => {
    const sky = rows.find((r) => r.externalId === `${FPT_EXTERNAL_PREFIX}hanoi:sky`)!
    for (const line of ['- Internet only: 265,000 đ/month', '- Combo V.VIP App (internet + FPT Play TV in the app): 269,000 đ/month',
      '- Triple VIP Box (internet + camera + FPT Play TV on a TV box): 304,000 đ/month. TV box 550,000 đ; first camera free, each further camera 400,000 đ']) {
      expect(sky.description).toContain(line)
    }
    for (const line of ['- Chỉ Internet: 265.000 đ/tháng', '- Combo V.VIP Box (Internet + truyền hình FPT Play qua đầu thu): 269.000 đ/tháng. Đầu thu 550.000 đ',
      '- Triple VIP App (Internet + camera + truyền hình FPT Play trên ứng dụng): 304.000 đ/tháng. Tặng camera đầu tiên, từ camera thứ hai 400.000 đ/chiếc']) {
      expect(sky.descriptionVi).toContain(line)
    }
    const meta = rows.find((r) => r.externalId === `${FPT_EXTERNAL_PREFIX}danang:meta`)!
    for (const n of ['345,000', '369,000', '404,000']) expect(meta.description).toContain(`${n} đ/month`)
    for (const n of ['345.000', '369.000', '404.000']) expect(meta.descriptionVi).toContain(`${n} đ/tháng`)
  })

  it('states the installation fee, inner-city prices, houses vs apartments, 6- and 12-month packages and how to order', () => {
    for (const r of rows) {
      expect(r.description).toContain('Installation is 300,000 đ, paid once on first setup')
      expect(r.description).toMatch(/inner-city prices.*outer districts may differ/)
      expect(r.description).toContain('Apartments: the price may differ by building')
      expect(r.description).toContain('6-month and 12-month packages are available')
      expect(r.description).toContain('Message eno here with your address, the building name (if it is an apartment) and the plan you want.')
      expect(r.description).toContain('eno introduces FPT Telecom; your service contract is with FPT.')
      expect(r.descriptionVi).toContain('Phí lắp đặt 300.000 đ, trả một lần khi lắp mới')
      expect(r.descriptionVi).toMatch(/giá nội thành.*ngoại thành có thể khác/)
      expect(r.descriptionVi).toContain('Căn hộ chung cư: giá có thể khác tùy tòa nhà')
      expect(r.descriptionVi).toContain('Có gói 6 tháng và 12 tháng.')
      expect(r.descriptionVi).toContain('hợp đồng dịch vụ là giữa bạn và FPT')
    }
  })

  it('⛔ never claims a free connection or installation, a voucher, or a separate 6/12-month price', () => {
    for (const r of rows) {
      const all = texts(r).join('\n')
      expect(all, r.externalId).not.toMatch(/free\s+(connection|installation|install|setup|set-up)|no installation fee|voucher|coupon|discount/i)
      expect(all, r.externalId).not.toMatch(/miễn phí|phiếu|giảm giá|khuyến mãi|tặng tháng|tháng tặng/i)
      expect(all, r.externalId).not.toMatch(/200[.,\s]?000/)
      // No bonus months, no price per 6- or 12-month term: the only words about them are that they exist.
      expect(all, r.externalId).not.toMatch(/bonus|extra month|months? free|free months?|per (6|12)|(6|12)-month (price|rate)/i)
    }
  })

  it('⛔ no commission: no word of it, no percentage, and every figure in the text is one of the sheet\'s public ones', () => {
    // The public figures: the monthly prices, the three fees, the speeds, the 6/12-month terms and the November 2026 date.
    const allowed = new Set(['255,000', '265,000', '269,000', '304,000', '345,000', '369,000', '404,000', '300,000', '550,000', '400,000',
      '255.000', '265.000', '269.000', '304.000', '345.000', '369.000', '404.000', '300.000', '550.000', '400.000',
      '300', '1', '6', '12', '2026', '11/2026'])
    for (const r of rows) {
      const all = texts(r).join('\n')
      expect(all, r.externalId).not.toMatch(/commission|hoa hồng|chiết khấu|rebate|referral fee|%/i)
      for (const n of all.match(/\d[\d.,/]*\d|\d/g) ?? []) expect(allowed.has(n), `${r.externalId}: ${n}`).toBe(true)
    }
  })

  it('GIGA lists no package the sheet marks "Not available"', () => {
    expect(soldPackages(plan('giga')).map((s) => s.key)).toEqual(['internet', 'camera'])
    for (const r of rows.filter((x) => x.externalId.endsWith(':giga'))) {
      for (const t of texts(r)) expect(t, r.externalId).not.toMatch(/V\.VIP|Triple|FPT Play|TV box|đầu thu|truyền hình|Premier League|Ngoại hạng/i)
      // …nor does its search text: a search for TV never finds a plan that sells none (searchText is folded).
      expect(r.searchText, r.externalId).not.toMatch(/v\.vip|triple|fpt play|truyen hinh|premier league|ngoai hang|\btv\b/)
    }
    for (const r of rows.filter((x) => !x.externalId.endsWith(':giga'))) expect(r.searchText).toMatch(/premier league/)
    expect(soldPackages(plan('sky'))).toHaveLength(6)
    expect(soldPackages(plan('meta'))).toHaveLength(6)
  })

  it('every listing is written in English AND Vietnamese, each in its own language, within the limits, and clean', () => {
    for (const r of rows) {
      for (const t of texts(r)) expect(t.trim().length, r.externalId).toBeGreaterThan(0)
      expect(r.title.length).toBeLessThanOrEqual(140)
      expect(r.titleVi.length).toBeLessThanOrEqual(140)
      expect(r.description.length).toBeLessThanOrEqual(5000)
      expect(r.descriptionVi.length).toBeLessThanOrEqual(5000)
      expect(r.titleVi).toMatch(/[ạảãắằẳẵặấầẩẫậđẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/)
      expect(r.descriptionVi).toMatch(/Giá cước hằng tháng/)
      expect(`${r.title}\n${r.description}`).not.toMatch(/[ạảãắằẳẵặấầẩẫậẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/)
      expect(() => assertCleanTexts(texts(r))).not.toThrow()
      // Both titles name the aisle they are filed in, so the wizard's suggestion agrees with it on an edit.
      expect(suggestSubcategory('services', r.title), r.title).toBe('internet-tv')
      expect(suggestSubcategory('services', r.titleVi), r.titleVi).toBe('internet-tv')
    }
  })
})

describe('the aisle, the storefront and the edit path', () => {
  it('Services › Internet & TV exists, is postable, and asks no hourly / one-time chip (a plan is billed by the month)', () => {
    const sub = subcategoriesFor('services').find((s) => s.slug === 'internet-tv')
    expect(sub && [sub.name, sub.nameVi, sub.icon]).toEqual(['Internet & TV', 'Internet & truyền hình', 'Wifi'])
    expect(isPostableSubcategory('services', 'internet-tv', true)).toBe(true)
    expect(servicePriceBasisApplies('services', 'internet-tv')).toBe(false)
  })

  it('only FPT Telecom\'s own eno-held, official storefront takes these rows', () => {
    const ok = { id: 's', ownerId: 'o', ownerEmail: 'support+fpttelecom@eno.vn', officialPartner: true, trustScore: 100 }
    expect(FPT.handle).toBe('fpttelecom')
    expect(fptSellerRefusal(ok)).toBeNull()
    expect(fptSellerRefusal(null)).toMatch(/register it first/)
    expect(fptSellerRefusal({ ...ok, ownerId: null })).toMatch(/no owner/)
    expect(fptSellerRefusal({ ...ok, officialPartner: false })).toMatch(/not an official partner/)
    expect(fptSellerRefusal({ ...ok, ownerEmail: 'someone@else.com' })).toMatch(/owned by/)
  })

  it('the edit path holds these rows to their one photo (the price sheet) — the prefix is listed', () => {
    expect(ONE_PHOTO_IMPORT_PREFIXES).toContain(FPT_EXTERNAL_PREFIX)
    for (const r of rows) expect(isOnePhotoImport(r.externalId)).toBe(true)
    expect(isOnePhotoImport('fpt-internetx:1')).toBe(false)
  })
})
