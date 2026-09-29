import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `storefrontMetaDescription` — the wiring half of the storefront description (SEO wave B, I2): the
 * pure rule is pinned in src/lib/storefront-description.test.ts; this pins what the two storefront
 * routes FEED it. The total is `_count.listings`, not the 60-row page `loadSeller` renders, and
 * "has a listing of its own" is one query for a live row with no `affiliateUrl`, not a scan of those
 * 60 rows.
 */
const h = vi.hoisted(() => ({
  seller: null as null | Record<string, unknown>,
  ownListing: null as null | { id: string },
  findFirstWhere: undefined as unknown,
}))

vi.mock('@/lib/db', () => ({
  db: {
    seller: { findUnique: async () => h.seller },
    listing: {
      findFirst: async ({ where }: { where: unknown }) => {
        h.findFirstWhere = where
        return h.ownListing
      },
    },
  },
}))
vi.mock('@/lib/edition-scope', () => ({
  isSellerHiddenHere: async () => false,
  scopedListingWhere: async (w: object) => ({ scoped: w }),
}))

import { storefrontMetaDescription } from './seller-storefront'
import { SITE_NAME } from '@/lib/edition' // the suite runs as the services edition (vitest.config.ts)

const loaded = (n: number, category: string) => Array.from({ length: n }, (_, i) => ({ id: `l${i}`, category: { name: category } }))

beforeEach(() => {
  h.ownListing = null
  h.findFirstWhere = undefined
  h.seller = {
    id: 's1', name: 'CellphoneS', location: null, trustTier: 'trusted', reviewCount: 0, rating: 5,
    listings: loaded(60, 'Electronics'), _count: { listings: 9726 },
  }
})

describe('storefrontMetaDescription', () => {
  it('a seller whose every live listing links out: the linked wording, the full total, no tier, no star', async () => {
    const d = await storefrontMetaDescription('s1')
    expect(d).toBe(`CellphoneS on ${SITE_NAME}: 9,726 listings in Electronics, each linking to its original page on another site`)
    // The own-listing probe: THIS seller's live rows with no affiliateUrl, through the edition scope.
    expect(h.findFirstWhere).toEqual({ scoped: { sellerId: 's1', verified: true, status: 'active', affiliateUrl: null } })
  })

  it('one own listing anywhere (even past the 60 loaded) makes it an ordinary storefront with its tier', async () => {
    h.ownListing = { id: 'own-61' }
    expect(await storefrontMetaDescription('s1')).toBe(`CellphoneS — 9,726 listings in Electronics · Trusted seller on ${SITE_NAME}`)
  })

  it('an empty storefront never probes, and says no count, no linked wording and no tier', async () => {
    h.seller = { ...h.seller, listings: [], _count: { listings: 0 } }
    expect(await storefrontMetaDescription('s1')).toBe(`CellphoneS on ${SITE_NAME}`)
    expect(h.findFirstWhere).toBeUndefined()
  })

  it('a missing seller is null (the route has already 404d)', async () => {
    h.seller = null
    expect(await storefrontMetaDescription('s1')).toBeNull()
  })
})
