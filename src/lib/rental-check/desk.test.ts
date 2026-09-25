import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The desk plumbing: who the operator is, the lazy Seller insert, the once-per-process re-point
// sweep, and the listing predicate every request is checked against.

const h = vi.hoisted(() => ({
  services: false,
  profileWhere: null as unknown,
  profile: { id: 'op-1' } as { id: string } | null,
  createMany: [] as unknown[],
  updateMany: [] as unknown[],
  updateManyThrows: null as Error | null,
  listingWhere: null as unknown,
  listingSelect: null as unknown,
}))

vi.mock('@/lib/edition', () => ({
  get IS_SERVICES() { return h.services },
  get IS_MARKETPLACE() { return !h.services },
}))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
// The licensing predicate is edition-scope.ts's own business (and tested there); here it is enough
// to prove the where is ROUTED THROUGH it, so the stub wraps what it is given in a recognisable way.
vi.mock('@/lib/edition-scope', () => ({
  scopedListingWhere: async (where: unknown) => ({ AND: [where, { sellerId: { notIn: ['desk-1'] } }] }),
}))
vi.mock('@/lib/db', () => ({
  db: {
    profile: { findUnique: async (args: { where: unknown }) => { h.profileWhere = args.where; return h.profile } },
    seller: { createMany: async (args: unknown) => { h.createMany.push(args); return { count: 1 } } },
    conversation: {
      updateMany: async (args: unknown) => {
        if (h.updateManyThrows) throw h.updateManyThrows
        h.updateMany.push(args)
        return { count: 2 }
      },
    },
    listing: {
      findMany: async (args: { where: unknown; select: unknown }) => {
        h.listingWhere = args.where
        h.listingSelect = args.select
        return []
      },
    },
  },
}))

async function load(services = false) {
  vi.resetModules()
  h.services = services
  return import('./desk')
}

beforeEach(() => {
  h.profileWhere = null
  h.profile = { id: 'op-1' }
  h.createMany = []
  h.updateMany = []
  h.updateManyThrows = null
  h.listingWhere = null
  h.listingSelect = null
  delete process.env.RENTAL_CHECK_OPERATOR_EMAIL
})
afterEach(() => { delete process.env.RENTAL_CHECK_OPERATOR_EMAIL })

describe('resolveRentalOperatorProfileId', () => {
  it('defaults to support@eno.forum, an exact match on the lowercased address', async () => {
    const m = await load()
    expect(await m.resolveRentalOperatorProfileId()).toBe('op-1')
    expect(h.profileWhere).toEqual({ email: 'support@eno.forum' })
  })

  it('reads RENTAL_CHECK_OPERATOR_EMAIL per call, normalised', async () => {
    const m = await load()
    process.env.RENTAL_CHECK_OPERATOR_EMAIL = '  Ops@Eno.VN '
    await m.resolveRentalOperatorProfileId()
    expect(h.profileWhere).toEqual({ email: 'ops@eno.vn' })
  })

  it('answers null — never a guess — when nobody has that address', async () => {
    const m = await load()
    h.profile = null
    expect(await m.resolveRentalOperatorProfileId()).toBeNull()
  })
})

describe('ensureRentalDeskSeller', () => {
  /**
   * ⛔ THE INSERT SHAPE IS PINNED. Only `id` and `name` are NOT NULL without a default on "Seller"
   * (scripts/support-thread-ddl.mjs records the information_schema check). Adding `ownerId` would
   * turn the desk into somebody's storefront; dropping skipDuplicates would 500 every request after
   * the first.
   */
  it('inserts exactly { id, name } for THIS edition, skipping duplicates', async () => {
    const m = await load(false)
    await m.ensureRentalDeskSeller()
    expect(h.createMany).toEqual([{ data: [{ id: 'eno-rental-desk', name: 'eno team' }], skipDuplicates: true }])
  })

  it('names the forum desk on the services edition', async () => {
    const m = await load(true)
    await m.ensureRentalDeskSeller()
    expect(h.createMany).toEqual([{ data: [{ id: 'eno-rental-desk-forum', name: 'eno team' }], skipDuplicates: true }])
  })

  it('runs once per process', async () => {
    const m = await load(false)
    await m.ensureRentalDeskSeller()
    await m.ensureRentalDeskSeller()
    expect(h.createMany).toHaveLength(1)
  })
})

describe('repointRentalDeskThreads', () => {
  it("re-points THIS edition's desk threads whose sellerProfileId is null or another operator", async () => {
    const m = await load(false)
    await m.repointRentalDeskThreads('op-1')
    expect(h.updateMany).toEqual([{
      where: {
        sellerId: 'eno-rental-desk',
        listingId: null,
        OR: [{ sellerProfileId: null }, { sellerProfileId: { not: 'op-1' } }],
      },
      data: { sellerProfileId: 'op-1' },
    }])
  })

  /**
   * ⚠️ ONE EDITION'S DESK ONLY. The operator address is per deployment; sweeping both desks would let
   * two differently-configured deployments re-point each other's threads on every restart.
   */
  it('never touches the other edition’s desk', async () => {
    const m = await load(true)
    await m.repointRentalDeskThreads('op-1')
    expect(JSON.stringify(h.updateMany)).not.toContain('"eno-rental-desk"')
    expect(JSON.stringify(h.updateMany)).toContain('"eno-rental-desk-forum"')
  })

  it('sweeps once per operator per process, and again when the operator changes', async () => {
    const m = await load(false)
    await m.repointRentalDeskThreads('op-1')
    await m.repointRentalDeskThreads('op-1')
    expect(h.updateMany).toHaveLength(1)
    await m.repointRentalDeskThreads('op-2')
    expect(h.updateMany).toHaveLength(2)
  })

  it('is best-effort: a failure is swallowed and retried on the next call', async () => {
    const m = await load(false)
    h.updateManyThrows = new Error('db blip')
    await expect(m.repointRentalDeskThreads('op-1')).resolves.toBeUndefined()
    h.updateManyThrows = null
    await m.repointRentalDeskThreads('op-1')
    expect(h.updateMany).toHaveLength(1)
  })
})

describe('resolveCheckableRentals', () => {
  it('asks for live, verified rentals THROUGH the licensing predicate, selecting only snapshot columns', async () => {
    const m = await load(false)
    await m.resolveCheckableRentals(['L1', 'L2'])
    expect(h.listingWhere).toEqual({
      AND: [
        { id: { in: ['L1', 'L2'] }, status: 'active', verified: true, category: { slug: 'rentals' } },
        { sellerId: { notIn: ['desk-1'] } },
      ],
    })
    expect(h.listingSelect).toEqual({ id: true, title: true, titleVi: true, images: true, price: true, currency: true, priceUnit: true })
  })

  it('does not query for an empty list', async () => {
    const m = await load(false)
    expect(await m.resolveCheckableRentals([])).toEqual([])
    expect(h.listingWhere).toBeNull()
  })
})
