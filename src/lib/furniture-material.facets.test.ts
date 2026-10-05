import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@/generated/prisma/client'
import { attributesWithTitleMaterial } from './furniture-material'

/**
 * THE FURNITURE FILTER PANEL READS WHAT THE BACKFILL WRITES — no code change, pinned here.
 *
 * The material chips are counted from `Listing.attributes` (src/lib/facet-counts.ts, the `attr` rail: one
 * groupBy on the raw attributes, each option classified with attr-match.ts's needles), and the panel draws
 * an option only while its count is above 0 and below the rail's total (offeredKeys, hideNoOp). Before the
 * backfill every furniture row's attributes are NULL, so every material count is 0 and the facet is not
 * drawn at all; after it, the values the backfill wrote are counted. The database is mocked the way
 * facet-counts.test.ts mocks it.
 */

const h = vi.hoisted(() => ({ groups: [] as unknown[], calls: [] as { by: string[]; where: Prisma.ListingWhereInput }[] }))

vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      groupBy: async (args: { by: string[]; where: Prisma.ListingWhereInput }) => {
        h.calls.push(args)
        return args.by.join('+') === 'attributes+facetTokens' ? h.groups : []
      },
      count: async () => 0,
    },
    category: { findMany: async () => [] },
  },
}))
vi.mock('@/lib/edition-scope', () => {
  class DeskResolutionError extends Error {}
  return {
    DeskResolutionError,
    marketplaceListingScope: async () => ({ sellerId: { notIn: ['desk-1'] } }),
    teacherExclusion: async () => null,
    scopedListingWhere: async (where: Prisma.ListingWhereInput) => ({ AND: [where, { sellerId: { notIn: ['desk-1'] } }] }),
  }
})

const { computeFacetCounts, __clearFacetCountCache } = await import('./facet-counts')
const { offeredKeys } = await import('@/components/marketplace/count-chip')

const buildFilters = async (params: URLSearchParams) => ({
  andFilters: [{ verified: true }, { status: 'active' }, ...[...params].map(([k, v]) => ({ [k]: v }) as Prisma.ListingWhereInput)],
  pgTextFilter: null,
})
const run = (sub: string) =>
  computeFacetCounts({ searchParams: new URLSearchParams({ category: 'furniture-appliances', subcategory: sub }), buildFilters, dimensions: ['attr'] })
/** One groupBy bucket: rows sharing these attributes. */
const bucket = (attributes: string | null, n: number) => ({ attributes, facetTokens: null, _count: { _all: n } })
const written = (title: string, sub = 'sofa-seating') => attributesWithTitleMaterial({ categorySlug: 'furniture-appliances', subcategorySlug: sub, attributes: null, title })
const MATERIALS = ['wood', 'fabric', 'metal', 'glass', 'rattan-bamboo']

beforeEach(() => {
  h.groups = []
  h.calls = []
  __clearFacetCountCache()
})

describe('the furniture material chips', () => {
  it('TODAY — every row NULL: each material counts 0, so the panel draws no material chip at all', async () => {
    h.groups = [bucket(null, 768)]
    const out = await run('sofa-seating')
    expect(out.attrScope).toBe('furniture-appliances/sofa-seating')
    expect(out.attr!.material).toEqual({ all: 768, values: { wood: 0, fabric: 0, metal: 0, glass: 0, 'rattan-bamboo': 0 } })
    expect(offeredKeys(out.attr!.material, MATERIALS, 'all', { hideNoOp: true })).toEqual([])
  })

  it('AFTER the backfill: the values it wrote are counted, and the chips with rows are drawn', async () => {
    h.groups = [
      bucket(written('Ghế Sofa Bọc Nỉ Màu Xám'), 249),
      bucket(written('Ghế Gỗ Cũ Tự Nhiên'), 67),
      bucket(written('Ghế Cafe Khung Sắt Sơn Trắng'), 23),
      bucket(null, 429), // titles that name no material, two, or only a part's — left empty
    ]
    const out = await run('sofa-seating')
    expect(out.attr!.material).toEqual({ all: 768, values: { wood: 67, fabric: 249, metal: 23, glass: 0, 'rattan-bamboo': 0 } })
    expect(offeredKeys(out.attr!.material, MATERIALS, 'all', { hideNoOp: true })).toEqual(['wood', 'fabric', 'metal'])
    // One groupBy on the raw columns, inside the marketplace scope.
    expect(h.calls.map((c) => c.by.join('+'))).toEqual(['attributes+facetTokens'])
    expect(JSON.stringify(h.calls[0].where)).toContain('desk-1')
  })

  it('a shelf without the facet (white goods) has no material chip to count', async () => {
    h.groups = [bucket(null, 164)]
    const out = await run('white-goods')
    expect(out.attr?.material).toBeUndefined()
  })
})
