import { describe, expect, it, vi } from 'vitest'

/**
 * The Help Center's business-review cards link to the reviewed shop's storefront — their only action.
 * A GONE storefront (src/lib/storefront-gone.ts: ownerless, had listings, none public — owner 2026-10-02)
 * 404s, so its reviews are not surfaced: the read carries the same live-storefront rule every surface
 * shares. An ownerless shop that never had a listing (a desk) is not gone, so its reviews stay.
 */
const h = vi.hoisted(() => ({ reviewWhere: undefined as unknown }))

vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => null }))
vi.mock('@/lib/db', () => ({
  db: {
    forumPost: { findMany: async () => [] },
    review: {
      findMany: async ({ where }: { where: unknown }) => {
        h.reviewWhere = where
        return []
      },
    },
  },
}))

import { loadHelpCenter } from './help-center-data'
import { liveStorefrontWhere } from './storefront-gone'

describe('loadHelpCenter — reviews of gone storefronts', () => {
  it('reads reviews only of a live storefront (owned, holding a public listing, or never had a listing)', async () => {
    await loadHelpCenter()
    expect(h.reviewWhere).toEqual({ text: { not: '' }, seller: liveStorefrontWhere() })
    // Spelled out, so the shared rule cannot drift to drop the desks (or the emptied-shop exclusion) unseen.
    expect(h.reviewWhere).toEqual({
      text: { not: '' },
      seller: {
        OR: [
          { ownerId: { not: null } },
          { listings: { some: { verified: true, status: { in: ['active', 'sold'] } } } },
          { listings: { none: {} } },
        ],
      },
    })
  })
})
