import { describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE MAP'S PIN COUNTS FOLLOW THE FEED'S DECISION ABOUT A TYPED DISTRICT. The feed drops a district
 * reading that finds nothing where the plain words find something (resolveFeedFilters); pins built
 * from the unresolved filters would count inside a district the list beside them is not showing.
 */
const h = vi.hoisted(() => ({ groupWhere: null as unknown }))

vi.mock('@/lib/db', () => ({
  db: { listing: { groupBy: vi.fn(async (a: { where: unknown }) => { h.groupWhere = a.where; return [] }) } },
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w }))
vi.mock('@/lib/taxonomy', () => ({ migrateLegacyCategoryParams: (p: URLSearchParams) => p }))
vi.mock('@/generated/rever-buildings', () => ({ REVER_BUILDINGS: {} }))
vi.mock('../feed-query', () => ({
  resolveFeedFilters: async () => ({ andFilters: [{ resolved: true }] }),
  buildFeedFilters: async () => ({ andFilters: [{ resolved: false }] }),
}))

import { NextRequest } from 'next/server'
import { GET } from './route'

describe('GET /api/listings/buildings', () => {
  it('counts pins over the RESOLVED feed filters', async () => {
    await GET(new NextRequest('https://eno.vn/api/listings/buildings?q=H%E1%BB%93i%20%E1%BB%A9c%20Ph%C3%BA%20Nhu%E1%BA%ADn'))
    expect(JSON.stringify(h.groupWhere)).toContain('"resolved":true')
  })
})
