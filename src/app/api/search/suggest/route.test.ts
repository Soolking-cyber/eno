import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE TYPEAHEAD IS THE PREVIEW OF WHAT ENTER RETURNS, SO IT MUST READ A DISTRICT THE SAME WAY.
 * Measured on production 2026-09-24: for "Quận 1" the dropdown's six listings were the same six as
 * for "Quận 7", and 0 of them were in Quận 1 — the query had been reduced to the token `quan`.
 */

const findMany = vi.fn(async (_args: any) => [])
vi.mock('@/lib/db', () => ({
  db: {
    listing: { findMany: (a: any) => findMany(a), groupBy: vi.fn(async () => []) },
    category: { findMany: vi.fn(async () => []) },
    brand: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: any) => w }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/api/handler', () => ({
  route: (_opts: unknown, fn: (ctx: { req: Request }) => unknown) => (req: Request) => fn({ req }),
}))

const { GET } = await import('./route')
const { districtScopeForSlug } = await import('@/lib/district-slug')

const suggest = (q: string) =>
  (GET as unknown as (r: Request) => Promise<Response>)(new Request(`https://eno.vn/api/search/suggest?q=${encodeURIComponent(q)}`))

beforeEach(() => findMany.mockClear())

describe('suggest — a district in the query', () => {
  it('"Quận 1" asks for listings in the d1 scope, not for the token "quan"', async () => {
    await suggest('Quận 1')
    const where = findMany.mock.calls[0][0].where
    expect(where.AND).toEqual([await districtScopeForSlug('d1')])
  })

  it('"căn hộ quận 7" keeps its words as text beside the d7 scope', async () => {
    await suggest('căn hộ quận 7')
    const where = findMany.mock.calls[0][0].where
    expect(where.AND).toEqual([{ searchText: { contains: 'can' } }, { searchText: { contains: 'ho' } }, await districtScopeForSlug('d7')])
  })

  it('a bare shorthand stays text, exactly as Enter reads it', async () => {
    await suggest('Q7')
    expect(findMany.mock.calls[0][0].where.AND).toEqual([{ searchText: { contains: 'q7' } }])
  })

  it('anything else is searched exactly as before', async () => {
    await suggest('iphone 7')
    expect(findMany.mock.calls[0][0].where.AND).toEqual([{ searchText: { contains: 'iphone' } }])
  })

  /**
   * ⛔ THE FEED'S SAFETY NET, IN THE PREVIEW TOO (resolveFeedFilters). "Hồi ức Phú Nhuận" is a book: read
   * as Phú Nhuận it suggests nothing, while Enter now serves the plain words — so the dropdown asks
   * again with the plain words rather than preview an empty set.
   */
  it('asks again with the plain words when the district reading suggests nothing', async () => {
    await suggest('Hồi ức Phú Nhuận')
    expect(findMany.mock.calls).toHaveLength(2)
    expect(findMany.mock.calls[1][0].where.AND).toEqual(
      ['hoi', 'uc', 'phu', 'nhuan'].map((t) => ({ searchText: { contains: t } })),
    )
  })

  it('does not ask again when the district reading has suggestions, or for a bare numbered district', async () => {
    findMany.mockImplementationOnce(async () => [{ id: 'a', images: '[]', category: { slug: 'rentals' } }] as any)
    await suggest('Hồi ức Phú Nhuận')
    expect(findMany.mock.calls).toHaveLength(1)
    findMany.mockClear()
    // A housing search never asks again: its zero is honest (hasPlainTextFallback).
    await suggest('phòng trọ Phú Nhuận')
    expect(findMany.mock.calls).toHaveLength(1)
    findMany.mockClear()
    await suggest('Quận 1')
    expect(findMany.mock.calls).toHaveLength(1)
  })
})
