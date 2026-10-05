import { describe, expect, it, vi } from 'vitest'
import { goneListingView, goneMetadata, goneSearchQuery, isGoneListing, titleKeywords, type GoneCandidate } from './gone-listing'

// Every fixture id is journaled, so each test exercises the guard it names; the journal has its own test.
vi.mock('./gone-listing-ids', () => ({ isJournaledGone: (id: string) => id !== 'taken-down-in-september' }))

/**
 * B8-GONE-LANDERS (UX program 2): which hidden listing URLs answer the gone page (200 + noindex) instead
 * of a 404, and what that page is told. The rule's reasons are in gone-listing.ts; each case below is
 * one clause of it.
 */
const IMPORT_ROW: GoneCandidate = {
  id: 'L1',
  updatedAt: new Date('2026-10-02T20:04:00+07:00'),
  verified: true,
  status: 'hidden',
  listingType: 'sell',
  complianceStatus: 'clear',
  affiliateUrl: 'https://go.isclix.com/deep_link/x?url=https%3A%2F%2Fcellphones.com.vn%2Foppo-a6c.html',
  title: 'OPPO A6c 4GB 128GB',
  titleVi: 'OPPO A6c 4GB 128GB',
  description: 'Điện thoại OPPO A6c chính hãng, bảo hành 12 tháng.',
  descriptionVi: null,
  subcategorySlug: 'phones-tablets',
  category: { slug: 'electronics' },
  seller: { id: 'cmt78nvif0000gpq48kvzmxjw', ownerId: null, officialPartner: false, name: 'CellphoneS' },
}
const row = (over: Partial<GoneCandidate> = {}, seller: Partial<GoneCandidate['seller']> = {}): GoneCandidate =>
  ({ ...IMPORT_ROW, ...over, seller: { ...IMPORT_ROW.seller, ...seller } })

