import { describe, expect, it } from 'vitest'
import {
  HAGA_EXTERNAL_PREFIX, groupHagaServices, hagaSellerRefusal, hagaText, iphoneRank, itemTerms, mapHagaServiceGroup, mapHagaUsed,
  serviceKind, type HagaPage, type HagaRecord,
} from './haga-partner'
import { ONE_PHOTO_IMPORT_PREFIXES, isOnePhotoImport } from './publish-guard'

const page = (over: Partial<HagaPage> = {}): HagaPage => ({
  title: 'iPhone 13 128GB Pre-Owned Likenew', sku: 'IP13', price: 11_700_000, stock: 1,
  intro: 'iPhone 13 in 99% condition. 6-month warranty at HAGA An Khanh.', image: '/UserFile/Products/a.jpg', gallery: [],
  crumbs: ['Products', 'Pre-owned Products', 'Pre-owned iPhone'],
  description: '# Key Specifications\n- A15 Bionic\n- 6.1-inch display\nCall 092.5435.688 or Zalo us\n# Why Choose HAGA?\nWe are the best.',
  ...over,
})
const used = (over: { vi?: Partial<HagaPage>; en?: Partial<HagaPage> } = {}): HagaRecord => ({
  slug: 'iphone-13-128gb-cu-dep.html', url: 'https://hagasmartech.com/iphone-13-128gb-cu-dep.html', kind: 'used', listName: 'x', listPrices: [11_700_000],
  vi: page({ title: 'iPhone 13 128GB Cũ Đẹp', intro: 'iPhone 13 đẹp 99%.', description: '# Cấu hình\n- A15\nTại sao chọn HAGA\nGọi 0925435688', ...over.vi }),
  en: page(over.en),
})
const svc = (slug: string, en: string, vi: string, price: number, crumb = 'Sửa chữa iPhone', image = `/UserFile/Products/${slug}.jpg`): HagaRecord => ({
  slug, url: `https://hagasmartech.com/${slug}`, kind: 'service', listName: vi, listPrices: [price],
  vi: page({ title: vi, price, crumbs: ['Sản phẩm', 'Dịch vụ sửa chữa', crumb], image, intro: 'Bảo hành 3 tháng\nThời gian hoàn thành: 2-3 ngày' }),
  en: page({ title: en, price, image, intro: 'Warranty: 3months\nEstimate time: 2-3 days' }),
})

describe('HAGA used devices', () => {
  it('one listing in both languages from HAGA\'s own pages: price, condition, aisle, the stock-photo line', () => {
    const m = mapHagaUsed(used())
    if (!m.ok) throw new Error(m.reason)
    const r = m.plan.row
    expect(r.externalId).toBe(`${HAGA_EXTERNAL_PREFIX}iphone-13-128gb-cu-dep`)
    expect([r.price, r.currency, r.condition, r.listingType, r.categorySlug, r.subcategorySlug]).toEqual([11_700_000, '₫', 'used', 'sell', 'electronics', 'phones-tablets'])
    expect(r.title).toBe('iPhone 13 128GB Pre-Owned Likenew')
    expect(r.titleVi).toBe('iPhone 13 128GB Cũ Đẹp')
    expect(r.description).toContain('11,700,000 đ')
    expect(r.description).toContain('manufacturer\'s image')
    expect(r.descriptionVi).toContain('11.700.000 đ')
    expect(m.plan.images).toEqual(['/UserFile/Products/a.jpg'])
  })
  it('drops every contact line and stops at HAGA\'s marketing block', () => {
    const m = mapHagaUsed(used())
    if (!m.ok) throw new Error(m.reason)
    for (const t of [m.plan.row.description, m.plan.row.descriptionVi]) {
      expect(t).not.toMatch(/092|zalo|0925435688|We are the best|Gọi/i)
    }
    expect(m.plan.row.description).toContain('# Key Specifications\n- A15 Bionic')
  })
  it('holds a device whose two pages disagree on the price, or that has no image', () => {
    expect(mapHagaUsed(used({ en: { price: 11_000_000 } }))).toMatchObject({ ok: false, reason: 'priceConflict' })
    expect(mapHagaUsed(used({ vi: { image: '/Images/NoImage.jpg' } }))).toMatchObject({ ok: false, reason: 'noPhoto' })
  })
  it('files laptops and MacBooks under laptops-pcs', () => {
    const m = mapHagaUsed(used({ en: { title: 'Dell Latitude 7440 i7 Pre-Owned', crumbs: ['Products', 'Pre-owned Laptop'] }, vi: { title: 'Dell Latitude 7440 cũ' } }))
    expect(m.ok && m.plan.row.subcategorySlug).toBe('laptops-pcs')
  })
  it('hagaText keeps HAGA\'s lines in order, once each, and stops for good at the marketing block', () => {
    expect(hagaText('A\nB', 'B\nC\nhttps://x.com\nTại sao chọn HAGA\nD')).toEqual(['A', 'B', 'C'])
    expect(hagaText('A\n# Why Choose HAGA?\nB', 'C')).toEqual(['A'])
  })
  it('drops a phone, not a spec or a price range', () => {
    expect(hagaText('☎ 0925 435 688 (Call)\nCall 092.5435.688\nor message HAGA on 0925 435 688.\nmini-LED up to 1600 nits, 1.000.000:1 contrast\nChi phí 800.000–1.500.000 ₫\nmail a@b.com\ni7 @ 2.8GHz', null))
      .toEqual(['mini-LED up to 1600 nits, 1.000.000:1 contrast', 'Chi phí 800.000–1.500.000 ₫', 'i7 @ 2.8GHz'])
  })
})

