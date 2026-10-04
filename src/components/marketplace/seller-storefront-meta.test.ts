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
  /**
   * The gone-storefront probes (src/lib/storefront-gone.ts): the public probe's answer, the any-listing
   * probe's answer (an emptied catalogue still holds rows; a desk never had one), and every where asked.
   */
  publicListing: null as null | { id: string },
  anyListing: null as null | { id: string },
  goneProbes: [] as unknown[],
}))

vi.mock('@/lib/db', () => ({
  db: {
    seller: { findUnique: async () => h.seller },
    listing: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        // The gone probes are the UNSCOPED reads here — the own-listing probe goes through the scope. Of
        // those, only the public probe asks `verified`; the other asks whether the seller has ANY row.
        if (!('scoped' in where)) {
          h.goneProbes.push(where)
          return 'verified' in where ? h.publicListing : h.anyListing
        }
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

import { loadSeller, storefrontMetaDescription } from './seller-storefront'
import { SITE_NAME } from '@/lib/edition' // the suite runs as the services edition (vitest.config.ts)

const loaded = (n: number, category: string) => Array.from({ length: n }, (_, i) => ({ id: `l${i}`, category: { name: category } }))

beforeEach(() => {
  h.ownListing = null
  h.findFirstWhere = undefined
  h.publicListing = null
  h.anyListing = null
  h.goneProbes = []
  // An ownerless import storefront, as CellphoneS is.
  h.seller = {
    id: 's1', ownerId: null, name: 'CellphoneS', location: null, trustTier: 'trusted', reviewCount: 0, rating: 5,
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

  it('one own listing anywhere (even past the 60 loaded) makes it an ordinary storefront; an OWNED one carries its tier', async () => {
    h.ownListing = { id: 'own-61' }
    h.seller = { ...h.seller, ownerId: 'p1' }
    expect(await storefrontMetaDescription('s1')).toBe(`CellphoneS — 9,726 listings in Electronics · Trusted seller on ${SITE_NAME}`)
  })

  /**
   * ⛔ THE TIER WORD FOLLOWS THE PAGE'S TRUST CHIP (owner, 2026-10-04). The page shows no chip for an ownerless
   * storefront (unrated) or an official partner (badge instead) — so neither meta may say "Trusted seller".
   */
  it('an ownerless storefront with an own listing: the ordinary wording, but no tier — its page shows no trust', async () => {
    h.ownListing = { id: 'own-61' }
    const d = await storefrontMetaDescription('s1')
    expect(d).toBe(`CellphoneS — 9,726 listings in Electronics on ${SITE_NAME}`)
    expect(d).not.toMatch(/trusted|top-rated/i)
  })

  it('an official partner shown as one: no tier — the page shows its partner badge instead of a score', async () => {
    h.ownListing = { id: 'own-61' }
    h.seller = { ...h.seller, ownerId: 'p1', officialPartner: true }
    expect(await storefrontMetaDescription('s1')).toBe(`CellphoneS — 9,726 listings in Electronics on ${SITE_NAME}`)
  })

  it('an empty OWNED storefront never probes, and says no count, no linked wording and no tier', async () => {
    h.seller = { ...h.seller, ownerId: 'p1', listings: [], _count: { listings: 0 } }
    expect(await storefrontMetaDescription('s1')).toBe(`CellphoneS on ${SITE_NAME}`)
    expect(h.findFirstWhere).toBeUndefined()
    expect(h.goneProbes).toEqual([])
  })

  it('a missing seller is null (the route has already 404d)', async () => {
    h.seller = null
    expect(await storefrontMetaDescription('s1')).toBeNull()
  })
})

/**
 * ⛔ THE GONE STOREFRONT (owner, 2026-10-02: "remove it too" — SuperSports, every row hidden). `loadSeller`
 * backs /sellers/<id>, /<handle>, the subdomain page and all three generateMetadata, and null is their 404.
 * Gone = ownerless, HAD listings, none public. An ownerless shop that never had one (a desk) is not gone.
 */
describe('loadSeller — an ownerless shop emptied of anything public is gone', () => {
  it('ownerless + emptied (rows, none public) → null (404), after the public probe and the any-listing probe', async () => {
    h.seller = { ...h.seller, id: 'cmu52jkld0000czq443snv0jh', name: 'SuperSports', listings: [], _count: { listings: 0 } }
    h.anyListing = { id: 'hidden-1' }
    expect(await loadSeller('cmu52jkld0000czq443snv0jh')).toBeNull()
    expect(h.goneProbes).toEqual([
      { sellerId: 'cmu52jkld0000czq443snv0jh', verified: true, status: { in: ['active', 'sold'] } },
      { sellerId: 'cmu52jkld0000czq443snv0jh' },
    ])
    // …and the meta description follows it: nothing names the shop on its 404.
    expect(await storefrontMetaDescription('cmu52jkld0000czq443snv0jh')).toBeNull()
  })

  it('ownerless + NEVER had a listing (the support desk) → shown, with its name and no count', async () => {
    h.seller = { ...h.seller, id: 'eno-support-desk', name: 'eno Support', listings: [], _count: { listings: 0 } }
    expect(await loadSeller('eno-support-desk')).not.toBeNull()
    expect(h.goneProbes).toEqual([
      { sellerId: 'eno-support-desk', verified: true, status: { in: ['active', 'sold'] } },
      { sellerId: 'eno-support-desk' },
    ])
    expect(await storefrontMetaDescription('eno-support-desk')).toBe(`eno Support on ${SITE_NAME}`)
  })

  it('ownerless with one SOLD listing (no active) → shown: the sold page is public and links here, and the any-listing probe never runs', async () => {
    h.seller = { ...h.seller, id: 's-sold', listings: [], _count: { listings: 0 } }
    h.publicListing = { id: 'sold-1' }
    h.anyListing = { id: 'sold-1' }
    expect(await loadSeller('s-sold')).not.toBeNull()
    expect(h.goneProbes).toEqual([{ sellerId: 's-sold', verified: true, status: { in: ['active', 'sold'] } }])
  })

  it('ownerless with active stock → shown, and the count it already ran means no probe', async () => {
    expect(await loadSeller('s-active')).not.toBeNull()
    expect(h.goneProbes).toEqual([])
  })

  it('owned + empty → shown, never probed (a real person keeps their shop)', async () => {
    h.seller = { ...h.seller, id: 's-owned', ownerId: 'p1', listings: [], _count: { listings: 0 } }
    expect(await loadSeller('s-owned')).not.toBeNull()
    expect(h.goneProbes).toEqual([])
  })
})
