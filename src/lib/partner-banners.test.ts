import { beforeEach, describe, expect, it, vi } from 'vitest'

// ⛔ WHAT THIS FILE GUARDS. A partner banner is the most prominent thing on the home page, so a
// storefront this edition is not allowed to surface appearing here would be the loudest possible
// version of the leak the hide-list exists to prevent — and on eno.vn that hide-list is a LICENSING
// control, not a merchandising preference. These tests pin that the scope is applied in BOTH
// directions and that any failure resolving it yields no banners rather than all of them.

const h = vi.hoisted(() => ({
  hidden: [] as string[],
  allowed: null as string[] | null,
  scopeThrows: null as Error | null,
  lastWhere: null as Record<string, unknown> | null,
  rows: [] as Array<{ id: string; name: string; bannerUrl: string | null; handle: { handle: string } | null }>,
}))

vi.mock('@/lib/edition-scope', () => ({
  editionHiddenSellerIds: async () => { if (h.scopeThrows) throw h.scopeThrows; return h.hidden },
  editionAllowedSellerIds: async () => { if (h.scopeThrows) throw h.scopeThrows; return h.allowed },
  // Stands in for the real predicate, which adds the desk exclusion the marketplace may not serve.
  scopedListingWhere: async (base: Record<string, unknown>) => ({ ...base, sellerId: { notIn: h.hidden } }),
}))
vi.mock('@/lib/db', () => ({
  db: {
    seller: {
      findMany: async (args: { where: Record<string, unknown> }) => { h.lastWhere = args.where; return h.rows },
    },
  },
}))
vi.mock('server-only', () => ({}))
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }))

const load = async () => (await import('./partner-banners')).partnerBanners

beforeEach(() => {
  vi.resetModules()
  h.hidden = []; h.allowed = null; h.scopeThrows = null; h.lastWhere = null
  h.rows = [{ id: 's1', name: 'VinWonders', bannerUrl: 'https://sb.eno.vn/b.webp', handle: { handle: 'vinwonders' } }]
})

describe('partnerBanners', () => {
  it('asks only for official partners that actually have a banner and something to sell', async () => {
    await (await load())()
    expect(h.lastWhere).toMatchObject({ officialPartner: true, bannerUrl: { not: null } })
    // ⛔ AND THE ACTIVITY CHECK IS EDITION-SCOPED. Counting listings this edition does not serve
    // would hand the largest promotional slot on eno.vn to a partner whose only active products
    // are the ones eno.vn may not surface — the leak wearing the costume of an activity check.
    expect(h.lastWhere?.listings).toMatchObject({ some: { status: 'active', verified: true } })
    expect((h.lastWhere?.listings as { some: Record<string, unknown> }).some).toHaveProperty('sellerId')
  })

  it('applies the deny-list', async () => {
    h.hidden = ['hidden-desk']
    await (await load())()
    expect(h.lastWhere?.id).toMatchObject({ notIn: ['hidden-desk'] })
  })

  it('applies the allow-list, which is what eno.vn is gated on', async () => {
    h.allowed = ['s1', 's2']
    await (await load())()
    expect(h.lastWhere?.id).toMatchObject({ in: ['s1', 's2'] })
  })

  it('applies BOTH at once — an allowed seller can still be hidden', async () => {
    h.allowed = ['s1', 's2']; h.hidden = ['s2']
    await (await load())()
    expect(h.lastWhere?.id).toMatchObject({ in: ['s1', 's2'], notIn: ['s2'] })
  })

  // ⛔ FAIL CLOSED. An empty strip is invisible; the wrong storefront in the hero is not.
  it('returns nothing when the edition scope cannot be resolved', async () => {
    h.scopeThrows = new Error('desk resolution failed')
    expect(await (await load())()).toEqual([])
  })

  it('returns nothing rather than throwing when the query fails', async () => {
    const mod = await import('./partner-banners')
    h.rows = null as never // findMany resolves to null → .map throws inside the try
    expect(await mod.partnerBanners()).toEqual([])
  })

  it('prefers the clean handle url and falls back to /sellers/<id>', async () => {
    expect((await (await load())())[0]).toMatchObject({ handle: 'vinwonders', name: 'VinWonders' })
    vi.resetModules()
    h.rows = [{ id: 's9', name: 'No Handle', bannerUrl: 'https://sb.eno.vn/x.webp', handle: null }]
    expect((await (await load())())[0]).toMatchObject({ handle: null, id: 's9' })
  })
})