describe('isGoneListing — the rows that get the gone page', () => {
  it('a hidden goods row from an ownerless import shop that links out', () => {
    expect(isGoneListing(row())).toBe(true)
  })

  it('⚠️ a STALE partner flag on a row that links out still reads as the import shop it is (partnerShown)', () => {
    // The flag was stored true on every import storefront until revoked by hand (linked-seller.ts).
    expect(isGoneListing(row({}, { officialPartner: true }))).toBe(true)
  })

  it('an IMPORT_SELLERS storefront counts even without a link on the row (isLinkedShop, read-only)', () => {
    expect(isGoneListing(row({ affiliateUrl: null }, { id: 'nhatot-import-seller-0001', name: 'Nhatot.com' }))).toBe(true)
  })

  it('⛔ a row NOT in the cleanup journals stays a 404 — an earlier takedown looks exactly the same', () => {
    expect(isGoneListing(row())).toBe(true)
    expect(isGoneListing(row({ id: 'taken-down-in-september' }))).toBe(false)
  })

  it('⛔ a journaled row written AFTER the cleanup (restored, then hidden again) stays a 404', () => {
    expect(isGoneListing(row({ updatedAt: new Date('2026-10-02T23:59:59+07:00') }))).toBe(true)
    expect(isGoneListing(row({ updatedAt: new Date('2026-10-03T00:00:00+07:00') }))).toBe(false)
    expect(isGoneListing(row({ updatedAt: new Date('2026-10-04T20:01:00+07:00') }))).toBe(false)
  })

  it('⛔ a person’s own post hidden by moderation stays a 404 — it has an owner', () => {
    expect(isGoneListing(row({ affiliateUrl: null }, { id: 'seller-1', ownerId: '6f1c2c1e-0000-4000-8000-000000000001', name: 'Minh' }))).toBe(false)
    // …even when the person's row happens to carry a link.
    expect(isGoneListing(row({}, { ownerId: '6f1c2c1e-0000-4000-8000-000000000001' }))).toBe(false)
  })

  it('⛔ a legacy guest storefront (ownerless, no link, not an import seller) stays a 404', () => {
    expect(isGoneListing(row({ affiliateUrl: null }, { id: 'guest-seller-1', name: 'Guest' }))).toBe(false)
  })

  it('⛔ a signed partner (owner account, flag kept) stays a 404', () => {
    expect(isGoneListing(row({ affiliateUrl: null }, { ownerId: '6f1c2c1e-0000-4000-8000-000000000002', officialPartner: true, name: 'VietKite' }))).toBe(false)
  })

  it('⛔ only status "hidden" — every other non-live status stays a 404, and live ones have their own pages', () => {
    for (const status of ['held', 'stale', 'expired', 'removed', 'draft', 'pending', '', 'active', 'sold']) {
      expect(isGoneListing(row({ status })), status).toBe(false)
    }
  })

  it('⛔ an unverified row stays a 404', () => {
    expect(isGoneListing(row({ verified: false }))).toBe(false)
  })

  it('⛔ goods only: a hidden import rental, job or service stays a 404 (second-hand goods are no alternative)', () => {
    for (const listingType of ['rent', 'job', 'service', 'wholesale', 'wanted', 'teacher']) {
      expect(isGoneListing(row({ listingType })), listingType).toBe(false)
    }
  })

  it('⛔ a row under an authority order stays a 404, whatever its status', () => {
    for (const complianceStatus of ['under_review', 'taken_down', 'restored', '']) {
      expect(isGoneListing(row({ complianceStatus })), complianceStatus).toBe(false)
    }
  })

  it('⛔ a title hidden FOR WHAT IT SAYS stays a 404 — the 2026-10-01 ad-banned rows and the screen’s banned words', () => {
    // Titles of rows in the hide-ad-banned journal (infant formula under 24 months, veterinary drugs, spirits).
    for (const title of [
      'Thùng 48 Hộp Sữa Nước Abbott Similac 110ml cho trẻ từ 1 tuổi',
      'Viên nhai Nexgard trị ve rận, bọ chét cho chó 1 viên - 2-4 kgs',
      'Rượu Hà Nội HALICO nồng độ 35 can PE 2l không kèm hộp',
      'Combo 3 Bình Sữa Wesser PP 60ml, 140ml và 250ml Giao màu ngẫu nhiên',
    ]) {
      expect(isGoneListing(row({ title, titleVi: title, category: { slug: 'baby-kids' } }, { name: 'Tiki' })), title).toBe(false)
    }
    // ⚠️ THE DESCRIPTION COUNTS (review, 2026-10-05): the infant-formula rule takes an explicit age from it, so
    // this title alone reads 'ok' while the row, as scripts/hide-ad-banned.ts judges it, is 'ban'.
    const formula = { title: 'Sữa bột Nutricare Gold 900g', titleVi: 'Sữa bột Nutricare Gold 900g', category: { slug: 'baby-kids' } }
    expect(isGoneListing(row({ ...formula, description: 'Sữa dinh dưỡng cho bé từ 6 tháng tuổi' }, { name: 'Tiki' }))).toBe(false)
    expect(isGoneListing(row({ ...formula, description: 'Dinh dưỡng cho người lớn tuổi' }, { name: 'Tiki' }))).toBe(true)
    // …and a strong term only in the description is 'review' — still a 404, never a page naming it.
    expect(isGoneListing(row({ title: 'Giỏ quà Tết cao cấp', titleVi: null, description: 'Gồm 1 chai Chivas 18 năm 700ml, bánh kẹo', category: { slug: 'food-drink' } }))).toBe(false)
    // The illegal-goods word list (publish-guard) on a title: a weapon is not a "listing that left".
    expect(isGoneListing(row({ title: 'Bình xịt hơi cay tự vệ mini', titleVi: 'Bình xịt hơi cay tự vệ mini', category: { slug: 'sports' } }))).toBe(false)
  })

  it('null and undefined are no page', () => {
    expect(isGoneListing(null)).toBe(false)
    expect(isGoneListing(undefined)).toBe(false)
  })
})

describe('goneListingView — the whole of what the page is told', () => {
  it('seven fields: the title pair and the slugs the alternatives match on — no photo, price, seller or contact', () => {
    const full = {
      id: 'L1', title: 'OPPO A6c 4GB 128GB', titleVi: 'OPPO A6c 4GB 128GB', subcategorySlug: 'phones-tablets', brandSlug: 'oppo', model: 'A6c',
      category: { slug: 'electronics', name: 'Electronics' },
      price: 3_990_000, images: '["https://cdn.example.test/a.jpg"]', video: 'https://cdn.example.test/v.mp4', description: 'Hàng chính hãng',
      affiliateUrl: 'https://go.isclix.com/x', location: 'Quận 1', lat: 10.77, lng: 106.7,
      seller: { id: 's1', name: 'CellphoneS', phone: '0901234567', email: 'shop@example.test' },
    }
    const view = goneListingView(full)
    expect(Object.keys(view).sort()).toEqual(['brandSlug', 'categorySlug', 'id', 'model', 'subcategorySlug', 'title', 'titleVi'])
    const json = JSON.stringify(view)
    for (const leak of ['3990000', 'cdn.example.test', 'Hàng chính hãng', 'isclix', 'Quận 1', 'CellphoneS', '0901234567', 'shop@example.test']) {
      expect(json, leak).not.toContain(leak)
    }
  })
})

