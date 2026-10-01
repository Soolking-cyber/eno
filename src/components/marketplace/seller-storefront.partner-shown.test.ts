import { describe, expect, it, vi } from 'vitest'

// storefrontCard is pure over the loaded row; the module's data imports are stubbed so it loads without a database.
vi.mock('@/lib/db', () => ({ db: {} }))

import { storefrontCard } from './seller-storefront'

type Loaded = Parameters<typeof storefrontCard>[0]

/**
 * The storefront header reads the partner flag AS SHOWN (src/lib/linked-seller.ts partnerShown — review P1,
 * 2026-10-01): a storefront still flagged but whose catalogue links out is a stale import-shop grant, so it
 * shows the Linked shop chip and no trust chip, never the "signed agreement" badge.
 */
const seller = (officialPartner: boolean, affiliateUrls: (string | null)[], ownerId: string | null = null) =>
  ({
    id: 'cm-tiki', name: 'Tiki', avatarColor: null, avatarUrl: null, officialPartner, ownerId, owner: null,
    memberSince: new Date('2026-01-01'), reviewCount: 0, rating: 0, trustScore: 100, trustTier: 'trusted',
    responseRate: null, responseTime: null, responseMetricAt: null,
    listings: affiliateUrls.map((affiliateUrl, i) => ({ id: `l${i}`, affiliateUrl, listingType: 'sell' })),
  }) as unknown as Loaded

describe('storefrontCard — the shown partner flag', () => {
  it('a STILL-FLAGGED ownerless storefront whose rows link out: no badge, unrated, linked shop', () => {
    const { cardSeller } = storefrontCard(seller(true, ['https://tiki.vn/p/1']), 0)
    expect(cardSeller.officialPartner).toBe(false)
    expect(cardSeller.unrated).toBe(true)
    expect(cardSeller.linkedShop).toBe(true)
  })
  it('a flagged storefront whose rows are its own keeps the badge', () => {
    const { cardSeller } = storefrontCard(seller(true, [null], '00000000-0000-0000-0000-000000000001'), 0)
    expect(cardSeller.officialPartner).toBe(true)
    expect(cardSeller.unrated).toBe(false)
    expect(cardSeller.linkedShop).toBe(false)
  })
})