describe('HAGA repair services, grouped', () => {
  it('reads the kind of repair in the right order', () => {
    expect(serviceKind('Repair touch screen chipset of iPhone XS MAX')).toBe('board')
    expect(serviceKind('Replace power cable of iphone X')).toBe('charging')
    expect(serviceKind('iPhone 14 Power IC Repair')).toBe('board')
    expect(serviceKind('Macbook Air M2 13inch OEM keyboard replacement')).toBe('parts')
    expect(serviceKind('Replace casing of iphone 11')).toBe('housing')
    expect(serviceKind('iPhone 15 Pro Rear Camera Replacement')).toBe('camera')
    expect(serviceKind('iPhone Water Damage Cleaning & Drying Service')).toBe('care')
  })
  it('orders iPhone models X → 15 Pro Max', () => {
    const order = ['iPhone 15 Pro Max glass', 'iPhone X glass', 'iPhone 11 Pro glass', 'iPhone 11 glass', 'iPhone XS Max glass'].sort((a, b) => iphoneRank(a)! - iphoneRank(b)!)
    expect(order).toEqual(['iPhone X glass', 'iPhone XS Max glass', 'iPhone 11 glass', 'iPhone 11 Pro glass', 'iPhone 15 Pro Max glass'])
    expect(iphoneRank('iPhone 15 ProMax glass')).toBe(iphoneRank('iPhone 15 Pro Max glass'))
    expect(iphoneRank('iPhone 12 earpiece')).toBe(12)
  })
  it('carries HAGA\'s warranty and time per line, in each language', () => {
    expect(itemTerms('Warranty: 3months\nEstimate time: 2-3 days', 'en')).toBe('warranty 3 months, 2-3 days')
    expect(itemTerms('Bảo hành 3 tháng\nThời gian hoàn thành: 2-3 ngày', 'vi')).toBe('bảo hành 3 tháng, 2-3 ngày')
    expect(itemTerms('Warranty: none', 'en')).toBe('no warranty')
  })
  it('groups by HAGA\'s breadcrumb, drops a same-name same-price duplicate, and prices the card at the lowest line', () => {
    const recs = [
      svc('a', 'iPhone 12 touch screen replacement', 'Thay cảm ứng iPhone 12', 1_400_000),
      svc('b', 'iPhone X OEM front glass replacement', 'Thay mặt kính iPhone X', 750_000),
      svc('c', 'Replace touch screen of iPhone 12', 'Thay cảm ứng iPhone 12', 1_400_000),
      svc('d', 'S20 FE full display assembly replacement', 'Thay màn hình S20 FE', 2_000_000, 'Sửa chữa Samsung'),
    ]
    const { groups, refused } = groupHagaServices(recs)
    expect(groups.map((g) => `${g.group.key}:${g.items.length}`)).toEqual(['iphone-screen:2', 'samsung-screen:1'])
    expect(refused).toEqual([{ slug: 'c', reason: 'duplicate of a' }])
    const m = mapHagaServiceGroup(groups[0].group, groups[0].items)
    if (!m.ok) throw new Error(m.reason)
    expect(m.plan.row.price).toBe(750_000)
    expect(m.plan.row.title).toMatch(/prices by model$/)
    expect([m.plan.row.listingType, m.plan.row.categorySlug, m.plan.row.subcategorySlug, m.plan.row.condition]).toEqual(['service', 'services', 'repair', null])
    expect(m.plan.row.description).toMatch(/- iPhone X OEM front glass replacement: 750,000 đ \(warranty 3 months, 2-3 days\)\n- iPhone 12 touch screen replacement: 1,400,000 đ/)
    expect(m.plan.row.descriptionVi).toContain('- Thay mặt kính iPhone X: 750.000 đ (bảo hành 3 tháng, 2-3 ngày)')
  })
})

describe('the storefront and the edit path', () => {
  it('only HAGA\'s own eno-held, official storefront takes these rows', () => {
    const ok = { id: 's', ownerId: 'o', ownerEmail: 'support+hagasmartech@eno.vn', officialPartner: true, trustScore: 100 }
    expect(hagaSellerRefusal(ok)).toBeNull()
    expect(hagaSellerRefusal(null)).toMatch(/register it first/)
    expect(hagaSellerRefusal({ ...ok, officialPartner: false })).toMatch(/not an official partner/)
    expect(hagaSellerRefusal({ ...ok, ownerEmail: 'someone@else.com' })).toMatch(/owned by/)
  })
  it('the edit path keeps HAGA rows at one photo (owner 2026-11-25) — and only the imports the owner named', () => {
    expect(ONE_PHOTO_IMPORT_PREFIXES).toContain(HAGA_EXTERNAL_PREFIX)
    expect(isOnePhotoImport(`${HAGA_EXTERNAL_PREFIX}iphone-13`)).toBe(true)
    expect(isOnePhotoImport('fb:123')).toBe(true)
    expect(isOnePhotoImport('cvr:123')).toBe(false)
    expect(isOnePhotoImport(null)).toBe(false)
  })
})
