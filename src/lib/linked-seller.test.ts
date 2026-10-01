import { describe, expect, it } from 'vitest'
import { cardHidesTrust, isLinkedShop, isUnratedStorefront, partnerShown } from './linked-seller'
import { isCommissionLink } from './affiliate-commission'
import { serializeListing, serializeListingCard } from './serialize'

/**
 * Owner decisions, 2026-10-01: an ownerless, non-partner storefront shows no trust number anywhere, and the
 * ones that carry linked catalogues show a neutral "Linked shop" chip; commission-bearing rows carry an Ad
 * marker. These pin the three predicates and the card projection that carries them to the client.
 */
describe('isUnratedStorefront', () => {
  it('no owner and not a partner → unrated', () => {
    expect(isUnratedStorefront({ ownerId: null, officialPartner: false })).toBe(true)
  })
  it('an owned storefront is rated, partner or not', () => {
    expect(isUnratedStorefront({ ownerId: '00000000-0000-0000-0000-000000000001', officialPartner: false })).toBe(false)
    expect(isUnratedStorefront({ ownerId: '00000000-0000-0000-0000-000000000001', officialPartner: true })).toBe(false)
  })
  it('an ownerless OFFICIAL PARTNER is not "unrated" — it shows the partner badge instead', () => {
    expect(isUnratedStorefront({ ownerId: null, officialPartner: true })).toBe(false)
  })
})

describe('isLinkedShop', () => {
  it('unrated + carries linked listings → linked shop', () => {
    expect(isLinkedShop({ id: 'cm-tiki', ownerId: null, officialPartner: false }, true)).toBe(true)
  })
  it('an IMPORT_SELLERS storefront is a linked shop even before its rows are known', () => {
    expect(isLinkedShop({ id: 'nhatot-import-seller-0001', ownerId: null, officialPartner: false }, false)).toBe(true)
  })
  it('a legacy GUEST storefront (ownerless, no linked rows) is unrated but NOT a linked shop', () => {
    expect(isLinkedShop({ id: 'cm-guest', ownerId: null, officialPartner: false }, false)).toBe(false)
  })
  it('a partner or an owned shop is never a linked shop', () => {
    expect(isLinkedShop({ id: 'cm-vietkite', ownerId: null, officialPartner: true }, true)).toBe(false)
    expect(isLinkedShop({ id: 'cm-real', ownerId: '00000000-0000-0000-0000-000000000001', officialPartner: false }, true)).toBe(false)
  })
})

describe('cardHidesTrust', () => {
  const base = { sellerId: 'cm-member', isPartnerBooking: false, listingType: 'sell', seller: {} as { unrated?: boolean } }
  it('a member listing keeps its chip', () => expect(cardHidesTrust(base)).toBe(false))
  it('an unrated seller hides it', () => expect(cardHidesTrust({ ...base, seller: { unrated: true } })).toBe(true))
  it('an IMPORT_SELLERS id hides it even on a card that predates `unrated`', () => expect(cardHidesTrust({ ...base, sellerId: 'bds-vn-import-seller-0001' })).toBe(true))
  it('a linked job hides it', () => expect(cardHidesTrust({ ...base, isPartnerBooking: true, listingType: 'job' })).toBe(true))
})

describe('isCommissionLink', () => {
  it('AccessTrade tracker hosts are commission-bearing', () => {
    expect(isCommissionLink('https://go.isclix.com/deep_link/123/456?url=https%3A%2F%2Fcellphones.com.vn%2Fx')).toBe(true)
    expect(isCommissionLink('https://shorten.asia/AbC123')).toBe(true)
    expect(isCommissionLink('https://click.accesstrade.vn/x')).toBe(true)
  })
  it('a source ad, a vehicle-hire page, a job posting or a shop’s own URL is not', () => {
    for (const u of ['https://www.nhatot.com/123.htm', 'https://www.mioto.vn/car/x/ABC', 'https://www.careerlink.vn/job/1', 'https://fptshop.com.vn/x', 'https://viettel.vn/esim']) {
      expect(isCommissionLink(u), u).toBe(false)
    }
  })
  it('a lookalike host is not (suffix tricks)', () => {
    expect(isCommissionLink('https://go.isclix.com.evil.example/x')).toBe(false)
    expect(isCommissionLink('https://notshorten.asia/x')).toBe(false)
  })
  it('null, empty and garbage are not', () => {
    expect(isCommissionLink(null)).toBe(false)
    expect(isCommissionLink('')).toBe(false)
    expect(isCommissionLink('not a url')).toBe(false)
  })
})

