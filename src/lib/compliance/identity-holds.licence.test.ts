import { beforeEach, describe, expect, it, vi } from 'vitest'
import { licenceClearedWhere } from '@/lib/licence-stamp'

// ── releaseIdentityHolds and the LICENCE CHECK (owner, 2026-10-14 — src/lib/licence-stamp.ts) ───────────────────────
//
// The seller's identity is not the provider's licence. When an owner becomes verified, everything the identity gate
// parked for them is published — except an e-Visa / Legal & permits row eno has not approved (licenceBlockedIds),
// which STAYS PARKED until 'licence-approve' publishes it. Pinned: the blocked rows are left out of the write, the
// write ANDs licenceClearedWhere for eno's desk (so an edit that re-holds a row mid-release makes it match nothing),
// only the released ids are refreshed, and an owner with nothing parked costs no licence read at all.

type Row = Record<string, any>
const DESK = ['desk-seller']

const h = vi.hoisted(() => ({
  sellers: [] as Array<{ id: string }>,
  held: [] as Array<{ id: string }>,
  blocked: [] as string[],
  count: 0,
  calls: [] as Array<{ m: string; args: any }>,
  refreshed: [] as Array<{ ids: string[]; op: string }>,
}))

vi.mock('@/lib/db', () => ({
  db: {
    seller: { findMany: async (a: Row) => { h.calls.push({ m: 'seller.findMany', args: a }); return h.sellers } },
    listing: {
      findMany: async (a: Row) => { h.calls.push({ m: 'listing.findMany', args: a }); return h.held },
      updateMany: async (a: Row) => { h.calls.push({ m: 'listing.updateMany', args: a }); return { count: h.count } },
    },
  },
}))
vi.mock('@/lib/edition-scope', () => ({ deskSellerIds: async () => { h.calls.push({ m: 'deskSellerIds', args: null }); return DESK } }))
vi.mock('@/lib/core/licence-check', () => ({
  licenceBlockedIds: async (ids: string[], desk?: string[]) => {
    h.calls.push({ m: 'licenceBlockedIds', args: { ids, desk } })
    return new Set(ids.filter((i) => h.blocked.includes(i)))
  },
}))
vi.mock('@/lib/listing-surfaces', () => ({ refreshListingSurfaces: (ids: string[], op: string) => { h.refreshed.push({ ids, op }) } }))

const { releaseIdentityHolds } = await import('./identity-holds')
const called = (m: string) => h.calls.filter((c) => c.m === m)

beforeEach(() => {
  h.sellers = [{ id: 's1' }]
  h.held = []
  h.blocked = []
  h.count = 0
  h.calls = []
  h.refreshed = []
})

describe('releaseIdentityHolds — the licence check stays in force', () => {
  it('⛔ an unchecked licence-aisle row STAYS PARKED; the others are released, and only they are refreshed', async () => {
    h.held = [{ id: 'l1' }, { id: 'visa-1' }, { id: 'l2' }]
    h.blocked = ['visa-1']
    h.count = 2
    expect(await releaseIdentityHolds('owner-1')).toBe(2)
    expect(called('licenceBlockedIds').map((c) => c.args)).toEqual([{ ids: ['l1', 'visa-1', 'l2'], desk: DESK }])
    expect(called('listing.updateMany').map((c) => c.args)).toEqual([{
      where: { id: { in: ['l1', 'l2'] }, identityHold: true, AND: [licenceClearedWhere(DESK)] },
      data: { verified: true, identityHold: false, verificationNotes: null },
    }])
    expect(h.refreshed).toEqual([{ ids: ['l1', 'l2'], op: 'identityHolds' }])
  })

  it('a stamped aisle row is not blocked, so it is released with the rest — the guard rides the write all the same', async () => {
    h.held = [{ id: 'visa-ok' }]
    h.count = 1
    expect(await releaseIdentityHolds('owner-1')).toBe(1)
    expect(called('listing.updateMany')[0].args.where).toEqual({ id: { in: ['visa-ok'] }, identityHold: true, AND: [licenceClearedWhere(DESK)] })
  })

  it('every parked row blocked → 0, no write and nothing refreshed', async () => {
    h.held = [{ id: 'visa-1' }, { id: 'visa-2' }]
    h.blocked = ['visa-1', 'visa-2']
    expect(await releaseIdentityHolds('owner-1')).toBe(0)
    expect(called('listing.updateMany')).toEqual([])
    expect(h.refreshed).toEqual([])
  })

  it('nothing parked (or no storefront) → 0, and no licence read at all', async () => {
    expect(await releaseIdentityHolds('owner-1')).toBe(0)
    h.sellers = []
    expect(await releaseIdentityHolds('owner-2')).toBe(0)
    expect(called('deskSellerIds')).toEqual([])
    expect(called('licenceBlockedIds')).toEqual([])
    expect(called('listing.updateMany')).toEqual([])
  })

  it('the selection is still identityHold alone, by the owner’s storefronts — a takedown (identityHold false) is never released', async () => {
    h.held = [{ id: 'l1' }]
    h.count = 1
    await releaseIdentityHolds('owner-1')
    expect(called('listing.findMany')[0].args.where).toEqual({ sellerId: { in: ['s1'] }, identityHold: true })
    expect(called('listing.updateMany')[0].args.where.identityHold).toBe(true)
  })
})