describe('goneMetadata — 200 + noindex,follow, the sold page’s standard', () => {
  it('names the item in the variant’s language, never indexed, links followed — and nothing else (no price, no photo)', () => {
    const vi = goneMetadata({ title: 'Used sofa', titleVi: 'Ghế sofa cũ' }, 'vi')
    expect(vi.title).toMatch(/^Ghế sofa cũ — Không còn trên eno \| eno\.(vn|forum)$/)
    expect(vi.robots).toEqual({ index: false, follow: true })
    expect(Object.keys(vi).sort()).toEqual(['robots', 'title'])
    expect(goneMetadata({ title: 'Used sofa', titleVi: '' }, 'vi').title).toMatch(/^Used sofa — Không còn trên eno/)
    expect(goneMetadata({ title: 'Used sofa', titleVi: 'Ghế sofa cũ' }, 'en').title).toMatch(/^Used sofa — No longer on eno \| /)
  })
})

describe('goneSearchQuery — the prefilled search', () => {
  it('brand + model when the row has both, without naming the brand twice', () => {
    expect(goneSearchQuery({ title: 'OPPO A6c 4GB 128GB', titleVi: null, model: 'A6c' }, 'OPPO', 'en')).toBe('OPPO A6c')
    expect(goneSearchQuery({ title: 'x', titleVi: null, model: 'OPPO A6c' }, 'OPPO', 'vi')).toBe('OPPO A6c')
    expect(goneSearchQuery({ title: 'x', titleVi: null, model: 'Coolswitch Tank' }, 'Under Armour', 'en')).toBe('Under Armour Coolswitch Tank')
    expect(goneSearchQuery({ title: 'x', titleVi: null, model: 'Under Armour Coolswitch' }, 'Under Armour', 'en')).toBe('Under Armour Coolswitch')
  })

  it('otherwise the title’s key words, in the page’s language', () => {
    const l = { title: 'OPPO A6c Smartphone 4GB/128GB', titleVi: 'Điện thoại OPPO A6c 4GB/128GB', model: null }
    expect(goneSearchQuery(l, 'OPPO', 'en')).toBe('OPPO A6c Smartphone')
    expect(goneSearchQuery(l, 'OPPO', 'vi')).toBe('OPPO A6c')
    // A model without a known brand name is not a query on its own ("A6c").
    expect(goneSearchQuery({ title: 'Genuine OPPO A6c 4GB/64GB', titleVi: 'Oppo A6c 4GB/64GB Chính Hãng', model: 'A6c' }, null, 'vi')).toBe('Oppo A6c')
  })
})

describe('titleKeywords', () => {
  it.each([
    ['Genuine OPPO A6c 4GB/64GB', null, 'OPPO A6c'],
    ['Oppo A6c 4GB/64GB Chính Hãng', null, 'Oppo A6c'],
    ['[New 100%] Laptop Dell Latitude 7420 i7 1185G7 16GB 512GB', 'Dell', 'Dell Latitude 7420 i7'],
    ['HyperSpace HS2310US Bluetooth Keyboard - White', null, 'HyperSpace HS2310US Bluetooth Keyboard'],
    ['Book - Waiting for You in San Francisco (Reprint)', null, 'Waiting for You in'],
    ['Book: Mindset: The Psychology of Success (Reprint)', null, 'Mindset The Psychology of'],
    ['Orico CAT 6 network cable, 30 meters', 'Orico', 'Orico CAT 6 network'],
    ['Bình giữ nhiệt 1,5L inox', null, 'Bình giữ nhiệt 1,5L'],
    ['Bộ 3 Hộp Sữa HIKID tăng CHIỀU CAO &amp; CÂN NẶNG', null, 'Bộ 3 Hộp Sữa'],
  ])('%s → %s', (title, brand, expected) => {
    expect(titleKeywords(title, brand)).toBe(expected)
  })

  it('falls back to the raw title’s first words when the cleaning leaves nothing', () => {
    expect(titleKeywords('Chính hãng 100%', null)).toBe('Chính hãng 100')
  })
})
