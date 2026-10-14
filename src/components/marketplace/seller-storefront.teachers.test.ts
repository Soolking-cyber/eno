import { beforeEach, describe, expect, it, vi } from 'vitest'

// The storefront's teacher section (owner, 2026-10-14: "the storefront doesnt show teacher profiles"): the seller's own
// live teacher profile is read by ONE query that opts in to teachers — every other storefront query keeps the default,
// which leaves teachers out (owner, 2026-09-30: a teacher is never a 0 ₫ product in a grid). The database and the scope
// helper are fakes that record what they were asked.
const h = vi.hoisted(() => ({
  reads: [] as Record<string, unknown>[],
  scopes: [] as { where: Record<string, unknown>; opts?: Record<string, unknown> }[],
}))
vi.mock('@/lib/db', () => ({ db: { listing: { findMany: async (args: Record<string, unknown>) => { h.reads.push(args); return [] } } } }))
vi.mock('@/lib/edition-scope', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  scopedListingWhere: async (where: Record<string, unknown>, opts?: Record<string, unknown>) => {
    h.scopes.push({ where, opts })
    return { scoped: where, teachersIn: !!opts?.teachers }
  },
}))

const { loadStorefrontTeachers } = await import('./seller-storefront')
const { LISTING_CARD_SELECT } = await import('@/lib/serialize')

beforeEach(() => { h.reads = []; h.scopes = [] })

describe('loadStorefrontTeachers', () => {
  it('reads only THIS seller\'s published, live teacher rows — the one storefront read that opts in to teachers', async () => {
    await loadStorefrontTeachers('seller-1')
    expect(h.scopes).toEqual([{ where: { sellerId: 'seller-1', verified: true, status: 'active', listingType: 'teacher' }, opts: { teachers: true } }])
    // The scoped where goes through untouched — the edition boundary stays inside it.
    expect(h.reads).toEqual([{
      where: { scoped: { sellerId: 'seller-1', verified: true, status: 'active', listingType: 'teacher' }, teachersIn: true },
      select: LISTING_CARD_SELECT, // the card /c/teachers renders
      orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
      take: 3,
    }])
  })
})