describe('serializeListingCard — the two new booleans, and nothing more', () => {
  const row = (patch: Record<string, unknown>) => ({
    sellerId: 's1', id: 'l1', title: 't', titleVi: null, price: 1, priceUnit: 'VND', currency: '₫', negotiable: false,
    location: 'HCM', district: null, city: 'HCM', previousPrice: null, priceDropAt: null, urgentUntil: null, lat: null, lng: null,
    images: '[]', video: null, brandSlug: null, model: null, condition: null, marketPosition: null, verified: true,
    postedAt: new Date(), createdAt: new Date(), savedCount: 0, contactCount: 0, affiliateUrl: null,
    category: { id: 'c', name: 'n', nameVi: 'n', slug: 'electronics', icon: 'i', color: 'brand' },
    seller: { trustScore: 100, officialPartner: false, ownerId: null as string | null },
    ...patch,
  })
  it('an ownerless storefront serializes unrated:true; an owned one false — and the ownerId never ships', () => {
    const a = serializeListingCard(row({}))
    expect(a.seller.unrated).toBe(true)
    const b = serializeListingCard(row({ seller: { trustScore: 90, officialPartner: false, ownerId: '00000000-0000-0000-0000-000000000009' } }))
    expect(b.seller.unrated).toBe(false)
    expect(JSON.stringify(b)).not.toContain('00000000-0000-0000-0000-000000000009')
  })
  it('isSponsored follows the link host; the link itself never ships on a card', () => {
    const tracker = 'https://go.isclix.com/deep_link/1/2?url=x'
    const s = serializeListingCard(row({ affiliateUrl: tracker }))
    expect(s.isSponsored).toBe(true)
    expect(s.isPartnerBooking).toBe(true)
    expect(JSON.stringify(s)).not.toContain('isclix')
    expect(serializeListingCard(row({ affiliateUrl: 'https://www.nhatot.com/1.htm' })).isSponsored).toBe(false)
  })
})

/**
 * The deploy-order guard (review P1, 2026-10-01): the badge's tooltip now claims a SIGNED AGREEMENT, and the
 * flag was still stored on every import/affiliate storefront until each is revoked by hand. A row that links
 * out never shows the flag, so a PDP cached (30-day ISR) before the revoke cannot carry the claim about Tiki.
 */
describe('partnerShown', () => {
  it('a flagged storefront on a row that does NOT link out shows the badge', () => {
    expect(partnerShown(true, false)).toBe(true)
  })
  it('a flagged storefront on a row that links out does not — a stale import-shop grant', () => {
    expect(partnerShown(true, true)).toBe(false)
  })
  it('no flag, no badge, linked or not; a missing flag is not a flag', () => {
    expect(partnerShown(false, false)).toBe(false)
    expect(partnerShown(false, true)).toBe(false)
    expect(partnerShown(undefined, false)).toBe(false)
    expect(partnerShown(null, false)).toBe(false)
  })
})

describe('the projections carry the SHOWN flag, and `unrated` is asked of it', () => {
  const cardRow = (patch: Record<string, unknown>) => ({
    sellerId: 'cm-tiki', id: 'l1', title: 't', titleVi: null, price: 1, priceUnit: 'VND', currency: '₫', negotiable: false,
    location: 'HCM', district: null, city: 'HCM', previousPrice: null, priceDropAt: null, urgentUntil: null, lat: null, lng: null,
    images: '[]', video: null, brandSlug: null, model: null, condition: null, marketPosition: null, verified: true,
    postedAt: new Date(), createdAt: new Date(), savedCount: 0, contactCount: 0, affiliateUrl: null,
    category: { id: 'c', name: 'n', nameVi: 'n', slug: 'electronics', icon: 'i', color: 'brand' },
    seller: { trustScore: 100, officialPartner: true, ownerId: null as string | null },
    ...patch,
  })
  it('card: a STILL-FLAGGED ownerless shop whose row links out → no partner, unrated (no default-100 chip)', () => {
    const c = serializeListingCard(cardRow({ affiliateUrl: 'https://tiki.vn/p/1' }))
    expect(c.seller.officialPartner).toBe(false)
    expect(c.seller.unrated).toBe(true)
    expect(cardHidesTrust(c)).toBe(true)
  })
  it('card: a flagged shop whose row is its own (no outbound link) keeps the badge and is not unrated', () => {
    const c = serializeListingCard(cardRow({}))
    expect(c.seller.officialPartner).toBe(true)
    expect(c.seller.unrated).toBe(false)
  })

  // The full projection (PDP, storefront grid, API) — only the fields serializeListing reads are filled.
  const fullRow = (affiliateUrl: string | null, ownerId: string | null) => ({
    id: 'l1', title: 't', titleVi: null, description: 'd', price: 1, priceUnit: 'VND', currency: '₫', negotiable: false,
    affiliateUrl, affiliateDiscountCode: null, affiliateDiscountPercent: null, location: 'HCM', district: null, city: 'HCM',
    images: '[]', video: null, attributes: null, listingType: 'sell', status: 'active', verified: true,
    postedAt: new Date(), createdAt: new Date(), updatedAt: new Date(), sellerId: 'cm-tiki',
    category: { id: 'c', name: 'n', nameVi: 'n', slug: 'electronics', icon: 'i', color: 'brand' },
    seller: {
      id: 'cm-tiki', name: 'Tiki', avatarColor: null, avatarUrl: null, rating: 0, reviewCount: 0, verifiedSeller: false,
      officialPartner: true, affiliateDiscountCode: null, affiliateDiscountPercent: null, trustTier: 'trusted', trustScore: 100,
      responseRate: null, responseTime: null, memberSince: new Date(), ownerId, owner: null,
    },
  })
  it('full listing: a still-flagged shop on a linked row → officialPartner false, unrated true', () => {
    const l = serializeListing(fullRow('https://go.isclix.com/deep_link/1/2?url=x', null) as unknown as Parameters<typeof serializeListing>[0])
    expect(l.seller.officialPartner).toBe(false)
    expect(l.seller.unrated).toBe(true)
  })
  it('full listing: a signed partner\'s own row (no link) keeps the badge', () => {
    const l = serializeListing(fullRow(null, '00000000-0000-0000-0000-000000000001') as unknown as Parameters<typeof serializeListing>[0])
    expect(l.seller.officialPartner).toBe(true)
    expect(l.seller.unrated).toBe(false)
  })
})
