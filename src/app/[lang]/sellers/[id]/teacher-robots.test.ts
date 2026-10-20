import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * /sellers/<id> — a teacher-only storefront carries its profile's search verdict (owner decisions 7 and 14, 2026-10-20;
 * src/lib/teachers/search-index.ts storefrontTeacherRobots): the route asks the rule with the seller's id and the shop's
 * own live count (loadSeller's scoped `_count.listings`, which never counts a teacher row) and uses its answer. The 111
 * storefronts pages.xml submitted that day were all teacher-only — every one of them this route (no handle).
 */
const h = vi.hoisted(() => ({
  seller: { id: 's1', name: 'Jane Doe', handle: null, _count: { listings: 0 } } as Record<string, unknown> | null,
  robots: undefined as { index: false; follow: true } | undefined,
  asked: [] as unknown[][],
}))
const stub = () => null
vi.mock('@/components/marketplace/seller-storefront', () => ({
  loadSeller: async () => h.seller,
  storefrontMetaDescription: async () => 'desc',
  SellerStorefront: stub,
}))
vi.mock('@/lib/storefront', () => ({ storefrontCanonical: async (handle: string, origin: string) => `${origin}/${handle}` }))
vi.mock('@/lib/site-identity', () => ({ pageShare: () => ({}) }))
vi.mock('@/lib/teachers/search-index', () => ({
  storefrontTeacherRobots: async (...a: unknown[]) => { h.asked.push(a); return h.robots },
}))

const { generateMetadata } = await import('./page')
const meta = () => generateMetadata({ params: Promise.resolve({ id: 's1' }) })

beforeEach(() => {
  h.seller = { id: 's1', name: 'Jane Doe', handle: null, _count: { listings: 0 } }
  h.robots = undefined
  h.asked = []
})

describe('/sellers/<id> generateMetadata — the teacher-storefront rule', () => {
  it('asks it with the seller and the shop\'s own live count, and uses its noindex', async () => {
    h.robots = { index: false, follow: true }
    const m = await meta()
    expect(h.asked).toEqual([['s1', 0]])
    expect(m.robots).toEqual({ index: false, follow: true })
    expect(String(m.title)).toContain('Jane Doe')
  })
  it('any other answer leaves the tag as it was (none)', async () => {
    h.seller = { ...h.seller!, _count: { listings: 5 } }
    const m = await meta()
    expect(h.asked).toEqual([['s1', 5]])
    expect(m.robots).toBeUndefined()
  })
})
